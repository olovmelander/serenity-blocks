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

## 6. The per-theme queue

> **2026-10-15:** items 1, 2 (in part) and 4 (in part) were worked; see §8, and pick up at §8.4.

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

## 8. The 2026-10-15 pass

Branch `perf/theme-pass-2026-10-15`, one commit per fix. Measured on the RTX in Performance mode on
AC. Two instruments:
- **The lane on production builds:** two or three builds of the branch, each served by its own
  `vite preview`, the lane run against each in turn (`ab-build3.sh`, `ab-lane.sh`). Cells give
  pipelines, first frame, the switch, the second visit's switch (`visit2`) and GPU ms.
- **The dev server, base files swapped in for the "before" arm** (`ab-a1.sh`): an in-page meter
  (`exp/upload-meter.js`) counts `writeBuffer` calls and bytes per second and draws per frame.

### 8.1 What changed

| Fix | Measured, before → after |
|---|---|
| Voltage Storm: the water loops over live rings only, not all ten slots | GPU at rest 1.11 / 1.11 → 0.98 / 1.05 ms (n=2) |
| Summer: garlands, petals, down, pollen, butterflies and lily pads out of the lake mirror | draws 136 → 130 per frame; pipelines 263 → 248; first frame 12.1 → 11.3 s (n=1) |
| Fall: the shadow rig is primed into a scene-pass-shaped target, not the canvas | pipelines 107 → 95 |
| Aether Tides: `forceSinglePass` on the additive double-sided quads | pipelines 26 → 22; GPU 1.57 → 1.18 ms; uploads 8.1 → 4.7 MB/s |
| Cinder Drift: the spatter pool uploads only the slots a burst wrote | uploads 17.5 → 16.6 MB/s (the falls, rewritten whole every frame, are the bigger writer) |
| Per-frame pools upload only the instances drawn (`shared/instance-upload.js`): Luminous Tides, Sky Children, Sunset | Luminous glows 3.0 → 1.6 MB/s; the other pools are drawn nearly full |
| A shared bake cache (`shared/bake-cache.js`) for nine themes' deterministic bakes | second visit's switch, ms: serenity-warp 484 → 105, stellar-velocity 396 → 87, sky-children 644 → 302, koi-pond 680 → 190, luminous-tides 367 → 68, sunset 302 → 64, stellar-drift 201 → 75, thermal-bloom 692 → 444 |
| Pyrestorm: the first visit's four bakes breathe between them; the prepare starts early | switch 1143 / 1156 → 1090 / 1089 ms (n=2); first frame unchanged |
| Forest: the firefly light field uploads only when a byte changed | not measured (one 9 KB texture a frame at most) |
| The perf lane measures a theme on its own again | see 8.3 |

First visits are unchanged by the bake cache, by design.

### 8.2 What did not pay, or is parked

- **Per-draw CPU is the frame cost.** A draw census (`exp/draw-census.js`): summer 136 draws a frame
  (79 scene, 40 mirror, 17 post), sakura 99, golden-forest 88, forest 60, verdant 58, fall 51. Three
  spends about 30-50 µs of main thread per draw (bindings, uniform writes, `writeBuffer`, the
  render-object lookup). Fewer draws (merged or batched meshes, fewer passes) is the lever, not
  smaller shaders.
- **Shared uniform groups do not help.** Moving the themes' plain uniforms (and uniform arrays) into
  three's `renderGroup` at build time measured flat (summer 292 → 289 ms/s in the render call).
  Three keys a shared buffer by its exact uniform set, and each material has its own set, so the
  buffers still update about once per material per pass.
- **Per-object uniform buffers re-upload on every draw** (three r186: `Buffer.update()` is always
  true). That covers uniform arrays and the instance matrices of pools up to 1023 instances, which
  three keeps in a uniform buffer. A runtime skip of unchanged buffers (by attribute version, or by
  content for small arrays) cut uploads by 70-87% (summer 82 → 11 MB/s, forest 24 → 7.6) but left
  main-thread busy time flat on this machine. It helps the GPU process and memory bandwidth (an
  integrated GPU), and would need a three patch with a contract test like the build budget. Parked.
