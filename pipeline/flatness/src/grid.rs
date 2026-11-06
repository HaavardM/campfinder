//! A raster stored as one flat `Vec<f32>`.

/// Pixel (x, y) lives at `data[y * width + x]` ("row-major"). Row 0 is the
/// northern edge, as in GeoTIFFs: x grows east, y grows south. One pixel is
/// 1 × 1 m in the terrain grids and 10 × 10 m in the summarised cell grids.
#[derive(Clone, Debug, PartialEq)]
pub struct Grid {
    pub width: usize,
    pub height: usize,
    pub data: Vec<f32>,
}

impl Grid {
    pub fn filled(width: usize, height: usize, value: f32) -> Grid {
        Grid {
            width,
            height,
            data: vec![value; width * height],
        }
    }

    pub fn get(&self, x: usize, y: usize) -> f32 {
        self.data[y * self.width + x]
    }

    pub fn set(&mut self, x: usize, y: usize, value: f32) {
        self.data[y * self.width + x] = value;
    }

    /// Swaps rows and columns.
    ///
    /// A naive transpose reads along rows but writes down columns, and every
    /// write down a column lands in a different cache line. Working in 32×32
    /// blocks keeps both the reads and the writes inside a few cache lines that
    /// stay in L1 until the block is done.
    pub fn transposed(&self) -> Grid {
        const BLOCK: usize = 32;
        let mut out = Grid::filled(self.height, self.width, 0.0);
        for y0 in (0..self.height).step_by(BLOCK) {
            for x0 in (0..self.width).step_by(BLOCK) {
                for y in y0..(y0 + BLOCK).min(self.height) {
                    for x in x0..(x0 + BLOCK).min(self.width) {
                        out.data[x * self.height + y] = self.data[y * self.width + x];
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transpose_swaps_axes() {
        let mut grid = Grid::filled(70, 45, 0.0);
        for y in 0..45 {
            for x in 0..70 {
                grid.set(x, y, (y * 1000 + x) as f32);
            }
        }
        let t = grid.transposed();
        assert_eq!((t.width, t.height), (45, 70));
        for y in 0..45 {
            for x in 0..70 {
                assert_eq!(t.get(y, x), grid.get(x, y));
            }
        }
        assert_eq!(t.transposed(), grid);
    }
}
