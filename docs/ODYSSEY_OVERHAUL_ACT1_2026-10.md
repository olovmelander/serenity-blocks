# Odyssey overhaul — Act I lane: Earth Core and the deep ocean (2026-10-20)

**Branch `feature/odyssey-overhaul-act1`** (worktree `serenity-blocks-ody-act1`, base main `d557160a`).
One lane of the whole-journey Odyssey visual overhaul. Olov's question for this act: "how do we
finetune and improve the chapter 1 and 2?" — inside "the most visually stunning ... odyssey" at
120+ fps on Extreme (RTX 3070).

## 0. What the act looked like (integrator's gallery + this lane's seam captures)

- **Chapter 1.** The opening across the lava lake was strong. From local 0.15 the camera looks
  straight up the shaft, and its walls were the basalt colonnade: eighteen 5-7-sided cylinders
  with ONE height segment, so every facet seen from below was one flat dark plane tens of units
  long, and the shorter prisms ended in flat caps the climb passed at 0.45-0.6 (the "flat dark
  rectangular slabs"). The vertical shaft also put the four framing-column stations' eight
  bundles at the same two spots: two giant dark clusters at both edges of every climbing frame.
  Between them the shaft had no wall (the vault is a sphere 250 u out). The hero lava fall was
  two crossed planes at lake level, revealed from local 0.45. From ~0.6 a brown-to-grey steam
  veil filled the frame with no content into the 1->2 seam.
- **Chapter 2.** Steam, then 0.15-0.6 an even mid-blue (luma ~100-110) with bubbles, a few fish
  and pale tube-like shafts; at 0.75 a caustic web on the ceiling that read as a drawn net; the
  island reveal at 0.98 (kept).
- **Seam 1->2** measured maxStep **44.8** of 45 (`seam-1-2-before`): the steam brightened from the
  cavern's luma ~15 to ~118 inside 0.03 of progress. Seam 2->3: 31.3.

## 1. What changed

### Chapter 1 — the shaft (`chapter-environments/earth-core-shaft.js`, new)

| Change | What the player sees |
|---|---|
| **The shaft wall** — one continuous rock wall round the climb, one opaque draw (~76k tris, CPU-built once): a lake chamber (r 66) tapering into the shaft (r 50) and narrowing into a vent **throat** (r 22) exactly where the world's seabed is (y ~98.7, ADR-0017), then a lip | looking up, the walls converge on the throat with the First Heart in it — "the light at the end of the tunnel" |
| **Strata**: broken ledges every 9-16 u stepping inward; colonnade (vertical basalt jointing), tuff and obsidian bands | the ledges' undersides catch the lake's light: concentric rings of firelight receding up the shaft, each band giving back the fire differently |
| **Lighting in-shader** (MeshBasic, no light loop): the lake is the key BELOW, so only down-facing rock catches it; a hot lip line on each ledge; sparse heat cracks that burn where the lake does not reach and in the throat (which glows from within like a maw); warm pools of light round each fall; the quench (uSeam) cools the cracks silver-teal | 70 % dark rock, the fire on the edges, not a wall of orange |
| **A cave mouth** toward the opening's lake vista (the wall closes only above the opening frame's top edge) | the opening frame across the lake is unchanged |
| **Four lava falls** (one instanced ribbon draw, Cinder Drift's technique): two big ones from spouts high on the shaft wall at the frame's sides, two slim curtains from the throat that break into spray before the climb; white-hot core, streaks drawn out by their speed, own halo, spill at the lip, fade near the lens | pouring down toward the rising camera — counter-motion against the ascent |
| **Fewer, eroded framing columns**: one station (the opening's pair + the far filler) instead of four stacked ones; every column is now an eroded spire — tapered, notched, a broken top — instead of a one-segment prism (`createErodedSpireGeometry`) | the opening keeps its left-edge column; the climb loses the two dark claws; no slab anywhere |
| **The selenite chapel's floating shell** (five prisms hung half-way up the shaft, 20 u clear of any wall) is removed; the chapel is its molten heart and corona | no floating rock, no slab at the frame's edge in the steam |
| **The old hero fall** (crossed planes + splash decal) and **the colonnade** are deleted | -2 materials, +2 (wall, falls): 21 materials, 42 drawables (was 51) |

### Chapter 1 — the lake, the embers, the steam

| Change | Where | What the player sees |
|---|---|---|
| **The lake breathes** (High only, with the crust plates): blisters swell in half of a 7.5 u cell grid, glow through their thinning skin, burst (flash) and leave a cooling ring | `createLavaFloorTSL` | the opening frame's lake moves of its own accord |
| **Updraft gusts**: the embers' rise clock is banked on the CPU and runs faster on the music's beats and while the camera glides; a fifth of the risers are cinders falling back | `createRisingEmbers`, `updateEarthCoreEnvironment` | the updraft breathes with the music and the climb; counter-motion |
| **Lights through the steam**: the embers, the near sparks and the falls draw after the quench's shell and dim by its fog (`earthCoreVeilTransmission`, the board's own steam-fog weight); the haze puffs become the steam's near billows (its colour, thicker, after the shell) | `earth-core.js`, `earth-core.tsl.js` | the last third of the climb has depth: rock walls of the throat at the edges, billows streaming past, sparks whitening into droplets |
| **Steam lands on the deep**: luminance cap 0.12 -> 0.074 (the ocean it opens into is darker), dark fraction 0.21 -> 0.30 (enters a little more luminous: gold, not brown smoke), the exit colour dimmed with the deep | `odyssey-steam-quench.js` | a shorter, gentler brightness climb; the seam gate went 44.8 -> ~33 |

### Chapter 2 — the deep ocean (the world's underwater part + composition)

| Change | Where | What the player sees |
|---|---|---|
| **The deep is dark**: `odysseyDeepWaterDim(eyeDepth)` scales the water's in-scattered light (1 near the surface, 0.45 from 140 u down), and the scene fog with it | `odyssey-colour-script.js`, world `submergedOf` | a deep indigo column at the vent brightening toward the surface (luma ~70 -> ~114) instead of one mid-blue |
| **A well of light at the zenith** in the deep (the light comes down from the surface) | world `submergedOf` | the frame is a gradient toward the light the climb stares at |
| **Marine snow lit by the shafts**: each mote tests itself against the nine shafts' axes (vertex stage) and catches the light inside one; two in three SINK against the ascent; the plankton near the lens wakes cyan in the deep | world motes | the shafts read as volumes of lit water; the snow gives depth |
| **Each shaft breathes** on its own phase | world god rays | the light wanders instead of nine constant pipes |
| **Bubbles through the steam**: the carried motes draw after the quench's shell and dim by its fog | world motes + update | the rising bubble column shows in the veil |
| **The ceiling's caustic web becomes light**: wider, softer lines, light gathered at the focus knots, broken into patches | world water underside | a shimmer of focusing light, not a drawn net |
| **The ocean's visitors**: a whale shark in the deepest stretch (the scale beat right after the vent) and a manta higher up, gliding loops overhead and banking through Snell's window; clock-only loops round the ascent, a damped follow of the eye's height (so they are there while parked at an orb); the Ocean theme's Blender-built bodies copied into Odyssey's own asset (`scripts/odyssey-extract-ocean-visitors.mjs`, 160 KB) and swum with a contained port of the theme's ray and fish strokes; orientation from world up | `composition/odyssey-ocean-visitors.js` (new), board hooks (whale-pass lifecycle), `?odysseyNoVisitors=1` | the deep half has its creatures |
| The whale pass hazes into the same darker water | `odyssey-whale-pass.js` | |

## 2. Verification

- In-game captures (Extreme, WebGPU, 1280x720, `--time=9 --envTime=30`, settle 2500) after every
  step, seven rounds (v1-v7) under the shared GPU lock; contact sheets checked each time.
- **Seam luma** (`scripts/odyssey-seam-luma.mjs`, gate 45 luma per 0.01 p):
  - 1->2: **44.8 before -> 29.6** (v7). The curve now runs 36 (cavern) -> 31 -> 47 -> 65 -> 77 -> 83
    (the flash) -> 72 -> 70 (the deep) -> 75 -> 86 -> 100 -> 110 -> 114.
  - 2->3: **31.3 before -> 32.9** (v5; nothing on that side changed after it).
- **WebGL2** (`--force-webgl`) chapters 1 and 2: render as on WebGPU (walls, falls, lake, steam,
  visitors, motes, caustics); console clean.
- **Low tier** chapters 1 and 2: correct (the lake's blisters are High-only by construction, like the
  crust plates); console clean.
- Console: no errors or WebGPU validation messages in any capture (`console.log` of every run).
- `npm run build` (vite build + boot-closure guard): OK — entry 3 chunks / 12 KB, main 4 chunks /
  1223 KB; `ocean-visitors.glb` (160 KB) emitted as an asset.
- Unit: new `tests/unit/earth-core-shaft.test.js` (the plan, the wall's facing, the cave mouth, and
  the wall + falls + High lake graphs built for WGSL and GLSL on a device-less renderer) and
  `tests/unit/odyssey-ocean-visitors.test.js` (the asset, the lifecycle, never belly-up, both
  backends); Earth Core environment / drawable-budget / lake tests, the steam quench test, the
  colour-script tests, the world tests, the URL catalog: all green. In a full parallel run four
  wall-clock tests (URL catalog, world bake loader, forest roster bake, forest lever) time out under
  load; they pass alone.

### Tests whose pinned numbers changed deliberately

- `earth-core-environment.test.js`: the colonnade is gone (`shaftWall` instead); the hero-fall pin
  (one crossed-plane fall visible at frames 12-16) is now "at least three of the shaft's falls in
  frame at frames 4-8".
- `odyssey-steam-quench.test.js`: the dark fraction is read from the module (0.21 -> 0.30), and the
  gate-point ceiling 0.35 -> 0.42 of the cap.
- `docs/URL_PARAMETER_REFERENCE.md`: 756 names / 953 entries (`odysseyNoVisitors`).
- `earth-core-drawable-budget.test.js`: the drawable ceiling ratcheted 55 -> 44 (the chapter is at 42).

## 3. Captures

Scratchpad `$S/lanes/act1/` (`$S` = the session scratchpad):
- `final/before-after-ch01.png`, `final/before-after-ch02.png` — integrator's before (top two rows)
  vs after (bottom two), 8 stations each.
- `final/seam-1-2-before.png` vs `final/seam-1-2-after.png` — the 1->2 seam, 18 stations.
- `cap/sheet-ch0N-{v1..v7,webgl,low}.png` — every round; `cap/*-luma.txt` the seam scores.

## 4. Performance

Lane A (RTX 3070, Extreme, 1920x1080, `scripts/odyssey-gpu-split.mjs --only baseline,baseline-repeat`),
GPU p50 ms baseline / repeat, base = main `d557160a` (a parked worktree checked out at it) alternating
with this branch. A busy machine (other sessions' captures), so read the drift:

| Station (p) | Base | Head | Draws |
|---|---|---|---|
| 0.02 — ch1 climb (local 0.3) | 1.638 / 1.573 | **1.245 / 1.245** | 58 -> 52 |
| 0.05 — ch1 steam (local 0.77) | 1.442 / 1.901 (drift) | 1.376 / 1.442 | 70 -> 61 |
| 0.08 — ch2 deep | 1.376 / 1.376 | 1.376 / 1.376 | 55 -> 57 |

The climb got CHEAPER (~0.35 ms): the one opaque wall early-Z's the vault and replaces 8 framing
bundles and the colonnade's merged prisms; the deep ocean is unchanged with its two visitors. No
new pipeline after the reveal: the shaft's two materials compile with the chapter (pre-reveal), the
visitors through the board's live-loop path while idle (the whale pass's contract); the old fall
and splash materials are gone, so the chapter still holds 21 materials and drops to 42 drawables.
JSONs: `$S/lanes/act1/perf/`.

## 5. Open items

- **The steam veil** (local ~0.8-1.0) is still mostly vapour: the throat walls, near billows and
  rising sparks/bubbles give it depth, but the last fifth of the climb has nothing else in it. A
  richer gold would need more light than the 1->2 gate likes; there is now ~15 luma of headroom if
  the integrator wants to spend it.
- **The falls read as radial streaks** from below (any vertical line does, looking straight up);
  in motion their streaks pour toward the lens. A side-on view (an orb close-up) shows the curtain.
- **The rock is a touch soft** at close range (smooth relief between ledges); a curvature/joint term
  in the wall shader would sharpen it.
- **Visitors in a frozen-clock capture** sit where the clock puts them: at --time=9 the manta is
  out of frame at ch2 0.45-0.6. In play they loop through view every 38 s (manta) / 64 s (shark).
- The selenite chapel's floating basalt shell was removed (the chapel is its molten heart + corona);
  Olov had earlier asked for its crystals to go — if he liked the shell, it is one block to restore.
- Not tried (in the research list): jellyfish; the Geode-style crystal fire (the chapel has no
  crystals since Olov's 2026-08 request).
- `serenity-blocks-eagle` (a parked, merged worktree) was checked out at `d557160a` for the perf base
  and left clean there.
