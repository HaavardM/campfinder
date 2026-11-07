//! Command line: the whole pipeline for some regions, from download to
//! results.
//!
//!   flatness [options] regions/rondane.env regions/dovre.env
//!
//! 1. Loads the regions' no-go polygons (water, bogs, near houses; prepared
//!    per region by `prepare_no_go.sh`).
//! 2. Downloads the terrain and surface tiles not on disk yet, a few at a
//!    time, and processes every tile as soon as both are there. Downloading
//!    is the slow part, so the CPUs keep up with the downloads.
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

use flatness::download::{self, Model};
use flatness::geotiff::{self, Georef, write_atomic};
use flatness::no_go::NoGo;
use flatness::region::{Region, tile_name};
use flatness::tents::{Footprint, Shape, Tent, TentsFile};
use flatness::terrain::{mark_low_shore, mark_obstacles, mark_smooth, pixel_cost};
use flatness::tile::{
    BUFFER_M, CELL_SIZE_M, CELLS_PER_SIDE, DTM_SIZE_PX, TILE_SIZE_M, best_placement,
    bordered_box, cell_elevation, summarise,
};
use progress::{Progress, minutes_seconds};
use rayon::iter::{ParallelBridge, ParallelIterator};

const USAGE: &str = "usage: flatness [--tents tents.toml] [--data data] [--threads N] \
                     [--downloads 8] [--max-roughness-m 0.1] [--max-object-height-m 0.5] \
                     [--min-height-above-water-m 0.5] [--force] REGION.env ...";

struct Args {
    regions: Vec<PathBuf>,
    tents: PathBuf,
    data: PathBuf,
    threads: Option<usize>,
    downloads: usize,
    max_roughness_m: f32,
    max_object_height_m: f32,
    min_height_above_water_m: f32,
    force: bool,
}

/// What everything needs to know: settings, tents, and where things are.
struct Setup {
    args: Args,
    config: TentsFile,
    footprints: Vec<Footprint>,
    /// South-west corners of every tile of every region, each once
    /// (regions may overlap).
    tiles: BTreeSet<(u32, u32)>,
    /// Where no tent may go, from the map, by class: "always", "water", or
    /// "summer" (what snow covers: bogs).
    no_go: NoGo,
    /// How the no-go areas were made (`prepare_no_go.sh` writes it next to
    /// each GeoPackage), so changing that redoes the tiles.
    no_go_recipe: String,
}

/// One tile and the work it still needs.
struct Job {
    name: String,
    east: u32,
    north: u32,
    /// Its terrain and surface model files.
    dtm: PathBuf,
    dom: PathBuf,
    tents: Vec<usize>,
    needs_elevation: bool,
}

