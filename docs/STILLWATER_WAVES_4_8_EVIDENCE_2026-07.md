# Stillwater Waves 4–8 implementation and validation evidence

**Date:** 2026-07-25

**Updated:** 2026-07-26

**Status:** Waves 4–8 implemented; current-source immutable v6 validation passes within
the rerun scope, with the broader v5 matrix retained as historical evidence only

**Scope:** Integrated forest/flora, characters, atmosphere/post, gameplay reactions,
quality tiers, production performance, renderer compatibility, and lifecycle validation
for [`STILLWATER_MASTERPIECE_PLAN_2026-07.md`](STILLWATER_MASTERPIECE_PLAN_2026-07.md).

This is the Wave 8 validation ledger, not a declaration that the entire product release
roadmap is complete. The visual, resource, layout, resize, frame-time, lifecycle, and
repository evidence is recorded below. Current-source authority belongs to the immutable
v6 artifacts identified below. The earlier v5 matrix is explicitly historical; its
hardware, backend, live-multiplayer, switch, and device-loss results are not relabeled as
current-v6 evidence.

The linked PNG and JSON files live under the repository's ignored local `artifacts/`
directory. The normalized measurements are repeated here so the durable record does not
depend on those local files remaining present.

The current immutable reports point to
[`immutable-build-final-20260726-1800-v6`](../artifacts/themes/stillwater/wave8/immutable-build-final-20260726-1800-v6/)
and local build-content fingerprint
`267e6556dc09a9f1df8ad92612de20ad945c6798704348da84f83edbe42c1e70`.
That fingerprint identifies selected build and validation inputs. It is not a
cryptographic attestation of the repository or served bytes:
`cryptographicAttestation=false`, `servedBytesVerified=false`, and
`gitContextIncludedInFingerprint=false`. Each report records Git HEAD/dirty metadata for
context, but that metadata is deliberately excluded from the fingerprint.

| v6 identity input | Bytes | SHA-256 |
|---|---:|---|
| Vite manifest | 109,985 | `ba47ea361bfa09bd8f57ab7d60bcc8b021a2a37f9e9fad8d970f0776a412b36a` |
| Stillwater theme chunk | 156,260 | `428f1a114a973c37a66dfa1b095c378d6ffe29aee7377cb29e2f3e150346d932` |
| 12-file Stillwater manifest closure | — | `752e6c0bb628e6462f62046589c659312f4010d0d96dc672577c2649d0949d6a` |
| `troll-lod0.glb` | 489,356 | `ea3ac5782a928375090339258ca4768651456a47bebe1250336e492067683b0c` |
| `troll-lod1.glb` | 224,312 | `8ac0fcbb7b64ff925a382704f970695eae4f262c90fbda936f15c0f653d28a2e` |
| `troll-lod2.glb` | 125,304 | `b5993e88771f2f9b97d65e6c2368d1412ff55f52530fabf9a33c1dec48bf0304` |
| `troll-lod3.glb` | 50,820 | `b829d0680bbfee264c4939c5f441da60fa34c973500bb89ef54b6a3070988ddb` |
| Performance budget | 2,480 | `51716421d7be51c41290a13ea2968d34344ed0f2f40ddd4ca64461b4c425231c` |
| Validation harness | 191,257 | `52132dc1729f8fce4df12c41ac80b673bc2beb110a475e67d969d913098a25b4` |
| Four-file validation logic closure | — | `7121c085ff845db6d4782e1469a55d7b3e990bcd731d7349777f7e23b98917be` |

Asset generation, licensing, and source ownership remain a separate concern documented in
[`src/themes/stillwater/assets/ATTRIBUTION.md`](../src/themes/stillwater/assets/ATTRIBUTION.md).

## Validation contract

- Visual pilots were isolated in the playground and captured one effect/session.
- Production measurements used the built application at `127.0.0.1:4173`, its real
  single-player board, pinned quality, pixel ratio 1, render scale 1, antialiasing off,
  and adaptive quality suppressed.
- The manual validation lane drove only Stillwater's production frame entry point. It did
  not replace or advance unrelated application RAF consumers.
- The gated workload is the isolated manual production-frame CPU submission plus Three's
  renderer GPU timestamp. Configured target frequency, scheduler pacing, and queue-drain
  latency are diagnostics; none is observed display pacing or a display-FPS claim.
