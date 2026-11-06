#!/usr/bin/env bash
# Runs the Rust flatness engine on every downloaded tile that is missing
# results, then builds one mosaic per result for viewing in QGIS.
#
# Usage: ./03_flatness.sh [--force] [--threads N] [--max-roughness-m M]
#
# Tiles are recomputed by themselves when a tent or the roughness limit
# changes; --force recomputes everything regardless.
set -euo pipefail
cd "$(dirname "$0")"

# Built from inside the crate: Cargo reads flatness/.cargo/config.toml
# (target-cpu=native) relative to the working directory.
(cd flatness && cargo build --release --quiet)
mkdir -p data/flatness
echo "Tip: run htop in another terminal to watch every CPU."
# GNU time reports peak memory, to check the per-thread memory estimate.
/usr/bin/time -f "Peak memory: %M KB, wall time: %E" \
  flatness/target/release/flatness \
  --tents tents.toml \
  --dtm-dir data/dtm \
  --water-dir data/water \
  --out-dir data/flatness \
  "$@"

# A VRT is a small XML file that makes many GeoTIFFs look like one raster,
# so QGIS can show a whole region at once without copying data.
kinds=$(for path in data/flatness/E*/*.tif; do echo "${path##*/}"; done | sort -u)
for kind in $kinds; do
  gdalbuildvrt -q "data/flatness/${kind%.tif}.vrt" data/flatness/*/"$kind"
  echo "Mosaic: data/flatness/${kind%.tif}.vrt"
done
