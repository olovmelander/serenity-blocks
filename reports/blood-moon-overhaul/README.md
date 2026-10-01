# Blood Moon visual overhaul — 2026-10-01

Current direction: natural lunar geology in deep blood red, organic dark maria and fine craters, broad wine-colored eclipse shadows and a soft idle halo. Red stars, visible piece-lock feedback, dense combo coronas and full-screen showers remain. The mystical lunar surface refinement below supersedes the harsh procedural crater treatment. Earlier captures remain as iteration history.

Under [ADR-0008](../../docs/adr/0008-hybrid-renderer-and-webgl-holdouts.md), Blood Moon's classic `WebGLRenderer`/GLSL/`EffectComposer` runtime path is retired. Its replacement shares the playground's TSL scene with production and uses `WebGPURenderer` on both native WebGPU and its WebGL2 compatibility backend. Material selection follows renderer kind, as required by [ADR-0019](../../docs/adr/0019-gate-on-renderer-kind-not-backend.md). This is a Blood Moon retirement, not a change to the repository's hybrid-renderer policy. The existing `three@0.186.1` dependency pin is unchanged.

The screenshot workflow follows [ADR-0007](../../docs/adr/0007-webgpu-tsl-definition-of-done.md): one isolated effect, then production integration. The browser MCP profile was occupied by another session, so screenshots and console checks used the single-effect Electron capture harness. The playground is intentionally served from the development server; production game captures use the built application. No full-journey GPU capture was run. Earlier low-tier, portrait and WebGL2 experiments are retained in this directory. Hidden-window playground profiles and captures sampled at one frame per second are excluded from all performance conclusions below.

## Wolfhour lock wave and floating combo embers

Piece locks now use the current native Wolfhour sky's diffuse, broken lunar wave, adapted to blood red inside Blood Moon's existing corona draw. Each 1.25-second lock also illuminates the lunar surface. Four preallocated envelopes allow successive locks to finish independently; same-update lock/clear/combo chains merge into one stronger pulse. Saturation replaces the pulse nearest expiry, and reduced motion clears the waves immediately. The idle shader skips the wave's additional nebula texture sample.

Combo particles retain their bright launch, then decelerate into gently orbiting embers and individual lateral eddies. Lifetime increases from 5.2 to 6.8 seconds with a gradual tail; settled sprites shrink 16% to limit overdraw. The same three pooled burst draws, instance budgets and GPU animation remain, with no per-particle CPU update.

Visual evidence: [crimson lock wave](wolf-lock-red/capture.png), [Low / portrait / WebGL2 lock](wolf-lock-low-webgl/capture.png), [combo launch at 0.32 seconds](floating-age-0.32/capture.png), [floating embers at 2.5 seconds](floating-combo/capture.png), and [fading tail at 5.5 seconds](floating-age-5.5/capture.png). All five captures have zero shader/TSL/WebGPU errors. [62 focused tests](wolf-lock-tests-rerun.log), scoped lint and [typecheck](wolf-lock-typecheck.log) pass. The first parallel test run exceeded the existing five-second deterministic surface-bake timeout while captures and lint were running; the complete focused rerun passed without source changes.

The [production build](wolf-lock-build.log) and [paired production capture](wolf-lock-paired-repeat/blood-moon.json) pass, with zero console, lifecycle or process failures. The [built-game stress image](wolf-lock-paired-repeat/burst-paired-stress.png) confirms the final surface and three overlapping bursts alongside the actual board. The initial production attempt could not establish three advancing burst slots before its timeout and is excluded; the repeat passed without application changes. The report-local harness now includes state in that timeout message for diagnosis.

| Same-session window | Submitted render windows/s | Wall p50 / p95 | CPU p50 / p95 | GPU p50 / p95 | Draw calls |
| --- | --- | --- | --- | --- | --- |
| Idle A | 120.23 | 7.7 / 15.2 ms | 0.4 / 0.6 ms | 0.066 / 0.197 ms | 6 |
| Three bursts | 112.45 | 7.8 / 16.0 ms | 0.5 / 0.8 ms | 0.131 / 0.262 ms | 10 |
| Idle B | 102.86 | 8.0 / 16.1 ms | 0.5 / 0.7 ms | 0.131 / 0.197 ms | 6 |

The stress rate and median cadence fall between the two idle windows. GPU median under stress remains 0.131 ms, matching the previous revision, and draw counts remain 6 / 10 / 6. Runtime, scene phase, fresh-query sampling and 0 / 3 / 0 slot occupancy checks pass. The sizable idle drift on the shared desktop prevents an exact before/after FPS claim.

## Mystical lunar surface refinement

