#!/usr/bin/env bash
# Loads the engine's per-tile CSVs into PostGIS (table `spots_80m`, see
# ../db/schema.sql), then refreshes the counts the map reads (view
# `spot_counts`).
#
# Files already loaded with the same modification time (recorded in table
# `loaded_files`) are skipped, so a rerun only loads what changed. Everything
# new loads in one transaction.
#
# Usage: ./04_load_cells.sh
#   PSQL="psql postgres://..."   how to reach the database (default: the
#                                 Docker Compose database in ../)
set -euo pipefail
cd "$(dirname "$0")"
TILE_M=2000  # tile size: must match TILE_SIZE_M in flatness/src/tile.rs
BLOCK_M=80   # square size: 8 cells of 10 m, as BLOCK_CELLS in flatness/src/main.rs

PSQL="${PSQL:-docker compose -f ../docker-compose.yml exec -T db psql -U campfinder}"
psql_run() { $PSQL -q -v ON_ERROR_STOP=1 "$@"; }

psql_run < ../db/schema.sql
# -1 runs all the -c commands as one transaction. \copy ... FROM pstdin reads
# the CSV from psql's own input, so this works through `docker exec` too.
psql_run -1 \
  -c "DELETE FROM tent" \
  -c "\copy tent (slug, name) FROM pstdin WITH (FORMAT csv, HEADER)" \
  -c "DELETE FROM spots_80m WHERE tent NOT IN (SELECT slug FROM tent)" \
  < data/flatness/tents.csv

# Every tile file with its modification time, as
# "tile<TAB>tent<TAB>season<TAB>mtime" lines, from one perl process (a
# `date` per file took minutes for thousands of files). Files are named
# <tile>/<tent>.<season>.blocks.csv.
files=$(perl -e 'for (@ARGV) {
  -e or next; # a pattern that matched nothing
  my ($tile, $tent, $season) = m{([^/]+)/([^/.]+)\.([a-z]+)\.blocks\.csv$};
  printf "%s\t%s\t%s\t%d\n", $tile, $tent, $season, (stat)[9];
}' data/flatness/E*/*.summer.blocks.csv data/flatness/E*/*.winter.blocks.csv)
# Those not loaded with that modification time yet: grep keeps (-v) the
# lines that aren't (-x whole-line, -F plain text) among the loaded ones (-f).
loaded=$($PSQL -At -F $'\t' -c "SELECT tile, tent, season, csv_mtime FROM loaded_files")
pending=$(grep -vxFf <(echo "$loaded") <<< "$files" || true)
count=$(grep -c . <<< "$pending" || true)
echo "$count tile files to load"

if ((count > 0)); then
  start=$(date +%s)
  # One SQL stream, one transaction: either everything loads or nothing
  # changes. COPY ... FROM STDIN takes the lines that follow it, up to "\.".
  {
    echo "BEGIN;"
    echo "CREATE TEMP TABLE pending (tile text, tent text, season text, csv_mtime bigint);"
    echo "COPY pending FROM STDIN;"
    echo "$pending"
    echo '\.'
    # Each pending file replaces its tile's squares for its tent and season.
    # The tile's south-west corner is in its name: "E0220000_N6864000".
    echo "DELETE FROM spots_80m s USING pending p
      WHERE s.tent = p.tent AND s.season = p.season
        AND s.bx >= substr(p.tile, 2, 7)::int / $BLOCK_M
        AND s.bx < (substr(p.tile, 2, 7)::int + $TILE_M) / $BLOCK_M
        AND s.by >= substr(p.tile, 11, 7)::int / $BLOCK_M
        AND s.by < (substr(p.tile, 11, 7)::int + $TILE_M) / $BLOCK_M;"
    echo "COPY spots_80m (tent, season, bx, by, slopes, cells_up_to_step) FROM STDIN WITH (FORMAT csv);"
    # All the files' rows, without their header lines (FNR is the line
    # number within each file). xargs hands awk hundreds of files at a time
    # (the paths have no spaces).
    awk -F '\t' '{ print "data/flatness/" $1 "/" $2 "." $3 ".blocks.csv" }' <<< "$pending" |
      xargs awk 'FNR > 1'
    echo '\.'
    echo "INSERT INTO loaded_files SELECT * FROM pending
      ON CONFLICT (tile, tent, season) DO UPDATE SET csv_mtime = excluded.csv_mtime;"
    echo "COMMIT;"
  } | psql_run
  echo "Loaded in $(($(date +%s) - start)) s. Refreshing spot counts..."
  # The map keeps reading the old counts until the new ones are ready.
  psql_run -c "REFRESH MATERIALIZED VIEW CONCURRENTLY spot_counts"
  psql_run -c "ANALYZE spots_80m, spot_counts" # fresh statistics for the map's queries
fi

$PSQL -c "SELECT tent, season, count(*) AS squares FROM spots_80m GROUP BY 1, 2 ORDER BY 1, 2" \
  -c "SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size"
