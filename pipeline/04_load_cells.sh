#!/usr/bin/env bash
# Loads the engine's per-tile CSVs into PostGIS (table `cell`, see
# ../db/schema.sql). Each file replaces that tile and tent in one
# transaction, so rerunning is safe; files already loaded are skipped.
#
# Usage: ./04_load_cells.sh
#   PSQL="psql postgres://..."   how to reach the database (default: the
#                                 Docker Compose database in ../)
set -euo pipefail
cd "$(dirname "$0")"

PSQL="${PSQL:-docker compose -f ../docker-compose.yml exec -T db psql -U campfinder}"

$PSQL -q -v ON_ERROR_STOP=1 < ../db/schema.sql
{
  echo "BEGIN;"
  echo "DELETE FROM tent;"
  echo "COPY tent (slug, name) FROM STDIN WITH (FORMAT csv, HEADER);"
  cat data/flatness/tents.csv
  echo '\.'
  echo "COMMIT;"
} | $PSQL -q -v ON_ERROR_STOP=1

files=(data/flatness/E*/*.cells.csv)
count=0
for csv in "${files[@]}"; do
  count=$((count + 1))
  marker="${csv%.csv}.loaded"
  [[ $marker -nt $csv ]] && continue

  tile=$(basename "$(dirname "$csv")")
  tent=$(basename "$csv" .cells.csv)
  # psql reads this whole stream as one script. COPY ... FROM STDIN takes
  # the CSV lines that follow it, up to the "\." line.
  {
    echo "BEGIN;"
    echo "DELETE FROM cell WHERE tile = '$tile' AND tent = '$tent';"
    echo "COPY cell (tent, tile, x, y, max_slope_deg, heading_deg, elevation_m) FROM STDIN WITH (FORMAT csv, HEADER);"
    cat "$csv"
    echo '\.'
    echo "COMMIT;"
  } | $PSQL -q -v ON_ERROR_STOP=1
  touch "$marker"
  echo "[$count/${#files[@]}] loaded $tile $tent ($(($(wc -l < "$csv") - 1)) cells)"
done

$PSQL -q -c "ANALYZE cell;"
$PSQL -c "SELECT tent, count(*) AS cells FROM cell GROUP BY tent ORDER BY tent;"
