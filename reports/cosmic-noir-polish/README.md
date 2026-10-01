# Cosmic Noir: second visual and performance pass

2026-10-01. Builds on the first refinement, retaining the monochrome palette, silver
accretion streams, authored pearl nebula textures, camera motion and event density.

## Changes

- The singularity now has an opaque black center and a soft directional silver rim.
  Removed the old physical material and four-octave procedural surface noise; the
  atmosphere concentrates its veil around the horizon instead of filling the core.
- Atmosphere flow uses two noise samples instead of three. Each nebula uses two
  noise samples plus its authored image, rather than three noise samples plus the
  image. Existing channels supply the finer filaments.
- Additive double-sided materials use one draw per object. Idle draw submissions
  fell from 30 to 25 without reducing stars, dust, texture layers or render resolution.
- Native spark compute and drawing process the activated prefix of the existing
  buffer. Overlapping bursts expand it; wrapping retains the full pool. It resets
  only after every possible delayed birth has expired. Capacity and burst sizes
  remain unchanged. Idle still skips spark dispatch and drawing completely.
- Cached screen-space core positioning and unchanged DPR values avoid redundant
  per-frame work. Inactive event envelopes and duplicate particle uniform updates
  are skipped. Rebuilding sparks clears stale fallback state and telemetry.
- Uses r186's native bloom resolution API with the same 416 x 260 High bloom target.
  When adaptive scaling disables chromatic aberration, a uniform branch skips its
  two extra scene samples.

## Visual evidence

One GPU capture ran at a time. Chrome DevTools MCP was unavailable; report-local
Electron harnesses waited for readiness, captured the real canvas, checked the
console and drained GPU work before shutdown. A dedicated Vite preview with HMR
disabled prevented unrelated workspace edits from replacing measured documents.

| Scenario | Screenshot |
| --- | --- |
| Matched High preview, before / after | [Before](before-verified/capture.png), [after](after-pinned/capture.png) |
| High preview combo | [Combo](preview-combo/capture.png) |
| High preview with chromatic aberration disabled | [Preview](preview-no-chroma/capture.png) |
| Low WebGPU, portrait | [Preview](preview-low/capture.png) |
| High WebGPU, built game with native compute | [Idle](after-game/idle.png), [lock](after-game/lock.png), [combo](after-game/combo.png), [linger](after-game/combo-linger.png) |
| Low classic WebGL2, built game, portrait | [Idle](webgl-low/idle.png), [combo](webgl-low/combo.png), [linger](webgl-low/combo-linger.png) |

All final captures passed with zero console errors, shader failures or WebGPU
validation errors. Native compilation and both renderer shutdowns passed. Classic
WebGL retains its existing brighter grade without the native post-processing stack.

## Verified workload reductions

High, 1280 x 800, DPR 1, seed 12345. Scene scale 0.92; bloom target 416 x 260.
The idle instrument records complete frames and observes each GPU query once.

| Work | Before | After |
| --- | ---: | ---: |
| Idle draws | 30 | 25 |
| Idle submitted triangles | 12,271 | 9,959 |
| Idle render passes | 14 | 14 |
| Idle star/dust points | 30,280 | 30,280 |
| Spark slots processed/drawn for the captured native combo | 26,000 | 5,764 |
| Total points submitted in that native combo | 59,830 | 39,594 |
| Draws in that native combo | 42 | 32 |

The native combo is combo 3 plus a four-line clear, captured after 0.5 seconds at
phase 12.65. Fewer submitted points exclude unused buffer slots; the actual burst
size is unchanged. Repeated combos can still fill all 26,000 slots. Unit tests cover
wraparound, overlapping bursts, future births, expiry and fallback/native rebuilds.

## Timing observations and limits

These are observations, **not a controlled FPS or GPU-time improvement claim**.
Other user applications and dev servers remained running. Content work intentionally
changed, so the strict ADR-0016 differential comparison is marked unmatched.

| Pinned preview | Frames / fresh GPU queries | CPU p50 / p95 ms | GPU render p50 / p95 ms |
| --- | ---: | ---: | ---: |
| Before | 921 / 30 | 2.70 / 9.30 | 0.262 / 0.393 |
| After | 940 / 31 | 2.30 / 6.00 | 0.393 / 1.573 |
| After repeat, no concurrent test/build task | 1,035 / 34 | 1.10 / 1.70 | 0.393 / 1.573 |

The pinned GPU timings were higher after the change despite fewer submissions;
they do not establish GPU-time parity. CPU timing varied substantially as well.
The built-game observations below use live camera motion and clean idle detection,
so they also must not be treated as phase-matched differential measurements.

| Built game / window | Frames | Frame p50 / p95 ms | CPU p50 / p95 ms | GPU render p50 / p95 ms |
| --- | ---: | ---: | ---: | ---: |
| Before / idle | 278 | 18.8 / 42.2 | 2.4 / 11.6 | 0.262 / 0.328 |
| Before / repeated combos | 254 | 19.8 / 48.1 | 2.8 / 16.3 | 0.262 / 0.328 |
| After / idle | 397 | 15.3 / 16.5 | 1.0 / 1.6 | 0.262 / 0.328 |
| After / repeated combos | 395 | 15.2 / 16.3 | 1.1 / 1.3 | 0.262 / 0.459 |

Raw results are in the corresponding `result.json` files. `before/` was interrupted
by a shared-dev-server reload and is excluded. The first manual idle screenshot's
renderer counters contain only the final post pass; use the full-frame idle profile
for workload counts. Screenshot stepping is never used as FPS evidence.

## Checks and reproduction

- Seven focused test files: **48 passing tests** (`tests.log`).
- `npm run typecheck`: passed (`typecheck.log`).
- `npm run build`: passed, including boot closure (`build.log`).
- Scoped ESLint: zero errors, four existing long-line warnings (`lint.log`).
- Scoped `git diff --check`: passed.

Run `npm run dev:playground`, then open
`/playground.html?effect=cosmic-noir&t=12&quality=High&seed=12345`.
Add `&event=combo&combo=3&eventAge=.5`, `&event=lock&eventAge=.2`,
`&noChroma=1`, or `&board=1` as needed. Omit `t` for live motion.

`capture-profile.mjs` measures a pinned preview; `capture-game.mjs` validates the
built game's actual native compute or classic WebGL renderer. Both run through
`node scripts/run-electron.mjs`. `baseline-source/` contains provenance snapshots,
not an independent runnable application.
