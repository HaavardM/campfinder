#!/usr/bin/env bash
# The whole pipeline: no-go areas, download + process, QGIS mosaics, and the
# map's files (data/map/).
#
# Usage: ./run.sh [options] [regions/x.env ...]
#
# Without regions: every region in regions/ except test*. Options go to the
# flatness engine (see flatness/src/main.rs), e.g. --force, --threads 8.
# Safe to rerun at any time: only missing work is done.
#
# Needs Rust, GDAL's command-line tools (for N50 and the mosaics) and
# tippecanoe (for the map's files).
set -euo pipefail
cd "$(dirname "$0")"

# No region files given: every region in regions/ except test*.
if [[ " $* " != *".env "* ]]; then
  for region in regions/*.env; do
    [[ $region == regions/test* ]] || set -- "$@" "$region"
  done
fi

# Both take the same arguments: prepare_no_go.sh skips the options.
./prepare_no_go.sh "$@"
cargo build --release --quiet --manifest-path flatness/Cargo.toml
flatness/target/release/flatness "$@"

# A VRT is a small XML file that makes many GeoTIFFs look like one raster,
# so QGIS can show a whole region at once without copying data.
kinds=$(for path in data/flatness/E*/*.tif; do echo "${path##*/}"; done | sort -u)
for kind in $kinds; do
  gdalbuildvrt -q "data/flatness/${kind%.tif}.vrt" data/flatness/E*/"$kind"
done
echo "QGIS mosaics: data/flatness/*.vrt"

# The map's files, in data/map/: upload them (see README.md).
./build_map.sh
