#!/usr/bin/env bash
# Interleaved A/B of two served builds over the same themes, uncapped (vsync off), rest + storms.
# usage: BENCH_OUT=<dir> bash scripts/lib/theme-bench-tools/ab.sh <tag> <themes,comma> <rounds> <urlA> <urlB> [extra bench args]
# Cells land in $BENCH_OUT/<tag>-A-r<n>/ and <tag>-B-r<n>/; table: node scripts/lib/theme-bench-tools/ab-table.mjs <tag> <rounds>
set -u
TAG=$1; THEMES=$2; ROUNDS=$3; A=$4; B=$5; shift 5
OUT=${BENCH_OUT:?set BENCH_OUT to the results directory}
cd "$(dirname "$0")/../../.."
for r in $(seq 1 "$ROUNDS"); do
  for arm in A B; do
    URL=$A; [ "$arm" = B ] && URL=$B
    node scripts/theme-fleet-bench.mjs --base-url="$URL" --themes="$THEMES" --tag="$TAG-$arm-r$r" --out="$OUT" \
      --shots=0 --no-second-visit=1 --rest-ms=5000 --storm-ms=5000 "$@" 2>&1 | grep "\[bench\]  "
  done
done
