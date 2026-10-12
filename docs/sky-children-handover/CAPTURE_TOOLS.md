# Sky Children — capture tools and frame sets

How the theme was judged in a cloud container with no GPU: headless Chromium (Playwright's build in
`/opt/pw-browsers`) on SwiftShader, which runs the theme's **WebGL2 backend** (the container's
WebGPU adapter does not start). A frame takes 30-90 s on four shared CPUs. Nothing here is part of
the game: copy the two scripts into a scratch folder to use them.

The playground route is the one CLAUDE.md asks for: `playground.html?effect=sky-children&...`. Every
look number can be overridden with `P.<name>=<value>`; the full list of the theme's playground
parameters is in [the design record's Reproduce section](../SKY_CHILDREN_VISUAL_OVERHAUL_2026-10.md#reproduce).
Useful extras: `parts=sky,sea,cumulus,isles,falls,spray,pools,gliders,fx` (draw only some parts),
`icon=1&iconFov=<deg>&iconYaw=<rad, + turns left>&iconPitch=<rad, + up>` (a lens at the eye: it turns
and zooms, it cannot orbit), `players=2`, `noPost=1`, `quality=Minimal|Low|Medium|High|Ultra|Extreme`.

## shot.mjs — one frame from a running Vite

`node shot.mjs "<query>" out.png [width] [height] [timeoutMs]` with `SHOT_PORT=<vite port>`. It waits
for `window.__PLAYGROUND_READY__`, lets a few frames land, saves the screenshot and prints the
console (read it: WebGL/TSL errors show there). Change `executablePath` to your Chromium.

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
`out.png|query|w|h`). It starts Vite for the call and stops it after, so no server outlives the call,
and calls on one port queue behind a lock. Use one port per worktree (several worktrees can be
captured at once).

```bash
#!/bin/bash
# usage: shoot.sh <worktree> <port> "<query>" <out.png> [w] [h]
#    or: shoot.sh <worktree> <port> <list.txt>          (lines: out.png|query|w|h)
# Captures from <worktree>. Uses a Vite already listening on <port>; otherwise starts one for
# this call (or this whole list) and stops it afterwards, so no server outlives the call.
# Calls on the same port queue behind a lock instead of colliding.
SP="$(cd "$(dirname "$0")" && pwd)"
WT="$1"; PORT="$2"; shift 2
MAIN_REPO="${MAIN_REPO:-$(git -C "$WT" worktree list | head -1 | cut -d" " -f1)}"
exec 9>"$SP/.shoot-$PORT.lock"
flock 9
up() { curl -s -o /dev/null --max-time 3 "http://localhost:$PORT/playground.html"; }
started=
if ! up; then
  [ -e "$WT/node_modules" ] || ln -s "$MAIN_REPO/node_modules" "$WT/node_modules"
  (cd "$WT" && exec npx vite --port "$PORT" --strictPort > "$SP/vite-$PORT.log" 2>&1 9>&-) &
  started=1
  for i in $(seq 1 120); do up && break; sleep 0.5; done
  up || { echo "vite on $PORT did not start; see $SP/vite-$PORT.log"; tail -5 "$SP/vite-$PORT.log"; pkill -f "vite --port $PORT --strictPort"; exit 3; }
fi
rc=0
cd "$SP"
if [ -f "$1" ] && [ $# -eq 1 ]; then
  while IFS='|' read -r out q w h; do
    [ -z "$out" ] && continue
    echo "== $out"
    SHOT_PORT=$PORT timeout 500 node shot.mjs "$q" "$out" "${w:-1600}" "${h:-900}" 400000 2>&1 | grep -vE '^\[(debug|log)\]' | head -30 || rc=1
  done < "$1"
else
  SHOT_PORT=$PORT timeout 560 node shot.mjs "$1" "$2" "${3:-1600}" "${4:-900}" 480000; rc=$?
fi
[ -n "$started" ] && pkill -f "vite --port $PORT --strictPort"
exit $rc
```

## The audit frames ("a" set, first build) and the critique's "b" set

