#!/usr/bin/env bash
# Uploads the map's files (data/map) to the Cloudflare R2 bucket that the
# site's Worker serves them from (see web/wrangler.toml). The site
# itself is built and deployed by Cloudflare on every push to GitHub.
#
# Uses rclone through R2's S3 API, not wrangler: wrangler uploads at most
# 300 MiB per file, and the map files are bigger. rclone sends big files in
# parts.
#
# The .pmtiles files go first and manifest.json last, so the manifest never
# names a file that isn't there yet. A .pmtiles name holds a hash of its
# content, so one already in the bucket is skipped. Older .pmtiles files
# stay, so browsers with the previous manifest still work; ./prune.sh
# deletes them.
#
# Usage: ./publish.sh
#   Set up once: an rclone remote named "r2" for the bucket (see README).
set -euo pipefail
cd "$(dirname "$0")"
bucket=r2:campfinder-map

rclone copy data/map "$bucket" --include "*.pmtiles" --ignore-existing --progress
rclone copyto data/map/manifest.json "$bucket/manifest.json"
