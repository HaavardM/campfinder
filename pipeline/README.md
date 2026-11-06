# Pipeline

Turns Kartverket's 1 m terrain model into "how flat is the best tent spot"
per 10 m cell, for each tent in [tents.toml](tents.toml), and loads the
results into PostGIS for the web app. Runs natively on the Mac or the WSL
Debian machine.

## Run

Needs Rust (via rustup), GDAL's command-line tools (macOS: `brew install
gdal`; Debian: `apt install gdal-bin`) and the database (`docker compose up
-d` in `../`).

```sh
./run.sh                               # Rondane + Dovre
./run.sh regions/test.env              # a small area (3 × 3 tiles) to try first
./run.sh regions/test-known.env        # Mysusæter, Smuksjøseter, Rondvassbu
./run.sh --force regions/test.env      # recompute, e.g. after changing the code
```

Rerun any time: finished tiles are skipped, downloaded ones reused. Ctrl-C is
safe; the next run continues.

What `run.sh` does:

| Step | What | Time |
|---|---|---|
| `prepare_water.sh` | Per N50 county the regions list (`N50_COUNTIES`): download (0.2–0.7 GB) and extract the water polygons into `data/n50/<county>.water.gpkg`, with GDAL | a few min per county, once |
| `flatness` (Rust) | Downloads terrain tiles 4 at a time (17 MB each, from Kartverket's WCS) and processes each one as soon as it's there, on every CPU | downloads: ~6 MB/s in total, ~3 s per tile; processing: ~0.5 s per tile per core |
| `gdalbuildvrt` | One mosaic per result, for QGIS | seconds |
| `04_load_cells.sh` | New results into PostGIS, then rebuild the map's bins | ~0.15 s per file, plus the bins |

Rondane + Dovre is about 1,300 tiles: ~22 GB of terrain data. Downloading is
the slow part, under an hour. Kartverket's server builds each tile on
request, ~8 s per tile and connection, so the engine downloads 8 at once
(tiles larger than 2 km time out). The CPUs keep up with it easily, so
processing finishes with the last download.

The engine shows two live progress bars (downloads and processing, with
tiles/min and ETA) and, next to the processing bar, a strip with one block
per thread (`█` busy, `·` idle). Above the bars it prints a line per
downloaded tile (MB/s) and per processed tile (how long, which thread). At
the end: tiles per thread and overall thread utilisation (low while waiting
for downloads, which is expected).

Data lands in `data/` (not in git):

```text
data/
  n50/34_Innlandet.water.gpkg  water polygons, one GeoPackage per county
  dtm/E0220000_N6864000.tif    terrain, 2016 × 2016 px of 1 m (tile + 8 m border)
  flatness/
    E0220000_N6864000/         results for one tile, 200 × 200 cells of 10 m
      elevation.tif            mean elevation per cell
      gamme-8-pc.slope.tif     best (lowest) max-slope of a placement in the cell, degrees
      keron-4-gt.slope.tif
      keron-4-gt.heading.tif   compass bearing of that placement's long side
      keron-4-gt.cells.csv     cells up to 10°, for the database
      keron-4-gt.done          marks the tent done, with the settings used
    keron-4-gt.slope.vrt       mosaic of all tiles, for QGIS
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
  or hummock: `./run.sh --max-roughness-m 0.15`

## How it works

For each tile, the engine ([flatness/](flatness/), Rust):

0. **Water mask** ([water.rs](flatness/src/water.rs)): the N50 water polygons
   near the tile are burned into a 1 m grid with
   [terrio](https://crates.io/crates/terrio) (a pure-Rust port of GDAL's
   rasterizer, so the same pixels; 0.3 ms per tile). All polygons are loaded
   into memory once per run, with a bounding box each to find the ones near
   a tile.
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
thread, taking tiles from a channel as the download threads deliver them
(`par_bridge`). Memory is about 190 MB per thread, so 32 threads fit in WSL's
default 16 GB.

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

Run natively, not in Docker: on the Mac, Docker Desktop's virtual machine made
the memory-heavy filter loops 4–20× slower (the code was vectorised just the
same).

```sh
cd flatness   # .cargo/config.toml in pipeline/ builds for this CPU (target-cpu=native)
cargo run --release --example bench -- ../data/dtm/<tile>.tif
cargo test --release
cd .. && ./scaling.sh   # same tiles at 1, 2, 4, … threads: where does it stop scaling?
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
