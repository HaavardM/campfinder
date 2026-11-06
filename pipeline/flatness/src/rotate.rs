//! Rotating grids, so a rotated tent can be checked with the fast
//! axis-aligned rectangle filter: rotate the terrain, not the tent.

use crate::grid::Grid;

/// Rotates `grid` by `degrees` into a new grid large enough to hold all of it.
/// Pixels with no source (the new corners) are infinity.
///
/// Rotated pixel (u, v) looks at source position (x, y), where
/// `(x, y) - source_centre = R(degrees) · ((u, v) - rotated_centre)`.
///
/// That position usually falls between source pixels, and it takes the max
/// of the (up to) 2×2 pixels around it. Taking the max, rather than the
/// nearest pixel, matters: rotated sample points don't land in every source
/// pixel, and a skipped pixel could be the one rock that ruins a spot. Every
/// source pixel is within 0.71 px of some sample point, so with 2×2 none is
/// ever skipped. The cost is that each value spreads by up to one pixel, so
/// angled headings are slightly more conservative than 0° and 90°.
pub fn rotate(grid: &Grid, degrees: f32) -> Grid {
    let (sin, cos) = degrees.to_radians().sin_cos();
    let width = rotated_size(
        grid.width as f32 * cos.abs() + grid.height as f32 * sin.abs(),
        grid.width,
    );
    let height = rotated_size(
        grid.width as f32 * sin.abs() + grid.height as f32 * cos.abs(),
        grid.height,
    );
    let mut rotated = Grid::filled(width, height, f32::INFINITY);
    let (src_cx, src_cy) = centre(grid.width, grid.height);
    let (rot_cx, rot_cy) = centre(width, height);
    for v in 0..height {
        for u in 0..width {
            let (du, dv) = (u as f32 - rot_cx, v as f32 - rot_cy);
            let x = src_cx + du * cos - dv * sin;
            let y = src_cy + du * sin + dv * cos;
            rotated.set(u, v, max_around(grid, x, y));
        }
    }
    rotated
}

/// The inverse of `rotate`: for each pixel of the original `width` × `height`
/// grid, the value of the nearest pixel in `rotated`.
pub fn unrotate(rotated: &Grid, degrees: f32, width: usize, height: usize) -> Grid {
    let (sin, cos) = degrees.to_radians().sin_cos();
    let mut out = Grid::filled(width, height, f32::INFINITY);
    let (src_cx, src_cy) = centre(width, height);
    let (rot_cx, rot_cy) = centre(rotated.width, rotated.height);
    for y in 0..height {
        for x in 0..width {
            let (dx, dy) = (x as f32 - src_cx, y as f32 - src_cy);
            // R(-degrees) undoes R(degrees).
            let u = (rot_cx + dx * cos + dy * sin).round() as usize;
            let v = (rot_cy - dx * sin + dy * cos).round() as usize;
            out.set(x, y, rotated.get(u, v));
        }
    }
    out
}

/// Max of the source pixels whose centres are less than one pixel from
/// (x, y): 2×2 pixels, or just one when (x, y) is exactly on a pixel centre.
/// Anything outside the grid counts as infinity.
fn max_around(grid: &Grid, x: f32, y: f32) -> f32 {
    let mut max = f32::NEG_INFINITY;
    for py in [y.floor(), y.ceil()] {
        for px in [x.floor(), x.ceil()] {
            let inside =
                px >= 0.0 && py >= 0.0 && (px as usize) < grid.width && (py as usize) < grid.height;
            let value = if inside {
                grid.get(px as usize, py as usize)
            } else {
                f32::INFINITY
            };
            max = max.max(value);
        }
    }
    max
}

/// Enough pixels for `needed`, keeping the same odd/even parity as the source
/// size. With equal parity the two grid centres are both on pixel centres (or
/// both between pixels), so a 0° rotation maps pixels exactly onto pixels.
fn rotated_size(needed: f32, source: usize) -> usize {
    let mut size = needed.ceil() as usize + 1;
    if (size + source) % 2 == 1 {
        size += 1;
    }
    size
}

fn centre(width: usize, height: usize) -> (f32, f32) {
    ((width as f32 - 1.0) / 2.0, (height as f32 - 1.0) / 2.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::random_grid;

    #[test]
    fn zero_degrees_round_trips_exactly() {
        let grid = random_grid(20, 13, &mut 7);
        let back = unrotate(&rotate(&grid, 0.0), 0.0, 20, 13);
        assert_eq!(back, grid);
    }

    #[test]
    fn no_pixel_is_skipped() {
        // A single "rock" anywhere in the grid must survive every rotation.
        let mut seed = 3;
        for degrees in [15.0, 30.0, 45.0, 60.0, 75.0] {
            for _ in 0..20 {
                let mut grid = Grid::filled(25, 25, 1.0);
                let x = (crate::test_util::next_random(&mut seed) as usize) % 25;
                let y = (crate::test_util::next_random(&mut seed) as usize) % 25;
                grid.set(x, y, 9.0);
                let rotated = rotate(&grid, degrees);
                assert!(
                    rotated.data.contains(&9.0),
                    "{degrees}°: rock at ({x}, {y}) lost"
                );
            }
        }
    }
}
