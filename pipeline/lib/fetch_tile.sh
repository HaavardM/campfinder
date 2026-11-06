#!/usr/bin/env bash
# Fetches one tile: the 1 m terrain model from Kartverket, and a water mask on
# exactly the same pixel grid. Skips whatever already exists.
#
# Usage: lib/fetch_tile.sh EAST NORTH   (south-west corner, EPSG:25833 metres)
#
# Prints one line, starting with "downloaded" or "skipped", which
# 02_download_tiles.sh turns into a progress report.
set -euo pipefail

EAST=$1
NORTH=$2
TILE_M=2000
BUFFER_M=8 # must match BUFFER_M in flatness/src/tile.rs
SIZE_PX=$((TILE_M + 2 * BUFFER_M))

NAME=$(printf "E%07d_N%07d" "$EAST" "$NORTH")
# The tile plus its border, as west south east north.
W=$((EAST - BUFFER_M))
S=$((NORTH - BUFFER_M))
E=$((EAST + TILE_M + BUFFER_M))
N=$((NORTH + TILE_M + BUFFER_M))

DTM="data/dtm/$NAME.tif"
MASK="data/water/$NAME.tif"
if [[ -f $DTM && -f $MASK ]]; then
  echo "skipped $NAME"
  exit 0
fi

start=$(date +%s.%N)
if [[ ! -f $DTM ]]; then
  # Kartverket's terrain model as a Web Coverage Service: ask for any box and
  # pixel count, get a GeoTIFF back. 1 m pixels because width = height = size.
  WCS="https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833"
  QUERY="SERVICE=WCS&VERSION=1.0.0&REQUEST=GetCoverage&COVERAGE=nhm_dtm_topo_25833"
  QUERY="$QUERY&CRS=EPSG:25833&FORMAT=GeoTIFF&BBOX=$W,$S,$E,$N&WIDTH=$SIZE_PX&HEIGHT=$SIZE_PX"
  curl -sf --retry 3 -o "$DTM.part" "$WCS?$QUERY"
  # Errors can come back as XML with status 200, so check it is a TIFF.
  if [[ $(head -c 2 "$DTM.part") != "II" ]]; then
    echo "$NAME: terrain download failed: $(head -c 300 "$DTM.part")" >&2
    rm -f "$DTM.part"
    exit 1
  fi
  mv "$DTM.part" "$DTM"
fi

if [[ ! -f $MASK ]]; then
  # Burn 1 into every pixel touched by a water polygon (-at, "all touched":
  # better to lose a metre of shore than to pitch a tent in a lake).
  gdal_rasterize -q -l water -burn 1 -init 0 -at -ot Byte \
    -te "$W" "$S" "$E" "$N" -tr 1 1 -co COMPRESS=DEFLATE \
    data/water.gpkg "$MASK.part.tif"
  mv "$MASK.part.tif" "$MASK"
fi
end=$(date +%s.%N)

megabytes=$(awk "BEGIN { print $(stat -c %s "$DTM" 2> /dev/null || stat -f %z "$DTM") / 1e6 }")
awk -v name="$NAME" -v mb="$megabytes" -v s="$(awk "BEGIN { print $end - $start }")" \
  'BEGIN { printf "downloaded %s  %.1f MB in %.1f s (%.1f MB/s)\n", name, mb, s, mb / s }'
