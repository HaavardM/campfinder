#!/usr/bin/env bash
# One-time setup on the WSL Debian machine: GDAL command-line tools, curl,
# GNU time (for peak-memory reports), a C toolchain and Rust.
set -euo pipefail

sudo apt-get update
sudo apt-get install -y curl gdal-bin time build-essential

if ! command -v rustup > /dev/null; then
  # The official installer from https://rustup.rs
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  echo "Rust installed. Open a new shell (or run: source ~/.cargo/env) before ./run.sh"
fi