- Manual-driver lanes use a target-paced, effect-neutral warmup before both idle and
  reaction sampling. The final lanes configured a 20 s minimum and 90 s ceiling; the
  harness's default ceiling is 60 s. Each lane requires the last three 2 s windows to be
  stationary and the idle/reaction neutral states to be mutually comparable before their
  samples are accepted. The comparison boundary is inclusive with a 1e-6 ms
  floating-point epsilon. A non-stationary or non-comparable pre-state invalidates the
  lane; it does not pass or fail the theme budget.
- The comprehensive harness's duo/quad/Odyssey views are synthetic layout-policy
  overrides. Separate live-local harnesses submit the production multiplayer form and
  verify actual two- and four-game Phaser layouts without a synthetic override; those
  live-local reports are historical v5 evidence until repeated against v6.
- Every accepted v6 production capture uses a strict board/modal gate and a visual
  screenshot check: Stillwater must be active;
  exactly one theme canvas must exist; the real single-player mode and Phaser
  `BoardScene` must be running; Serenity board mode and blocking result/start modals must
  be absent; and the board canvas, container, and stage must be visible with nontrivial
  dimensions and opacity.
- Cold GLTF timing combines load + parse/attach; GPU upload is not measured separately.
  `warmRenderComplete` is the return of the CPU warm-render call, and canvas reveal is the
  DOM opacity change, not GPU queue completion, compositor presentation, or scanout.
- A cold LongTask result is finalized only after a supported observer has stopped and at
  least 200 ms of post-reveal observation exists (250 ms in these reports). It detects
  browser LongTasks overlapping reveal or beginning afterward. It does not cover sub-50 ms
  frame hitches, GPU/compositor stalls, or every GC pause.
- Native WebGPU and `WebGPURenderer`'s forced-WebGL2 backend execute the same TSL and
  NodeMaterial graphs. Forced WebGL2 is not Canvas 2D: the production board hardcodes
  `Phaser.WEBGL`, Phaser 4 has no Canvas renderer, and the existing Canvas next/hold
  surfaces do not constitute a board fallback.
- Hidden behavior is two separate contracts. The normal production-style lane mirrors
  `backgroundThrottling=false` and deliberately calls the application's pause/resume
  policy. The separate headed Page Visibility lane uses
  `backgroundThrottling=true`, hides and shows a real `BrowserWindow`, requires
  `document.hidden` transitions, and forbids explicit pause/resume hook injection.
- Stillwater instance cleanup retires runtime-owned scene resources into one reusable
  renderer pool after queue drain and transient-cache cleanup. It does not terminally
  dispose the pooled backend. Full `ThemeManager.cleanup()` owns the registered terminal
  shared-resource disposer, which stops and disposes the renderer and destroys its owned
  WebGPU device.
- Three r181 also owns a private renderer animation callback. Stillwater explicitly
  suspends and restarts `renderer._animation` during lifecycle pause, isolated validation,
  pooling, and resume; stopping only the theme rAF is not treated as zero hidden work.

The current v6 comprehensive lane settled after its 20 s minimum warmup. The earlier
20.028–34.183 s range belongs to the historical v5 six-lane matrix. Warmup windows are
recorded separately and excluded from measured frame samples.

The Chrome DevTools MCP transport returned `Transport closed` during the final sessions.
The Electron validation harness used the Chrome DevTools Protocol directly for readiness,
screenshots, console capture, GPU diagnostics, forced GC, and retained-object queries.
This is a tooling-transport limitation, not a claim that the unavailable MCP call
succeeded.

## Wave 4 — forest and flora

Historical implementation pilots proved the forest and flora separately before
integration:

- [High forest language](../artifacts/themes/stillwater/wave4/forest-art-polish-high-webgpu-final.png)
- [High flora relay](../artifacts/themes/stillwater/wave4/flora-art-polish-high-webgpu-final.png)
- [Low flora relay](../artifacts/themes/stillwater/wave4/flora-art-polish-low-webgpu-final.png)
- [Medium budget-pruning capture](../artifacts/themes/stillwater/wave8/medium-budget-flora-webgpu-v3.png)

The final system uses three hero trees, instanced mid/far depth families, authored canopy
gaps, roots, boulders, reeds, lilies, and clustered mushrooms. High reports five tree
draws, three dressing draws, and three flora draws in the integrated forest component.
The board-safe aperture reports zero focal intrusions, mushrooms use no real point
lights, and the flora relay is driven through fixed material state rather than spawned
scene objects.

