//! Maximum over a sliding window (or rectangle), at a constant cost per pixel
//! whatever the window size.

use crate::grid::Grid;

/// Sliding-window maximum along a line: the van Herk / Gil-Werman algorithm.
///
/// For every `i`, `out[i]` is the max of `input` over a window of `window`
/// pixels centred on `i` (an even window reaches one pixel further right).
/// Positions outside `input` count as infinity, so a window hanging off the
/// edge never looks like it fits.
///
/// How it works: cut the line into blocks of `window` pixels. Any window of
/// that length covers the tail of one block and the head of the next. So,
/// within each block, precompute the running max from the left (`prefix`) and
/// from the right (`suffix`). The window starting at `s` is then
/// `max(suffix[s], prefix[s + window - 1])`. That's 3 comparisons per pixel,
/// instead of `window` for the obvious loop.
///
/// The struct only holds scratch buffers, so one instance can be reused for
/// every row without allocating.
#[derive(Default)]
pub struct SlidingMax {
    padded: Vec<f32>,
    prefix: Vec<f32>,
    suffix: Vec<f32>,
}

impl SlidingMax {
    pub fn run(&mut self, input: &[f32], window: usize, out: &mut [f32]) {
        assert!(window >= 1);
        assert_eq!(input.len(), out.len());
        let before = (window - 1) / 2;
        let after = window - 1 - before;

        // The line with infinity on both sides, so every window is in bounds.
        self.padded.clear();
        self.padded.resize(before, f32::INFINITY);
        self.padded.extend_from_slice(input);
        self.padded
            .resize(before + input.len() + after, f32::INFINITY);
        let n = self.padded.len();
        self.prefix.resize(n, 0.0);
        self.suffix.resize(n, 0.0);

        for i in 0..n {
            let block_start = i % window == 0;
            self.prefix[i] = if block_start {
                self.padded[i]
            } else {
                self.prefix[i - 1].max(self.padded[i])
            };
        }
        for i in (0..n).rev() {
            let block_end = i % window == window - 1 || i == n - 1;
            self.suffix[i] = if block_end {
                self.padded[i]
            } else {
                self.suffix[i + 1].max(self.padded[i])
            };
        }
        for (start, value) in out.iter_mut().enumerate() {
            *value = self.suffix[start].max(self.prefix[start + window - 1]);
        }
    }
}

/// Max over a `width` × `height` rectangle centred on each pixel. Outside the
/// grid counts as infinity.
///
/// A max over a rectangle can be done in two 1D passes: first a max along each
/// row, then a max down each column of that result. The column pass is done
/// as transpose → row pass → transpose, so there's only one kernel to get
/// right, and it always walks memory in order.
///
/// Note: `f32::max` ignores NaN, so grids passed in must not contain NaN (use
/// infinity for "unusable").
pub fn rect_max(grid: &Grid, width: usize, height: usize, scratch: &mut SlidingMax) -> Grid {
    let along_rows = rows_max(grid, width, scratch);
    let along_columns = rows_max(&along_rows.transposed(), height, scratch);
    along_columns.transposed()
}

fn rows_max(grid: &Grid, window: usize, scratch: &mut SlidingMax) -> Grid {
    let mut out = Grid::filled(grid.width, grid.height, 0.0);
    let rows_in = grid.data.chunks_exact(grid.width);
    let rows_out = out.data.chunks_exact_mut(grid.width);
    for (row_in, row_out) in rows_in.zip(rows_out) {
        scratch.run(row_in, window, row_out);
    }
    out
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
        let mut scratch = SlidingMax::default();
        let mut seed = 1;
        for width in [1, 2, 3, 7, 16, 33] {
            for height in [1, 5, 12, 31] {
                let grid = random_grid(width, height, &mut seed);
                for window_w in 1..=9 {
                    for window_h in [1, 2, 3, 6, 10] {
                        assert_eq!(
                            rect_max(&grid, window_w, window_h, &mut scratch),
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
        let mut scratch = SlidingMax::default();
        let mut out = vec![0.0; 5];
        scratch.run(&[1.0, 2.0, 3.0, 4.0, 5.0], 3, &mut out);
        assert_eq!(out, [f32::INFINITY, 3.0, 4.0, 5.0, f32::INFINITY]);
    }
}
