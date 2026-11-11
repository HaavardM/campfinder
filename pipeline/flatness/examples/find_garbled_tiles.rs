//! Finds downloaded tiles with garbage heights, from before the engine read
//! the pieces of a tile Kartverket leaves out (sea, and Sweden in the
//! surface model) as missing data. Those pieces came out as garbage, up to
//! about 1e38 m, in tiles along the coast and the Swedish border.
//!
//! Lists them; with --delete, also deletes them and their results, so the
//! next run downloads and processes them again.
//!
//!   cargo run --release --example find_garbled_tiles -- ../data [--delete]

use std::path::Path;

use flatness::download::Model;
use flatness::geotiff;
use flatness::tile::DTM_SIZE_PX;
use rayon::prelude::*;

/// Higher or deeper than anything in Norway, by far: Galdhøpiggen is 2469 m.
const IMPOSSIBLE_M: f32 = 10_000.0;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let data = Path::new(args.first().map_or("../data", String::as_str));
    let delete = args.iter().any(|a| a == "--delete");

    let mut files = Vec::new();
    for model in [Model::Terrain, Model::Surface] {
        let dir = data.join(model.dir());
        for entry in std::fs::read_dir(&dir).unwrap_or_else(|e| panic!("{}: {e}", dir.display())) {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|e| e == "tif") {
                files.push(path);
            }
        }
    }
    println!("checking {} tiles", files.len());

    let mut garbled: Vec<String> = files
        .par_iter()
        .filter(|path| match geotiff::read_f32(path, DTM_SIZE_PX) {
            Ok(tile) => tile.data.iter().any(|v| v.abs() > IMPOSSIBLE_M),
            Err(error) => {
                eprintln!("{error}");
                false
            }
        })
        .map(|path| path.file_stem().unwrap().to_string_lossy().into_owned())
        .collect();
    garbled.sort();
    garbled.dedup();

    for name in &garbled {
        println!("{name}");
        if delete {
            // Both downloads and the results: all of them came from garbage.
            for model in [Model::Terrain, Model::Surface] {
                let _ = std::fs::remove_file(data.join(model.dir()).join(format!("{name}.tif")));
            }
            let _ = std::fs::remove_dir_all(data.join("flatness").join(name));
        }
    }
    let action = if delete {
        "deleted"
    } else {
        "found (rerun with --delete to delete)"
    };
    println!("{} garbled tiles {action}", garbled.len());
}
