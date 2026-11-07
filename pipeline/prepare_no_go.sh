#!/usr/bin/env bash
# Where no tent may go, from Kartverket's N50 map data, as one GeoPackage of
# polygons per region (data/no-go/<region>.gpkg), which the flatness engine
# burns into each tile's mask. Next to it, <region>.recipe fingerprints the
# queries below: change them and the next run rebuilds the file, and the
# engine redoes the tiles.
#
# Usage: ./prepare_no_go.sh regions/rondane.env [regions/dovre.env ...]
# (Other arguments are ignored, so run.sh can pass on all of its own.)
#
# Needs GDAL's ogr2ogr (macOS: brew install gdal; Debian: apt install
# gdal-bin): Kartverket publishes N50 only as an Esri file geodatabase,
# which only GDAL reads. The flatness engine itself doesn't need GDAL.
set -euo pipefail
cd "$(dirname "$0")"

BASE_URL=https://nedlasting.geonorge.no/geonorge/Basisdata/N50Kartdata/FGDB
# The allemannsrett: no camping within 150 m of an inhabited house or cabin.
HOUSE_DISTANCE_M=150
# Keep just off the water's edge, where N50's shorelines put spots on the
# waterline. Small on purpose: camping by the water is half the point.
SHORE_M=2
WATER="'Innsjø', 'InnsjøRegulert', 'Elv', 'FerskvannTørrfall', 'Havflate'"
# Land in use, as flat as it gets and no place for a tent.
IN_USE="'DyrketMark', 'Industriområde', 'Golfbane', 'SportIdrettPlass', 'Alpinbakke',
  'Gravplass', 'Park', 'Lufthavn', 'Rullebane', 'Steinbrudd', 'Steintipp'"

# Step 1 copies these from each county's N50 into a small GeoPackage, cut to
# the region: N50 layer, then which objects (an attribute filter). The
# geodatabase driver applies both filters itself, which is fast.
COPIES=(
  "N50_Arealdekke_omrade" "objtype IN ($WATER, 'Myr', $IN_USE,
    'Tettbebyggelse', 'BymessigBebyggelse')"
  "N50_Arealdekke_senterlinje" "objtype = 'ElvBekk'"
  # Inhabited buildings, by the building register's type: 111–179 are
  # houses, cabins, summer farms and mountain huts (not barns, garages or
  # tourist huts, which usually have camping right next to them).
  "N50_BygningerOgAnlegg_posisjon" "objtype = 'Bygning' AND bygningstype BETWEEN 111 AND 179"
  # Roads, tracks, trails and railways, except in tunnels (medium U).
  "N50_Samferdsel_senterlinje" "objtype IN ('Veglenke', 'Bane') AND (medium IS NULL OR medium <> 'U')"
)
# Step 2 turns the copies into no-go polygons, one query per kind. ST_Buffer
# widens a shape by a distance; the third argument is the points per quarter
# circle (4 makes a 16-sided circle, close enough; 1 cuts corners square).
QUERIES=(
  # Water, and its shore.
  "SELECT objtype AS kind, ST_Buffer(geom, $SHORE_M, 1) AS geom
   FROM N50_Arealdekke_omrade WHERE objtype IN ($WATER)"
  # Bogs, farmland (no camping on cultivated land) and other land in use,
  # as mapped.
  "SELECT objtype AS kind, geom FROM N50_Arealdekke_omrade
   WHERE objtype IN ('Myr', $IN_USE)"
  # Built-up areas, and their 150 m.
  "SELECT objtype AS kind, ST_Buffer(geom, $HOUSE_DISTANCE_M, 4) AS geom
   FROM N50_Arealdekke_omrade
   WHERE objtype IN ('Tettbebyggelse', 'BymessigBebyggelse')"
  # Streams are lines in N50: the shore either side.
  "SELECT objtype AS kind, ST_Buffer(geom, $SHORE_M, 1) AS geom FROM N50_Arealdekke_senterlinje"
  "SELECT 'Bolig' AS kind, ST_Buffer(geom, $HOUSE_DISTANCE_M, 4) AS geom
   FROM N50_BygningerOgAnlegg_posisjon"
  # Roads and railways are centre lines: half their width, the verge and
  # N50's inaccuracy either side. Trails only for the trail itself.
  "SELECT coalesce(typeveg, objtype) AS kind, ST_Buffer(geom, CASE
     WHEN objtype = 'Bane' OR typeveg = 'enkelBilveg' THEN 8
     WHEN typeveg = 'sti' THEN 2
     ELSE 4 END, 1) AS geom
   FROM N50_Samferdsel_senterlinje"
)
recipe=$(printf '%s\n' "${COPIES[@]}" "${QUERIES[@]}" | shasum | cut -c1-12)

mkdir -p data/n50 data/no-go
for region in "$@"; do
  [[ $region == *.env ]] || continue
  # shellcheck source=/dev/null  # sets WEST, SOUTH, EAST, NORTH, N50_COUNTIES
  source "$region"
  name=$(basename "$region" .env)
  gpkg="data/no-go/$name.gpkg"
  [[ -f $gpkg && $(cat "data/no-go/$name.recipe" 2>/dev/null) == "$recipe" ]] && continue

  echo "Collecting no-go areas for $region..."
  # GDAL needs the .gpkg extension to pick the format, hence the odd names.
  copy="$gpkg.copy.gpkg"
  part="$gpkg.part.gpkg"
  rm -f "$copy" "$part"
  # The region's box, widened so a house just outside it still counts.
  margin=$HOUSE_DISTANCE_M
  box=($((WEST - margin)) $((SOUTH - margin)) $((EAST + margin)) $((NORTH + margin)))

  for county in $N50_COUNTIES; do
    source_name="Basisdata_${county}_25833_N50Kartdata_FGDB"
    zip="data/n50/$source_name.zip"
    if [[ ! -f $zip ]]; then
      echo "Downloading N50 map data for $county..."
      curl -fL --retry 3 --progress-bar -o "$zip.part" "$BASE_URL/$source_name.zip"
      mv "$zip.part" "$zip"
    fi
    # GDAL reads straight from the zip (/vsizip/). -append adds this
    # county's objects to the layers of the previous ones.
    for ((i = 0; i < ${#COPIES[@]}; i += 2)); do
      ogr2ogr -f GPKG -append "$copy" "/vsizip/$zip/$source_name.gdb" "${COPIES[i]}" \
        -where "${COPIES[i + 1]}" -spat "${box[@]}" -nln "${COPIES[i]}" -lco GEOMETRY_NAME=geom
    done
  done

  for query in "${QUERIES[@]}"; do
    # The first query creates the file, the rest add to it.
    append=()
    [[ -f $part ]] && append=(-update -append)
    ogr2ogr -f GPKG ${append[@]+"${append[@]}"} "$part" "$copy" \
      -dialect SQLite -sql "$query" -nln no_go -nlt MULTIPOLYGON
  done
  rm "$copy"
  mv "$part" "$gpkg"
  echo "$recipe" > "data/no-go/$name.recipe"
done
