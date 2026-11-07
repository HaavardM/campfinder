#!/usr/bin/env bash
# Loads the engine's per-tile CSVs into PostGIS (table `block`, see
# ../db/schema.sql), then refreshes the bins the map reads (view `bin`).
#
# Files already loaded with the same modification time (recorded in table
# `block_load`) are skipped, so a rerun only loads what changed. Each file
# replaces its tile in its own transaction.
#
# Usage: ./04_load_cells.sh
#   PSQL="psql postgres://..."   how to reach the database (default: the
#                                 Docker Compose database in ../)
set -euo pipefail
cd "$(dirname "$0")"
TILE_M=2000  # tile size: must match TILE_SIZE_M in flatness/src/tile.rs
BLOCK_M=80   # block size: 8 cells of 10 m, as in flatness/src/main.rs

PSQL="${PSQL:-docker compose -f ../docker-compose.yml exec -T db psql -U campfinder}"
psql_run() { $PSQL -q -v ON_ERROR_STOP=1 "$@"; }

psql_run < ../db/schema.sql
# -1 runs all the -c commands as one transaction. \copy ... FROM pstdin reads
# the CSV from psql's own input, so this works through `docker exec` too.
psql_run -1 \
  -c "DELETE FROM tent" \
  -c "\copy tent (slug, name) FROM pstdin WITH (FORMAT csv, HEADER)" \
  -c "DELETE FROM block WHERE tent NOT IN (SELECT slug FROM tent)" \
  < data/flatness/tents.csv

# What's already loaded, as "tile tent mtime" lines.
loaded=$($PSQL -At -F ' ' -c "SELECT tile, tent, csv_mtime FROM block_load")
pending=()
for csv in data/flatness/E*/*.blocks.csv; do
  tile=$(basename "$(dirname "$csv")")
  tent=$(basename "$csv" .blocks.csv)
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
    tent=$(basename "$csv" .blocks.csv)
    east=$((10#${tile:1:7})) # "E0220000_N6864000" → 220000
    north=$((10#${tile:10:7}))
    echo "BEGIN;"
    echo "DELETE FROM block WHERE tent = '$tent'"
    echo "  AND bx >= $((east / BLOCK_M)) AND bx < $(((east + TILE_M) / BLOCK_M))"
    echo "  AND by >= $((north / BLOCK_M)) AND by < $(((north + TILE_M) / BLOCK_M));"
    echo "COPY block (tent, bx, by, slopes, cells_up_to_step) FROM STDIN WITH (FORMAT csv, HEADER);"
    cat "$csv"
    echo '\.'
    echo "INSERT INTO block_load VALUES ('$tile', '$tent', $(date -r "$csv" +%s))"
    echo "  ON CONFLICT (tile, tent) DO UPDATE SET csv_mtime = excluded.csv_mtime;"
    echo "COMMIT;"
    printf '\\echo [%d/%d] loaded %s %s\n' "$count" "${#pending[@]}" "$tile" "$tent" # psql prints this
  done | psql_run
  echo "Loaded in $(($(date +%s) - start)) s. Refreshing bins..."
  # The map keeps reading the old bins until the new ones are ready.
  psql_run -c "REFRESH MATERIALIZED VIEW CONCURRENTLY bin"
  psql_run -c "ANALYZE block, bin" # fresh statistics for the map's queries
fi

$PSQL -c "SELECT tent, count(*) AS blocks FROM block GROUP BY tent ORDER BY tent" \
  -c "SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size"
