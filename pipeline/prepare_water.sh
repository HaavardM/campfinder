#!/usr/bin/env bash
# Water polygons (lakes, rivers, sea) for the N50 counties the given regions
# list, as one small GeoPackage per county (data/n50/<county>.water.gpkg),
# which the flatness engine reads. Each county is done once.
#
# Usage: ./prepare_water.sh regions/rondane.env [regions/dovre.env ...]
# (Other arguments are ignored, so run.sh can pass on all of its own.)
#
# Needs GDAL's ogr2ogr (macOS: brew install gdal; Debian: apt install
# gdal-bin): Kartverket publishes N50 only as an Esri file geodatabase,
# which only GDAL reads. The flatness engine itself doesn't need GDAL.
set -euo pipefail
cd "$(dirname "$0")"

BASE_URL=https://nedlasting.geonorge.no/geonorge/Basisdata/N50Kartdata/FGDB
mkdir -p data/n50

for region in "$@"; do
  [[ $region == *.env ]] || continue
  # shellcheck source=/dev/null  # sets N50_COUNTIES, e.g. "34_Innlandet 50_Trondelag"
  source "$region"
  for county in $N50_COUNTIES; do
    gpkg="data/n50/$county.water.gpkg"
    [[ -f $gpkg ]] && continue

    name="Basisdata_${county}_25833_N50Kartdata_FGDB"
    zip="data/n50/$name.zip"
    if [[ ! -f $zip ]]; then
      echo "Downloading N50 map data for $county..."
      curl -fL --retry 3 --progress-bar -o "$zip.part" "$BASE_URL/$name.zip"
      mv "$zip.part" "$zip"
    fi

    # GDAL reads straight from the zip (/vsizip/). The temporary name keeps
    # the .gpkg extension, which GDAL uses to pick the format.
    echo "Extracting water polygons for $county..."
    rm -f "$gpkg.part.gpkg"
    ogr2ogr -f GPKG "$gpkg.part.gpkg" "/vsizip/$zip/$name.gdb" N50_Arealdekke_omrade \
      -where "objtype IN ('Innsjø', 'InnsjøRegulert', 'Elv', 'FerskvannTørrfall', 'Havflate')" \
      -select objtype -nln water -nlt MULTIPOLYGON
    mv "$gpkg.part.gpkg" "$gpkg"
  done
done