- **Starting the land or cavern load before the renderer did not pay** (reverted, e2e7b00d). High
  Coast's first frame went 3.20 → 3.85 s and its switch 771 → 940 ms: the sliced land prepare competes
  with the renderer's start for the main thread rather than overlapping it. Crystal Cave's start did
  not move, and its steady CPU in render rose 3.6 / 3.9 → 5.1 / 5.0 ms (ABBA, unexplained).
- **Summer's mirror trim is worth ~0.1-0.2 ms a frame,** not the 1-1.7 ms the whole mirror costs: the
  mirror's 40 draws are mostly the visible far shore. A per-object visibility probe
  (`mirror-visibility.mjs`) could not settle the rest: under Reduce motion consecutive frames still
  differ on ~40% of the pixels.

### 8.3 The lane after the build-behind switch

Since aebcb2fc the lane's anchor theme stayed alive through a 2.5 s crossfade; its late `stop()`
disarmed the measured theme's GPU timestamps (no samples, every cell inadmissible) and the second
visit raised hundreds of cross-device validation errors. The bootstrap now turns
`themeSwitchBehind` off for the lane, so a theme is measured with the classic switch as in §4;
the level-switch probe measures the in-play path. Cells still say "inadmissible" for themes that
reset `renderer.info` themselves (draw counts only); pipelines, first frame, switch and GPU stand.

### 8.4 Queue after this pass

0. **What the owner feels (first):** he plays at a 120+ fps cap, where a frame has 8.3 ms, not the
   16.7 ms this record measures at. Thermal Bloom (especially while combos and effects fire),
   Kaleidosonic and Rainbark feel choppy, sluggish and slow to load to him. Measure them at a
   120 cap, in his window, with an effects storm, before anything else.
1. **Fewer draws** in the forest family: barks per asset, flowers per species and LOD (summer 18
   flower draws), mist banks and garlands per index. Sakura's attribute model shares one material;
   a `BatchedMesh` merges draws of different geometry.
2. **Cinder Drift's falls** rewrite three attributes whole every frame (the bigger writer).
3. **Sakura's petal ground test** (a precomputed height grid): a look check first, since petals
   would land a few millimetres off the analytic ground.
4. **The upload skip** (8.2) if integrated-GPU frames matter.
5. The rest of §6 stands.

## 9. Play-feel at 120 fps (2026-10-15, afternoon)

Olov plays at a 120+ fps cap and found Thermal Bloom (above all during combos), Kaleidosonic and
Rainbark choppy, sluggish and slow to load (§8.4 item 0). The lane measures at 60 fps and 1080p,
where an 8 ms theme looks comfortable; at 120 fps a frame has 8.3 ms for everything. So this pass
measured what he feels, on every theme, and fixed what measured slow.

### 9.1 The probe

`.cache/theme-audit/play-feel.mjs` (scratch, git-ignored) plays the real game the way he does: his
cap (120), a window the size of the display's work area, Single Player. Per theme:
- **load**: a switch in play from an anchor theme (aurora; stellar-drift for aurora itself). It
  records ms to "running", to the first presented frame and to the container being shown, and the
  main thread's long tasks.
- **idle**: 6 s at rest.
- **storm1, storm2**: 8 s each of locks, hard drops, clears of one to four lines, combos, T-spins,
  back-to-backs and a perfect clear, fired every 350 ms through the app's own
  `/src/events/gameplay-events.js` emitters. Storm 1 holds the first-use compiles; storm 2 the
  steady cost.

