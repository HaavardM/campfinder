//! A raster stored as one flat `Vec`: heights as `f32` (the default), slopes
//! as `u8`.

/// Pixel (x, y) lives at `data[y * width + x]` ("row-major"). Row 0 is the
/// northern edge, as in GeoTIFFs: x grows east, y grows south. One pixel is
/// 1 × 1 m in the terrain grids and 10 × 10 m in the summarised cell grids.
#[derive(Clone, Debug, PartialEq)]
pub struct Grid<T = f32> {
    pub width: usize,
    pub height: usize,
    pub data: Vec<T>,
}

impl<T: Copy> Grid<T> {
    pub fn filled(width: usize, height: usize, value: T) -> Grid<T> {
        Grid {
            width,
            height,
            data: vec![value; width * height],
        }
    }

    pub fn get(&self, x: usize, y: usize) -> T {
        self.data[y * self.width + x]
    }

    pub fn set(&mut self, x: usize, y: usize, value: T) {
        self.data[y * self.width + x] = value;
    }
}
