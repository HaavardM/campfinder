#!/usr/bin/env bash
# Deletes the .pmtiles files in the R2 bucket that the live manifest.json no
# longer names: the older versions publish.sh leaves behind. They count
# towards R2's free 10 GB, and past that storage costs money. Deleting is
# free. A browser tab still open on the previous map needs a reload after.
#
# Usage: ./prune.sh            list what would be deleted
#        ./prune.sh --delete   delete it
#   Needs the same rclone remote "r2" as publish.sh. Run after publishing.
set -euo pipefail
bucket=r2:campfinder-map

# The files the site uses now, from the manifest in the bucket itself.
keep=$(rclone cat "$bucket/manifest.json" | grep -o '[^"]*\.pmtiles' || true)
if [[ -z $keep ]]; then
  echo "manifest.json names no .pmtiles files: deleting nothing" >&2
  exit 1
fi

old=$(rclone lsf "$bucket" --include "*.pmtiles" | grep -vxF "$keep" || true)
if [[ -z $old ]]; then
  echo "Nothing to delete."
  exit 0
fi
echo "Not in manifest.json:"
echo "$old" | sed 's/^/  /'
if [[ ${1:-} != --delete ]]; then
  echo "Rerun with --delete to delete them."
  exit 0
fi
for name in $old; do
  rclone deletefile "$bucket/$name"
done
echo "Deleted $(echo "$old" | wc -l | tr -d ' ') files."
