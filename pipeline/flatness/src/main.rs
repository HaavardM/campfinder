//! Command line: process every downloaded terrain tile that is missing
//! results, in parallel.
//!
//!   flatness --tents tents.toml --dtm-dir data/dtm --water-dir data/water
//!            --out-dir data/flatness [--threads N] [--max-roughness-m 0.1] [--force]

mod progress;

use std::path::{Path, PathBuf};
use std::process::exit;
use std::time::Instant;

use flatness::geotiff::{self, Georef, write_atomic};
use flatness::tents::{Footprint, Shape, Tent, TentsFile};
use flatness::terrain::pixel_cost;
use flatness::tile::{
    BUFFER_M, CELL_SIZE_M, CELLS_PER_SIDE, CellResult, DTM_SIZE_PX, TILE_SIZE_M, best_placement,
    cell_elevation, summarise,
};
use progress::{Progress, minutes_seconds};
use rayon::prelude::*;

const USAGE: &str = "usage: flatness --tents FILE --dtm-dir DIR --water-dir DIR --out-dir DIR \
                     [--threads N] [--max-roughness-m M] [--force]";

struct Args {
    tents: PathBuf,
    dtm_dir: PathBuf,
    water_dir: PathBuf,
    out_dir: PathBuf,
    threads: Option<usize>,
    max_roughness_m: f32,
    force: bool,
}

/// One tile and the work it still needs.
struct Job {
    name: String,
    east: u32,
    north: u32,
    dtm: PathBuf,
    tents: Vec<usize>,
    needs_elevation: bool,
}

fn main() {
    let args = parse_args().unwrap_or_else(|error| {
        eprintln!("{error}\n{USAGE}");
        exit(2);
    });
    let config: TentsFile = std::fs::read_to_string(&args.tents)
        .map_err(|e| e.to_string())
        .and_then(|text| toml::from_str(&text).map_err(|e| e.to_string()))
        .unwrap_or_else(|error| {
            eprintln!("{}: {error}", args.tents.display());
            exit(2);
        });
    let footprints: Vec<Footprint> = config
        .tents
        .iter()
        .map(|t| Footprint::of(t, config.clearance_m))
        .collect();
    for (tent, footprint) in config.tents.iter().zip(&footprints) {
        // +1 for the slope calculation's own 3×3 neighbourhood, +1 for the
        // 2×2 sampling when rotating.
        if footprint.reach() + 2.0 > BUFFER_M as f32 {
            eprintln!(
                "{} is too large for the {BUFFER_M} m tile border",
                tent.name
            );
            exit(2);
        }
    }

    // Tent names for the database, so the app can show "Keron 4 GT" rather
    // than the file-name slug.
    let mut tents_csv = String::from("slug,name\n");
    for tent in &config.tents {
        tents_csv += &format!("{},\"{}\"\n", tent.slug(), tent.name.replace('"', "\"\""));
    }
    if let Err(error) = std::fs::create_dir_all(&args.out_dir)
        .map_err(|e| format!("{}: {e}", args.out_dir.display()))
        .and_then(|_| write_atomic(&args.out_dir.join("tents.csv"), tents_csv.as_bytes()))
    {
        eprintln!("{error}");
        exit(2);
    }

    let jobs = find_jobs(&args, &config, &footprints).unwrap_or_else(|error| {
        eprintln!("{error}");
        exit(2);
    });
    if jobs.is_empty() {
        println!("Nothing to do: every tile is up to date.");
        return;
    }
    if let Some(threads) = args.threads {
        rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build_global()
            .unwrap();
    }
    println!(
        "{} tiles to process on {} threads",
        jobs.len(),
        rayon::current_num_threads()
    );

    // Tiles are independent, so each thread takes whole tiles. rayon's work
    // stealing keeps every thread busy even when some tiles take longer.
    // A separate reporter thread prints which threads are busy meanwhile.
    let started = Instant::now();
    let progress = Progress::new(jobs.len(), rayon::current_num_threads());
    let failures: Vec<String> = std::thread::scope(|scope| {
        scope.spawn(|| progress.report_until_finished());
        let failures = jobs
            .par_iter()
            .filter_map(|job| {
                progress
                    .track(|| process(job, &args, &config, &footprints))
                    .err()
            })
            .collect();
        progress.finish();
        failures
    });

    let seconds = started.elapsed().as_secs_f64();
    let megapixels = jobs.len() as f64 * (DTM_SIZE_PX * DTM_SIZE_PX) as f64 / 1e6;
    println!(
        "Done: {} tiles in {} ({:.2} s per tile, {:.0} Mpx/s across all threads)",
        jobs.len(),
        minutes_seconds(seconds),
        seconds / jobs.len() as f64,
        megapixels / seconds
    );
    progress.print_summary();
    if !failures.is_empty() {
        eprintln!("{} tiles failed:", failures.len());
        for failure in failures {
            eprintln!("  {failure}");
        }
        exit(1);
    }
}