The previous procedural surface made the moon's dark basins and crater rims too artificial. The current surface reuses the repository's existing `public/textures/2k_moon.jpg`, preserving its natural tonal detail and baking a matching gentle normal map at the selected quality tier. Decode and CPU texture data are cached; each scene retains ownership of its two GPU textures. Preparation waits for both lunar and nebula assets, with a softened procedural fallback if the lunar image cannot load. Disposal is safe during an outstanding image load.

The material grades this lunar detail from deep crimson highlands into wine-black shadows. Broad spherical lighting gives the moon its shape, with restrained surface relief and a gradual eclipse terminator. The idle rim and halo are softer; lock and combo flares retain their stronger coefficients. Camera movement, board-safe lunar travel, red stars and the three reusable full-screen burst slots are unchanged. The moon still uses two texture samples, with six idle scene draws and ten at full event overlap.

Verified captures: [idle moon and board composition](mystic-moon-authored/capture.png), [three-combo response](mystic-moon-combo/capture.png), and [Low / portrait / WebGL2 piece lock](mystic-moon-low-webgl/capture.png). Each confirms the authored surface loaded and records zero shader/TSL/WebGPU errors. [56 focused tests](mystic-moon-tests.log), scoped lint, typecheck and the [production build](mystic-moon-build.log) pass. Added tests exercise the shared image bake, row orientation, gentle normals, image failure fallback and disposal before image readiness.

The [built-game stress capture](mystic-moon-paired/burst-paired-stress.png) verifies the final surface alongside the actual board and three simultaneous bursts. The [paired production measurement](mystic-moon-paired/blood-moon.json) is admissible: one runtime and scene phase, High quality, native WebGPU, seed 431, DPR 1 and verified 0 / 3 / 0 slot occupancy. Console, lifecycle and process failure counts are zero.

| Same-session window | Submitted render windows/s | Wall p50 / p95 | CPU p50 / p95 | GPU p50 / p95 | Draw calls |
| --- | --- | --- | --- | --- | --- |
| Idle A | 130.10 | 7.6 / 8.3 ms | 0.3 / 0.5 ms | 0.066 / 0.197 ms | 6 |
| Three bursts | 127.36 | 7.6 / 8.4 ms | 0.4 / 0.6 ms | 0.131 / 0.197 ms | 10 |
| Idle B | 130.32 | 7.6 / 8.3 ms | 0.3 / 0.4 ms | 0.066 / 0.131 ms | 6 |

The stress window retains the idle median cadence, with approximately 2.2% fewer submitted render windows and 0.1 ms additional median CPU submission. GPU median rises by one 0.065536 ms timestamp quantum, with fresh-query sampling verified. Compared with the preceding revision's measurements below, this run shows no observed regression on the tested RTX 3070 Laptop GPU; separate-run desktop variability prevents a precise speedup claim. The harness reports PASS; PowerShell emits a nonzero wrapper exit because Electron's console-message deprecation warning is written to redirected native stderr.

## Earlier reference-driven blood-red revision

The user's side-by-side comparison called for the old theme's stronger reactions and red/black surface contrast. This earlier atlas included near-black crater floors and interlocking maria, sharper raised rims and a denser medium-crater hierarchy. Its grayscale range expanded from approximately 48–200 to 4–240. That surface and material treatment are superseded by the natural lunar refinement above; the event and red-space improvements remain.

The sky's blue grading is replaced by crimson and wine red. 86% of stars use saturated red, 11% rose and 3% pale rose; the foreground ember field is larger and brighter. A piece lock produces a visible lunar pulse, corona flare, star flash and short camera impact, without allocating particles or adding a draw. Combos now emit a dense expanding corona shell, fast outward embers and delayed screen-wide glitter. At High, each of the three reusable slots contains 1,000 bounded sprites (50% shell, 30% fast, 20% glitter). The same slot lifetime, reduced-motion behavior, board safety and full-scene movement remain.

Verified captures: [idle surface and red space](crimson-reference-idle/capture.png), [piece lock at 0.06 seconds](crimson-reference-lock/capture.png), [three-combo response at 0.32 seconds](crimson-reference-combo/capture.png), and [Low / portrait / WebGL2 combo](crimson-reference-low/capture.png). All four console records have zero shader/TSL/WebGPU errors. The [53 focused tests](crimson-reference-tests.log), typecheck and scoped lint pass; the [build log](crimson-reference-build.log) records production validation.

The final [paired production measurement](crimson-reference-paired/blood-moon.json) keeps one scene, renderer, seed, quality, dimensions and scene phase through three consecutive eight-second windows. Burst occupancy is verified as 0 / 3 / 0 throughout the windows. The [production stress screenshot](crimson-reference-paired/burst-paired-stress.png) shows the final red palette with 3,000 active burst instances and the real board.

