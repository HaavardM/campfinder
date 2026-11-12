//! Maximum over a sliding rectangle: the steepest pixel under a tent.

use crate::grid::Grid;
use crate::terrain::UNUSABLE;

/// Max over a `width` × `height` rectangle centred on each pixel (an even
/// size reaches one pixel further right or down), over slopes in tenths of
/// a degree. Outside the grid counts as `UNUSABLE`, so a tent hanging off the
/// edge never looks like it fits.
///
/// Two passes, because a max over a rectangle is a max along rows followed by
/// a max down columns:
///
/// 1. Along rows: the max of `width` copies of each row, each shifted one
///    pixel further.
/// 2. Down columns: each output row is the max of `height` whole input rows.
///
/// Both passes are "elementwise max of two long slices", which the compiler
/// turns into SIMD instructions (32 bytes at a time with AVX2), and they
/// walk memory in order. Cleverer algorithms (van Herk / Gil-Werman) cost a
/// fixed 3 comparisons per pixel whatever the window, but their steps depend
/// on each other, so they can't use SIMD. Tent windows are at most 12 px (the tile
/// border limits them), and at that size the simple version measured several
/// times faster. (The low-shore rule's 61 px window costs more passes, still
/// a small part of a tile.)
pub fn rect_max(grid: &Grid<u8>, width: usize, height: usize) -> Grid<u8> {
    rect_max_outside(grid, width, height, UNUSABLE)
}

/// Like `rect_max`, for any values (the low-shore rule uses heights), with
/// outside the grid counting as `outside`. With minus infinity, it simply
/// doesn't count. Float grids must not contain NaN.
pub fn rect_max_outside<T: Copy + PartialOrd>(
    grid: &Grid<T>,
    width: usize,
    height: usize,
    outside: T,
) -> Grid<T> {
    let along_rows = rows_max(grid, width, outside);
    columns_max(&along_rows, height, outside)
}

fn rows_max<T: Copy + PartialOrd>(grid: &Grid<T>, window: usize, outside: T) -> Grid<T> {
    let before = (window - 1) / 2;
    let mut out = Grid::filled(grid.width, grid.height, outside);
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

fn columns_max<T: Copy + PartialOrd>(grid: &Grid<T>, window: usize, outside: T) -> Grid<T> {
    let before = (window - 1) / 2;
    // Each output row starts as its input row, which is in its window anyway.
    let mut out = grid.clone();
    for y in 0..grid.height {
        let row_out = &mut out.data[y * grid.width..(y + 1) * grid.width];
        for source_y in (y as isize - before as isize)..(y + window - before) as isize {
            if source_y < 0 || source_y >= grid.height as isize {
                // The window reaches off the grid.
                row_out.iter_mut().for_each(|v| *v = max(*v, outside));
                continue;
            }
            let start = source_y as usize * grid.width;
            max_into(row_out, &grid.data[start..start + grid.width]);
        }
    }
    out
}

/// `out[i] = max(out[i], other[i])` for every i.
pub fn max_into<T: Copy + PartialOrd>(out: &mut [T], other: &[T]) {
    for (o, &v) in out.iter_mut().zip(other) {
        *o = max(*o, v);
    }
}

/// Not `Ord::max`: on bytes, that one wasn't turned into SIMD (10 × slower).
fn max<T: PartialOrd>(a: T, b: T) -> T {
    if b > a { b } else { a }
}

/// The obvious version: look at every pixel under the rectangle. Used to
/// check `rect_max` in tests and to measure the speedup in the benchmark.
pub fn rect_max_naive(grid: &Grid<u8>, width: usize, height: usize) -> Grid<u8> {
    let mut out = Grid::filled(grid.width, grid.height, 0);
    let (left, up) = (((width - 1) / 2) as isize, ((height - 1) / 2) as isize);
    for y in 0..grid.height as isize {
        for x in 0..grid.width as isize {
            let mut highest = 0;
            for wy in y - up..y - up + height as isize {
                for wx in x - left..x - left + width as isize {
                    let inside = wx >= 0
                        && wy >= 0
                        && (wx as usize) < grid.width
                        && (wy as usize) < grid.height;
                    let value = if inside {
                        grid.get(wx as usize, wy as usize)
                    } else {
                        UNUSABLE
                    };
                    highest = highest.max(value);
                }
            }
            out.set(x as usize, y as usize, highest);
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
    fn window_off_the_edge_is_unusable() {
        let mut grid = Grid::filled(5, 1, 0);
        grid.data.copy_from_slice(&[1, 2, 3, 4, 5]);
        let out = rect_max(&grid, 3, 1);
        assert_eq!(out.data, [UNUSABLE, 3, 4, 5, UNUSABLE]);
    }
}
