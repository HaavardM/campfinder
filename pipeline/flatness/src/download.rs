//! Downloads terrain tiles from Kartverket.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::geotiff;
use crate::tile::{DTM_SIZE_PX, bordered_box};

/// Kartverket's terrain model as a Web Coverage Service: ask for any box and
/// pixel count, get a GeoTIFF back.
const TERRAIN_WCS: &str = "https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833";

/// Downloads one tile's terrain (the tile plus its border, 1 m pixels) to
/// `path`, and returns a one-line report.
pub fn terrain_tile(east: u32, north: u32, path: &Path) -> Result<String, String> {
    let (w, s, e, n) = bordered_box(east, north);
    let url = format!(
        "{TERRAIN_WCS}?SERVICE=WCS&VERSION=1.0.0&REQUEST=GetCoverage&COVERAGE=nhm_dtm_topo_25833\
         &CRS=EPSG:25833&FORMAT=GeoTIFF&BBOX={w},{s},{e},{n}&WIDTH={DTM_SIZE_PX}&HEIGHT={DTM_SIZE_PX}"
    );
    let started = Instant::now();
    let bytes = download(&url, path)?;
    let seconds = started.elapsed().as_secs_f64();
    let megabytes = bytes as f64 / 1e6;
    Ok(format!(
        "{megabytes:.1} MB in {seconds:.1} s ({:.1} MB/s)",
        megabytes / seconds
    ))
}

/// Streams a terrain tile from `url` into `path` (through a temporary file,
/// so an interrupted download never looks finished). Retries a few times,
/// waiting longer each time. Returns the size in bytes.
fn download(url: &str, path: &Path) -> Result<u64, String> {
    // Unique per process, so two runs fetching the same file can't clash.
    let part: PathBuf = path.with_extension(format!("{}.part", std::process::id()));
    let mut last_error = String::new();
    for wait_s in [0, 5, 20, 60] {
        std::thread::sleep(Duration::from_secs(wait_s));
        let attempt = || -> Result<u64, String> {
            let mut response = ureq::get(url).call().map_err(|e| e.to_string())?;
            let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
            let bytes = std::io::copy(&mut response.body_mut().as_reader(), &mut file)
                .map_err(|e| e.to_string())?;
            // Errors can come back empty or as XML with status 200, so only
            // keep a file whose header says it's a terrain tile.
            geotiff::check_f32(&part, DTM_SIZE_PX)?;
            std::fs::rename(&part, path).map_err(|e| e.to_string())?;
            Ok(bytes)
        };
        match attempt() {
            Ok(bytes) => return Ok(bytes),
            Err(error) => last_error = error,
        }
    }
    let _ = std::fs::remove_file(&part);
    Err(format!("{}: download failed: {last_error}", path.display()))
}
