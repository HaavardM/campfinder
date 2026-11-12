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
/// holds more pixels than needed: more conservative, never less.) At 0°,
/// where every position is on a pixel centre, it's an exact copy instead.
pub fn rotate(grid: &Grid<u8>, degrees: f32) -> Grid<u8> {
    if degrees == 0.0 {
        return grid.clone();
    }
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
    let (grid_w, grid_h) = (grid.width as f32, grid.height as f32);
    // The parts of the source position that depend only on u, the same for
    // every row: worked out once.
    let du = |u: usize| u as f32 - rot_cx;
    let x_of_u: Vec<f32> = (0..width).map(|u| src_cx + du(u) * cos).collect();
    let y_of_u: Vec<f32> = (0..width).map(|u| src_cy + du(u) * sin).collect();
    let mut data = vec![UNUSABLE; width * height];
    for (v, row) in data.chunks_exact_mut(width).enumerate() {
        let dv = v as f32 - rot_cy;
        let (dv_sin, dv_cos) = (dv * sin, dv * cos);
        // Where pixel u of this row looks in the source: (⌊x⌋, ⌊y⌋).
        let source = |u: usize| ((x_of_u[u] - dv_sin).floor(), (y_of_u[u] + dv_cos).floor());
        // A block starting off the grid is (partly) off it: unusable.
        let inside = |u: usize| {
            let (x, y) = source(u);
            x >= 0.0 && y >= 0.0 && x < grid_w && y < grid_h
        };
        // The row crosses the grid once: only that stretch needs looking
        // up. The rest, about half the pixels at 45°, stays unusable. x and
        // y are a + b·u: solve 0 ≤ x < width and 0 ≤ y < height for u.
        let (x_lo, x_hi) = inside_span(src_cx - rot_cx * cos - dv_sin, cos, grid_w);
        let (y_lo, y_hi) = inside_span(src_cy - rot_cx * sin + dv_cos, sin, grid_h);
        let (start, end) = exact_ends(width, x_lo.max(y_lo), x_hi.min(y_hi), inside);
        for (u, value) in (start..end).zip(&mut row[start..end]) {
            let (x, y) = source(u);
            *value = blocks.get(x as usize, y as usize);
        }
    }
    Grid {
        width,
        height,
        data,
    }
}

/// The u where 0 ≤ a + b·u < n, as real numbers: (lowest, highest).
fn inside_span(a: f32, b: f32, n: f32) -> (f32, f32) {
    let (p, q) = (-a / b, (n - a) / b);
    (p.min(q), p.max(q))
}

/// The first and (one past) the last u in `0..len` where `inside(u)`,
/// which must be one stretch. `lowest` to `highest` is that stretch by exact
/// maths; float rounding puts it a little off (far off when b is near 0),
/// so both ends are moved to where `inside` itself says.
fn exact_ends(
    len: usize,
    lowest: f32,
    highest: f32,
    inside: impl Fn(usize) -> bool,
) -> (usize, usize) {
    // `as` saturates (and makes NaN 0), so this clamps to 0..=len.
    let clamp = |u: f32| (u as usize).min(len);
    let mut start = clamp(lowest);
    while start > 0 && inside(start - 1) {
        start -= 1;
    }
    while start < len && !inside(start) {
        start += 1;
    }
    let mut end = clamp(highest).max(start);
    while end < len && inside(end) {
        end += 1;
    }
    while end > start && !inside(end - 1) {
        end -= 1;
    }
    (start, end)
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
    // In blocks of 64 × 64 pixels rather than whole rows: a row reads the
    // rotated grid along a diagonal, a new cache line every pixel or so,
    // while a block's diagonal patch of it fits in the CPU's fastest cache.
    const BLOCK: usize = 64;
    for top in (0..height).step_by(BLOCK) {
        for left in (0..width).step_by(BLOCK) {
            for y in top..(top + BLOCK).min(height) {
                for x in left..(left + BLOCK).min(width) {
                    let (dx, dy) = (x as f32 - src_cx, y as f32 - src_cy);
                    // R(-degrees) undoes R(degrees).
                    let u = (rot_cx + dx * cos + dy * sin).round() as usize;
                    let v = (rot_cy - dx * sin + dy * cos).round() as usize;
                    visit(y * width + x, v * rotated_width + u);
                }
            }
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
    fn zero_degrees_round_trips_exactly() {
        let grid = random_grid(20, 13, &mut 7);
        let rotated = rotate(&grid, 0.0);
        let mut back = Grid::filled(20, 13, 0);
        unrotate_each(rotated.width, rotated.height, 0.0, 20, 13, |i, j| {
            back.data[i] = rotated.data[j]
        });
        assert_eq!(back, grid);
    }

    /// `rotate` the obvious way: every pixel checked and looked up.
    fn rotate_naive(grid: &Grid<u8>, degrees: f32) -> Grid<u8> {
        let rotated = rotate(grid, degrees); // for its size only
        let blocks = rect_max(grid, 2, 2);
        let (sin, cos) = degrees.to_radians().sin_cos();
        let (src_cx, src_cy) = centre(grid.width, grid.height);
        let (rot_cx, rot_cy) = centre(rotated.width, rotated.height);
        let mut out = Grid::filled(rotated.width, rotated.height, UNUSABLE);
        for v in 0..rotated.height {
            for u in 0..rotated.width {
                let (du, dv) = (u as f32 - rot_cx, v as f32 - rot_cy);
                let x = (src_cx + du * cos - dv * sin).floor();
                let y = (src_cy + du * sin + dv * cos).floor();
                if x >= 0.0 && y >= 0.0 && x < grid.width as f32 && y < grid.height as f32 {
                    out.set(u, v, blocks.get(x as usize, y as usize));
                }
            }
        }
        out
    }

    #[test]
    fn matches_naive() {
        let mut seed = 5;
        for (width, height) in [(1, 1), (2, 7), (13, 13), (40, 9), (31, 64)] {
            let mut grid = random_grid(width, height, &mut seed);
            // No unusable source pixels, so any unusable pixel is outside.
            grid.data.iter_mut().for_each(|v| *v = (*v).min(200));
            for degrees in [1.0, 15.0, 30.0, 45.0, 60.0, 75.0, 89.0, 90.0, 135.0, 300.0] {
                assert_eq!(
                    rotate(&grid, degrees),
                    rotate_naive(&grid, degrees),
                    "{width}×{height} at {degrees}°"
                );
            }
        }
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