The same 18 queries were rendered on the first build (a01..a18) and after the second round (b01..b18,
the critique's AFTER frames). Re-render them on the current state to compare.

```
audit/after/b01-idle-jade.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=3&held=4&hour=0|1600|900
audit/after/b02-board-jade.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=0|1600|900
audit/after/b03-board-gilded.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=1|1600|900
audit/after/b04-board-rose.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=2|1600|900
audit/after/b05-board-night.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=3|1600|900
audit/after/b06-board-pearl.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=4|1600|900
audit/after/b07-close-isle.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=3&held=6&hour=1&icon=1&iconFov=26&iconYaw=0.42&iconPitch=-0.02|1600|900
audit/after/b08-close-fall.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=3&held=6&hour=1&icon=1&iconFov=26&iconYaw=0.36&iconPitch=-0.3|1600|900
audit/after/b09-close-gate-twin.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=3&held=6&hour=1&icon=1&iconFov=24&iconYaw=-0.62&iconPitch=-0.05|1600|900
audit/after/b10-close-cloudsea.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=3&held=4&hour=1&icon=1&iconFov=50&iconYaw=-0.1&iconPitch=-0.4|1600|900
audit/after/b11-close-sky.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=3&held=4&hour=1&icon=1&iconFov=50&iconYaw=-0.25&iconPitch=0.35|1600|900
audit/after/b12-combo13.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=13&held=8&hour=0|1600|900
audit/after/b13-quad.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=5&held=8&event=quad&eventAge=3.0&hour=2|1600|900
audit/after/b14-lock.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=2&held=4&event=lock&eventAge=0.55&u=0.3&row=12&color=%23ff9a45&shape=L&hour=1|1600|900
audit/after/b15-clear.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=4&held=6&event=clear&lines=2&eventAge=0.9&hour=1|1600|900
audit/after/b16-portrait.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=4&held=4&hour=2|430|932
audit/after/b17-ultrawide.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=4&held=4&hour=1|2100|900
audit/after/b18-close-crags.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=0&held=0&hour=0&icon=1&iconFov=40&iconYaw=0.3&iconPitch=-0.45|1600|900
```

The first audit's file names (identical queries):

```
audit/a01-idle-jade.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=3&held=4&hour=0|1600|900
audit/a02-board-jade.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=0|1600|900
audit/a03-board-gilded.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=1|1600|900
audit/a04-board-rose.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=2|1600|900
audit/a05-board-night.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=3|1600|900
audit/a06-board-pearl.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=4|1600|900
audit/a07-close-isle.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=3&held=6&hour=1&icon=1&iconFov=26&iconYaw=0.42&iconPitch=-0.02|1600|900
audit/a08-close-fall.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=3&held=6&hour=1&icon=1&iconFov=26&iconYaw=0.36&iconPitch=-0.3|1600|900
audit/a09-close-gate-twin.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=3&held=6&hour=1&icon=1&iconFov=24&iconYaw=-0.62&iconPitch=-0.05|1600|900
audit/a10-close-cloudsea.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=3&held=4&hour=1&icon=1&iconFov=50&iconYaw=-0.1&iconPitch=-0.4|1600|900
audit/a11-close-sky.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=3&held=4&hour=1&icon=1&iconFov=50&iconYaw=-0.25&iconPitch=0.35|1600|900
audit/a12-combo13.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=13&held=8&hour=0|1600|900
audit/a13-quad.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=5&held=8&event=quad&eventAge=3.0&hour=2|1600|900
audit/a14-lock.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=2&held=4&event=lock&eventAge=0.55&u=0.3&row=12&color=%23ff9a45&shape=L&hour=1|1600|900
audit/a15-clear.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=4&held=6&event=clear&lines=2&eventAge=0.9&hour=1|1600|900
audit/a16-portrait.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=4&held=4&hour=2|430|932
audit/a17-ultrawide.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=4&held=4&hour=1|2100|900
audit/a18-close-crags.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=0&held=0&hour=0&icon=1&iconFov=40&iconYaw=0.3&iconPitch=-0.45|1600|900
audit/r-nimbus.png|effect=nimbus-veil&t=20&hud=0|1600|900
audit/r-himalayan.png|effect=himalayan-peak&t=20&hud=0|1600|900
audit/r-ice-temple.png|effect=ice-temple&t=20&hud=0|1600|900
audit/r-golden-forest.png|effect=golden-forest&t=20&hud=0|1600|900
audit/r-sakura.png|effect=sakura-twilight&t=20&hud=0|1600|900
audit/r-fall.png|effect=fall&t=20&hud=0|1600|900
```

Sibling references used as the quality bar (r-*): `effect=nimbus-veil`, `himalayan-peak`, `ice-temple`,
`golden-forest`, `fall`, `sakura-twilight` with `t=20&hud=0` at 1600x900.

## The design record's images

`docs/sky-children-overhaul/*.webp` were rendered from this list (1280x688; the five hours at 640x344
pasted into a 3x2 sheet, `hours.webp`). They still show the first build and should be re-rendered.

```
doc/01-idle.png|effect=sky-children&t=30&quality=High&hud=0&board=0&combo=3&held=4&hour=0|1280|688
doc/02-board.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=0|1280|688
doc/03-lock.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=2&held=4&event=lock&eventAge=0.55&u=0.3&row=12&color=%23ff9a45&shape=L|1280|688
doc/04-landed.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=2&held=8&event=lock&eventAge=1.25&u=0.3&row=12&color=%23ff9a45&shape=L|1280|688
doc/05-drop.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=2&held=4&event=drop&eventAge=0.14&u=0.7&row=6&color=%2345d0e6&shape=I|1280|688
doc/06-clear.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=4&held=6&event=clear&lines=2&eventAge=0.9|1280|688
doc/07-quad.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=5&held=8&event=quad&eventAge=3.0|1280|688
doc/08-combo13.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=13&held=8|1280|688
doc/09-levelup.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=2&held=4&event=levelUp&eventAge=1.6|1280|688
doc/h0.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=0|640|344
doc/h1.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=1|640|344
doc/h2.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=2|640|344
doc/h3.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=3|640|344
doc/h4.png|effect=sky-children&t=30&quality=High&hud=0&board=1&combo=3&held=4&hour=4|640|344
doc/10-portrait.png|effect=sky-children&t=30&quality=Medium&hud=0&board=1&combo=4&held=4&hour=2|390|844
```