Each phase records presents per second of the theme's canvas (a `GPUCanvasContext.getCurrentTexture`
hook), frame-interval percentiles, janks (frames over 1.5x the budget), rAF cadence, long tasks and
the renderer's pixel ratio. A classic WebGL theme presents no WebGPU frame, so read its rAF rate and
long tasks. Runners: `play-feel.sh` (env `THEMES`, `TAG`, `BASE`, `ANCHOR`, `EXTRA`),
`play-feel-fleet.sh` (all 63 themes against the main checkout's dev server), `play-feel-table.mjs`
(`--sort=freeze|storm`, `--md=1`). `--cpuprofile=1` saves CPU profiles of the load and of storm 1;
`--quick=1 --evalFile=<js>` runs a snippet after the switch (`exp/first-builds.js` names the render
objects that build for the first time during a storm).

### 9.2 The fleet at 120 fps (main, b269bfea)

Nearly every theme holds 127-131 fps at rest and in storms: the cap is met, so GPU work is not
what he feels. What he feels is main-thread work:
- **Storm drops** came from CPU work an event triggers, or from a pipeline first used mid-game.
  High Coast's clear-time mist placement, Sakura's 6000-petal CPU simulation, Thermal Bloom's
  per-pixel bloom loop (GPU, fixed in §8), Summer's and Golden Forest's combo ribbons.
- **Load freezes** (the longest task of a switch in play) came from CPU bakes inside the world's
  synchronous build, and from the first frame building (TSL to WGSL) every material on the page.
  Two classic WebGL themes linked every program in their first frame.

Main, sorted by the longest load freeze (j = janks; % = GPU busy):

| Theme | Shown (s) | Longest freeze (ms) | Blocked (ms) | At rest | Storm 1 | Storm 2 |
|---|---:|---:|---:|---|---|---|
| moonrise-summit | - | 1661 | 1661 | 0 fps, 0 j, 39% | 0 fps, 0 j, -% | 0 fps, 0 j, -% |
| misty-lake | - | 1473 | 1525 | 0 fps, 0 j, 43% | 0 fps, 0 j, 43% | 0 fps, 0 j, -% |
| koi-pond | 2.8 | 784 | 859 | 128.8 fps, 9 j, 36% | 129.2 fps, 9 j, 39% | 129.2 fps, 13 j, 39% |
| sky-children | 3.5 | 717 | 1056 | 128.4 fps, 9 j, 39% | 129.2 fps, 8 j, 42% | 128.9 fps, 10 j, 44% |
| thermal-bloom | 3.3 | 598 | 920 | 129 fps, 6 j, 55% | 122.5 fps, 12 j, 83% | 114.5 fps, 10 j, 96% |
| moonlit-greenhouse | 3.8 | 540 | 1392 | 127.8 fps, 12 j, 51% | 129.3 fps, 10 j, 56% | 130.7 fps, 1 j, 58% |
| rainbark | 4.5 | 459 | 892 | 128.6 fps, 9 j, 38% | 129.1 fps, 9 j, 40% | 129.8 fps, 7 j, 39% |
| serenity-warp | 2.3 | 457 | 541 | 129.1 fps, 10 j, 34% | 128.9 fps, 12 j, 32% | 125.8 fps, 13 j, -% |
| ocean | 2.4 | 403 | 514 | 129.4 fps, 6 j, 37% | 129.2 fps, 10 j, 39% | 127.8 fps, 15 j, 39% |
| summer | 3.9 | 376 | 877 | 130.2 fps, 3 j, 51% | 123 fps, 10 j, 49% | 129.4 fps, 7 j, 47% |
| pyrestorm | 3.0 | 374 | 908 | 130.4 fps, 6 j, 38% | 128 fps, 14 j, 40% | 129.7 fps, 10 j, 38% |
| luminous-tides | 2.6 | 357 | 496 | 130 fps, 5 j, 37% | 130 fps, 4 j, 40% | 126.8 fps, 5 j, 39% |
| stellar-velocity | 2.1 | 348 | 348 | 130.1 fps, 2 j, 38% | 130.1 fps, 2 j, 39% | 130 fps, 4 j, 39% |
| verdant-hills | 2.8 | 342 | 533 | 129 fps, 8 j, 52% | 128.7 fps, 17 j, 56% | 128.4 fps, 11 j, 58% |
| chiral-gold | 2.5 | 336 | 822 | 128.8 fps, 9 j, 36% | 128.9 fps, 15 j, 38% | 129.4 fps, 11 j, 39% |
| sunset | 2.2 | 297 | 380 | 130.6 fps, 0 j, 37% | 129.9 fps, 4 j, 40% | 130.3 fps, 1 j, 39% |
| high-coast | 3.3 | 283 | 731 | 129.6 fps, 5 j, 48% | 123.5 fps, 31 j, 46% | 122.4 fps, 32 j, 45% |
| forest | 2.9 | 277 | 897 | 129 fps, 5 j, 39% | 130.4 fps, 1 j, 39% | 128.8 fps, 11 j, 39% |
| golden-forest | 2.9 | 274 | 378 | 130.2 fps, 1 j, 39% | 121.9 fps, 13 j, 36% | 129.8 fps, 2 j, 38% |
| bioluminescence | 2.6 | 239 | 725 | 128.2 fps, 9 j, 42% | 126.7 fps, 8 j, 43% | 128.1 fps, 12 j, 44% |
| sakura-twilight | 3.6 | 237 | 595 | 126.8 fps, 15 j, 41% | 111.5 fps, 15 j, 38% | 107.3 fps, 8 j, 37% |
| wolfhour | 2.1 | 232 | 232 | 127 fps, 10 j, 31% | 125.9 fps, 15 j, 31% | 129.6 fps, 3 j, 32% |
| voltage-storm | 2.4 | 226 | 276 | 129.3 fps, 6 j, 30% | 129.2 fps, 5 j, 32% | 128.4 fps, 12 j, 33% |
| cinder-drift | 2.0 | 224 | 277 | 130.5 fps, 1 j, 37% | 129.5 fps, 1 j, 37% | 130 fps, 5 j, 39% |
| shifting-sands | 2.1 | 196 | 275 | 130.2 fps, 1 j, 32% | 130.7 fps, 1 j, 31% | 130.9 fps, 1 j, 31% |
| neon-district | 2.3 | 193 | 479 | 129.6 fps, 8 j, 36% | 129.5 fps, 9 j, 39% | 129.1 fps, 12 j, 39% |
| aurora | 2.0 | 193 | 293 | 129.8 fps, 4 j, 30% | 130 fps, 7 j, -% | 130.5 fps, 6 j, -% |
| solar-eclipse | 2.3 | 168 | 233 | 126.4 fps, 3 j, 36% | 130.5 fps, 0 j, 32% | 130 fps, 2 j, 35% |
| fall | 2.5 | 158 | 269 | 127 fps, 19 j, 38% | 128.1 fps, 18 j, 38% | 128.9 fps, 12 j, 39% |
| stellar-drift | 2.4 | 158 | 277 | 128.3 fps, 7 j, 32% | 128.3 fps, 13 j, 37% | 129.2 fps, 11 j, 38% |
| halcyon-apex | 2.3 | 145 | 347 | 130.1 fps, 4 j, 35% | 130.2 fps, 4 j, 39% | 129.7 fps, 10 j, 39% |
| supernova | 2.0 | 145 | 200 | 130.6 fps, 0 j, 35% | 129.4 fps, 6 j, 39% | 130 fps, 4 j, 38% |
| starlight | 2.0 | 142 | 142 | 130.8 fps, 3 j, 36% | 130 fps, 4 j, 41% | 130.4 fps, 2 j, 38% |
| lunara | 2.2 | 139 | 305 | 129.1 fps, 8 j, 35% | 129.2 fps, 9 j, 39% | 127.7 fps, 13 j, 37% |
| stillwater | 2.6 | 139 | 321 | 130.5 fps, 1 j, 37% | 129.9 fps, 3 j, 39% | 130.4 fps, 2 j, 39% |
| geode | 2.1 | 139 | 234 | 127.9 fps, 11 j, 36% | 128.4 fps, 13 j, 39% | 129.3 fps, 8 j, 36% |
| painted-ages | 2.8 | 138 | 496 | 129.1 fps, 8 j, 37% | 129.2 fps, 10 j, 40% | 129.2 fps, 9 j, 39% |
| ice-temple | 2.4 | 136 | 250 | 130.1 fps, 2 j, 37% | 130.4 fps, 0 j, 40% | 129.9 fps, 6 j, 38% |
| himalayan-peak | 2.5 | 129 | 444 | 129 fps, 9 j, 37% | 128.5 fps, 17 j, 39% | 129.7 fps, 8 j, 38% |
| tornado | 1.8 | 122 | 122 | 130.7 fps, 1 j, 36% | 127.4 fps, 6 j, 38% | 129.2 fps, 7 j, 39% |
| crystal-cave | 2.1 | 118 | 118 | 129.8 fps, 2 j, 37% | 129.5 fps, 8 j, 39% | 130.5 fps, 5 j, 39% |
| black-hole | 2.0 | 116 | 116 | 128.3 fps, 3 j, 26% | 128.6 fps, 4 j, 30% | 130.6 fps, 3 j, 32% |
| waves | 2.1 | 115 | 171 | 130.3 fps, 2 j, 37% | 129.9 fps, 5 j, 39% | 130.6 fps, 2 j, 39% |
| nebula-flow | 2.3 | 114 | 187 | 128.3 fps, 6 j, 36% | 126.7 fps, 8 j, 39% | 130.6 fps, 1 j, 39% |
| murmuration | 2.3 | 111 | 111 | 129.7 fps, 3 j, 46% | 130.1 fps, 6 j, 48% | 130.6 fps, 5 j, 47% |
| chromadelic-highway | 1.8 | 104 | 104 | 126.9 fps, 16 j, 33% | 128.1 fps, 15 j, 30% | 129.1 fps, 9 j, 32% |
| fluid-dreams | 2.4 | 103 | 157 | 129.3 fps, 1 j, 37% | 128.9 fps, 4 j, 53% | 128.8 fps, 7 j, 51% |
| galaxy | 1.9 | 92 | 165 | 131.3 fps, 1 j, 37% | 131.1 fps, 2 j, 40% | 131 fps, 1 j, 39% |
| void-ember | 2.0 | 91 | 91 | 129.3 fps, 7 j, 36% | 129.4 fps, 5 j, 38% | 129 fps, 7 j, 39% |
| aether-tides | 1.9 | 86 | 138 | 130.5 fps, 4 j, 35% | 130.4 fps, 3 j, 35% | 129.2 fps, 7 j, 35% |
| vesper-chrysalis | 2.2 | 81 | 158 | 130.3 fps, 1 j, 36% | 130 fps, 3 j, 39% | 130.5 fps, 1 j, -% |
| winter | 2.5 | 77 | 245 | 128.8 fps, 8 j, 38% | 127.7 fps, 8 j, 40% | 128.4 fps, 13 j, -% |
| neon-dusk | 1.8 | 77 | 77 | 130.3 fps, 2 j, 28% | 129.6 fps, 3 j, 33% | 129.5 fps, 7 j, 37% |
| parhelion | 1.8 | 54 | 54 | 130.8 fps, 2 j, 29% | 130.8 fps, 2 j, 29% | 130 fps, 7 j, 29% |
| synthwave-sunset | 1.8 | 52 | 52 | 130.9 fps, 1 j, 34% | 131.2 fps, 0 j, -% | 128.6 fps, 7 j, -% |
| kaleidosonic | 1.8 | 52 | 52 | 129.3 fps, 8 j, 63% | 131.1 fps, 1 j, 71% | 129.1 fps, 11 j, 79% |
| moonlit-forest | 4.4 | 0 | 0 | 128.3 fps, 13 j, 30% | 129.4 fps, 10 j, 30% | 128.5 fps, 13 j, 38% |
| cosmic-noir | 2.2 | 0 | 0 | 130.5 fps, 7 j, 24% | 127.2 fps, 18 j, 26% | 129.4 fps, 10 j, 29% |
| blood-moon | 2.1 | 0 | 0 | 131.2 fps, 1 j, 24% | 127.5 fps, 8 j, 27% | 129.2 fps, 8 j, 32% |
| astral-weave | 1.7 | 0 | 0 | 131.3 fps, 2 j, 27% | 131.8 fps, 0 j, 28% | 131.1 fps, 1 j, 28% |
| chromatic-impasto | 1.9 | 0 | 0 | 130.5 fps, 2 j, 29% | 130.3 fps, 2 j, 31% | 129.8 fps, 6 j, 32% |
| nimbus-veil | 1.8 | 0 | 0 | 129.3 fps, 4 j, 34% | 127.7 fps, 15 j, 32% | 129.4 fps, 6 j, 33% |
| rainy-window | - | - | - | 0 fps, 0 j, 27% | 0 fps, 0 j, 27% | 0 fps, 0 j, 27% |

Rainy Window (2D, no 3D renderer) timed out the load measure and is not covered.

### 9.3 What changed on the branch

| Fix | Measured at 120 fps, main → branch |
|---|---|
| Thermal Bloom: the bloom loop skipped for pixels a bloom cannot reach (32e9bc0e) | storms 114.5-122.5 → 129-130 fps |
| Bake worker (`shared/bake-worker-client.js`, `bake-worker-host.js`): a theme starts its first visit's CPU bakes in a module Worker before it awaits its renderer, and the build finds them in the bake cache | longest load task, ms: thermal-bloom 538-689 → 145-188, koi-pond 718-784 → 179-242, sky-children 717-866 → 302-316, pyrestorm 374-462 → 54-56, rainbark 459 → 223-238, moonlit-greenhouse 540-626 → 268-297, ocean 403-498 → 79-83, serenity-warp 452-472 → 56, luminous-tides 357-410 → 74, stellar-velocity 348-377 → none over 50 ms |
| Moonrise Summit and Misty Lake (classic WebGL): `compileAsync` for the composer's buffer before the first frame, at most 4 s | longest load task 1561-1696 → 137-143 ms; 1473 → 200 ms (running 2.8 → 0.65 s) |
| High Coast: an event's water sites run a few per frame under a march budget (b1b05304) | storms 122.4-124.9 → 128.4-130.6 fps; p99 frame 27-30 → ~10 ms |
| Sakura: the same petal motion for less work (0db17490) | Node bench 2.7 → 1.7 ms a frame, bit-identical. Storms, A/B (two runs each): main 110.4 / 98.4 and 130 / 126.7 → branch 130 / 130.5 and 129.3 / 130.3 fps |
| Summer, Golden Forest: the combo ribbons draw while the theme is built hidden (1ed8ed87) | Summer storm 1: 122.6 / 124.3 (a 0.37-0.41 s stall) → 129.4 / 130.2 fps; Golden Forest storm 1 (A/B): 122.2 / 123.8 (a 0.15 s stall) → 129.8 fps |
| The build budget counts the open time of an outer build (ffbe625e) | a post quad drew the scene pass inside its own charge, so a first frame built every material in one task; see 9.4 |

### 9.4 What the profiles say about the rest

- **One heavy material is one task.** The build budget (§3) defers new render objects past 8 ms a
  frame, but a single material's node build cannot be split. Chiral Gold's towers build 150-300 ms
  each (a mirror material, then the towers again inside its reflector); verdant and summer have
  100+ ms materials too. Fixing that means smaller node graphs (`Fn().setLayout()` functions in
  place of inlined repeats), theme by theme.
- **Scene builds from analytic terrain.** Verdant Hills and Summer spend about 430 ms each in the
  world's build sampling their terrain functions (grass and flower scatter, the lake map, tree
  layout). A worker can take it, but it means moving the scatter's arrays out of the mesh code.
