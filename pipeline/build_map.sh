#!/usr/bin/env bash
# Turns the engine's results into the map's files, in data/map/:
#
#   manifest.json                           the tents, and which file is which
#   <tent>.<season>.<build time>.pmtiles    all the map tiles, one file each
#
# Upload data/map/ to a bucket (see README.md); the web app reads it from
# there. Each build has new file names, so the .pmtiles files can be cached
# for good; only manifest.json changes in place, and it's written last.
#
# Needs tippecanoe (macOS: brew install tippecanoe; Debian: apt install
# tippecanoe), which packs GeoJSON into vector tiles.
set -euo pipefail
cd "$(dirname "$0")"

stamp=$(date -u +%Y%m%dT%H%M)
build=data/map/build
rm -rf "$build"
mkdir -p "$build"

(cd flatness && cargo build --release --quiet --bin mapfiles)
# GeoJSON per tent and season (points for the heatmap, areas), and the
# manifest naming this build's files.
flatness/target/release/mapfiles --stamp "$stamp" "$build"

for points in "$build"/*.points.geojsonl; do
  name=$(basename "$points" .points.geojsonl) # keron-4-gt.summer
  echo "Packing $name..."
  # -Z/-z: zoom 5 to 16 (the heatmap squares stop shrinking at 12; areas
  # start at 13). -r1 and the no-limit flags: keep every feature at every
  # zoom; the data already has the right detail per zoom.
  tippecanoe --quiet --force --read-parallel -Z5 -z16 -r1 \
    --no-feature-limit --no-tile-size-limit --no-tile-stats \
    -L "scores:$points" -L "areas:$build/$name.areas.geojsonl" \
    -o "data/map/$name.$stamp.pmtiles"
done

# The new manifest last, so it never names a file that isn't there yet; then
# the previous builds' files go.
mv "$build/manifest.json" data/map/manifest.json
rm -rf "$build"
find data/map -name '*.pmtiles' ! -name "*.$stamp.pmtiles" -delete
du -sh data/map/*.pmtiles
