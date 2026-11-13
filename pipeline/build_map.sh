#!/usr/bin/env bash
# Turns the engine's results into the map's files, in data/map/:
#
#   <tent>.<season>.<hash>.pmtiles   all the map tiles, one file each
#   manifest.json                    the tents, and which file is which
#
# A file's name holds a hash of its content: an unchanged file keeps its
# name (and stays cached), a changed one gets a new one, so the .pmtiles
# files can be cached for good. Only manifest.json changes in place, and it's
# written last. Publish with publish.sh.
#
# Needs tippecanoe (macOS: brew install tippecanoe; Debian: apt install
# tippecanoe), which packs GeoJSON into vector tiles.
set -euo pipefail
cd "$(dirname "$0")"

build=data/map/build
rm -rf "$build"
mkdir -p "$build"

(cd flatness && cargo build --release --quiet --bin mapfiles)
# GeoJSON per tent and season: points for the heatmap, and the areas.
flatness/target/release/mapfiles geojson "$build"

# One tippecanoe per tent and season, all at once (each is partly serial).
# -Z/-z: zoom 5 to 16; the features say which zooms they belong to. -r1 and
# the no-limit flags: keep every feature at every zoom, the data already
# has the right detail per zoom. -t: temporary files next to the output,
# not in /tmp, which can be a few GB of RAM (tmpfs) and too small.
for points in "$build"/*.points.geojsonl; do
  name=$(basename "$points" .points.geojsonl) # keron-4-gt.summer
  tippecanoe --quiet --force --read-parallel -Z5 -z16 -r1 -t "$build" \
    --no-feature-limit --no-tile-size-limit --no-tile-stats \
    -L "scores:$points" -L "areas:$build/$name.areas.geojsonl" \
    -o "$build/$name.pmtiles" &
done
wait

# Name each file by its content and move it into place, then the manifest
# for exactly these files, then remove what's left of earlier builds.
keep=()
for file in "$build"/*.pmtiles; do
  name=$(basename "$file" .pmtiles)
  hash=$(shasum -a 256 "$file" | cut -c1-12)
  mv "$file" "data/map/$name.$hash.pmtiles"
  keep+=("$name.$hash.pmtiles")
done
rm -rf "$build"
for file in data/map/*.pmtiles; do
  [[ " ${keep[*]} " == *" ${file##*/} "* ]] || rm "$file"
done
flatness/target/release/mapfiles manifest data/map
du -sh data/map/*.pmtiles
