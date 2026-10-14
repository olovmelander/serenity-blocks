# Theme performance fleet record (2026-10-14, Performance mode)

Every registered theme (63) measured on the owner's laptop in **Lenovo Performance mode**: RTX 3070
Laptop, Electron rAF ≈ 131.6 Hz on a 165 Hz panel, perf-lane window 1920×1080, Target Frame Rate
60, quality High. Plus what was fixed the same day, the level-up switch, and the queue for the
per-theme work. Companion documents:
- [THEME_AUDIT_HANDOVER_2026-10.md](THEME_AUDIT_HANDOVER_2026-10.md): how this work is run, and where to pick up.
- [theme-perf/STATIC_STARTUP_AUDIT_2026-10.md](theme-perf/STATIC_STARTUP_AUDIT_2026-10.md): a
  read-only code audit of all 63 themes, written in parallel. It lists start, compile, CPU and GPU
  suspects with file:line, and its claims are marked "read in code" vs "suspected".

## 1. How it was measured

- **Instrument:** the theme perf lane (`scripts/validate-all-themes.mjs --perf`):
  - one fresh Electron and a cold Dawn cache per theme, switching from forest;
  - a 12 s settle and a 10 s idle window;
  - run nine themes per shared-GPU-lock hold; no driver events in the whole sweep.
- **INS-01 fixed first** (`scripts/lib/theme-perf-instrument.mjs`). The lane resolved GPU timestamps
  on its own 131 Hz ticks, so a theme drawing 65 frames a second got 1.4-1.9 samples per frame,
  weighted by how long each frame lingered. It now resolves only after a rendered frame and
  divides the resolved total by the frames it covers. Every cell's GPU samples now equal its frames.
- **"Ready"** below is the lane's `firstFrameGpuCompleteMs` minus 2000 ms. The lane takes that mark
  only after pipeline requests have been quiet for 2 s (`quietPipelineMs`), so the raw field has a
  2 s floor; minus the floor it is roughly when the theme's last pipeline compiled.
- **"Build"** is `switchWallMs`: `createScene()` until the theme reports ready, on the main thread.
- **"CPU in render"** is the time spent inside the theme's `render()`/post calls per drawn frame
  (median); the theme's own update work is outside it. **"GPU"** is the median GPU time per frame.

## 2. The fleet in numbers

- **Start (cold shader cache):** 42 themes are ready in under 1 s, 14 in 1-3 s, 7 in over 3 s
  (median 0.6 s). The worst are summer 10.8 s, forest 4.4 s, golden-forest 4.3 s,
  moonlit-greenhouse 3.7 s, rainbark 3.4 s, sakura-twilight 3.3 s and moonlit-forest 3.1 s.
  - These themes compile 100-263 pipelines (the forest family), or a few very large ones
    (rainbark: 18 pipelines, 3.4 s).
  - moonlit-forest spends 3.0 s building its scene on the CPU.
  - A returning player's shaders come from Chromium's disk cache, so the pipeline compile is paid
    once per theme. The node build (TSL → WGSL on the main thread) is paid on every start.
- **CPU per frame:** median 2.6 ms. The forest family is the outlier: summer 11.7 ms,
  sakura-twilight 9.7, golden-forest 9.5, forest 9.1, verdant-hills 6.9, fall 6.4, then
  halcyon-apex 4.6. CPU profiles of four of them show two causes:
  - **three's per-object work, scaling with draw count:** binding and node-uniform updates,
    render-object lookups and cache keys, and whole-buffer uploads (summer: 136 draws plus a
    second scene render for its lake mirror). 130-240 ms of main thread per second.
  - **CPU particle simulations:** sakura petals plus a terrain-height call per petal (~80 ms/s),
    forest fireflies (~50 ms/s), golden-forest sparks (~23 ms/s), summer petals (~14 ms/s).
- **GPU per frame:** never the bottleneck on this machine. The highest median is 3.5 ms
  (kaleidosonic), and every theme sits under 4 ms at 1920×1080.

## 3. Fixed: the level-up freeze (in-play theme switch)

In the default **Level** background mode the theme changes every three levels, mid-game. The switch
disposed the playing theme, built the next one and compiled every pipeline synchronously at its
first frame. The GPU process stalled, and the board froze with it. The same path serves the Random
timer and a pick during play.

