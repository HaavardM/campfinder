//! Parking lots, and how far a point is from the nearest one.
//!
//! `prepare_parking.sh` collects every parking lot in Norway from
//! OpenStreetMap into one GeoPackage of points in UTM 33 metres. mapfiles
//! measures how far each tent spot is from the nearest lot, and how much
//! flat ground each lot has around it, in straight lines. (A walk is
//! longer: rivers, slopes, bogs. Walking time is for later.)

use std::collections::HashMap;
use std::path::Path;

use terrio::{FieldValue, Geometry};

/// One parking lot, as `prepare_parking.sh` describes it.
pub struct Lot {
    /// Where it is, in UTM 33 metres.
    pub x: f64,
    pub y: f64,
    /// "node/123", "way/456" or "relation/789".
    pub osm_id: String,
    pub name: Option<String>,
    /// Tagged hiking=yes: a lot for people setting out on a hike.
    pub hiking: bool,
    /// OSM's fee tag: "yes", "no", or missing.
    pub fee: Option<String>,
}

/// All lots, with an index for "every lot within `max_m` of a point".
///
/// The index is a grid of squares as wide as `max_m`, each holding the lots
/// inside it (a spatial hash). Any lot within `max_m` of a point lies in the
/// point's own square or one of the eight around it, so a lookup looks at a
/// handful of lots instead of the tens of thousands in Norway.
pub struct Parking {
    pub lots: Vec<Lot>,
    max_m: f64,
    squares: HashMap<(i32, i32), Vec<usize>>,
}

impl Parking {
    pub fn new(lots: Vec<Lot>, max_m: f64) -> Parking {
        let mut squares: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
        for (i, lot) in lots.iter().enumerate() {
            squares.entry(square(lot.x, lot.y, max_m)).or_default().push(i);
        }
        Parking { lots, max_m, squares }
    }

    /// Every lot within `max_m` of the point: its index in `lots`, and how
    /// far it is in metres. Compares squared distances, and takes the square
    /// root only of the lots in reach.
    pub fn within(&self, x: f64, y: f64) -> impl Iterator<Item = (usize, f64)> + '_ {
        let (sx, sy) = square(x, y, self.max_m);
        let around = (-1..=1).flat_map(move |dx| (-1..=1).map(move |dy| (sx + dx, sy + dy)));
        let max_squared = self.max_m * self.max_m;
        around
            .filter_map(|key| self.squares.get(&key))
            .flatten()
            .filter_map(move |&i| {
                let (dx, dy) = (self.lots[i].x - x, self.lots[i].y - y);
                let squared = dx * dx + dy * dy;
                (squared <= max_squared).then(|| (i, squared.sqrt()))
            })
    }

    /// Distance in metres to the nearest lot, if one is within `max_m`.
    pub fn nearest_m(&self, x: f64, y: f64) -> Option<f64> {
        self.within(x, y).map(|(_, d)| d).min_by(f64::total_cmp)
    }
}

/// Reads the lots from `prepare_parking.sh`'s GeoPackage.
pub fn load_lots(gpkg: &Path) -> Result<Vec<Lot>, String> {
    let path = gpkg.display().to_string();
    let dataset =
        terrio::open_vector(&path, &Default::default()).map_err(|e| format!("{path}: {e}"))?;
    let mut lots = Vec::new();
    for layer in dataset.layers {
        for feature in layer.features {
            let Some(Geometry::Point(at)) = &feature.geometry else { continue };
            let field = |name| feature.get(&layer.schema, name).ok();
            let text = |name| field(name).and_then(FieldValue::as_str).map(str::to_string);
            lots.push(Lot {
                x: at.x,
                y: at.y,
                osm_id: text("osm_id").unwrap_or_default(),
                name: text("name"),
                hiking: field("hiking").and_then(FieldValue::as_i64) == Some(1),
                fee: text("fee"),
            });
        }
    }
    Ok(lots)
}

/// Which square of the index a point is in.
fn square(x: f64, y: f64, size: f64) -> (i32, i32) {
    ((x / size).floor() as i32, (y / size).floor() as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lot(x: f64, y: f64) -> Lot {
        Lot { x, y, osm_id: String::new(), name: None, hiking: false, fee: None }
    }

    #[test]
    fn finds_the_nearest_lot_within_reach() {
        let parking = Parking::new(vec![lot(1000.0, 1000.0), lot(1300.0, 1000.0)], 500.0);
        assert_eq!(parking.nearest_m(1250.0, 1000.0), Some(50.0));
        assert_eq!(parking.nearest_m(1000.0, 1400.0), Some(400.0));
        assert_eq!(parking.nearest_m(1000.0, 1600.0), None, "farther than 500 m");
    }

    #[test]
    fn lists_every_lot_within_reach() {
        let parking = Parking::new(vec![lot(0.0, 0.0), lot(300.0, 0.0), lot(900.0, 0.0)], 500.0);
        let mut found: Vec<usize> = parking.within(200.0, 0.0).map(|(i, _)| i).collect();
        found.sort();
        assert_eq!(found, vec![0, 1]);
    }

    #[test]
    fn looks_across_square_edges() {
        // The lot is in the square to the south-west of the point.
        let parking = Parking::new(vec![lot(499.0, 499.0)], 500.0);
        assert_eq!(parking.nearest_m(501.0, 499.0), Some(2.0));
    }
}
