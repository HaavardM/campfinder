//! Regions: named bounding boxes read from `regions/*.env`, and the 2 × 2 km
//! work tiles inside them.

use std::path::Path;

use crate::tile::TILE_SIZE_M;

pub struct Region {
    pub name: String,
    /// Bounding box in EPSG:25833 metres, on the tile grid.
    pub west: u32,
    pub south: u32,
    pub east: u32,
    pub north: u32,
    /// N50 county files with the region's water polygons, e.g. "34_Innlandet".
    pub n50_counties: Vec<String>,
}

impl Region {
    /// Reads a file of `KEY=value` lines (`#` starts a comment), e.g.
    ///
    /// ```text
    /// WEST=206000
    /// SOUTH=6850000
    /// EAST=256000
    /// NORTH=6900000
    /// N50_COUNTIES="34_Innlandet"
    /// ```
    pub fn read(path: &Path) -> Result<Region, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let value = |key: &str| -> Result<String, String> {
            text.lines()
                .filter_map(|line| line.split_once('='))
                .find(|(k, _)| k.trim() == key)
                .map(|(_, v)| v.trim().trim_matches('"').to_string())
                .ok_or(format!("{}: missing {key}", path.display()))
        };
        let number = |key: &str| -> Result<u32, String> {
            value(key)?
                .parse()
                .map_err(|_| format!("{}: {key} must be a whole number", path.display()))
        };
        Ok(Region {
            name: path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            west: number("WEST")?,
            south: number("SOUTH")?,
            east: number("EAST")?,
            north: number("NORTH")?,
            n50_counties: value("N50_COUNTIES")?
                .split_whitespace()
                .map(String::from)
                .collect(),
        })
    }

    /// South-west corners of the work tiles covering the region.
    pub fn tiles(&self) -> Vec<(u32, u32)> {
        let step = TILE_SIZE_M as u32;
        let mut tiles = Vec::new();
        for east in (self.west..self.east).step_by(step as usize) {
            for north in (self.south..self.north).step_by(step as usize) {
                tiles.push((east / step * step, north / step * step));
            }
        }
        tiles
    }
}

/// A tile's name, from its south-west corner: "E0220000_N6864000".
pub fn tile_name(east: u32, north: u32) -> String {
    format!("E{east:07}_N{north:07}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_region_file() {
        let region = Region::read(Path::new("../regions/test.env")).unwrap();
        assert_eq!(region.name, "test");
        assert_eq!(region.tiles().len(), 9);
        assert_eq!(region.n50_counties, ["34_Innlandet"]);
        assert_eq!(tile_name(220000, 6864000), "E0220000_N6864000");
    }
}
