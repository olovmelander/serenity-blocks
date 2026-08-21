#!/usr/bin/env bash
# Process-per-run perf driver (82JU: one Electron process cannot host a 2nd WebGPU window).
# usage: perf-driver.sh <tree-dir> <tag> <out-dir>
# PREREQUISITE: a dev server for <tree-dir> must already be listening on PORT — the session script
# does NOT start one (unlike odyssey-chapter-capture.mjs). e.g. in <tree-dir>:
#   npx vite --port 4177 --strictPort --logLevel warn &
# Without it every run fails with "Timed out waiting for dev server" after 120 s (2026-08-21).
set -u
TREE="$1"; TAG="$2"; OUT="$3"; PORT=4177
cd "$TREE" || exit 1
COMMON=(--port $PORT --quality Extreme --target-frame-rate 240 --warmup-mode current --duration 30000 --pan-duration 2200 --width 1280 --height 720 --runs 1)
run_session() { # scenario cache profile idx [extra...]
  local scenario="$1" cache="$2" profile="$3" idx="$4"; shift 4
  echo "[driver] $TAG $scenario/$cache run $idx"
  node scripts/run-electron.mjs scripts/odyssey-perf-session.mjs --scenario "$scenario" --cache "$cache" \
    --profile-dir "$TREE/artifacts/odyssey/perf-profiles/$profile" --output "$OUT/$TAG-$scenario-$cache-$idx.json" "${COMMON[@]}" "$@" 2>&1 \
    | grep -E "session failed|ERR_|wrote|\[odyssey-perf\] (run|screenshot)" | head -4
  sleep 3
}
# warm prime (discarded): populates the warm profile
run_session load warm-prime warm prime --duration 1500 --reload-cycles 0
rm -f "$OUT/$TAG-load-warm-prime-prime.json"
for i in 1 2 3; do run_session load cold committed-cold-fresh $i --reset-profile; done
for i in 1 2 3; do run_session load warm warm $i; done
for i in 1 2 3; do run_session idle warm warm-idle-$i $i; done
echo "[driver] $TAG complete"
