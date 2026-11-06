//! Finds flat ground for tents in a 1 m terrain model.
//!
//! The steps for one tile, in order:
//!
//! 1. `download::terrain_tile`, `geotiff::read_f32`: get the elevation tile;
//!    `water::Water::mask`: which of its pixels are water (from N50).
//! 2. `terrain::pixel_cost`: slope per pixel; infinity for unusable pixels.
//! 3. `tile::best_placement`: steepest pixel under each tent placement, best
//!    heading per pixel (`sliding_max` and `rotate` do the heavy lifting).
//! 4. `tile::summarise`: best placement per 10 m cell, written as GeoTIFF.

pub mod download;
pub mod geotiff;
pub mod grid;
pub mod region;
pub mod rotate;
pub mod sliding_max;
pub mod tents;
pub mod terrain;
pub mod tile;
pub mod water;

#[cfg(test)]
mod test_util;
