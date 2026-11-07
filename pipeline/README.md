# Pipeline

Turns Kartverket's 1 m terrain model into "how flat is the best tent spot"
per 10 m cell, for each tent in [tents.toml](tents.toml), and packs the
results into the map's files (`data/map/`) for the web app. Runs natively on
the Mac or the WSL Debian machine.

## Run

Needs Rust (via rustup), GDAL's command-line tools (macOS: `brew install
gdal`; Debian: `apt install gdal-bin`) and tippecanoe (macOS: `brew install
tippecanoe`; Debian: `apt install tippecanoe`).

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
| `prepare_no_go.sh` | Per region: download the N50 map data of its counties (`N50_COUNTIES`, 0.2–0.7 GB each, once) and collect where no tent may go into `data/no-go/<region>.gpkg`, with GDAL: water and streams (+2 m of shore), bogs, farmland, industry, golf courses and other land in use, roads (+8 m), tracks and trails, and 150 m around houses, cabins and built-up areas | a few seconds per county, once per region |
| `flatness` (Rust) | Downloads terrain and surface tiles 8 at a time (17 MB each, from Kartverket's WCS) and processes each tile as soon as both are there, on every CPU | downloads: ~8 s per file and connection; processing: ~0.5 s per tile per core |
| `gdalbuildvrt` | One mosaic per result, for QGIS | seconds |
| `build_map.sh` | The map's files in `data/map/`: `mapfiles` (Rust) turns every tile's 10 m slopes into heatmap points (spot counts per square and zoom) and areas (connected spots at 1°, 2° and 3°, outlines traced), and tippecanoe packs them into one PMTiles file per tent and season, plus `manifest.json` | minutes for all regions |

Downloaded tiles are stored compressed without loss, about 7.5 MB instead of
16.8 (deflate after TIFF's floating-point predictor; see
[geotiff.rs](flatness/src/geotiff.rs)). Tiles downloaded before that can be
compressed in place, safely next to a running pipeline:
`(cd flatness && cargo run --release --example compress_tiles -- ../data/dtm ../data/dom)`.

Rondane + Dovre is about 1,300 tiles: ~20 GB of terrain and surface data. Downloading is
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
  n50/Basisdata_34_…_FGDB.zip  Kartverket's N50 map data, per county
  no-go/rondane.gpkg           where no tent may go, one GeoPackage per region
  no-go/rondane.recipe         fingerprint of the queries that made it
  dtm/E0220000_N6864000.tif    terrain, 2016 × 2016 px of 1 m (tile + 8 m border)
  dom/E0220000_N6864000.tif    surface (treetops, bushes, roofs), same pixels
  flatness/
    E0220000_N6864000/         results for one tile, 200 × 200 cells of 10 m
      elevation.tif            mean elevation per cell
      gamme-8-pc.summer.slope.tif   best (lowest) max-slope of a placement in the cell, degrees
      keron-4-gt.winter.slope.tif   the same in winter (bogs allowed)
      keron-4-gt.summer.heading.tif compass bearing of that placement's long side
      keron-4-gt.summer.blocks.csv  cells up to 10° in 80 m squares, for the database
      keron-4-gt.done               marks the tent done (both seasons), with the settings used
    keron-4-gt.summer.slope.vrt     mosaic of all tiles, for QGIS
```

## Look at the results

Open `data/flatness/keron-4-gt.summer.slope.vrt` in QGIS, style it with a colour ramp
from 0 (green) to 10 (red) degrees, and put it over a basemap. Check places you
know before trusting the rest.

## Tuning

Each tile's `.done` file records the tent footprint, limits and no-go
recipe it was computed with, so changing any of them recomputes exactly
what's affected.

- **Tents:** edit [tents.toml](tents.toml) and rerun. Sizes are rounded to
  whole metres, clearance included.
- **Bumpiness:** `--max-roughness-m` (default 0.1). A pixel sitting more than
  this above or below the average of its 3 × 3 neighbourhood counts as a rock
  or hummock: `./run.sh --max-roughness-m 0.15`
- **Bushes and trees:** `--max-object-height-m` (default 0.5). Anything
  standing higher than this on the ground blocks a pixel. Heather and grass
  stay below; dwarf birch, bushes, boulders and trees don't.
- **By the water:** `--min-height-above-water-m` (default 0.5). Within 30 m
  of a lake, river or sea, ground less than this above the water is blocked:
  where N50's shoreline is off it's the lake itself, otherwise wet shore.
  Lower it to get closer to the water.
- **No-go areas:** edit the queries in [prepare_no_go.sh](prepare_no_go.sh)
  and rerun; the regions' GeoPackages and tiles are redone.

## How it works

For each tile, the engine ([flatness/](flatness/), Rust):

0. **Blocked pixels:** the region's no-go polygons near the tile are burned
   into a 1 m grid ([no_go.rs](flatness/src/no_go.rs)) with
   [terrio](https://crates.io/crates/terrio), a pure-Rust port of GDAL's
   rasterizer, so the same pixels. All polygons are loaded into memory once
   per run, with a bounding box each to find the ones near a tile. Then
   every pixel where the surface model is more than 0.5 m above the terrain
   is blocked too ([terrain.rs](flatness/src/terrain.rs)): something stands
   there. So is water the map draws in the wrong place: ground less than
   0.5 m above the lowest water within 30 m (a sliding minimum, done with
   the same code as step 2), and unnaturally smooth ground, where the
   terrain model was interpolated across water the lidar barely saw.
1. **Cost per 1 m pixel** ([terrain.rs](flatness/src/terrain.rs)): the slope in
   degrees (Horn's method, as `gdaldem slope`). Infinity where a tent can't
   stand: blocked, missing data, or rough ground.
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

- **No-go areas come from N50**, mapped at 1:50 000: bog and stream edges
  can be off by several metres, and small ponds are missing. Lakes that the
  terrain model flattens to one exact height are caught as well. (The
  detailed FKB maps need a Norge digitalt licence.)
- **Bog is excluded in summer only**: the winter results treat it as ground
  under snow.
- **Buildings by type:** the 150 m rule covers houses, cabins, summer farms
  and mountain huts (types 111–179), not barns, garages or tourist huts.
- **Angled headings are slightly conservative** (about 1 m) because of how
  the rotated grid is sampled, so no rock is ever skipped.
- **Objects under 0.5 m** (small boulders, low scrub) and wet ground the map
  doesn't mark as bog aren't seen.
