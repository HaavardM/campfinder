# Pipeline

Turns Kartverket's 1 m terrain model into "how flat is the best tent spot"
per 10 m cell, for each tent in [tents.toml](tents.toml). Runs on the WSL
Debian machine.

## Run

```sh
./setup.sh        # once: GDAL tools, curl, GNU time, Rust
./run.sh          # Rondane + Dovre; rerun any time, it only does new work
```

To try it end to end on a single tile first:

```sh
./run.sh regions/test.env
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
    keron-4-gt.slope.vrt      mosaic of all tiles, for QGIS
```

## Look at the results

Open `data/flatness/keron-4-gt.slope.vrt` in QGIS, style it with a colour ramp
from 0 (green) to 10 (red) degrees, and put it over a basemap. Check places you
know before trusting the rest.

## Tuning

- **Tents:** edit [tents.toml](tents.toml) and rerun; only new or changed
  tents are computed. Sizes are rounded to whole metres, clearance included.
- **Bumpiness:** `MAX_ROUGHNESS_M` (default 0.1). A pixel sitting more than
  this above or below the average of its 3 × 3 neighbourhood counts as a rock
  or hummock. After changing it, recompute everything:
  `MAX_ROUGHNESS_M=0.15 ./03_flatness.sh --force`

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
   - The van Herk / Gil-Werman algorithm does each in 3 comparisons per
     pixel, whatever the window length.
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
| cost per pixel | 37 |
| rectangle max, any size (fast) | 22–30 |
| rectangle max 24 × 24, naive | 1747 |
| Keron, 12 headings | 768 |
| Gamme, round | 50 |

```sh
cargo run --release --example bench --manifest-path flatness/Cargo.toml -- data/dtm/<tile>.tif
./scaling.sh      # same tiles at 1–32 threads: where does it stop scaling?
cargo test --release --manifest-path flatness/Cargo.toml
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