The historical Medium pruning capture is ready on WebGPU with one canvas and no
playground error. Its
standalone forest pilot reports 11 direct draws because it owns three terrain/shoreline
draws; the integrated runtime delegates that terrain to the lake. The revised integrated
Medium target is eight forest draws, and the historical v5 production retest confirms the
complete 22-draw structural graph. Current source retains that construction; an accepted
board-safe current-v6 Medium capture is still pending.

## Wave 5 — spirit and troll

Character pilots:

- [Layered watching spirit](../artifacts/themes/stillwater/wave5/spirit-high-webgpu-v3.png)
- [Grounded root troll](../artifacts/themes/stillwater/wave5/troll-high-webgpu-v2.png)

The spirit has a readable ivory core, body, veil/filaments on bloom-capable tiers, a
controlled aura, and authored observe/respond/withdraw states. The troll remains outside
the board aperture and uses peripheral listen/react/retreat beats rather than a full-board
patrol.

The source troll is retained for provenance but is not imported into the production
bundle. The four quantized, animated shipping LODs are:

| Asset | Triangles | Bytes | Tier |
|---|---:|---:|---|
| `troll-lod0.glb` | 32,378 | 489,356 | Ultra / Extreme |
| `troll-lod1.glb` | 17,081 | 224,312 | High |
| `troll-lod2.glb` | 9,765 | 125,304 | Medium |
| `troll-lod3.glb` | 3,690 | 50,820 | Minimal / Low and critical warm load |

The LODs total 889,792 bytes versus the 10,791,108-byte source, a 91.75% reduction.
Generation, ownership, rigging, animation, optimization commands, and retained sources
are recorded in
[`src/themes/stillwater/assets/ATTRIBUTION.md`](../src/themes/stillwater/assets/ATTRIBUTION.md).

## Wave 6 — atmosphere and post

Pilots:

- [Colored height fog and soft motes](../artifacts/themes/stillwater/wave6/atmosphere-high-webgpu-v2.png)
- [Selective ivory post](../artifacts/themes/stillwater/wave6/post-high-webgpu.png)

The integrated High profile uses analytic distance/height fog, one bounded mist layer,
280 ambient motes, MRT emissive isolation, selective bloom at 0.45 source scale, a 16³
teal-shadow/warm-highlight LUT, and one ACES output transform. Non-emissive sky, fog, and
water are rejected from bloom. The exact Minimal→Extreme mote capacities are
40/90/180/280/540/700; each runtime allocates only its active tier capacity. Medium and
lean tiers structurally omit bloom and the LUT; disabled graphs are not left executing
behind zero uniforms. Current-v6 High runtime diagnostics record atmosphere count 280 and
`perFrameAllocations=0`.

## Wave 7 — reactions and pieces

The current v6 comprehensive production lane captures all 11 canonical event inputs:

