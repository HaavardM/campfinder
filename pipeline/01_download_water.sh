#!/usr/bin/env bash
# Water polygons (lakes, rivers, sea) from Kartverket's N50 map data, for the
# counties a region lists in N50_COUNTIES, collected into data/water.gpkg.
#
# The terrain model alone can't tell a calm lake from flat ground, so water is
# masked out using these polygons.
#
# Usage: ./01_download_water.sh regions/dovre.env
#
# Each county is downloaded and added once (marked by data/n50/<county>.added),
# so counties shared between regions cost nothing the second time.
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck source=/dev/null  # sets N50_COUNTIES, e.g. "34_Innlandet 50_Trondelag"
source "$1"
BASE_URL=https://nedlasting.geonorge.no/geonorge/Basisdata/N50Kartdata/FGDB
WATER=data/water.gpkg

mkdir -p data/n50
for county in $N50_COUNTIES; do
  name="Basisdata_${county}_25833_N50Kartdata_FGDB"
  zip="data/n50/$name.zip"
  added="data/n50/$county.added"
  if [[ -f $added ]]; then
    echo "Water polygons for $county: already added"
    continue
  fi

  if [[ ! -f $zip ]]; then
    echo "Downloading N50 map data for $county..."
    curl -fL --retry 3 --progress-bar -o "$zip.part" "$BASE_URL/$name.zip"
    mv "$zip.part" "$zip"
  fi

  # GDAL reads straight from the zip. The first county creates water.gpkg,
  # later ones are appended (-update -append, which needs -sql rather than
  # -select). Polygons along county borders may then appear twice, which is
  # harmless for a mask.
  echo "Adding water polygons for $county..."
  mode=()
  [[ -f $WATER ]] && mode=(-update -append)
  ogr2ogr -f GPKG "${mode[@]}" "$WATER" "/vsizip/$zip/$name.gdb" \
    -sql "SELECT objtype FROM N50_Arealdekke_omrade
          WHERE objtype IN ('Innsjø', 'InnsjøRegulert', 'Elv', 'FerskvannTørrfall', 'Havflate')" \
    -nln water -nlt MULTIPOLYGON -progress
  touch "$added"
done
