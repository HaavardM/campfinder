#!/usr/bin/env bash
# Terrain tiles and water masks for one region.
#
# Usage: ./02_download_tiles.sh regions/rondane.env
#
# Splits the region's bounding box into 2 × 2 km tiles and fetches each one
# (with its border) that isn't downloaded yet, 4 at a time, printing progress
# and an estimated time left.
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck source=/dev/null  # sets WEST, SOUTH, EAST, NORTH
source "$1"
TILE_M=2000
PARALLEL_DOWNLOADS=4 # more would just be impolite to Kartverket's servers

# 754 → "12m34s"
duration() { printf "%dm%02ds" $(($1 / 60)) $(($1 % 60)); }

mkdir -p data/dtm data/water
total=$((((EAST - WEST) / TILE_M) * ((NORTH - SOUTH) / TILE_M)))
echo "$(basename "$1" .env): $total tiles"

start=$(date +%s)
done_count=0
downloaded=0
for ((tile_e = WEST; tile_e < EAST; tile_e += TILE_M)); do
  for ((tile_n = SOUTH; tile_n < NORTH; tile_n += TILE_M)); do
    echo "$tile_e $tile_n"
  done
done | xargs -P "$PARALLEL_DOWNLOADS" -n 2 ./lib/fetch_tile.sh | while read -r status line; do
  done_count=$((done_count + 1))
  if [[ $status == skipped ]]; then
    # Only report every 50th skipped tile, so reruns stay quiet.
    if ((done_count % 50 == 0 || done_count == total)); then
      printf "[%4d/%d] already downloaded\n" "$done_count" "$total"
    fi
    continue
  fi
  downloaded=$((downloaded + 1))
  elapsed=$(($(date +%s) - start))
  # Estimate from downloaded tiles only: skipped tiles take no time.
  left=$((total - done_count))
  eta=$((elapsed * left / downloaded))
  rate=$(awk "BEGIN { printf \"%.1f\", $downloaded / ($elapsed + 0.001) }")
  printf "[%4d/%d] %s | %s tiles/s, ETA %s\n" "$done_count" "$total" "$line" "$rate" "$(duration "$eta")"
done

tiles=(data/dtm/*.tif)
echo "$(basename "$1" .env) done in $(duration $(($(date +%s) - start))); ${#tiles[@]} terrain tiles on disk in total"
