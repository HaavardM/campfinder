#!/usr/bin/env bash
# Where the car can be parked, from OpenStreetMap: one point per parking lot
# in all of Norway, in data/parking/parking.gpkg. build_map.sh measures how
# much flat ground each lot has around it, and how far each tent spot is
# from the nearest one.
#
# Usage: ./prepare_parking.sh
# (The file covers the whole country, so a spot near a region's edge still
# finds parking just outside it.)
#
# Downloads Geofabrik's extract of Norway (about 1.3 GB) once, into
# data/osm/. Delete it to fetch fresh data on the next run. Next to the
# result, parking.recipe fingerprints the queries below: change them and
# the next run rebuilds the file.
#
# Needs GDAL's ogr2ogr, which reads OSM's .pbf files directly. Reading all
# of Norway takes a few minutes; it only happens when something changed.
set -euo pipefail
cd "$(dirname "$0")"

PBF_URL=https://download.geofabrik.de/europe/norway-latest.osm.pbf
pbf=data/osm/norway-latest.osm.pbf
gpkg=data/parking/parking.gpkg

# Parking a hiker may not use. OSM's `access` tag, when it's there: most
# lots don't have one, which means open to all.
NOT_FOR_US="'private', 'no', 'customers', 'permit', 'delivery'"

# GDAL's OSM driver makes a few fixed layers: `points` for tagged nodes and
# `multipolygons` for areas (closed ways and multipolygon relations). Common
# tags get their own column (`amenity` on areas); the rest are packed into
# `other_tags`, read with hstore_get_value. A parking lot can be either
# kind, so one query per layer, both into the same `parking` layer.
#
# Columns:
#   osm_id  "node/123", "way/456" or "relation/789": open it on
#           openstreetmap.org/<osm_id> to see or fix the lot
#   name    when it has one
#   hiking  1 if tagged hiking=yes: the lot is for people setting out on a
#           hike, a trailhead. Most trailhead lots don't have the tag yet.
#   fee     OSM's fee tag: "yes", "no" or missing
QUERIES=(
  "SELECT 'node/' || osm_id AS osm_id, name,
     hstore_get_value(other_tags, 'hiking') IS 'yes' AS hiking,
     hstore_get_value(other_tags, 'fee') AS fee, geometry
   FROM points
   WHERE hstore_get_value(other_tags, 'amenity') = 'parking'
     AND coalesce(hstore_get_value(other_tags, 'access'), '') NOT IN ($NOT_FOR_US)"
  # An area becomes the point used for distances: ST_PointOnSurface is
  # always inside it, unlike the centre of an L-shaped lot.
  "SELECT CASE WHEN osm_way_id IS NOT NULL THEN 'way/' || osm_way_id
       ELSE 'relation/' || osm_id END AS osm_id, name,
     hstore_get_value(other_tags, 'hiking') IS 'yes' AS hiking,
     hstore_get_value(other_tags, 'fee') AS fee,
     ST_PointOnSurface(geometry) AS geometry
   FROM multipolygons
   WHERE amenity = 'parking'
     AND coalesce(hstore_get_value(other_tags, 'access'), '') NOT IN ($NOT_FOR_US)"
)
recipe=$(printf '%s\n' "${QUERIES[@]}" | shasum | cut -c1-12)

mkdir -p data/osm data/parking
if [[ ! -f $pbf ]]; then
  echo "Downloading OpenStreetMap data for Norway..."
  curl -fL --retry 3 --progress-bar -o "$pbf.part" "$PBF_URL"
  mv "$pbf.part" "$pbf"
fi
# Up to date: made from this download, with these queries.
[[ $gpkg -nt $pbf && $(cat data/parking/parking.recipe 2>/dev/null) == "$recipe" ]] && exit 0

echo "Collecting parking from OpenStreetMap..."
part="$gpkg.part.gpkg" # GDAL picks the format by the extension
rm -f "$part"
for query in "${QUERIES[@]}"; do
  # The first query creates the file, the second adds to it.
  mode=(-lco GEOMETRY_NAME=geom)
  [[ -f $part ]] && mode=(-update -append)
  # OSM is in longitude/latitude; -t_srs turns it into UTM 33 metres, like
  # everything else here. To build areas, GDAL indexes every node's
  # position; OSM_MAX_TMPFILE_SIZE (MB) keeps that index in memory rather
  # than the default 100 MB before spilling to a temporary file on disk.
  ogr2ogr -f GPKG "${mode[@]}" "$part" "$pbf" -t_srs EPSG:25833 \
    -dialect SQLite -sql "$query" -nln parking -nlt POINT \
    --config OSM_MAX_TMPFILE_SIZE 4096
done
mv "$part" "$gpkg"
echo "$recipe" > data/parking/parking.recipe
