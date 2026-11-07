#!/usr/bin/env bash
# Publishes the web app and the map's files to a Google Cloud Storage bucket
# served as a website, in the order caching needs:
#
# 1. the .pmtiles files (new names only; cached for good),
# 2. the web app (its assets have hashed names too; index.html isn't cached),
# 3. manifest.json last, uncached, so it never names a file that isn't there.
#
# Older .pmtiles files stay, so browsers with the previous manifest still
# work; delete them by hand now and then.
#
# Usage: ./publish.sh gs://<bucket>
#   Build the app first: (cd ../web && VITE_MAP_URL=/map pnpm build)
#   For S3, the same with `aws s3 cp --cache-control ...`.
set -euo pipefail
cd "$(dirname "$0")"
bucket=${1:?usage: ./publish.sh gs://<bucket>}

forever="public, max-age=31536000, immutable"
gcloud storage cp --no-clobber --cache-control="$forever" data/map/*.pmtiles "$bucket/map/"
gcloud storage cp --recursive --cache-control="$forever" ../web/dist/client/assets "$bucket/"
gcloud storage cp --cache-control=no-cache ../web/dist/client/index.html \
  ../web/dist/client/favicon.svg "$bucket/"
gcloud storage cp --cache-control=no-cache data/map/manifest.json "$bucket/map/"
