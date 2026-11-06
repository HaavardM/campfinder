//! Finds flat ground for tents in a 1 m terrain model.
//!
//! The steps for one tile, in order:
//!
//! 1. `download::tile`, `geotiff::read_f32`: get the terrain and surface
//!    tiles;
//!    `no_go::NoGo::mask` and `terrain::mark_obstacles`: which of its
//!    pixels are no-go (water, bogs, near houses; from N50) or have
//!    something standing on them (bushes, trees; from the surface model).
//! 2. `terrain::pixel_cost`: slope per pixel; infinity for unusable pixels.
//! 3. `tile::best_placement`: steepest pixel under each tent placement, best
//!    heading per pixel (`sliding_max` and `rotate` do the heavy lifting).
//! 4. `tile::summarise`: best placement per 10 m cell, written as GeoTIFF.

pub mod download;
pub mod geotiff;
pub mod grid;
pub mod no_go;
pub mod region;
pub mod rotate;
pub mod sliding_max;
pub mod tents;
pub mod terrain;
pub mod tile;

#[cfg(test)]
mod test_util;
