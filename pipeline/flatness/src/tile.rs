//! Processing one work tile: from elevation to "best slope per 10 m cell" for
//! each tent.

use crate::geotiff::Georef;
use crate::grid::Grid;
use crate::rotate::{rotate, unrotate_each};
use crate::sliding_max::{max_into, rect_max};
use crate::tents::Footprint;
use crate::terrain::UNUSABLE;

/// Work tiles are 2 × 2 km squares on a grid aligned to multiples of 2000 m
/// in EPSG:25833 (UTM zone 33N). A tile is named after its south-west corner.
pub const TILE_SIZE_M: usize = 2000;
/// Each tile's terrain is downloaded with this much extra border, so a tent
/// near the tile edge still sees the ground around it.
pub const BUFFER_M: usize = 8;
/// Terrain pixels per side of a downloaded tile (1 m pixels).
pub const DTM_SIZE_PX: usize = TILE_SIZE_M + 2 * BUFFER_M;

/// The box a tile's terrain, surface and no-go mask cover: the tile plus its
/// border, as (west, south, east, north) in EPSG:25833 metres. The downloads
/// and the mask all use it, so their pixels line up exactly.
pub fn bordered_box(east: u32, north: u32) -> (f64, f64, f64, f64) {
    let (east, north, border) = (east as f64, north as f64, BUFFER_M as f64);
    let size = TILE_SIZE_M as f64;
    (
        east - border,
        north - border,
        east + size + border,
        north + size + border,
    )
}

/// Where a bordered tile's 1 m pixels sit on the map, for its GeoTIFF.
pub fn bordered_georef(east: u32, north: u32) -> Georef {
    let (west, _, _, north) = bordered_box(east, north);
    Georef {
        west,
        north,
        pixel_size: 1.0,
    }
}
/// Results are summarised into cells of this size.
pub const CELL_SIZE_M: usize = 10;
pub const CELLS_PER_SIDE: usize = TILE_SIZE_M / CELL_SIZE_M;

/// Rectangular tents are tried every 15°: 0°, 15°, …, 165°.
const HEADING_STEP_DEG: usize = 15;

/// For every pixel: the lowest "steepest slope under the tent" over all
/// placements centred on that pixel, in tenths of a degree, and the heading
/// of that placement (compass bearing of the tent's long side, 0–165°;
/// `NO_HEADING` for round tents). `UNUSABLE` means no placement fits.
pub struct Placement {
    pub max_slope: Grid<u8>,
    pub heading: Vec<u8>,
}

/// The heading of a round tent, or of no placement.
const NO_HEADING: u8 = u8::MAX;

pub fn best_placement(cost: &Grid<u8>, footprint: &Footprint) -> Placement {
    match footprint {
        Footprint::Round { rectangles } => {
            // The disc is a union of rectangles (see `Footprint::Round`).
            let mut max_slope = Grid::filled(cost.width, cost.height, 0);
            for &(width, height) in rectangles {
                max_into(&mut max_slope.data, &rect_max(cost, width, height).data);
            }
            let heading = vec![NO_HEADING; cost.data.len()];
            Placement { max_slope, heading }
        }
        Footprint::Rectangle { width, length } => {
            let mut best = Placement {
                max_slope: Grid::filled(cost.width, cost.height, UNUSABLE),
                heading: vec![NO_HEADING; cost.data.len()],
            };
            // In the rotated frame, the W×L and L×W filters are two headings
            // 90° apart, so 6 rotations cover all 12 headings. At 0° the
            // frame is the tile's own: nothing to rotate.
            for angle in (0..90).step_by(HEADING_STEP_DEG) {
                let rotated = (angle > 0).then(|| rotate(cost, angle as f32));
                let frame = rotated.as_ref().unwrap_or(cost);
                // Long side along the rows (u): compass bearing 90 + angle.
                // Long side along the columns (v): bearing angle.
                let along_u = rect_max(frame, *length, *width);
                let along_v = rect_max(frame, *width, *length);
                let mut keep = |i: usize, j: usize| {
                    let (slope, bearing) = if along_u.data[j] <= along_v.data[j] {
                        (along_u.data[j], 90 + angle)
                    } else {
                        (along_v.data[j], angle)
                    };
                    if slope < best.max_slope.data[i] {
                        best.max_slope.data[i] = slope;
                        best.heading[i] = bearing as u8;
                    }
                };
                if angle == 0 {
                    (0..cost.data.len()).for_each(|i| keep(i, i));
                } else {
                    let (w, h) = (cost.width, cost.height);
                    unrotate_each(frame.width, frame.height, angle as f32, w, h, keep);
                }
            }
            best
        }
    }
}

/// One tent's result for a tile, per 10 m cell (row-major, north row first).
pub struct CellResult {
    /// Lowest max-slope of any placement centred in the cell, in degrees
    /// (whole tenths); NaN if none fit.
    pub max_slope: Vec<f32>,
    /// Heading of that placement; -1 if none fit or the tent is round.
    pub heading: Vec<i16>,
}

