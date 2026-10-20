#!/usr/bin/env bash
# One single-effect playground capture of ?effect=wolfhour through Electron (Windows, Git Bash).
# Run from the repository root with a dev server up:
#   VITE_CACHE_DIR=.cache/vite-5182 npx vite --port 5182 --strictPort --host 127.0.0.1
#   bash reports/wolfhour-moonlit-night/harness/cap.sh <name> "<query>" [width] [height]
# Env: WOLFHOUR_PORT (5182), WOLFHOUR_CAPTURE_DIR (.cache/wolfhour-capture),
#      SETTLE (ms after ready, default 3000: a changed shader needs ~2 s to compile on first load),
#      RECT ("x,y,w,h" device pixels: capture only that region, e.g. a 2x close-up),
#      EVAL (a JS expression evaluated after SETTLE and logged, e.g. the profiler snapshot),
#      SHOW=1 (open the window off screen: a hidden window renders at 1 fps, so use it for timings).
set -u
NAME="$1"; QUERY="$2"; W="${3:-1280}"; H="${4:-720}"
OUT="${WOLFHOUR_CAPTURE_DIR:-.cache/wolfhour-capture}"
mkdir -p "$OUT"
env -u ELECTRON_RUN_AS_NODE \
  CAP_URL="http://127.0.0.1:${WOLFHOUR_PORT:-5182}/playground.html?effect=wolfhour&orbit=0&hud=0&${QUERY}" \
  CAP_OUT="$OUT/$NAME.png" CAP_W="$W" CAP_H="$H" CAP_SETTLE="${SETTLE:-3000}" CAP_RECT="${RECT:-}" \
  CAP_EVAL="${EVAL:-}" CAP_SHOW="${SHOW:-}" \
  timeout 150 node_modules/electron/dist/electron.exe reports/wolfhour-moonlit-night/harness/wh-capture.mjs
echo "exit $?"
grep -E "\[state\]|\[fail\]|\[done\]|\[gone\]|\[eval\]" "$OUT/$NAME.png.log"
echo "--- GPU and console errors ---"
grep -E "\[gpu-error\]|\[gpu-lost\]|\[console:error\]" "$OUT/$NAME.png.log" | head -20
