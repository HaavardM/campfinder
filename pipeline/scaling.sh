#!/usr/bin/env bash
# How well does the flatness engine scale with threads? Recomputes the same
# tiles (already downloaded) at 1, 2, 4, … threads, up to the CPU count.
#
# Usage: ./scaling.sh [regions/x.env]   (default regions/test-known.env, 90 tiles)
#
# On a 16-core / 32-thread CPU like the 5950X, expect close to linear gains up
# to 16 threads, then a smaller step to 32, where two threads share a core.
# Where the curve flattens earlier, memory bandwidth is the limit, not
# arithmetic.
set -euo pipefail
cd "$(dirname "$0")"
REGION="${1:-regions/test-known.env}"

(cd flatness && cargo build --release --quiet) # inside the crate, for target-cpu=native
cpus=$(getconf _NPROCESSORS_ONLN)

printf "%8s %10s %9s\n" threads seconds speedup
threads=1
while ((threads <= cpus)); do
  # The engine ends with "Done in 0m07s (7.2 s)": take the seconds.
  seconds=$(flatness/target/release/flatness --force --threads "$threads" "$REGION" |
    sed -n 's/^Done in .*(\(.*\) s)$/\1/p')
  baseline=${baseline:-$seconds}
  printf "%8d %10.1f %8.1fx\n" "$threads" "$seconds" "$(awk "BEGIN { print $baseline / $seconds }")"
  threads=$((threads * 2))
done
