# Pipeline

Turns Kartverket's 1 m terrain model into "how flat is the best tent spot"
per 10 m cell, for each tent in [tents.toml](tents.toml). Runs on the WSL
Debian machine.

## Run

```sh
./setup.sh        # once: GDAL tools, curl, GNU time, Rust
./run.sh          # Rondane + Dovre; rerun any time, it only does new work
```

To try it end to end on a small area first (3 × 3 tiles around Mysusæter):

```sh
./run.sh regions/test.env
```

Then load the results into PostGIS for the web app (`PSQL=` points it at a
database; by default the Docker Compose one in `../`):

```sh
./04_load_cells.sh   # cells → table `cell`, then rebuilds the map's `bin` table
```

On the Mac, without installing GDAL (GDAL steps run in Docker), straight
into the local database:

```sh
./run_local.sh regions/test-known.env   # Mysusæter, Smuksjøseter, Rondvassbu
```

What `run.sh` does:

| Step | What | Time (estimate) |
|---|---|---|
| `01_download_water.sh` | N50 map data for Norway (4 GB, once), lakes/rivers/sea into `data/water.gpkg` | ~10 min once |
| `02_download_tiles.sh` | For each 2 × 2 km tile: terrain from Kartverket's WCS (17 MB) and a water mask | ~6 MB/s in total, so ~3 s per tile |
| `03_flatness.sh` | The Rust engine on every tile missing results, then QGIS mosaics | ~1 s per tile per core |

Rondane + Dovre is about 1,300 tiles: ~22 GB of terrain data. Downloading is
the slow part (about an hour, limited by Kartverket's server); processing
should take a few minutes.

Every step prints progress. Downloads show each tile's speed and an ETA. The
flatness engine shows which thread did each tile, and every 2 seconds a strip
with one block per thread (`█` busy, `·` idle). At the end it shows tiles per
thread and overall thread utilisation.

Data lands in `data/` (not in git):

```text
data/
  water.gpkg                  water polygons
  dtm/E0220000_N6864000.tif   terrain, 2016 × 2016 px of 1 m (tile + 8 m border)
  water/E0220000_N6864000.tif water mask on the same pixel grid
  flatness/
    E0220000_N6864000/        results for one tile, 200 × 200 cells of 10 m
      elevation.tif           mean elevation per cell
      gamme-8-pc.slope.tif    best (lowest) max-slope of a placement in the cell, degrees
      keron-4-gt.slope.tif
      keron-4-gt.heading.tif  compass bearing of that placement's long side
      keron-4-gt.cells.csv    cells up to 10°, for the database (04_load_cells.sh)
      keron-4-gt.done         marks the tent done, with the settings used
    keron-4-gt.slope.vrt      mosaic of all tiles, for QGIS
```

## Look at the results

Open `data/flatness/keron-4-gt.slope.vrt` in QGIS, style it with a colour ramp
from 0 (green) to 10 (red) degrees, and put it over a basemap. Check places you
know before trusting the rest.

## Tuning

Each tile's `.done` file records the tent footprint and roughness limit it
was computed with, so changing either recomputes exactly what's affected.

- **Tents:** edit [tents.toml](tents.toml) and rerun. Sizes are rounded to
  whole metres, clearance included.
- **Bumpiness:** `--max-roughness-m` (default 0.1). A pixel sitting more than
  this above or below the average of its 3 × 3 neighbourhood counts as a rock
  or hummock: `./03_flatness.sh --max-roughness-m 0.15`

## How it works

For each tile, the engine ([flatness/](flatness/), Rust):

1. **Cost per 1 m pixel** ([terrain.rs](flatness/src/terrain.rs)): the slope in
   degrees (Horn's method, as `gdaldem slope`). Infinity where a tent can't
   stand: water, missing data, or rough ground.
2. **Steepest pixel under each tent placement**
   ([sliding_max.rs](flatness/src/sliding_max.rs)): a sliding-window maximum.
   Because unusable pixels are infinitely steep, this one number answers both
   "how steep?" and "is anything in the way?".
   - A max over a rectangle is a max along rows, then down columns.
   - Each pass is "elementwise max of two long slices", which the compiler
     turns into SIMD instructions. Cleverer algorithms (van Herk /
     Gil-Werman: 3 comparisons per pixel at any window size) have steps that
     depend on each other, so no SIMD; at our window sizes (≤ 12 px) the
     simple version measured 2–6× faster.
3. **Rotated tents** ([rotate.rs](flatness/src/rotate.rs)): rotate the terrain
   instead of the tent, then use the same rectangle filter. One rotation covers
   two headings 90° apart, so 12 headings need 6 rotations. Round tents are a
   union of rectangles: the max over a union is the max of each part's max.
4. **Summarise** ([tile.rs](flatness/src/tile.rs)): each 10 m cell keeps its
   best placement and heading.

Tiles are independent, so [rayon](https://docs.rs/rayon) runs one tile per
thread. Memory is about 190 MB per thread, so 32 threads fit in WSL's default
16 GB.

## Performance

Measured on one thread of an Apple M-series Mac, one tile:

| Step | ms |
|---|---|
| cost per pixel | 49 |
| rectangle max 6 × 6 / 12 × 12 | 4 / 7 |
| rectangle max 12 × 12, naive | 418 |
| Keron, 12 headings | 401 |
| Gamme, round | 11 |

All 90 tiles of `regions/test-known.env` take 7 s on the Mac's 10 threads.

```sh
cd flatness   # run cargo here, so .cargo/config.toml (target-cpu=native) applies
cargo run --release --example bench -- ../data/dtm/<tile>.tif
cargo test --release
cd .. && ./scaling.sh   # same tiles at 1–32 threads: where does it stop scaling?
```

## Known limits

- **Bog is not excluded.** It's flat, and frozen bog can be a fine winter
  spot. It will become a filter later.
- **Water comes from N50**, mapped at 1:50 000, so small ponds and stream
  edges can be off by a few metres. Lakes that the terrain model flattens to
  one exact height are caught as well.
- **Angled headings are slightly conservative** (about 1 m) because of how
  the rotated grid is sampled, so no rock is ever skipped.
- Lidar sees bare ground, not boulders under ~30 cm, wet ground or brush.
