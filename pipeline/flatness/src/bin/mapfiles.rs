//! Turns the engine's results into what the map shows. build_map.sh runs it
//! twice, around tippecanoe:
//!
//!   mapfiles [--data data] geojson OUT_DIR
//!   mapfiles [--tents tents.toml] manifest MAP_DIR
//!
//! `geojson` writes, per tent and season, from every tile's 10 m slope
//! GeoTIFF (each tile read once, so overlapping regions don't count twice):
//!
//! - `<tent>.<season>.points.geojsonl`: the zoomed-out heatmap. One point
//!   per square (80 m at zoom 12, doubling with each zoom out to zoom 5),
//!   with how many of its 10 m cells are spots at up to 1°, 2° and 3°.
//! - `<tent>.<season>.areas.geojsonl`: the zoomed-in areas. For each of
//!   those slope limits, neighbouring spot cells joined into one polygon,
//!   with its size and a point inside it.
//!
//! tippecanoe packs each pair into `<tent>.<season>.<hash>.pmtiles`.
//! `manifest` then writes `manifest.json` for the web app: the tents, and
//! the file for each tent and season found in MAP_DIR.
//!
//! GeoJSON wants longitude and latitude (EPSG:4326); everything here is
//! computed in UTM 33 metres and converted when written. The numbers the
//! web app relies on (LIMITS, the zooms, the property names) must match
//! web/src/lib/flat-layers.ts.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use flatness::geotiff;
use flatness::region::parse_tile_name;
use flatness::tents::TentsFile;
use flatness::tile::{CELL_SIZE_M, CELLS_PER_SIDE, TILE_SIZE_M};
use rayon::prelude::*;
use serde::Serialize;
use terrio::crs::{SpatialRef, Transformer};

/// The slope limits the map offers, in degrees (SLOPE_LIMITS in the web app).
const LIMITS: [u8; 3] = [1, 2, 3];
/// Zoom levels with their own heatmap squares; 12's are 80 m (8 × 8 cells)
/// and also serve zooms 13–15, after which the heatmap has faded out.
const MIN_ZOOM: u32 = 5;
const SQUARE_ZOOM: u32 = 12;
const POINTS_MAX_ZOOM: u32 = 15;
const SQUARE_CELLS: i32 = 8;
/// The areas are drawn from this zoom.
const AREAS_MIN_ZOOM: u32 = 14;

/// A cell's position on the 10 m grid: x / 10 and y / 10 of its south-west
/// corner in UTM 33 metres.
type Cell = (i32, i32);

fn main() {
    let mut args = std::env::args().skip(1);
    let (mut data, mut tents) = (PathBuf::from("data"), PathBuf::from("tents.toml"));
    let mut words = Vec::new();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--data" => data = PathBuf::from(args.next().expect("--data needs a value")),
            "--tents" => tents = PathBuf::from(args.next().expect("--tents needs a value")),
            _ => words.push(arg),
        }
    }
    match words.as_slice() {
        [command, dir] if command == "geojson" => geojson(&data, Path::new(dir)),
        [command, dir] if command == "manifest" => manifest(&tents, Path::new(dir)),
        _ => {
            eprintln!("usage: mapfiles [--data data] geojson OUT_DIR");
            eprintln!("       mapfiles [--tents tents.toml] manifest MAP_DIR");
            std::process::exit(2);
        }
    }
}

/// A tile's folder and south-west corner.
type Tile = (PathBuf, u32, u32);

fn geojson(data: &Path, out: &Path) {
    std::fs::create_dir_all(out).expect("can't create the output folder");
    let tiles: Vec<Tile> = std::fs::read_dir(data.join("flatness"))
        .expect("no data/flatness folder")
        .flatten()
        .filter_map(|entry| {
            let (east, north) = parse_tile_name(&entry.file_name().to_string_lossy())?;
            Some((entry.path(), east, north))
        })
        .collect();

    // Which tents and seasons have results: "keron-4-gt.summer.slope.tif".
    let mut kinds = BTreeSet::new();
    for (dir, _, _) in &tiles {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(stem) = name.strip_suffix(".slope.tif")
                && let Some((tent, season)) = stem.split_once('.')
            {
                kinds.insert((tent.to_string(), season.to_string()));
            }
        }
    }

    for (tent, season) in &kinds {
        let started = std::time::Instant::now();
        let spots = read_spots(&tiles, tent, season);
        let file = |what: &str| out.join(format!("{tent}.{season}.{what}.geojsonl"));
        // The heatmap and the areas are independent: build both at once.
        let (points, areas) = rayon::join(
            || write_points(&file("points"), &spots),
            || write_areas(&file("areas"), &spots),
        );
        println!(
            "{tent} {season}: {} spot cells, {points} heatmap points, {areas} areas ({:.1} s)",
            spots.len(),
            started.elapsed().as_secs_f64()
        );
    }
}

