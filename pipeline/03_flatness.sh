#!/usr/bin/env bash
# Runs the Rust flatness engine on every downloaded tile that is missing
# results, then builds one mosaic per result for viewing in QGIS.
#
# Usage: ./03_flatness.sh [--force] [--threads N]
#   --force       recompute everything (after changing MAX_ROUGHNESS_M)
#   MAX_ROUGHNESS_M=0.1 ./03_flatness.sh   bumps above this count as unusable
set -euo pipefail
cd "$(dirname "$0")"

MAX_ROUGHNESS_M="${MAX_ROUGHNESS_M:-0.1}"

cargo build --release --quiet --manifest-path flatness/Cargo.toml
mkdir -p data/flatness
echo "Tip: run htop in another terminal to watch every CPU."
# GNU time reports peak memory, to check the per-thread memory estimate.
/usr/bin/time -f "Peak memory: %M KB, wall time: %E" \
  flatness/target/release/flatness \
  --tents tents.toml \
  --dtm-dir data/dtm \
  --water-dir data/water \
  --out-dir data/flatness \
  --max-roughness-m "$MAX_ROUGHNESS_M" \
  "$@"

# A VRT is a small XML file that makes many GeoTIFFs look like one raster,
# so QGIS can show a whole region at once without copying data.
kinds=$(for path in data/flatness/E*/*.tif; do basename "$path"; done | sort -u)
for kind in $kinds; do
  gdalbuildvrt -q "data/flatness/${kind%.tif}.vrt" data/flatness/*/"$kind"
  echo "Mosaic: data/flatness/${kind%.tif}.vrt"
done
