#!/usr/bin/env bash
# Loads the engine's per-tile CSVs into PostGIS (table `cell`, see
# ../db/schema.sql), then rebuilds the bins the map reads (../db/bins.sql).
#
# Files already loaded with the same modification time (recorded in table
# `cell_load`) are skipped, so a rerun only loads what changed. Each file
# replaces its tile in its own transaction.
#
# Usage: ./04_load_cells.sh
#   PSQL="psql postgres://..."   how to reach the database (default: the
#                                 Docker Compose database in ../)
set -euo pipefail
cd "$(dirname "$0")"
TILE_M=2000 # tile size: must match TILE_SIZE_M in flatness/src/tile.rs

PSQL="${PSQL:-docker compose -f ../docker-compose.yml exec -T db psql -U campfinder}"
psql_run() { $PSQL -q -v ON_ERROR_STOP=1 "$@"; }

psql_run < ../db/schema.sql
# -1 runs all the -c commands as one transaction. \copy ... FROM pstdin reads
# the CSV from psql's own input, so this works through `docker exec` too.
psql_run -1 \
  -c "DELETE FROM tent" \
  -c "\copy tent (slug, name) FROM pstdin WITH (FORMAT csv, HEADER)" \
  -c "DELETE FROM cell WHERE tent NOT IN (SELECT slug FROM tent)" \
  < data/flatness/tents.csv

# What's already loaded, as "tile tent mtime" lines.
loaded=$($PSQL -At -F ' ' -c "SELECT tile, tent, csv_mtime FROM cell_load")
pending=()
for csv in data/flatness/E*/*.cells.csv; do
  tile=$(basename "$(dirname "$csv")")
  tent=$(basename "$csv" .cells.csv)
  grep -qxF "$tile $tent $(date -r "$csv" +%s)" <<< "$loaded" || pending+=("$csv")
done
echo "${#pending[@]} tile files to load"

if ((${#pending[@]} > 0)); then
  start=$(date +%s)
  # One SQL stream for all files, into a single psql session (starting one
  # per file through Docker costs ~0.3 s each). COPY ... FROM STDIN takes the
  # CSV lines that follow it, up to the "\." line.
  count=0
  for csv in "${pending[@]}"; do
    count=$((count + 1))
    tile=$(basename "$(dirname "$csv")")
    tent=$(basename "$csv" .cells.csv)
    east=$((10#${tile:1:7})) # "E0220000_N6864000" → 220000
    north=$((10#${tile:10:7}))
    echo "BEGIN;"
    echo "DELETE FROM cell WHERE tent = '$tent'"
    echo "  AND x >= $east AND x < $((east + TILE_M)) AND y >= $north AND y < $((north + TILE_M));"
    echo "COPY cell (tent, x, y, max_slope_deg, heading_deg, elevation_m) FROM STDIN WITH (FORMAT csv, HEADER);"
    cat "$csv"
    echo '\.'
    echo "INSERT INTO cell_load VALUES ('$tile', '$tent', $(date -r "$csv" +%s))"
    echo "  ON CONFLICT (tile, tent) DO UPDATE SET csv_mtime = excluded.csv_mtime;"
    echo "COMMIT;"
    printf '\\echo [%d/%d] loaded %s %s\n' "$count" "${#pending[@]}" "$tile" "$tent" # psql prints this
  done | psql_run
  echo "Loaded in $(($(date +%s) - start)) s. Rebuilding bins..."
  psql_run < ../db/bins.sql
fi

$PSQL -c "SELECT tent, count(*) AS cells FROM cell GROUP BY tent ORDER BY tent"
