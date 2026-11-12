//! Rotating grids, so a rotated tent can be checked with the fast
//! axis-aligned rectangle filter: rotate the terrain, not the tent.

use crate::grid::Grid;
use crate::sliding_max::rect_max;
use crate::terrain::UNUSABLE;

/// Rotates `grid` by `degrees` into a new grid large enough to hold all of it.
/// Pixels with no source (the new corners) are `UNUSABLE`.
///
/// Rotated pixel (u, v) looks at source position (x, y), where
/// `(x, y) - source_centre = R(degrees) · ((u, v) - rotated_centre)`.
///
/// That position usually falls between source pixels, and it takes the max
/// of the 2×2 pixels around it. Taking the max, rather than the nearest
/// pixel, matters: rotated sample points don't land in every source pixel,
/// and a skipped pixel could be the one rock that ruins a spot. Every source
/// pixel is within 0.71 px of some sample point, so with 2×2 none is ever
/// skipped. The cost is that each value spreads by up to one pixel, so
/// angled headings are slightly more conservative than 0° and 90°.
///
/// The 2×2 maxima are one `rect_max` pass up front, which is SIMD and fast,
/// so each rotated pixel is a single lookup: the 2×2 block starting at
/// (⌊x⌋, ⌊y⌋). (On the rare position exactly on a pixel centre, that block
/// holds more pixels than needed: more conservative, never less.)
pub fn rotate(grid: &Grid<u8>, degrees: f32) -> Grid<u8> {
    let (sin, cos) = degrees.to_radians().sin_cos();
    let width = rotated_size(
        grid.width as f32 * cos.abs() + grid.height as f32 * sin.abs(),
        grid.width,
    );
    let height = rotated_size(
        grid.width as f32 * sin.abs() + grid.height as f32 * cos.abs(),
        grid.height,
    );
    let blocks = rect_max(grid, 2, 2);
    let (src_cx, src_cy) = centre(grid.width, grid.height);
    let (rot_cx, rot_cy) = centre(width, height);
    let mut data = Vec::with_capacity(width * height);
    for v in 0..height {
        let dv = v as f32 - rot_cy;
        for u in 0..width {
            let du = u as f32 - rot_cx;
            let x = (src_cx + du * cos - dv * sin).floor();
            let y = (src_cy + du * sin + dv * cos).floor();
            // A block starting off the grid is (partly) off it: unusable.
            let inside =
                x >= 0.0 && y >= 0.0 && (x as usize) < grid.width && (y as usize) < grid.height;
            data.push(if inside {
                blocks.get(x as usize, y as usize)
            } else {
                UNUSABLE
            });
        }
    }
    Grid {
        width,
        height,
        data,
    }
}

/// The inverse of `rotate`: for each pixel of the original `width` × `height`
/// grid, calls `visit(index, rotated_index)` with the pixel's index in that
/// grid and the index of the nearest pixel in a grid rotated by `degrees`
/// to `rotated_width` × `rotated_height`.
///
/// A callback rather than a new grid, so the caller can read every grid in
/// the rotated frame at that pixel and use the values straight away (e.g.
/// keep the best heading) without another pass over memory.
pub fn unrotate_each(
    rotated_width: usize,
    rotated_height: usize,
    degrees: f32,
    width: usize,
    height: usize,
    mut visit: impl FnMut(usize, usize),
) {
    let (sin, cos) = degrees.to_radians().sin_cos();
    let (src_cx, src_cy) = centre(width, height);
    let (rot_cx, rot_cy) = centre(rotated_width, rotated_height);
    for y in 0..height {
        for x in 0..width {
            let (dx, dy) = (x as f32 - src_cx, y as f32 - src_cy);
            // R(-degrees) undoes R(degrees).
            let u = (rot_cx + dx * cos + dy * sin).round() as usize;
            let v = (rot_cy - dx * sin + dy * cos).round() as usize;
            visit(y * width + x, v * rotated_width + u);
        }
    }
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
    fn zero_degrees_round_trips_to_the_2x2_max() {
        let grid = random_grid(20, 13, &mut 7);
        let rotated = rotate(&grid, 0.0);
        let mut back = Grid::filled(20, 13, 0);
        unrotate_each(rotated.width, rotated.height, 0.0, 20, 13, |i, j| {
            back.data[i] = rotated.data[j]
        });
        assert_eq!(back, rect_max(&grid, 2, 2));
    }

    #[test]
    fn no_pixel_is_skipped() {
        // A single "rock" anywhere in the grid must survive every rotation.
        let mut seed = 3;
        for degrees in [15.0, 30.0, 45.0, 60.0, 75.0] {
            for _ in 0..20 {
                let mut grid = Grid::filled(25, 25, 10);
                let x = (crate::test_util::next_random(&mut seed) as usize) % 25;
                let y = (crate::test_util::next_random(&mut seed) as usize) % 25;
                grid.set(x, y, 90);
                let rotated = rotate(&grid, degrees);
                assert!(
                    rotated.data.contains(&90),
                    "{degrees}°: rock at ({x}, {y}) lost"
                );
            }
        }
    }
}
