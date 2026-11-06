//! Compresses already downloaded elevation tiles in place, without loss
//! (the engine now stores new downloads that way; see
//! `geotiff::write_f32_compressed`). Skips files that are already
//! compressed, so it's safe to rerun, and safe to run next to the engine:
//! each file is replaced in one atomic rename.
//!
//!   cargo run --release --example compress_tiles -- ../data/dtm ../data/dom

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering::Relaxed};

use flatness::geotiff;
use flatness::region::parse_tile_name;
use flatness::tile::{DTM_SIZE_PX, bordered_georef};
use rayon::prelude::*;

fn main() {
    let mut files: Vec<PathBuf> = Vec::new();
    for dir in std::env::args().skip(1) {
        for entry in std::fs::read_dir(&dir).unwrap_or_else(|e| panic!("{dir}: {e}")) {
            let path = entry.unwrap().path();
            // Only finished tiles: "E0220000_N6864000.tif", not ".part" files.
            if path.extension().is_some_and(|e| e == "tif") {
                files.push(path);
            }
        }
    }
    let (before, after, done) = (AtomicU64::new(0), AtomicU64::new(0), AtomicUsize::new(0));
    files.par_iter().for_each(|path| {
        match compress(path) {
            Ok(Some((old, new))) => {
                before.fetch_add(old, Relaxed);
                after.fetch_add(new, Relaxed);
            }
            Ok(None) => {} // already compressed
            Err(error) => eprintln!("{}: {error}", path.display()),
        }
        let n = done.fetch_add(1, Relaxed) + 1;
        if n % 100 == 0 || n == files.len() {
            let (b, a) = (before.load(Relaxed) as f64 / 1e9, after.load(Relaxed) as f64 / 1e9);
            println!("[{n}/{}] {b:.1} GB → {a:.1} GB so far", files.len());
        }
    });
}

/// Compresses one tile, unless it already is. Returns its size in bytes
/// before and after.
fn compress(path: &Path) -> Result<Option<(u64, u64)>, String> {
    if geotiff::is_compressed(path, DTM_SIZE_PX)? {
        return Ok(None);
    }
    let name = path.file_stem().unwrap_or_default().to_string_lossy();
    let (east, north) = parse_tile_name(&name).ok_or("not a tile name")?;
    let size = |path: &Path| std::fs::metadata(path).map(|m| m.len()).map_err(|e| e.to_string());
    let before = size(path)?;
    let tile = geotiff::read_f32(path, DTM_SIZE_PX)?;
    geotiff::write_f32_compressed(path, &tile, &bordered_georef(east, north))?;
    Ok(Some((before, size(path)?)))
}