/// Processes one tile and returns a one-line report of how it went.
fn process(
    job: &Job,
    args: &Args,
    config: &TentsFile,
    footprints: &[Footprint],
) -> Result<String, String> {
    let started = Instant::now();
    let elevation = geotiff::read_f32(&job.dtm, DTM_SIZE_PX)?;
    let water = geotiff::read_u8(
        &args.water_dir.join(format!("{}.tif", job.name)),
        DTM_SIZE_PX,
    )?;
    let out_dir = args.out_dir.join(&job.name);
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    // Results cover the tile without its border, in 10 m cells.
    let at = Georef {
        west: job.east as f64,
        north: (job.north as usize + TILE_SIZE_M) as f64,
        pixel_size: CELL_SIZE_M as f64,
    };
    let n = CELLS_PER_SIDE;

    let cell_heights = cell_elevation(&elevation);
    if job.needs_elevation {
        geotiff::write_f32(&out_dir.join(ELEVATION_FILE), n, n, &cell_heights, &at)?;
    }
    let cost = pixel_cost(&elevation, &water, args.max_roughness_m);
    for &t in &job.tents {
        let tent = &config.tents[t];
        let cells = summarise(&best_placement(&cost, &footprints[t]));
        let file = |kind: &str| out_dir.join(format!("{}.{kind}", tent.slug()));
        write_cells_csv(&file("cells.csv"), job, &tent.slug(), &cells, &cell_heights)?;
        geotiff::write_f32(&file("slope.tif"), n, n, &cells.max_slope, &at)?;
        if let Shape::Rectangle { .. } = tent.shape {
            geotiff::write_i16(&file("heading.tif"), n, n, &cells.heading, &at)?;
        }
        // Written last: marks this tent as done, with these settings.
        let settings = settings_used(&footprints[t], args.max_roughness_m);
        write_atomic(&done_path(&out_dir, tent), settings.as_bytes())?;
    }

    let seconds = started.elapsed().as_secs_f64();
    let megapixels = (DTM_SIZE_PX * DTM_SIZE_PX) as f64 / 1e6;
    Ok(format!(
        "{}  {} tent(s)  {seconds:.2} s  {:.1} Mpx/s",
        job.name,
        job.tents.len(),
        megapixels / seconds
    ))
}

/// Cells flatter than this are written to the CSV for the database. Steeper
/// ones are useless for a tent and would only make the tables bigger.
const MAX_STORED_SLOPE_DEG: f32 = 10.0;

/// One row per usable 10 m cell, ready for Postgres `COPY`:
/// tent, x, y (south-west corner, EPSG:25833), slope, heading, elevation.
fn write_cells_csv(
    path: &Path,
    job: &Job,
    tent: &str,
    cells: &CellResult,
    elevation: &[f32],
) -> Result<(), String> {
    use std::fmt::Write;
    let mut csv = String::from("tent,x,y,max_slope_deg,heading_deg,elevation_m\n");
    for row in 0..CELLS_PER_SIDE {
        for col in 0..CELLS_PER_SIDE {
            let i = row * CELLS_PER_SIDE + col;
            let slope = cells.max_slope[i];
            if slope.is_nan() || slope > MAX_STORED_SLOPE_DEG {
                continue; // nothing fits, or too steep
            }
            // Row 0 is the northern edge of the tile.
            let x = job.east as usize + col * CELL_SIZE_M;
            let y = job.north as usize + TILE_SIZE_M - (row + 1) * CELL_SIZE_M;
            let heading = match cells.heading[i] {
                -1 => String::new(), // empty = NULL: round tent
                h => h.to_string(),
            };
            let height = elevation[i];
            writeln!(csv, "{tent},{x},{y},{slope:.2},{heading},{height:.1}").unwrap();
        }
    }
    write_atomic(path, csv.as_bytes())
}

