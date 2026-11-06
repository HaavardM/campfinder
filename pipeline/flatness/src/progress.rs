//! Progress reporting while tiles download and are processed in parallel:
//! a line per downloaded and per processed tile, a live strip showing which
//! threads are busy, and a per-thread summary.
//!
//! Worker threads only touch atomics (lock-free counters), so reporting costs
//! next to nothing compared with the work itself.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering::Relaxed};
use std::time::{Duration, Instant};

pub struct Progress {
    started: Instant,
    finished: AtomicBool,
    /// Tiles to download, and tiles to process (downloaded ones included).
    to_download: usize,
    to_process: usize,
    downloaded: AtomicUsize,
    processed: AtomicUsize,
    /// Per processing thread: working on a tile right now?
    busy: Vec<AtomicBool>,
    /// Per processing thread: tiles finished, and milliseconds spent on them.
    tiles: Vec<AtomicUsize>,
    busy_ms: Vec<AtomicU64>,
}

impl Progress {
    pub fn new(to_download: usize, to_process: usize, threads: usize) -> Progress {
        Progress {
            started: Instant::now(),
            finished: AtomicBool::new(false),
            to_download,
            to_process,
            downloaded: AtomicUsize::new(0),
            processed: AtomicUsize::new(0),
            busy: (0..threads).map(|_| AtomicBool::new(false)).collect(),
            tiles: (0..threads).map(|_| AtomicUsize::new(0)).collect(),
            busy_ms: (0..threads).map(|_| AtomicU64::new(0)).collect(),
        }
    }

    /// Reports one finished download (from a download thread).
    pub fn downloaded(&self, tile: &str, report: &str) {
        let done = self.downloaded.fetch_add(1, Relaxed) + 1;
        println!(
            "download [{done:>4}/{}] {tile}  {report} | {}",
            self.to_download,
            self.rate_and_eta(done, self.to_download)
        );
    }

    /// Runs `work` for one tile on the current processing thread, keeping
    /// the counters up to date, and prints its line (or returns its error).
    pub fn track<T>(&self, work: impl FnOnce() -> Result<String, T>) -> Result<(), T> {
        let thread = rayon::current_thread_index().unwrap_or(0);
        self.busy[thread].store(true, Relaxed);
        let started = Instant::now();
        let result = work();
        self.busy_ms[thread].fetch_add(started.elapsed().as_millis() as u64, Relaxed);
        self.tiles[thread].fetch_add(1, Relaxed);
        self.busy[thread].store(false, Relaxed);

        let done = self.processed.fetch_add(1, Relaxed) + 1;
        let line = result?;
        println!(
            "process  [{done:>4}/{}] cpu {thread:>2}  {line}",
            self.to_process
        );
        Ok(())
    }

    /// Prints the busy-thread strip every 2 seconds until `finish` is called.
    /// Meant to run on its own thread, next to the workers.
    pub fn report_until_finished(&self) {
        while !self.finished.load(Relaxed) {
            for _ in 0..20 {
                std::thread::sleep(Duration::from_millis(100));
                if self.finished.load(Relaxed) {
                    return;
                }
            }
            let strip: String = self
                .busy
                .iter()
                .map(|b| if b.load(Relaxed) { '█' } else { '·' })
                .collect();
            let busy = strip.chars().filter(|c| *c == '█').count();
            println!(
                "  CPUs {strip}  {busy}/{} busy | downloaded {}/{}, processed {}/{}",
                self.busy.len(),
                self.downloaded.load(Relaxed),
                self.to_download,
                self.processed.load(Relaxed),
                self.to_process,
            );
        }
    }

    pub fn finish(&self) {
        self.finished.store(true, Relaxed);
    }

    pub fn elapsed(&self) -> Duration {
        self.started.elapsed()
    }

    /// Tiles per thread, and how much of the wall time the threads were busy.
    /// While tiles are still downloading, threads mostly wait, so expect low
    /// utilisation then: the downloads are the bottleneck, not the CPUs.
    pub fn print_summary(&self) {
        let tiles: Vec<String> = self
            .tiles
            .iter()
            .map(|t| t.load(Relaxed).to_string())
            .collect();
        let busy_s: f64 = self
            .busy_ms
            .iter()
            .map(|ms| ms.load(Relaxed) as f64 / 1000.0)
            .sum();
        let available_s = self.started.elapsed().as_secs_f64() * self.busy.len() as f64;
        println!("Tiles per thread: {}", tiles.join(" "));
        println!(
            "Thread utilisation: {:.0}% (busy time / (threads × wall time))",
            100.0 * busy_s / available_s
        );
    }

    fn rate_and_eta(&self, done: usize, total: usize) -> String {
        let seconds = self.started.elapsed().as_secs_f64();
        let per_minute = done as f64 / seconds * 60.0;
        let eta = (total - done) as f64 / (per_minute / 60.0).max(1e-9);
        format!("{per_minute:.0} tiles/min, ETA {}", minutes_seconds(eta))
    }
}

/// 94.0 → "1m34s"
pub fn minutes_seconds(seconds: f64) -> String {
    let s = seconds.round() as u64;
    format!("{}m{:02}s", s / 60, s % 60)
}
