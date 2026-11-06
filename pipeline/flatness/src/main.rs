//! Command line: the whole pipeline for some regions, from download to
//! results.
//!
//!   flatness [options] regions/rondane.env regions/dovre.env
//!
//! 1. Loads the regions' water polygons (prepared per county by
//!    `prepare_water.sh`).
//! 2. Downloads the terrain tiles not on disk yet, a few at a time, and
//!    processes every tile as soon as it's there. Downloading is the slow
//!    part, so the CPUs keep up with the downloads.
//! 3. Writes per tile: GeoTIFFs for QGIS and a CSV for the database.
//!
//! Reruns only do what's missing: finished tiles are skipped, downloaded
//! ones reused.

mod progress;

use std::collections::{BTreeSet, VecDeque};
use std::path::{Path, PathBuf};
use std::process::exit;
use std::sync::Mutex;
use std::sync::mpsc;

use flatness::download;
use flatness::geotiff::{self, Georef, write_atomic};
use flatness::region::{Region, tile_name};
use flatness::tents::{Footprint, Shape, Tent, TentsFile};
use flatness::terrain::pixel_cost;
use flatness::tile::{
    BUFFER_M, CELL_SIZE_M, CELLS_PER_SIDE, CellResult, DTM_SIZE_PX, TILE_SIZE_M, best_placement,
    cell_elevation, summarise,
};
use flatness::water::Water;
use progress::{Progress, minutes_seconds};
use rayon::iter::{ParallelBridge, ParallelIterator};

const USAGE: &str = "usage: flatness [--tents tents.toml] [--data data] [--threads N] \
                     [--downloads 4] [--max-roughness-m 0.1] [--force] REGION.env ...";

struct Args {
    regions: Vec<PathBuf>,
    tents: PathBuf,
    data: PathBuf,
    threads: Option<usize>,
    downloads: usize,
    max_roughness_m: f32,
    force: bool,
}

/// What everything needs to know: settings, tents, and where things are.
struct Setup {
    args: Args,
    config: TentsFile,
    footprints: Vec<Footprint>,
    /// The regions' water polygons.
    water: Water,
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
    let setup = prepare().unwrap_or_else(|error| {
        eprintln!("{error}");
        exit(2);
    });

    // Every tile of every region, each once (regions may overlap).
    let mut tiles = BTreeSet::new();
    for path in &setup.args.regions {
        let region = Region::read(path).unwrap_or_else(|error| {
            eprintln!("{error}");
            exit(2);
        });
        tiles.extend(region.tiles());
    }
    let mut on_disk = Vec::new();
    let mut to_download = VecDeque::new();
    let mut done = 0;
    for (east, north) in tiles {
        match plan(&setup, east, north) {
            None => done += 1,
            Some(job) if job.dtm.exists() => on_disk.push(job),
            Some(job) => to_download.push_back(job),
        }
    }
    println!(
        "{} tiles: {done} done, {} downloaded and waiting, {} to download",
        done + on_disk.len() + to_download.len(),
        on_disk.len(),
        to_download.len()
    );
    if on_disk.is_empty() && to_download.is_empty() {
        return;
    }

    if let Some(threads) = setup.args.threads {
        rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build_global()
            .unwrap();
    }
    let progress = Progress::new(
        to_download.len(),
        on_disk.len() + to_download.len(),
        rayon::current_num_threads(),
    );
    let failures = run(&setup, on_disk, to_download, &progress);

    let seconds = progress.elapsed().as_secs_f64();
    println!("Done in {} ({seconds:.1} s)", minutes_seconds(seconds));
    progress.print_summary();
    if !failures.is_empty() {
        eprintln!("{} tiles failed (rerun to retry):", failures.len());
        for failure in failures {
            eprintln!("  {failure}");
        }
        exit(1);
    }
}