| Same-session window | Submitted render windows/s | Wall p50 / p95 | CPU p50 / p95 | GPU p50 / p95 | Draw calls |
| --- | --- | --- | --- | --- | --- |
| Idle A | 129.11 | 7.7 / 8.4 ms | 0.4 / 0.6 ms | 0.066 / 0.131 ms | 6 |
| Three bursts | 125.95 | 7.7 / 8.5 ms | 0.4 / 0.7 ms | 0.131 / 0.197 ms | 10 |
| Idle B | 121.31 | 7.7 / 15.1 ms | 0.4 / 0.6 ms | 0.066 / 0.131 ms | 6 |

The stress throughput falls between the two idle measurements, with identical median frame cadence and CPU submission. The added GPU median is one 0.065536 ms timestamp quantum. This supports comparable throughput with the stronger effects on the tested RTX 3070 Laptop GPU, not a universal FPS guarantee or a matched legacy-event speedup. Fresh-query sampling, phase and runtime identity checks all pass, with zero console or process failures. Reproduce with `--perf --perf-uncapped --burst-paired` on the report-local harness; do not combine `--burst-paired` with `--burst-stress`.

## Earlier motion and full-screen burst revision

The subsequent motion revision replaces the fixed star/dust positions with perspective layers that respond to an actual moving camera. Lunar longitude rotates, the disk travels and gently changes apparent size inside a resize-computed safety envelope, and the two nebula samples drift at different depths. Pointer movement adds damped parallax. The saturated crimson lunar grade is preserved; reduced motion freezes travel and rotation and suppresses particle launches.

Two-line clears and combos of two or more now launch full-screen crimson showers. Three preallocated slots preserve overlapping events. Each shower combines fast curved ejecta with delayed screen-wide glitter, retains its launch origin while the moon moves, and expires after 5.2 seconds. High quality uses 500 instances per slot, with smaller tier budgets. Dormant meshes do not draw, and all three materials compile before gameplay.

Visual evidence: [0 seconds](motion-phases/time-0.png), [8 seconds](motion-phases/time-8.png), [16 seconds](motion-phases/time-16.png), [single burst](motion-burst/capture.png), [three overlapping bursts in the built game](motion-stress/burst-stress.png), and [Low / portrait / WebGL2](motion-low-webgl/capture.png). The phase captures use independent fixed-time navigations because hidden Electron windows can retain the preceding compositor frame after an in-place seek. Their console records contain no shader or WebGPU validation errors. Hidden-window timing samples are excluded from performance comparisons.

[52 focused tests](motion-tests.log) pass, including board-safe travel over 180 seconds and pointer extremes, three-slot saturation, cue coalescing, frozen origins, deterministic seeking and shared-resource disposal. Scoped lint, typecheck and the [production build](motion-build.log) pass. An initial surface-test run timed out while the production build was running; its isolated rerun and the final full focused run both pass.

The [updated native idle run](motion-production/blood-moon.json) measures 7.7 ms wall p50, 0.4 ms CPU submission p50, 0.066 ms GPU p50 and six draw calls. Uncapped submission is 122.67 windows/s, within the repeated legacy range of 122.49–128.74. Wall p95 is 14.6 ms on this shared desktop, so this does not establish an exact FPS gain.

The [sustained burst run](motion-stress/blood-moon.json) verifies exactly three active slots throughout both measured visits: ten draw calls, 1,500 burst instances, 0.5 ms CPU submission p50 and 0.131 ms GPU p50 (0.197 ms p95). Its 107.67 submitted windows/s includes two main-thread long tasks and variable desktop scheduling. There is no matched legacy burst-stress baseline; these GPU readings establish absolute cost rather than an event-performance speedup. Add `--burst-stress` to the report-local production command below to reproduce; this optional driver advances event ages while retaining the pinned scene time and seed.

## Initial production result (before motion revision)

Both native runs and the WebGL2 compatibility run pass with zero console or process errors. The native screenshots are byte-identical (SHA-256 `bfa5a2fcc7f4bdfbded6480fc7aa5887e236385060b9b72a5dfc3b390e4cd4bf`). Related validation passed: [36 tests](tests.log) (19 state, 5 surface, 12 wrapper), typecheck, scoped lint and the [final production build](build.log). The final build includes defensive cleanup changes that do not alter the captured scene.

| Native, uncapped | Wall p50 / p95 | CPU submission p50 / p95 | Submitted render windows/s | Median draws / triangles |
| --- | --- | --- | --- | --- |
| [After](after/blood-moon.json) | 7.7 / 8.5 ms | 0.3 / 0.6 ms | 126.33 | 6 / 13,203 |
| [Repeat](after-repeat/blood-moon.json) | 7.6 / 8.4 ms | 0.3 / 0.5 ms | 129.68 | 6 / 13,203 |

