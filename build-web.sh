#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${EMSDK:?Install and activate Emscripten, then source emsdk_env.sh first.}"
npm --prefix web ci --ignore-scripts
ctr_preset=web-release
ctr_headless=false
ctr_probes=false
for ctr_arg in "$@"; do
  case "$ctr_arg" in
    --headless) ctr_headless=true ;;
    --probes) ctr_probes=true ;;
    *) echo "Unknown argument: $ctr_arg" >&2; exit 1 ;;
  esac
done
if $ctr_headless; then ctr_preset=online-v2-release; fi
if $ctr_probes; then
  if $ctr_headless; then ctr_preset=online-v2-probe-release; else ctr_preset=web-probe-release; fi
fi
cmake --preset "$ctr_preset"
cmake --build --preset "$ctr_preset" --parallel
echo "Built $ctr_preset. See docs/ONLINE_V2.md for running the prototype."
