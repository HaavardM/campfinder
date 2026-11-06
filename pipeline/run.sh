#!/usr/bin/env bash
# The whole pipeline. Safe to rerun at any time: every step skips work that
# is already done.
#
# Usage: ./run.sh                       every region in regions/ except test*
#        ./run.sh regions/test.env      just the given region(s)
set -euo pipefail
cd "$(dirname "$0")"

if [[ $# -gt 0 ]]; then
  regions=("$@")
else
  regions=()
  for region in regions/*.env; do
    [[ $region == regions/test* ]] || regions+=("$region")
  done
fi

./01_download_water.sh
for region in "${regions[@]}"; do
  ./02_download_tiles.sh "$region"
done
./03_flatness.sh