- **First-use pipelines.** A drawable revealed by its first event compiles its pipeline then,
  synchronously in the GPU process: a 0.1-0.4 s frame with no long task on the main thread. A theme
  can draw such pools unseen while it is built hidden (as the ribbons now do). Only four themes call
  `warmParkedDrawables` themselves; nothing calls the other themes' `getWarmupRoots()`.
- **Run-to-run spread is large at 120 fps.** Sakura's storms read 121.7 / 120.9 and 130 / 129 fps in
  two branch runs; Summer's storm 2 ranged 118-129 on either arm. Compare A/B pairs, not single runs.

### 9.5 Queue after this pass

1. ~~The heavy single materials: Chiral Gold's towers and mirror~~ (done, §9.6), then verdant's and
   summer's largest.
2. Verdant Hills' and Summer's terrain scatter in a worker.
3. A generic warm of `getWarmupRoots()` during the hidden build-behind settle (reveal the parked
   pools until quiet, restore before the swap).
4. Sakura: the petal simulation in a worker (the step is still ~2 ms a frame at High), if the A/B
   still shows storms under 125 fps.
5. Rerun the fleet sweep on main after the merge.

### 9.6 Chiral Gold's gold (2026-10-15, evening)

Its load froze 150-300 ms a frame while ten gold materials built (§9.4). A Node harness
(`.cache/cg/build-times.mjs`: every material built as `NodeManager` builds it, the scene's
environment included) put the cost in three's physical lighting model, not in the theme's own
nodes: a gold material built in 17-45 ms with the studio as the scene's environment, 1-8 ms
without. Each one also builds twice on the page (the scene pass and the water's mirror).

| Change | Measured |
|---|---|
| `cgStudioMetal`: what `MeshStandardNodeMaterial` computes for metalness 1 under the studio and no lights (three's DFG table, the reflection leaned to the normal by roughness, multiple-scattering energy lit by the irradiance, the scene's environment intensity and rotation), on a `MeshBasicNodeMaterial` (0d896355) | Node build per gold material 29 → 9 ms; fragment shader 23 → 9-18 KB. Playground shots (rest, clear, quad, T-spin, level-up, heat) pixel-identical to main: at most 32 of 921,600 pixels off by one level |
| The studio and the noise bake in a worker on a first visit (30768b85) | the bakes byte-identical to main's; about 0.1 s off the scene build |
| One gold material per kind for both towers, one for the ring's bands, told apart per object (`u.hand`, `u.band*`, `onObjectUpdate`) (c4e14976) | ten gold materials → five; shots still pixel-identical |

Chiral Gold at 120 fps, a switch in play, unprofiled: the longest load task 336 ms (main) → 72
(lean gold and the bakes) → 59 ms (shared); blocked 822 → 191 → 162 ms; rest 130.9 fps, storms
130 / 128.4 fps.

Two runs in this pass read 61-72 fps at rest and in storms with the main thread idle and rAF at
64 Hz; a bisect (each change alone, both) and a rerun read 129-131 fps. Windows logged display
power transitions (Kernel-Power 566) in that hour: check the rAF rate before blaming the code
when a whole run sits at 60-ish.

## 10. Load freezes, theme by theme (2026-10-16)

A switch in play at 120 fps, the probe of §9.1 (`--loadOnly=1`, profiles with `--cpuprofile=1`),
branch `perf/theme-pass-2026-10-16`. Today's sweep on main put sixteen themes over 200 ms of longest
load task (rainy-window 755, rainbark 478, summer 373, moonlit-greenhouse 365, verdant-hills 351,
high-coast 331, koi-pond 323, sky-children 303, sunset 287, forest 274, sakura 271, cinder-drift 271,
golden-forest 258, bioluminescence 245, voltage-storm 210, wolfhour 204). Every fix below keeps the
art: each refactored build was fingerprinted before and after (every mesh's attribute bytes, index,
material and matrix, the baked textures, per quality tier) and hashes identical; storm screenshots
match main's.

### 10.1 What changed

| Change | Longest load task, ms, main → branch (two runs each) |
|---|---|
| **Stepped builds** (`shared/build-steps.js`): a world's `build()` drains a `* buildSteps()` generator that yields between its heavy parts (same parts, same order, same random sequence). The theme runs the steps with a macrotask before each, and takes the world only once it is whole (`buildWorldBreathing`; a stop or a part that throws disposes it there). Forest family (8975b463), Moonlit Greenhouse (2aa71635), High Coast (9b1dba04), Cinder Drift, Sky Children, Bioluminescence, Koi Pond | summer 425 / 426 → 107 / 113, verdant-hills 406 / 412 → 116 / 114, forest 293 / 295 → 127 / 151, golden-forest 263 / 263 → 50 / 83, moonlit-greenhouse 324 / 346 → 80 / 78, high-coast 272 / 293 → 158 / 148 |
| Rainy Window (classic WebGL): `compileAsync` for the canvas and the mirror's half-float target before the first frame, at most 4 s (9c0b30aa) | 760 / 790 → 0 / 50; running 806 → 390 ms |
| First-visit bakes in a module worker: Sunset's sky and sea noise (ef19778b), Voltage Storm's noise (bc53c899), Cinder Drift's noise and plates (cb42f05f), Wolfhour's landscape (3cae0498: four ranges and the granite; three's indexed `computeVertexNormals` reproduced bit for bit, `vertexNormals`), Bioluminescence's noise and plan (a07e81d6: the plan's readers are closures, so the plan comes as data and is handed to one world, which makes them), Koi Pond's water mask and noise (75c7ed41) | sunset 292 / 290 → 75 / 68, voltage-storm 204 / 215 → 73 / 74, wolfhour 211 / 215 → 55 / 56, bioluminescence 245 / 242 → 51 / 55, koi-pond 237 / 179 → none over 50 ms, cinder-drift 262 / 267 → 89 / 96 |
| Sky Children: the isles (`createIslesSteps`) and the world in steps (d7b314d9) | 306 / 304 → 67 / 74 |
| **The switch's build budget per task** (caa24b4b). It reset every 14 ms of wall clock, so a frame whose builds each took over 14 ms refilled it from its own length and deferred nothing: koi-pond spent 375 ms, bioluminescence 591 ms and sky-children 213 ms in one frame of node builds. It now opens at a task's first new build and closes at the next macrotask | bioluminescence's long tasks in a switch, total 833 / 740 → 255 / 245 ms; summer's 1231 / 999 → 242 / 261 |
| A breath before the first step too (367c23f5): Cinder Drift's constructor (its plan, 91 ms) and first step (47 ms) had shared a task | cinder-drift 137 / 127 → 89 / 96 |

Storms and rest on the branch: 127-131 fps in every changed theme (one full run each, with shots).
The price is time: a stepped or budgeted theme reaches "running" 0.1-0.4 s later (summer 2.7 → 3.0
s, cinder-drift 0.78 → 0.95 s), with the old theme playing on meanwhile.

### 10.2 What is left

- **One heavy material is still one task.** The per-task budget defers every build after a task's
  first, but cannot split a material: rainbark's trunks (136-206 ms in a switch), sky-children's sky
  (66 ms cold in Node, 56 KB of fragment shader, 673 node variables, little of it repeated),
  high-coast's and cinder-drift's largest. Smaller graphs mean rewriting those shaders, theme by
  theme.
- **The warm of parked effects is deferred more often.** `warmParkedDrawables` draws a theme's hidden
  pools once, in `createScene`; under the per-task budget most of that draw is deferred, so those
  pools build when first revealed. The switch keeps budgeting for up to 20 s after the reveal, so
  that is a budgeted build, not a stall, unless the first combo comes later. The generic warm of
  §9.5 item 3 (reveal the parked pools on every frame of the hidden settle until quiet) closes it.
- Cinder Drift's plan (91 ms) still runs in the world's constructor: its `depthAt` reader is a
  closure, so a worker would hand it over the way Bioluminescence's plan is.
- Sakura's storms (122-125 fps in today's sweep), §9.5 item 4.

Tools: the probe as in §9.1; `.cache/theme-audit/material-times.mjs <theme> <WorldClass>` (each
material built as `NodeManager` builds it, warm and cold ms, `--dump=` writes the WGSL). A
"chunk" of a profile with no idle sample can be many frames back to back: count tasks with the
probe's long-task numbers, not with profile chunks.

