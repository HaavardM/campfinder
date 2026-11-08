# Campfinder — plan

Find wild camping spots in Norway that are flat enough for a given tent and a
short carry from where the car can be parked. Starting with Rondane and Dovre.

The project is also for learning GIS, fullstack, and processing data at
scale on many cores.

## Principles

- **Heavy work up front, filtering in the UI.** An offline pipeline computes
  everything expensive. The app only filters precomputed numbers.
- **Readable code.** Small single-purpose steps. Comments explain GIS and
  performance ideas, not the code itself.
- **Efficient CPU use.** Choose algorithms whose cost doesn't depend on tent
  size, use all cores, and measure. Fast existing libraries are fine.
- **Easy to expand.** Add a region file and rerun; only new work is done.
- **Norway only.** One coordinate system: EPSG:25833 (UTM 33N, metres).

## Stack

| Part | Choice |
|---|---|
| Web app | React, TypeScript, Vite |
| UI | shadcn/ui, Tailwind, MapLibre GL JS |
| Map data | Files: one PMTiles per tent and season, from any static host or bucket |
| Pipeline | Bash, GDAL tools, tippecanoe |
| Flatness engine | Rust: `rayon` for threads, pure-Rust `tiff` for GeoTIFF, plain `Vec<f32>` grids |

The pipeline runs on the WSL Debian box: AMD Ryzen 9 5950X (16 cores / 32
threads, AVX2, no AVX-512) with 32 GB RAM, of which WSL gets 16 GB by
default. Results move to the Mac with `pg_dump` / `pg_restore`.

## Data sources

| Data | Source | Used for |
|---|---|---|
| 1 m terrain model (DTM) | Kartverket, WCS `wcs.hoyde-dtm-nhm-25833` | Flatness |
| 1 m surface model (DOM) | Kartverket, WCS `wcs.hoyde-dom-nhm-25833` | Bushes, trees, boulders: DOM − DTM > 0.5 m blocks |
| Water, bogs, streams, farmland, buildings | Kartverket N50 | No-go areas (150 m around houses and cabins) |
| Basemap | Kartverket topo and grey topo (WMTS) | Map background |
| Place names | Kartverket place-name API | Search |
| Later: roads, parking | OpenStreetMap (Geofabrik) | Where you can drive and park |
| Later: land cover | NIBIO AR5 / AR50 | Prefer open heath |
| Later: protected areas | Miljødirektoratet Naturbase | Show park rules |

## Finding flat spots

Tents are defined in `pipeline/tents.toml`, either `round` (diameter) or
`rectangle` (width × length), plus one `clearance_m` added on every side for
guy lines. Starting with the Gamme 8 PC (round, 4.32 m) and the Keron 4 GT
(5 × 2.1 m).

Each 1 m pixel gets a cost: its slope in degrees, or infinity if a tent
can't stand there. That covers no-go areas (N50: water, roads, land in use,
near houses, and bogs in summer only),
anything standing on the ground (surface model), low ground right by water,
interpolated (unnaturally smooth) ground, missing data, and rough
ground: more than 0.1 m above or below the average of its 3×3 neighbours,
like a rock or hummock. Measuring bumps against the neighbourhood average
keeps them separate from slope; a raw "highest minus lowest under the tent"
would reject a gentle 3° slope under a 6 m tent.

For each tent, a tent-shaped window slides over the cost grid. The max
under the window is the tent's steepest pixel, or infinity if anything
under it is unusable. The UI then filters on that slope. Rectangular tents
are tried at 12 headings (every 15°).

**Making it fast.** "Max under a rectangle" is a row-wise max followed by a
column-wise max. Running max (van Herk / Gil-Werman) costs 3 comparisons per
pixel whatever the window size. Rotated tents are handled by rotating the
terrain instead of the tent. Round tents are built from a few overlapping
rectangles. Tiles are processed in parallel with `rayon`. Details and
measurements: [pipeline/README.md](pipeline/README.md).

Results are summarised into **10 m cells**: for each cell and tent, the best
slope and its heading.

## Pipeline

Work is done in fixed 2×2 km tiles. Each step skips work that's already done,
so `./run.sh` can be rerun any time.