/// UTM 33 metres to longitude and latitude.
fn to_lon_lat() -> Transformer {
    let utm33 = SpatialRef::from_epsg(25833).unwrap();
    Transformer::new(&utm33, &SpatialRef::from_epsg(4326).unwrap()).unwrap()
}

/// Every spot cell up to the largest limit, with its slope in tenths of a
/// degree (rounded up: never flatter than it is). Tiles are read in parallel.
fn read_spots(tiles: &[Tile], tent: &str, season: &str) -> HashMap<Cell, u8> {
    let max_tenths = *LIMITS.last().unwrap() as f32 * 10.0;
    tiles
        .par_iter()
        .flat_map_iter(|(dir, east, north)| {
            let path = dir.join(format!("{tent}.{season}.slope.tif"));
            // Not computed for this tent and season (yet): no spots.
            let grid = geotiff::read_f32(&path, CELLS_PER_SIDE).ok();
            let x0 = (*east as usize / CELL_SIZE_M) as i32;
            let y_top = ((*north as usize + TILE_SIZE_M) / CELL_SIZE_M) as i32;
            grid.into_iter().flat_map(move |grid| {
                (0..CELLS_PER_SIDE * CELLS_PER_SIDE).filter_map(move |i| {
                    let tenths = (grid.data[i] * 10.0).ceil();
                    // NaN (nothing fits) fails this comparison too.
                    (tenths <= max_tenths).then(|| {
                        let (row, col) = (i / CELLS_PER_SIDE, i % CELLS_PER_SIDE);
                        // Row 0 is the tile's northern edge.
                        ((x0 + col as i32, y_top - 1 - row as i32), tenths.max(0.0) as u8)
                    })
                })
            })
        })
        .collect()
}

/// The heatmap: per square and zoom, how many cells are spots at each limit.
/// Counts zoom 12's 80 m squares from the cells, then each coarser zoom from
/// the one before (2 × 2 squares make one). Returns how many points.
fn write_points(path: &Path, spots: &HashMap<Cell, u8>) -> usize {
    let to_lon_lat = to_lon_lat();
    let mut out = BufWriter::new(File::create(path).unwrap());
    let mut squares: HashMap<Cell, [u32; LIMITS.len()]> = HashMap::new();
    let shift = SQUARE_CELLS.trailing_zeros(); // cell → 80 m square
    for (&(x, y), &tenths) in spots {
        let counts = squares.entry((x >> shift, y >> shift)).or_default();
        for (count, limit) in counts.iter_mut().zip(LIMITS) {
            if tenths <= limit * 10 {
                *count += 1;
            }
        }
    }
    let mut written = 0;
    for zoom in (MIN_ZOOM..=SQUARE_ZOOM).rev() {
        let cells_wide = SQUARE_CELLS << (SQUARE_ZOOM - zoom);
        let size_m = (cells_wide as usize * CELL_SIZE_M) as f64;
        let max_zoom = if zoom == SQUARE_ZOOM { POINTS_MAX_ZOOM } else { zoom };
        for (&(sx, sy), counts) in &squares {
            let (lon, lat) = to_lon_lat
                .transform((sx as f64 + 0.5) * size_m, (sy as f64 + 0.5) * size_m)
                .unwrap();
            let [c1, c2, c3] = *counts;
            let n = cells_wide * cells_wide;
            writeln!(
                out,
                r#"{{"type":"Feature","tippecanoe":{{"minzoom":{zoom},"maxzoom":{max_zoom}}},"properties":{{"c1":{c1},"c2":{c2},"c3":{c3},"n":{n}}},"geometry":{{"type":"Point","coordinates":[{lon:.6},{lat:.6}]}}}}"#
            )
            .unwrap();
            written += 1;
        }
        // One zoom out: halving a square's number finds its parent.
        let mut coarser: HashMap<Cell, [u32; LIMITS.len()]> = HashMap::new();
        for ((sx, sy), counts) in squares {
            let parent = coarser.entry((sx >> 1, sy >> 1)).or_default();
            for (sum, count) in parent.iter_mut().zip(counts) {
                *sum += count;
            }
        }
        squares = coarser;
    }
    out.flush().unwrap();
    written
}

