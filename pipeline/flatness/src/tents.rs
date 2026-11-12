//! Tents from `tents.toml`, and their footprints in 1 m pixels.

use serde::Deserialize;

#[derive(Deserialize)]
pub struct TentsFile {
    #[serde(rename = "tent")]
    pub tents: Vec<Tent>,
}

#[derive(Deserialize)]
pub struct Tent {
    pub name: String,
    #[serde(flatten)]
    pub shape: Shape,
}

#[derive(Deserialize)]
#[serde(tag = "shape", rename_all = "lowercase")]
pub enum Shape {
    Round { diameter_m: f32 },
    Rectangle { width_m: f32, length_m: f32 },
}

impl Tent {
    /// File-name friendly name: "Keron 4 GT" → "keron-4-gt".
    pub fn slug(&self) -> String {
        let lower = self.name.to_lowercase();
        let words: Vec<&str> = lower
            .split(|c: char| !c.is_ascii_alphanumeric())
            .filter(|w| !w.is_empty())
            .collect();
        words.join("-")
    }
}

/// The area a tent needs, in whole 1 m pixels: sizes are rounded up, so the
/// footprint is never smaller than the tent.
#[derive(Debug, PartialEq)]
pub enum Footprint {
    /// A pixelated disc, described as overlapping centred rectangles
    /// (width, height). The max over a union of shapes is the max of each
    /// shape's max, so a disc only needs fast rectangle filters.
    Round { rectangles: Vec<(usize, usize)> },
    /// Checked at every heading, so it doesn't matter which side is which.
    Rectangle { width: usize, length: usize },
}

impl Footprint {
    pub fn of(tent: &Tent) -> Footprint {
        let pixels = |metres: f32| (metres.ceil() as usize).max(1);
        match tent.shape {
            Shape::Round { diameter_m } => Footprint::Round {
                rectangles: disc_as_rectangles(pixels(diameter_m)),
            },
            Shape::Rectangle { width_m, length_m } => Footprint::Rectangle {
                width: pixels(width_m),
                length: pixels(length_m),
            },
        }
    }

    /// How far the footprint can reach from its centre pixel, in pixels, at
    /// any heading. Tiles need at least this much border.
    pub fn reach(&self) -> f32 {
        let (w, h) = match self {
            Footprint::Round { rectangles } => rectangles[0],
            Footprint::Rectangle { width, length } => (*width, *length),
        };
        ((w * w + h * h) as f32).sqrt() / 2.0
    }
}

/// A disc of `diameter` pixels as a list of centred rectangles.
///
/// Each row of the pixelated disc is a centred run of pixels. Rows get
/// narrower away from the middle, so for each distinct row width there is one
/// rectangle: that width, as tall as the band of rows at least that wide.
fn disc_as_rectangles(diameter: usize) -> Vec<(usize, usize)> {
    let radius = diameter as f32 / 2.0;
    let centre = (diameter as f32 - 1.0) / 2.0;
    let row_widths: Vec<usize> = (0..diameter)
        .map(|y| {
            let dy = y as f32 - centre;
            (0..diameter)
                .filter(|&x| {
                    let dx = x as f32 - centre;
                    dx * dx + dy * dy <= radius * radius
                })
                .count()
        })
        .collect();

    let mut widths = row_widths.clone();
    widths.sort_unstable_by(|a, b| b.cmp(a));
    widths.dedup();
    widths
        .into_iter()
        .map(|w| (w, row_widths.iter().filter(|&&rw| rw >= w).count()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tents_toml() {
        let file: TentsFile = toml::from_str(include_str!("../../tents.toml")).unwrap();
        assert_eq!(file.tents.len(), 2);
        assert_eq!(file.tents[1].slug(), "keron-4-gt");
        assert_eq!(
            Footprint::of(&file.tents[1]),
            Footprint::Rectangle {
                width: 3,
                length: 5
            }
        );
    }

    #[test]
    fn disc_rectangles_cover_exactly_the_disc() {
        // Diameter 5: rows are 3, 5, 5, 5, 3 pixels wide.
        assert_eq!(disc_as_rectangles(5), vec![(5, 3), (3, 5)]);
        assert_eq!(disc_as_rectangles(1), vec![(1, 1)]);
    }
}