Now (`src/themes/theme-manager.js`, `src/rendering/async-render-pipelines.js`):
1. **Build behind.** The incoming theme is built hidden while the outgoing one keeps playing, and its
   render pipelines are created async.
2. **Build budget.** The node build (TSL → WGSL) of each new render object is limited to 8 ms of
   main thread per frame. The rest waits for later frames, as an object whose pipeline is pending
   does. The switch CPU profiles showed this build was the remaining freeze: 0.3-2.4 s of
   `NodeBuilder` work in one task.
3. **Crossfade.** Once the hidden theme is quiet (no pipeline in flight, nothing deferred, scene
   stable), every shadow-casting light redraws once. The containers then crossfade over 2.5 s and
   the outgoing theme is disposed afterwards.
- Only for a visibly playing theme on an async-capable backend; anything else takes the classic
  path. Rollback: `?themeSwitchBehind=0`.

Measured in the real game (Single Player, Specific background mode, switches from forest; two
rounds each, interleaved, fresh profiles): the longest freeze and the total frozen time per switch.

| Switch to | Before: longest / total | After: longest / total |
|---|---|---|
| summer | 2.40-2.46 s / 2.47-2.53 s | 0.42 s / 0.77-0.88 s |
| golden-forest | 2.52-2.63 s / 2.85-2.95 s | 0.28-0.32 s / 0.39-0.60 s |
| sakura-twilight | 0.92-1.07 s / 0.92-1.07 s | 0.26 s / 0.67-0.72 s |
| fall | 3.02-3.29 s / 3.72-4.00 s | 0.18 s / 0.36-0.52 s |
| aurora | 0.55-0.58 s / 0.99-1.03 s | 0.26-0.31 s / 0.26-0.38 s |

- After the switch, each theme was checked in a screenshot: all five scenes complete, shadows
  included.
- **What remains in those 0.2-0.4 s:** the theme's own scene build on the main thread. Summer and
  golden-forest compute their shore and lake maps, sakura its terrain normals, aurora its noise
  bake. That is per-theme work (§5).

## 3b. Fixed: hidden UI animating every frame (all themes, all modes)

The CPU profiles showed a constant ~260 ms/s of native "(program)" time in every theme, light or
heavy. A Chrome trace of the renderer main thread split it: style recalc 41-58 ms/s, layout 35-40,
pre-paint and paint-layer update ~40, CSS animation servicing 12-29.

An invalidation trace named the source: CSS animations in UI that is hidden but not
`display: none`.
- The start modal: the stage art drift, the mode-card icons, and the ascent dots, whose SVG
  transforms re-lay out.
- The floating replays and highscores buttons and the main-menu player card's skeleton shimmer.
- The CSS-era theme layers still in `index.html`: golden-forest, misty-lake, synthwave and
  chromadelic. They animate behind whichever theme is playing.

`public/styles/main.css` now pauses descendants' animations under `.modal:not(.visible)`,
`.theme-container:not(.active)`, and the two buttons and the player card when they are not
`.visible`. They resume where they were when shown.

| Main thread during play (trace) | Before | After |
|---|---|---|
| nimbus-veil, busy ms/s | 324-387 | 184-228 |
| summer, busy ms/s | 521-528 | 413-416 |
| style recalc ms/s | 41-58 | 4-14 |
| layout ms/s | 35-40 | ~0 |

That is about 1.7-2.4 ms of main thread per frame back in every theme and mode.

## 4. The fleet table

