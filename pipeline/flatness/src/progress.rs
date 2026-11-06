//! Progress while tiles download and are processed in parallel: two live
//! bars (downloads, processing) with rates and ETAs, a strip showing which
//! CPUs are busy, a line per tile above the bars, and a per-thread summary.
//!
//! The bars come from the `indicatif` crate. They redraw in place a few
//! times a second, and hide themselves when the output isn't a terminal
//! (e.g. piped to a file); the per-tile lines are printed either way.
//! Worker threads only touch atomics (lock-free counters) and the bars,
//! so reporting costs next to nothing compared with the work itself.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering::Relaxed};
use std::time::{Duration, Instant};

use indicatif::{MultiProgress, ProgressBar, ProgressState, ProgressStyle};

pub struct Progress {
    started: Instant,
    bars: MultiProgress,
    download: ProgressBar,
    process: ProgressBar,
    /// Per processing thread: working on a tile right now?
    busy: Vec<AtomicBool>,
    /// Per processing thread: tiles finished, and milliseconds spent on them.
    tiles: Vec<AtomicUsize>,
    busy_ms: Vec<AtomicU64>,
}

impl Progress {
    pub fn new(to_download: usize, to_process: usize, threads: usize) -> Progress {
        let bars = MultiProgress::new();
        let bar = |label: &str, length: usize| {
            let template = format!(
                "{label} [{{bar:40.green/dim}}] {{pos:>4}}/{{len}}  {{rate}}  ETA {{eta}}  {{msg}}"
            );
            let style = ProgressStyle::with_template(&template)
                .unwrap()
                .progress_chars("█▌ ")
                .with_key("rate", |state: &ProgressState, w: &mut dyn std::fmt::Write| {
                    write!(w, "{:>3.0} tiles/min", state.per_sec() * 60.0).unwrap()
                });
            let bar = bars.add(ProgressBar::new(length as u64).with_style(style));
            // Redraw regularly, so the clock and ETA move between tiles too.
            bar.enable_steady_tick(Duration::from_millis(250));
            bar
        };
        let download = bar("download", to_download);
        let process = bar("process ", to_process);
        let progress = Progress {
            started: Instant::now(),
            bars,
            download,
            process,
            busy: (0..threads).map(|_| AtomicBool::new(false)).collect(),
            tiles: (0..threads).map(|_| AtomicUsize::new(0)).collect(),
            busy_ms: (0..threads).map(|_| AtomicU64::new(0)).collect(),
        };
        progress.show_busy();
        progress
    }

    /// Reports one finished download (from a download thread).
    pub fn downloaded(&self, tile: &str, report: &str) {
        self.println(format!("download {tile}  {report}"));
        self.download.inc(1);
    }

    /// Runs `work` for one tile on the current processing thread, keeping
    /// the counters up to date, and prints its line (or returns its error).
    pub fn track<T>(&self, work: impl FnOnce() -> Result<String, T>) -> Result<(), T> {
        let thread = rayon::current_thread_index().unwrap_or(0);
        self.busy[thread].store(true, Relaxed);
        self.show_busy();
        let started = Instant::now();
        let result = work();
        self.busy_ms[thread].fetch_add(started.elapsed().as_millis() as u64, Relaxed);
        self.tiles[thread].fetch_add(1, Relaxed);
        self.busy[thread].store(false, Relaxed);
        self.show_busy();
        self.process.inc(1);

        let line = result?;
        self.println(format!("process  {line}  cpu {thread:>2}"));
        Ok(())
    }

    /// Leaves the bars on screen at their final state.
    pub fn finish(&self) {
        self.download.finish();
        self.process.finish();
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

    /// The busy strip, one character per processing thread, next to the
    /// processing bar: `CPUs ███·██·· 5/8 busy`.
    fn show_busy(&self) {
        let strip: String = self
            .busy
            .iter()
            .map(|b| if b.load(Relaxed) { '█' } else { '·' })
            .collect();
        let busy = self.busy.iter().filter(|b| b.load(Relaxed)).count();
        self.process
            .set_message(format!("CPUs {strip} {busy}/{} busy", self.busy.len()));
    }

    /// Prints a line above the bars. `suspend` clears the bars, runs the
    /// closure and redraws them; it also works when they're hidden.
    fn println(&self, line: String) {
        self.bars.suspend(|| println!("{line}"));
    }
}

/// 94.0 → "1m34s"
pub fn minutes_seconds(seconds: f64) -> String {
    let s = seconds.round() as u64;
    format!("{}m{:02}s", s / 60, s % 60)
}
