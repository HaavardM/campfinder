#!/usr/bin/env bash
# The pipeline on the Mac, for the small test area (regions/test.env), into
# the local database. No GDAL install needed: GDAL steps run in Docker, the
# Rust engine runs natively.
#
# Usage: ./run_local.sh     (needs `docker compose up -d` in ../ first)
set -euo pipefail
cd "$(dirname "$0")"

GDAL_IMAGE=ghcr.io/osgeo/gdal:ubuntu-small-3.11.4
# Innlandet county only (433 MB) instead of all of Norway (4 GB): it covers
# Rondane and most of Dovre.
export N50_URL=https://nedlasting.geonorge.no/geonorge/Basisdata/N50Kartdata/FGDB/Basisdata_34_Innlandet_25833_N50Kartdata_FGDB.zip

in_gdal() { docker run --rm -v "$PWD:/pipeline" -w /pipeline -e N50_URL "$GDAL_IMAGE" "$@"; }

in_gdal ./01_download_water.sh
in_gdal ./02_download_tiles.sh regions/test.env
(cd flatness && cargo build --release --quiet)
flatness/target/release/flatness --tents tents.toml \
  --dtm-dir data/dtm --water-dir data/water --out-dir data/flatness
./04_load_cells.sh