Sorted by ready time. Cold Dawn cache, Performance mode, 1920×1080, High, 60 fps cap.
| Theme | Ready (ms) | Build (ms) | Pipelines | CPU in render p50 (ms) | GPU p50 (ms) | Draws |
|---|---:|---:|---:|---:|---:|---:|
| summer | 10804 | 1796 | 263 | 11.7 | 2.75 | 136 |
| forest | 4410 | 1006 | 127 | 9.1 | 1.90 | 60 |
| golden-forest | 4276 | 947 | 185 | 9.5 | 1.11 | 88 |
| moonlit-greenhouse | 3739 | 597 | 44 | 2.7 | 3.15 | 50 |
| rainbark | 3402 | 627 | 18 | 2.8 | 1.77 | 23 |
| sakura-twilight | 3253 | 383 | 101 | 9.7 | 2.69 | 99 |
| moonlit-forest | 3055 | 2998 | 38 | 0.7 | 0.20 | 32 |
| fall | 2112 | 598 | 107 | 6.4 | 1.44 | 51 |
| moonrise-summit | 1734 | 1651 | 0 (WebGL) | 0.3 | — | — |
| verdant-hills | 1658 | 533 | 62 | 6.9 | 2.82 | 58 |
| sky-children | 1589 | 825 | 22 | 2.0 | 2.69 | 27 |
| thermal-bloom | 1447 | 662 | 26 | 3.4 | 3.15 | 33 |
| pyrestorm | 1426 | 1184 | 27 | 2.4 | 1.64 | 32 |
| high-coast | 1292 | 853 | 40 | 2.4 | 3.21 | 43 |
| himalayan-peak | 1266 | 839 | 22 | 3.0 | 1.44 | 26 |
| bioluminescence | 1254 | 376 | 46 | 3.1 | 2.16 | 50 |
| lunara | 1144 | 163 | 37 | 2.7 | 1.05 | 40 |
| winter | 1098 | 347 | 34 | 3.2 | 1.64 | 37 |
| neon-district | 1089 | 220 | 48 | 3.3 | 1.57 | 68 |
| wolfhour | 1070 | 336 | 38 | 1.8 | 1.38 | 24 |
| ocean | 1008 | 636 | 32 | 2.4 | 1.31 | 36 |
| koi-pond | 972 | 758 | 43 | 4.1 | 1.44 | 47 |
| rainy-window | 906 | 835 | 0 (WebGL) | 0.6 | — | — |
| chromadelic-highway | 882 | 122 | 20 | 1.9 | 0.98 | 23 |
| painted-ages | 873 | 687 | 20 | 1.9 | 1.90 | 21 |
| chiral-gold | 809 | 289 | 52 | 3.5 | 1.05 | 63 |
| serenity-warp | 745 | 623 | 15 | 2.8 | 0.66 | 26 |
| cosmic-noir | 702 | 632 | 27 | 2.0 | 1.25 | 0 |
| halcyon-apex | 667 | 260 | 40 | 4.6 | 0.66 | 52 |
| blood-moon | 633 | 445 | 9 | 0.4 | 0.79 | 6 |
| sunset | 630 | 413 | 17 | 2.8 | 1.64 | 18 |
| stellar-velocity | 624 | 427 | 15 | 1.8 | 2.10 | 20 |
| ice-temple | 618 | 285 | 27 | 3.5 | 1.05 | 31 |
| luminous-tides | 588 | 437 | 16 | 2.7 | 1.97 | 20 |
| stillwater | 585 | 237 | 56 | 3.5 | 1.38 | 63 |
| aurora | 561 | 213 | 23 | 3.0 | 1.51 | 27 |
| black-hole | 524 | 426 | 15 | 1.7 | 1.51 | 15 |
| cinder-drift | 513 | 315 | 20 | 2.0 | 1.11 | 25 |
| stellar-drift | 458 | 217 | 15 | 1.8 | 0.72 | 20 |
| voltage-storm | 431 | 294 | 18 | 1.9 | 1.18 | 23 |
| geode | 425 | 235 | 17 | 2.7 | 0.79 | 22 |
| supernova | 420 | 228 | 17 | 1.9 | 1.70 | 22 |
| crystal-cave | 392 | 289 | 23 | 3.8 | 0.39 | 39 |
| solar-eclipse | 392 | 127 | 14 | 1.8 | 1.51 | 18 |
| shifting-sands | 386 | 277 | 15 | 1.7 | 1.38 | 19 |
| vesper-chrysalis | 360 | 138 | 50 | 3.0 | 1.38 | 55 |
| astral-weave | 343 | 148 | 20 | 1.8 | 1.44 | 25 |
| starlight | 334 | 203 | 26 | 2.8 | 0.66 | 30 |
| fluid-dreams | 333 | 119 | 12 | 2.6 | 2.10 | 17 |
| parhelion | 331 | 141 | 15 | 1.8 | 1.05 | 20 |
| waves | 322 | 191 | 21 | 3.0 | 1.57 | 25 |
| galaxy | 320 | 176 | 19 | 2.7 | 1.64 | 25 |
| tornado | 318 | 310 | 31 | 2.8 | 1.51 | 30 |
| aether-tides | 315 | 194 | 26 | 3.5 | 0.59 | 37 |
| synthwave-sunset | 306 | 100 | 17 | 1.8 | 1.05 | 22 |
| kaleidosonic | 294 | 101 | 9 | 2.3 | 3.54 | 14 |
| void-ember | 287 | 153 | 20 | 2.0 | 1.18 | 27 |
| nebula-flow | 283 | 168 | 19 | 1.8 | 1.77 | 24 |
| murmuration | 262 | 178 | 11 | 1.6 | 2.82 | 16 |
| neon-dusk | 251 | 142 | 17 | 2.2 | 0.66 | 21 |
| chromatic-impasto | 230 | 116 | 21 | 1.8 | 1.57 | 21 |
| nimbus-veil | 194 | 83 | 15 | 1.8 | 1.38 | 20 |
| misty-lake | 114 | 80 | 0 (WebGL) | 0.5 | — | — |

