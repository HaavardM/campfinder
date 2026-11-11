//! No-go masks for tiles: where a tent may not go, burnt from polygons out
//! of Kartverket's N50 map data.
//!
//! Some things the terrain model can't see, or can't tell from flat ground:
//! a calm lake, a bog, a small stream, a cabin's 150 m of privacy, a field.
//! `prepare_no_go.sh` collects them from N50 into a GeoPackage of polygons
//! per region, read here with terrio (pure Rust, no GDAL needed).

use std::path::Path;

use terrio::crs::SpatialRef;
use terrio::ops::rasterize::{Grid, RasterizeOptions, rasterize};
use terrio::vector::BBox;
use terrio::{DataType, Feature, Layer};

/// All no-go polygons of the regions being processed, in memory. Read once
/// and shared by every processing thread (it's only ever read).
pub struct NoGo {
    polygons: Vec<Feature>,
    /// Each polygon's class: "water", "lake", "near_stream", "summer" or
    /// "always" (see prepare_no_go.sh).
    classes: Vec<String>,
    /// Each polygon's bounding box, so a tile can find the polygons near it
    /// with a few comparisons instead of looking at their shapes.
    boxes: Vec<BBox>,
    utm33: SpatialRef,
}

impl NoGo {
    /// Loads the polygons from the given GeoPackages (one per region, made by
    /// `prepare_no_go.sh`, which already cuts them to the region).
    pub fn load(gpkgs: &[impl AsRef<Path>]) -> Result<NoGo, String> {
        let (mut polygons, mut classes, mut boxes) = (Vec::new(), Vec::new(), Vec::new());
        for gpkg in gpkgs {
            let path = gpkg.as_ref().display().to_string();
            let dataset = terrio::open_vector(&path, &Default::default())
                .map_err(|e| format!("{path}: {e}"))?;
            for layer in dataset.layers {
                for polygon in layer.features {
                    let class = polygon.get(&layer.schema, "class").ok().and_then(|v| v.as_str());
                    let class = class.unwrap_or_default().to_string();
                    if let Some(b) = polygon.geometry.as_ref().and_then(|g| g.bbox()) {
                        polygons.push(polygon);
                        classes.push(class);
                        boxes.push(b);
                    }
                }
            }
        }
        Ok(NoGo {
            polygons,
            classes,
            boxes,
            utm33: SpatialRef::from_epsg(25833).map_err(|e| e.to_string())?,
        })
    }

    /// How many polygons have a class that passes `keep`.
    pub fn count(&self, keep: impl Fn(&str) -> bool) -> usize {
        self.classes.iter().filter(|c| keep(c)).count()
    }

    /// A `size` × `size` grid of 1 m pixels with its top-left corner at
    /// (west, north) in EPSG:25833: 1 where a no-go polygon whose class
    /// passes `keep` touches the pixel, 0 elsewhere.
    pub fn mask(
        &self,
        west: f64,
        north: f64,
        size: usize,
        keep: impl Fn(&str) -> bool,
    ) -> Result<Vec<u8>, String> {
        let tile = (west, north - size as f64, west + size as f64, north);
        let mut near = Layer::new("no_go");
        near.features = (0..self.polygons.len())
            .filter(|&i| keep(&self.classes[i]) && overlaps(&self.boxes[i], tile))
            .map(|i| self.polygons[i].clone())
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
            // in a lake or a bog.
            all_touched: true,
            ..Default::default()
        };
        let raster = rasterize(&[near], &options).map_err(|e| e.to_string())?;
        raster
            .raster
            .data_u8()
            .map(|pixels| pixels.to_vec())
            .ok_or_else(|| "no-go mask is not 8-bit".to_string())
    }
}

/// Does a polygon's bounding box overlap the box (west, south, east, north)?
fn overlaps(b: &BBox, (west, south, east, north): (f64, f64, f64, f64)) -> bool {
    b.max_x >= west && b.min_x <= east && b.max_y >= south && b.min_y <= north
}
