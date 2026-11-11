//! Finds downloaded tiles with garbage heights, from before the engine read
//! the pieces of a tile Kartverket leaves out (sea, lakes in the surface
//! model, Sweden) as missing data. Those pieces are 128 × 128 blocks, and
//! came out as zeros, garbage up to about 1e38 m, or a mix; only a fresh
//! download tells which pixels were real. A tile is flagged if it has an
//! impossible height or a block of exact zeros, which real heights never
//! are (empty blocks read as zeros elsewhere, as in GDAL).
//!
//! Lists them; with --delete, also deletes them and their results, so the
//! next run downloads and processes them again.
//!
//!   cargo run --release --example find_garbled_tiles -- ../data [--delete]

use std::path::Path;

use flatness::download::Model;
use flatness::geotiff;
use flatness::grid::Grid;
use flatness::tile::DTM_SIZE_PX;
use rayon::prelude::*;

/// Higher or deeper than anything in Norway, by far: Galdhøpiggen is 2469 m.
const IMPOSSIBLE_M: f32 = 10_000.0;
/// The size of the blocks Kartverket's GeoTIFFs come in.
const BLOCK_PX: usize = 128;

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
            Ok(tile) => {
                tile.data.iter().any(|v| v.abs() > IMPOSSIBLE_M) || has_zero_block(&tile)
            }
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

/// Does any of the tile's 128 × 128 blocks hold nothing but exact zeros?
fn has_zero_block(tile: &Grid) -> bool {
    (0..tile.height).step_by(BLOCK_PX).any(|top| {
        (0..tile.width).step_by(BLOCK_PX).any(|left| {
            (top..(top + BLOCK_PX).min(tile.height)).all(|y| {
                (left..(left + BLOCK_PX).min(tile.width)).all(|x| tile.get(x, y) == 0.0)
            })
        })
    })
}