| Event | Current v6 native-WebGPU capture | Expected route | Troll gesture at capture | Aggregate draws |
|---|---|---:|---|---:|
| Lock | [Rune Dimple](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-production-event-lock.png) | 0 | lock glance | 46 |
| Hard drop | [Stonefall Dimple](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-production-event-hard-drop.png) | 8 | lock glance | 46 |
| Line clear | [Reed Whisper](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-production-event-line-clear.png) | 1 | line turn/pause | 46 |
| Tetris | [The Lake Opens](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-production-event-tetris.png) | 1 | line turn/pause | 47 |
| Combo 4 | [Mycelium relay](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-production-event-combo-4.png) | 1 | line turn/pause | 46 |
| Combo 7 | [Canopy notice](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-production-event-combo-7.png) | 1 | combo wary | 46 |
| Combo 10 | [Forest Remembers](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-production-event-combo-10.png) | 3 | combo delight | 48 |
| T-spin | [Näck's Turn](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-production-event-t-spin.png) | 2 | line turn/pause | 46 |
| Back-to-back | [Echo Across the Mere](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-production-event-back-to-back.png) | 4 | line turn/pause | 48 |
| Perfect clear | [Stillwater Awakening](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-production-event-perfect-clear.png) | 3 | perfect bow/look-up | 48 |
| Level up | [Warmth Across the Mere](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-production-event-level-up.png) | 9 | — | 45 |

All 11/11 report `PASS`, observe exactly one expected route increment, keep every
instrumented fixed-resource identity stable, hold renderer geometries/textures stable
across screenshot capture, and report `perEventResourceCreation=0`. B2B is explicitly
gated on echo route 4 rather than inferred from a shared Tetris silhouette. Hard drop and
level up are production-routed events, not playground-only presets; level 12 reaches a
0.705 enrichment target in its phase-locked capture.

The [historical v5 reduced-motion perfect clear](../artifacts/themes/stillwater/wave8/final-playground/events/perfect-clear-reduced-motion.png)
and [historical v5 forced-WebGL2 perfect clear](../artifacts/themes/stillwater/wave8/final-playground/events/perfect-clear-webgl2.png)
retain the event identity, but are not current-v6 captures.

The historical v5
[native-WebGPU Tetris water capture](../artifacts/themes/stillwater/wave8/final-playground/water-high-tetris-lean-periodic-webgpu-v5.png)
visually verifies the optimized premium response graph after the performance fix. Its
sidecar reports `ready=true`, one canvas, native WebGPU, `lean-four-wake`, ten fixed
response slots (320 bytes), one active reserved special slot, four converging depth wakes,
and zero shader/pipeline failure. The construction-time TSL graph encodes those four
filaments in one periodic signed-distance field instead of repeating four full-lake
branches; the gameplay silhouette and fixed-pool ownership remain intact.

High idles at 45 aggregate renderer draws. Fixed reaction pools add at most three draws,
remaining inside the planned `+4` reaction allowance. After the first warmed visibility
and post allocation, the current v6 event lane uses 31 renderer geometries and 24 textures
at every before/capture/after checkpoint. Its clean idle starts at 28 geometries and
18 textures; the difference is one-time reaction/post/screenshot warmup, not per-event
growth.
`renderer.info.programs` is unavailable on these renderer instances and is never reported
as zero or used to claim shader-program stability.

The rune is structurally tiered. Minimal creates no rune geometry/material/draw and
reports `disabled-minimal`; Low and Medium create `etched-lean`; High, Ultra, and Extreme
create `mycelial-premium`. This is a construction-time omission, not a zero-uniform claim.

The historical v5 production-board captures show the folklore tetromino palette
independently of glow:

- [Native WebGPU Extreme board](../artifacts/themes/stillwater/wave8/final-v5-rtx-extreme-1440p144/stillwater-final-board.png)
- [Forced-WebGL2 Medium board](../artifacts/themes/stillwater/wave8/final-v5-webgl2-medium-1080p60/stillwater-final-board.png)

## Wave 8 — quality and production performance

### Canonical quality captures

- [Current v6 native WebGPU High](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-idle.png):
  45 aggregate idle draws, 85,739 triangles.
- [Historical v5 forced-WebGL2 Medium](../artifacts/themes/stillwater/wave8/final-v5-webgl2-medium-1080p60/stillwater-idle.png):
  22 aggregate idle draws, 37,036 triangles.
- [Historical v5 native WebGPU Minimal](../artifacts/themes/stillwater/wave8/final-v5-amd-minimal-1080p60/stillwater-idle.png):
  15 aggregate idle draws, 17,791 triangles.
- [Historical v5 native WebGPU Extreme](../artifacts/themes/stillwater/wave8/final-v5-rtx-extreme-1440p144/stillwater-idle.png):
  46 aggregate idle draws, 136,339 triangles; the paired performance report passes.

The original plan's static draw target is treated as a direct scene-structure budget.
Reflection and post submissions are recorded separately rather than hidden. High is about
30 direct scene draws but 45 aggregate draws with the reflector and selective post; the
worst current-v6 captured reaction is 48. This is an explicit hero-capability trade, not
a claim that the aggregate High workload is at or below 32.

### Frame-time lanes

“Total” means CPU submission + renderer GPU timestamp for the isolated manual
production-frame workload. All values are milliseconds. Target frequency is
configuration, not observed display FPS.

Current v6 comprehensive lane:

| Artifact / adapter / backend / profile | Resolution / target | Idle total p95 / p99 | Reaction total p95 | Reaction CPU / GPU p95 | Reaction Δ CPU / GPU | Result |
|---|---|---:|---:|---:|---:|---|
| [`v6-comprehensive`](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-wave8-summary.json) / RTX 5080 Laptop / WebGPU / High | 1920×1080 / 60 Hz | 2.031 / 2.262 | 1.997 | 1.800 / 0.328 | −0.100 / +0.066 | `PASS` |

That same current-v6 report passes its 20-second 2 Hz lock lane at 2.062 ms total p95 and
its 30-second mixed-reaction storm at 2.097 ms total p95. It records 1,200 idle, 1,200
reaction, 1,200 lock-stress, and 1,800 storm samples. The idle/reaction neutral warmups
both pass the stationary-and-comparable gate. Isolated queue-drain cadence and latency
remain diagnostics, not observed display FPS.

Three attempted v6 AMD native-WebGPU lanes are diagnostic only and are excluded from the
acceptance table. Although their machine-readable summaries reported `overallPass=true`,
visual review found their reaction/final screenshots blocked by `#game-over-modal`: the
recovery path hid the modal without restarting the still-reported-running mode, then the
asynchronous modal returned after the board gate. Acceptance requires a hardened gate,
a new immutable fingerprint, and clean reruns; the measured diagnostic frame values are
not promoted here.

Historical v5 six-lane hardware/backend matrix:

| Artifact / adapter / backend / profile | Resolution / target | Idle total p95 / p99 | Reaction total p95 | Reaction CPU / GPU p95 | Reaction Δ CPU / GPU | Result |
|---|---|---:|---:|---:|---:|---|
| [`amd-minimal`](../artifacts/themes/stillwater/wave8/final-v5-amd-minimal-1080p60/stillwater-wave8-summary.json) / AMD 610M / WebGPU / Minimal | 1920×1080 / 60 Hz | 4.667 / 4.998 | 4.698 | 0.800 / 4.194 | +0.000 / +0.066 | `PASS` |
| [`amd-medium`](../artifacts/themes/stillwater/wave8/final-v5-amd-medium-1080p60/stillwater-wave8-summary.json) / AMD 610M / WebGPU / Medium | 1920×1080 / 60 Hz | 5.219 / 5.612 | 5.743 | 0.800 / 5.112 | +0.000 / +0.524 | `PASS` |
| [`amd-high`](../artifacts/themes/stillwater/wave8/final-v5-amd-high-1080p60-r2/stillwater-wave8-summary.json) / AMD 610M / WebGPU / High | 1920×1080 / 60 Hz | 9.202 / 9.543 | 9.961 | 2.000 / 8.126 | +0.000 / +0.590 | `PASS` |
| [`webgl2-medium`](../artifacts/themes/stillwater/wave8/final-v5-webgl2-medium-1080p60/stillwater-wave8-summary.json) / AMD 610M / forced WebGL2 / Medium | 1920×1080 / 60 Hz | 5.496 / 5.917 | 5.677 | 1.000 / 4.862 | +0.000 / +0.124 | `PASS` |
| [`rtx-high`](../artifacts/themes/stillwater/wave8/final-v5-rtx-high-1080p120/stillwater-wave8-summary.json) / RTX 5080 Laptop / WebGPU / High | 1920×1080 / 120 Hz | 1.497 / 1.731 | 1.597 | 1.400 / 0.262 | +0.100 / +0.000 | `PASS` |
| [`rtx-extreme`](../artifacts/themes/stillwater/wave8/final-v5-rtx-extreme-1440p144/stillwater-wave8-summary.json) / RTX 5080 Laptop / WebGPU / Extreme | 2560×1440 / 144 Hz | 1.724 / 1.924 | 1.759 | 1.300 / 0.655 | +0.000 / +0.066 | `PASS` |

The 60 Hz absolute gates are total p95 ≤16.6, CPU p95 ≤6, GPU p95 ≤9, and p99
≤20.8. At 120/144 Hz, p99 is diagnostic rather than enforced; the total/split and
incremental gates remain enforced. The warmed reaction allowance is +0.25 ms CPU and
+0.75 ms GPU.

The calibrated Stillwater idle baseline in `perf-budgets.json` is 6.0 ms with a 10%
ceiling of 6.6 ms. It is enforced only for the low-power, native-WebGPU, manual-driver,
Medium, 1920×1080, 60 Hz idle lane. It is not applied to High/Minimal, forced WebGL2,
reaction, or discrete-GPU runs. The historical v5 AMD Medium lane passes it at 5.219 ms
total idle p95; its idle/reaction GPU p95 values are 4.588/5.112 ms and its warmed GPU
delta is +0.524 ms. The other five historical v5 lanes likewise pass every applicable
absolute, split, p99, calibrated, and incremental check recorded in that dossier.

The superseded failed candidates are not used in the historical acceptance table. Those
v5 lanes were run serially from their exact immutable directory and add an explicit
stationary, cross-comparable neutral-prestate gate before measurement. Their accepted warmups
used a configured 20 s minimum/90 s maximum (60 s default maximum in code) and actually
settled in 20.028–34.183 s. Queue-drain latency, scheduler pacing, and the reports'
average-FPS diagnostic are not substituted for the evaluated timestamped workload or
described as observed display FPS. These v5 numbers are historical, not a substitute for
an accepted, board-safe current-v6 AMD/RTX/forced-WebGL2 matrix.

### Layout, resize, pause, and hidden behavior

The [current v6 comprehensive report](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-wave8-summary.json)
boots a real single-player board and passes synthetic solo, duo, quad, and Odyssey
layout-policy captures plus 1080p, 1440p, and capped-4K resize transitions. These policy
overrides do not instantiate multiple Phaser games and are not described as live
multiplayer evidence.

Every current-v6 layout and resize checkpoint also passes the strict production-board
gate: Stillwater active, exactly one theme canvas, real single-player mode running,
`BoardScene` active, Serenity board mode off, no blocking modal, a board canvas at least
200×400 CSS pixels, and visible/nonzero-opacity board container and stage.

The historical v5 live-local harness instead submitted `#local-match-config-form`,
started the real `local-multiplayer` mode, and used no synthetic override:

- [Historical v5 two-player report](../artifacts/themes/stillwater/wave8/final-v5-live-local-2p/stillwater-live-local-2p.json)
  and [capture](../artifacts/themes/stillwater/wave8/final-v5-live-local-2p/stillwater-live-local-2p.png):
  `duo`, two Phaser games, two board scenes, one Stillwater canvas, and all assertions
  passing.
- [Historical v5 four-player report](../artifacts/themes/stillwater/wave8/final-v5-live-local-4p/stillwater-live-local-4p.json)
  and [capture](../artifacts/themes/stillwater/wave8/final-v5-live-local-4p/stillwater-live-local-4p.png):
  `quad`, four Phaser games, four board scenes, one Stillwater canvas, and all assertions
  passing.

The current v6 lifecycle evidence deliberately separates two different hidden contracts:

| Lane | Window policy | Pause mechanism | Hidden observation | Result |
|---|---|---|---|---|
| [Comprehensive explicit app pause](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-wave8-summary.json) | Headless, `backgroundThrottling=false` | Explicit application pause/resume hooks required | 20 s; document remains visible by design; update/render deltas 0 | `PASS` |
| [Genuine Page Visibility](../artifacts/themes/stillwater/wave8/v6-page-visibility-direct-smoke2/stillwater-wave8-summary.json) | Headed, `backgroundThrottling=true`; native visible→hidden→visible `BrowserWindow` | Explicit hooks forbidden and both recorded false | 1 s; `document.hidden` and paused state false→true→false; update/render deltas 0; one canvas after resume | `PASS` |

The comprehensive lane also passes all 20 pause/resume cycles. Each pause owns both the
theme rAF and Three r181's private `renderer._animation` callback; each resume restarts
only the callbacks it suspended. The earlier
`v6-page-visibility-headed` wrapper failure is a historical launcher diagnostic—the
wrapper never surfaced the window—and is not the accepted Page Visibility result.

## Lifecycle acceptance evidence

### Current-source ownership contract

Normal instance stop/eviction disposes the Stillwater runtime, scene-owned geometries,
materials, post graph, listeners, gameplay routes, and diagnostics. A healthy compatible
renderer is then detached and stored in a single reusable pool only after timestamp
resolution/queue drain and retirement of transient render lists, render contexts, bundles,
node-frame strong references, and the shared output-quad closure. Calling public
`renderer.dispose()` at this point would be terminal and would defeat pool reuse.

`ThemeManager` separately registers `StillwaterTheme.disposeSharedResources()` and calls
it only from full manager/application `cleanup()`. That terminal path stops
`renderer._animation`, clears the animation loop, calls renderer disposal, detaches the
canvas, and destroys an owned WebGPU device. Backend mismatch, device/context loss, drain
failure, or pool replacement also takes the terminal path rather than reusing an unhealthy
renderer.

Three r181's private `renderer._animation` callback is part of this ownership contract.
Stillwater stops it for lifecycle pause, isolated validation, and pooling, records whether
it owned that suspension, and restarts it only on the matching resume/claim. The current
v6 20-cycle pause soak and genuine Page Visibility pass both observe zero hidden update
and render delta and a live renderer animation request after resume.

### Theme-switch retention

The historical v5 native-WebGPU thirty-switch run is overall `PASS`; it has not been
repeated against the current v6 fingerprint:

- [Historical v5 summary](../artifacts/themes/stillwater/wave8/final-v5-webgpu-high-switch30/stillwater-wave8-summary.json)
- [Historical v5 final switched surface](../artifacts/themes/stillwater/wave8/final-v5-webgpu-high-switch30/stillwater-switch-final.png)

After settle and forced GC, that historical scoped CDP census was exact-stable:

| Retained object | Before | After |
|---|---:|---:|
| `StillwaterTheme` | 1 | 1 |
| `WebGPURenderer` | 1 | 1 |
| Node frame | 1 | 1 |
| Scene | 3 | 3 |
| Post graph | 1 | 1 |
| Mesh | 48 | 48 |
| Node material | 53 | 53 |
| `GPUDevice` | 1 | 1 |
| Native `GPUTexture` | 19 | 19 |
| Render target | 21 | 21 |
| Render-target texture | 49 | 49 |
| Depth texture | 7 | 7 |

The shared output-quad dispose-listener count changed from 7 to 6 rather than growing.
Scene objects, scene geometries, scene materials, canvases, and the selected retained
populations above had zero spread.

Three r181's pooled-renderer `renderer.info.memory.textures` counter is stale bookkeeping:
it has a spread of 58 even though the native `GPUTexture`, render-target,
render-target-texture, and depth-texture populations are unchanged. It is therefore
retained as a diagnostic only. Forced-GC JS heap bytes are also diagnostic because they
include DevTools and application noise.

This historical gate is intentionally scoped. It supports “no growth in these queried
CDP/native populations over this v5 thirty-switch protocol”; it is not a universal proof
that every JS wrapper, browser-internal resource, driver allocation, or unqueried object
type is leak-free. `renderer.info.programs` is unavailable and supplies no lifecycle
claim.

### Forced-WebGL2 switch parity

The dated 2026-07-25 evidence included a separate forced-WebGL2 switch-parity drill. That
drill was not repeated under either the historical v5 dossier fingerprint or the current
v6 fingerprint, so it remains an older historical diagnostic. The
[historical v5 forced-WebGL2 Medium lane](../artifacts/themes/stillwater/wave8/final-v5-webgl2-medium-1080p60/stillwater-wave8-summary.json)
is performance evidence only, not a switch-retention drill.

Forced WebGL2 is `WebGPURenderer` selecting its WebGL2 backend for the same TSL
NodeMaterial graph. It does not supply a Phaser Canvas board. The production board
hardcodes `Phaser.WEBGL`, Phaser 4 has no Canvas renderer, and a genuine Canvas 2D board
fallback remains unsupported and outside validation-only scope.

### Device-loss recovery

The historical v5 native-WebGPU drill deliberately destroyed the device and is overall
`PASS`. It recovered once to the forced-WebGL2 backend in 3,663 ms, restored debug
readiness, and retained exactly one theme canvas. It has not been rerun under v6:

- [Historical v5 recovery summary JSON](../artifacts/themes/stillwater/wave8/final-v5-device-loss/stillwater-wave8-summary.json)
- [Historical v5 recovered surface](../artifacts/themes/stillwater/wave8/final-v5-device-loss/stillwater-device-loss-recovered.png)

The console classifier recorded exactly one expected deliberate-loss message, zero
unexpected errors, zero renderer-process failures, and zero shader/pipeline failures.

## Repository verification records

| Gate | Result | Recorded detail |
|---|---|---|
| Current-source focused Stillwater Vitest | **Pass**, 2026-07-26 | 18 files, 183 tests |
| Current-source affected-test selection | **Pass**, 2026-07-26 | 236 / 236 tests |
| Current-source lifecycle / terminal-ownership selection | **Pass**, 2026-07-26 | 45 / 45 tests |
| Current v6 comprehensive production validation | **Pass**, 2026-07-26 | All 22 enabled checks pass; 11/11 production events; strict board/modal gate; zero console/shader/process failures |
| Current v6 genuine Page Visibility | **Pass**, 2026-07-26 | Native visible→hidden→visible cycle; no explicit hooks; zero hidden update/render delta |
| Historical full `npm test` | One unrelated failure, 2026-07-26 | Koi Pond `Extreme` DPR expected `1.5` while implementation returned `1.4`; 2,747 / 2,748 tests and 711 / 713 suite units passed before the final current-source fixes |
| Current-source `npm run typecheck` | **Pass**, 2026-07-26 | `tsc --noEmit` completed cleanly |
| Current-source `npm run lint:ci` | **Pass**, 2026-07-26 | 1,429 errors against the governed 1,443 ceiling; 985 warnings; zero fatal errors |
| Current raw lint inventory | Baseline disclosed | The existing 1,429 errors and 985 warnings are not presented as a clean raw-lint run |
| Current-source `npm run check:boundaries` | **Pass**, 2026-07-26 | 815 modules, 2,469 dependencies; no violations |
| Current-source `npm run audit:theme-lifecycle` | **Pass**, 2026-07-26 | No diagnostics |
| Historical production build | Pass, 2026-07-26 | 915 modules; existing circular-chunk warning remained |
| Historical `git diff --check` | Pass, 2026-07-26 | No whitespace errors |
| Current v6 custom-outDir artifact hygiene | Pending recheck | Do not claim `playground-refs` absence until the rebuilt v6 directory reproduces the manifest/closure identity |

The current working-tree lint ratchet, boundaries, lifecycle audit, and typecheck records
are green. The raw lint inventory remains governed technical debt; passing `lint:ci`
means the ratchet did not regress, not that the existing errors disappeared. These are
dated source-command records, not same-fingerprint v6 artifact attestations.

The one historical full-suite failure is outside Stillwater and does not reproduce in the
current 18-file / 183-test Stillwater suite, 236-test affected selection, or 45-test
lifecycle/terminal-ownership selection. It remains a dated repository-level Koi Pond
test/implementation mismatch and is not presented as green or as a current full-suite
result.

This table is a dated command record, with scope stated per row. The v6 local
build-content fingerprint does not include Git context, does not verify served bytes, and
does not attest that the source-test or repository commands ran against the immutable
build. Those command results are therefore not promoted into same-fingerprint evidence.

Separately, the v6 directory and its identity hashes are recorded above. A custom-outDir
hygiene fix landed after the first v6 build; absence of `playground-refs` is intentionally
left pending until the same v6 path is rebuilt and its manifest/closure hashes are
rechecked. No result is inferred here.

## Current acceptance status

| Gate family | Status | Remaining evidence |
|---|---|---|
| Waves 4–7 visual and event exits | **Pass, current v6** | None within the current comprehensive scope |
| Native WebGPU TSL graph | **Pass, current v6** | Current High comprehensive capture and clean console |
| Forced-WebGL2 TSL graph | Historical v5 | Accepted current-v6 forced-WebGL2 capture/performance rerun not recorded |
| Current frame-time acceptance | **Pass, scoped** | Board-safe RTX 5080 High/WebGPU 1920×1080/60 Hz comprehensive lane |
| Broader hardware/backend matrix | Historical v5 / current diagnostics rejected | Harden board recovery, re-fingerprint, and rerun AMD; rerun forced-WebGL2 and RTX high-refresh/Extreme for current authority |
| Medium 22-draw structural target | Current source; capture historical v5 | Current-v6 Medium production capture remains part of the pending board-safe hardware rerun |
| Live local two-/four-player layouts | Historical v5 | Current-v6 real two-/four-game production reruns not recorded |
| Synthetic layout policy / resize matrix | **Pass, current v6** | Strict single-player board gate passes at every checkpoint |
| Explicit app pause / resume soak | **Pass, current v6** | 20 cycles and 20-second paused interval; zero update/render delta |
| Genuine Page Visibility | **Pass, current v6** | Native headed visible→hidden→visible cycle; no explicit hooks; zero update/render delta |
| Asset size / source attribution | Pass, separate source record | `ATTRIBUTION.md`; not inferred from the build fingerprint |
| Native-WebGPU thirty-switch retention | Historical v5 | Current-v6 retention census not recorded |
| Forced-WebGL2 switch parity | Historical | No current-v6 switch-parity artifact; a performance lane is not a substitute |
| Deliberate device-loss recovery and console classification | Historical v5 | Current-v6 recovery drill not recorded |
| Cold activation / LongTask window | **Pass, current v6, scoped** | Browser LongTask observer through 250 ms post-reveal; not GPU-present or universal hitch coverage |
| Repository verification | Dated working-tree/source record; one unrelated historical Koi failure | Current 183/183 Stillwater, 236/236 affected, and 45/45 lifecycle/terminal-ownership selections pass; commands are not attested by v6 build-content identity |
| Wave 8 implementation | **Complete** | None |
| Wave 8 acceptance | **Pass within the documented current-v6 rerun scope** | Unrerun/rejected matrix cells remain explicitly historical or pending, never promoted |

Wave 8 implementation is complete, and acceptance passes within the board-safe
current-v6 scope recorded above. That conclusion does not turn rejected diagnostics or
historical v5 cells into current evidence. It also remains bounded by the measurement
contract: configured target frequency and isolated queue-drain cadence are not observed
display FPS, and v6 content identity is not repository attestation or served-byte proof.
