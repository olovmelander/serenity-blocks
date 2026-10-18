# Rainbow Terraces — capture tools and frame sets

How the theme was judged in a cloud container with no GPU: headless Chromium (Playwright's build) on
SwiftShader, which runs the theme's **WebGL2 backend** (the container's WebGPU adapter does not start).
A frame takes 30-90 s on four shared CPUs. Nothing here is part of the game: copy the two scripts into a
scratch folder to use them. On a machine with a GPU, CLAUDE.md's loop (the `chrome-devtools` MCP on the
playground) is the primary route; in a Linux container that MCP cannot start, because `.mcp.json`
launches it through Windows' `cmd /c`.

## Prerequisites

- Playwright is **not** a dependency of this repo. In the cloud image it is a global install
  (playwright 1.56.1 under `/opt/node22/lib/node_modules`, Chromium 1194 under `/opt/pw-browsers`).
  Elsewhere run `npm i -g playwright@1.56.1 && npx playwright install chromium` and point shot.mjs's
  `createRequire(...)` and `executablePath` at that install.
- Keep `shot.mjs` in the same folder as `shoot.sh`; `chmod +x shoot.sh`. It needs `bash`, `flock`
  and `curl`.

## The playground's parameters

Route: `playground.html?effect=rainbow-terraces&...` (CLAUDE.md's playground). The full list is the header
comment of `src/playground/effects/rainbow-terraces.effect.js`; the design record's Reproduce section has
the common ones. Those the checks lean on most: `quality=Minimal|Low|Medium|High|Ultra|Extreme`,
`board=1` (a mock card and HUD; `statsHud=0` drops the HUD, `players=2|4` a row of cards),
`hour=<0..4>` (fractions blend: `hour=2.5` is the Rose-to-Night crossing), `combo=0..13`, `held=<n>`,
`event=...&eventAge=<s>`, `parts=sky,sea,cumulus,isles,falls,spray,pools,gliders,fx` (draw only some
parts), `noPost=1`, `bloom=0|1`, `falseColor=1` (bands of the pre-tone-map max channel: blue < 0.1,
green 0.1-0.6, yellow 0.6-1, orange 1-2.5, red > 2.5), `values=1` (the value study), `seed=<n>`, `reduce=1`, `px`/`py` (pointer
parallax), `P.<name>=<value>` (any look number), and the lens `icon=1&iconFov=<deg>&iconYaw=<rad, +
turns left>&iconPitch=<rad, + up>` (it turns and zooms at the eye; it cannot orbit).

## shot.mjs — one frame from a running Vite

`SHOT_PORT=<vite port> node shot.mjs "<query>" out.png [width] [height] [timeoutMs]`. It waits for
`window.__PLAYGROUND_READY__`, lets a few frames land, saves the screenshot and prints the console
(read it: WebGL/TSL errors show there).

```js
// Usage: node shot.mjs "<query>" out.png [width] [height] [timeoutMs] [--webgpu]
// Captures playground.html?<query> once window.__PLAYGROUND_READY__ is true, dumps console.
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const [query, out, w = '1600', h = '852', timeout = '240000', ...flags] = process.argv.slice(2);
const webgpu = flags.includes('--webgpu');
const args = [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
];
if (webgpu) args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader');
const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args,
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const logs = [];
page.on('console', (m) => {
    logs.push(`[${m.type()}] ${m.text()}`);
    if (/did not mount|init failed/.test(m.text())) page.evaluate(() => { window.__SHOT_FAIL__ = true; }).catch(() => {});
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const url = `http://localhost:${process.env.SHOT_PORT || 5173}/playground.html?${query}`;
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240000 });
let backend = '?';
for (let attempt = 0; attempt < 3; attempt++) {
    try {
        await page.waitForFunction(() => window.__PLAYGROUND_READY__ === true || window.__SHOT_FAIL__ === true, null, { timeout: Number(timeout), polling: 500 });
        // let a couple more frames land
        await page.waitForTimeout(Number(process.env.SETTLE ?? 1500));
        backend = await page.evaluate(() => { try { return window.__PLAYGROUND__?.backend?.(); } catch { return '?'; } });
        break;
    } catch (e) {
        // A hot reload (an edit while capturing) destroys the context: wait for the page again.
        logs.push(`[shot] retry ${attempt}: ${e.message.split('\n')[0]}`);
        await page.waitForTimeout(3000);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240000 }).catch(() => {});
    }
}
await page.screenshot({ path: out, timeout: 240000 });
console.log(`backend=${backend} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
const filtered = logs.filter((l) => !/\[vite\]|Download the React|DevTools/.test(l));
console.log(filtered.slice(0, 80).join('\n'));
await browser.close();
```

## shoot.sh — a frame (or a list) from a worktree, with its own short-lived Vite

`shoot.sh <worktree> <port> "<query>" out.png [w] [h]`, or `shoot.sh <worktree> <port> list.txt` (lines
`out.png|query|w|h`; relative output paths in a list are relative to the list's folder). It starts Vite
for the call and stops it after, so no server outlives the call; calls on one port queue behind a lock;
each server gets its own dependency cache (`VITE_CACHE_DIR`, as `vite.config.js` asks: two Vites
sharing `node_modules/.vite` corrupt the optimizer), so several worktrees can be captured at once on
different ports. It exits non-zero if any frame fails, including a frame whose effect did not mount or never
became ready (shot.mjs saves a screenshot even then: read the console it prints for every frame).

```bash
#!/bin/bash
# usage: shoot.sh <worktree> <port> "<query>" <out.png> [w] [h]
#    or: shoot.sh <worktree> <port> <list.txt>          (lines: out.png|query|w|h)
# Captures from <worktree>. Uses a Vite already listening on <port>; otherwise starts one for
# this call (or this whole list) and stops it afterwards, so no server outlives the call.
# Calls on the same port queue behind a lock instead of colliding. Each server keeps its own
# dependency cache (VITE_CACHE_DIR, see vite.config.js): two Vites sharing node_modules/.vite
# corrupt the optimizer. Paths are resolved against the caller's directory (relative outputs in a
# list against the list's folder). It exits non-zero if any frame fails, including a frame whose
# effect did not mount or never became ready.
set -o pipefail
SP="$(cd "$(dirname "$0")" && pwd)"
WT="$(cd "$1" && pwd)"; PORT="$2"; shift 2
MAIN_REPO="${MAIN_REPO:-$(git -C "$WT" worktree list | head -1 | cut -d" " -f1)}"
abs() { case "$1" in /*) echo "$1" ;; *) echo "$PWD/$1" ;; esac; }
LIST=; if [ $# -eq 1 ]; then LIST="$(abs "$1")"; [ -f "$LIST" ] || { echo "no list file: $LIST"; exit 2; }; else OUT="$(abs "$2")"; fi
exec 9>"$SP/.shoot-$PORT.lock"
flock 9
up() { curl -s -o /dev/null --max-time 3 "http://localhost:$PORT/playground.html"; }
started=
if ! up; then
  [ -e "$WT/node_modules" ] || ln -s "$MAIN_REPO/node_modules" "$WT/node_modules"
  (cd "$WT" && VITE_CACHE_DIR="node_modules/.vite-shoot-$PORT" exec npx vite --port "$PORT" --strictPort > "$SP/vite-$PORT.log" 2>&1 9>&-) &
  started=1
  for i in $(seq 1 120); do up && break; sleep 0.5; done
  up || { echo "vite on $PORT did not start; see $SP/vite-$PORT.log"; tail -5 "$SP/vite-$PORT.log"; pkill -f "vite --port $PORT --strictPort"; exit 3; }
fi
rc=0
# shot.mjs saves a frame even when the effect failed to mount or never became ready: count those as failures.
failed() { grep -qE 'did not mount|init failed|backend=(\?|undefined)' "$1"; }
LISTDIR="$(dirname "${LIST:-/}")"
cd "$SP"
if [ -n "$LIST" ]; then
  while IFS='|' read -r out q w h; do
    [ -z "$out" ] && continue
    case "$out" in /*) ;; *) out="$LISTDIR/$out" ;; esac
    echo "== $out"
    SHOT_PORT=$PORT timeout 500 node shot.mjs "$q" "$out" "${w:-1600}" "${h:-900}" 400000 > "$SP/.shoot-$PORT.out" 2>&1
    code=$?
    grep -vE '^\[(debug|log)\]' "$SP/.shoot-$PORT.out" | head -30
    { [ "$code" -eq 0 ] && [ -s "$out" ] && ! failed "$SP/.shoot-$PORT.out"; } || { echo "FAILED: $out"; rc=1; }
  done < "$LIST"
else
  SHOT_PORT=$PORT timeout 560 node shot.mjs "$1" "$OUT" "${3:-1600}" "${4:-900}" 480000 > "$SP/.shoot-$PORT.out" 2>&1; rc=$?
  cat "$SP/.shoot-$PORT.out"
  { [ -s "$OUT" ] && ! failed "$SP/.shoot-$PORT.out"; } || { echo "FAILED: $OUT"; rc=1; }
fi
[ -n "$started" ] && pkill -f "vite --port $PORT --strictPort"
exit $rc
```

## Probes without a frame

Most claims (where a vertex is, whether a pool is held, what a tier's triangles are, where the frame
solver puts the bow or an isle) can be checked in seconds without rendering. Write a scratch vitest file
that builds the world as `makeWorld` in `tests/unit/rainbow-terraces-world.test.js` does: a `THREE.Scene`, a
`PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far)`, `new
RainbowTerracesWorld({ scene, quality, capture: true }).build()`, `bindCamera`, `setViewport`,
`setLayout(fallbackLayout(w, h), aspect)`, then `seek(t)`, `updateCamera` and `update`. Read geometry,
`placement`, pool slots, the frame solver's output or `screenOf(...)` from there. Builders such as
`buildCascade`, `crownHeight` or `isleShapes` can be called directly. Delete the scratch test afterwards.

## The audit frames

The same 18 queries were rendered on the first build (the a set, at commit `36770ad`) and after the
second round and the first grounding fixes (the b set, at `e680429`; `08b9c70` has the same theme code).
To see what the critics saw, render a set at its commit in a throwaway worktree (`git worktree add
--detach ../wt-a 36770ad`); to get a baseline for new work, render the b set on the current state.

The b set (`name|query|width|height`):

```
b01-idle-jade.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=3&held=4&hour=0|1600|900
b02-board-jade.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=0|1600|900
b03-board-gilded.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=1|1600|900
b04-board-rose.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=2|1600|900
b05-board-night.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=3|1600|900
b06-board-pearl.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=4|1600|900
b07-close-isle.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=3&held=6&hour=1&icon=1&iconFov=26&iconYaw=0.42&iconPitch=-0.02|1600|900
b08-close-fall.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=3&held=6&hour=1&icon=1&iconFov=26&iconYaw=0.36&iconPitch=-0.3|1600|900
b09-close-gate-twin.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=3&held=6&hour=1&icon=1&iconFov=24&iconYaw=-0.62&iconPitch=-0.05|1600|900
b10-close-cloudsea.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=3&held=4&hour=1&icon=1&iconFov=50&iconYaw=-0.1&iconPitch=-0.4|1600|900
b11-close-sky.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=3&held=4&hour=1&icon=1&iconFov=50&iconYaw=-0.25&iconPitch=0.35|1600|900
b12-combo13.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=13&held=8&hour=0|1600|900
b13-quad.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=5&held=8&event=quad&eventAge=3.0&hour=2|1600|900
b14-lock.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=2&held=4&event=lock&eventAge=0.55&u=0.3&row=12&color=%23ff9a45&shape=L&hour=1|1600|900
b15-clear.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=4&held=6&event=clear&lines=2&eventAge=0.9&hour=1|1600|900
b16-portrait.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=4&held=4&hour=2|430|932
b17-ultrawide.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=4&held=4&hour=1|2100|900
b18-close-crags.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=0&held=0&hour=0&icon=1&iconFov=40&iconYaw=0.3&iconPitch=-0.45|1600|900
```

The a set uses the same queries with the names a01..a18:

```
a01-idle-jade.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=3&held=4&hour=0|1600|900
a02-board-jade.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=0|1600|900
a03-board-gilded.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=1|1600|900
a04-board-rose.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=2|1600|900
a05-board-night.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=3|1600|900
a06-board-pearl.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=4|1600|900
a07-close-isle.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=3&held=6&hour=1&icon=1&iconFov=26&iconYaw=0.42&iconPitch=-0.02|1600|900
a08-close-fall.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=3&held=6&hour=1&icon=1&iconFov=26&iconYaw=0.36&iconPitch=-0.3|1600|900
a09-close-gate-twin.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=3&held=6&hour=1&icon=1&iconFov=24&iconYaw=-0.62&iconPitch=-0.05|1600|900
a10-close-cloudsea.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=3&held=4&hour=1&icon=1&iconFov=50&iconYaw=-0.1&iconPitch=-0.4|1600|900
a11-close-sky.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=3&held=4&hour=1&icon=1&iconFov=50&iconYaw=-0.25&iconPitch=0.35|1600|900
a12-combo13.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=13&held=8&hour=0|1600|900
a13-quad.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=5&held=8&event=quad&eventAge=3.0&hour=2|1600|900
a14-lock.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=2&held=4&event=lock&eventAge=0.55&u=0.3&row=12&color=%23ff9a45&shape=L&hour=1|1600|900
a15-clear.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=4&held=6&event=clear&lines=2&eventAge=0.9&hour=1|1600|900
a16-portrait.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=4&held=4&hour=2|430|932
a17-ultrawide.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=4&held=4&hour=1|2100|900
a18-close-crags.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=0&held=0&hour=0&icon=1&iconFov=40&iconYaw=0.3&iconPitch=-0.45|1600|900
```

The critique's other views (all 1600x900 unless noted; each query is `effect=rainbow-terraces&t=30&quality=High&hud=0&`
plus):

- c1 = `board=0&combo=3&held=6&hour=0&parts=isles&icon=1&iconFov=40&iconYaw=0.42&iconPitch=-0.2`
- c2 = `board=0&combo=3&held=6&hour=0&icon=1&iconFov=13&iconYaw=-0.63&iconPitch=-0.15` (the isles package's
  Twin view is `icon=1&iconFov=10&iconYaw=-0.66&iconPitch=-0.12`)
- gates-x1-foot = `board=0&combo=3&held=6&hour=0&icon=1&iconFov=12&iconYaw=-0.58&iconPitch=-0.1`
- comp-x1 = `board=1&players=2&combo=6&held=4&hour=0`
- comp-x2 = b02 at 1024x768 with `combo=4`
- x3 = b02 with `hour=2.5`
- atmosphere-x2-rose-isle = b07 with `hour=2`
- falls-tower = `board=1&combo=5&held=8&event=clear&lines=3&eventAge=1.6&hour=1`
- falls-quad5 = b13 with `eventAge=5`
- bow-c1-rest-jade = b02 with `combo=0`
- bow-c2-portrait-jade12 = 430x932 `board=1&combo=12&held=6&hour=0`
- clouds-1-minimal-gilded-t95 = b02 with `quality=Minimal&hour=1&t=95`

Sibling references used as the quality bar (r-*): `effect=nimbus-veil`, `himalayan-peak`, `ice-temple`,
`golden-forest`, `fall`, `sakura-twilight`, each with `t=20&hud=0` at 1600x900.

## The design record's images

`docs/rainbow-terraces-overhaul/*.webp` were rendered from this list (1280x688; the five hours at 640x344
pasted into a 3x2 sheet, `hours.webp`), last on the RTX in the third pass, with the theme icon
(`src/themes/rainbow-terraces/rainbow-terraces-theme-icon.png` and its copy
`public/assets/themes/rainbow-terraces-theme-icon.png`, from the record's icon query: a 1400x1400
request comes back 1400x852 on this laptop; its centre square is baked into a 512 px circle).

```
doc/01-idle.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=0&combo=3&held=4&hour=0|1280|688
doc/02-board.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=0|1280|688
doc/03-lock.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=2&held=4&event=lock&eventAge=0.55&u=0.3&row=12&color=%23ff9a45&shape=L|1280|688
doc/04-landed.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=2&held=8&event=lock&eventAge=1.25&u=0.3&row=12&color=%23ff9a45&shape=L|1280|688
doc/05-drop.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=2&held=4&event=drop&eventAge=0.14&u=0.7&row=6&color=%2345d0e6&shape=I|1280|688
doc/06-clear.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=4&held=6&event=clear&lines=2&eventAge=0.9|1280|688
doc/07-quad.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=5&held=8&event=quad&eventAge=3.0|1280|688
doc/08-combo13.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=13&held=8|1280|688
doc/09-levelup.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=2&held=4&event=levelUp&eventAge=1.6|1280|688
doc/11-paint.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=4&held=6&hour=0&linkAge=0.55|1280|688
doc/h0.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=0|640|344
doc/h1.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=1|640|344
doc/h2.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=2|640|344
doc/h3.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=3|640|344
doc/h4.png|effect=rainbow-terraces&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=4|640|344
doc/10-portrait.png|effect=rainbow-terraces&t=30&quality=Medium&hud=0&board=1&combo=4&held=4&hour=2|390|844
```
