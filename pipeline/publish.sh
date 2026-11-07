#!/usr/bin/env bash
# Uploads the map's files (data/map) to the Cloudflare R2 bucket that the
# site's Worker serves them from (see web/wrangler.toml). The site
# itself is built and deployed by Cloudflare on every push to GitHub.
#
# The .pmtiles files go first and manifest.json last, so the manifest never
# names a file that isn't there yet. A .pmtiles name holds a hash of its
# content, so one that was uploaded before (listed in data/map/.published)
# is skipped. Older .pmtiles files stay, so browsers with the previous
# manifest still work; delete them by hand now and then.
#
# Usage: ./publish.sh   (log in once first: cd ../web && npx wrangler login)
#   wrangler uploads at most about 300 MiB per file.
set -euo pipefail
cd "$(dirname "$0")"
map=$PWD/data/map
published=$map/.published
bucket=campfinder-map

cd ../web
touch "$published"
for file in "$map"/*.pmtiles "$map"/manifest.json; do
  name=$(basename "$file")
  grep -qxF "$name" "$published" && continue
  npx wrangler r2 object put "$bucket/$name" --file "$file" --remote
  if [[ $name == *.pmtiles ]]; then echo "$name" >> "$published"; fi
done