## 5. What the CPU profiles add (after the sweep)

**The lane's "CPU in render" overstates real work.** It times the wall clock inside `render()`
calls, waits included. CPU profiles split the main thread instead:
- **Tool:** `theme-cpu-profile.mjs` on the dev server, 6 s in play after an 8 s settle.
- **"In the render call":** samples under the theme's own `render`/`renderFrame` frame.
- **"Theme work":** samples under any `src/themes/` frame.

| Theme | Theme work (ms/s) | In its render call (ms/s) | ≈ ms per frame |
|---|---:|---:|---:|
| summer | 368-372 | 345-353 | 5.6 |
| sakura-twilight | 338 | 244 | 5.1 |
| forest | 251 | 196 | 3.8 |
| verdant-hills | 213 | 191 | 3.2 |
| fall | 205 | 168 | 3.1 |
| nimbus-veil (a light theme) | 106 | — | 1.6 |

- **Inside the render call:** three's per-object work scales with draws × passes: `Bindings._update`,
  `NodeFrame.updateByType`, `_renderObjectDirect`, `RenderObjects.get` and `getCacheKey`, plus
  `writeBuffer` uploads.
- **Outside it, the CPU particle simulations:**

  | Theme | Simulation | ms/s |
  |---|---|---:|
  | sakura-twilight | petals `step` + `write` (plus `sakuraTerrainHeight` per petal, ~24 ms/s) | ~55 |
  | forest | fireflies `step` + `shed` | ~41 |
  | golden-forest | sparks | ~23 |
  | fall | leaves | ~21 |
- **Summer's lake mirror:** turning its update off at runtime cut summer's render-call work from
  296-345 to 229-235 ms/s. The mirror costs 67-110 ms/s, about 1.0-1.7 ms per frame.
  - **Do not throttle it** by skipping `reflector.updateBefore` on alternate frames. That made three
    rebuild node materials every frame: `NodeBuilder.build` took 0.73 s in a 6 s profile, and
    busy time doubled.
  - **Reduce what the mirror sees instead.** Summer mirrors terrain, forest, backdrop, atmosphere,
    homestead, shore, life, garlands and petals (`summer-world.js`, `reflect()`).

## 6. The per-theme queue (pick up here)

