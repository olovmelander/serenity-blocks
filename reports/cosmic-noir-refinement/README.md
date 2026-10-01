# Cosmic Noir visual refinement

2026-10-01. Preserves the black singularity, silver accretion disk, pearl nebula textures,
cool stars and monochrome pieces. Changes are confined to Cosmic Noir and its preview.

## Visual changes

- Bounded core framing keeps the full sphere beside the desktop board. Portrait uses a
  smaller core in the upper left. Camera breathing, orbit and background parallax remain.
- The silver disk has finer streams, an asymmetric illuminated side and darker gaps.
  Piece locks no longer change its orbital phase. Its idle pulse no longer washes out
  the surface; stronger combos still briefly flare.
- Nebulas keep their authored offsets instead of collapsing toward one center. Their
  drifting filaments retain more contrast and less additive fog.
- Piece locks send a restrained silver ripple around the core. Waves share a finite
  geometry pool, with at most two lock ripples and sixteen total active waves.
- Gas bursts retain their outward impulse, then slow and curl through space. Particle
  budgets and lifetimes are unchanged. Classic WebGL sprites now respect the core's
  scale and have bounded soft footprints, preventing a solid white combo patch.
- Fixed the native combo flash losing its physical sprite size during decay. Response
  envelopes and pointer damping now behave consistently across refresh rates.
- Migrated this theme from deprecated Three.js Clock to r186 Timer.

## Screenshots and checks

Validated one scene at a time, with the report-local Electron harness because the
Chrome DevTools MCP was unavailable. No journey or simultaneous GPU capture was run.

| Capture | Evidence |
| --- | --- |
| High WebGPU, actual game | [Idle](after/idle.png), [lock](after/lock.png), [combo](after/combo.png), [lingering particles](after/combo-linger.png) |
| High WebGPU, isolated | [Idle](final-preview/capture.png), [combo](preview-combo/capture.png), [strong combo](preview-strong/capture.png), [linger](preview-linger/capture.png) |
| Low WebGPU, portrait, phase 24 | [Preview](preview-low-final/capture.png) |
| Low classic WebGL2, portrait, actual game | [Idle](webgl-verified/idle.png), [combo](webgl-verified/combo.png), [linger](webgl-verified/combo-linger.png) |

Final capture reports have zero console errors or shader validation failures. Native
desktop evidence predates only the subsequent portrait-placement and classic-GLSL
particle fixes; neither changes native desktop rendering.

- Five focused test files: **40 passing tests** (`tests.log`). Includes frame-rate
  independence, exact projected sphere bounds over six aspect ratios, lock alignment,
  wave reuse/limits, startup prewarming and pending combo consumption.
- `npm run typecheck`: passed (`typecheck.log`).
- `npm run build`: passed, including boot closure (`build.log`).
- Scoped ESLint: no errors; four existing long-line warnings in nebula configuration
  (`lint.log`).

## Performance observations and limits

Actual-game live RAF samples use High, 1280x800, DPR 1, scene scale 0.92, seed 12345,
adaptive scaling disabled, no MSAA, and a 60 FPS target. Event-free idle is confirmed
before sampling. GPU timestamps are sampled once per fresh query.

| Run/window | Frames | Frame p50 / p95 ms | CPU update + submit p50 / p95 ms | GPU render p50 / p95 ms |
| --- | ---: | ---: | ---: | ---: |
| Before repeat / idle | 403 | 15.2 / 16.6 | 1.1 / 1.8 | 0.328 / 0.459 |
| Before repeat / combo | 395 | 15.3 / 16.7 | 1.2 / 2.1 | 0.393 / 0.459 |
| After / idle | 455 | 13.5 / 19.3 | 1.7 / 2.4 | 0.197 / 0.328 |
| After / combo | 434 | 15.1 / 17.0 | 1.6 / 2.5 | 0.262 / 0.328 |
| After repeat / idle | 459 | 14.4 / 16.5 | 1.8 / 2.2 | 0.393 / 0.983 |
| After repeat / combo | 396 | 15.2 / 16.4 | 1.9 / 2.3 | 0.393 / 0.524 |

These are live runtime observations, **not a controlled differential benchmark or an
FPS-parity guarantee**. Camera/content phases differ, the machine was not isolated
from the user's other applications, and GPU samples are sparse and quantized. CPU
submission was higher in the after samples. Raw evidence is in
`before-repeat/result.json`, `after/result.json`, and `after-repeat/result.json`.

Idle render work remains 30 draw calls, 14 passes and 30,280 points. No new render
passes, texture layers or particle budgets were added. The disk reuses its two noise
samples; classic nebula now uses one authored-image sample instead of two. Reused
shockwave shapes prevent random geometry allocation during sustained combos.

Early `before/` timing called still-living gas particles idle and is excluded. Early
`composed-idle/` hit a harness shutdown error after capture. `webgl-low/` was a hidden
window/startup-overlay capture and is invalid. `webgl-low-final/` records the white
particle patch and HUD overlap that were corrected in `webgl-verified/`.

## Reproduce

Run `npm run dev:playground`, then open:

`/playground.html?effect=cosmic-noir&t=12&quality=High&seed=12345&board=1`

Add `&event=lock&eventAge=.2`, or `&event=combo&combo=3&eventAge=2.5`.
Omit `t` for live motion. The isolated preview shares the production scene builders,
materials and update code; actual native compute and classic WebGL are checked in
the built game by `capture.mjs`. `capture-playground.mjs` captures one isolated effect.