The measured scene uses **43 → 6 draw calls**, and median CPU submission falls from **0.5 → 0.3 ms**. Uncapped throughput overlaps the legacy range; median frame cadence remains approximately **7.7 ms**. This supports retained throughput with lower submission cost, not a precise FPS-gain percentage. Native GPU timestamps have p50 **0.066 ms** and p95 **0.131 ms** in both runs, with fresh-query sampling and 0.065536 ms quantization. These are absolute readings; the legacy renderer has no comparable GPU series.

The shorter [WebGL2 acceptance run](after-webgl/blood-moon.json) confirms `WebGPURenderer` with the `webgl2` backend and the actual player setting of 60 FPS. The shared frame pacer submits 69.82 render windows/s on this higher-refresh desktop, down from the uncapped cadence; its tolerance intentionally avoids falling below the requested target. This run verifies compatibility and pacing, and is not used as a throughput differential.

## Legacy baseline

The production build was captured in Electron 38.8.6 / Chromium 140 on the NVIDIA RTX 3070 Laptop GPU. Both runs use High quality, DPR 1, a 1280 × 800 native window and an actual 1264 × 735 content canvas. The scene uses seed 431, fixed time 12 seconds, fixed moon phases and a frozen legacy clock, camera and nebula drift. The clipped moon in the capture is the legacy composition at that fixed phase.

| Capture | Wall p50 / p95 | CPU submission p50 / p95 | Submitted render windows/s | Median draws / triangles |
| --- | --- | --- | --- | --- |
| [Baseline](before-corrected/blood-moon.json) · [image](before-corrected/blood-moon.png) | 7.7 / 8.4 ms | 0.5 / 0.7 ms | 128.74 | 43 / 4,546 |
| [Repeat](before-corrected-repeat/blood-moon.json) · [image](before-corrected-repeat/blood-moon.png) | 7.7 / 14.8 ms | 0.5 / 0.8 ms | 122.49 | 43 / 4,546 |

Both runs pass their same-version content guard and report zero console or process errors. The screenshots are byte-identical (SHA-256 `c3d8740a06d63a4765593877f8a7187fbe4d24172938be4886fd462d60bc7e23`). P95 variability indicates scheduling or machine contention; other work was active in this shared workspace. These results do not establish a precise speedup. GPU milliseconds are unavailable for the classic renderer, so there is no legacy GPU-time differential.

## Measurement limits and reproduction

The [report-local harness](harness/capture-theme-screenshots.mjs) adapts the existing theme capture worker. [Its generator](harness/prepare-instrument.mjs) records source hashes and changes in [instrument-changes.json](harness/instrument-changes.json); [synthetic checks](harness/verify-instrument.mjs) verify classic/node counters, distinguish instrument resets from theme resets, and reject cached timestamp values when no fresh query frame list resolves. Repository-wide capture scripts were not changed.

The original `before/` and `before-repeat/` reports are inadmissible: the original instrument required a node-renderer backend and read `.drawCalls` instead of the classic `.calls`. The corrected reports have matching median counters, although their first counter sample contains accumulated settle work. The current local harness clears that accumulator before subsequent captures. CPU and wall percentile series are unaffected by that counter-only outlier.

The lane's wall series measures its own animation-frame cadence. Submitted render windows are measured separately from CPU submission samples; neither is scanout timing. The old theme ignored the configured 60 FPS cap, whereas the replacement observes the player's cap. Compare uncapped throughput using the existing `noThemeFpsCap` diagnostic flag, and validate normal 60 FPS pacing separately. A lower rate caused by the requested cap is not a rendering regression. `--perf-target-fps 0` is invalid; `--perf-uncapped` is the report-local switch for an uncapped comparison.

After building the intended revision and serving it on port 4175, the uncapped production command is:

```powershell
node scripts/run-electron.mjs reports/blood-moon-overhaul/harness/capture-theme-screenshots.mjs -- --theme blood-moon --base-url http://127.0.0.1:4175 --perf --perf-uncapped --perf-quality High --width 1280 --height 800 --out reports/blood-moon-overhaul/after-uncapped --perf-out reports/blood-moon-overhaul/after-uncapped
```

Repeat into a separate directory. Omit `--perf-uncapped` for normal pacing, add `--force-webgl` for compatibility, and add `--gameplay-shot` to save the paused board/card composition before hiding gameplay UI. Keep dimensions, quality and DPR fixed. New WebGPU GPU timings establish absolute headroom only; comparisons to legacy use repeated CPU submission and uncapped throughput evidence, with the variability above retained.
