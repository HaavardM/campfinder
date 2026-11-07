//! Maximum over a sliding rectangle: the steepest pixel under a tent.

use crate::grid::Grid;

/// Max over a `width` × `height` rectangle centred on each pixel (an even
/// size reaches one pixel further right or down). Outside the grid counts as
/// infinity, so a tent hanging off the edge never looks like it fits.
///
/// Two passes, because a max over a rectangle is a max along rows followed by
/// a max down columns:
///
/// 1. Along rows: the max of `width` copies of each row, each shifted one
///    pixel further.
/// 2. Down columns: each output row is the max of `height` whole input rows.
///
/// Both passes are "elementwise max of two long slices", which the compiler
/// turns into SIMD instructions (8 floats at a time with AVX2), and they walk
/// memory in order. Cleverer algorithms (van Herk / Gil-Werman) cost a fixed
/// 3 comparisons per pixel whatever the window, but their steps depend on each
/// other, so they can't use SIMD. Our windows are at most 12 px (the tile
/// border limits them), and at that size the simple version measured several
/// times faster.
///
/// Note: `f32::max` ignores NaN, so grids passed in must not contain NaN (use
/// infinity for "unusable").
pub fn rect_max(grid: &Grid, width: usize, height: usize) -> Grid {
    rect_max_outside(grid, width, height, f32::INFINITY)
}

/// Like `rect_max`, but outside the grid counts as `outside`. With minus
/// infinity, it simply doesn't count.
pub fn rect_max_outside(grid: &Grid, width: usize, height: usize, outside: f32) -> Grid {
    let along_rows = rows_max(grid, width, outside);
    columns_max(&along_rows, height, outside)
}

fn rows_max(grid: &Grid, window: usize, outside: f32) -> Grid {
    let before = (window - 1) / 2;
    let mut out = Grid::filled(grid.width, grid.height, 0.0);
    // One row padded with `outside` on both sides, so every shifted copy is
    // in bounds.
    let mut padded = vec![outside; grid.width + window - 1];
    let rows_in = grid.data.chunks_exact(grid.width);
    let rows_out = out.data.chunks_exact_mut(grid.width);
    for (row_in, row_out) in rows_in.zip(rows_out) {
        padded[before..before + grid.width].copy_from_slice(row_in);
        row_out.copy_from_slice(&padded[..grid.width]);
        for shift in 1..window {
            max_into(row_out, &padded[shift..shift + grid.width]);
        }
    }
    out
}

fn columns_max(grid: &Grid, window: usize, outside: f32) -> Grid {
    let before = (window - 1) / 2;
    let mut out = Grid::filled(grid.width, grid.height, f32::NEG_INFINITY);
    for y in 0..grid.height {
        let row_out = &mut out.data[y * grid.width..(y + 1) * grid.width];
        for source_y in (y as isize - before as isize)..(y + window - before) as isize {
            if source_y < 0 || source_y >= grid.height as isize {
                // The window reaches off the grid.
                row_out.iter_mut().for_each(|v| *v = v.max(outside));
                continue;
            }
            let start = source_y as usize * grid.width;
            max_into(row_out, &grid.data[start..start + grid.width]);
        }
    }
    out
}

/// `out[i] = max(out[i], other[i])` for every i.
fn max_into(out: &mut [f32], other: &[f32]) {
    for (o, &v) in out.iter_mut().zip(other) {
        *o = o.max(v);
    }
}

/// The obvious version: look at every pixel under the rectangle. Used to
/// check `rect_max` in tests and to measure the speedup in the benchmark.
pub fn rect_max_naive(grid: &Grid, width: usize, height: usize) -> Grid {
    let mut out = Grid::filled(grid.width, grid.height, 0.0);
    let (left, up) = (((width - 1) / 2) as isize, ((height - 1) / 2) as isize);
    for y in 0..grid.height as isize {
        for x in 0..grid.width as isize {
            let mut max = f32::NEG_INFINITY;
            for wy in y - up..y - up + height as isize {
                for wx in x - left..x - left + width as isize {
                    let inside = wx >= 0
                        && wy >= 0
                        && (wx as usize) < grid.width
                        && (wy as usize) < grid.height;
                    let value = if inside {
                        grid.get(wx as usize, wy as usize)
                    } else {
                        f32::INFINITY
                    };
                    max = max.max(value);
                }
            }
            out.set(x as usize, y as usize, max);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::random_grid;

    #[test]
    fn matches_naive_on_random_grids() {
        let mut seed = 1;
        for width in [1, 2, 3, 7, 16, 33] {
            for height in [1, 5, 12, 31] {
                let grid = random_grid(width, height, &mut seed);
                for window_w in 1..=9 {
                    for window_h in [1, 2, 3, 6, 10] {
                        assert_eq!(
                            rect_max(&grid, window_w, window_h),
                            rect_max_naive(&grid, window_w, window_h),
                            "grid {width}x{height}, window {window_w}x{window_h}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn window_off_the_edge_is_infinite() {
        let mut grid = Grid::filled(5, 1, 0.0);
        grid.data.copy_from_slice(&[1.0, 2.0, 3.0, 4.0, 5.0]);
        let out = rect_max(&grid, 3, 1);
        assert_eq!(out.data, [f32::INFINITY, 3.0, 4.0, 5.0, f32::INFINITY]);
    }
}