**Branching (the owner's call, 2026-10-14):** not one branch per fix. Use one working branch for
the pass, cut from `origin/main` in the audit worktree, with one commit per fix. Merge at batch
boundaries through `gate-push.sh`.

Each item needs the usual loop:
- before/after on this machine, interleaved, n ≥ 2. Use the CPU profile for main-thread work, the
  lane for start time and pipelines, and the level-switch probe for freezes;
- a visual check (screenshots of the theme before and after);
- the docs updated, in the same commit.

The static audit's fixes split into two batches:
- **Batch A:** the mechanism is certain and nothing should look different, so a fix needs no new
  look review:
  - voltage-storm's `shockCount` stuck at 10;
  - fall's warm-up render going to the canvas instead of a target shaped like the scene pass;
  - `forceSinglePass` on aether-tides' additive materials;
  - ranged or idle-skipped particle uploads;
  - memoized deterministic bakes, except the forest family (their noise draws from the theme's
    random stream);
  - fetches and bakes started before `await createRenderer`;
  - pyrestorm's bake running before its first yield.
- **Batch B:** these trade looks for speed or have an uncertain payoff, so each waits for
  measurements and screenshots:
  - MSAA and reflector sample counts, DPR caps, step counts, shadow sizes;
  - unrolled loops → `Loop()`, `setLayout` on helpers;
  - moonlit-forest's `mx_noise` swap;
  - forest-family material sharing.
- **Corrections to the audit:**
  - Stillwater's 2.2 s water compile is stale: the water was rebuilt in `6698ec00`.
  - Forest's full-scene shadow warm-up is deliberate. It front-loads the pipelines the scene needs.
- **Before a fix merges,** take its theme's before numbers from the sweep's base cells.

The queue:

1. **Summer's mirror contents**, the largest single CPU win measured (~1-1.7 ms per frame). Leave
   out the groups that barely read in a rippled half-resolution reflection, such as life,
   garlands, petals and the small shore detail. Keep the far forest and the homestead. Compare
   captures of the lake before and after.
2. **The particle simulations:**
   - sakura's petal ground test → a precomputed height grid sampled bilinearly;
   - forest's light field → commit and upload only when it changed
     (`forest-light-field.js:80` always sets `dirty`);
   - ranged uploads for the sims' buffers (static audit P8: sakura, verdant, painted-ages,
     cinder-drift, luminous-tides).
3. **Forest family, pipeline count** (100-263 pipelines; static audit P7):
   - trees, mist banks and garlands compile one material per asset or bucket, because a buffer or
     constant is baked into the graph;
   - sakura-twilight's attribute model (`sakura-forest.js`) shares one material instead;
   - this cuts the cold start (summer 10.8 s, forest 4.4, golden-forest 4.3) and the per-frame draws.
4. **Scene builds:** the 0.2-0.5 s left at a level-up, and moonlit-forest's 3.0 s build (static
   audit P1/P2).
   - Memoize the deterministic CPU bakes at module level (37 themes rebake on every build).
   - Stop allocating per texel in the lake and shore maps (summer's `summerShores` returns an
     object per call, ~393k per build).
   - Start fetches before awaiting the renderer.
5. **Large single shaders:** rainbark (18 pipelines, 3.4 s cold), moonlit-greenhouse,
   moonlit-forest (the fleet's last `mx_noise`). Find the monster pipelines from the lane's
   per-pipeline rows first.
6. **GPU:** no theme needs GPU work for this machine. For weaker GPUs, the static audit's frame-GPU
   suspects come first: kaleidosonic, fluid-dreams, sky-children, moonlit-greenhouse,
   thermal-bloom.
7. **App-wide, still open:**
   - The CPU profiles show ~80-110 ms/s of JavaScript outside the theme in every theme (Phaser, the
     game, the HUD).
   - `CommandBufferProxyImpl::Flush` ~10-13 ms/s.
   - Plan T10: the single frame driver, Phaser asleep on the menu, the lazy WebGL1 overlay.

## 7. Tools

All of these are in the audit worktree's git-ignored `.cache/theme-audit/`:
- `perf-fleet.sh` / `perf-sweep.sh`: the sweep, nine per lock hold.
- `perf-table.mjs`: the table above, from the cells.
- `level-switch-probe.mjs`: the freeze at an in-play switch, optionally with a CPU profile of each
  switch window (`--profileSwitch=1`).
- `gap-profile.mjs`: what the main thread did inside the worst freeze.
- `theme-cpu-profile.mjs`: a steady-state CPU profile of a theme in play.
- `main-thread-trace.mjs`: a Chrome trace of the renderer main thread in play, ranked by self time;
  `--invalidations=1` names the elements that restyle and re-lay out, and why.
- `switch-ab2.sh`: the interleaved old/new switch run.
- `cpu-calib.sh`: the CPU profiles behind §5. `theme-cpu-profile.mjs --tag=<arm> --evalFile=<js>` runs a
  snippet in the page before profiling (an A/B without a code change; the mirror snippets are in `exp/`).
- `trace-css-ab.sh`: the trace A/B behind §3b.
- Raw results: `results/perf-sweep/base/cells/` (the sweep), `results/switch-ab*/` (switches),
  `results/cpu-calib/` and `results/exp-summer-mirror/` (CPU profiles), `results/trace*/` (traces).
