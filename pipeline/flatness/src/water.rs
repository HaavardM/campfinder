//! Water masks for tiles, burnt from N50's lake, river and sea polygons.
//!
//! The terrain model alone can't tell a calm lake from flat ground (some
//! lakes are flattened to one exact height, others aren't), so water comes
//! from Kartverket's N50 map data: `prepare_water.sh` turns each county's
//! N50 into a small GeoPackage of water polygons, read here with terrio
//! (pure Rust, no GDAL needed).

use std::path::Path;

use terrio::crs::SpatialRef;
use terrio::ops::rasterize::{Grid, RasterizeOptions, rasterize};
use terrio::vector::BBox;
use terrio::{DataType, Feature, Layer};

/// All water polygons of the regions being processed, in memory. Read once
/// and shared by every processing thread (it's only ever read).
pub struct Water {
    polygons: Vec<Feature>,
    /// Each polygon's bounding box, so a tile can find the polygons near it
    /// with a few comparisons instead of looking at their shapes.
    boxes: Vec<BBox>,
    utm33: SpatialRef,
}

impl Water {
    /// Loads the water polygons from the given GeoPackages (one per county,
    /// made by `prepare_water.sh`), keeping only those that touch `area`
    /// (west, south, east, north): a county is far bigger than a region.
    pub fn load(
        gpkgs: &[impl AsRef<Path>],
        area: (f64, f64, f64, f64),
    ) -> Result<Water, String> {
        let (mut polygons, mut boxes) = (Vec::new(), Vec::new());
        for gpkg in gpkgs {
            let path = gpkg.as_ref().display().to_string();
            let dataset = terrio::open_vector(&path, &Default::default())
                .map_err(|e| format!("{path}: {e}"))?;
            for polygon in dataset.layers.into_iter().flat_map(|l| l.features) {
                let Some(b) = polygon.geometry.as_ref().and_then(|g| g.bbox()) else {
                    continue;
                };
                if overlaps(&b, area) {
                    polygons.push(polygon);
                    boxes.push(b);
                }
            }
        }
        Ok(Water {
            polygons,
            boxes,
            utm33: SpatialRef::from_epsg(25833).map_err(|e| e.to_string())?,
        })
    }

    pub fn polygon_count(&self) -> usize {
        self.polygons.len()
    }

    /// A `size` × `size` grid of 1 m pixels with its top-left corner at
    /// (west, north) in EPSG:25833: 1 where water touches the pixel, 0
    /// elsewhere.
    pub fn mask(&self, west: f64, north: f64, size: usize) -> Result<Vec<u8>, String> {
        let tile = (west, north - size as f64, west + size as f64, north);
        let mut near = Layer::new("water");
        near.features = self
            .polygons
            .iter()
            .zip(&self.boxes)
            .filter(|(_, b)| overlaps(b, tile))
            .map(|(polygon, _)| polygon.clone())
            .collect();

        let options = RasterizeOptions {
            burn_values: vec![1.0],
            // The tile's pixel grid. Geotransform: x = west + col · 1 m,
            // y = north − row · 1 m.
            grid: Some(Grid {
                geo_transform: [west, 1.0, 0.0, north, 0.0, -1.0],
                cols: size,
                rows: size,
                crs: self.utm33.clone(),
            }),
            data_type: Some(DataType::U8),
            // Every pixel a polygon touches, not just those whose centre is
            // inside: better to lose a metre of shore than to pitch a tent
            // in a lake.
            all_touched: true,
            ..Default::default()
        };
        let raster = rasterize(&[near], &options).map_err(|e| e.to_string())?;
        raster
            .raster
            .data_u8()
            .map(|pixels| pixels.to_vec())
            .ok_or_else(|| "water mask is not 8-bit".to_string())
    }
}

/// Does a polygon's bounding box overlap the box (west, south, east, north)?
fn overlaps(b: &BBox, (west, south, east, north): (f64, f64, f64, f64)) -> bool {
    b.max_x >= west && b.min_x <= east && b.max_y >= south && b.min_y <= north
}