/// Reads the settings and tents, checks them, and makes sure the N50 data
/// for the regions' counties is downloaded.
fn prepare() -> Result<Setup, String> {
    let args = parse_args().map_err(|error| format!("{error}\n{USAGE}"))?;
    let config: TentsFile = std::fs::read_to_string(&args.tents)
        .map_err(|e| e.to_string())
        .and_then(|text| toml::from_str(&text).map_err(|e| e.to_string()))
        .map_err(|error| format!("{}: {error}", args.tents.display()))?;
    let footprints: Vec<Footprint> = config
        .tents
        .iter()
        .map(|t| Footprint::of(t, config.clearance_m))
        .collect();
    for (tent, footprint) in config.tents.iter().zip(&footprints) {
        // +1 for the slope calculation's own 3×3 neighbourhood, +1 for the
        // 2×2 sampling when rotating.
        if footprint.reach() + 2.0 > BUFFER_M as f32 {
            return Err(format!(
                "{} is too large for the {BUFFER_M} m tile border",
                tent.name
            ));
        }
    }

    for dir in ["dtm", "n50", "flatness"] {
        std::fs::create_dir_all(args.data.join(dir)).map_err(|e| e.to_string())?;
    }
    // Tent names for the database, so the app can show "Keron 4 GT" rather
    // than the file-name slug.
    let mut tents_csv = String::from("slug,name\n");
    for tent in &config.tents {
        tents_csv += &format!("{},\"{}\"\n", tent.slug(), tent.name.replace('"', "\"\""));
    }
    write_atomic(&args.data.join("flatness/tents.csv"), tents_csv.as_bytes())?;

    let mut counties = BTreeSet::new();
    for path in &args.regions {
        counties.extend(Region::read(path)?.n50_counties);
    }
    let mut gpkgs = Vec::new();
    for county in &counties {
        let gpkg = args.data.join(format!("n50/{county}.water.gpkg"));
        if !gpkg.exists() {
            return Err(format!(
                "{}: missing; run ./prepare_water.sh with the region files first",
                gpkg.display()
            ));
        }
        gpkgs.push(gpkg);
    }
    let water = Water::load(&gpkgs)?;
    println!(
        "{} water polygons from {}",
        water.polygon_count(),
        counties.into_iter().collect::<Vec<_>>().join(", ")
    );

    Ok(Setup {
        args,
        config,
        footprints,
        water,
    })
}

/// Downloads `to_download` on a few threads while the CPUs process every
/// tile as soon as it's on disk (`on_disk` first). Returns the errors.
fn run(
    setup: &Setup,
    on_disk: Vec<Job>,
    to_download: VecDeque<Job>,
    progress: &Progress,
) -> Vec<String> {
    let queue = Mutex::new(to_download);
    let failures = Mutex::new(Vec::new());
    // Tiles ready to process travel through a channel: download threads
    // send, the processing threads receive.
    let (ready, arrivals) = mpsc::channel::<Job>();

    std::thread::scope(|scope| {
        scope.spawn(|| progress.report_until_finished());

        // Download threads: each takes the next tile from the queue until
        // it's empty. Waiting on the network costs no CPU, so these run
        // next to the processing threads, not instead of them.
        for _ in 0..setup.args.downloads {
            let ready = ready.clone();
            let (queue, failures) = (&queue, &failures);
            scope.spawn(move || {
                loop {
                    let next = queue.lock().unwrap().pop_front();
                    let Some(job) = next else { break };
                    match download::terrain_tile(job.east, job.north, &job.dtm) {
                        Ok(report) => {
                            progress.downloaded(&job.name, &report);
                            ready.send(job).unwrap();
                        }
                        Err(error) => failures.lock().unwrap().push(error),
                    }
                }
            });
        }
        for job in on_disk {
            ready.send(job).unwrap();
        }
        // The channel closes when the last sender is gone: this one now, the
        // download threads' copies when they finish.
        drop(ready);

        // Processing: rayon takes tiles from the channel as they arrive and
        // spreads them over its threads (`par_bridge` turns an ordinary
        // iterator into parallel work).
        arrivals.into_iter().par_bridge().for_each(|job| {
            if let Err(error) = progress.track(|| process(&job, setup)) {
                failures.lock().unwrap().push(error);
            }
        });
        progress.finish();
    });
    failures.into_inner().unwrap()
}