/// The areas: for each limit, neighbouring spot cells (sharing an edge)
/// joined into polygons. Returns how many were written.
fn write_areas(path: &Path, spots: &HashMap<Cell, u8>) -> usize {
    let to_lon_lat = to_lon_lat();
    let mut out = BufWriter::new(File::create(path).unwrap());
    let mut written = 0;
    for limit in LIMITS {
        let cells: HashSet<Cell> = spots
            .iter()
            .filter(|&(_, &tenths)| tenths <= limit * 10)
            .map(|(&cell, _)| cell)
            .collect();
        let mut seen: HashSet<Cell> = HashSet::new();
        let mut starts: Vec<Cell> = cells.iter().copied().collect();
        starts.sort(); // the same output on every run
        for start in starts {
            if !seen.insert(start) {
                continue;
            }
            let area = connected(start, &cells, &mut seen);
            // A point inside the area for the photo link: the middle of one
            // of its cells.
            let half = CELL_SIZE_M as i32 / 2;
            let (x, y) = (start.0 * CELL_SIZE_M as i32 + half, start.1 * CELL_SIZE_M as i32 + half);
            write!(
                out,
                r#"{{"type":"Feature","tippecanoe":{{"minzoom":{AREAS_MIN_ZOOM}}},"properties":{{"limit":{limit},"m2":{},"x":{x},"y":{y}}},"geometry":{{"type":"MultiPolygon","coordinates":["#,
                area.len() * CELL_SIZE_M * CELL_SIZE_M,
            )
            .unwrap();
            for (p, polygon) in polygons_with_holes(outline(&area, &cells)).iter().enumerate() {
                out.write_all(if p == 0 { b"[" } else { b",[" }).unwrap();
                for (r, ring) in polygon.iter().enumerate() {
                    if r > 0 {
                        out.write_all(b",").unwrap();
                    }
                    write_ring(&mut out, ring, &to_lon_lat);
                }
                out.write_all(b"]").unwrap();
            }
            out.write_all(b"]}}\n").unwrap();
            written += 1;
        }
    }
    out.flush().unwrap();
    written
}

/// All cells reachable from `start` through cells that share an edge (a
/// flood fill, with a stack instead of recursion).
fn connected(start: Cell, cells: &HashSet<Cell>, seen: &mut HashSet<Cell>) -> Vec<Cell> {
    let mut area = vec![start];
    let mut stack = vec![start];
    while let Some((x, y)) = stack.pop() {
        for next in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
            if cells.contains(&next) && seen.insert(next) {
                area.push(next);
                stack.push(next);
            }
        }
    }
    area
}

/// The outline of one connected area as closed rings of grid corners (in
/// cell units). Every cell side that borders a cell outside the area is a
/// piece of outline, walked counter-clockwise around its cell; joining the
/// pieces end to start gives the rings: counter-clockwise around the outside,
/// clockwise around holes. `cells` are all the cells at this limit: a
/// neighbour among them is always in the same area.
fn outline(area: &[Cell], cells: &HashSet<Cell>) -> Vec<Vec<Cell>> {
    // Edges by their start corner. A corner where the area touches itself
    // diagonally starts two edges, hence the Vec.
    let mut edges: HashMap<Cell, Vec<Cell>> = HashMap::new();
    let mut add = |from: Cell, to: Cell| edges.entry(from).or_default().push(to);
    for &(x, y) in area {
        if !cells.contains(&(x, y - 1)) {
            add((x, y), (x + 1, y)); // south side, walking east
        }
        if !cells.contains(&(x + 1, y)) {
            add((x + 1, y), (x + 1, y + 1)); // east side, walking north
        }
        if !cells.contains(&(x, y + 1)) {
            add((x + 1, y + 1), (x, y + 1)); // north side, walking west
        }
        if !cells.contains(&(x - 1, y)) {
            add((x, y + 1), (x, y)); // west side, walking south
        }
    }
    let mut rings = Vec::new();
    let mut corners: Vec<Cell> = edges.keys().copied().collect();
    corners.sort();
    for first in corners {
        while edges.get(&first).is_some_and(|e| !e.is_empty()) {
            let mut ring = vec![first];
            let (mut at, mut heading) = (first, None);
            loop {
                let next = take_edge(&mut edges, at, heading);
                heading = Some((next.0 - at.0, next.1 - at.1));
                at = next;
                if at == first {
                    break;
                }
                ring.push(at);
            }
            for simple in split_at_repeats(ring) {
                rings.push(drop_straight_corners(simple));
            }
        }
    }
    rings
}

