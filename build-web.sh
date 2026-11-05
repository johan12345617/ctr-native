#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${EMSDK:?Install and activate Emscripten, then source emsdk_env.sh first.}"
npm --prefix web ci --ignore-scripts
cmake --preset web-release
cmake --build --preset web-release --parallel
echo "Built build-web. Start local and online play with: npm --prefix web start"
