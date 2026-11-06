#!/usr/bin/env bash
# The pipeline on the Mac, into the local database. No GDAL install needed:
# GDAL steps run in Docker, the Rust engine runs natively.
#
# Usage: ./run_local.sh [regions/x.env ...]   (default regions/test.env;
#        needs `docker compose up -d` in ../ first)
set -euo pipefail
cd "$(dirname "$0")"
if [[ $# -gt 0 ]]; then regions=("$@"); else regions=(regions/test.env); fi

GDAL_IMAGE=ghcr.io/osgeo/gdal:ubuntu-small-3.11.4
in_gdal() { docker run --rm -v "$PWD:/pipeline" -w /pipeline "$GDAL_IMAGE" "$@"; }

for region in "${regions[@]}"; do # paths inside pipeline/
  in_gdal ./01_download_water.sh "$region"
  in_gdal ./02_download_tiles.sh "$region"
done
(cd flatness && cargo build --release --quiet) # inside the crate, for target-cpu=native
flatness/target/release/flatness --tents tents.toml \
  --dtm-dir data/dtm --water-dir data/water --out-dir data/flatness
./04_load_cells.sh