/// Splits a ring that passes the same corner twice (where an area pinches
/// to a single corner) into loops that each pass every corner once: GIS
/// rules want rings that don't touch themselves. Each loop is the stretch
/// between two visits to a corner.
fn split_at_repeats(ring: Vec<Cell>) -> Vec<Vec<Cell>> {
    let mut loops = Vec::new();
    let mut path: Vec<Cell> = Vec::new();
    let mut position: HashMap<Cell, usize> = HashMap::new();
    for corner in ring {
        if let Some(&start) = position.get(&corner) {
            // Back at a corner already on the path: what's after it is a loop.
            let closed: Vec<Cell> = path.drain(start..).collect();
            for c in &closed {
                position.remove(c);
            }
            loops.push(closed);
        }
        position.insert(corner, path.len());
        path.push(corner);
    }
    loops.push(path);
    loops
}

/// Takes the next outline edge from `at`. Where two edges start (the area
/// touches itself diagonally), turning left keeps each ring from crossing
/// itself.
fn take_edge(edges: &mut HashMap<Cell, Vec<Cell>>, at: Cell, heading: Option<Cell>) -> Cell {
    let options = edges.get_mut(&at).expect("outline is closed");
    let pick = match (options.len(), heading) {
        (1, _) | (_, None) => 0,
        (_, Some((dx, dy))) => {
            let left = (-dy, dx);
            options
                .iter()
                .position(|&(x, y)| (x - at.0, y - at.1) == left)
                .unwrap_or(0)
        }
    };
    options.swap_remove(pick)
}

/// Removes corners in the middle of a straight run: a 10-cell edge becomes
/// one segment instead of ten.
fn drop_straight_corners(ring: Vec<Cell>) -> Vec<Cell> {
    let n = ring.len();
    (0..n)
        .filter(|&i| {
            let (a, b, c) = (ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n]);
            (b.0 - a.0) * (c.1 - b.1) != (b.1 - a.1) * (c.0 - b.0) // not collinear
        })
        .map(|i| ring[i])
        .collect()
}

/// Groups rings into polygons: each outer ring (counter-clockwise, positive
/// area) with the holes (clockwise) that lie inside it.
fn polygons_with_holes(rings: Vec<Vec<Cell>>) -> Vec<Vec<Vec<Cell>>> {
    let (outers, holes): (Vec<_>, Vec<_>) = rings.into_iter().partition(|r| signed_area(r) > 0);
    let mut polygons: Vec<Vec<Vec<Cell>>> = outers.into_iter().map(|outer| vec![outer]).collect();
    for hole in holes {
        // A hole's corners all lie on or inside its outer ring; test the
        // middle of its first edge, which is never on the outer ring.
        let probe = (
            (hole[0].0 + hole[1].0) as f64 / 2.0,
            (hole[0].1 + hole[1].1) as f64 / 2.0,
        );
        if let Some(polygon) = polygons.iter_mut().find(|p| contains(&p[0], probe)) {
            polygon.push(hole);
        }
    }
    polygons
}

/// Twice the ring's area, positive when counter-clockwise (the shoelace
/// formula).
fn signed_area(ring: &[Cell]) -> i64 {
    let n = ring.len();
    (0..n)
        .map(|i| {
            let (a, b) = (ring[i], ring[(i + 1) % n]);
            a.0 as i64 * b.1 as i64 - b.0 as i64 * a.1 as i64
        })
        .sum()
}

/// Is the point inside the ring? Counts how many ring edges a line from the
/// point to the east crosses: odd means inside.
fn contains(ring: &[Cell], (px, py): (f64, f64)) -> bool {
    let n = ring.len();
    let mut inside = false;
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        let (ax, ay, bx, by) = (a.0 as f64, a.1 as f64, b.0 as f64, b.1 as f64);
        if (ay > py) != (by > py) && px < ax + (py - ay) / (by - ay) * (bx - ax) {
            inside = !inside;
        }
    }
    inside
}

