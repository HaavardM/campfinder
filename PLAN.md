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
| Web app | React, TypeScript, TanStack Start |
| UI | shadcn/ui, Tailwind, MapLibre GL JS |
| Database | PostgreSQL + PostGIS (Docker) |
| Pipeline | Bash, GDAL tools, osm2pgsql, SQL |
| Flatness engine | Rust: `gdal`, `ndarray`, `rayon` |

The pipeline runs on the WSL Debian box: AMD Ryzen 9 5950X (16 cores / 32
threads, AVX2, no AVX-512) with 32 GB RAM, of which WSL gets 16 GB by
default. Results move to the Mac with `pg_dump` / `pg_restore`.

## Data sources

| Data | Source | Used for |
|---|---|---|
| 1 m terrain model (DTM) | Kartverket, hoydedata.no | Flatness |
| Basemap | Kartverket topo and grey topo (WMTS) | Map background |
| Place names | Kartverket place-name API | Search |
| Later: roads, parking | OpenStreetMap (Geofabrik) | Where you can drive and park |
| Later: buildings, water, bog | Kartverket N50 | Exclusions, 150 m rule |
| Later: land cover | NIBIO AR5 / AR50 | Prefer open heath |
| Later: protected areas | Miljødirektoratet Naturbase | Show park rules |

## Finding flat spots

Tents are defined in `pipeline/tents.toml`, either `round` (diameter) or
`rectangle` (width × length), plus one `clearance_m` added on every side for
guy lines. Starting with the Gamme 8 PC (round, 4.32 m) and the Keron 4 GT
(5 × 2.1 m).

For each tent, a tent-shaped window slides over the 1 m terrain. A placement
passes if, under the tent:

- the steepest pixel is below the slope you choose in the UI, and
- the highest and lowest points differ by at most 0.3 m (bumpiness, fixed in
  the pipeline).

Rectangular tents are tried at 12 headings (every 15°).

**Making it fast.** "Max under a rectangle" is a row-wise max followed by a
column-wise max. Running min/max (van Herk) costs 3 comparisons per pixel
whatever the window size. Rotated tents are handled by rotating the terrain
instead of the tent. Round tents are built from a few overlapping rectangles.
Tiles are processed in parallel with `rayon`.

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
  run.sh               runs everything, skips finished work
  tents.toml
  regions/*.env        one bbox per region (rondane, dovre, test)
  01_download_dtm.sh   DTM tiles from hoydedata.no
  02_flatness/         Rust crate: DTM → 10 m results per tile and tent
  03_load_cells.sh     results → PostGIS (COPY)
  04_export.sh         pg_dump for the Mac
```

Later: importing roads, buildings, land cover and protected areas, and
computing distances to them, are added as extra steps.

## Data model

```sql
tents (tent_id, name, shape, width_m, length_m, diameter_m)

cells (cell_id, geom, elevation_m)

cell_flatness (cell_id, tent_id, max_slope_deg, best_heading_deg)
```

Cells where no tent fits are left out. Columns for distances, land cover and
so on are added when those features arrive.

## Web app

The focus is a flatness heatmap that's quick to explore.

- **Map:** full screen on the Kartverket topo basemap, with smooth pan and
  zoom, and a toggle between topo and grey topo (the heatmap stands out
  better on grey). Aerial photos (Norge i bilder) need an access agreement,
  so they're left out for now.
- **Heatmap:** one server route returns vector tiles (`ST_AsMVT`) for the
  chosen tent and max slope. It shows a smooth heatmap when zoomed out and
  coloured 10 m cells when zoomed in, with a short fade between the two.
- **Controls:** a small floating panel with tent (`Select`), max slope
  (`Slider`) and heatmap opacity.
- **Moving around:**
  - Place-name search (Kartverket's free place-name API), e.g. "Mysuseter".
  - Buttons to jump to each processed region (Rondane, Dovre).
  - Map position, tent and slope kept in the URL, so reloading or sharing a
    link returns to the same view.
  - "Locate me" for use in the field.
- **Spot details:** clicking a cell shows elevation, slope, the tent outline
  at its best heading, and a norgeskart.no link.

## Phases

1. **Skeleton.** PostGIS in Docker, a TanStack Start app with shadcn, and a
   map with place search and URL state.
2. **Flatness.** The Rust engine, tested on the Mac against a simple naive
   version, then run on Rondane and Dovre. Check the results in QGIS against
   spots you know.
3. **Heatmap.** Vector tiles, tent and slope controls, cells when zoomed in.
4. **Spot details.** Click a cell to see its details and tent outline.
5. **Later.** Roads and parking with distance filters, exclusions
   (buildings, water, bog, protected areas), saved spots, more regions,
   walking distance over trails.

## Caveats

- Lidar sees bare ground, so small rocks and wet ground may not show up.
  Results mean "worth checking".
- Allemannsretten: at least 150 m from houses and cabins. Parks may have
  their own rules.
- OSM road access tags are incomplete; check before driving.

## Open questions

1. How much extra room the guy lines need (`clearance_m`, default 0.5 m).
2. Places in Rondane and Dovre you know well enough to judge the results.