Why 2 km: a tile is 4 M pixels, 16 MB per `f32` grid, so a thread with its
scratch grids needs roughly 150–200 MB. With 32 threads that's about 6 GB,
which fits in WSL's default 16 GB. 5 km tiles would need about 1 GB per
thread and wouldn't fit. Rondane and Dovre come to several hundred tiles,
plenty to keep 32 threads evenly busy. The extra border each tile reads
(about 4 m) costs well under 1%.

```text
pipeline/
  run.sh                 runs everything, skips finished work
  tents.toml
  regions/*.env          one bbox + N50 counties per hiking area (and test*)
  prepare_no_go.sh       N50 no-go polygons per region, once (GDAL's ogr2ogr)
  flatness/              the Rust engine: downloads terrain and surface tiles and
                         processes them as they arrive; no-go masks with terrio
  build_map.sh           results → the map's PMTiles files (mapfiles + tippecanoe)
  scaling.sh             speed at 1, 2, 4, … threads
```

Runs natively on the Mac and on the WSL machine. Only `prepare_no_go.sh`
needs GDAL, because N50 is published only as an Esri file geodatabase.

Later: importing roads, buildings, land cover and protected areas, and
computing distances to them, are added as extra steps.

## Data model

No database: the map's data are files in `pipeline/data/map/`, made by
[build_map.sh](pipeline/build_map.sh).

```text
manifest.json                   tents, and which file is which tent and season
<tent>.<season>.<hash>.pmtiles  all map tiles, zoom 5–16, two layers:
  scores   zoom 5–15: heatmap points, one per square (80 m at zoom 12,
           doubling outwards): c1, c2, c3 = cells that are spots at up to
           1°, 2°, 3°; n = cells
  areas    zoom 14–16: connected spots at each limit, outlines traced:
           limit (1, 2, 3), m2, x/y (a UTM point inside)
```

PMTiles holds every tile in one file with an index, so the browser reads
just the pieces it needs with HTTP range requests, from any bucket. The
files carry all three limits, so the map's controls only filter: no new
downloads. Heading and elevation stay in the GeoTIFFs for QGIS.

## Web app

Zoomed out, the map shows **areas worth looking at**: a smooth surface,
greener where there are more spots for the chosen tent. Zoomed in (from
zoom 14), it shows the spots themselves, merged into orange areas.

- **Spot:** a 10 m cell where the tent fits within the chosen max slope.
- **Score per square:** the square root of the share of its cells that are
  spots. A tent needs one spot, not a meadow; the square root lifts squares
  with only a few spots into view.
- **Smooth surface:** one point per square, drawn as a MapLibre heatmap whose
  blur is normalised to a weighted average of nearby scores, so it
  interpolates rather than piling up (see `web/src/lib/flat-layers.ts`).
- **Min area:** orange areas smaller than this (default 300 m²) are hidden:
  a lone 10 m cell is more often noise than a campsite.
- **Controls:** tent, summer/winter, max slope, min area, place search,
  region buttons, topo/grey basemap; everything kept in the URL.
- **Look before driving:** click an area to open it in Norge i bilder
  (Kartverket's aerial photos, also 3D; a website link, since its map
  services need a licence), or open the view in Google's satellite photos.

## Phases

1. **Skeleton.** PostGIS in Docker, a TanStack Start app with shadcn, and a
   map with place search and URL state.
2. **Flatness.** The Rust engine, tested on the Mac against a simple naive
   version, then run on Rondane and Dovre. Check the results in QGIS against
   spots you know.
3. **Heatmap.** Vector tiles, tent and slope controls, cells when zoomed in.
   (First served from PostGIS; now static PMTiles files, so the whole app
   can live in a bucket.)
4. **Spot details.** Click a cell to see its details and tent outline.
5. **Later.** Roads and parking with distance filters, small ponds (from
   the lidar), protected-area rules, saved spots, walking distance over
   trails.

## Caveats

- Small ponds, wet ground and objects under 0.5 m may not show up, and
  N50's bogs and streams are only accurate to several metres. Results mean
  "worth checking".
- Allemannsretten: at least 150 m from houses and cabins. Parks may have
  their own rules.
- OSM road access tags are incomplete; check before driving.

## Open questions

1. How much extra room the guy lines need (`clearance_m`, default 0.5 m).
2. Places in Rondane and Dovre you know well enough to judge the results.
