//! Times each step of processing one tile, on one thread, and compares the
//! fast sliding max with the naive one.
//!
//!   cargo run --release --example bench -- ../data/dtm/E0220000_N6864000.tif

use std::path::Path;
use std::time::Instant;

use flatness::geotiff::read_f32;
use flatness::rotate::rotate;
use flatness::sliding_max::{rect_max, rect_max_naive};
use flatness::tents::Footprint;
use flatness::terrain::pixel_cost;
use flatness::tile::{DTM_SIZE_PX, best_placement};

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: bench <terrain tile .tif>");
    let elevation = read_f32(Path::new(&path), DTM_SIZE_PX).unwrap();
    let megapixels = elevation.data.len() as f64 / 1e6;
    let no_water = vec![0u8; elevation.data.len()];
    println!("{path}: {}×{} pixels\n", elevation.width, elevation.height);

    let cost = time("pixel_cost (slope, roughness)", megapixels, || {
        pixel_cost(&elevation, &no_water, 0.1)
    });

    for (w, h) in [(3, 6), (6, 6), (12, 12), (24, 24)] {
        let fast = time(&format!("rect_max {w}×{h}"), megapixels, || {
            rect_max(&cost, w, h)
        });
        let naive = time(&format!("rect_max_naive {w}×{h}"), megapixels, || {
            rect_max_naive(&cost, w, h)
        });
        assert_eq!(fast, naive);
    }

    time("rotate 45°", megapixels, || rotate(&cost, 45.0));
    let keron = Footprint::Rectangle {
        width: 3,
        length: 6,
    };
    let gamme = Footprint::Round {
        rectangles: vec![(5, 3), (3, 5)],
    };
    time("best_placement Keron (12 headings)", megapixels, || {
        best_placement(&cost, &keron)
    });
    time("best_placement Gamme (round)", megapixels, || {
        best_placement(&cost, &gamme)
    });
}

fn time<T>(label: &str, megapixels: f64, f: impl FnOnce() -> T) -> T {
    let started = Instant::now();
    let result = f();
    let seconds = started.elapsed().as_secs_f64();
    println!(
        "{label:<38} {:>8.1} ms {:>8.0} Mpx/s",
        seconds * 1000.0,
        megapixels / seconds
    );
    result
}