fn main() {
    let setup = prepare().unwrap_or_else(|error| {
        eprintln!("{error}");
        exit(2);
    });

    let mut on_disk = Vec::new();
    let mut to_download = VecDeque::new();
    let mut done = 0;
    for &(east, north) in &setup.tiles {
        match plan(&setup, east, north) {
            None => done += 1,
            Some(job) if job.dtm.exists() && job.dom.exists() => on_disk.push(job),
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
    if let Some(threads) = args.threads {
        // Read by every rayon thread pool when it starts: ours, and terrio's
        // own (it rasterizes in parallel too), so both stay within the limit.
        // SAFETY: no other threads exist yet to read the environment.
        unsafe { std::env::set_var("RAYON_NUM_THREADS", threads.to_string()) };
    }
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

    for dir in [Model::Terrain.dir(), Model::Surface.dir(), "flatness"] {
        std::fs::create_dir_all(args.data.join(dir)).map_err(|e| e.to_string())?;
    }
    // Tent names for the database, so the app can show "Keron 4 GT" rather
    // than the file-name slug.
    let mut tents_csv = String::from("slug,name\n");
    for tent in &config.tents {
        tents_csv += &format!("{},\"{}\"\n", tent.slug(), tent.name.replace('"', "\"\""));
    }
    write_atomic(&args.data.join("flatness/tents.csv"), tents_csv.as_bytes())?;

    let (mut tiles, mut gpkgs, mut recipes) = (BTreeSet::new(), Vec::new(), BTreeSet::new());
    for path in &args.regions {
        tiles.extend(Region::read(path)?.tiles());
        let name = path.file_stem().unwrap_or_default().to_string_lossy();
        let gpkg = args.data.join(format!("no-go/{name}.gpkg"));
        let recipe = std::fs::read_to_string(gpkg.with_extension("recipe")).map_err(|_| {
            format!(
                "{}: missing; run ./prepare_no_go.sh with the region files first",
                gpkg.display()
            )
        })?;
        recipes.insert(recipe.trim().to_string());
        gpkgs.push(gpkg);
    }
    let no_go = NoGo::load(&gpkgs)?;
    println!(
        "{} no-go polygons: {} of them water, {} only in summer",
        no_go.count(|_| true),
        no_go.count(|class| class == WATER),
        no_go.count(|class| class == SUMMER)
    );

    Ok(Setup {
        args,
        config,
        footprints,
        tiles,
        no_go,
        no_go_recipe: recipes.into_iter().collect::<Vec<_>>().join("+"),
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
                    match download_missing(&job) {
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

/// Downloads whichever of a tile's terrain and surface files isn't on disk
/// yet, one after the other, and returns a one-line report.
fn download_missing(job: &Job) -> Result<String, String> {
    let mut reports = Vec::new();
    for (model, path) in [(Model::Terrain, &job.dtm), (Model::Surface, &job.dom)] {
        if !path.exists() {
            reports.push(download::tile(model, job.east, job.north, path)?);
        }
    }
    Ok(reports.join(", "))
}

/// What a tile still needs, or None if it's done.
fn plan(setup: &Setup, east: u32, north: u32) -> Option<Job> {
    let name = tile_name(east, north);
    let out_dir = setup.args.data.join("flatness").join(&name);
    let tents: Vec<usize> = (0..setup.config.tents.len())
        .filter(|&t| {
            let done = std::fs::read_to_string(done_path(&out_dir, &setup.config.tents[t]));
            let wanted = settings_used(&setup.footprints[t], setup);
            setup.args.force || done.ok() != Some(wanted)
        })
        .collect();
    let needs_elevation = setup.args.force || !out_dir.join(ELEVATION_FILE).exists();
    if tents.is_empty() && !needs_elevation {
        return None;
    }
    let file = |model: Model| {
        setup
            .args
            .data
            .join(model.dir())
            .join(format!("{name}.tif"))
    };
    Some(Job {
        dtm: file(Model::Terrain),
        dom: file(Model::Surface),
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
    let surface = geotiff::read_f32(&job.dom, DTM_SIZE_PX)?;
    // Where no tent can go whatever the slope: the map's no-go areas, and
    // wherever something stands on the ground. The mask covers the same
    // pixels as the terrain: tile + border.
    let (west, _, _, north) = bordered_box(job.east, job.north);
    let mask = |what: &str, keep: &dyn Fn(&str) -> bool| {
        let mask = setup.no_go.mask(west, north, DTM_SIZE_PX, keep);
        mask.map_err(|e| format!("{}: {what} mask: {e}", job.name))
    };
    let mut blocked = mask("no-go", &|class| class != SUMMER)?;
    mark_obstacles(&mut blocked, &elevation, &surface, setup.args.max_object_height_m);
    // Water the map draws in the wrong place: low ground right by it, and
    // unnaturally smooth ground (interpolated over water).
    let water = mask("water", &|class| class == WATER)?;
    let min_height = setup.args.min_height_above_water_m;
    mark_low_shore(&mut blocked, &elevation, &water, WATER_REACH_M, min_height);
    mark_smooth(&mut blocked, &elevation, MAX_SMOOTH_RESIDUAL_M);

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
    // In summer, also what snow covers in winter.
    let summer_only = mask("summer no-go", &|class| class == SUMMER)?;
    let mut summer_blocked = blocked.clone();
    for (b, &s) in summer_blocked.iter_mut().zip(&summer_only) {
        *b |= s;
    }
    let roughness = setup.args.max_roughness_m;
    let seasons = [
        (SUMMER, pixel_cost(&elevation, &summer_blocked, roughness)),
        (WINTER, pixel_cost(&elevation, &blocked, roughness)),
    ];

    for &t in &job.tents {
        let tent = &setup.config.tents[t];
        for (season, cost) in &seasons {
            let cells = summarise(&best_placement(cost, &setup.footprints[t]));
            let file = |kind: &str| out_dir.join(format!("{}.{season}.{kind}", tent.slug()));
            geotiff::write_f32(&file("slope.tif"), n, n, &cells.max_slope, &at)?;
            if let Shape::Rectangle { .. } = tent.shape {
                geotiff::write_i16(&file("heading.tif"), n, n, &cells.heading, &at)?;
            }
        }
        // Written last: marks this tent as done, with these settings.
        let settings = settings_used(&setup.footprints[t], setup);
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

const ELEVATION_FILE: &str = "elevation.tif";

/// The file marking a tent as done for a tile. It holds the settings the
/// result was computed with, so changing a tent's size or a limit makes the
/// tile count as not done.
fn done_path(out_dir: &Path, tent: &Tent) -> PathBuf {
    out_dir.join(format!("{}.done", tent.slug()))
}

/// Results come in two seasons: in winter, snow covers the no-go polygons
/// of class "summer" (bogs). Classes are set in prepare_no_go.sh.
const SUMMER: &str = "summer";
const WINTER: &str = "winter";
/// The no-go class of lakes, rivers and sea.
const WATER: &str = "water";
/// How far from the water `mark_low_shore` looks for its level, in pixels
/// (metres): a few times N50's shoreline error.
const WATER_REACH_M: usize = 30;
/// Ground this close to a plane is interpolated water (see `mark_smooth`).
const MAX_SMOOTH_RESIDUAL_M: f32 = 0.001;

/// The version of what the engine writes. Change it with any change to the
/// output files or to how results are computed: it makes every tile count as
/// not done, so they're all redone.
const OUTPUT_FORMAT: u32 = 4;

fn settings_used(footprint: &Footprint, setup: &Setup) -> String {
    let args = &setup.args;
    format!(
        "{footprint:?} max_roughness_m={} max_object_height_m={} \
         min_height_above_water_m={} no_go={} output_format={OUTPUT_FORMAT}\n",
        args.max_roughness_m,
        args.max_object_height_m,
        args.min_height_above_water_m,
        setup.no_go_recipe
    )
}

fn parse_args() -> Result<Args, String> {
    let mut args = Args {
        regions: Vec::new(),
        tents: PathBuf::from("tents.toml"),
        data: PathBuf::from("data"),
        threads: None,
        // Kartverket limits each connection, not the total: 4 at once gave
        // 20 tiles/min, 8 gave 26, 16 gave 33. Past 8 it's mostly extra load
        // on a free service.
        downloads: 8,
        max_roughness_m: 0.1,
        // Heather and grass stay below this; bushes, dwarf birch, boulders
        // and trees don't.
        max_object_height_m: 0.5,
        // Ground lower than this above nearby water is the lake itself (where
        // the map's shoreline is off) or wet shore.
        min_height_above_water_m: 0.5,
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
            "--max-object-height-m" => {
                args.max_object_height_m = value()?
                    .parse()
                    .map_err(|_| "--max-object-height-m must be a number")?
            }
            "--min-height-above-water-m" => {
                args.min_height_above_water_m = value()?
                    .parse()
                    .map_err(|_| "--min-height-above-water-m must be a number")?
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
