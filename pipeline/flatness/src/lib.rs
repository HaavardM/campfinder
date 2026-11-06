//! Finds flat ground for tents in a 1 m terrain model.
//!
//! The steps for one tile, in order:
//!
//! 1. `geotiff::read_f32`: read the elevation tile.
//! 2. `terrain::pixel_cost`: slope per pixel; infinity for unusable pixels.
//! 3. `tile::best_placement`: steepest pixel under each tent placement, best
//!    heading per pixel (`sliding_max` and `rotate` do the heavy lifting).
//! 4. `tile::summarise`: best placement per 10 m cell, written as GeoTIFF.

pub mod geotiff;
pub mod grid;
pub mod rotate;
pub mod sliding_max;
pub mod tents;
pub mod terrain;
pub mod tile;

#[cfg(test)]
mod test_util;