const ELEVATION_FILE: &str = "elevation.tif";

/// The file marking a tent as done for a tile. It holds the settings the
/// result was computed with, so changing a tent's size or the roughness
/// limit makes the tile count as not done.
fn done_path(out_dir: &Path, tent: &Tent) -> PathBuf {
    out_dir.join(format!("{}.done", tent.slug()))
}

fn settings_used(footprint: &Footprint, max_roughness_m: f32) -> String {
    format!("{footprint:?} max_roughness_m={max_roughness_m}\n")
}

/// Every terrain tile in `dtm_dir` (named like `E0220000_N6864000.tif`) that
/// lacks an up-to-date result for some tent, or `--force` for all of them.
fn find_jobs(
    args: &Args,
    config: &TentsFile,
    footprints: &[Footprint],
) -> Result<Vec<Job>, String> {
    let entries =
        std::fs::read_dir(&args.dtm_dir).map_err(|e| format!("{}: {e}", args.dtm_dir.display()))?;
    let mut jobs = Vec::new();
    for entry in entries {
        let path = entry.map_err(|e| e.to_string())?.path();
        let Some((name, east, north)) = parse_tile_name(&path) else {
            continue;
        };
        let out_dir = args.out_dir.join(&name);
        let tents: Vec<usize> = (0..config.tents.len())
            .filter(|&t| {
                let done = std::fs::read_to_string(done_path(&out_dir, &config.tents[t]));
                let wanted = settings_used(&footprints[t], args.max_roughness_m);
                args.force || done.ok() != Some(wanted)
            })
            .collect();
        let needs_elevation = args.force || !out_dir.join(ELEVATION_FILE).exists();
        if !tents.is_empty() || needs_elevation {
            jobs.push(Job {
                name,
                east,
                north,
                dtm: path,
                tents,
                needs_elevation,
            });
        }
    }
    jobs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(jobs)
}

/// "E0220000_N6864000.tif" → ("E0220000_N6864000", 220000, 6864000)
fn parse_tile_name(path: &Path) -> Option<(String, u32, u32)> {
    if path.extension()? != "tif" {
        return None;
    }
    let name = path.file_stem()?.to_str()?.to_string();
    let (e, n) = name.strip_prefix('E')?.split_once("_N")?;
    let (east, north) = (e.parse().ok()?, n.parse().ok()?);
    Some((name, east, north))
}

fn parse_args() -> Result<Args, String> {
    let mut tents = None;
    let mut dtm_dir = None;
    let mut water_dir = None;
    let mut out_dir = None;
    let mut threads = None;
    let mut max_roughness_m = 0.1;
    let mut force = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut value = || args.next().ok_or(format!("{arg} needs a value"));
        match arg.as_str() {
            "--tents" => tents = Some(PathBuf::from(value()?)),
            "--dtm-dir" => dtm_dir = Some(PathBuf::from(value()?)),
            "--water-dir" => water_dir = Some(PathBuf::from(value()?)),
            "--out-dir" => out_dir = Some(PathBuf::from(value()?)),
            "--threads" => {
                threads = Some(value()?.parse().map_err(|_| "--threads must be a number")?)
            }
            "--max-roughness-m" => {
                max_roughness_m = value()?
                    .parse()
                    .map_err(|_| "--max-roughness-m must be a number")?
            }
            "--force" => force = true,
            other => return Err(format!("unknown argument {other}")),
        }
    }
    Ok(Args {
        tents: tents.ok_or("--tents is required")?,
        dtm_dir: dtm_dir.ok_or("--dtm-dir is required")?,
        water_dir: water_dir.ok_or("--water-dir is required")?,
        out_dir: out_dir.ok_or("--out-dir is required")?,
        threads,
        max_roughness_m,
        force,
    })
}
