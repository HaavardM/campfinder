//! From elevation to a per-pixel "cost": the ground slope in degrees where a
//! tent could stand, and infinity where it can't.

use crate::grid::Grid;

/// Cost of each 1 m pixel of the terrain model:
///
/// - slope in degrees, if the pixel is usable;
/// - infinity for rough ground, water, missing data and the outermost pixels
///   (which lack a full neighbourhood).
///
/// Making unusable pixels "infinitely steep" means a single sliding max of
/// this grid answers both questions for a tent footprint: how steep is it,
/// and is anything under it unusable?
///
/// `water` is a mask on the same pixel grid: non-zero where N50 maps a lake,
/// river or sea.
pub fn pixel_cost(elevation: &Grid, water: &[u8], max_roughness_m: f32) -> Grid {
    assert_eq!(water.len(), elevation.data.len());
    let mut cost = Grid::filled(elevation.width, elevation.height, f32::INFINITY);
    for y in 1..elevation.height - 1 {
        for x in 1..elevation.width - 1 {
            if water[y * elevation.width + x] != 0 {
                continue;
            }
            // The 3×3 neighbourhood, named row by row:
            //   a b c
            //   d e f
            //   g h i
            let a = elevation.get(x - 1, y - 1);
            let b = elevation.get(x, y - 1);
            let c = elevation.get(x + 1, y - 1);
            let d = elevation.get(x - 1, y);
            let e = elevation.get(x, y);
            let f = elevation.get(x + 1, y);
            let g = elevation.get(x - 1, y + 1);
            let h = elevation.get(x, y + 1);
            let i = elevation.get(x + 1, y + 1);
            let neighbourhood = [a, b, c, d, e, f, g, h, i];
            if neighbourhood.iter().any(|v| !v.is_finite()) {
                continue; // missing data
            }

            // Water the N50 mask misses: some lakes are flattened to one exact
            // height in Kartverket's terrain model, so all nine values are
            // identical. Real ground, interpolated from lidar points, never
            // is. (Not every lake is flattened, hence the mask.)
            if neighbourhood.iter().all(|&v| v == e) {
                continue;
            }

            // Roughness: how far the centre sits above or below the average of
            // its neighbourhood. On any tilted plane this is zero, so it picks
            // out bumps (hummocks, rocks, ditches) without punishing slope.
            let mean = neighbourhood.iter().sum::<f32>() / 9.0;
            if (e - mean).abs() > max_roughness_m {
                continue;
            }

            // Slope with Horn's method, the same formula as `gdaldem slope`:
            // height differences across the neighbourhood, with the middle row
            // or column weighted double. Pixels are 1 m, so these are already
            // metres of rise per metre.
            let dz_dx = ((c + 2.0 * f + i) - (a + 2.0 * d + g)) / 8.0;
            let dz_dy = ((g + 2.0 * h + i) - (a + 2.0 * b + c)) / 8.0;
            let slope_deg = (dz_dx * dz_dx + dz_dy * dz_dy).sqrt().atan().to_degrees();
            cost.set(x, y, slope_deg);
        }
    }
    cost
}

#[cfg(test)]
mod tests {
    use super::*;

    const NO_WATER: [u8; 100] = [0; 100];

    /// A plane tilted so it rises `rise` metres per metre towards the east.
    fn tilted_plane(size: usize, rise: f32) -> Grid {
        let mut grid = Grid::filled(size, size, 0.0);
        for y in 0..size {
            for x in 0..size {
                grid.set(x, y, 900.0 + rise * x as f32);
            }
        }
        grid
    }

    #[test]
    fn slope_of_a_plane() {
        let rise = 5f32.to_radians().tan(); // 5°
        let cost = pixel_cost(&tilted_plane(10, rise), &NO_WATER, 0.1);
        assert!((cost.get(5, 5) - 5.0).abs() < 0.01, "{}", cost.get(5, 5));
        assert_eq!(cost.get(0, 5), f32::INFINITY, "edge pixels are unusable");
    }

    #[test]
    fn a_rock_is_unusable() {
        let mut elevation = tilted_plane(10, 0.02);
        elevation.set(5, 5, elevation.get(5, 5) + 0.4); // 40 cm rock
        let cost = pixel_cost(&elevation, &NO_WATER, 0.1);
        assert_eq!(cost.get(5, 5), f32::INFINITY);
        assert!(cost.get(2, 2).is_finite());
    }

    #[test]
    fn a_flattened_lake_is_unusable() {
        let cost = pixel_cost(&Grid::filled(10, 10, 853.9), &NO_WATER, 0.1);
        assert!(cost.data.iter().all(|v| *v == f32::INFINITY));
    }

    #[test]
    fn mapped_water_is_unusable() {
        let mut water = NO_WATER;
        water[5 * 10 + 5] = 1;
        let cost = pixel_cost(&tilted_plane(10, 0.02), &water, 0.1);
        assert_eq!(cost.get(5, 5), f32::INFINITY);
        assert!(cost.get(4, 5).is_finite());
    }

    #[test]
    fn missing_data_is_unusable() {
        let mut elevation = tilted_plane(10, 0.02);
        elevation.set(5, 5, f32::NAN);
        let cost = pixel_cost(&elevation, &NO_WATER, 0.1);
        assert_eq!(cost.get(4, 4), f32::INFINITY);
        assert!(cost.get(2, 2).is_finite());
    }
}