/// Writes a ring of grid corners as GeoJSON longitude/latitude, closed
/// (first point repeated at the end).
fn write_ring(out: &mut impl Write, ring: &[Cell], to_lon_lat: &Transformer) {
    out.write_all(b"[").unwrap();
    for (i, &(x, y)) in ring.iter().chain(std::iter::once(&ring[0])).enumerate() {
        let (lon, lat) = to_lon_lat
            .transform((x as usize * CELL_SIZE_M) as f64, (y as usize * CELL_SIZE_M) as f64)
            .unwrap();
        let comma = if i > 0 { "," } else { "" };
        write!(out, "{comma}[{lon:.7},{lat:.7}]").unwrap();
    }
    out.write_all(b"]").unwrap();
}

/// The web app's manifest.json.
#[derive(Serialize)]
struct Manifest {
    tents: Vec<TentEntry>,
    /// "keron-4-gt.summer" → "keron-4-gt.summer.3f9a1c0e.pmtiles".
    files: BTreeMap<String, String>,
}

#[derive(Serialize)]
struct TentEntry {
    slug: String,
    name: String,
}

/// Writes MAP_DIR/manifest.json from the tents in tents.toml and the
/// `<tent>.<season>.<hash>.pmtiles` files in MAP_DIR.
fn manifest(tents_toml: &Path, map_dir: &Path) {
    let text = std::fs::read_to_string(tents_toml).expect("can't read the tents file");
    let config: TentsFile = toml::from_str(&text).expect("can't parse the tents file");
    let tents = config
        .tents
        .iter()
        .map(|t| TentEntry { slug: t.slug(), name: t.name.clone() })
        .collect();
    let mut files = BTreeMap::new();
    for entry in std::fs::read_dir(map_dir).expect("no map folder").flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // keron-4-gt.summer.3f9a1c0e.pmtiles → key keron-4-gt.summer
        let Some(stem) = name.strip_suffix(".pmtiles") else { continue };
        if let Some((key, _hash)) = stem.rsplit_once('.') {
            files.insert(key.to_string(), name);
        }
    }
    let json = serde_json::to_string(&Manifest { tents, files }).unwrap();
    std::fs::write(map_dir.join("manifest.json"), json + "\n").unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn traced(area: &[Cell]) -> Vec<Vec<Cell>> {
        outline(area, &area.iter().copied().collect())
    }

    #[test]
    fn a_square_with_a_hole() {
        // A 3 × 3 block of cells without its middle: one outer ring and one
        // hole, each with 4 corners once straight runs are merged.
        let area: Vec<Cell> = (0..3)
            .flat_map(|x| (0..3).map(move |y| (x, y)))
            .filter(|&c| c != (1, 1))
            .collect();
        let polygons = polygons_with_holes(traced(&area));
        assert_eq!(polygons.len(), 1);
        assert_eq!(polygons[0].len(), 2, "outer ring and hole");
        assert_eq!(signed_area(&polygons[0][0]), 2 * 9);
        assert_eq!(signed_area(&polygons[0][1]), -2);
    }

    #[test]
    fn cells_touching_at_a_corner_are_separate() {
        let cells: HashSet<Cell> = [(0, 0), (1, 1)].into_iter().collect();
        let mut seen = HashSet::from([(0, 0)]);
        assert_eq!(connected((0, 0), &cells, &mut seen), vec![(0, 0)]);
    }

    #[test]
    fn a_ring_touching_itself_splits_in_two() {
        // A figure eight through (1, 1).
        let ring = vec![(0, 0), (1, 0), (1, 1), (2, 1), (2, 2), (1, 2), (1, 1), (0, 1)];
        let loops = split_at_repeats(ring);
        assert_eq!(loops.len(), 2);
        assert!(loops.iter().all(|l| l.len() == 4));
    }

    #[test]
    fn a_pinched_area_traces_without_crossing() {
        // An L of three cells whose ends touch diagonally around (1, 1).
        let area = vec![(0, 0), (1, 0), (1, 1), (0, 2), (0, 1)];
        let total: i64 = traced(&area).iter().map(|r| signed_area(r)).sum();
        assert_eq!(total, 2 * area.len() as i64, "rings add up to the area");
    }
}