/// Summarises a placement grid (with border) into 10 m cells: each cell
/// keeps its best placement.
pub fn summarise(placement: &Placement) -> CellResult {
    let width = placement.max_slope.width;
    let mut result = CellResult {
        max_slope: vec![f32::NAN; CELLS_PER_SIDE * CELLS_PER_SIDE],
        heading: vec![-1; CELLS_PER_SIDE * CELLS_PER_SIDE],
    };
    for cell_y in 0..CELLS_PER_SIDE {
        for cell_x in 0..CELLS_PER_SIDE {
            let mut best = UNUSABLE;
            let mut best_heading = NO_HEADING;
            for y in 0..CELL_SIZE_M {
                for x in 0..CELL_SIZE_M {
                    let px = BUFFER_M + cell_x * CELL_SIZE_M + x;
                    let py = BUFFER_M + cell_y * CELL_SIZE_M + y;
                    let value = placement.max_slope.get(px, py);
                    if value < best {
                        best = value;
                        best_heading = placement.heading[py * width + px];
                    }
                }
            }
            let cell = cell_y * CELLS_PER_SIDE + cell_x;
            if best != UNUSABLE {
                result.max_slope[cell] = best as f32 / 10.0;
                if best_heading != NO_HEADING {
                    result.heading[cell] = best_heading as i16;
                }
            }
        }
    }
    result
}

/// Mean elevation of each 10 m cell (tile border excluded).
pub fn cell_elevation(elevation: &Grid) -> Vec<f32> {
    let mut out = vec![f32::NAN; CELLS_PER_SIDE * CELLS_PER_SIDE];
    for cell_y in 0..CELLS_PER_SIDE {
        for cell_x in 0..CELLS_PER_SIDE {
            let mut sum = 0.0;
            for y in 0..CELL_SIZE_M {
                for x in 0..CELL_SIZE_M {
                    let px = BUFFER_M + cell_x * CELL_SIZE_M + x;
                    let py = BUFFER_M + cell_y * CELL_SIZE_M + y;
                    sum += elevation.get(px, py);
                }
            }
            out[cell_y * CELLS_PER_SIDE + cell_x] = sum / (CELL_SIZE_M * CELL_SIZE_M) as f32;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Steep ground (25°) with a flat strip (1°) about 5 px wide running
    /// through the centre at the given compass bearing. In tenths of a degree.
    fn terrace(size: usize, bearing_deg: f32) -> Grid<u8> {
        let mut cost = Grid::filled(size, size, 250);
        let (sin, cos) = bearing_deg.to_radians().sin_cos();
        let centre = (size as f32 - 1.0) / 2.0;
        for y in 0..size {
            for x in 0..size {
                let east = x as f32 - centre;
                let north = centre - y as f32;
                // Distance from the line through the centre along the bearing.
                let across = (east * cos - north * sin).abs();
                if across <= 2.6 {
                    cost.set(x, y, 10);
                }
            }
        }
        cost
    }

    #[test]
    fn long_tent_finds_the_terrace_heading() {
        // 16 px long: 15° off the terrace, its ends reach steep ground.
        let footprint = Footprint::Rectangle {
            width: 2,
            length: 16,
        };
        for bearing in [0, 15, 30, 45, 60, 90, 105, 120, 135, 150, 165] {
            let cost = terrace(41, bearing as f32);
            let placement = best_placement(&cost, &footprint);
            let centre = 20 * 41 + 20;
            assert_eq!(placement.max_slope.data[centre], 10, "bearing {bearing}");
            assert_eq!(
                placement.heading[centre], bearing as u8,
                "bearing {bearing}"
            );
        }
    }

    #[test]
    fn long_tent_does_not_fit_across_the_terrace() {
        let footprint = Footprint::Rectangle {
            width: 2,
            length: 14,
        };
        let placement = best_placement(&terrace(41, 0.0), &footprint);
        // Every placement other than along the terrace crosses steep ground.
        let centre = 20 * 41 + 20;
        assert_eq!(placement.heading[centre], 0);
        // Off the terrace no heading fits on 1° ground.
        assert!(placement.max_slope.data[20 * 41 + 30] >= 250);
    }

    #[test]
    fn round_tent_needs_room_in_every_direction() {
        let footprint = Footprint::Round {
            rectangles: vec![(5, 3), (3, 5)],
        };
        let mut cost = Grid::filled(21, 21, 20);
        cost.set(12, 10, 250); // one steep pixel 2 px east of the centre
        let placement = best_placement(&cost, &footprint);
        assert_eq!(
            placement.max_slope.get(10, 10),
            250,
            "disc reaches 2 px east"
        );
        assert_eq!(placement.max_slope.get(10, 15), 20, "far away is fine");
        assert_eq!(placement.max_slope.get(0, 0), UNUSABLE, "off the edge");
    }
}
