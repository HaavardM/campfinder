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
}
