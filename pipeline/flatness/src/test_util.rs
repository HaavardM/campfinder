//! Helpers shared by tests.

use crate::grid::Grid;
use crate::terrain::UNUSABLE;

/// A tiny deterministic random number generator (xorshift), so tests don't
/// need a dependency and always see the same "random" data.
pub fn next_random(seed: &mut u64) -> f32 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 7;
    *seed ^= *seed << 17;
    (*seed % 10_000) as f32 / 100.0
}

/// Random slopes from 0 to 99 tenths, with about 1 in 20 pixels
/// `UNUSABLE`, as in real cost grids.
pub fn random_grid(width: usize, height: usize, seed: &mut u64) -> Grid<u8> {
    let mut grid = Grid::filled(width, height, 0);
    for value in &mut grid.data {
        let r = next_random(seed);
        *value = if r < 5.0 { UNUSABLE } else { r as u8 };
    }
    grid
}
