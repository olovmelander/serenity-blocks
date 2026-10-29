#!/usr/bin/env bash
# Interleaved load A/B at the panel's cadence (vsync on, target 240, second visits on).
# usage: BENCH_OUT=<dir> bash scripts/lib/theme-bench-tools/ab-load.sh <tag> <themes,comma> <rounds> <urlA> <urlB> [extra bench args]
# Table: node scripts/lib/theme-bench-tools/ab-load-table.mjs <tag> <rounds>
set -u
TAG=$1; THEMES=$2; ROUNDS=$3; A=$4; B=$5; shift 5
OUT=${BENCH_OUT:?set BENCH_OUT to the results directory}
cd "$(dirname "$0")/../../.."
for r in $(seq 1 "$ROUNDS"); do
  for arm in A B; do
    URL=$A; [ "$arm" = B ] && URL=$B
    node scripts/theme-fleet-bench.mjs --base-url="$URL" --themes="$THEMES" --tag="$TAG-$arm-r$r" --out="$OUT" \
      --shots=0 --vsync=1 --target-fps=240 --rest-ms=2000 --storm-ms=2000 "$@" 2>&1 | grep "\[bench\]  "
  done
done
