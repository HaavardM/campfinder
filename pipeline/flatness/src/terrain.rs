//! From elevation to a per-pixel "cost": the ground slope in degrees where a
//! tent could stand, and infinity where it can't.

use crate::grid::Grid;
use crate::sliding_max::rect_max_outside;

/// Cost of each 1 m pixel of the terrain model:
///
/// - slope in degrees, if the pixel is usable;
/// - infinity for rough ground, blocked pixels, missing data and the
///   outermost pixels (which lack a full neighbourhood).
///
/// Making unusable pixels "infinitely steep" means a single sliding max of
/// this grid answers both questions for a tent footprint: how steep is it,
/// and is anything under it unusable?
///
/// `blocked` is a mask on the same pixel grid: non-zero where a tent can't
/// go whatever the slope (water, bogs, bushes, …).
pub fn pixel_cost(elevation: &Grid, blocked: &[u8], max_roughness_m: f32) -> Grid {
    assert_eq!(blocked.len(), elevation.data.len());
    let mut cost = Grid::filled(elevation.width, elevation.height, f32::INFINITY);
    for y in 1..elevation.height - 1 {
        for x in 1..elevation.width - 1 {
            if blocked[y * elevation.width + x] != 0 {
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

/// Blocks the pixels where something stands on the ground higher than
/// `max_height_m`: trees, bushes, boulders, buildings.
///
/// Kartverket's two lidar models differ in what they show: the terrain model
/// (DTM) is the bare ground, with everything on it removed; the surface
/// model (DOM) is the first thing the laser hit, so treetops and roofs.
/// Their difference is the height of whatever stands on the ground. Where
/// the surface is missing (NaN: no lidar there, as across the Swedish
/// border), there's no telling what stands there, so it's blocked too.
pub fn mark_obstacles(blocked: &mut [u8], elevation: &Grid, surface: &Grid, max_height_m: f32) {
    assert_eq!(surface.data.len(), elevation.data.len());
    for ((b, ground), top) in blocked.iter_mut().zip(&elevation.data).zip(&surface.data) {
        let height = top - ground;
        if height.is_nan() || height > max_height_m {
            *b = 1;
        }
    }
}

/// Blocks low ground by the water: pixels within `reach_px` of `water` (a
/// mask like `blocked`, of lakes, rivers and sea only) that are less than
/// `min_height_m` above the lowest water within that reach.
///
/// N50's shorelines can be several metres off, which leaves flat "spots" on
/// the lake itself, and the ground just above the water is often wet. Both
/// sit within centimetres of the lake's surface in the terrain model, while
/// a dry lakeside spot sits higher.
///
/// The water level near each pixel is a sliding minimum over the water
/// pixels' heights: `rect_max` of the negated heights, with everything that
/// isn't water (or is off the grid) at minus infinity, so it never counts.
pub fn mark_low_shore(
    blocked: &mut [u8],
    elevation: &Grid,
    water: &[u8],
    reach_px: usize,
    min_height_m: f32,
) {
    let mut negated = Grid::filled(elevation.width, elevation.height, f32::NEG_INFINITY);
    for ((n, &z), &w) in negated.data.iter_mut().zip(&elevation.data).zip(water) {
        if w != 0 && z.is_finite() {
            *n = -z;
        }
    }
    let window = 2 * reach_px + 1;
    let lowest_water = rect_max_outside(&negated, window, window, f32::NEG_INFINITY);
    for ((b, &z), &minus_level) in blocked.iter_mut().zip(&elevation.data).zip(&lowest_water.data) {
        // No water within reach leaves minus_level at minus infinity: skip.
        if minus_level.is_finite() && z + minus_level < min_height_m {
            *b = 1;
        }
    }
}

/// Blocks unnaturally smooth pixels: where the 5 × 5 m around a pixel lies
/// on a plane to within `max_residual_m` (root mean square).
///
/// Lidar barely returns from water, so over lakes and ponds Kartverket's
/// terrain model is interpolated between the shores: planes that real
/// ground, measured point by point, is never that close to (measured on
/// flat ground: under 1 mm in fewer than 1 in 1000 pixels; on N50 water:
/// 42%). This also finds ponds the map doesn't have, and lakes the terrain
/// model flattens to one exact height.
///
/// The best-fitting plane is cheap here: over a square window centred on
/// the pixel, the constant, the x and the y terms don't interact, so each is
/// a plain sum. With heights relative to the centre, f32 is plenty.
pub fn mark_smooth(blocked: &mut [u8], elevation: &Grid, max_residual_m: f32) {
    const R: usize = 2; // 5 × 5
    let n = ((2 * R + 1) * (2 * R + 1)) as f32;
    let sum_d2 = n * 2.0; // Σ dx² over the window = 5 · (4 + 1 + 0 + 1 + 4)
    let max_sum_squares = max_residual_m * max_residual_m * n;
    for y in R..elevation.height - R {
        for x in R..elevation.width - R {
            let centre = elevation.get(x, y);
            let (mut sum, mut sum_x, mut sum_y, mut sum_sq) = (0f32, 0f32, 0f32, 0f32);
            for dy in -(R as isize)..=R as isize {
                for dx in -(R as isize)..=R as isize {
                    let z = elevation.get((x as isize + dx) as usize, (y as isize + dy) as usize)
                        - centre;
                    sum += z;
                    sum_x += dx as f32 * z;
                    sum_y += dy as f32 * z;
                    sum_sq += z * z;
                }
            }
            // What the plane doesn't explain: Σz² minus the parts explained
            // by the mean, the x slope and the y slope. (NaN never blocks.)
            let residual = sum_sq - sum * sum / n - (sum_x * sum_x + sum_y * sum_y) / sum_d2;
            if residual < max_sum_squares {
                blocked[y * elevation.width + x] = 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTHING_BLOCKED: [u8; 100] = [0; 100];

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
        let cost = pixel_cost(&tilted_plane(10, rise), &NOTHING_BLOCKED, 0.1);
        assert!((cost.get(5, 5) - 5.0).abs() < 0.01, "{}", cost.get(5, 5));
        assert_eq!(cost.get(0, 5), f32::INFINITY, "edge pixels are unusable");
    }

    #[test]
    fn a_rock_is_unusable() {
        let mut elevation = tilted_plane(10, 0.02);
        elevation.set(5, 5, elevation.get(5, 5) + 0.4); // 40 cm rock
        let cost = pixel_cost(&elevation, &NOTHING_BLOCKED, 0.1);
        assert_eq!(cost.get(5, 5), f32::INFINITY);
        assert!(cost.get(2, 2).is_finite());
    }

    #[test]
    fn a_flattened_lake_is_smooth() {
        // Some lakes are flattened to one exact height in the terrain model.
        let mut blocked = NOTHING_BLOCKED;
        mark_smooth(&mut blocked, &Grid::filled(10, 10, 853.9), 0.001);
        assert_eq!(blocked[5 * 10 + 5], 1);
    }

    #[test]
    fn blocked_pixels_are_unusable() {
        let mut blocked = NOTHING_BLOCKED;
        blocked[5 * 10 + 5] = 1;
        let cost = pixel_cost(&tilted_plane(10, 0.02), &blocked, 0.1);
        assert_eq!(cost.get(5, 5), f32::INFINITY);
        assert!(cost.get(4, 5).is_finite());
    }

    #[test]
    fn a_bush_and_missing_surface_block_but_grass_does_not() {
        let ground = tilted_plane(10, 0.02);
        let mut surface = ground.clone();
        surface.set(5, 5, ground.get(5, 5) + 1.2); // a 1.2 m bush
        surface.set(2, 2, ground.get(2, 2) + 0.2); // tall grass
        surface.set(3, 3, f32::NAN); // no surface data
        let mut blocked = NOTHING_BLOCKED;
        mark_obstacles(&mut blocked, &ground, &surface, 0.5);
        assert_eq!(blocked[5 * 10 + 5], 1);
        assert_eq!(blocked[3 * 10 + 3], 1);
        assert_eq!(blocked.iter().map(|&b| b as u32).sum::<u32>(), 2);
    }

    #[test]
    fn low_shore_is_blocked_but_a_terrace_is_not() {
        // A lake on the left (x < 3) at 900.0 m; flat shore at 900.1 m, and
        // a terrace from x = 6 at 901 m.
        let mut ground = Grid::filled(10, 10, 900.1);
        let mut water = NOTHING_BLOCKED;
        for y in 0..10 {
            for x in 0..10 {
                if x < 3 {
                    ground.set(x, y, 900.0);
                    water[y * 10 + x] = 1;
                } else if x >= 6 {
                    ground.set(x, y, 901.0);
                }
            }
        }
        let mut blocked = NOTHING_BLOCKED;
        mark_low_shore(&mut blocked, &ground, &water, 5, 0.5);
        assert_eq!(blocked[5 * 10 + 4], 1, "0.1 m above the lake");
        assert_eq!(blocked[5 * 10 + 7], 0, "1 m above the lake");
        // Beyond the reach, nothing is blocked.
        let mut blocked = NOTHING_BLOCKED;
        mark_low_shore(&mut blocked, &ground, &water, 1, 0.5);
        assert_eq!(blocked[5 * 10 + 5], 0);
    }

    #[test]
    fn interpolated_water_is_smooth_but_ground_is_not() {
        let mut blocked = NOTHING_BLOCKED;
        mark_smooth(&mut blocked, &tilted_plane(10, 0.02), 0.001);
        assert_eq!(blocked[5 * 10 + 5], 1, "a perfect plane");
        // Ground: a few centimetres of unevenness.
        let mut ground = tilted_plane(10, 0.02);
        for y in 0..10 {
            for x in 0..10 {
                ground.set(x, y, ground.get(x, y) + 0.03 * ((x * 7 + y * 3) % 5) as f32);
            }
        }
        let mut blocked = NOTHING_BLOCKED;
        mark_smooth(&mut blocked, &ground, 0.001);
        assert!(blocked.iter().all(|&b| b == 0));
    }

    #[test]
    fn missing_data_is_unusable() {
        let mut elevation = tilted_plane(10, 0.02);
        elevation.set(5, 5, f32::NAN);
        let cost = pixel_cost(&elevation, &NOTHING_BLOCKED, 0.1);
        assert_eq!(cost.get(4, 4), f32::INFINITY);
        assert!(cost.get(2, 2).is_finite());
    }
}
