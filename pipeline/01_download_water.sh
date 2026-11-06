#!/usr/bin/env bash
# Water polygons (lakes, rivers, sea) for all of Norway, from Kartverket's N50
# map data, extracted once into data/water.gpkg.
#
# The terrain model alone can't tell a calm lake from flat ground, so water is
# masked out using these polygons. Run with --refresh to download again.
set -euo pipefail
cd "$(dirname "$0")"

N50_URL="${N50_URL:-https://nedlasting.geonorge.no/geonorge/Basisdata/N50Kartdata/FGDB/Basisdata_0000_Norge_25833_N50Kartdata_FGDB.zip}"
ZIP="data/n50/$(basename "$N50_URL")"
WATER=data/water.gpkg

if [[ -f $WATER && ${1:-} != --refresh ]]; then
  echo "Water polygons: $WATER already exists"
  exit 0
fi

mkdir -p data/n50
if [[ ! -f $ZIP || ${1:-} == --refresh ]]; then
  echo "Downloading N50 map data (about 4 GB for all of Norway)..."
  curl -fL --retry 3 --progress-bar -o "$ZIP.part" "$N50_URL"
  mv "$ZIP.part" "$ZIP"
fi

# GDAL reads straight from the zip. The geodatabase inside is named like the
# zip, with .gdb instead of .zip.
GDB="/vsizip/$ZIP/$(basename "$ZIP" .zip).gdb"
echo "Extracting water polygons..."
rm -f "$WATER.part"
ogr2ogr -f GPKG "$WATER.part" "$GDB" N50_Arealdekke_omrade \
  -where "objtype IN ('Innsjø', 'InnsjøRegulert', 'Elv', 'FerskvannTørrfall', 'Havflate')" \
  -select objtype -nln water -nlt MULTIPOLYGON -progress
mv "$WATER.part" "$WATER"
echo "Water polygons: $WATER"
