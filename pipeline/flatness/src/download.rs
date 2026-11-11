//! Downloads elevation tiles from Kartverket.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::geotiff::{self, Georef};
use crate::tile::{DTM_SIZE_PX, bordered_box, bordered_georef};

/// Kartverket's two elevation models from the national lidar scans, both as a
/// Web Coverage Service: ask for any box and pixel count, get a GeoTIFF back.
#[derive(Clone, Copy, PartialEq)]
pub enum Model {
    /// DTM (digital terrengmodell): the bare ground, trees and buildings
    /// removed.
    Terrain,
    /// DOM (digital overflatemodell): the first surface the laser hit, so
    /// treetops, bushes and roofs.
    Surface,
}

impl Model {
    /// The folder under `data/` its tiles go in.
    pub fn dir(self) -> &'static str {
        match self {
            Model::Terrain => "dtm",
            Model::Surface => "dom",
        }
    }

    fn service_and_coverage(self) -> (&'static str, &'static str) {
        match self {
            Model::Terrain => (
                "https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833",
                "nhm_dtm_topo_25833",
            ),
            Model::Surface => (
                "https://wcs.geonorge.no/skwms1/wcs.hoyde-dom-nhm-25833",
                "nhm_dom_topo_25833",
            ),
        }
    }
}

/// Downloads one tile of a model (the tile plus its border, 1 m pixels) to
/// `path`, compressed, and returns a one-line report.
pub fn tile(model: Model, east: u32, north: u32, path: &Path) -> Result<String, String> {
    let (w, s, e, n) = bordered_box(east, north);
    let (service, coverage) = model.service_and_coverage();
    let url = format!(
        "{service}?SERVICE=WCS&VERSION=1.0.0&REQUEST=GetCoverage&COVERAGE={coverage}\
         &CRS=EPSG:25833&FORMAT=GeoTIFF&BBOX={w},{s},{e},{n}&WIDTH={DTM_SIZE_PX}&HEIGHT={DTM_SIZE_PX}"
    );
    let started = Instant::now();
    // Terrain with no land at all (open sea, deep in Sweden) isn't stored:
    // a marker says so, and the tile needs nothing more.
    let marker = (model == Model::Terrain).then(|| no_land_marker(path));
    let bytes = download(&url, path, bordered_georef(east, north), marker.as_deref())?;
    let seconds = started.elapsed().as_secs_f64();
    let megabytes = bytes as f64 / 1e6;
    let stored = match std::fs::metadata(path) {
        Ok(m) => format!("{:.1} MB stored", m.len() as f64 / 1e6),
        Err(_) => "no land".to_string(),
    };
    Ok(format!(
        "{} {megabytes:.1} MB in {seconds:.1} s ({:.1} MB/s), {stored}",
        model.dir(),
        megabytes / seconds
    ))
}

/// The file that says a tile's terrain has no land in it: "E…_N….no-land"
/// next to where the terrain tile would be.
pub fn no_land_marker(dtm: &Path) -> PathBuf {
    dtm.with_extension("no-land")
}

/// Streams an elevation tile from `url` into a temporary file, then stores it
/// compressed at `path` (see `geotiff::write_f32_compressed`), placed at
/// `at`. Kartverket sends tiles uncompressed. Retries a few times, waiting
/// longer each time. Returns the downloaded size in bytes. With
/// `no_land_marker`, a tile without a single height is not stored; that
/// (empty) file is written instead.
fn download(url: &str, path: &Path, at: Georef, no_land_marker: Option<&Path>) -> Result<u64, String> {
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
            // keep a file that reads as an elevation tile.
            let tile = geotiff::read_f32(&part, DTM_SIZE_PX)?;
            match no_land_marker {
                Some(marker) if tile.data.iter().all(|v| v.is_nan()) => {
                    std::fs::write(marker, "").map_err(|e| e.to_string())?
                }
                _ => geotiff::write_f32_compressed(path, &tile, &at)?,
            }
            std::fs::remove_file(&part).map_err(|e| e.to_string())?;
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
