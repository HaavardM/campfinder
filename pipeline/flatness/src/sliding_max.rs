//! Maximum over a sliding rectangle: the steepest pixel under a tent.

use crate::grid::Grid;
use crate::terrain::UNUSABLE;

/// Max over a `width` × `height` rectangle centred on each pixel (an even
/// size reaches one pixel further right or down), over slopes in tenths of
/// a degree. Outside the grid counts as `UNUSABLE`, so a tent hanging off the
/// edge never looks like it fits.
///
/// Two passes, because a max over a rectangle is a max along rows followed by
/// a max down columns. Each is a max over `window` values in a line, done by
/// doubling (`window_max`): a window of 61 takes 6 rounds, not 60.
///
/// Every round is "elementwise max of two long slices", which the compiler
/// turns into SIMD instructions (32 bytes at a time with AVX2), walking
/// memory in order. Cleverer algorithms (van Herk / Gil-Werman) cost a fixed
/// 3 comparisons per pixel whatever the window, but their steps depend on
/// each other, so they can't use SIMD.
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
    let mut out = Vec::with_capacity(grid.data.len());
    let (mut padded, mut spare) = (Vec::new(), Vec::new());
    for row in grid.data.chunks_exact(grid.width) {
        // The row padded with `outside` on both sides, so every window is
        // in bounds.
        padded.clear();
        padded.resize(before, outside);
        padded.extend_from_slice(row);
        padded.resize(grid.width + window - 1, outside);
        window_max(&mut padded, &mut spare, 1, window, grid.width, &mut out);
    }
    Grid {
        width: grid.width,
        height: grid.height,
        data: out,
    }
}

fn columns_max<T: Copy + PartialOrd>(grid: &Grid<T>, window: usize, outside: T) -> Grid<T> {
    let before = (window - 1) / 2;
    // In strips a cache line (64 bytes) wide: a strip and all its rounds of
    // `window_max` stay in the CPU's cache. Over the whole grid at once,
    // every round went out to memory and back, which with all cores busy
    // made this pass wait on memory.
    let strip = (64 / size_of::<T>()).max(1);
    let mut out = vec![outside; grid.data.len()];
    let (mut padded, mut spare, mut result) = (Vec::new(), Vec::new(), Vec::new());
    for left in (0..grid.width).step_by(strip) {
        let columns = strip.min(grid.width - left);
        // The strip with rows of `outside` above and below it.
        padded.clear();
        padded.resize(before * columns, outside);
        for row in grid.data.chunks_exact(grid.width) {
            padded.extend_from_slice(&row[left..left + columns]);
        }
        padded.resize((grid.height + window - 1) * columns, outside);
        result.clear();
        let count = grid.height * columns;
        window_max(&mut padded, &mut spare, columns, window, count, &mut result);
        for (row, values) in out
            .chunks_exact_mut(grid.width)
            .zip(result.chunks_exact(columns))
        {
            row[left..left + columns].copy_from_slice(values);
        }
    }
    Grid {
        width: grid.width,
        height: grid.height,
        data: out,
    }
}

/// Appends to `out`, for each of the first `count` positions i: the max of
/// `window` values of `values`, `step` apart, starting at i (`step` 1 along
/// a row, a row's length down columns). `values` must have room for the
/// last window. Both it and `spare` (any vector, to reuse its memory) are
/// overwritten.
///
/// By doubling: after one round, `values[i]` is the max of 2 values from i,
/// after two of 4, and so on, each round the max of two values `span` apart.
/// Once `span` is at least half the window, two overlapping spans cover it.
/// Each round writes to the other vector: reading and writing the same one
/// keeps the compiler from using SIMD (measured 7 × slower).
fn window_max<T: Copy + PartialOrd>(
    values: &mut Vec<T>,
    spare: &mut Vec<T>,
    step: usize,
    window: usize,
    count: usize,
    out: &mut Vec<T>,
) {
    let mut span = 1;
    while span * 2 <= window {
        let shift = span * step;
        spare.clear();
        spare.extend(
            values
                .iter()
                .zip(&values[shift..])
                .map(|(&a, &b)| max(a, b)),
        );
        std::mem::swap(values, spare);
        span *= 2;
    }
    let shift = (window - span) * step;
    let last = values.iter().zip(&values[shift..]).take(count);
    out.extend(last.map(|(&a, &b)| max(a, b)));
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
