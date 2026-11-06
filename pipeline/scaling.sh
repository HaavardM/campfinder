#!/usr/bin/env bash
# How well does the flatness engine scale with threads? Times the same tiles
# at 1, 2, 4, 8, 16 and 32 threads (run after ./run.sh has downloaded tiles).
#
# Usage: ./scaling.sh          (TILES=64 by default)
#
# On a 16-core / 32-thread CPU like the 5950X, expect close to linear gains up
# to 16 threads, then a smaller step to 32, where two threads share a core.
# Where the curve flattens earlier, memory bandwidth is the limit, not
# arithmetic.
set -euo pipefail
cd "$(dirname "$0")"

TILES="${TILES:-64}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The first $TILES tiles, linked into their own directories.
mkdir -p "$work/dtm" "$work/water"
all_tiles=(data/dtm/*.tif)
for path in "${all_tiles[@]:0:TILES}"; do
  ln -s "$PWD/$path" "$work/dtm/"
  ln -s "$PWD/data/water/$(basename "$path")" "$work/water/"
done

(cd flatness && cargo build --release --quiet) # inside the crate, for target-cpu=native
echo "$TILES tiles"
printf "%8s %10s %9s\n" threads seconds speedup
for threads in 1 2 4 8 16 32; do
  rm -rf "$work/out"
  /usr/bin/time -f %e -o "$work/seconds" flatness/target/release/flatness --tents tents.toml \
    --dtm-dir "$work/dtm" --water-dir "$work/water" --out-dir "$work/out" --threads "$threads" > /dev/null
  seconds=$(< "$work/seconds")
  baseline=${baseline:-$seconds}
  printf "%8d %10.1f %8.1fx\n" "$threads" "$seconds" "$(awk "BEGIN { print $baseline / $seconds }")"
done
