# Chiral Gold — visual evidence

The overhaul gives Chiral Gold paired, oppositely handed gold ribbon sculptures,
flowing filaments, an amber atmosphere and traveling gameplay reactions.
Implementation and quality budgets are recorded in
[the design record](../../docs/CHIRAL_GOLD_VISUAL_OVERHAUL_2026-10.md).

## Fresh evidence

| Surface | Capture | Diagnostics |
| --- | --- | --- |
| Isolated native WebGPU High | [Desktop sculpture](playground-webgpu-desktop-high-idle.png) | [Validation](playground-webgpu-desktop-high-validation.json) |
| Isolated node WebGL2 High | [Desktop sculpture](playground-webgl2-desktop-high-idle.png) | [Validation](playground-webgl2-desktop-high-validation.json) |
| Production native WebGPU High | [Idle](theme-webgpu-desktop-high-idle.png), [clear](theme-webgpu-desktop-high-clear.png), [combo](theme-webgpu-desktop-high-combo.png) | [Validation](theme-webgpu-desktop-high-validation.json) |
| Production node WebGL2 High | [Idle](theme-webgl2-desktop-high-idle.png), [clear](theme-webgl2-desktop-high-clear.png), [combo](theme-webgl2-desktop-high-combo.png) | [Validation](theme-webgl2-desktop-high-validation.json) |
| Production phone node WebGL2 Low | [Portrait](theme-webgl2-phone-low-idle.png), [combo](theme-webgl2-phone-low-combo.png), [landscape](theme-webgl2-phone-low-landscape.png) | [Validation](theme-webgl2-phone-low-validation.json) |

All five validation records pass after the final visual refinement. Isolated
native/WebGL2 and production native High have zero console errors or warnings.
Production WebGL2 High and phone Low have zero errors and four ANGLE performance
warnings each about reserved `outsideRenderPass queueSerial` capacity. The
warnings are preserved in JSON. They are software-driver performance diagnostics,
not shader or GPU validation failures.

Native High uses MRT and has all three compute systems ready. Each integrated
run stops with an inactive theme and zero remaining theme canvases. Native
idle/clear/combo, WebGL2 idle/clear and phone idle/combo/landscape were visually
inspected. Row-clear emission now appears as sparse gold flecks at two edge
columns, keeping the center readable while the foil and peripheral reactions
remain prominent.

Each PNG has a same-basename JSON snapshot. The aggregate `*-validation.json`
includes the whole run and console/teardown results. Filenames and diagnostics
should be checked together; a filename alone does not certify which adapter or
renderer was exercised. An earlier session's before-image comparison is not
included in this fresh artifact set.

## Reproduction

Run each browser capture sequentially from the repository root. The script starts
its own Vite server on an available loopback port and closes both server and
browser after the capture.

Playwright must be resolvable as `playwright`, or supply the absolute path to its
ES module through `PLAYWRIGHT_MODULE`. `CHROMIUM_EXECUTABLE` is optional when
Playwright's managed Chromium is installed; set it to use another compatible
Chromium executable.

```bash
export PLAYWRIGHT_MODULE="/absolute/path/to/playwright/index.mjs"
export CHROMIUM_EXECUTABLE="/absolute/path/to/chrome"

node scripts/chiral-gold-visual-validation.mjs playground --native
node scripts/chiral-gold-visual-validation.mjs playground
node scripts/chiral-gold-visual-validation.mjs playground --mobile --low --no-post

node scripts/chiral-gold-visual-validation.mjs theme --native
node scripts/chiral-gold-visual-validation.mjs theme
node scripts/chiral-gold-visual-validation.mjs theme --mobile --low
```

Useful variants:

```bash
node scripts/chiral-gold-visual-validation.mjs playground --native --no-post
node scripts/chiral-gold-visual-validation.mjs playground --low --no-post
```

The manual playground supports precise event-age comparisons:

```text
/playground.html?effect=chiral-gold&t=8&orbit=0&quality=High
/playground.html?effect=chiral-gold&t=8&orbit=0&quality=High&forceWebGL=1
/playground.html?effect=chiral-gold&t=8&orbit=0&quality=High&event=combo&strength=2&eventAge=0.45
/playground.html?effect=chiral-gold&t=8&orbit=0&quality=Low&forceWebGL=1&noPost=1&board=1&event=tetris&eventAge=0.6
```

The manual page receives deterministic randomness from the playground harness.
`seek()` clears active reactions before replaying the requested event age. Its
optional board overlay is a placement guide, not a running Tetris board.

## Capture contract and environment

Desktop captures use 1440 × 900 at DPR 1. Phone captures use 390 × 844 at DPR 3,
then resize to 844 × 390 for the landscape check. The harness leaves the global
render scale at its default of 1.0; screenshots use CSS scale. The script waits
for playground readiness and holds fixed `t=8`, so simulation delta is zero while
the display loop continues.

Theme mode mounts the production theme, renderer and canonical event bus in an
isolated DOM shell. It starts simulation time at eight seconds, overrides the
timer delta to 1/60 second, and advances the real animation/CPU/compute updates
with scene drawing temporarily suppressed. Each batch draws the final scene
once and drains submitted native GPU work before capture. Idle uses three steps;
piece lock uses eight; a four-line clear uses ten; combo 8 plus another four-line
clear uses twelve. Phone landscape advances a further 120 steps. Event state is
continuous across this sequence.

JSON records backend, compute readiness, sculpture pool diagnostics, renderer
counters, console output and teardown. The theme shell uses explicit stacking
for its canvas instead of the full app's background stack. It is not a full
real-board/HUD or gameplay timing acceptance test.

The script currently requests these software-adapter flags:

```text
--no-sandbox
--enable-unsafe-swiftshader
--use-angle=swiftshader
--enable-unsafe-webgpu
--enable-features=Vulkan
--use-vulkan=swiftshader
--disable-vulkan-surface
```

Native captures must identify the backend as WebGPU in JSON; requesting native
does not permit silently counting a WebGL fallback as a native pass. Here native
WebGPU reports a Google SwiftShader adapter. These flags are for repeatable
isolated software-rendering correctness checks and do not benchmark a physical
GPU. A hardware performance session needs its own launch configuration and
verified profiling instrument under ADR-0016.

Do not interpret a blank screenshot or a device-loss banner as visual acceptance,
even if a readiness signal or resource snapshot exists. Final phone screenshots
were regenerated after correcting an isolated-shell stacking issue and visually
inspected; the actual artwork is visible on both orientations.

## Final validation

The isolated and integrated visual matrix is complete. Focused regressions,
typecheck, dependency boundaries, theme lifecycle, TypeScript ratchet,
architecture fitness, structural performance/release gates and scoped sculpture/
playground lint pass. The lint ceiling was lowered to 1,103. Architecture fitness
locks the reduced repository baselines at 290 ShaderMaterial hits across 41 files
and 46 raw resize listeners. Dependency boundaries pass for 1,064 modules and
3,382 dependencies. The final
integrated-main production build passed in 21.83 seconds and its boot closure
passed. The final integrated-main full suite passed all 542 files and 5,917
tests in 115.41 seconds; the focused validation set passed 136 tests.

Physical-device performance has not been measured, and no FPS improvement is
claimed by these screenshots.
