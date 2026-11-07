#!/usr/bin/env bash
# Loads the engine's per-tile CSVs into PostGIS (table `block`, see
# ../db/schema.sql), then refreshes the bins the map reads (view `bin`).
#
# Files already loaded with the same modification time (recorded in table
# `block_load`) are skipped, so a rerun only loads what changed. Everything
# new loads in one transaction.
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

# Every tile file with its modification time, as "tile<TAB>tent<TAB>mtime"
# lines, from one perl process (a `date` per file took minutes for
# thousands of files).
files=$(perl -e 'for (@ARGV) {
  my ($tile, $tent) = m{([^/]+)/([^/]+)\.blocks\.csv$};
  printf "%s\t%s\t%d\n", $tile, $tent, (stat)[9];
}' data/flatness/E*/*.blocks.csv)
# Those not loaded with that modification time yet: grep keeps (-v) the
# lines that aren't (-x whole-line, -F plain text) among the loaded ones (-f).
loaded=$($PSQL -At -F $'\t' -c "SELECT tile, tent, csv_mtime FROM block_load")
pending=$(grep -vxFf <(echo "$loaded") <<< "$files" || true)
count=$(grep -c . <<< "$pending" || true)
echo "$count tile files to load"

if ((count > 0)); then
  start=$(date +%s)
  # One SQL stream, one transaction: either everything loads or nothing
  # changes. COPY ... FROM STDIN takes the lines that follow it, up to "\.".
  {
    echo "BEGIN;"
    echo "CREATE TEMP TABLE pending (tile text, tent text, csv_mtime bigint);"
    echo "COPY pending FROM STDIN;"
    echo "$pending"
    echo '\.'
    # Each pending file replaces its tile's blocks for its tent. The tile's
    # south-west corner is in its name: "E0220000_N6864000".
    echo "DELETE FROM block b USING pending p
      WHERE b.tent = p.tent
        AND b.bx >= substr(p.tile, 2, 7)::int / $BLOCK_M
        AND b.bx < (substr(p.tile, 2, 7)::int + $TILE_M) / $BLOCK_M
        AND b.by >= substr(p.tile, 11, 7)::int / $BLOCK_M
        AND b.by < (substr(p.tile, 11, 7)::int + $TILE_M) / $BLOCK_M;"
    echo "COPY block (tent, bx, by, slopes, cells_up_to_step) FROM STDIN WITH (FORMAT csv);"
    # All the files' rows, without their header lines (FNR is the line
    # number within each file). xargs hands awk hundreds of files at a time
    # (the paths have no spaces).
    awk -F '\t' '{ print "data/flatness/" $1 "/" $2 ".blocks.csv" }' <<< "$pending" |
      xargs awk 'FNR > 1'
    echo '\.'
    echo "INSERT INTO block_load SELECT * FROM pending
      ON CONFLICT (tile, tent) DO UPDATE SET csv_mtime = excluded.csv_mtime;"
    echo "COMMIT;"
  } | psql_run
  echo "Loaded in $(($(date +%s) - start)) s. Refreshing bins..."
  # The map keeps reading the old bins until the new ones are ready.
  psql_run -c "REFRESH MATERIALIZED VIEW CONCURRENTLY bin"
  psql_run -c "ANALYZE block, bin" # fresh statistics for the map's queries
fi

$PSQL -c "SELECT tent, count(*) AS blocks FROM block GROUP BY tent ORDER BY tent" \
  -c "SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size"
