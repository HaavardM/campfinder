#!/usr/bin/env bash
# The whole pipeline: water polygons, download + process, QGIS mosaics, and
# loading into PostGIS.
#
# Usage: ./run.sh [options] [regions/x.env ...]
#
# Without regions: every region in regions/ except test*. Options go to the
# flatness engine (see flatness/src/main.rs), e.g. --force, --threads 8.
# Safe to rerun at any time: only missing work is done.
#
# Needs Rust, GDAL's command-line tools (for N50 and the mosaics) and the
# database from ../docker-compose.yml.
set -euo pipefail
cd "$(dirname "$0")"

regions=()
options=()
for arg in "$@"; do
  case $arg in
    *.env) regions+=("$arg") ;;
    *) options+=("$arg") ;;
  esac
done
if [[ ${#regions[@]} -eq 0 ]]; then
  for region in regions/*.env; do
    [[ $region == regions/test* ]] || regions+=("$region")
  done
fi

./prepare_water.sh "${regions[@]}"

# Built from inside the crate: Cargo reads flatness/.cargo/config.toml
# (target-cpu=native) relative to the working directory.
(cd flatness && cargo build --release --quiet)
echo "Tip: run htop (or Activity Monitor's CPU history) to watch every CPU."
# ${options[@]+...}: bash 3.2 (macOS) treats an empty array as unset.
flatness/target/release/flatness ${options[@]+"${options[@]}"} "${regions[@]}"

# A VRT is a small XML file that makes many GeoTIFFs look like one raster,
# so QGIS can show a whole region at once without copying data.
kinds=$(for path in data/flatness/E*/*.tif; do echo "${path##*/}"; done | sort -u)
for kind in $kinds; do
  gdalbuildvrt -q "data/flatness/${kind%.tif}.vrt" data/flatness/E*/"$kind"
done
echo "QGIS mosaics: data/flatness/*.vrt"

./04_load_cells.sh