/// What a tile still needs, or None if it's done.
fn plan(setup: &Setup, east: u32, north: u32) -> Option<Job> {
    let name = tile_name(east, north);
    let out_dir = setup.args.data.join("flatness").join(&name);
    let tents: Vec<usize> = (0..setup.config.tents.len())
        .filter(|&t| {
            let done = std::fs::read_to_string(done_path(&out_dir, &setup.config.tents[t]));
            let wanted = settings_used(&setup.footprints[t], setup.args.max_roughness_m);
            setup.args.force || done.ok() != Some(wanted)
        })
        .collect();
    let needs_elevation = setup.args.force || !out_dir.join(ELEVATION_FILE).exists();
    if tents.is_empty() && !needs_elevation {
        return None;
    }
    Some(Job {
        dtm: setup.args.data.join("dtm").join(format!("{name}.tif")),
        name,
        east,
        north,
        tents,
        needs_elevation,
    })
}

/// Processes one tile and returns a one-line report of how it went.
fn process(job: &Job, setup: &Setup) -> Result<String, String> {
    let started = std::time::Instant::now();
    let elevation = geotiff::read_f32(&job.dtm, DTM_SIZE_PX)?;
    // The water mask covers the same pixels as the terrain: tile + border.
    let water = setup
        .water
        .mask(
            (job.east as usize - BUFFER_M) as f64,
            (job.north as usize + TILE_SIZE_M + BUFFER_M) as f64,
            DTM_SIZE_PX,
        )
        .map_err(|e| format!("{}: water mask: {e}", job.name))?;

    let out_dir = setup.args.data.join("flatness").join(&job.name);
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
    let cost = pixel_cost(&elevation, &water, setup.args.max_roughness_m);
    for &t in &job.tents {
        let tent = &setup.config.tents[t];
        let cells = summarise(&best_placement(&cost, &setup.footprints[t]));
        let file = |kind: &str| out_dir.join(format!("{}.{kind}", tent.slug()));
        write_cells_csv(&file("cells.csv"), job, &tent.slug(), &cells, &cell_heights)?;
        geotiff::write_f32(&file("slope.tif"), n, n, &cells.max_slope, &at)?;
        if let Shape::Rectangle { .. } = tent.shape {
            geotiff::write_i16(&file("heading.tif"), n, n, &cells.heading, &at)?;
        }
        // Written last: marks this tent as done, with these settings.
        let settings = settings_used(&setup.footprints[t], setup.args.max_roughness_m);
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

fn parse_args() -> Result<Args, String> {
    let mut args = Args {
        regions: Vec::new(),
        tents: PathBuf::from("tents.toml"),
        data: PathBuf::from("data"),
        threads: None,
        downloads: 4, // more would just be impolite to Kartverket's servers
        max_roughness_m: 0.1,
        force: false,
    };
    let mut words = std::env::args().skip(1);
    while let Some(word) = words.next() {
        let mut value = || words.next().ok_or(format!("{word} needs a value"));
        match word.as_str() {
            "--tents" => args.tents = PathBuf::from(value()?),
            "--data" => args.data = PathBuf::from(value()?),
            "--threads" => {
                args.threads = Some(value()?.parse().map_err(|_| "--threads must be a number")?)
            }
            "--downloads" => {
                args.downloads = value()?
                    .parse()
                    .map_err(|_| "--downloads must be a number")?
            }
            "--max-roughness-m" => {
                args.max_roughness_m = value()?
                    .parse()
                    .map_err(|_| "--max-roughness-m must be a number")?
            }
            "--force" => args.force = true,
            other if other.starts_with("--") => return Err(format!("unknown option {other}")),
            region => args.regions.push(PathBuf::from(region)),
        }
    }
    if args.regions.is_empty() {
        return Err("give at least one region file".into());
    }
    Ok(args)
}
