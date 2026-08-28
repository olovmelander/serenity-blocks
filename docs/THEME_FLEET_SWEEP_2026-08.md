# Theme fleet sweep — 61 themes: census, measured sweep, and per-theme fixes

Status: **Stages 0–3 complete. Stage 1 (static census) 2026-08-23 = Part A. Stage 2 (the measured
GPU sweep, all 61) 2026-08-24, re-measured on the corrected instrument 2026-08-25 (§20) = Part B.
Stage 4 (fixes, one theme at a time) IN PROGRESS = Part C: seven landed (§13–§17, §22), two
reverted and recorded (§16).**
Owner: rendering. Fills in [R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md](R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md)
Phase 3 (theme switch), Phase 4 (frame time) and Phase 5 (look better) with per-theme evidence.
This is **not** a parallel roadmap: every item here is numbered against that plan's rows.
Governing ADRs: [0007](adr/0007-webgpu-tsl-definition-of-done.md), [0008](adr/0008-hybrid-renderer-and-webgl-holdouts.md),
[0016](adr/0016-perf-claims-require-a-verified-instrument.md), [0018](adr/0018-three-js-pinning-and-upgrade-protocol.md),
[0019](adr/0019-gate-on-renderer-kind-not-backend.md).
Method model: [COSMIC_NOIR_PERF_AUDIT_2026-06-30.md](COSMIC_NOIR_PERF_AUDIT_2026-06-30.md).

## 0. What this document is, and what its numbers are worth

The Odyssey hunt found one shader — the Earth Core lava lake — that took 7,235 ms in a single
pipeline. This is the same hunt across all 61 themes in `src/themes/theme-registry.js`.

Two evidence streams, both zero-GPU:

1. **Derived measurement.** The 2026-08-21 `capture:themes` run
   (`scripts/validate-all-themes.mjs`) already committed, per theme, a timestamped console log and
   a `lifecycle.timings` block. Nobody had read the logs *as a timeline*. New tool:
   [`scripts/theme-switch-log-mine.mjs`](../scripts/theme-switch-log-mine.mjs), cell at
   [`reports/theme-perf/switch-log-mine-2026-08-21.json`](../reports/theme-perf/switch-log-mine-2026-08-21.json).
2. **Static census.** A 44-agent fan-out over every theme directory (plus the six playground
   effects that ship as production scenes), with an adversarial verification pass that tried to
   refute every "heavy" or "lava-lake" claim. 21 claims were challenged; **13 were demoted.**

**ADR-0016 admissibility.** The measured numbers are `n = 1`, from a single committed run, on
Electron 38 with the **Vega 8 iGPU** — the theme harness passes no `force_high_performance_gpu`, so
the entire 61-theme matrix is a **Lane B** measurement (plan item 4.0). They are good enough to
**rank**. They are not good enough to **budget**, and nothing here is written into a budget cell.
The static census produces **counts and structure**, never milliseconds: `estimatedCompileClass`
is a class derived from counted noise evaluations against the plan's measured curve
(5 evals ≈ 0.9 s, 10 ≈ 2.4 s, 20 ≈ 7.4 s under DXC), not a prediction.

---

## 1. The correction that reframes Phase 3

**Most of the "1.18 s median first entry" is a one-time-per-process cost, not a per-theme cost.**

24 themes emit Dawn's `requestAdapter()` mark. The gap from that mark to the theme's next log line
is **median 963 ms** (range 898–1,012 ms on the twelve themes whose very next line is literally
"renderer initialized"). On the **second** `requestAdapter()` in the same process it collapses to
**median 21 ms** — black-hole 10, cosmic-noir 8, lunara 13, wolfhour 7, verdant-hills 6, ocean 11.

That ~0.95 s is WebGPU/Dawn process initialisation. The harness re-pays it in every fresh Electron
because each theme gets its own process and the anchor theme (`forest`) has no 3D renderer at all.
A player pays it once, for whichever WebGPU surface they touch first.

So the honest per-theme switch signal is not the cold column. Both committed columns:

| | cold first entry | warm re-entry |
|---|---:|---:|
| median | 1,065 ms | **124 ms** |
| p90 | 2,388 ms | **515 ms** |
| max | 6,257 ms (golden-forest) | **2,040 ms (koi-pond)** |

Neither is exactly "warm-process first entry" — the warm column is a *re-entry* with the module
already imported and the renderer sometimes preserved. Measuring a clean A→B→C chain of first
entries in one process is **the first thing Stage 2 must do**, because it decides how much of
Phase 3 is worth doing at all.

## 2. The fleet's lava lakes are the compile *call*, not a shader

Only **one** material in 61 themes survived adversarial verification as lava-lake class:
fluid-dreams' hero raymarch. The two measured outliers are something else entirely.

**golden-forest — 6,257 ms cold / 1,833 ms warm.** One gap of **3,736 ms** sits between
`[GoldenForest] Post-processing initialized` and `[GoldenForest] Scene ready`. That gap is
[`golden-forest-theme.js:965`](../src/themes/golden-forest/golden-forest-theme.js#L965)
`await this.renderer.compileAsync(this.scene, this.camera)` — the bare whole-scene form, over
**94 materials**, which r185 awaits **per object**, so the theme pays the *sum* of its shader
compile times. Its worst fragment is only 13 float-hash value-noise evaluations. There is no lake.

**koi-pond — 6,167 ms cold / 2,040 ms warm.** Same call at
[`koi-pond-theme.js:461`](../src/themes/koi-pond/koi-pond-theme.js#L461), fused with device init
into one 6,115 ms block ending at "Moonwake Sanctuary ready", still 2,017 ms on the second pass.
Its worst fragment does 8 MaterialX evaluations (demoted from *heavy* to *moderate* on verification).
The verified finding is an **asset** one: an 11.7 MB GLB fetched during scene construction to feed a
hero-canopy tier that is **0 in all six quality presets**, with the two real 75 KB tree GLBs stuck
behind it in the same `Promise.all`.

**20 bare `compileAsync(scene, camera)` call sites across 13 themes** carry this mechanism, plus
[`theme-manager.js:1362`](../src/themes/theme-manager.js#L1362). Full list in §6.1.

## 3. Two findings the plan does not contain

**3a. winter blocks the main thread for 3,156 ms on switch-*away*.** Its own teardown logs complete
in 2 ms; the stall lands on the *next* theme's already-cached dynamic import. Nothing else in the
fleet exceeds 83 ms except sky-children (1,170 ms). This is invisible in every "first entry" column
and is the largest single switch cost in the fleet after golden-forest and koi-pond.

**3b. Six themes ship a `src/playground/effects/*.effect.js` file as their production scene** —
`winter`, `summer`, `moonlit-forest`, `halcyon-apex`, `vesper-chrysalis`, `bioluminescence-2`
(all `import { create as … } from '../../playground/effects/…'`). Every audit that greps only
`src/themes/` undercounts them, including this plan's own MaterialX inventory. Corrected inventory
in §6.5. Any Stage-0 instrument must attribute by **theme**, not by directory.

---

## 4. The ranked hit list — top 8

Ranked by a composite of measured warm re-entry, measured cold first entry, measured switch-away
stall, verified shader class, bare-compile × material count, concentrated MaterialX, GC exposure,
and ADR-0019 correctness. Every row names the *mechanism*, not a symptom.

### 1. golden-forest — 3,736 ms in one bare whole-scene compile
94 materials through `compileAsync(scene, camera)`; the scene build itself is **84 ms**. Also carries
the fleet's highest per-frame closure count (15/frame, all `forEach` uniform writes), an inert
`bloomDownsample` (`golden-forest-post.js:380-385` calls stock `setSize`, which `BloomNode.updateBefore`
overwrites the next frame — it has always run at three's default 0.5), a per-activation
`UnrealBloomPass` leak (`golden-forest-post.js:406-409` never calls `disposeComposerPasses`), and
dead compatibility guards (`getWebGPUBlockers()` returns `[]`, so the `?goldenForestForceWebGPU=1`
warning at `:770-775` is unreachable). Plan rows: 3.1, 4.8, 5.1, 5.2.

### 2. koi-pond — 2,017 ms warm; an 11.7 MB GLB for a tier that is off
Same bare compile. The asset is the verified defect: fetched on the critical path for
`heroCanopy = 0` in all six presets, blocking two 75 KB GLBs in the same `Promise.all`. Plan rows:
3.1, 3.3, 4.8.

### 3. winter — 3,156 ms switch-away stall + the fleet's only concentrated MaterialX lake
`createWinterLakeNodeMaterial` ([`winter-materials.js:753`](../src/themes/winter/winter-materials.js#L753))
carries **fourteen** `mx_noise_float` evaluations in one fragment — the closest thing in the fleet
to the Odyssey lake's 20, and it sits one query param away from being built. **Zero `setLayout()`
exists anywhere in the theme**, so the shipped ground fragment inlines 72 layout-less helper bodies.
Plus the confirmed ADR-0019 defect (§6.4 D1): **21 `ShaderMaterial` constructions + an
`EffectComposer` chain on a `WebGPURenderer` code path**. Plan rows: 3.5, 6.1, and a new
switch-away row.

### 4. neon-district — 240 materials, 5 bare compiles, 4 recurring sync-pipeline sources
The pipeline-count outlier by a factor of two. Zero `setLayout()` across all six files; the
wet-ground fragment alone re-emits 130 inlined `Fn` bodies. `triggerGlitchWave` (`:9057`) constructs
a **brand-new material + geometry on every combo event** — a sync `createRenderPipeline` during
gameplay. Plan rows: 3.1, 4.7, 4.8, 5.2, 5.4.

### 5. ice-temple — 7 full-physical + transmission + clearcoat pipelines, warmed into the wrong context
No noise material at all; this is a feature-flag explosion. Its `compileAsync` at `:1353` is bound
to the **canvas** render context while the theme renders through a post `RenderPipeline`, so the
builder states it produces are never looked up and all 28 materials recompile on the first post
frame. Carries the latent ADR-0019 defect D2. Plan rows: 3.1, 5.3.

### 6. stellar-drift — three independent axes
A 12-instance nebula material inlining 10 layout-less value-noise bodies (80 hash bodies), zero
`setLayout` in the theme; a wasted `compileAsync` (`:2067`, `_renderTarget === null`); and the
fleet's #3 GC exposure — two rate-table object literals per frame **plus five ungated
`array = array.filter(...)` effect pools**, with correctly gated versions of the same code two
functions away (`:5560`, `:5011`). Plan rows: 3.1, 4.8, 5.5, and the cosmic-noir GC class.

### 7. ocean — the asset outlier, not the shader outlier
Zero `mx_noise`; its biggest material deliberately baked its procedural noise into a shared
DataTexture (`WS 4.1`). 57.9 MB of GLBs on disk. Two post-reveal sync-pipeline sources that neither
`compileAsync` covers (rare fauna streams in lazily; `OceanRareFaunaSystem.init()` is an empty
no-op). Plan rows: 3.1, 3.3, 5.2.

### 8. fluid-dreams — the fleet's only verified lava lake, and nothing warms it
`createFluidHeroNodeMaterial` ([`fluid-dreams-materials.js:121`](../src/themes/fluid-dreams/fluid-dreams-materials.js#L121)):
at the default High tier the 52-step raymarch is a **build-time JS loop**, so it emits 52 copies of
its body, each calling a layout-less `sceneSDF` — 56 inlined SDF bodies and 336 inlined `sminPoly`
bodies in one fragment. A second material, the haze, does 14 `mx_noise` evaluations (20 at Extreme).
**There is no `compileAsync` anywhere in the theme** (0 grep hits), so both compile synchronously on
the first rendered frame — which is exactly why its *measured* switch window is only 7 ms and its
cost is invisible in the committed matrix. Plan rows: 3.5, 5.3, and a new "warm the hero" row.

**Bubble, not in the top 8 but close:** vesper-chrysalis (10 `mx_noise`/fragment on an 8000×8000
plane, 55 evaluations across three materials), summer (12 `mx_noise` in the sky dome, no warm pass
at all), blood-moon (48 Ashima simplex + 81 unrolled Voronoi cells in one classic fragment),
stillwater (row-and-a-verdict: no lake, bloom already uses `setResolutionScale`, and it is the
**only** theme implementing the full warm protocol).

---

## 5. The 61-row table

`cold` / `warm` / `away` are measured (Lane B, n = 1, derived — §0). `mats` is materials constructed
at scene build. `bare cA` is bare whole-scene `compileAsync` call sites. `mx/frag` is the worst
single fragment's MaterialX evaluation count. `class` is the heaviest-shader class **after**
adversarial verification, with the demoted claim in parentheses. `GC` is the rank in the fleet's
per-frame-allocation audit (1 = worst).

| # | theme | kind | cold ms | warm ms | away ms | mats | bare cA | mx/frag | heaviest-shader class | GC |
|---:|---|---|---:|---:|---:|---:|---:|---:|---|---:|
| 1 | golden-forest | WGPU+GL | 6257 | 1833 | 41 | 94 | 1 | — | moderate | 6 |
| 2 | koi-pond | WGPU | 6167 | 2040 | 35 | 33 | 1 | 8 | moderate *(was heavy)* | — |
| 3 | winter | WGPU | 1105 | 91 | 3179 | 11 | 1 | 14 | heavy | 9 |
| 4 | neon-district | WGPU | 2800 | 496 | 33 | 240 | 5 | — | moderate *(was heavy)* | 16 |
| 5 | ice-temple | WGPU+GL | 2862 | 1185 | 38 | 28 | 2 | — | moderate *(was heavy)* | — |
| 6 | stellar-drift | WGPU+GL | 2388 | 484 | 33 | 39 | 1 | — | moderate | 3 |
| 7 | ocean | WGPU+GL | 2506 | 739 | 35 | 56 | 2 | — | moderate | 15 |
| 8 | fluid-dreams | WGPU+GL | 1198 | 181 | 33 | 4 | — | 14 | lava-lake | — |
| 9 | chromadelic-highway | WGPU+GL | 1810 | 500 | 35 | 50 | 1 | — | moderate | 8 |
| 10 | vesper-chrysalis | WGPU | 1502 | 407 | 32 | 42 | — | 10 | heavy *(was lava-lake)* | — |
| 11 | moonlit-forest | WGPU+GL | 2897 | 494 | 34 | 26 | 2 | 4 | moderate | — |
| 12 | blood-moon | GL | 1748 | 611 | 35 | 29 | — | — | heavy | — |
| 13 | stillwater | WGPU | 1419 | 331 | 35 | 43 | 1 | 6 | heavy | — |
| 14 | summer | WGPU+GL | 1147 | 147 | 36 | 24 | — | 12 | heavy *(was lava-lake)* | — |
| 15 | lunara | WGPU+GL | 1784 | 658 | 35 | 61 | — | — | moderate *(was lava-lake)* | — |
| 16 | stellar-velocity | WGPU+GL | 1518 | 231 | 38 | 32 | 1 | — | light | 4 |
| 17 | neon-dusk | WGPU+GL | 1315 | 333 | 34 | 25 | — | — | moderate | 5 |
| 18 | sky-children | WGPU | 1267 | 206 | 1170 | 17 | — | — | heavy *(was lava-lake)* | — |
| 19 | cosmic-noir | WGPU+GL | 1701 | 233 | 32 | 24 | 1 | — | moderate | — |
| 20 | starlight | WGPU | 1197 | 164 | 33 | 8 | — | — | heavy *(was lava-lake)* | — |
| 21 | sunset | GL | 527 | 188 | 83 | 23 | — | — | moderate | 1 |
| 22 | halcyon-apex | WGPU | 1725 | 515 | 44 | 91 | — | — | moderate | — |
| 23 | wolfhour | WGPU+GL | 1340 | 348 | 45 | 31 | 1 | — | moderate | 14 |
| 24 | himalayan-peak | WGPU | 1138 | 124 | 34 | 15 | — | — | heavy *(was lava-lake)* | — |
| 25 | serenity-warp | WGPU+GL | 1001 | 48 | 31 | 22 | — | — | heavy *(was lava-lake)* | — |
| 26 | pyrestorm | GL | 1835 | 185 | 46 | 46 | 1 | — | moderate *(was heavy)* | — |
| 27 | chiral-gold | WGPU+GL | 1386 | 228 | 32 | 9 | 1 | — | light | 12 |
| 28 | synthwave-sunset | WGPU+GL | 1141 | 124 | 33 | 24 | — | 1 | moderate | — |
| 29 | moonlit-greenhouse | none | 132 | 26 | 35 | 0 | — | — | light | 2 |
| 30 | shifting-sands | WGPU | 1013 | 67 | 30 | 15 | 1 | — | moderate | — |
| 31 | void-ember | none | 993 | 53 | 29 | 9 | — | — | moderate *(was heavy)* | 7 |
| 32 | sakura-twilight | GL | 872 | 288 | 51 | 22 | — | — | moderate | — |
| 33 | bioluminescence-2 | WGPU+GL | 1285 | 209 | 36 | 215 | — | 2 | moderate | — |
| 34 | solar-eclipse | GL | 186 | 50 | 42 | 50 | — | — | moderate *(was heavy)* | 11 |
| 35 | black-hole | WGPU | 1128 | 117 | 33 | 13 | 1 | 4 | light *(was heavy)* | — |
| 36 | galaxy | GL | 391 | 103 | 51 | 12 | — | — | light | 10 |
| 37 | astral-weave | WGPU+GL | 1065 | 66 | 32 | 61 | — | — | moderate | 13 |
| 38 | moonrise-summit | GL | 1360 | 139 | 40 | 21 | — | — | moderate | — |
| 39 | crystal-cave | GL | 930 | 193 | 42 | 266 | — | — | moderate *(was heavy)* | — |
| 40 | fall | GL | 346 | 145 | 42 | 6 | 1 | — | moderate | — |
| 41 | electric-dreams-v3 | WGPU | 1174 | 118 | 35 | 2 | 1 | — | moderate *(was lava-lake)* | — |
| 42 | nimbus-veil | GL | 419 | 122 | 40 | 18 | — | — | moderate | — |
| 43 | rainy-window | GL | 762 | 86 | 44 | 16 | — | — | moderate | — |
| 44 | luminous-tides | GL | 182 | 48 | 39 | 5 | 1 | — | moderate | — |
| 45 | cinder-drift | GL | 549 | 63 | 41 | 11 | — | — | moderate *(was heavy)* | — |
| 46 | geode | GL | 557 | 157 | 42 | 476 | — | — | light | — |
| 47 | misty-lake | GL | 189 | 51 | 36 | 54 | — | — | moderate | — |
| 48 | tornado | WGPU | 1002 | 31 | 32 | 3 | 1 | 1 | moderate | — |
| 49 | singing-bowl | GL | 415 | 100 | 40 | 11 | 1 | — | light | — |
| 50 | bioluminescence | GL | 344 | 106 | 42 | 100 | — | — | light | — |
| 51 | aurora | GL | 346 | 64 | 44 | 4 | 1 | — | light | — |
| 52 | verdant-hills | WGPU | 1036 | 73 | 34 | 184 | — | — | light | — |
| 53 | aether-tides | GL | 271 | 59 | 35 | 17 | — | — | light | — |
| 54 | supernova | GL | 298 | 56 | 40 | 4 | — | — | light | — |
| 55 | voltage-storm | GL | 237 | 53 | 32 | 18 | — | — | light | — |
| 56 | waves | GL | 181 | 48 | 41 | 39 | — | — | light | — |
| 57 | nebula-flow | GL | 240 | 52 | 32 | 17 | — | — | light | — |
| 58 | mountain | none | 137 | 49 | 71 | 0 | — | — | light | — |
| 59 | chromatic-impasto | GL | 241 | 51 | 32 | 18 | — | — | light | — |
| 60 | forest | none | 47 | 32 | 32 | 0 | — | — | light | — |
| 61 | cosmic-chimes | none | 57 | 21 | 33 | 0 | — | — | light | — |

---

## 6. The fleet-wide levers, with evidence

These fix many themes at once and are worth doing regardless of the ranking. Numbers are the plan's.

### 6.1 (plan 3.1 + 3.4) — 20 bare `compileAsync(scene, camera)` sites, and one that is worse

`black-hole:3425`, `chiral-gold:825`, `chromadelic-highway:1869`, `cosmic-noir:1855`,
`golden-forest:965`, `ice-temple:1353` and `:1667`, `neon-district:1149`, `:1172`, `:4123`,
`:4179`, `:4800`, `ocean:1291` and `:1376`, `stellar-drift:2067`, `stellar-velocity:2006`,
`stillwater:1174`, `wolfhour:3279`, `koi-pond:461`, `moonlit-forest:352`.

**The manager's own is the worst of them.** [`theme-manager.js:1358-1373`](../src/themes/theme-manager.js#L1358)
fires a bare whole-scene `compileAsync` **while the theme's render loop is live and post is
active** — the exact situation `compileGroupThroughPost` was rewritten to refuse
(`post-target-compile.js:30-45`, `:244-248`), because r185 reads drifting global target/MRT between
its yields and poisons the MRT-agnostic builder cache. It has **no `usesMrtScenePass()` guard**:
`BaseTheme.usesMrtScenePass()` (`base-theme.js:395-397`) exists precisely for this, **25 theme dirs
call `setMRT(`, and only stillwater overrides it**. stillwater (`:1171-1178`) and black-hole
(`:3417-3426`) both deliberately skip `compileAsync` on their MRT tier — and the manager then fires
it at them anyway from outside.

And the 3 s `withTimeout` bounds only how long the manager *waits*. `Renderer.js:1037-1065` has no
cancellation token and checks `_isDeviceLost` exactly once, at entry (`:886`). The abandoned drain
keeps running at full speed (it prefers `scheduler.yield()`, which Electron 38 has), retains the
renderer, all four managers and **every object, material and geometry in the compiled list**, and
can outlive the theme — `theme-manager.js:1410-1417` disposes the renderer mid-drain on a failed
prewarm, after which its remaining `_pipelines.getForRender` calls run against a torn-down backend.

**The recipe already exists and has zero imports.**
`src/rendering/odyssey/warmup/post-target-compile.js` (782 lines) is entirely duck-typed — no
`three`, no Odyssey state. `compileGroupThroughPost` (`:259`), `compileObjectsFannedOut` (`:462`)
and `compileGroupUnderLiveLoop` (`:764`) are importable as-is. Three small adaptations: the post
stack is named `this.postProcessing` in 13 themes, `this.post` in 7 and `this.postComposer` in 2 —
`BaseTheme.releaseManagedGpuResources` (`base-theme.js:781-790`) already enumerates exactly that
set, so a `BaseTheme.getPostStack()` is ~6 lines; `renderLoopActive` is `false` for every theme's
pre-loop precompile; `group` is `this.scene`.

**`BaseTheme.getWarmupRoots()` (`:380-382`) and `usesMrtScenePass()` (`:395-397`) are declared,
documented contracts with no shared consumer.** `src/themes/shared/warm-hidden-drawables.js` is
imported by exactly one file — `stillwater-theme.js:24`. Stillwater's `warmRuntime` (`:1162-1239`)
is the only implementation of the full protocol, and it is the template the other 24 MRT themes are
missing.

### 6.2 (plan 3.2) — the black gap, and why the crossfade currently fades a solid colour

`ThemeTransitionManager.crossfadeTransition` (`:180-202`) has the right shape, but
`captureCurrentTheme` (`:483-511`) reads **no theme pixels at all** — it fills the canvas with
`getComputedStyle(bgContainer).backgroundColor` (`:499-501`). It cannot fail loudly, so
`crossfadeTransition` never falls back to `fadeTransition` even though it has no snapshot.

Everything from `base-theme.js:655` (`removeChild`) to the new canvas's `appendChild` is dark, and
that interval contains the outgoing deep-dispose, the dynamic import, `new ThemeClass()`,
`await init()`, a possible second full dispose from cache eviction, `await renderer.init()`, the
whole scene build, and the theme's own bare `compileAsync`.

Two visual consequences follow directly from the ordering, and both are bugs today:

- **The fade-out fades nothing.** `classList.remove('active')` (`base-theme.js:420`) starts a 2.5 s
  opacity transition (`main.css:559`), but `removeChild` (`:655`) runs in the *same synchronous
  stack* — the container is empty on the first fade frame.
- **The fade-in is already over when the canvas appears.** `classList.add('active')` (`:246`) fires
  *before* `createScene`. At the fleet median the canvas is appended ~47 % into the 2.5 s fade; at
  golden-forest's 6.3 s the fade completed 3.8 s earlier and **the first frame pops in at full
  opacity**.

Only mode entry masks any of this (`main.js:2954`). Hub, settings, level and random-interval
switches have **no mask at all**. And the overlay is dismissed on `waitForThemeReady`
(`theme-manager.js:1702-1729`), which resolves on an event plus one rAF — an event gate, not a
presented-frame gate.

Blockers for a real snapshot, in order: the outgoing theme is disposed at `theme-manager.js:975-981`
*before* the load; the canvas detach is in the same synchronous stack as the render-loop stop, so no
frame renders between them; `preserveDrawingBuffer` is false fleet-wide (only ever behind a
diagnostics flag), so a post-hoc `createImageBitmap(canvas)` is not a supported read — the capture
must happen **inside the same task as a `render()`**; and `BaseTheme.runStartAttempt` clears
`active` from *every* `.theme-container` before adding its own (`:240-246`).

### 6.3 (plan 4.8) — bloom, and a bigger finding underneath it

**16 `setSize` monkey-patches across 15 themes** (lunara has two): astral-weave, black-hole,
chromadelic-highway, cosmic-noir, fluid-dreams, ice-temple, koi-pond, lunara ×2, neon-district,
neon-dusk, ocean, stellar-drift, stellar-velocity, synthwave-sunset.

`BloomNode.setResolutionScale` **does** exist in 0.185.1
(`examples/jsm/tsl/display/BloomNode.js:288`), `_resolutionScale` defaults to `0.5` (`:116`) and
`setSize` applies it internally (`:313-316`). Two corrections to the plan's framing:

- **The replacement value is `0.5 × bloomDownsample`, not `bloomDownsample`.** Passing `d` straight
  in would double every theme's bloom resolution and change the look.
- `setResolutionScale` only sets the field (`:288-293`); it does **not** re-apply `setSize`. And
  black-hole's patch adds a `Math.max(32, …)` clamp three has no equivalent for. So it is
  pixel-identical for 15 of the 16, with one caveat each way.

**The bigger finding: most quality-preset resolution numbers do nothing.** Three themes call the
*stock* `setSize` with pre-scaled dimensions from a resize handler — `winter/post/winter-pipeline.js:227-233`
(declares `bloomScale` 0.5–0.7, runs at 0.5), `golden-forest-post.js:380-385`, `chiral-gold-post.js:149-151`
— and both `BloomNode.updateBefore` (`:347-348`) and `PassNode.updateBefore` (`:805`) overwrite that
on the next frame with the raw drawing-buffer size. The same failure hits the **scene pass** in
golden-forest, lunara, ice-temple, neon-district and neon-dusk. **Only cosmic-noir
(`cosmic-noir-post.js:45`) and ocean (`ocean-post.js:75`) use `PassNode.setResolutionScale`.** Every
other TSL theme renders its scene pass at full drawing-buffer resolution regardless of its preset.

### 6.4 (plan 6.1 / 6.2) — ADR-0019, all 61 classified

**17** WebGPURenderer-only · **14** both kinds constructed (WebGPU wins iff no `forceWebGL` **and**
`backend.isWebGPUBackend === true`) · **20** classic `WebGLRenderer` only — the ADR-0008
compatibility lane, **not debt** · **10** delegating or with no three renderer of their own.
*(The plan's "21 WebGL-only themes" is stale: stillwater has moved to `WebGPURenderer` at
`stillwater-theme.js:834`.)*

- **D1 winter — CONFIRMED, and slightly under-stated.** `winter-theme.js:1483`
  `this.isWebGPU = this.renderer.backend?.isWebGPUBackend === true`, no `isWebGPURenderer` anywhere.
  10 material fallback twins via `else`, 11 more in `if (this.isWebGPU) return;` builders, plus
  `EffectComposer` at `:3736` with `UnrealBloomPass` `:3738` driven at `:4304`. **21 ShaderMaterial
  constructions + a composer chain on a WebGPURenderer path.**
- **D2 ice-temple — CONFIRMED, a genuine defect.** `:2849-2855`: if the dynamic TSL-runtime import
  throws, the theme keeps its **WebGPURenderer** and switches all nine material sites to classic
  factories. Its separate `requestWebGLFallback()` (`:1294-1320`) is correct.
- **D3 starlight — new.** Post is gated on the *backend* (`starlight-theme.js:507`,
  `post/render-pipeline.js:137-141`) although the pipeline is a TSL `RenderPipeline` that runs on
  both backends and already carries a non-MRT path. The WebGL2-backend lane loses **all** post for
  no capability reason.
- **D4 lunara — idiom risk, correct today.** `lunara-assets.js:149-151` picks the PMREM class off
  the backend flag; safe only because lunara rejects the WebGL2 backend at `:577-580`. Relaxing
  that rejection — the natural ADR-0019 cleanup — turns lunara into neon-district-black in one
  edit. Same shape in 11 more themes.
- **D5 neon-dusk — CONFIRMED leak.** `neon-dusk-theme.js:1130` overwrites the binding with no
  `dispose()` / `forceContextLoss()` / `domElement.remove()`; every one of 13 peer dual-renderer
  themes disposes on this branch.

`?forceWebGL` holes: **starlight, shifting-sands, tornado, verdant-hills** confirmed, plus
**fluid-dreams** (hardcodes `forceWebGL: false`, reads no param) — one the plan does not name.
Value-required nuance: winter, lunara and neon-dusk need `?forceWebGL=1`; a bare `?forceWebGL` is
silently ignored. electric-dreams-v3 and himalayan-peak have no WebGL lane by design and are
outside the matrix.

Console evidence corroborates: `pyrestorm` and `rainy-window` both log
`WebGL: INVALID_OPERATION: loseContext: context already lost`; `verdant-hills` still calls the
deprecated `renderAsync()`; `chiral-gold` emits `THREE.AttributeNode: Vertex attribute "uv" not
found on geometry` ×4.

### 6.5 (plan 3.5) — the MaterialX inventory is bigger than 18 files

The plan lists 18 `src/themes/` files. Adding the six playground effects that ship as production
scenes (§3b) gives **22**:

| file | mx_* lines | worst single fragment |
|---|---:|---:|
| `winter/winter-materials.js` | 30 | **14** (`createWinterLakeNodeMaterial:753`) |
| `playground/effects/vesper-chrysalis.effect.js` | 29 | **10** (`waterMat:702`) |
| `fluid-dreams/fluid-dreams-materials.js` | 10 | 14 (haze; 20 at Extreme) |
| `playground/effects/moonlit-forest-master.effect.js` | 10 | 4 |
| `playground/effects/summer-meadow.effect.js` | 9 | **12** (sky dome `:235`) |
| `fluid-dreams/fluid-dreams-compute.js` | 7 | *compute pipeline — not seen by the render-pipeline instrument* |
| `playground/effects/bioluminescence-2.effect.js` | 6 | 2 |
| tornado ×3, winter ×3 more, stillwater ×4, koi-pond ×2, synthwave-sunset, black-hole, starlight | 1–3 each | ≤ 6 |

**winter's 29 sites are spread across ~15 different materials** — no single winter *shipped*
fragment approaches the lake's 20; the concentration is in `createWinterLakeNodeMaterial`, which is
one query param from being built. So plan 3.5 remains a **cold-Dawn-cache lever**, exactly as
written — with three specific exceptions worth doing on their own merits: winter's lake material,
vesper-chrysalis's `waterMat`, and summer's sky dome. `mx_worley_*` stays.

### 6.6 (plan 5.6) — the classic bloom debt, quantified

r185's `UnrealBloomPass` composite bakes `3.0` into the additive rgb. **For identical visual weight,
`UnrealBloomPass.strength` must be `bloom(...).strength / 3`.** 15 dual themes currently feed the
**same preset number** into both constructors — several with literally the same expression
(`astral-weave-post.js:272`/`:355`, `golden-forest-post.js:177`/`:258`, `lunara-post.js:144`/`:220`,
`chromadelic-highway:4273`/`:4310`) — so **the classic path is 3× hotter than the TSL path** in
every one of them, before accounting for the classic path's fixed 0.5 internal scale. A full
per-tier retune table is in the fleet-post audit; ocean is the only theme that already differs
(×0.5, not ÷3).

`Water.js`: **bioluminescence, crystal-cave and rainy-window use stock `Water`** and move with any
upstream change; golden-forest, sunset and misty-lake are forked and pinned to their own constants.
`WaterMesh.js` exists in 0.185.1 but is a node material and **cannot** run on these themes' classic
renderer — it is not a migration path.

### 6.7 — the GC sweep (the cosmic-noir class, everywhere else)

Worst 8 by allocations per **idle** frame: **sunset** (~24 `THREE.Color` + 9 object literals +
4 closures — `getOceanColorsForTime:626-676` rebuilds a 7-entry palette table every frame to produce
3 values that are immediately `.copy()`d into uniforms), **moonlit-greenhouse** (a fresh
`CanvasGradient` and 2–3 `rgba(...)` template strings per glow layer per entity per frame),
**stellar-drift**, **stellar-velocity** (`applyActivePalette()` fans out over every ring, guide,
cluster, lane and arc every frame although the palette is static outside a colour transition),
**neon-dusk**, **golden-forest** (15 closures/frame), **void-ember** (a fresh 48-float
`Float32Array` every frame straight into `writeBuffer`), **chromadelic-highway**.

Fleet patterns: the cosmic-noir `decayRates` defect is **unfixed in 4 more themes**
(stellar-drift, chromadelic-highway, chiral-gold, + the walk-without-literal in stellar-velocity and
galaxy); **19 themes** allocate a closure per frame purely to re-arm the rAF loop, while
`BaseTheme.safeAnimate:1289-1315` already gets this right; ~120 per-frame `forEach`/`map`/`filter`
sites across 30 themes.

Verified clean, and worth recording as negative results: **no per-frame `devicePixelRatio` read
anywhere in the fleet**; exactly one per-frame DOM read (`winter-theme.js:3986` `matchMedia`); no
per-frame string cache key. **18 themes have zero findings** — `waves/waves-effects.js` and
`aurora-theme.js:438` are the reference-quality implementations.

### 6.8 (plan 5.x) — where r185's look-better features actually apply

Verified present in 0.185.1: `godrays`, `ao` (GTAO), `denoise`, `radialBlur`, `lut3D`, `lensflare`,
plus `dispersion`/`iridescence` on both physical materials. **`SSAONode` and `depthAwareBlur` are
confirmed absent** — not proposed anywhere here.

- **`godrays` — 5 hand-rolled implementations to replace.** sky-children (`post/sky-pipeline.js:128-139`,
  a 16-iteration `Loop` with **no occlusion test**) and himalayan-peak (`post/peak-pipeline.js:218-233`,
  a verbatim duplicate of it) are the strongest cases; then neon-district (`:172-190`, 6 arbitrary
  taps), neon-dusk (`:135-157`, already re-deriving linear depth per step by hand), and ocean
  (`:287-292` — the only defensible custom step, a hash-dither anti-banding; evaluate, don't assume).
- **`radialBlur` — stellar-drift.** Its WebGPU "speed lines" are a `sin(dot(...))` *pattern*, not a
  blur, while its classic path has a genuine radial sampler. One node makes both paths agree.
- **`lensflare` off the bloom buffer** — neon-district, chromadelic-highway, golden-forest (7 quads,
  7 separate materials).
- **`dispersion` + `iridescence`** — ice-temple's 7 pillar cores and lunara, both already
  transmissive `MeshPhysicalNodeMaterial`. Ultra/Extreme-gated.
- **`lut3D`** — already proven in-repo; ocean's `tslAbzuGrade` (a ~60-op helper inlined into the post
  quad), winter, fluid-dreams.
- **GTAO + `denoise`** — the audit found **no strong candidate**; recorded as a negative result
  rather than carried forward on the plan's original theme list.
- **MRT hygiene:** **22 MRT themes are unguarded on Windows**, and two run MRT *unconditionally* with
  no capability probe at all — `shifting-sands-post.js:47` and `synthwave-sunset-post.js:52`, the
  latter then reading `getTextureNode('emissive')` as its only bloom source with no fallback.

---

## 7. Negative results (recorded, not deleted)

- **There is no fleet of lava lakes.** 21 heavy/lava-lake claims were adversarially challenged and
  **13 were demoted**: lunara, sky-children, starlight, serenity-warp, electric-dreams-v3, summer,
  himalayan-peak, vesper-chrysalis (lava-lake → heavy or moderate); koi-pond, neon-district,
  ice-temple, black-hole, crystal-cave, cinder-drift, solar-eclipse, pyrestorm (heavy → moderate or
  light). Exactly **one** survived: fluid-dreams' hero raymarch.
- **The ~0.95 s per-theme WebGPU init is not per-theme.** §1. Any Phase-3 work costed against the
  cold column is costed against a cost the player pays once.
- **winter is not a MaterialX compile problem on the shipped path.** 29 sites, ~15 materials, worst
  shipped fragment well under the lake. Its real problems are the 3.2 s teardown and ADR-0019 D1.
- **ocean is not a shader problem.** Zero `mx_noise`; `WS 4.1` already baked its procedural noise
  into a shared DataTexture. It is an asset and sync-pipeline theme.
- **Dead code found, no perf claim attached:** black-hole's `createVolumetricAccretionDiskNodeMaterial`
  (`:306`, zero references), cinder-drift's `createVolcanicRocks()` (`:288`, never called),
  neon-district's `tempRenderer` KTX2 branch (`assets.js:129`, unreachable in the live flow),
  cosmic-noir's and golden-forest's `getWebGPUBlockers()` guards (return `[]`).
- **summer's TSL post pipeline is dead at runtime.**
- **`compileAsync` fan-out is not free.** From the Odyssey record: compiling every object
  individually cost ~22 ms of overhead per cache-hit call. The fan-out width of 6 is a measured
  choice, not a default to copy blindly.

## 8. What Stage 0 and Stage 2 must settle (nothing below is measured yet)

1. **Is the ~0.95 s device init per process or per theme?** Drive a clean A→B→C chain of *first*
   entries in ONE process. This decides how much of Phase 3 is worth doing. Everything else is
   downstream of this answer.
2. **Where does fluid-dreams' verified lava lake actually land?** Its switch window is 7 ms, so its
   compile is on the first frames as a sync `createRenderPipeline` — invisible to a wall-clock
   measure and to the async pipeline hook. The Stage-0 lane must record **sync creations with
   `ms = -1`**, as `odyssey-perf-session.mjs` already does.
3. **Frame p50/p95 with the CPU/GPU split, per theme.** No committed evidence exists for any theme.
   ADR-0016's sampling rule applies: **once per resolved query, never once per frame** — three's
   `Info.reset()` does not clear `render.timestamp`.
4. **`perf-budgets.json` → `frameP95Ms.perSurface."heavy-theme-worst"` stays `null`.** Filling it
   from a switch-time measurement would be the wrong metric, and filling it from an estimate is what
   ADR-0016 forbids; the precedent is `odysseyWorldGpuP50LaneBMs`, deliberately null. Its note now
   names the lane and the run that will fill it.
5. **Lane labelling.** The theme harness passes no `force_high_performance_gpu`, so it measures the
   Vega 8. That is the player-population lane and worth keeping — but the Stage-0 cell must assert
   the adapter (`navigator.gpu.requestAdapter()`; three 0.185.1 never stores it) and record which
   lane it ran on, so a future RTX run is not silently compared against it.

A full implementation spec for the theme perf lane — hook order, the exact existing seams in
`validate-all-themes.mjs` / `capture-theme-screenshots.mjs`, first-frame detection for both renderer
kinds, the committed cell shape, TDR safety, and a guard for each way a number could be wrong — was
produced alongside this census and is the input to Stage 0.

---

## 9. Per-theme verdicts (all 61)

One line each. Themes not in the top 8 get a verdict, not a rewrite.

- **golden-forest** (WGPU+GL) — Hit-list candidate — but NOT for a lava lake: the theme contains zero mx_noise and its worst fragment (createMountainLayerNodeMaterial, 13 float-hash value-noise evaluations = 52 inlined hash2D bodies) is only 'moderate'. Golden-forest is the 6.3 s outlier because of COUNT and CONTEXT: it constructs 94 distinct materials at scene build (85 TSL node materials) — including 25 identical spirit materi
- **koi-pond** (WGPU) — Hit-list candidate — but for its asset, not its shader: koi-pond fetches an 11.7 MB GLB during scene construction to feed a hero-canopy tier that is set to 0 in all six quality presets, and the two real 75 KB tree GLBs are stuck behind it in the same Promise.all. The shading side is disciplined (33 node materials, no lava-lake, allocation-free routing, correct FX prewarm); the sharpest shader find
- **winter** (WGPU) — Hit-list candidate: the shipped ground fragment inlines 72 layout-less helper bodies with zero setLayout anywhere in the theme, four compute kernels each carry 6 mx_noise_vec3, a 14-mx_noise lava-lake lake material sits one query param away from being built, the paw-trail pair creates two SYNC compute pipelines after the reveal, and the whole non-WebGPU half of the theme is 22 classic ShaderMateri
- **neon-district** (WGPU) — Hit-list candidate — and it is the asset and compile outlier, not the shader outlier: no mx_noise anywhere, but 240 materials at scene build, zero setLayout() across all six files (the wet-ground fragment alone re-emits 130 inlined Fn bodies, 116 of them hash functions, 72 of those from a 9x JS-unrolled ripple loop), that heaviest material compiled twice, five bare whole-scene compileAsync calls t
- **ice-temple** (WGPU+GL) — Hit-list candidate — not for one lava-lake shader (there is no noise material at all) but for 7 distinct full-physical + transmission + clearcoat pipelines behind a compileAsync that a post-bound RenderPipeline never reads, so the entire 28-material set recompiles synchronously on the first post frame; plus ~8.2 MB of canvas texture baked on the critical path and ~80 of 93 draw calls spent on the 
- **stellar-drift** (WGPU+GL) — Hit-list candidate on three independent axes: the 12-instance blood-moon nebula material whose fragment inlines 10 layout-less value-noise bodies and 80 hash bodies with zero setLayout anywhere in the theme; a ~3.9 MB external-texture load plus 13 synchronous 512x512 canvas bakes on the pre-first-frame path; and the worst per-frame allocation profile in this batch (5 filter() + 5 forEach closures 
- **ocean** (WGPU+GL) — Not a lava-lake candidate and not a hit-list theme on the noise axis — ocean has zero mx_noise, its worst fragment evaluates 6 cheap sin-hash value-noise samples, and its biggest material (createSeabedNodeMaterial) deliberately baked its procedural noise out to a DataTexture; it is a row-and-a-verdict theme whose three real findings are structural rather than shader-cost: two bare whole-scene comp
- **fluid-dreams** (WGPU+GL) — HIT-LIST CANDIDATE, and the strongest one in this batch: two independent lava-lake-class materials (a 52-step unrolled raymarch with 56 inlined SDF bodies and 336 inlined sminPoly bodies, plus a 14-eval — 20 at Extreme — mx_noise haze that is structurally the Odyssey lake), a 6-mx_noise compute kernel, zero setLayout() in the entire theme, zero compileAsync, and every one of those pipelines create
- **chromadelic-highway** (WGPU+GL) — Hit-list candidate — not for one lava-lake material (its heaviest fragment is a merely 'moderate' 18-tap post quad with zero mx_noise) but for pipeline COUNT: 41 materials at scene build of which 17 are structurally identical duplicates that each compile their own pipeline, plus a brand-new NodeMaterial and compute node minted per shooting-star spawn every 1.4-3.0 s for the whole session, on top o
- **vesper-chrysalis** (WGPU) — Top hit-list candidate in this batch and the clearest lava lake: waterMat evaluates mx_noise 10 times per fragment over a full-screen 8000x8000 plane, coreMat 9 and shellMat 7 on top of a transmission+iridescence+clearcoat MeshPhysical body, 55 mx_noise evaluations across 12 materials, a bloom setSize monkey-patch that r185's BloomNode.setResolutionScale replaces, ~2.14 MB of planet JPEGs + LUT + 
- **moonlit-forest** (WGPU+GL) — Not a lava lake — its worst fragment is 4 Perlin evaluations and its noise is deliberately spread thin across 8 materials — but a real hit-list candidate on pipeline COUNT: 26 MeshBasicNodeMaterials warmed through one bare whole-scene compileAsync, which by the ~30 ms floor alone is the dominant term in this theme's first-entry latency.
- **blood-moon** (GL) — Hit-list candidate on two independent axes: the moon fragment is the batch's densest hand-rolled shader (48 Ashima simplex evaluations + 81 unrolled Voronoi cells + 17 crater bodies in one fragment), and its three nebula 'textures' are 1024x1024 JPEGs misnamed .png whose absent alpha channel the shader still multiplies by.
- **stillwater** (WGPU) — Row-and-a-verdict, not a hit-list candidate: there is NO lava lake here — the worst single fragment does 6 mx-noise evaluations (groundMaterial), no TSL Fn is inlined more than once, bloom already uses r185's setResolutionScale with zero setSize monkey-patching, and the frame path is nearly allocation-free. The four things worth a line are the one bare whole-scene `compileAsync(this.scene, this.ca
- **summer** (WGPU+GL) — Hit-list candidate: the sky dome is a genuine lava-lake sibling - 12 inlined mx_noise_float evaluations in a single MeshBasicNodeMaterial fragment, produced by a 4x-inlined JS helper that itself inlines a 2-noise fbm, sitting between the fleet's measured 10-eval (2.4 s) and 20-eval (7.4 s) DXC points - and it is the first thing drawn, with nothing warmed and ten more materials compiling synchronou
- **lunara** (WGPU+GL) — Hit-list candidate on compile: 61 materials built at scene time with ZERO compileAsync and no prewarm of its own, a sky fragment that inlines 256 hash31 bodies across 32 unrolled value-noise evaluations with not one setLayout in the whole noise library, a synchronous PMREM bake on the awaited critical path, and 20 pooled reaction materials sitting visible=false that will fire synchronous createRen
- **stellar-velocity** (WGPU+GL) — Not a compile hit-list candidate -- zero mx_noise, zero layout-less shared Fn helpers, zero procedural noise and zero texture taps on the WebGPU path, 32 ordinary materials, and no external assets at all -- but it owns the worst GC profile in this batch: Object.keys().forEach every frame in decayReactiveEnvelope plus a full applyActivePalette() (six forEach closures and ~25 redundant uniform write
- **neon-dusk** (WGPU+GL) — Hit-list candidate on three independent axes: zero compileAsync anywhere so all ~33 pipelines (25 scene + post output + 7 bloom internals) are created synchronously on frame 1; a 22-tap post output node running at full resolution with a 6x-inlined ray helper; and an ungated animate() that allocates a closure per frame and never calls shouldRenderFrame(). Its asset profile, by contrast, is the clea
- **sky-children** (WGPU) — HIT-LIST CANDIDATE — the valley terrain material is a genuine lava-lake (94 inlined valueNoise2 = 376 inlined hash2 bodies in one program, 84 of them in the vertex stage), four more materials each carry 42 valueNoise2 from a needlessly doubled heightFieldTSL call, there is not a single setLayout() in the theme and not a single compileAsync, so all 17 pipelines are built synchronously while the rAF
- **cosmic-noir** (WGPU+GL) — Not a hit-list theme for compile — no mx_noise anywhere, heaviest material is a 'moderate' MeshStandardNodeMaterial with 5 cheap value-noise evals — but it earns a row for two concrete defects: a 6.8 MB planet PNG loaded on the critical path and sampled by neither renderer path, and four scene-build materials left unwarmed because compileAsync skips visible=false objects, so their pipelines compil
- **starlight** (WGPU) — Hit-list candidate on COMPILE alone: the nebula sky fragment is a genuine lava-lake-shaped shader — 256 inlined hash3 bodies, 32 valueNoise3, 34 noise evaluations, zero real WGSL functions — and one setLayout on fbm3 (tsl-noise-lib.js:70) would collapse it the way it collapsed the Odyssey lake; everything else about the theme (4 idle draw calls, zero runtime textures, essentially zero per-frame al
- **sunset** (GL) — Hit-list candidate on frame and GC, not on compile: getOceanColorsForTime allocates 24 THREE.Color objects plus ~10 object literals every single frame from an unconditional call in updateOcean, while the ocean's onBeforeRender re-renders the entire scene — 35,000-point starfield included — into a 512x512 target on top of it.
- **halcyon-apex** (WGPU) — Hit-list candidate, but for pipeline COUNT and a warm-up hole rather than a lava lake: 91 node materials at scene build (~2.7 s of the 30 ms/pipeline floor with no single expensive shader), 5.5 MB of synchronous 256x256 CanvasTexture baking plus ~2.3M Math.sin before the first frame, and ~27 programs that first compile synchronously mid-game because 74 FX meshes sit at visible=false with no getWar
- **wolfhour** (WGPU+GL) — Row-and-a-verdict, with one genuine cleanup lever: no lava-lake (zero MaterialX noise anywhere, and the float-hash noise it does use is the cheapest family), but 31 pipelines at scene build, 8 of which are the same mountain graph re-compiled per peak with a 1+4+16-body inline expansion that a single setLayout on tslNoise would collapse — and the largest theme file in the fleet is carrying a 37 KB 
- **himalayan-peak** (WGPU) — HIT-LIST CANDIDATE, and the cleanest one in the fleet to fix: a single MeshBasicNodeMaterial (rendering/ridge-terrain.js:100) carries 44 layout-less valueNoise2 inlines and 176 hash2 inlines in one pipeline — the exact Odyssey-lake shape — while the theme has only 6 scene materials total, so adding setLayout() to hash2/valueNoise2/ridgeOctave/fbm2/ridged2/heightField in himalayan-noise.js plus hoi
- **serenity-warp** (WGPU+GL) — Hit-list candidate number one in this batch: the intro nebula sky it delegates to is a real lava lake — 20 valueNoise3 / 160 hash3 evaluations per fragment with 191 inlined helper bodies and not a single setLayout() in src/ui/intro-noise-lib.js — and it is drawn full-screen on frame one with no compileAsync warm anywhere on the path, while the theme's own six materials are the only things that get
- **pyrestorm** (GL) — Hit-list candidate on FRAME, not on compile: a legitimate classic-WebGL theme (no ADR-0019 exposure at all) whose idle loop burns ~51,000 CPU particle iterations and ~36,000 trig calls per frame across three unconditional full-array loops, on top of 46 scene draw calls and a 4-pass full-res composer — while the heaviest shader (17 Ashima simplex3D in the storm-cloud dome) is only 'heavy', and 31 o
- **chiral-gold** (WGPU+GL) — ROW-AND-A-VERDICT on compile — no lava-lake, no mx_noise, no layout-less helpers, nine light materials — but a real HIT-LIST CANDIDATE on GC and on combo-time pipeline stalls: nine per-frame object/closure allocations including Object.keys().forEach and a Vector3 clone, a bare whole-scene compileAsync that warms the wrong render context anyway, and fresh node materials constructed mid-game for eve
- **synthwave-sunset** (WGPU+GL) — Hit-list candidate on two narrow, cheap items — the bloom setSize monkey-patch (post.js:64) that r185's setResolutionScale replaces outright, and a post fragment carrying a compiled-but-permanently-zero mx_noise_float plus an entire dead wet-reflection block with two wasted texture samples — but no lava lake and the ADR-0019-shaped backend gate at :670 is safe, merely wasteful of a working WebGL2-
- **moonlit-greenhouse** (none) — Row-and-a-verdict theme for compile (it has literally zero shaders), but a genuine GC hit-list entry: ~30 CanvasGradient allocations per frame at idle rising to ~305 at combo peak, plus a synchronous 2048x1080 canvas.toDataURL() PNG encode on the theme-switch critical path.
- **shifting-sands** (WGPU) — Row-and-a-verdict theme on compile (heaviest pipeline is a moderate 8-noise3D/64-hash3 dune material, no lake anywhere) but a genuine hit-list candidate on GC and on ADR-0019: two object literals allocated every single frame (compute.js:211 and theme.js:1274, the latter never read by anything), a redundant full CPU worm mirror running alongside the GPU compute on the WebGPU path, a combo handler t
- **void-ember** (none) — Hit-list candidate, but for FRAME and GC rather than compile: roughly 45-55 object allocations every frame (a fresh 48-float Float32Array, 13 render-pass descriptors with nested arrays, two getEmber* object returns, two O(n) array shifts), a full-canvas rgba16float copy per frame that is provably dead on low and medium, a full-screen fragment doing 14-48 value-noise evaluations per pixel, and 9 pi
- **sakura-twilight** (GL) — Row-and-a-verdict theme, not a hit-list candidate for compile — but the asset row is the batch's worst: an 11.79 MB shared GLB is awaited on the critical path before a single visual element exists, to extract two geometries, and a 1024x1024 canvas with 46 shadow-blurred bezier fills is baked behind it.
- **bioluminescence-2** (WGPU+GL) — HIT-LIST CANDIDATE, but for pipeline COUNT rather than pipeline depth: no material here is a lava lake (worst fragment = 2 mx_noise evals, zero Fn() in 1,890 lines so there is no layout-less inlining problem at all), yet the theme builds 126 node materials synchronously at scene build plus ~81 more inside GLB callbacks, and because makeGlow/rockGlbMat bake their per-instance parameters as WGSL lit
- **solar-eclipse** (GL) — Hit-list candidate on all three of compile, frame and GC: the moon fragment unrolls 6 five-octave fbm loops into 30 value-noise evaluations (240 inlined sin) making it the heaviest shader in the batch, the same noise block is copy-pasted into the sun fragment for another 15, and three `.filter()` calls rebuild arrays with fresh closures every single idle frame.
- **black-hole** (WGPU) — Row-and-a-verdict, not a hit-list candidate — 12 node materials at High, a heaviest fragment carrying only 2 MaterialX call sites (~3 perlin bodies after DXC), an explicitly scratch-allocated frame loop, and the fleet's only correct prewarm (compute + post warmed in the real render context, with hidden burst sprites deliberately revealed first); the findings that remain are dead code (a never-cons
- **galaxy** (GL) — Hit-list candidate for the cosmic-noir GC class, not for shaders: five per-frame allocation sites including a textbook Object.entries().forEach over 9 keys every frame, plus a 100,000-vertex spark buffer that runs a full vertex shader each idle frame to emit alpha 0. Its shaders are the cheapest in the batch.
- **astral-weave** (WGPU+GL) — Hit-list candidate, but for COUNT rather than for a lava lake: no single fragment here exceeds 8 value-noise evaluations, yet the theme constructs 60 node materials and issues 57 idle draw calls against its own declared 30-call budget, and it leaks GC every frame through an ungated per-frame stats object plus a 3600-element Array.shift() (astral-weave-theme.js:1705 -> :2229/:2231) — the worst GC p
- **moonrise-summit** (GL) — Row-and-a-verdict theme: correctly classic-WebGL-only by design, zero assets, no TSL and therefore no mx_noise exposure, and a clean allocation profile - the heaviest fragment (water, 7 snoise calls plus a 9-step voronoi) is structurally the opposite of the lava lake because its noise is a real GLSL fn called seven times, not seven inlined bodies; the only findings worth carrying are the stale 'wo
- **crystal-cave** (GL) — The worst theme in the batch and the clearest hit-list entry: three's Water re-renders the ENTIRE scene into a 512x512 target every frame (~615 draws/frame total), ~257 per-crystal ShaderMaterial instances become 257 draw calls, and createScene synchronously runs two 65,536-pixel JS normal-map bakes before a single mesh exists.
- **fall** (GL) — A hit-list candidate on the ASSET axis, not the compile axis: createBarkPBRTextures (fall-theme.js:82-432) runs ~1.05 M pixel-loop iterations and ~2.1 M getHeight calls and produces 5.2 MB of 512x512 CanvasTextures synchronously before the first frame, while its heaviest shader is an ordinary 5-map MeshStandardMaterial with zero noise.
- **electric-dreams-v3** (WGPU) — THE HIT-LIST THEME of this batch on compile: two materials total and a spotless zero-allocation frame loop, but the nebula sky is a genuine lava-lake — 154 inlined layout-less Fn bodies (128 of them hash3) in one fragment, from a 4-deep warpedFbm3 -> 4x fbm3 -> 4x valueNoise3 -> 8x hash3 chain, with not one setLayout() in the theme.
- **nimbus-veil** (GL) — Row-and-a-verdict theme: modest everywhere, with two small levers — five per-frame forEach closures across three redundant passes over the same arrays, and ten un-instanced overlapping DoubleSide cloud planes whose fbm emits 12 simplex bodies to execute 8. It is also the batch's only theme that correctly warms an event-driven material at scene build.
- **rainy-window** (GL) — Hit-list candidate, but for FRAME cost rather than compile: a full second scene render every frame from three's Water (Water.js:330) on top of 50,000 additively-blended rain points and 200 fog sprites whose fragments each run five inlined Ashima 3D simplex evaluations at up to 1,800-pixel sprite sizes — the most expensive idle frame in this batch by a wide margin.
- **luminous-tides** (GL) — Not a hit-list candidate but the batch's heaviest authored shader by counted content: 8 inlined Gerstner bodies + 3 unrolled cnoise per vertex over 16,641 vertices, and 4 snoise per fragment — a row-and-a-verdict theme whose update path is otherwise the cleanest of the five (zero per-frame allocations).
- **cinder-drift** (GL) — One lever, cleanly isolated: a view-filling magma fragment that evaluates 30 Ashima 2D simplex per pixel at an uncapped-by-render-scale pixel ratio. Otherwise the leanest theme in the batch — 11 materials, no assets, no post, near-zero GC — and lean partly because roughly half its material-constructing code is unreachable.
- **geode** (GL) — NOT a lava-lake theme — it cannot be, it is classic-WebGL-only with 4 trivial GLSL programs at scene build — but it is a hit-list candidate on the OTHER three axes: ~476 materials / ~476 draw calls, a 55,000-element loop plus a 220 KB attribute upload every frame driven entirely by a ripple system whose only spawner has zero callers, per-frame .bind() and nested forEach closures over 473 crystals,
- **misty-lake** (GL) — Row-and-a-verdict theme, not a hit-list candidate for compile: classic-WebGL-only (not debt), 20 distinct GLSL programs with no lava lake — but its idle update path allocates nine objects/closures per frame, it ships six full-screen 12-snoise mist planes with frustumCulled disabled, and it allocates a 384x384 mirror render target for a reflection feature that is off by default.
- **tornado** (WGPU) — Not a compile hit-list candidate — 3 node materials, 1 mx_noise per fragment, no Fn inlining — but it IS a GC hit-list candidate: five separate per-frame allocation sites (3x new THREE.Color + Object.keys array + closure + 2 strings) fire on every idle frame through an ungated updateComboEffects.
- **singing-bowl** (GL) — Not a compile hit-list candidate (no shader here exceeds 'light' and there is zero noise in the entire theme) but a frame hit-list candidate: a full second scene traversal every frame for the Reflector, 1821 CPU matrix composes + a full instanceMatrix re-upload every frame, and 6 needlessly-distinct programs created by baking loop indices into shader source strings.
- **bioluminescence** (GL) — ROW-AND-A-VERDICT, but on the WRONG axis from the lava-lake hunt: this theme has no compile hazard whatsoever (its heaviest program is a stock MeshStandardMaterial and its two biggest custom shaders carry explicit 'NO noise' comments), while carrying the batch's worst GC and startup profile — 16-24 Vector3 per frame from CatmullRomCurve3.getPoint at :1692, four traverse closures per frame at :1833
- **aurora** (GL) — A row-and-a-verdict theme: 4 distinct light GLSL programs, no post, no textures, no noise beyond 6 snoise call sites — the only findings worth a line are the per-frame .bind at aurora-theme.js:441 and the 2496 spark points that are rasterized every idle frame (6 always-visible Points draws whose vertex shader zeroes alpha when uPulseTimer is -100).
- **verdant-hills** (WGPU) — Row-and-a-verdict on compile (5 light pipelines, zero noise, zero Fn), but a genuine hit-list candidate on FRAME: 184 draw calls of which 180 are per-tree meshes that should be 1-2 InstancedMesh draws, plus 25,000 grass instances with frustumCulled = false (:538) and a 300-particle CPU integrate + full buffer re-upload every frame.
- **aether-tides** (GL) — Row-and-a-verdict theme: compile cost is negligible (17 tiny GLSL programs, zero mx_noise) but it burns 43 full-screen blits per frame at a 1820x1024 dye target with 20 pressure iterations, allocates an object literal every frame at fluid-simulator.js:909, and leaks divergence/curl/pressure/bloom/sunrays FBOs on every window resize.
- **supernova** (GL) — Row-and-a-verdict theme, and close to clean: 4 materials at scene build, 4 idle draw calls, the tightest update loop in the batch — its only real defects are two materials that compile synchronously on the first line clear and the first piece lock, and a per-lock geometry+material allocation.
- **voltage-storm** (GL) — NOT a lava-lake candidate — 18 tiny GLSL programs, zero noise, zero fbm, all pre-linked inside an awaited init() so there is no sync-pipeline stall. It IS a hit-list candidate on FRAME: 42 full-screen blits every single frame including a 13-blit, 6-mip bloom chain that runs unconditionally even though updateEmitters() is empty (:316) and a still screen produces no splats at all — nothing gates the
- **waves** (GL) — A row-and-a-verdict theme, and the cleanest of the three: classic-WebGL-only with 9 small GLSL programs, no mx_noise, no unrolled anything, and an animate loop that is genuinely allocation-free (it is the only theme in this batch without a per-frame closure/bind). Its two real findings are that 6 of its 9 programs compile on the first gameplay event because 36 drawables sit at visible=false with n
- **nebula-flow** (GL) — Hit-list candidate for waste rather than for any single shader: 5 of its 17 GL programs and ~9 half-float framebuffers are compiled and allocated for features that are disabled in all four presets, those FBOs leak on every resize, and its live frame cost is 29 full-screen blits at High.
- **mountain** (none) — HIT-LIST CANDIDATE, but on the ASSET axis only, not the shader axis: createScene() synchronously allocates and rasterises ~59.6 MB of Canvas2D backing store (three 4096 x innerHeight range canvases at :109-111 plus one 4096x400 cloud canvas at :147-148) and paints 300 blurred arc fills under ctx.filter (:158-170) before it returns — then leaves all four as permanently-animating compositor layers, 
- **chromatic-impasto** (GL) — NOT a lava-lake candidate — every one of its 18 GLSL programs is under 40 lines with zero noise and zero fbm, and all 18 are pre-linked inside an awaited init() so there is no sync-pipeline stall at all. It IS a hit-list candidate on GC (getLindstromColor rebuilds a 13-object palette per call at :176, getContrastingColor rebuilds a 5-6 object palette per call at :200, normalizeColor allocates ever
- **forest** (none) — Clean, and effectively a stub: 43 lines, an empty createScene(), a no-op init(), zero theme-owned shaders and 6 particle draws — the only things worth writing down are the dead particleConfig block and a 326 KB icon that is 99.6% of the theme directory.
- **cosmic-chimes** (none) — CLEAN — a row and a verdict. Zero GPU renderer, zero materials, zero shaders, and zero per-frame work because the theme has no animation loop at all; the only cosmic-noir-class allocation (getEdgePosition rebuilding an 8-region table, :322) is event-driven, not idle. The single r185 look-better list is empty on purpose: there is no three.js surface here to improve.

---

# PART B — Stage 2: the measured sweep (2026-08-24)

Status: **COMPLETE.** 61 themes measured with the theme perf lane
([`scripts/lib/theme-perf-instrument.mjs`](../scripts/lib/theme-perf-instrument.mjs)), serially, one
fresh Electron per theme, **one adapter for the entire run** (RTX 3070 Laptop, `force_high_performance_gpu`).
Cells: [`reports/theme-perf/`](../reports/theme-perf/), 58 of 61 admissible. Aggregate:
[`reports/theme-perf/AGGREGATE.md`](../reports/theme-perf/AGGREGATE.md).

Everything above this line is **Part A — the Stage-1 static census**: predictions made from source
alone, before any measurement. It is left intact rather than edited, so the predictions can be
scored. §12 scores them. Where Part A and Part B disagree, **Part B is right**.

## What the measurement changed

**1. The root cause is one thing, and Stage 1 could not see it.** Seven of the top ten themes by
post-switch cost create **zero** async pipelines: stillwater, vesper-chrysalis, lunara,
fluid-dreams, bioluminescence-2, summer, starlight. In three 0.185.1 the only path that reaches
`device.createRenderPipelineAsync` is `Renderer.compileAsync`, so a theme that never calls it warms
nothing at all and pays the entire compile on the GPU at first draw. Plan row **3.1 is the phase**.

**2. stillwater is the fleet's worst theme — and Part A called it "row-and-a-verdict, not a
hit-list candidate."** 10,421 ms to first frame, 9,705 ms of it after the switch promise has already
resolved. Part A also called its warm protocol "the template the other 24 MRT themes are missing".
The protocol is sound for *correctness* and warms nothing: its `usesMrtScenePass()` guard makes the
`compileAsync` branch unreachable, and its answer to "the bare compile is wrong here" was "then do
not compile" — when [`post-target-compile.js`](../src/rendering/odyssey/warmup/post-target-compile.js)
already holds the right answer.

**3. Sync pipeline COUNT is not first-frame cost.** neon-district creates 180 sync pipelines — the
fleet's most — and reaches its first frame in 1,713 ms, 17th. Only the pipelines the first frame
actually needs block it; the rest compile later. The themes that block are the ones with **0 async
and deep first-frame dependencies**, not the ones with the biggest unwarmed set.

**4. The frame-time story is CPU submission, not fill.** Worst idle GPU p95 fleet-wide is 2.42 ms
against a 9 ms budget. (**CORRECTED 2026-08-25 — see section 19:** the claim that no theme exceeds 16.67 ms wall was false. neon-district measures wall p95 22.9-23.1 ms with 12-14 % of frames over budget, n = 3. The original figure came from a cell that landed in that theme's fast pacing bucket.) `perf-budgets.json` `split.cpuMaxMs` is
6, and one theme exceeds it: **neon-district at ~10.4 ms** idle CPU-submit p95 (n = 4: 10.5 / 10.7 /
9.9 / 10.5) at 1,856 draws — about 1.7x over. golden-forest straddles it (4.7–7.9 ms, n = 4).

> **CORRECTED 2026-08-25.** This section first reported 23.3 ms and 14.3 ms and called them a
> 3.9x breach. Those figures were an instrument defect: the lane wrapped render entries on both the
> renderer and the post object and double-counted the inner span where one re-entered the other.
> The tell was on the face of it — 20.4 ms of CPU inside a 7.8 ms frame is impossible — and it was
> published before anyone applied that check. Fixed in `71fcf9a9` by timing only the outermost
> wrapped call. Exactly two of 61 themes were affected, and they were the two quoted here. Nothing
> else in this document reads `cpuSubmitMs`.

**5. No lava lakes, confirmed by measurement.** Worst single async pipeline across all 61 themes is
neon-district at 1,688 ms, then golden-forest 959, koi-pond 600. The Odyssey lake was 7,235 ms.
Part A's adversarial pass had already demoted 13 of 21 heavy claims; the GPU agrees.

## 10. Method, admissibility, and the instrument-defect record (Stage 2)

### 1. How a cell is produced

Every number in this document comes from one file per theme under `reports/theme-perf/<theme>.json`,
written by the perf lane of `scripts/capture-theme-screenshots.mjs` and reduced by the two pure
modules `scripts/lib/theme-perf-instrument.mjs` and `scripts/lib/theme-perf-cell.mjs`. The lane is
the `--perf` mode of the existing theme-validation harness: in that mode the lifecycle assertions
are deliberately **skipped** (`capture-theme-screenshots.mjs:1963-1970`), because driving hub cards
and 104 assertions is the wrong driver for a measurement — it adds hub DOM work and two extra
switches inside the window.

**Run identity.** All 61 cells carry one `runId` (`2026-08-24T17-00-53-492Z`) and one manifest
variant, `generatedAt` spanning `17:01:24.006Z` → `17:43:56.068Z` (42.5 min, median 41 s per theme,
strictly serial):

| Field | Value |
| --- | --- |
| Electron / Chrome | `38.8.6` / `140.0.7339.249` |
| Window | 1920×1080, **shown** (`windowShown: true`) |
| Pinned quality / target | `High` / 60 fps |
| Idle window | `idleMs: 10000` (visit 1); visit 2 uses `max(4000, idle/3)` = 4,000 ms |
| Dawn cache | `cold-per-theme-userdata` |
| Switches requested | `force_high_performance_gpu`, `force-device-scale-factor=1`, `disable-backgrounding-occluded-windows`, `disable-background-timer-throttling`, `disable-renderer-backgrounding`, `enable-precise-memory-info` |
| Adapter (probed per cell, identical in all 61) | `{vendor: "nvidia", architecture: "ampere"}`; `webglRendererString: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x000024DD) Direct3D11 vs_5_0 ps_5_0, D3D11)"` |

**One theme, one Electron process, one shader cache.** `validate-all-themes.mjs:548` spawns a fresh
worker per theme and hands it its own `userData` directory (`:320-322`), which
`capture-theme-screenshots.mjs:111-114` installs before `app.whenReady()`. A per-theme userData dir
is a per-theme Dawn shader cache, so every theme's compile figures are cold-cache and comparable
with each other. A cooldown floor of 8,000 ms separates workers (`PERF_LANE_DEFAULTS`,
`validate-all-themes.mjs:73`, applied at `:835-844`).

**The instrument is installed before the page's first script.** The app builds a whole theme during
boot, so an `executeJavaScript` after `loadURL` has already missed a theme's entire pipeline set.
The bootstrap goes in through CDP `Page.addScriptToEvaluateOnNewDocument`
(`capture-theme-screenshots.mjs:1649-1667`), which runs in the **main** world at document start. A
`preload` cannot substitute: the worker sets `contextIsolation: true`, and an isolated world has its
own copies of the built-in prototypes, so a `GPUDevice.prototype` patch there is invisible to page
code (`theme-perf-instrument.mjs:10-16`). After navigation the worker asserts
`!!window.__THEME_PERF__` and throws if it is false (`capture-theme-screenshots.mjs:1944-1947`) —
an instrument that half-installed would publish silently partial pipeline counts rather than none.

What the bootstrap installs: a `GPUDevice.prototype` hook on **both** pipeline creation paths
(`theme-perf-instrument.mjs:79-106`), a `HTMLCanvasElement.getContext` census (`:110-115`), a
`longtask` observer (`:118-126`), and theme/renderer traps armed from
`src/themes/base-theme.js:296-303` (before `createScene`, where the renderer and the first pipelines
are built) and `:434-437` (disarm before dispose collects in-flight resolves).

**The two visits.**

| Step | Where | Notes |
| --- | --- | --- |
| Pins injected and made observable | `buildPinSource`, `capture:1745-1751` | quality, targetFrameRate, adaptiveResolution/dynamicResolution off |
| Park on the anchor theme, settle 4,000 ms | `capture:264, 1754-1762` | anchor is `forest`, or `mountain` when the target *is* forest, so the target is never the boot theme |
| CDP `HeapProfiler.collectGarbage` + heap bracket | `capture:1764-1766` | cross-check on the in-page 250 ms sampler |
| **Visit 1** — the measured one, 10,000 ms idle | `buildPerfVisitSource` | the cold-in-process build |
| Return to anchor, settle 4,000 ms | `capture:1785-1792` | |
| **Visit 2** — 4,000 ms idle | `capture:1793-1804` | exists for the content guard and the drift bound **only**; never averaged with visit 1 |
| Adapter probe | `capture:1806, PERF_ADAPTER_SOURCE:1710-1730` | `requestAdapter` is GPU work, so it runs at collection time, never inside a window |

Inside a visit (`theme-perf-instrument.mjs:357-556`): marks/pipes/rings are cleared, `t0_requested`
is taken, and `manager.switchTheme(id, true)` is called **directly** rather than through a hub card
(`:380-384`) — the card path adds hub DOM construction and a settle poll to the measured interval
and reaches the same manager entry point anyway. Then `whenCriticalReady()`, the first-frame fence,
the compile-quiet loop, the quiesce fence, a 4,000 ms settle, and only then
`window.__THEME_PERF_RESET__()` (`:479`) — which **discards the compile window from the idle rings**,
because a cold compile is a real cost but a startup cost, and averaging it into steady state hides
both.

**What is pinned, and that the pin is observed rather than assumed.** `buildPinSource`
(`:561-588`) sets `effectQuality`/`graphicsQuality` = `High`, `targetFrameRate` = 60, and
`adaptiveResolution`/`dynamicResolution` = false, then installs `window.__THEME_PERF_PINS__()`
returning `{quality, targetFrameRate, devicePixelRatio, rendererPixelRatio}`. The visit samples it
at both ends of the idle window (`:486`, `:488`) and `pinsBrokenReason` (`:776-787`) names the pin
that moved. Observed values: `rendererPixelRatio` 1.0 on 45 cells, `null` on the 9 themes with no
three renderer, and seven themes that run their own sub-unity scaler —
`chromadelic-highway` 0.68, `ice-temple` 0.60, `lunara` 0.62, `sky-children` 0.99,
`stellar-drift` 0.7135, `stellar-velocity` 0.7394 (all stable across the window), and `neon-dusk`
0.85 → 0.80 (not stable; see §3). A stable sub-unity ratio is a property of the theme, recorded and
admissible; a *moving* one voids the timing.

**The content guard.** `contentMismatch` (`:762-774`) is the verbatim rule from
`odyssey-gpu-split.mjs`: draw calls must match **exactly** and triangles within 2 %. It is applied
between visit 1 and visit 2 in `buildThemePerfCell` (`theme-perf-cell.mjs:90-118`). A guard that
passes on 0 draws vs 0 draws is not a guard, so 0 draws voids it with a reason rather than passing.
27 of 61 cells matched exactly. 34 voided, in two classes: 9 themes own no three renderer at all
(`"theme owns no three renderer — nothing to content-match"`) and 25 have a draw count that varies
with time — `ocean` 393 vs 389, `ice-temple` 341 vs 344, `bioluminescence` 227 vs 224,
`golden-forest` 1101 vs 1171, `neon-district` 1856 vs 1617, down to `waves` 18 vs 2. Two structural
reasons for those, both honest: visit 2's idle window is 4,000 ms against visit 1's 10,000 ms, so a
different slice of an animation is sampled; and several themes stream content in lazily. A mismatch
**voids the differential only** and leaves the single-visit timings standing (`:107-115`) — switch
wall clock and pipeline compiles never depended on visit 2.

**The drift figure.** `drift.visitGpuP50DeltaMs` / `visitWallP95DeltaMs` are `|visit2 − visit1|`,
published only where the content matched. Across the 36 cells with an admissible differential the
worst GPU p50 drift is **0.197 ms** (three GPU quanta) and the worst wall p95 drift is **7.4 ms**.
Where content did not match, both fields are `null` beside a `voidReason` naming the mismatch.

**Every page-side await is bounded.** `bounded()` (`:363-366`) races each promise against a sleep;
`stage()` (`:368`) writes progress to `window.__THEME_PERF_STAGE__`, which the worker reads back
after any timeout (`capture:1684-1694`) so a hang reports *where* it hung. The caps: `switchTheme`
120 s, `whenCriticalReady` 60 s, first-frame fence 60 s, quiesce fence 30 s, compile-quiet loop
90 s, and the worker's own backstop `idleMs + settleMs + 200_000`. The reason is recorded in the
source itself: an unbounded page-side await cannot fail — it hangs until the orchestrator kills the
worker, which loses the whole report. That is exactly how the first smoke run was lost (§4a).

### 2. What each timing field brackets

All marks are relative to `t0_requested`, taken immediately before `switchTheme` is called.

| Field | Ends at | What is inside it |
| --- | --- | --- |
| `switchWallMs` | `t4_startResolved` — the `switchTheme()` promise resolved | Scene construction and whatever the theme awaits before resolving. Nothing GPU-fenced. |
| `criticalReadyMs` | `t5`, after `theme.whenCriticalReady()` | Theme's own readiness contract, where it has one. |
| `firstRenderCallMs` | `t6`, first wrapped `render`/`renderAsync` entry | |
| **`firstFrameGpuDoneMs`** | `t6b_firstFrameGpuDone` — a GPU fence taken **immediately after the first render call, before the compile-quiet loop** (`:404-429`) | switch + the first frame's GPU work. **No wait of the lane's own.** This is the player-facing latency and the field the ranking uses. |
| `allQuiescedGpuDoneMs` | `t7_firstGpuWorkDone` — a second fence **after** the compile-quiet loop (`:432-468`) | switch + time until pipeline creation stops + **a 2,000–2,100 ms quiet wait by construction** + GPU drain. Answers "when did this theme stop creating pipelines and finish them". **Not a latency.** |
| `firstFrameRafMs` | `t8`, first rAF after `t7` | |

The compile-quiet loop polls `S.pipes.length` every 100 ms and breaks only once 2,000 ms have
elapsed with no new pipeline (`:432-439`), capped at 90 s. Every cell carries `quietWaitFloorMs:
2000` beside the field (`:690`) so the floor never has to be rediscovered. The floor is directly
visible in the data: `allQuiescedGpuDoneMs − firstFrameGpuDoneMs` ranges **2,002.3 ms → 7,715.2 ms**
across 61 cells, median **2,088.3 ms**. The cleanest demonstration is a theme that creates no
pipeline at all — `forest`, a 24.3 ms switch, reports `allQuiescedGpuDoneMs: 2104.3`. Quoting that
as a latency would charge the theme 2.1 s of the lane's own waiting.

**Neither field is scanout.** Both are GPU-work-completion fences: `queue.onSubmittedWorkDone()` on
a WebGPU backend, `fenceSync` + polled `clientWaitSync` on a classic renderer. A page cannot observe
presentation, and the cell says so in `notes[0]` (`theme-perf-cell.mjs:17`). Compositing, the
present queue and the panel's own scanout are all downstream and unmeasured.

**The fence method is recorded per cell, and it changes what the field means.** Across the run:
`queue.onSubmittedWorkDone` on 32 cells, `fenceSync` on 20, and **`no-gpu-context` on 9**. For those
nine (the themes that own no three renderer — `aether-tides`, `chromatic-impasto`, `cosmic-chimes`,
`forest`, `moonlit-greenhouse`, `mountain`, `nebula-flow`, `void-ember`, `voltage-storm`) the probe
found nothing to fence and the mark was taken immediately, so `firstFrameGpuDoneMs` lands within
0.2 ms of `switchWallMs` (`forest` 24.3/24.3, `aether-tides` 241.3/241.3). Read those as "the switch
resolved", never as a GPU latency. `firstFrameGpuDoneMethod` is the tell, and it is in every cell.

Two further fields whose names could mislead, documented in the cell's own `notes`:
`pipelines.asyncSumMs` is the **sum** of per-object awaited compiles (r185's
`Renderer._createObjectPipeline` queues work items for sequential execution,
`three/src/renderers/common/Renderer.js:3752-3765`), not a wall-clock; and `pipelines.syncRows`
always carry `ms: null`, because `createRenderPipeline` returns before the GPU compiles and the GPU
process blocks at first draw, so any duration measured around the call is a lie
(`theme-perf-instrument.mjs:100-105`).

### 3. Admissibility

`buildThemePerfCell` (`theme-perf-cell.mjs:39-155`) computes `admissible` as an AND over guards and
names **every** failed guard in `inadmissibleReasons`, so a reader never infers why a cell is
unusable. A `null` never travels alone; it always has a `*Reason` sibling.

A cell is admissible only if all of these hold:

1. Visit 1 produced a payload (`:48-61`).
2. The pins held: `quality`, `targetFrameRate`, `devicePixelRatio` and `rendererPixelRatio` are
   identical at both ends of the window (`:63-64`).
3. At least one wall-frame sample in the idle window (`:66-68`).
4. If `renderer.kind === 'WebGPURenderer'`, at least one **resolved** GPU timestamp sample
   (`:72-76`).
5. No sticky-sampler signature — GPU samples must be fewer than lane frames (`:77-79`). In this run
   samples ran 291–1,198 against up to 1,326 frames; `stickySamplerSuspected` is false in all 61.
6. No **genuine** console error. Errors the lane itself causes are separated, not swallowed:
   arming `trackTimestamp` makes three resolve timestamp queries, and a teardown with a resolve in
   flight loses the buffer, so three logs the rejection from a code path that does not exist without
   the lane (`capture-theme-screenshots.mjs:74, 2038-2062`). This run recorded **0** instrument-
   induced and **0** genuine console errors.
7. A second visit ran (`:116-118`).

**What explicitly does not disqualify a cell.** A classic `THREE.WebGLRenderer` has no timestamp API
in 0.185.1, so its `gpuMs` is null with the reason `classic-webgl-renderer-has-no-timestamp-api` —
a property of the renderer **kind**, not a defect and not debt (ADR-0019, ADR-0008); 20 cells.
A theme that owns no three renderer draws nothing by design; 9 cells, admissible, with the content
guard voided by reason. A theme that owns `Info` (`autoReset = false` and manual resets) is recorded
as `content.infoOwnership: "contested"` — provenance, not fault. And a content mismatch voids the
differential only.

**The three inadmissible cells (58 of 61 admissible):**

| Theme | `inadmissibleReasons` (verbatim) | What it means |
| --- | --- | --- |
| `stillwater` | `no GPU timestamp samples (no-resolved-timestamp-in-window)` | `WebGPURenderer`, `trackTimestampArmed: true`, pins held, 1,310 lane frames — and `idle.gpuMs.samples: 0`. The theme manages timestamps itself; the standing hypothesis is that it consumes the resolve first, leaving `info.render.timestamp` at 0 when the lane reads it. **That is a hypothesis, not a measurement.** Its switch timings are in the cell (`firstFrameGpuDoneMs: 10421`) and are quoted only as measured-but-inadmissible. |
| `stellar-velocity` | `no GPU timestamp samples (no-resolved-timestamp-in-window)` | Same shape: 1,311 frames, 0 samples, pins held (its own stable 0.7394 pixel ratio). Same hypothesis, equally unconfirmed. |
| `neon-dusk` | `pins: rendererPixelRatio moved 0.85 -> 0.7999999999999999 during the window` | Adaptive resolution engaged **despite** the pin source setting `adaptiveResolution: false` and `dynamicResolution: false` (`theme-perf-instrument.mjs:565-566`). Its GPU series is otherwise healthy (664 samples, p50 0.655, p95 0.852 ms) but the two ends of the window are not the same configuration, so the timing is disqualified. That the pin did not hold is itself a finding: this theme's scaler does not read those settings keys. |

### 4. Defect record — five bugs the lane's own measurements caught

Recorded because each was a **class** of error, not a typo, and because the lane's whole claim to be
trusted rests on ADR-0016's first requirement: the instrument is verified.

**(a) A CDP call that hangs forever on a window that has never navigated.** `debugger.sendCommand`
never answers before the first navigation — there is no renderer process to reply — so the lane hung
before it measured anything and died to the orchestrator's worker timeout with no report at all.
Cost: **two silent 13-minute worker-timeout kills** (commit `b4b7c9cc`). The trap was already
documented in this repo: `scripts/odyssey-perf-session.mjs:377-381` works around it by attaching on
`'did-navigate'` — which is too late here, since the bootstrap must be registered before the app's
first script. Fix: `loadURL('about:blank')` first to get a live renderer, then attach and register;
`addScriptToEvaluateOnNewDocument` persists across the navigation that follows
(`capture-theme-screenshots.mjs:1657-1666`). *Class:* an unbounded await in the harness — the one
failure mode that destroys the evidence instead of producing a wrong number. Consequence: every
page-side await is now bounded and stage-labelled, and `perfLog` (`:1669-1673`) puts progress on
stdout so a hang names where it hung.

**(b) The theme manager resolved at the wrong global.** The lane guessed `window.themeManager`. It
is `window.serenityBlocks.themeManager` — which the worker's **own** bootstrap already resolves
correctly at `capture-theme-screenshots.mjs:412`, 1,300 lines above the lane code that got it wrong
(`b4b7c9cc`). *Class:* guessing an API that the same file already had right.

**(c) Info ownership sat behind a guard requiring `renderer.backend`.** `ownInfo` — the wrapped
`info.reset` that tells `countAround` which read is valid — was below a guard reading
`renderer.backend`. A classic `THREE.WebGLRenderer` has no `.backend` at all, so `armWhenReady`
retried for 600 frames and gave up: the reset wrapper was never installed and **the lane never armed
for 20 themes** (`d0140dc4`). It also explains a second symptom nobody had connected — those cells
carried a `null` `timestampUnavailableReason`, because that string is assigned inside the same block
that never ran. Fix: ownership first, backend-specific arming second
(`theme-perf-instrument.mjs:171-194`), pinned by a test asserting `ownInfo` precedes the backend
read.

**(d) The two renderer kinds do not name the draw counter the same thing.** Classic
`WebGLInfo.render` exposes `calls` and has **no** `drawCalls`
(`three/src/renderers/webgl/WebGLInfo.js:10-16`); r185's `common/Info.render` has both
(`three/src/renderers/common/Info.js:67-75`). Reading `drawCalls` returned `undefined`,
`S.frameDraws += undefined` made it `NaN`, and `NaN > 0` is `false` — so the accumulator was never
pushed and **20 cells silently published a null draw count** (`cccafbd9`). Silent precisely because
`NaN` fails a comparison rather than throwing. Fix: `S.drawsOf` reads the field the renderer
actually has (`:268`) and a `Number.isFinite` guard on the accumulate (`:282-283`) stops any future
non-finite read from poisoning it into silence the same way.

(c) and (d) were the second and third attempts at the same field. The first (`4a3c8e0b`) fixed the
*arithmetic* — classic resets `Info` at the top of every `render()`
(`three/src/renderers/WebGLRenderer.js:1702`) so the post value **is** that call's count, while
`WebGPURenderer` resets only from three's own animation loop
(`three/src/renderers/common/Animation.js:75`), which most themes bypass with their own rAF, so
there the delta is correct — without first checking whether the code computing it ran. It did not.

**(e) A mark named `firstFrameGpuComplete` that was taken after the lane's own 2-second wait.** `t7`
is marked *after* the compile-quiet loop, so the field bracketed
`switch + time-until-pipeline-creation-stops + 2,000–2,100 ms + GPU drain` — and it had already been
quoted as "total time to first GPU frame". Every such total carried a ≥2 s floor of the lane's own
waiting. Caught by a reader of `stillwater`'s cell noticing the name could not mean what it said
(`a9677376`). Fixed by splitting into two marks rather than caveating one: `firstFrameGpuDoneMs`
fenced immediately after the first render call, and `allQuiescedGpuDoneMs` honestly named with
`quietWaitFloorMs: 2000` recorded beside it. The relative ranking of the slowest themes survived the
correction; the absolute numbers did not, and neither did the label.

**The lesson, stated plainly.** ADR-0016 requires that anything presented as a number came from an
instrument someone checked. This lane satisfied the *sampling-discipline* half of that from day one:
GPU samples pushed once per resolved query with an epoch guard
(`theme-perf-instrument.mjs:288-303`), because `Info.reset()` clears `drawCalls`/`triangles` but
deliberately not `render.timestamp` (`three/src/renderers/common/Info.js:187-198`) — the exact
dwell-weighted-sampler failure ADR-0016 was written about — plus a sticky-sampler detector and the
65.536 µs quantum carried in every cell. It still shipped five bugs, and the split between them is
the point:

- **(a)–(d) were each settled by evidence already in reach**: one grep of three's source
  (`WebGLInfo.js`, `common/Info.js`, `WebGLRenderer.js:1702`, `common/Animation.js:75`) or one grep
  of this repo's own comments (`odyssey-perf-session.mjs:380`, `capture-theme-screenshots.mjs:412`).
  None needed a GPU, a rerun, or a debate. Each survived to a measurement only because its failure
  was *quiet*: a `NaN` that fails a comparison, a guard that retries and gives up, a CDP call that
  never answers.
- **(e) is ADR-0016's exact failure mode applied to a field name.** The instrument was verified, the
  content guard was verified, the pins were observed — and then a number was published without
  anyone checking what its mark bracketed. Verifying the instrument includes verifying the *label*.
  A mark whose name does not match its endpoints is how a wrong number gets quoted as fact.

The operational residue is in the data shape, not in prose: nulls carry reasons, `quietWaitFloorMs`
ships inside every cell, `firstFrameGpuDoneMethod` says how the fence was taken, and
`tests/unit/theme-perf-instrument.test.js` pins 34 of these behaviours — including
"fences for the first frame BEFORE the compile-quiet wait", "reads the counter field each renderer
kind actually exposes", and "owns Info before the backend guard, so a classic renderer is not
skipped".

### 5. What is not measured, and what another pass would need

- **Per-pass GPU split — unmeasured.** `idle.gpuMs` is one timestamp per resolved `'render'` query:
  a whole-frame figure. Nothing in these cells separates scene from post-processing, bloom, or any
  individual pass. `renderer.usesMrtScenePass` is *recorded* per cell
  (`theme-perf-instrument.mjs:550`) but never costed. The Odyssey lane's per-pass technique
  (`scripts/odyssey-gpu-split.mjs`) has not been pointed at themes; doing so is a separate pass with
  its own content guard.
- **Lane B — unmeasured, by construction of this run.** `force_high_performance_gpu` is appended
  whenever the lane is enabled (`capture-theme-screenshots.mjs:105`), specifically because without
  it Electron lands on this machine's integrated part. The per-cell adapter probe returned the same
  NVIDIA/ampere RTX 3070 Laptop GPU in **all 61** cells, so this sweep says nothing whatsoever about
  the integrated adapter — where the CPU-submit breaches and the sync-pipeline stalls would both be
  expected to look different. The theme lane has **no `--low-power` switch at all** (neither
  `capture-theme-screenshots.mjs` nor `validate-all-themes.mjs` contains one), so Lane B needs a new
  flag plus a full rerun, not a re-read.
- **Cold vs warm Dawn cache — only the cold half exists.** Each worker got its own userData
  directory, stamped in every manifest as `dawnCache: "cold-per-theme-userdata"`. That is exactly
  what makes the 61 compile figures comparable *with each other*, and it also means every one of
  them is a first-ever compile. What a player gets on a second launch — a warm Dawn cache — is
  unmeasured, and the sync-pipeline finding in particular could land very differently there.
- **Repeat switching within a process — unmeasured.** Visit 2 exists for the content guard and the
  drift bound and runs a shorter (4,000 ms) idle window; it is never averaged with visit 1 and is
  not a "warm switch" measurement.
- **A manifest gap worth closing:** `idleMs`, `quality` and `targetFps` are stamped in every cell's
  manifest, but `settleMs` is not — it is the lane default of 4,000 ms
  (`validate-all-themes.mjs:68-76`) and has to be read from the source rather than the data.

## 11. The fleet-wide levers, measured

Stage 1 (§6 as it stood) was a static census: counts and structure, never milliseconds. This section
replaces it with the measured run. Everything below is quoted from `reports/theme-perf/<theme>.json`
or from a file:line that was read. Where a number does not exist, it says **unmeasured**.

**The run.** 61 cells, **58 admissible, 3 inadmissible** (kept and marked — `AGGREGATE.md:3`).
**One adapter across all 61**: `adapter.plain = {vendor:"nvidia", architecture:"ampere"}`,
`adapter.webglRendererString = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x000024DD)…)"`.
Every cell carries the same pins: `quality "High"`, `targetFps 60`, `windowPx 1920×1080`,
`idleMs 10000`, `dawnCache "cold-per-theme-userdata"`, and
`manifest.requestedSwitches` containing `force_high_performance_gpu`.

> **`perf-budgets.json:39` is now stale and should be corrected.** Its `heavyThemeWorstNote` warns
> "the theme harness passes no `force_high_performance_gpu`, so it lands on this machine's Radeon
> Vega 8 (Lane B)". It does pass it, and all 61 cells landed on the RTX 3070. **This is a Lane A
> run.** Plan item 4.0 (recover Lane B) is untouched by it — fill cost is still unpriced.

**Read these three metric names exactly; one of them was corrected late.**

| field | what it brackets |
|---|---|
| `switchWallMs` | `switchTheme()` requested → its promise resolved |
| `firstFrameGpuDoneMs` | GPU work for the **first frame** finished (`queue.onSubmittedWorkDone` / `fenceSync`, `theme-perf-instrument.mjs:405-429`). **This is the player-facing latency.** |
| `allQuiescedGpuDoneMs` | includes a **2,000–2,100 ms compile-quiet wait by construction** (`:432-438`; `quietWaitFloorMs` is recorded in every cell). **Never quote it as a latency.** |

"**after**" below always means `firstFrameGpuDoneMs − switchWallMs` — the stall a player sees *after*
the switch has already reported success. `criticalReadyMs − switchWallMs` is ≤ 0.1 ms in every cell,
so that gap is not theme JS finishing: it is the GPU fence.

---

### 11.1 (plan 3.1) — 1,457 of the fleet's 1,703 render pipelines are created **synchronously**. This is the whole phase.

Plan 3.1 was written as a fix for 20 bad call sites. The measurement says it is bigger and simpler
than that: **most of the fleet warms nothing at all.**

Fleet totals across the 61 cells: **1,703 render pipelines, 1,457 synchronous (85.6 %), 246
asynchronous, 0 failed.** Only **12 themes** reach `createRenderPipelineAsync` even once. **21 cells
create GPU render pipelines and not one of them asynchronously.**

**The mechanism, verified in the pinned source.** `Renderer._compilationPromises` is `null` by
default (`Renderer.js:662`) and is set to an array in exactly one place — inside `compileAsync`
(`Renderer.js:884`, assigned `:921`). `_createObjectPipeline` only queues work when it is non-null
(`:3751-3755`) and hands it to `this._pipelines.getForRender(renderObject, this._compilationPromises)`
(`:3785`). The backend then branches on that one argument:

```
WebGPUPipelineUtils.js:261   if ( promises === null ) {
WebGPUPipelineUtils.js:263       pipelineData.pipeline = device.createRenderPipeline( … );   // ms: null
WebGPUPipelineUtils.js:292       pipelinePromise = device.createRenderPipelineAsync( … );   // timed
```

So `Renderer.compileAsync` is the **only** path in 0.185.1 that reaches the async entry point. A
theme that never calls it creates every pipeline through `:263`, where the call returns immediately
and the GPU process blocks at first draw. The instrument records this honestly rather than guessing:
`pipelines.syncRows` always carry `ms: null` (`theme-perf-instrument.mjs:103`, and the note in every
cell). **A sync pipeline's cost is not zero — it is unattributable per pipeline, and it lands
whole in the after-gap.**

**The measured proof is the after-gap.** Every zero-async cell that creates pipelines, ranked:

| theme | sync pipes | `switchWallMs` | `firstFrameGpuDoneMs` | **after** | ms per sync pipe |
|---|---:|---:|---:|---:|---:|
| stillwater ✗ | 58 | 716.4 | 10,421.0 | **9,704.6** | 167.3 |
| vesper-chrysalis | 103 | 712.6 | 6,350.1 | **5,637.5** | 54.7 |
| lunara | 73 | 979.3 | 6,173.3 | **5,194.0** | 71.2 |
| fluid-dreams | 14 | 409.1 | 3,807.0 | **3,397.9** | 242.7 |
| bioluminescence-2 | 174 | 496.0 | 3,628.4 | **3,132.4** | 18.0 |
| summer | 121 | 421.4 | 3,543.3 | **3,121.9** | 25.8 |
| starlight | 14 | 379.3 | 3,180.1 | **2,800.8** | 200.1 |
| sky-children | 34 | 602.5 | 2,559.3 | **1,956.8** | 57.6 |
| halcyon-apex | 62 | 751.9 | 2,450.5 | **1,698.6** | 27.4 |
| black-hole | 21 | 357.1 | 1,445.9 | **1,088.8** | 51.8 |
| neon-dusk ✗ | 28 | 573.9 | 1,401.6 | **827.7** | 29.6 |
| electric-dreams-v3 | 11 | 341.2 | 1,121.1 | **779.9** | 70.9 |
| synthwave-sunset | 23 | 377.6 | 1,095.1 | **717.5** | 31.2 |
| astral-weave | 27 | 280.4 | 984.5 | **704.1** | 26.1 |
| himalayan-peak | 14 | 350.5 | 938.9 | **588.4** | 42.0 |
| serenity-warp | 46 | 314.2 | 779.4 | **465.2** | 10.1 |
| winter | 26 | 398.5 | 589.7 | **191.2** | 7.4 |
| shifting-sands | 18 | 258.8 | 404.3 | **145.5** | 8.1 |
| verdant-hills | 6 | 262.7 | 342.7 | **80.0** | 13.3 |
| tornado | 11 | 163.7 | 234.7 | **71.0** | 6.5 |
| void-ember | 7 | 222.5 | 222.6 | **0.1** | 0.0 |

✗ = inadmissible cell (reason in §6.6). void-ember reports `renderer.kind: null` and still creates
7 render pipelines.

**Seven of the ten worst themes by post-switch cost are in that table.** stillwater, vesper-chrysalis,
lunara, fluid-dreams, bioluminescence-2, summer and starlight have **zero** async pipelines between
them, and between them they carry **33.0 s of after-gap**. One root cause, one fix.

Note the last column: the cost is **not** pipeline count. bioluminescence-2 pays 3,132.4 ms for 174
pipelines (18.0 ms each); fluid-dreams pays 3,397.9 ms for **14** (242.7 ms each) and starlight
2,800.8 ms for **14** (200.1 ms each). Counting materials predicts nothing. Only timing the compile
does — which is precisely what the sync path forbids.

**The 12 themes that do call `compileAsync` are exactly the 12 themes with a call site.** Grep of
`src/themes/` + `src/playground/effects/` finds bare whole-scene calls in 14 themes:
`golden-forest-theme.js:965`, `koi-pond-theme.js:461`, `ice-temple-theme.js:1353` and `:1667`,
`neon-district-theme.js:1149`/`:1172`/`:4123`/`:4179`/`:4800`, `ocean-theme.js:1291`/`:1376`,
`stellar-drift-theme.js:2067`, `stellar-velocity-theme.js:2006`, `chiral-gold-theme.js:825`,
`chromadelic-highway-theme.js:1869`, `cosmic-noir-theme.js:1855`, `wolfhour-theme.js:3279`,
`moonlit-forest-theme.js:352`, `black-hole-theme.js:3425`, `stillwater-theme.js:1174`.
The measured async set is those 14 **minus black-hole and stillwater** — the two that guard the call
off. `black-hole-theme.js:3422` takes the `postProcessing.render()` branch instead
(`:3417-3420` explains why: a bare compile on the MRT path yields `targets[1] has no fragment output`
and poisons the cache); `stillwater-theme.js:1172` gates on `if (!usesMrt)` and warms with a real
runtime render. **Both are right about the hazard and both pay for it**: black-hole 21 sync pipes /
1,088.8 ms after, stillwater 58 / 9,704.6 ms. They are the clearest argument in the run that the
answer is not "call compileAsync" but "call it **bound to the target the theme actually renders
into**" — which is the recipe.

**The wasted-context signature.** Themes that call the bare form still create large numbers of sync
pipelines alongside their async ones — ocean 51 async / **76 sync**, neon-district 34 / **180**,
golden-forest 30 / **106**, ice-temple 11 / **28**. That is what the builder-state cache key predicts:
`RenderObject.getMaterialCacheKey` (`RenderObject.js:730`) appends `this.context.id`
(`RenderObject.js:840`), and contexts are keyed by attachment formats, so a canvas-bound compile
builds states the post pass never looks up and the scene pass then rebuilds its own synchronously.
**The one theme where async dominates is the one with a near-zero after-gap:** moonlit-forest,
**29 async / 9 sync, after = 46.0 ms** — the fleet's existence proof. (Its switch is still 2,269.4 ms,
because it uses the bare form; the recipe is what moves that too.) This is a *signature*, not proof;
the discriminating experiment is one bound compile on ocean or golden-forest and a re-count of
`pipelines.syncCount`.

**And it is per switch, forever.** Every cell visits its theme twice in the same process. The second
visit re-creates the **same pipelines**: golden-forest 106 sync / 30 async both times, koi-pond 41/35,
bioluminescence-2 174/174, vesper-chrysalis 103/103, lunara 73/73. `switchWallMs` falls on re-entry
(koi-pond 6,141.6 → 2,621.4; golden-forest 4,017.5 → 2,192.8 — Dawn's shader cache, not three's
pipeline cache), but the pipeline objects are rebuilt every time. **3.1 is not a boot-time saving.
It is paid back on every switch a player ever makes.**

#### What `post-target-compile.js` offers, and what a theme must hand it

`src/rendering/odyssey/warmup/post-target-compile.js` is **782 lines with zero imports** and is
entirely duck-typed — it touches only renderer/target/scene-graph shapes. It is importable from
`src/themes/` as-is; nothing about it is Odyssey-specific.

Three entry points:

- **`compileGroupThroughPost` (`:259`)** — the front door.
  `(renderer, postProcessingStack, scene, camera, group, renderLoopActive = false, options = {})`.
  It computes `postActive = !!postProcessingStack?.scenePass?.renderTarget` (`:269`), binds the
  scene-pass target + MRT and **holds the binding across the entire await**, then restores when the
  last pooled compile resolves. The header (`:15-28`) records why the r181 bind→launch→restore shape
  is unsafe on r185: `compileAsync`'s builds are deferred and each reads the *live* `getMRT()` at
  build time, so restoring early poisons the cache with single-output shaders. With a live render
  loop **and** post active it refuses and returns `false` (`:268-271`) unless `options.live` routes
  it to the live-loop path. Its own comment at `:282-291` carries the argument-order trap:
  `compileAsync(objectToCompile, camera, targetScene)` — **first** arg projected into the render
  list, **third** supplies lights/background. Ten of the fleet's bare sites pass `(scene, camera)`,
  which is the whole-scene walk.
- **`compileObjectsFannedOut` (`:462`)** — the bounded pool underneath it. Traverses the group,
  buckets renderables by material uuid + `receiveShadow` + vertex-attribute signature, gives
  instanced / batched / skinned objects their own bucket (`:485-497`, because three keys builder
  state on the object there), and compiles one representative per bucket at
  `DEFAULT_COMPILE_CONCURRENCY = 6` (`:420`). The comment at `:440-447` is a measured warning in both
  directions: collapsing 40 instanced chunks to one call moved 39 node builds onto the first frames
  (load p99 344 → 2,820 ms); compiling all 50 objects individually cost ~22 ms of overhead per
  cache-hit call. **This is the piece that turns "94 materials" into a handful of real compiles.**
- **`compileGroupUnderLiveLoop` (`:764`)** — for warming after the loop is already running. Binds
  nothing across a yield: the scene-pass binding answers the drained builds' target/MRT *reads*
  through instance accessors (`beginLiveCompileReads:594`, `launchCompileInScenePassPrologue:708`),
  suspended for the synchronous extent of every render.

**What a theme must pass.** Only two things it does not already have:

1. **`scene`, `camera`, and a `group`** — a group is any object with `traverse`; the whole
   `theme.scene` is legal (`:479-482` falls back to a single call when `traverse` is absent).
2. **A post stack exposing `scenePass.renderTarget`** (and, for the live path, `scenePass.getMRT?.()`).
   This is the only real adaptation, and it is naming, not capability: the property is
   `postProcessing` in 29 theme files, `post` in 7, `postComposer` in 2 — the exact set
   `base-theme.js:796-801` already enumerates for disposal. A `BaseTheme.getPostStack()` of ~6 lines
   returning the first of those that is non-null makes every theme callable. **This is the whole of
   the 3.1 adaptation cost.**

---

### 11.2 (plan 3.4) — the theme-manager's own bare whole-scene compile, `theme-manager.js:1362`

```js
// theme-manager.js:1358    // Final compile sweep for stragglers.
// theme-manager.js:1359    if (typeof theme.renderer?.compileAsync === 'function' && theme.scene && theme.camera) {
// theme-manager.js:1362        Promise.resolve(theme.renderer.compileAsync(theme.scene, theme.camera)),
// theme-manager.js:1363        3000,
```

It is the bare whole-scene form — `(scene, camera)`, no third argument, no target bound — fired from
outside the theme, after `postWarmFrames` have already run (`:1348-1356`), i.e. **while the loop is
live and post is active**. That is exactly the case `compileGroupThroughPost` refuses at
`post-target-compile.js:268-271`, for the reason its header documents at `:29-38`: binding a shared
scene-pass target while the loop renders aliases its `output` texture as both sampled binding and
render attachment and permanently poisons the device.

**Measured additions from this run:**

- **The `usesMrtScenePass()` guard the plan asks for would not fire.** `base-theme.js:403` returns
  `false`, and **stillwater is the only theme in the fleet that overrides it**
  (`stillwater-theme.js:1158`). The cell field confirms it: `renderer.usesMrtScenePass` is `true` in
  exactly one of 61 cells and `false` in the other 60 — that `false` is the base-class default, not a
  probe. So `:1362` runs on every MRT theme today, and adding the guard as written would change
  nothing until the themes implement the override. **Both halves have to land.**
- **It overrides the two themes that deliberately opted out.** black-hole (`:3422`) and stillwater
  (`:1172`) skip their own compile on the MRT path with a documented cache-poisoning reason; the
  manager then fires the bare sweep at them from outside.
- **The 3 s race bounds only the wait, and this run shows what outlives it.** neon-district's largest
  single async pipeline is **1,687.9 ms** and its `asyncSumMs` is **2,840.7 ms** — against a
  `firstFrameGpuDoneMs` of **1,712.5 ms**. Since r185 awaits per object, the sum is a lower bound on
  that call's wall time, so **most of neon-district's async compile is still running after the frame
  the player is already looking at**, under a live loop, with the timeout long since expired.
  `Renderer.js:1015-1032` has no cancellation token and retains the renderer plus every object,
  material and geometry in the list.

**Verdict for 3.4: promote it above 3.1's per-theme work, or land it in the same change.** It is an
`S`, it is a single call site, and until it is gone every theme that adopts the bound recipe still
gets an unbound whole-scene sweep fired at it afterwards from the manager.

---

### 11.3 (plan 3.3) — `init()` as a device-free prebuild stage; koi-pond is the sharpest case

koi-pond is the only theme in the fleet whose cost is **inside the switch**:

```
koi-pond   switchWallMs 6,141.6   firstFrameGpuDoneMs 7,168.7   after 1,027.1
           asyncCount 35   asyncSumMs 5,284.2   asyncMaxMs 600.2   syncCount 41
```

**6,141.6 of 7,168.7 ms — 86 % — is paid before `switchTheme()` resolves.** Two things sit in there
and the cell separates them: `asyncSumMs 5,284.2` is the compile at
`koi-pond-theme.js:461` (`await this.renderer.compileAsync?.(this.scene, this.camera)`, inside
`warmRuntime`), and the asset load runs in the same construction path.

The asset half is verified on disk:

- `koi-pond-forest.js:553-556` is one `Promise.all` over three GLB loads:
  `summer_birch_lod.glb` (**27,500 B**), `fir_lod.glb` (**47,832 B**) and
  `landscape-glb.glb` (**11,787,712 B**, imported at `:49`).
- The 11.8 MB one feeds `placeHero(hero, heroTreeCount)` (`:563`), whose count comes from
  `KOI_POND_HERO_LIMITS` — `koi-pond-forest.js:78-85`:
  `Minimal: 0, Low: 0, Medium: 0, High: 0, Ultra: 0, Extreme: 0`. **Zero in all six presets.**
  The two 75 KB trees that *are* placed wait behind it in the same `Promise.all`.

Meanwhile the prebuild stage the plan wants is empty everywhere. The 12 `init()` overrides do no
asset work at all — `lunara-theme.js:452` is literally `async init() { // Lazy creation in
createScene(). }`; `starlight-theme.js:121` and `himalayan-peak-theme.js:115` read quality settings
and return. `base-theme.js:128` is a no-op by design.

**What the measurement adds to 3.3:** the row is right, and it is worth doing on koi-pond *first for
a reason the plan did not have* — koi-pond is the only theme whose player-visible cost is a switch
that has not resolved yet. Everywhere else the cost is a stall after a switch that already reported
success, which 3.2's crossfade can mask. **A switch that has not resolved cannot be masked by
anything.** Deleting the dead 11.8 MB fetch is free and unblocks the two real trees; moving the rest
into `init()` is the row as written.

ocean is the second case and is different in kind: `switchWallMs 2,102.2`, **after 2,398.1** — its
cost is split across both sides (51 async pipelines, `asyncSumMs 2,901.1`, plus 76 sync ones landing
in the after-gap). ocean needs 3.1 **and** 3.3; koi-pond needs 3.3 first.

---

### 11.4 (plan 4.x) — the CPU is the pole, and it is submission, not fill

> **CORRECTED 2026-08-25.** The table below predates the double-counting fix (`71fcf9a9`).
> Read neon-district as **~10.4 ms** (n = 4: 10.5 / 10.7 / 9.9 / 10.5) and golden-forest as
> **4.7–7.9 ms** (n = 4), not 23.3 and 14.3. Point 1 below called this correctly at the time — it
> spotted that `cpuSubmitMs.p95 23.3` beside `wall.p50 7.8` cannot both be one frame, and said to
> treat the figure as a rank rather than a budget comparison. That warning was written into this
> document and then ignored when the number was quoted as a 3.9x breach in the summary and in the
> plan. The conclusion survives — CPU submission is the only budget any theme exceeds, and only
> neon-district exceeds it, by ~1.7x — but the magnitude and the certainty did not.


`perf-budgets.json:32-36` sets `frameP95Ms.split` = `cpuMaxMs: 6`, `gpuMaxMs: 9` ("60hz split; scale
proportionally"). Against that:

| theme | cpuSubmit p50 | **p95** | p99 | max | draws p50 | triangles p50 | gpu p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| neon-district | 20.4 | **23.3** | 25.5 | 77.2 | 1,856 | 253,680 | 1.245 |
| golden-forest | 12.7 | **14.3** | 28.1 | 50.1 | 1,101 | 1,171,716 | 1.507 |
| ice-temple | 5.9 | **6.6** | — | — | 341 | 129,812 | 0.393 |
| summer | 2.6 | 3.0 | — | — | 278 | **2,557,997** | 2.425 |

**neon-district is 3.9× the CPU budget; golden-forest 2.4×.** No other cell exceeds 6.0.

**It is submission cost, and the run proves it rather than asserting it.** Across the 52 cells with
both a CPU sample and a draw count:

- **`r(cpuSubmit p50, drawCalls p50) = 0.960`**
- **`r(cpuSubmit p50, triangles p50) = 0.195`**

Per-draw cost is roughly constant fleet-wide: neon-district 11.0 µs/draw, golden-forest 11.5,
ocean 10.9, bioluminescence-2 9.0, halcyon-apex 8.5, ice-temple 17.3. The two-theme demonstration is
sharper than the correlation: **summer draws 2.56 M triangles in 278 calls for 2.6 ms of CPU;
golden-forest draws 1.17 M triangles in 1,101 calls for 12.7 ms.** Half the geometry, five times the
CPU, four times the draws. Geometry is not what costs.

**What that implies for Phase 4.** Three things, in order:

1. **Plan 4.1 (CPU-profile the idle frame first) is now the load-bearing row, and it is a
   prerequisite for quoting these numbers as budget breaches.** The instrument wraps *every* render
   entry — `renderer`, `post`, `postProcessing`, `postComposer`, `composer`
   (`theme-perf-instrument.mjs:224-240`) — and accumulates `now() − t` around each
   (`:236`). A post stack whose `render()` internally drives `renderer.render()` is therefore counted
   at both levels. The tell is in the same cell: neon-district reports `cpuSubmitMs.p95 23.3` beside
   `wall.p50 7.8` — two numbers that cannot both be one frame's cost. **Treat 23.3 as an upper bound
   and a rank, not a budget comparison.** The ranking and the 0.960 correlation survive the
   double-count (it is a per-theme near-constant factor); the absolute breach does not. `_renderObjectDirect`
   / `Bindings._update` / `writeBuffer` self-time is exactly what 4.1 was written to get.
2. **`frameP95Ms.perSurface."heavy-theme-worst"` still stays null** (`perf-budgets.json:25`). This run
   did not measure a theme's frame p95 — see §6.6. The metric that *should* eventually fill a cell
   here is the **CPU-submit split**, after 4.1 attributes it.
3. **Re-rank the Phase 4 items against the split.** 4.4 (`renderGroup` for shared per-frame uniforms)
   and any draw-call consolidation on neon-district and golden-forest are aimed at the measured pole.
   4.3 (FSR1) and 4.7 (ClusteredLighting for neon-district) are aimed at fill — and neon-district's
   GPU p95 is **1.245 ms**. On this lane there is nothing there to win. Both are Lane B rows and
   should be labelled as such rather than sequenced as if they were general.

---

### 11.5 (plan 4.8 / 5.x) — which "look better" rows this run supports, and which it does not

**The number that governs the whole phase: GPU p95 never exceeds 2.425 ms fleet-wide** (summer; next
are starlight 2.359, serenity-warp and tornado 2.163). The largest single GPU sample in 30 timestamped
cells is **6.357 ms** (tornado, whose p95 is 2.163). Against `gpuMaxMs: 9`, **the fleet uses at most
27 % of its GPU budget on Lane A, and the median theme is far under that.** Timer quantum is
0.065536 ms, so these are real readings, not rounding.

**Supported by the measurement — spend GPU, it is there:**

- **4.2 (gate DRS on GPU time, not wall).** This is the strongest-evidenced row in the run, and the
  evidence is an *inadmissible* cell. neon-dusk broke its pins: `pins.observedAtWindowStart
  .rendererPixelRatio 0.85` → `observedAtWindowEnd 0.7999999999999999`, `pinsHeld: false`. Adaptive
  resolution engaged **mid-window on a theme whose GPU p95 is 0.852 ms** — 10.6× under the split
  budget. The system shed pixels while the GPU was nearly idle, caught in the act. That is 4.2's
  thesis, measured.
- **4.6 (supersample policy on Lane A)** and **5.3 (dispersion/iridescence on lunara, ice-temple,
  fluid-dreams)**: their GPU p95 values are 1.769, 0.393 and 1.442 ms. There is headroom for both.
- **5.1 (shadow softness/bias retune)** — cost 0, and the run gives no reason not to.
- **5.2 (`GodraysNode`)**: sky-children (GPU p95 1.049) and himalayan-peak (1.376) both now produce
  timestamp samples, so the row's own gate — "timestamp cost ≤ 0.6 ms" — is finally measurable per
  theme. Do it in the cell, not by eye.

**Not justified as a *performance* priority by this run:**

- **4.8 (`BloomNode.setResolutionScale` / `PassNode.setResolutionScale`).** Keep it, but reclassify it.
  It is **correctness and hygiene** — themes whose declared quality-preset resolution is silently
  overwritten on the next frame are lying about their tiers, and the `0.5 × bloomDownsample` trap is
  a real bug — but with GPU p95 at 2.425 ms worst, resolution scale buys no frames on Lane A. Its
  frame-time payoff is a **Lane B claim and unmeasured**.
- **4.3, 4.7** — see §6.4. Fill-bound rows on a lane that is not fill-bound.
- **5.6 (classic-WebGL bloom parity).** Unaffected either way: it is a look-correctness row, and this
  run cannot price it at all — all 20 classic cells report `idle.gpuMs` null because
  `THREE.WebGLRenderer` has no timestamp API in 0.185.1 (ADR-0019, ADR-0008; the cell note says so
  explicitly). That null is **renderer kind, not a gap**.
- **4.9 (first-run GPU classifier).** The run is a single hardware point (one adapter, 61 cells), so
  it says nothing for or against it. Unmeasured.

**The honest summary for Phase 5**: nothing in this run argues against making themes look better, and
several rows now have headroom numbers to spend against. What it *does* argue is that no look-better
row should be sold as a frame-time win on Lane A, and that the phase's ordering should not be driven
by GPU cost, because GPU cost is not the constraint here.

---

### 11.6 Negative results, stated as results

**1. There are no lava lakes in the theme fleet.** The Odyssey's Earth Core lava floor took **7,235
ms in one pipeline** (plan §1.2). The fleet's worst single async pipeline is **neon-district 1,687.9
ms** (`AGGREGATE.md` rank 1), then golden-forest 958.6, koi-pond 600.2, ice-temple 583.2, wolfhour
537.1, ocean 408.4, stellar-drift 275.0, moonlit-forest 207.2, chromadelic-highway 136.1, cosmic-noir
122.9, stellar-velocity 97.1, chiral-gold 63.4. **Nothing is within 4× of the lake.** The fleet's
problem is not a shader; it is 1,457 pipelines nobody warmed. *Caveat, stated because it matters:*
those twelve are the only pipelines that could be timed at all. The 1,457 synchronous ones carry
`ms: null` by construction, so "no lava lake" is proven for 246 pipelines and **unmeasured for 1,457**
— it is exactly the compiles the fleet does not warm that the instrument cannot price. Routing 3.1
is also what makes them measurable.

**2. Idle frame time is pacing, not cost.** `idle.wall.p50` is between **7.5 and 8.3 ms in all 61
cells** — 3 at 7.5, 51 at 7.6, and single cells at 7.7/7.8/7.9/8.1/8.3. That is the harness lane's own
rAF cadence against a ~120 Hz panel (`theme-perf-instrument.mjs:309-317`), identical whether the theme
draws 4 objects or 1,856. The p95 excursions to 15.8–15.9 (black-hole, chiral-gold,
chromadelic-highway, neon-district) are single missed ticks, not a frame cost: `wall.overBudget` is
**1 frame of ~1,300** in most themes, 5 of 881 in chiral-gold, and 14 of 1,004 in neon-district.
**No theme's `wall.p95` exceeds the 16.667 ms budget.** Do not read this column as a per-theme frame
time, and do not write it into `heavy-theme-worst` — this run measured the *lane's* cadence and the
*theme's* CPU/GPU split, not the theme's frame p95.

**3. MaterialX noise did not surface as a compile pole anywhere — but say why.** No async pipeline in
the run is attributable to a `mx_*`-heavy theme, because **the noise-heavy themes have no async
pipelines**: winter (30 `mx_*` calls), vesper-chrysalis (29), fluid-dreams (19), stillwater, tornado,
starlight, synthwave-sunset, black-hole all compile 100 % synchronously. The fleet's actual timed
poles are plain node materials — golden-forest's 958.6 ms is a `MeshBasicNodeMaterial`
(`renderPipeline_MeshBasicNodeMaterial_45`), neon-district's 1,687.9 ms likewise
(`renderPipeline_MeshBasicNodeMaterial_16`). And the one direct after-gap reading available for the
worst MaterialX theme is against the row: **winter, 30 `mx_*` calls, cold Dawn cache, after = 191.2 ms
for all 26 of its pipelines.** So: plan **3.5 is not a headline lever and the run gives no reason to
raise it**; the three concentrated cases (`winter-materials.js:753`, vesper-chrysalis `effect:702`,
summer `effect:235`) stay worth doing on their own merits. This is *not* a refutation — MaterialX
compile cost is **unmeasured per pipeline** in 21 themes for the same reason everything else there is.
Land 3.1, then re-read this result.

**4. No pipeline failed and no theme errored.** `pipelines.failedCount` is 0 in all 61 cells;
`console.genuineErrorCount` is 0 in all 61.

**5. GC is not a fleet problem.** Worst `memory.gcPerSecond` is **3.0/s** (solar-eclipse), then geode
2.6, rainy-window 2.2, synthwave-sunset 2.1. Plan 6.5's allocation ranking stands as hygiene; nothing
here promotes it.

**6. The three inadmissible cells, each with its reason — and two of them are findings.**

- **stillwater** and **stellar-velocity**: `"no GPU timestamp samples
  (no-resolved-timestamp-in-window)"`. `renderer.trackTimestampArmed` is `true` in both, so the queries
  were armed and never landed — both themes manage timestamps themselves and most likely consume the
  resolve before the lane's `resolveTimestampsAsync('render')` can read `info.render.timestamp`
  (`theme-perf-instrument.mjs:286-300`). Their switch marks and pipeline census are intact; only the
  GPU column is void. **stillwater's 10,421.0 ms `firstFrameGpuDoneMs` is quoted here as the fleet's
  worst with that flag attached.**
- **neon-dusk**: `"pins: rendererPixelRatio moved 0.85 -> 0.7999999999999999 during the window"`.
  Adaptive resolution engaged mid-measurement. The cell is disqualified **and the disqualification is
  the evidence for plan 4.2** — see §6.5.

**7. Content drift is real and is why 25 cells carry a void.** `drift.admissible` is true in **36 of
61**; `content.contentMatch` in 27. golden-forest's is typical: `"draw calls differ (v1=1101,
v2=1171)"`. Themes with time-varying content cannot be A/B'd across visits without a frozen clock.
Any Stage-3 before/after on 3.1 must pin content, or it will measure weather.
## 12. The 61-row verdict table — measured

> **⚠️ SUPERSEDED IN PART — read §20 instead for `draws` and `tris`.** The `draws` and `tris`
> columns in this table were produced by a draw-counting rule that counted nested render passes at
> every depth, inflating them by roughly 3.5×. §21 records the four rules and why three shipped;
> §20 is the same 61 themes re-measured on the corrected instrument. Every other column here —
> switch marks, pipeline counts, GPU timestamps, heap — is unaffected and stands.

61 cells at [`reports/theme-perf/`](../reports/theme-perf/), **58 admissible**, run serially with one
fresh Electron per theme, **one adapter for the whole run** — `ANGLE (NVIDIA, NVIDIA GeForce RTX 3070
Laptop GPU (0x000024DD) Direct3D11 vs_5_0 ps_5_0, D3D11)`, `requestedPowerPreference:
"high-performance"`. Stage 1's matrix was Lane B on a Vega 8 iGPU and derived from switch logs (§0),
so **absolute milliseconds below are not comparable to §5** — the rankings are.

**The metric.** `first frame ms` is `switchTimings.firstFrameGpuDoneMs`: GPU work for the *first*
frame finished, measured by `queue.onSubmittedWorkDone` on WebGPU and `fenceSync` on classic WebGL.
This is the player-facing latency and it is the sort key. `switch ms` is `switchWallMs`
(`switchTheme()` requested → promise resolved). `after ms` is the difference — the cost that lands
*after* the switch promise has already told the app it is done. **`allQuiescedGpuDoneMs` is not
quoted anywhere in this section**: it includes a 2,000–2,100 ms compile-quiet wait by construction
(`quietWaitFloorMs` is recorded in every cell) and is not a latency.

**Columns.** `kind` is `renderer.kind` — the *three.js* renderer class, so a theme that drives raw
WebGL/WebGPU itself reads `own`. `async/sync` is `pipelines.asyncCount / pipelines.syncCount`;
`worst pipe ms` is `pipelines.asyncMaxMs`. Sync pipelines carry `ms: null` **by construction** —
`createRenderPipeline` returns before the GPU compiles — so a sync-heavy theme's compile cost is
visible only as `after ms`, never as a per-pipeline number. `idle wall p95` / `cpu p95` / `gpu p95`
are `idle.wall.p95`, `idle.cpuSubmitMs.p95`, `idle.gpuMs.p95` over a 10 s window; `draws` is
`content.drawCalls.p50`; `GC/s` is `memory.gcPerSecond`. `—` means the field is legitimately null,
never zero.

| theme | kind | first frame ms | switch ms | after ms | async/sync | worst pipe ms | idle wall p95 | cpu p95 | gpu p95 | draws | GC/s | verdict |
|---|---|---:|---:|---:|:---:|---:|---:|---:|---:|---:|---:|---|
| `stillwater` † | WebGPU | 10,421 | 716 | 9,705 | 0/58 | — | 8.3 | 3.7 | — | 131 | 0.8 | **Fleet worst, by 1.45x.** 0 async / 58 sync: the warm protocol Stage 1 praised warms nothing. |
| `koi-pond` | WebGPU | 7,169 | 6,142 | 1,027 | 35/41 | 600 | 8.2 | 4.1 | 0.721 | 128 | 0.4 | Cost is in the switch (6,142 ms), not after it. 35 async warms held; the asset is the lever. |
| `vesper-chrysalis` | WebGPU | 6,350 | 713 | 5,638 | 0/103 | — | 8.7 | 5.5 | 1.114 | 257 | 0.5 | Second-worst post-switch cost in the fleet. 103 sync pipelines, nothing warmed. |
| `lunara` | WebGPU | 6,173 | 979 | 5,194 | 0/73 | — | 8.3 | 4.7 | 1.769 | 224 | 0.5 | 5,194 ms after switch over 73 sync pipelines. Stage 1 named the mechanism and ranked it 15th. |
| `golden-forest` | WebGPU | 4,553 | 4,018 | 535 | 30/106 | 959 | 8.2 | 14.3 | 1.507 | 1,101 | 0.6 | Real hit, inverted shape: 4,018 ms is the switch itself, only 535 after. 106 sync pipes cost ~5 ms each. |
| `ocean` | WebGPU | 4,500 | 2,102 | 2,398 | 51/76 | 408 | 8.3 | 4.8 | 1.245 | 393 | 0.6 | 51 async pipelines and still 2,398 ms after — the widest warm in the fleet covers under half the cost. |
| `fluid-dreams` | WebGPU | 3,807 | 409 | 3,398 | 0/14 | — | 8.2 | 3.0 | 1.442 | 61 | 1.1 | 243 ms of post-switch cost per sync pipeline — the fleet's steepest. Predicted mechanism exactly. |
| `bioluminescence-2` | WebGPU | 3,628 | 496 | 3,132 | 0/174 | — | 8.2 | 4.9 | 1.180 | 501 | 0.6 | 174 sync pipelines, 0 async: the fleet's largest unwarmed set, at ~18 ms each. |
| `summer` | WebGPU | 3,543 | 421 | 3,122 | 0/121 | — | 8.3 | 3.0 | 2.425 | 278 | 0.4 | 0/121. Also the fleet's worst idle GPU p95 at 2.425 ms — still 3.7x inside the 9 ms split. |
| `ice-temple` | WebGPU | 3,220 | 2,093 | 1,127 | 11/28 | 583 | 8.1 | 6.6 | 0.393 | 341 | 0.5 | Confirmed. 583 ms worst pipe and 6.6 ms CPU p95, over the 6 ms split budget. |
| `starlight` | WebGPU | 3,180 | 379 | 2,801 | 0/14 | — | 8.2 | 2.0 | 2.359 | 37 | 0.7 | 200 ms per sync pipeline over just 14 — second-steepest. Depth, not count. |
| `sky-children` | WebGPU | 2,559 | 603 | 1,957 | 0/34 | — | 8.2 | 4.3 | 1.049 | 212 | 0.6 | 0/34, 1,957 ms after. Zero-async cliff at middling depth. |
| `halcyon-apex` | WebGPU | 2,451 | 752 | 1,699 | 0/62 | — | 8.2 | 4.3 | 0.852 | 461 | 0.3 | 0/62. 461 draws for 25,683 triangles: the cost is compile, not content. |
| `moonlit-forest` | WebGPU | 2,315 | 2,269 | 46 | 29/9 | 207 | 8.2 | 0.7 | 1.573 | 32 | 0.7 | **The fleet's best-shaped curve.** 29 async moved the cost into the switch; 46 ms remains after. |
| `pyrestorm` | WebGL | 2,144 | 2,128 | 16 | — | — | 8.1 | 1.1 | — | 55 | 1.4 | Classic GL, 16 ms after switch, 1.1 ms CPU p95. The predicted frame problem does not exist. |
| `stellar-drift` | WebGPU | 2,004 | 1,719 | 285 | 12/23 | 275 | 8.3 | 4.3 | 1.901 | 164 | 0.5 | 12/23, worst pipe 275 ms. Middling on every measured axis. |
| `neon-district` | WebGPU | 1,713 | 1,103 | 609 | 34/180 | 1,688 | 15.8 | 23.3 | 1.245 | 1,856 | 0.9 | **Fleet's worst single pipeline (1,688 ms) and worst CPU p95 (23.3 ms at 1,856 draws)** — yet 17th on latency. |
| `moonrise-summit` | WebGL | 1,634 | 1,626 | 8 | — | — | 8.2 | 1.0 | — | 34 | 1.0 | Classic GL by design. 8 ms after switch. Clean. |
| `blood-moon` | WebGL | 1,593 | 1,545 | 48 | — | — | 8.2 | 0.9 | — | 44 | 1.3 | 48 ms after switch. Stage 1 called its fragment the batch densest; it never surfaced as latency. |
| `misty-lake` | WebGL | 1,529 | 98 | 1,431 | — | — | 8.2 | 1.2 | — | 68 | 1.2 | 98 ms switch, 1,431 ms after: classic GL links its programs at first draw, not at switch. |
| `bioluminescence` | WebGL | 1,449 | 279 | 1,170 | — | — | 8.2 | 5.7 | — | 227 | 0.6 | Same lazy-link shape: 279 ms switch, 1,170 ms after. 5.7 ms CPU p95 at 227 draws. |
| `black-hole` | WebGPU | 1,446 | 357 | 1,089 | 0/21 | — | 15.9 | 2.9 | 0.459 | 71 | 1.4 | 0/21 — "the fleet's only correct prewarm" produced zero async pipelines. |
| `neon-dusk` † | WebGPU | 1,402 | 574 | 828 | 0/28 | — | 8.2 | 3.5 | 0.852 | 167 | 1.1 | 0/28 confirms the mechanism; the cell is void because adaptive resolution engaged mid-window. |
| `chromadelic-highway` | WebGPU | 1,344 | 1,225 | 119 | 14/27 | 136 | 15.9 | 5.2 | 0.393 | 257 | 1.1 | 14/27, 119 ms after. The 17 duplicate materials cost no measurable latency. |
| `cosmic-noir` | WebGPU | 1,183 | 920 | 262 | 7/18 | 123 | 8.2 | 3.5 | 1.180 | 89 | 1.0 | 7/18, 262 ms after. Row and a verdict, as predicted. |
| `electric-dreams-v3` | WebGPU | 1,121 | 341 | 780 | 0/11 | — | 8.2 | 1.9 | 1.966 | 31 | 1.3 | 11 sync, 780 ms after. Real, but 26th — not "the hit-list theme on compile". |
| `synthwave-sunset` | WebGPU | 1,095 | 378 | 717 | 0/23 | — | 8.3 | 4.5 | 0.655 | 332 | 2.1 | 0/23, 717 ms after. Two narrow levers, no latency story. |
| `wolfhour` | WebGPU | 1,079 | 549 | 529 | 7/18 | 537 | 8.2 | 3.8 | 0.786 | 95 | 0.4 | 7 async, one 537 ms pipe — the per-peak recompile is priced, and it is small. |
| `chiral-gold` | WebGPU | 1,067 | 693 | 374 | 6/17 | 63 | 15.9 | 3.3 | 0.459 | 85 | 1.5 | 6/17. GC 1.5/s and wall p95 15.9 ms, which is pacing against a 120 Hz panel, not cost. |
| `crystal-cave` | WebGL | 1,031 | 1,005 | 27 | — | — | 8.2 | 5.4 | — | 533 | 1.9 | 533 draws confirmed; "worst theme in the batch" refuted at 8.2 ms wall / 5.4 ms CPU. |
| `astral-weave` | WebGPU | 985 | 280 | 704 | 0/27 | — | 8.3 | 5.3 | 1.442 | 362 | 0.4 | 362 draws — 6.4x the 57 Stage 1 counted, and still 8.3 ms wall p95. |
| `sakura-twilight` | WebGL | 968 | 960 | 8 | — | — | 8.2 | 0.5 | — | 22 | 1.1 | 960 ms switch, 8 ms after: the 11.79 MB GLB is real and it lands inside the switch. |
| `himalayan-peak` | WebGPU | 939 | 351 | 588 | 0/14 | — | 8.2 | 3.3 | 1.376 | 59 | 0.7 | 0/14, 588 ms after. The "cleanest fix in the fleet" is worth 0.6 s, not a rank. |
| `stellar-velocity` † | WebGPU | 900 | 762 | 138 | 10/23 | 97 | 8.2 | 5.2 | — | 201 | 1.9 | Self-managed timestamps yielded no resolved samples. GC 1.9/s is not fleet-worst. |
| `rainy-window` | WebGL | 806 | 780 | 26 | — | — | 8.2 | 0.8 | — | 16 | 2.2 | 16 draws, 0.8 ms CPU p95. "The most expensive idle frame by a wide margin" is flatly refuted. |
| `serenity-warp` | WebGPU | 779 | 314 | 465 | 0/46 | — | 8.3 | 2.5 | 2.163 | 71 | 0.4 | 0/46, 465 ms after. "Hit-list candidate number one" lands 36th. |
| `solar-eclipse` | WebGL | 755 | 86 | 668 | — | — | 8.2 | 1.9 | — | 68 | 3.0 | Fleet-worst GC at 3.0/s — which is three collections per second. 86 ms switch. |
| `fall` | WebGL | 716 | 317 | 399 | — | — | 8.2 | 0.8 | — | 23 | 1.1 | 317 ms switch, 399 ms after. The 5.2 MB synchronous bake is inside the switch and it is affordable. |
| `winter` | WebGPU | 590 | 399 | 191 | 0/26 | — | 8.2 | 3.6 | 2.097 | 95 | 0.8 | **Stage-1 #3 measures 39th.** The lake is never built and the compileAsync warms nothing (0/26). |
| `geode` | WebGL | 586 | 571 | 15 | — | — | 8.2 | 2.9 | — | 201 | 2.6 | 201 draws, not 476. 8.2 ms wall p95, 2.9 ms CPU. |
| `cinder-drift` | WebGL | 574 | 566 | 8 | — | — | 8.2 | 0.2 | — | 11 | 1.2 | 11 draws, 2 triangles, 0.2 ms CPU. The leanest cell in the fleet. |
| `sunset` | WebGL | 554 | 520 | 34 | — | — | 8.2 | 1.0 | — | 30 | 1.2 | 1.2 GC/s, 1.0 ms CPU. The 24-Color-per-frame claim costs nothing measurable. |
| `luminous-tides` | WebGL | 503 | 79 | 424 | — | — | 8.2 | 1.2 | — | 29 | 2.1 | 79 ms switch, 424 ms after. Lazy GLSL link again. |
| `singing-bowl` | WebGL | 411 | 400 | 11 | — | — | 8.3 | 1.1 | — | 46 | 1.2 | 400 ms switch, 11 ms after. The Reflector traversal is invisible at 1.1 ms CPU. |
| `waves` | WebGL | 411 | 81 | 330 | — | — | 8.2 | 0.8 | — | 18 | 1.3 | 81 ms switch, 330 ms after. Confirmed clean. |
| `shifting-sands` | WebGPU | 404 | 259 | 146 | 0/18 | — | 8.1 | 3.1 | 1.245 | 83 | 1.0 | 0/18 despite a compileAsync call site. Cheap on every axis regardless. |
| `nimbus-veil` | WebGL | 381 | 372 | 9 | — | — | 8.2 | 0.8 | — | 32 | 1.4 | 32 draws, 0.8 ms CPU. Clean. |
| `verdant-hills` | WebGPU | 343 | 263 | 80 | 0/6 | — | 8.3 | 1.0 | 1.114 | 101 | 1.1 | 101 draws, not 184. 80 ms after switch. |
| `galaxy` | WebGL | 313 | 306 | 7 | — | — | 8.3 | 0.2 | — | 12 | 1.2 | 12 draws, 0.2 ms CPU. Cheapest WebGL cell measured. |
| `aurora` | WebGL | 274 | 267 | 7 | — | — | 8.2 | 0.2 | — | 13 | 1.2 | 13 draws, 0.2 ms CPU. Clean. |
| `supernova` | WebGL | 261 | 206 | 55 | — | — | 8.3 | 0.2 | — | 4 | 1.2 | 4 draws — the least content in the fleet. Confirmed near-clean. |
| `aether-tides` ‡ | own | 241 | 241 | — | — | — | 8.2 | — | — | — | 1.2 | Own renderer: no three instrument. The 43-blit frame claim is unmeasured. |
| `tornado` | WebGPU | 235 | 164 | 71 | 0/11 | — | 8.2 | 3.0 | 2.163 | 47 | 1.8 | 0/11 despite a compileAsync call site. 71 ms after switch. |
| `void-ember` ‡ | own | 223 | 223 | — | 0/7 | — | 8.2 | — | — | — | 1.3 | Owns its renderer yet creates 7 WebGPU pipelines. Latency unmeasurable; frame claims unmeasured. |
| `chromatic-impasto` ‡ | own | 220 | 219 | — | — | — | 8.2 | — | — | — | 1.1 | Own renderer. GC 1.1/s. Frame and GC claims unmeasured by this lane. |
| `nebula-flow` ‡ | own | 213 | 213 | — | — | — | 8.2 | — | — | — | 1.3 | Own renderer. The 29-blit frame claim is unmeasured. |
| `voltage-storm` ‡ | own | 212 | 212 | — | — | — | 8.2 | — | — | — | 1.1 | Own renderer. The 42-blit frame claim is unmeasured. |
| `moonlit-greenhouse` ‡ | own | 94 | 94 | — | — | — | 8.8 | — | — | — | 1.5 | 94 ms end to end. The toDataURL on the switch critical path costs nothing measurable. |
| `cosmic-chimes` ‡ | own | 50 | 50 | — | — | — | 8.2 | — | — | — | 1.2 | Confirmed clean — 50 ms, no renderer, no shaders. |
| `mountain` ‡ | own | 42 | 42 | — | — | — | 8.2 | — | — | — | 1.2 | 42 ms switch. The 59.6 MB canvas-bake claim is refuted as a latency cost. |
| `forest` ‡ | own | 24 | 24 | — | — | — | 8.2 | — | — | — | 1.1 | Anchor theme. Stub confirmed at 24 ms. |

**† Inadmissible (3).** Kept and marked, never dropped — the reason is in each cell's
`inadmissibleReasons`:

- `stillwater` — *"no GPU timestamp samples (no-resolved-timestamp-in-window)"*. The theme manages
  its own timestamp queries and most likely consumes the resolve first. Its switch and first-frame
  numbers stand; its `gpu p95` does not exist. **It is still the fleet's worst first-frame latency.**
- `stellar-velocity` — same reason, same cause.
- `neon-dusk` — *"pins: rendererPixelRatio moved 0.85 -> 0.7999999999999999 during the window"*.
  Adaptive resolution engaged mid-measurement, which disqualifies the timing **and is itself a
  finding**: the theme is dropping render scale at idle on an RTX 3070.

**‡ Own-renderer themes (9).** `renderer.kind` is `null` and
`switchTimings.firstFrameGpuDoneMethod` is `"no-gpu-context"` — the lane has no three.js renderer to
instrument, so `firstFrameGpuDoneMs` falls back to `criticalReadyMs` and is **not** a GPU-completion
measurement. `after ms` is therefore undefined, not zero, and `cpu p95` / `gpu p95` / `draws` are
unmeasured. `void-ember` is the interesting one: it owns its renderer and still creates 7 WebGPU
pipelines, all sync.

**`gpu p95` = `—` on the 20 classic rows is renderer *kind*, not a gap.**
`idle.gpuNullReason: "classic-webgl-renderer-has-no-timestamp-api"` — `THREE.WebGLRenderer` has no
timestamp API in three 0.185.1. Classic is a supported lane (ADR-0008, ADR-0019), never debt.

---

### Stage 1 against the measurement

Stage 1's §9 verdicts were written per 44-agent *batch*; superlatives scoped to "in this batch" are
judged as such below, fleet-scoped claims are judged hard.

#### CONFIRMED

- **`fluid-dreams` — the single best call in Stage 1.** §4 predicted the exact shape: *"there is no
  `compileAsync` anywhere in the theme (0 grep hits), so both compile synchronously on the first
  rendered frame — which is exactly why its measured switch window is only 7 ms and its cost is
  invisible in the committed matrix."* Measured: `asyncCount: 0`, `syncCount: 14`, switch **409 ms**,
  after **3,398 ms**. That is **243 ms of post-switch cost per sync pipeline, the fleet's steepest**.
- **`koi-pond`** — predicted #2, measured #2 (7,169 ms). Its 35 async warms held (`after` only
  1,027 ms); the 6,142 ms is the switch itself, which is where the 11.7 MB GLB lives.
- **`golden-forest`** — predicted #1, measured #5, and the mechanism holds: 30 async pipelines
  summing 2,129 ms inside a 4,018 ms switch, with 106 sync pipelines costing only ~5 ms each after.
- **`ocean` (#7 → #6) and `ice-temple` (#5 → #10)** — both real, both for the predicted reasons.
  `ice-temple` also breaches the CPU split at **6.6 ms** (`perf-budgets.json:33`, `cpuMaxMs: 6`).
- **`neon-district` as the pipeline-COUNT outlier** — 214 pipelines, **180 of them sync**, both
  fleet maxima. §4's "outlier by a factor of two" is correct on count.
- **`moonlit-forest`** — §9 called its one bare `compileAsync` *"the dominant term in this theme's
  first-entry latency."* Measured 29 async / 9 sync, switch 2,269 ms, **after 46 ms**. The warm works
  and it moved the entire cost into the switch. **This is the shape every other WebGPU theme should
  have.**
- **`starlight` is depth, `bioluminescence-2` is count** — exactly as §9 split them. `starlight`:
  14 sync pipelines, 2,801 ms after (200 ms each, second-steepest). `bioluminescence-2`: 174 sync
  pipelines, 3,132 ms after (~18 ms each).
- **Every "zero `compileAsync`" call was right** — `lunara`, `vesper-chrysalis`, `sky-children`,
  `summer`, `serenity-warp`, `himalayan-peak`, `electric-dreams-v3`, `neon-dusk`, `fluid-dreams`,
  `halcyon-apex`, `astral-weave`, `synthwave-sunset`, `starlight` and `verdant-hills` all measure
  `asyncCount: 0`.
- **`sakura-twilight`'s 11.79 MB GLB** — 960 ms switch, 8 ms after. Real, and entirely inside the
  switch.
- **`solar-eclipse` on GC** — fleet-worst at **3.0/s**. And `cinder-drift` as "the leanest theme in
  the batch": 11 draws, 2 triangles, 0.2 ms CPU p95.

#### REFUTED

- **`stillwater`. §9 — *"Row-and-a-verdict, not a hit-list candidate"*, and §4 called it the only
  theme implementing the full warm protocol.** It is the **worst theme in the fleet by a factor of
  1.45** over #2, at 10,421 ms, with **9,705 ms landing after the switch promise resolves**. Its cell
  reads `asyncCount: 0`, `syncCount: 58`. The warm protocol Stage 1 held up as the fleet's model
  produced **zero** async pipelines. Stage 1 read the source, counted a `compileAsync` call site, and
  never asked whether the call did anything.
- **`winter` as #3.** Measured **39th of 61** at 590 ms. The 14-`mx_noise` lake Stage 1 called *"the
  fleet's only concentrated MaterialX lake"* sits behind a query param and was never built, and its
  `compileAsync` produced `asyncCount: 0` over 26 sync pipelines. (Its 3,156 ms **switch-away** stall
  is a different metric that this lane does not measure — see MISSED.)
- **`black-hole` — *"the fleet's only correct prewarm"*.** Measured `asyncCount: 0`, `syncCount: 21`,
  1,089 ms after switch. It warms nothing either.
- **The frame-cost hit list, as a class.** `crystal-cave` (*"the worst theme in the batch"*,
  ~615 draws/frame) measures 533 draws, **8.2 ms wall p95 and 5.4 ms CPU p95** — inside budget.
  `rainy-window` (*"the most expensive idle frame in this batch by a wide margin"*) measures
  **16 draws and 0.8 ms CPU p95**, among the cheapest cells in the fleet. `pyrestorm` (*"hit-list
  candidate on FRAME"*, ~51,000 particle iterations per frame) measures 1.1 ms CPU p95. `sunset`'s
  24-`THREE.Color`-per-frame allocation measures 1.2 GC/s and 1.0 ms CPU.
- **`mountain` and `moonlit-greenhouse` on the asset / critical-path axis.** `mountain` — *"HIT-LIST
  CANDIDATE… ~59.6 MB of Canvas2D backing store… before `createScene()` returns"* — measures a
  **42 ms** switch, second-fastest in the fleet. `moonlit-greenhouse` — *"a synchronous 2048x1080
  `canvas.toDataURL()` PNG encode on the theme-switch critical path"* — measures **94 ms** end to end.
- **Static counts, in both directions.** `geode` 476 materials predicted → **201** draws measured.
  `verdant-hills` 184 → **101**. `halcyon-apex` 91 materials → **62** pipelines. And the other way:
  `astral-weave`'s *"57 idle draw calls against its own declared 30-call budget"* → **362 draws**,
  6.4x the count Stage 1 used to indict it.
- **Batch superlatives that do not survive fleet scope.** `serenity-warp` (*"hit-list candidate
  number one in this batch"*) lands **36th**; `electric-dreams-v3` (*"THE HIT-LIST THEME of this
  batch on compile"*) lands **26th**; `himalayan-peak` (*"HIT-LIST CANDIDATE, and the cleanest one in
  the fleet to fix"*) lands **33rd** — its fix is worth 588 ms, a cheap win, not a rank.
  `stellar-velocity`'s *"worst GC profile in this batch"* measures 1.9/s against `solar-eclipse`'s 3.0.
- **The lava lake, as a fleet-wide frame.** The Odyssey hunt's 7,235 ms single pipeline has **no
  analogue anywhere in 61 themes**. The worst measured single pipeline is `neon-district`'s
  `renderPipeline_MeshBasicNodeMaterial_16` at **1,687.9 ms** (`atMs: 6096.3`), then `golden-forest`
  959, `koi-pond` 600, `ice-temple` 583, `wolfhour` 537, `ocean` 408. **Nothing in the fleet is
  within 4x of the lake.** Stage 1 suspected this in §2 ("the compile *call*, not a shader"); the
  measurement settles it.

#### MISSED ENTIRELY

- **The zero-async cliff — the finding.** Stage 1 has a `bare cA` column in §5 and never ranked by
  it. Measured: **20 of 32 WebGPU themes have `asyncCount: 0`**, and **the seven worst post-switch
  costs in the fleet are all seven of them** — `stillwater` 9,705, `vesper-chrysalis` 5,638,
  `lunara` 5,194, `fluid-dreams` 3,398, `bioluminescence-2` 3,132, `summer` 3,122, `starlight` 2,801.
  The first theme with any async warm is `ocean`, at 2,398. In three 0.185.1 the only path that
  reaches `createRenderPipelineAsync` is `Renderer.compileAsync`, so a theme that never calls it
  warms nothing at all. **One root cause, one fix, 20 themes.**
- **A `compileAsync` call site is not a warm.** Stage 1's §5 lists **18** WebGPU themes with at least
  one bare `compileAsync`. Twelve produced async pipelines. **Six produced zero** — `winter`,
  `stillwater`, `shifting-sands`, `black-hole`, `electric-dreams-v3`, `tornado`. Stage 1 counted call
  sites and inferred warms; the effect had never been measured. This is the same error that made
  `stillwater` look clean and `black-hole` look exemplary.
- **Idle frame time is pacing, not cost — the whole axis is dead.** Worst idle wall p95 fleet-wide is
  **15.9 ms** (`black-hole`, `chromadelic-highway`, `chiral-gold`) and **nothing exceeds 16.67 ms**;
  worst idle GPU p95 is **2.425 ms** (`summer`), 3.7x inside the 9 ms split. Themes sitting near
  16 ms are honouring the 60 Hz target against a 120 Hz panel, not doing more work. Every §9 "frame
  hit-list" verdict was unfalsifiable at this resolution, and none of them survive it.
- **CPU-submit is the real per-frame budget, and Stage 1 never ranked it.** `perf-budgets.json:33`
  sets `split.cpuMaxMs: 6`. Three breaches: **`neon-district` 23.3 ms at 1,856 draws (3.9x over)**,
  **`golden-forest` 14.3 ms at 1,101 draws**, and `ice-temple` 6.6 ms. Stage 1 ranked GC instead —
  an axis whose fleet-wide worst is 3.0 collections per second.
- **Classic WebGL links its programs lazily, after the switch resolves.** Six classic cells spend
  most of their first-frame latency in `after`: `misty-lake` 98 → **1,431**, `bioluminescence`
  279 → **1,170**, `solar-eclipse` 86 → **668**, `luminous-tides` 79 → **424**, `waves` 81 → **330**,
  `fall` 317 → **399**. Stage 1's single `cold` column cannot see this split, so it read these themes
  as fast.
- **Three themes defeat the instrument.** `stillwater` and `stellar-velocity` manage their own
  timestamp queries and produced no resolved samples; `neon-dusk` engaged adaptive resolution
  mid-window. §8 listed what Stage 0 must settle without anticipating that the measurement itself
  would come back with a 3-cell hole — one of them in the fleet's worst theme.
- **Nine themes are outside the instrument entirely.** The `own`-renderer rows have no three.js
  renderer, so `firstFrameGpuDoneMethod` is `"no-gpu-context"` and there is no CPU/GPU split, no draw
  count and no pipeline accounting. Stage 1 nonetheless gave four of them frame-cost verdicts
  denominated in full-screen blits per frame (`aether-tides` 43, `voltage-storm` 42, `nebula-flow`
  29) — all **unmeasured**, then and now. Stage 1's §5 `kind` column also lists `aether-tides`,
  `chromatic-impasto`, `nebula-flow` and `voltage-storm` as `GL`, where the lane records
  `renderer.kind: null` for all four. That is a taxonomy difference, not a contradiction — but it
  means §5's `kind` column cannot be used to decide which themes the WebGPU levers apply to.

---

# PART C — Stage 4: fixes, one theme per session

## 13. stillwater — 10,421 ms → 5,498 ms (−47.2 %)

**Landed 2026-08-24.** Commit `0b15db5d` (change) + this section (evidence).
Cells: [`reports/theme-perf-stillwater-ab/`](../reports/theme-perf-stillwater-ab/) —
`before.json` and `after-1..3.json`, each a fresh Electron with its own cold Dawn cache.

### What was wrong

`warmRuntime` called `compileAsync` only when `usesMrtScenePass()` was **false**
([stillwater-theme.js](../src/themes/stillwater/stillwater-theme.js)). High enables bloom, bloom
sets `useMRT`, so it was always true and **the branch never executed**. `Renderer.compileAsync` is
the only path in 0.185.1 that reaches `device.createRenderPipelineAsync` (`Renderer.js:914`
allocates the promise array; `WebGPUPipelineUtils.js:261/292` chooses sync vs async on whether it is
null), so the theme warmed nothing at all.

The skip was **right about the hazard and wrong about the remedy**. A bare
`compileAsync(scene, camera)` binds no render target, and r185's deferred build loop reads the live
`renderer.getMRT()` per object — so it bakes one-output shaders under an MRT-agnostic key, the
poisoned-cache black screen that `post-target-compile.js:15-27` documents. Refusing it was correct.
`compileGroupThroughPost` is the remedy the theme never reached for: it holds the scene-pass target
and MRT bound across the *whole* await through a refcounted session, and compiles at the scene
pass's own call depth.

### The measurement (n = 3, medians, RTX 3070, cold cache per run)

| field | before | after (×3) | median |
|---|---:|---|---:|
| **`firstFrameGpuDoneMs`** | **10,421** | 5,497 / 5,498 / 5,504 | **5,498** |
| `switchWallMs` | 716 | 3,659 / 3,585 / 3,658 | 3,658 |
| `pipelines.asyncCount` | 0 | 33 / 33 / 33 | 33 |
| `pipelines.syncCount` | 58 | 44 / 43 / 44 | 44 |
| `pipelines.asyncSumMs` | 0 | — | 14,507 |
| `pipelines.asyncMaxMs` | 0 | — | **2,230** |
| `idle.gpuMs.samples` | 0 | 666 / 668 / 668 | 668 |
| `admissible` | **false** | true / true / true | true |

Spread across three runs is **7 ms** on the headline field.

**Read `switchWallMs` rising as the fix working, not regressing.** The compile is now *awaited*
inside the switch, so the promise resolves later — 716 → 3,658 ms — while the first frame arrives
4,923 ms sooner. Before, the canvas was revealed at ~716 ms and then showed its clear colour for
9.7 s. After, it is revealed at ~3.7 s and paints at 5.5 s. Ranking this change on switch wall clock
would call a 47 % win a 5× regression — which is exactly the error that filed the fleet's worst
theme at #13 in Part A.

### Regression guards — all held

`content.drawCalls.p50` 131 → 131. `content.triangles.p50` 328,103 → 328,103.
`content.contentMatch` true. `pipelines.pipelinesAfterFirstFrame` 0 → 0 (nothing compiles
mid-game). `console.errorCount` 0 → 0. `idle.wall.p95` 8.3 → 8.2 ms. `idle.cpuSubmitMs.p95`
3.7 → 4.0 ms.

**ADR-0007:** `node scripts/validate-all-themes.mjs --theme stillwater` → PASS, 0 console errors,
0 pattern failures. Screenshot luminance mean 43.590 vs baseline 43.938 (−0.8 %), range 241.7
identical, variance 700.7 vs 721.6 (−2.9 %) — within frame-to-frame variation for an animated water
surface under an unfrozen clock. No structural change.

### Two things this exposed

**1. stillwater now owns the fleet's worst single pipeline: 2,230 ms.** It was always there; it
compiled synchronously, and a sync pipeline carries `ms: null` by construction, so no instrument
could price it. Making the compile async is what made it *visible*. The fleet's previous worst was
neon-district at 1,688 ms. This does not change the "no lava lakes" conclusion — it is still well
under the Odyssey lake's 7,235 ms — but §11.6 should be read with it.

**2. 44 pipelines still compile synchronously.** Residual `syncRows` shapes are
`rgba16float|1|depth24plus`, `rgba16float|1|null` and `rgba16float,rgba16float|4|depth24plus`.
The first two are the reflector's own target (`ReflectorNode.js:406-431`, built because High sets
`reflectionScale: 0.30`) — a different target *and* a different call depth from the scene pass, so
this fix could not reach them. The third means some MRT-shape objects were not in the compiled
group. Sizing a second pass is the next measured step; do **not** bolt on a second
`compileGroupThroughPost` speculatively, because `beginNestedContextDepth` hard-maps depth 0 → 1
and the reflector renders nested inside the scene pass, so a naive second call would warm the wrong
context id.

### What is not done

Rows 3 (hold the mask across a rendered frame), 4 (reflector compile), 5 (drop 4× MSAA on the
composite quad) and 7 (rewrite the pinned test's rationale) from the Stage-3 plan are untouched.
Row 5 is now *measurable* for the first time, because row 6 unlocked the GPU axis
(`idle.gpuMs.p95` 0.786 ms).


## 14. vesper-chrysalis — 6,350 ms → 3,064 ms (−51.8 %)

**Landed 2026-08-24.** Commit `6f85c8c3` (change) + this section (evidence).
Cells: [`reports/theme-perf-vesper-ab/`](../reports/theme-perf-vesper-ab/).

### What was wrong

Simpler than stillwater and the same root cause: `createScene` built the scene and went straight to
`startAnimationLoop` with **no compile of any kind**. 0 async / 103 sync pipelines, 5,760 ms of GPU
compile landing after the switch promise had already resolved.

Three parts, all required together: the effect exposes `scenePass` on its post object (the recipe
reads `postProcessingStack.scenePass.renderTarget` and `.getMRT()` and nothing else), the runtime
surfaces `getPostStack()`, and `createScene` awaits `compileGroupThroughPost` before starting the
loop — with `renderTarget.samples` pinned to `renderer.samples` first, since `PassNode.setup()` has
not run at warm time and the WebGPU pipeline cache key hashes sample count.

### The measurement (n = 3, medians, RTX 3070, cold cache per run)

| field | before | after ×3 | median |
|---|---:|---|---:|
| **`firstFrameGpuDoneMs`** | **6,350** | 3,068 / 3,025 / 3,064 | **3,064** |
| `switchWallMs` | 713 | 2,240 / 2,253 / 2,228 | 2,240 |
| `pipelines.asyncCount` | 0 | 44 / 44 / 44 | 44 |
| `pipelines.syncCount` | 103 | 62 / 62 / 62 | 62 |
| `pipelines.asyncMaxMs` | 0 | — | 1,263 |

Guards: `drawCalls.p50` 257 → 257, `triangles.p50` 116,109 → 116,109, `contentMatch` true,
`pipelinesAfterFirstFrame` 0 → 0, `console.errorCount` 0 → 0, `idle.gpuMs.p95` 1.114 → 1.114.

**ADR-0007:** PASS, 0 console errors, 0 pattern failures. Luminance mean 33.448 → 33.890 (+1.3 %),
range 241.7 identical, variance 958.9 → 973.4 (+1.5 %) — frame-to-frame variation under an unfrozen
clock, no structural change.

### An instrument caveat this A/B surfaced — read it before trusting any idle-frame delta

`idle.wall.p95` read **8.7 ms before and 15.9 ms after**, which looks like a 2× regression and is
not one. The same *unmodified* code measured **15.9 ms** in the pre-correction fleet sweep:

| run | code | wall p50 | wall p95 | frames / 10 s | GPU p95 |
|---|---|---:|---:|---:|---:|
| pre-correction sweep | unmodified | 8.1 | 15.9 | 919 (~92 fps) | 1.049 |
| A/B before | unmodified | 7.6 | **8.7** | 1,243 (~124 fps) | 1.114 |
| A/B after | modified | 8.1 | 15.9 | 914 (~91 fps) | 1.114 |

GPU p95 is identical across all three. The theme lands in either the ~120 fps or the ~90 fps pacing
bucket depending on the run, and nothing in the change moves it — this is the fleet-wide bimodality
of §11 showing up *within a single theme across runs*. **A single-run `idle.wall.p95` comparison is
therefore not a valid A/B axis on this fleet.** Use `idle.gpuMs.p95` and `idle.cpuSubmitMs.p95`,
which are stable, and treat wall p95 as a pacing observation. The four other themes that sit at
~15.9 (black-hole, chiral-gold, chromadelic-highway, neon-district) should be assumed subject to the
same lottery until someone measures them n≥3.

### What is not done

The reflector sample-count alignment, `forceSinglePass` on the nine additive billboards, the bloom
`setResolutionScale` swap (plan 4.8) and the PMREM light-sphere material collapse are all untouched
and separately measurable. 62 pipelines still compile synchronously, in shapes
`rgba16float|1|depth24plus`, `rgba16float|1|null` and `rgba8unorm-srgb|1|null` — the first two are
the reflector's own target, the same structural residue stillwater has.

**Plan row 3.5 is explicitly rejected for this theme.** It names `waterMat` (10 `mx_noise` over an
8000×8000 plane) but `mx_noise.js` carries `setLayout` throughout, so those are ten *calls to a real
WGSL function*, not ten inlined bodies — structurally the opposite of the layout-less helpers Part A
correctly flagged elsewhere. On the compile axis it is one program of 103; on the frame axis the
theme measures 1.114 ms GPU p95 against a 9 ms budget.

## 15. lunara — 6,173 ms → 3,307 ms (−46.4 %)

**Landed 2026-08-24.** Commit `5125937f` (change) + this section (evidence).
Cells: [`reports/theme-perf-lunara-ab/`](../reports/theme-perf-lunara-ab/).

Third instance of the same root cause and the most clear-cut: `createScene` went straight from
building materials to `startAnimationLoop`, and `compileAsync` appears nowhere in
`src/themes/lunara/` — zero grep hits. lunara already exposed `this.post.scenePass`, so unlike
vesper-chrysalis no plumbing was needed; just the bound compile and the `renderTarget.samples` pin.

| field | before (n=1) | after ×3 | median |
|---|---:|---|---:|
| **`firstFrameGpuDoneMs`** | **6,173** | 3,309 / 3,307 / 3,050 | **3,307** |
| `switchWallMs` | 979 | 3,064 / 3,062 / 2,804 | 3,062 |
| `pipelines.asyncCount` | 0 | 32 / 32 / 32 | 32 |
| `pipelines.syncCount` | 73 | 22 / 22 / 22 | 22 |
| `pipelines.asyncMaxMs` | 0 | — | **2,434** |

Guards: `drawCalls.p50` 224 → 224, `triangles.p50` 189,806 → 189,806, `pipelinesAfterFirstFrame`
0 → 0, `console.errorCount` 0 → 0, `idle.wall.p95` 8.3 → 8.3.
**ADR-0007:** PASS, 0 pattern failures; luminance mean 31.274 → 31.867, range 241.7 → 241.6.

**73 → 22 sync is the best ratio of the three fixes** (stillwater 58 → 44, vesper 103 → 62), because
lunara's unwarmed set was almost entirely scene-pass geometry rather than reflector residue.

### Two honest caveats

**The run-to-run spread here is 259 ms**, against 7 ms for stillwater and 43 ms for vesper. Run 3
came in at 3,050 while runs 1 and 2 agreed at ~3,308. The median is the reported figure; a reader
wanting a tighter bound on this theme needs n > 3.

**`idle.gpuMs.p95` rose 1.769 → 1.901** (after-runs 1.966 / 1.901 / 1.901 — consistent, not noise).
The before cell is **n = 1**, so this is not a demonstrated regression, and 1.9 ms against a 9 ms
`gpuMaxMs` is not actionable either way. It is recorded rather than dismissed because §14 established
that idle-frame fields on this fleet vary run to run and a single-run baseline cannot settle a
small delta in either direction.

### What this exposed

**lunara now owns the fleet's worst single pipeline at 2,434 ms**, taking the title from stillwater's
2,230 (itself taken from neon-district's 1,688). The pattern is consistent: each theme's heaviest
shader was invisible while it compiled synchronously, because a sync pipeline carries `ms: null` by
construction. Warming is what prices them. None of the three is near the Odyssey lake's 7,235 ms, so
"no lava lakes" still stands — but §11.6's worst-pipeline figure should be read as *"worst among
pipelines that were warmed"*, and it moves every time a theme is fixed.

**Material counts in Part A under-count pipelines.** The static census predicted 61 materials for
lunara; the measurement found 73 pipelines. `MeshBasicNodeMaterial` `_25`, `_27`, `_32` and `_35`
each appear **twice** at identical `rgba16float|4|depth24plus` — r185's transparent + `DoubleSide`
two-pass signature (`post-target-compile.js:428-448`). Any Part A material count for a theme with
double-sided transparency is a lower bound.

### What is not done

Plan row 3.3 names lunara specifically for its empty `init()`: the HDR fetch is
`new HDRLoader().loadAsync()`, device-free and therefore legal in a prebuild stage where adjacent
preload could hide it. Also untouched: declaring warmup roots for the hidden reaction particles so
their pipelines warm too. Both separately measurable.

## 16. Four more zero-async themes — two wins, one wash, one regression

**2026-08-24.** Cells: [`reports/theme-perf-batch4-ab/`](../reports/theme-perf-batch4-ab/), n = 3 each.

The bound-compile warm had worked three times in a row. Applied to the next four zero-async themes
it worked twice, did nothing once, and made one theme **63 % worse**. The pattern does not
generalise, and the reason it fails is more useful than the reason it works.

| theme | first frame | switch | after | async/sync | kept? |
|---|---|---|---|---|:--:|
| bioluminescence-2 | 3,628 → **2,273** (−37.3 %) | 496 → 1,308 | 3,132 → **960** | 0/174 → 122/52 | ✅ |
| fluid-dreams | 3,807 → **3,015** (−20.8 %) | 409 → 2,161 | 3,398 → **838** | 0/14 → 5/10 | ✅ |
| starlight | 3,180 → 3,257 (+2.4 %) | 379 → 1,922 | 2,801 → 1,336 | 0/14 → 10/8 | ❌ reverted |
| summer | 3,543 → **5,791** (+63.4 %) | 421 → 2,601 | 3,122 → **3,190** | 0/121 → 10/98 | ❌ reverted |

### Why summer got worse — the fallback is not a free default

summer has **no live post stack**: its TSL pipeline is dead at runtime (Part A found this; the
measurement confirms it). With no `scenePass` to bind, the patch took the unbound
`renderer.compileAsync(scene, camera)` fallback — and that added **2,180 ms to the switch while the
post-switch cost did not move at all** (3,122 → 3,190). It warmed 10 of 121 pipelines and none of
them helped.

That is the waste `compileGroupThroughPost` exists to prevent, seen directly rather than argued
from documentation: builder states keyed to a render context the live path never looks up. The
lesson for the remaining fleet is that **"no post stack" is a reason not to warm, not a reason to
warm differently.** A theme with no bindable target should be left alone until its render path is
understood.

### Why starlight is a wash

It worked, and it cost exactly what it saved: post-switch compile halved (2,801 → 1,336 ms) while
the switch grew 1,543 ms. The +77 ms net sits inside the after-run spread of 70 ms, so this is a
wash rather than a regression. Reverted anyway — a change that adds an await and buys nothing
measurable does not earn its place, and leaving it in would put an unearned entry in the ledger.

### Why the two winners won

Both moved a large post-switch block into the masked switch **and** shrank the total.
bioluminescence-2 warmed **122 of 174** pipelines, the highest count in any fix so far.
fluid-dreams warmed only 5 of 14 — but those five were the scene-pass materials carrying nearly all
the cost, including the 52-step unrolled raymarch Part A identified as the fleet's only
lava-lake-class material, now visible at **1,630 ms** as a real async pipeline. Its remaining nine
are bloom/RTT pipelines built by `RenderPipeline.render()`'s own node graph, which no scene-walking
warm can reach; 5/10 is the success shape there, not a partial one.

**ADR-0007:** both kept themes PASS, 0 console errors, 0 pattern failures.

### Running total for the bound-compile warm

Seven themes attempted, five kept:

| theme | before | after | delta |
|---|---:|---:|---:|
| stillwater | 10,421 | 5,498 | −47.2 % |
| vesper-chrysalis | 6,350 | 3,064 | −51.8 % |
| lunara | 6,173 | 3,307 | −46.4 % |
| bioluminescence-2 | 3,628 | 2,273 | −37.3 % |
| fluid-dreams | 3,807 | 3,015 | −20.8 % |

**Aggregate: 30,379 ms → 17,157 ms across five themes (−43.5 %).**
*(2026-08-25 append: §17's koi-pond makes it six — 37,548 ms → 20,089 ms, the −46.5 % that §19 and
§21 quote. The two totals differ by exactly koi-pond's 7,169 → 2,932; this line is the
reconciliation.)*

## 17. koi-pond — 7,169 ms → 2,932 ms (−59.1 %), and the switch itself got faster

**Landed 2026-08-24.** Commit `c59e4918` (change) + this section (evidence).
Cells: [`reports/theme-perf-koipond-ab/`](../reports/theme-perf-koipond-ab/), n = 3.

The largest percentage win of the campaign, and the only one where `switchWallMs` **fell**.

| field | before | after ×3 | median |
|---|---:|---|---:|
| **`firstFrameGpuDoneMs`** | **7,169** | 2,950 / 2,912 / 2,932 | **2,932** |
| **`switchWallMs`** | **6,142** | 1,883 / 1,833 / 1,874 | **1,874** |
| post-switch (`after`) | 1,027 | 1,068 / 1,079 / 1,058 | 1,068 |
| `pipelines.asyncCount` | 35 | 31 / 31 / 31 | 31 |
| `pipelines.syncCount` | 41 | 41 / 41 / 41 | **41 (unchanged)** |
| `pipelines.asyncSumMs` | 5,284 | 6,992 / 6,797 / 6,887 | **6,887 (higher)** |

Guards: draws 128 → 128, triangles 366,287 → 366,287, `pipelinesAfterFirstFrame` 0,
`idle.gpuMs.p95` 0.720 → 0.720, `idle.wall.p95` 8.2 → 8.2, `peakHeapMB` 56.4 → 56.3.
**ADR-0007:** PASS, 0 console errors, 0 pattern failures.

### The mechanism is serialisation, and the commit message got it wrong

`c59e4918`'s message claims koi-pond "warmed into the wrong context and paid twice". The
measurement does not support that, and the cell says so in three places: **`syncCount` did not move
at all** (41 → 41), **post-switch cost did not move** (1,027 → 1,068 ms), and **`asyncSumMs` went
UP** (5,284 → 6,887 ms). If duplicate work had been eliminated, all three would have fallen.

What actually happened is the whole win, and it is arithmetic:

- **before** — 35 pipelines, 5,284 ms of summed per-object compile, completed in **6,142 ms** of
  wall time. Parallelism ≈ **1.0×**. That is r185's `compileAsync` drain doing exactly what
  `post-target-compile.js:411-417` documents: it awaits `Promise.all(pipelinePromises)` *per
  object*, so one `createRenderPipelineAsync` is in flight at a time and the theme pays the SUM.
- **after** — 31 pipelines, **6,887 ms** of summed compile, completed in **1,874 ms** of wall time.
  Parallelism ≈ **3.7×**. `compileObjectsFannedOut` issues a pool of `DEFAULT_COMPILE_CONCURRENCY`
  = 6 targeted calls (`post-target-compile.js:420`, `:462`).

So the fix did *more* compile work in *less than a third* of the time. The bare call may well also
have been binding the wrong context — that was the plan's diagnosis and it is plausible — but it is
**not what this measurement demonstrates**, and the 41 unchanged sync creations are the evidence
against it. The Stage-3 plan called this correctly: *"there is no lava lake here, only
serialisation."*

### Why this one is different from the other six

Every previous fix moved cost from after the switch into the switch, trading a longer masked wait
for a shorter blank canvas. koi-pond had already paid its compile inside the switch — badly,
serially — so binding it through the fan-out made the switch itself **4,268 ms shorter** with no
trade at all. It is the only unambiguous win in the campaign: nothing got worse to make it happen.

### Still open on this theme

41 pipelines remain synchronous and post-switch cost is untouched at ~1,068 ms — attributed at the
time to "the same reflector/bloom residue seen on stillwater and vesper-chrysalis", **which the cell
refutes** *(correction 2026-08-25: all 41 residual sync rows are the `rgba16float|4|depth24plus`
scene-pass shape, 100 % of them `samples: 4`, while the bound warm ran before `PassNode.setup()` at
the target's default `samples: 1` — the warm compiled real scene pipelines at the wrong sample count
and the live pass recompiled every one. The missing pin is stillwater's `0b15db5d` two-liner; §25
below measures it landing)*. And the 11.79 MB hero GLB is still
fetched: `KOI_POND_HERO_LIMITS` is 0 in all six presets (`koi-pond-forest.js:78-85`, comment
"ships off") and it shares a `Promise.all` with the two real 75 KB tree GLBs. Gating it is worth
doing for heap and tree-arrival latency — **but not for switch time**, which it cannot affect
because `createScene` never awaits that promise.

## 18. Variance: which fields can carry a single-run baseline, and which cannot

**2026-08-25.** Cells: [`reports/theme-perf-cpufix/`](../reports/theme-perf-cpufix/), n = 4 each.

Three separate times a delta was nearly published as a change when it was run-to-run spread
(vesper-chrysalis §14, lunara §15, and golden-forest below). The fleet sweep is **n = 1 by design** —
correct for ranking 61 themes, wrong as a baseline for judging a change. This section records which
fields tolerate that and which do not.

**golden-forest is the fleet's most variable theme.** `firstFrameGpuDoneMs` over four runs of
identical code: **6,155 / 6,882 / 6,316 / 4,548** — a spread of **2,334 ms**, 37 % of the median.
The fleet table's 4,553 sits almost exactly on the lowest of the four. It was never patched, so
nothing is regressed; but any single-run figure for this theme is close to meaningless, and §12's
row for it should be read as "somewhere in 4.5–6.9 s".

By contrast neon-district's `cpuSubmitMs.p95` over four runs is **10.5 / 10.7 / 9.9 / 10.5** — a
spread of 0.8 ms. Same instrument, same protocol, wildly different stability.

| field | stability | safe with n = 1? |
|---|---|:--:|
| `pipelines.asyncCount` / `syncCount` | exact integers, identical across runs | ✅ |
| `content.drawCalls` / `triangles` | identical across runs (the content guard relies on it) | ✅ |
| `idle.gpuMs.p95` | tight; moved 0.13 ms on lunara across a real change | ✅ |
| `idle.cpuSubmitMs.p95` | tight per theme (±0.8 ms on neon-district) | ✅ |
| `switchWallMs` | tight on most, ±260 ms on lunara | ⚠️ n ≥ 3 |
| `firstFrameGpuDoneMs` | 7 ms on stillwater, **2,334 ms on golden-forest** | ❌ n ≥ 3, per theme |
| `idle.wall.p95` | bimodal (§14) — 8.7 vs 15.9 on identical code | ❌ not an A/B axis |

**Rule going forward:** a theme's before-state must be measured n ≥ 3 with the same instrument build
as its after-state. Reusing a fleet-sweep cell as an A/B baseline is only valid for the ✅ rows.

## 19. neon-district, corrected — and a third published claim that was false

**2026-08-25.** Cells: [`reports/theme-perf-nd-baseline/`](../reports/theme-perf-nd-baseline/), n = 3
on the instrument after both nesting fixes (`71fcf9a9` CPU, `93266a30` draws).

| field | published | corrected (n = 3) | |
|---|---:|---|---|
| `content.drawCalls.p50` | 1,856 | **476 / 505 / 503** | 3.7x inflated |
| `content.triangles.p50` | 253,680 | **71.5k / 72.5k / 71.8k** | 3.5x inflated |
| `idle.cpuSubmitMs.p95` | 23.3 | **9.3 / 9.1 / 9.8** | ~1.55x the 6 ms budget |
| `idle.gpuMs.p95` | 1.245 | 1.507 / 1.376 / 1.376 | vs 9 ms — not GPU bound |
| triangles per draw | 137 | **~145** | submission-bound reading intact |

### The false claim

Part B says *"nothing exceeds 16.67 ms wall"*. **neon-district does.** Wall p95 across the three
runs is **22.9 / 23.1 / 23.0 ms**, with **86/740, 97/763 and 98/717 frames over the 60 Hz budget** —
12–14 % of frames missed, p99 ~24 ms, max 38.4 ms, and `longTasks.count` 0 in every run, so this is
steady per-frame cost rather than hitching.

The original claim came from a fleet cell that landed in this theme's *fast* pacing bucket
(wall p50 7.8 ms). All three runs here sit in the slow bucket at p50 ~15 ms. That is §14's
bimodality again — but where §14 concluded "wall p95 is not an A/B axis", this adds a sharper
point: **a single-run wall figure cannot support a fleet-wide negative claim either.** "No theme
exceeds the budget" was true of the sample and false of the theme.

### So neon-district is the fleet's only budget breach, on two axes

CPU submission ~1.55x over, and wall frame time ~1.4x over, at ~500 draws averaging ~145 triangles
each. Both point the same way: submission cost, not fill. GPU p95 never approaches its budget.

### Why the whole fleet is being re-measured

The draw and triangle columns in §12 are inflated for every theme whose post stack re-enters the
renderer — most of the 35 two-owner themes — and the wall-budget claim is now known to be
sample-dependent. Rather than annotate a table people will quote without reading the caveat, all 61
cells are being re-measured on one instrument build. The previous cells are archived, not deleted.

**What does not need re-measuring:** every Stage 4 A/B. Those used draws as an *invariance* guard
(`131 -> 131`), and a constant per-theme inflation factor cancels exactly in that comparison; none
of them read `cpuSubmitMs` or wall p95. The six fixed themes and the −46.5 % aggregate stand.
## 20. The 61-row table — re-measured on the validated instrument

**2026-08-25.** 61 cells, **59 admissible**, one adapter for the whole run
(`ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU, D3D11)`). This supersedes §12, whose draw and
triangle columns were inflated (see §21 for what changed and why). Six themes here carry their
Stage-4 fixes, so their `first frame` values are the improved ones.

`first frame` = `firstFrameGpuDoneMs`, GPU work for the first frame complete — not scanout.
`after` = that minus `switchWallMs`. `a/s` = async/sync pipelines; sync ones carry `ms: null` by
construction. `draws`/`tris` are per-frame medians counted by banking Info at each reset.
`—` means legitimately null, never zero. † marks an inadmissible cell.

| theme | kind | first frame | switch | after | a/s | worst pipe | wall p95 | cpu p95 | gpu p95 | draws | tris | GC/s |
|---|---|---:|---:|---:|:---:|---:|---:|---:|---:|---:|---:|---:|
| `stillwater` | WGPU | 6505 | 4561 | 1944 | 33/44 | 2873 | 8.3 | 3.0 | 0.721 | 60 | 138099 | 0.4 |
| `golden-forest` | WGPU | 5673 | 5123 | 549 | 30/106 | 1054 | 16.1 | 7.0 | 1.507 | 324 | 337897 | 0.8 |
| `ocean` | WGPU | 5447 | 2862 | 2585 | 51/76 | 2640 | 8.3 | 4.0 | 1.114 | 197 | 538752 | 0.5 |
| `lunara` | WGPU | 4118 | 3862 | 256 | 32/22 | 3027 | 8.2 | 2.8 | 1.245 | 75 | 63269 | 0.4 |
| `ice-temple` | WGPU | 3944 | 2634 | 1310 | 11/28 | 670 | 8.4 | 3.8 | 0.328 | 114 | 43271 | 0.4 |
| `summer` | WGPU | 3812 | 453 | 3359 | 0/121 | 0 | 8.2 | 3.2 | 2.294 | 186 | 1705595 | 0.3 |
| `fluid-dreams` | WGPU | 3781 | 2918 | 863 | 5/10 | 2255 | 15.2 | 1.6 | 1.442 | 19 | 20538 | 0.6 |
| `vesper-chrysalis` | WGPU | 3737 | 2840 | 897 | 44/62 | 1580 | 22.3 | 3.9 | 1.245 | 106 | 46447 | 0.4 |
| `koi-pond` | WGPU | 3495 | 2383 | 1112 | 31/41 | 920 | 8.3 | 2.3 | 0.721 | 43 | 122096 | 0.4 |
| `starlight` | WGPU | 3439 | 453 | 2987 | 0/14 | 0 | 8.2 | 1.6 | 2.425 | 19 | 145453 | 0.8 |
| `moonlit-forest` | WGPU | 3064 | 3011 | 53 | 29/9 | 292 | 8.2 | 0.9 | 1.442 | 32 | 23141 | 0.9 |
| `sky-children` | WGPU | 2850 | 771 | 2079 | 0/34 | 0 | 15.2 | 2.2 | 1.049 | 63 | 267087 | 0.5 |
| `bioluminescence-2` | WGPU | 2768 | 1786 | 982 | 122/52 | 379 | 15.6 | 4.3 | 1.180 | 251 | 822333 | 0.4 |
| `halcyon-apex` | WGPU | 2634 | 906 | 1728 | 0/62 | 0 | 8.2 | 4.6 | 0.721 | 308 | 21389 | 0.4 |
| `stellar-drift` | WGPU | 2560 | 2176 | 384 | 12/23 | 322 | 8.3 | 2.2 | 1.835 | 55 | 12175 | 0.4 |
| `pyrestorm` | GL | 2289 | 2270 | 19 | 0/0 | 0 | 8.2 | 0.8 | — | 54 | 44127 | 1.2 |
| `moonrise-summit` | GL | 1732 | 1719 | 13 | 0/0 | 0 | 8.2 | 0.7 | — | 33 | 36912 | 1.2 |
| `chromadelic-highway` | WGPU | 1651 | 1480 | 171 | 14/27 | 153 | 16.3 | 2.3 | 0.459 | 68 | 55750 | 0.9 |
| `blood-moon` | GL | 1649 | 1596 | 54 | 0/0 | 0 | 8.2 | 0.7 | — | 43 | 4546 | 1.2 |
| `misty-lake` | GL | 1612 | 97 | 1515 | 0/0 | 0 | 8.3 | 1.0 | — | 67 | 46502 | 1.2 |
| `bioluminescence` | GL | 1593 | 323 | 1270 | 0/0 | 0 | 8.2 | 4.0 | — | 152 | 111338 | 0.9 |
| `black-hole` | WGPU | 1529 | 379 | 1150 | 0/21 | 0 | 16.4 | 1.5 | 0.393 | 24 | 9457 | 1.4 |
| `neon-dusk` † | WGPU | 1520 | 674 | 846 | 0/28 | 0 | 15.6 | 1.9 | 0.918 | 56 | 562755 | 0.8 |
| `cosmic-noir` | WGPU | 1447 | 1164 | 282 | 7/18 | 169 | 8.3 | 1.9 | 0.590 | 30 | 12271 | 1.1 |
| `astral-weave` | WGPU | 1279 | 285 | 995 | 0/27 | 0 | 8.5 | 3.2 | 1.114 | 121 | 152735 | 0.4 |
| `wolfhour` | WGPU | 1210 | 656 | 554 | 7/18 | 553 | 8.2 | 1.9 | 1.049 | 32 | 386301 | 0.3 |
| `neon-district` | WGPU | 1203 | 644 | 559 | 25/156 | 1738 | 22.9 | 9.1 | 1.376 | 471 | 70295 | 0.6 |
| `electric-dreams-v3` | WGPU | 1174 | 357 | 817 | 0/11 | 0 | 8.3 | 1.5 | 1.901 | 16 | 180181 | 1.3 |
| `synthwave-sunset` | WGPU | 1169 | 424 | 745 | 0/23 | 0 | 15.6 | 2.5 | 0.721 | 111 | 16209 | 2.0 |
| `stellar-velocity` † | WGPU | 1139 | 955 | 184 | 10/23 | 129 | 15.6 | 2.5 | — | 54 | 32626 | 1.6 |
| `chiral-gold` | WGPU | 1138 | 757 | 381 | 6/17 | 70 | 22.5 | 1.5 | 0.524 | 25 | 22 | 1.2 |
| `crystal-cave` | GL | 1104 | 1075 | 29 | 0/0 | 0 | 8.3 | 3.1 | — | 268 | 37464 | 0.8 |
| `sakura-twilight` | GL | 1074 | 1065 | 9 | 0/0 | 0 | 8.2 | 0.7 | — | 22 | 1203834 | 1.0 |
| `himalayan-peak` | WGPU | 1031 | 385 | 646 | 0/14 | 0 | 8.2 | 1.7 | 1.507 | 20 | 115449 | 0.8 |
| `serenity-warp` | WGPU | 896 | 253 | 643 | 0/46 | 0 | 8.3 | 1.9 | 1.573 | 36 | 209801 | 0.3 |
| `rainy-window` | GL | 846 | 816 | 30 | 0/0 | 0 | 8.2 | 0.7 | — | 11 | 2054 | 2.5 |
| `solar-eclipse` | GL | 819 | 83 | 736 | 0/0 | 0 | 8.2 | 1.5 | — | 67 | 6325 | 2.6 |
| `fall` | GL | 793 | 360 | 433 | 0/0 | 0 | 8.2 | 0.6 | — | 22 | 100974 | 1.1 |
| `winter` | WGPU | 655 | 366 | 289 | 0/26 | 0 | 8.2 | 1.8 | 1.901 | 32 | 230151 | 0.8 |
| `geode` | GL | 644 | 624 | 20 | 0/0 | 0 | 8.2 | 2.3 | — | 201 | 10446 | 2.3 |
| `sunset` | GL | 616 | 587 | 29 | 0/0 | 0 | 8.2 | 0.7 | — | 32 | 24356 | 1.2 |
| `cinder-drift` | GL | 583 | 574 | 9 | 0/0 | 0 | 8.2 | 0.2 | — | 11 | 2 | 1.2 |
| `luminous-tides` | GL | 565 | 84 | 481 | 0/0 | 0 | 8.2 | 0.9 | — | 28 | 32804 | 2.0 |
| `singing-bowl` | GL | 492 | 477 | 15 | 0/0 | 0 | 8.2 | 0.7 | — | 35 | 49284 | 1.1 |
| `waves` | GL | 480 | 86 | 394 | 0/0 | 0 | 8.2 | 0.5 | — | 17 | 16400 | 1.0 |
| `shifting-sands` | WGPU | 462 | 258 | 204 | 0/18 | 0 | 15.3 | 1.7 | 1.442 | 28 | 79805 | 1.0 |
| `nimbus-veil` | GL | 428 | 416 | 13 | 0/0 | 0 | 8.2 | 0.6 | — | 31 | 44 | 1.4 |
| `verdant-hills` | WGPU | 379 | 269 | 110 | 0/6 | 0 | 8.2 | 1.5 | 1.311 | 110 | 176729 | 1.1 |
| `aurora` | GL | 351 | 345 | 6 | 0/0 | 0 | 8.2 | 0.3 | — | 13 | 32000 | 1.1 |
| `galaxy` | GL | 346 | 337 | 9 | 0/0 | 0 | 8.2 | 0.3 | — | 12 | 16 | 1.1 |
| `tornado` | WGPU | 280 | 184 | 97 | 0/11 | 0 | 8.2 | 1.6 | 1.966 | 16 | 21773 | 1.9 |
| `supernova` | GL | 269 | 237 | 32 | 0/0 | 0 | 8.2 | 0.2 | — | 4 | 8066 | 1.1 |
| `aether-tides` | none | 247 | 247 | 0 | 0/0 | 0 | 8.2 | — | — | — | — | 1.3 |
| `voltage-storm` | none | 241 | 241 | 0 | 0/0 | 0 | 8.2 | — | — | — | — | 1.4 |
| `nebula-flow` | none | 237 | 237 | 0 | 0/0 | 0 | 8.2 | — | — | — | — | 1.3 |
| `chromatic-impasto` | none | 224 | 224 | 0 | 0/0 | 0 | 8.2 | — | — | — | — | 1.1 |
| `void-ember` | none | 195 | 195 | 0 | 0/7 | 0 | 8.2 | — | — | — | — | 1.5 |
| `moonlit-greenhouse` | none | 99 | 99 | 0 | 0/0 | 0 | 15.3 | — | — | — | — | 1.6 |
| `mountain` | none | 50 | 50 | 0 | 0/0 | 0 | 8.2 | — | — | — | — | 1.2 |
| `cosmic-chimes` | none | 43 | 43 | 0 | 0/0 | 0 | 8.3 | — | — | — | — | 1.2 |
| `forest` | none | 30 | 30 | 0 | 0/0 | 0 | 8.2 | — | — | — | — | 1.0 |

**Inadmissible:**
- `neon-dusk` — pins: rendererPixelRatio moved 0.85 -> 0.7999999999999999 during the window
- `stellar-velocity` — no GPU timestamp samples (no-resolved-timestamp-in-window)

**Budget breaches** (`perf-budgets.json`: wall 16.67 ms at 60 Hz, `split.cpuMaxMs` 6, `gpuMaxMs` 9):

| theme | wall p95 | frames over | cpu p95 | gpu p95 | draws | reading |
|---|---:|---:|---:|---:|---:|---|
| `neon-district` | 22.9 | 80/758 | 9.1 | 1.376 | 471 | **real cost** — measured work fills much of the frame |
| `chiral-gold` | 22.5 | 53/750 | 1.5 | 0.524 | 25 | pacing, not cost — measured work is a small fraction of the frame |
| `vesper-chrysalis` | 22.3 | 50/763 | 3.9 | 1.245 | 106 | pacing, not cost — measured work is a small fraction of the frame |
| `golden-forest` | 16.1 | 16/866 | 7.0 | 1.507 | 324 | **real cost** — measured work fills much of the frame |

Only **neon-district** breaches on both axes with work to match: 9.1 ms of CPU submission and
1.4 ms of GPU inside a 22.9 ms frame, at 471 draws averaging 149 triangles. chiral-gold and
vesper-chrysalis exceed the wall budget while measuring ~2 ms and ~5 ms of work respectively — their
frame time is the 60 Hz target being honoured against a 120 Hz panel (§14), not cost.

## 21. What changed between §12 and §20, and why it took four attempts

§12's draw and triangle columns were wrong. The lane wraps `render`/`renderAsync` on both the
renderer and the theme's post object, and the counting rule was rewritten three times before it was
right for both renderer kinds. The history, on one theme of each kind:

| rule | crystal-cave (classic) | neon-district (WebGPU) | what it got wrong |
|---|---:|---:|---|
| count at every depth (§12) | 533 | 1,856 | every draw counted once per wrapped ancestor |
| outermost only (`93266a30`) | **1** | ~490 ✓ | classic resets Info per `render()`, so the outer value is only the last pass |
| leaf-sum (`f2ce264b`) | 185 | **260** | a call that draws *and* has a child is not a leaf, so its own draws are dropped |
| **bank at reset** (`9ff8da2c`) | **333** ✓ | **471** ✓ | — |

The two middle rules each worked for exactly one renderer kind, which is why both looked right when
checked against a single theme.

**Why banking is the only correct rule.** On a classic renderer a nested `render()` resets Info and
**destroys** whatever the enclosing pass had already drawn. crystal-cave hits this through
`Water.js:330`, which calls `renderer.render(scene, mirrorCamera)` from inside `onBeforeRender` —
mid-pass, after the cave has been drawn. No after-the-fact read can recover those counts. So the
wrapped `info.reset` banks the live counters *before* clearing, and the frame total is
`banked + final − initial`. A WebGPURenderer never banks, so the expression reduces to the outer
delta and the same code is correct for both.

**What let three wrong rules ship.** The unit tests asserted the literal *text* of the
implementation. They failed on every rewrite without catching a defect, and they **passed against
both wrong rules** — confirmation, not verification. They have been replaced by
`tests/unit/theme-perf-nesting.test.js`, which executes the bootstrap against stubs for both
renderer kinds and both nesting shapes, and which fails 3× against the outermost rule and 2× against
leaf-sum. The stub itself had a bug of the same family: it zeroed the counters and *then* called
`info.reset()`, so banking observed zeros — a stub that does not match the API it stands in for will
certify the wrong answer.

**The check that finally worked** was measuring two real themes, one of each kind, with the expected
values written down first. It cost six minutes; each earlier rule went straight to a 75-minute fleet
run, which is where the error was found instead.

**What was never affected:** pipeline counts, switch marks, GPU timestamps, heap, and every Stage-4
A/B. Those used draws as an *invariance* guard (`131 → 131`), where a constant per-theme factor
cancels exactly. The six fixed themes and the −46.5 % aggregate stand unchanged.

## 22. neon-district — the static shadow map was redrawn every frame (459 → 395 draws, −13.9 %)

**Commit `86bcf7ef`.** The fleet's only genuine budget breach (§20) spends 9.1 ms of CPU submission
on ~460 draws per frame. 53 of those draws were a 4096×4096 shadow map being re-rendered every
frame to produce a byte-identical texture.

### The bug

`finalizeStaticShadows()` already existed and already intended exactly this optimisation:

```js
this.renderer.shadowMap.needsUpdate = true;
this.renderer.shadowMap.autoUpdate = false;
```

On the WebGPU path both writes land on a plain object. `Renderer.shadowMap` is only
`{ enabled, transmitted, type }` (`three/src/renderers/common/Renderer.js:703-707`) — it has no
`autoUpdate` and no `needsUpdate`, so assigning them creates two properties nothing reads. The gate
the TSL shadow path actually consults is **`LightShadow.autoUpdate`**
(`three/src/nodes/lighting/ShadowNode.js:855`), which defaults to `true`
(`three/src/lights/LightShadow.js:148`).

This is the ADR-0019 failure mode in its purest form: code that gates on the *renderer object* rather
than on what the renderer kind actually reads. The method was not dead — it ran on every theme load,
returned cleanly, and did nothing.

The fix sets the flag the shadow path reads, per shadow-casting light, and asks for exactly one draw:

```js
this.scene?.traverse((object) => {
    if (!object.isLight || !object.castShadow || !object.shadow) return;
    object.shadow.autoUpdate = false;
    object.shadow.needsUpdate = true;
});
```

The two `renderer.shadowMap` writes are **kept** — the classic WebGL path does read them, and this
theme is reachable on both kinds.

### Why freezing is safe here (checked, not assumed)

A frozen shadow map is only correct if neither the light nor any caster ever moves. Verified by
tracing the call graph rather than by inspection of the render loop:

| requirement | evidence |
|---|---|
| one shadow-casting light | `dirLight`, `setupSceneLighting:8491` — the only `castShadow` light in the theme |
| the light never moves | positioned once at `:8488`; stored as `this.mainShadowLight:8508`, **which is never read anywhere in `src/`** |
| all casters exist before the freeze | the 6 `castShadow = true` sites live in `createSimplifiedTower`, `createComplexTower`, `createStorefront`, `addGroundLevelDetails`, `createHlodClusters`; every one is reached from `createBuildings()` before its last statement, `finalizeStaticShadows()` at `:2095` |
| no caster is streamed in later | `createBuildingFromPool` has exactly **one** call site (`:2060`, inside `createBuildings`), there is no `recycleBuilding`, and `generateBuildingPool` self-guards on `buildingPool.length > 0` |
| casters do not move | the merged meshes set `matrixAutoUpdate = false` + `updateMatrix()` at creation (`:2235-2236`, `:2588-2589`) |
| background content adds no casters | `loadRemainingContentInBackground` creates rain, wires, flying vehicles and ground traffic — none of them sets `castShadow` |

The hazard this leaves behind is recorded in the source: anything added later that sets `castShadow`
must also set `light.shadow.needsUpdate = true`, or its shadow will simply be absent. `ShadowNode`
clears that flag itself once the map is drawn (`ShadowNode.js:869-877`), so a one-shot request is
the whole contract.

### Measured, n=3 admissible per arm

Both arms at `--perf-idle-ms 10000`, matching the protocol of all 61 fleet cells.

| field | before (med, range) | after (med, range) | delta |
|---|---:|---:|---:|
| **draws p50** | **459** (416–476) | **395** (370–411) | **−13.9 %** |
| **cpu submit p95 (ms)** | **9.1** (9.1–9.1) | **8.6** (8.5–8.6) | **−5.5 %** |
| triangles p50 | 71,481 (71,389–71,905) | 70,585 (70,477–70,685) | −1.3 % |
| gpu p95 (ms) | 1.442 (1.442–1.507) | 1.442 (1.245–1.442) | 0.0 % |
| wall p50 (ms) | 15.0 (15.0–15.0) | 14.9 (14.9–15.0) | −0.7 % |
| wall p95 (ms) | 22.9 (22.8–23.0) | 23.1 (22.8–23.2) | +0.9 % |
| frames over 16.67 ms | 11.8 % (11.3–13.4) | 12.8 % (10.2–12.9) | within noise |
| switch wall (ms) | 663.7 (652.5–1209.3) | 674.5 (666.2–1562.5) | within noise |

`cpu submit p95` is the sharp axis: the before arm read **9.1 ms in all three runs** and the after arm
**8.5–8.6**, non-overlapping. `draws p50` carries ±30 of per-run noise from procedural city layout,
and the ranges still separate (min before 416 > max after 411). The −64 draw median is consistent
with the 53-draw shadow pass plus that noise.

**What this did not fix.** Wall p95 did not move. neon-district still misses ~12 % of 60 Hz frames
and remains the fleet's only theme breaching both `frameP95Ms` and `split.cpuMaxMs` (§20). This
removed a whole redundant render pass and bought 0.5 ms; the remaining 8.6 ms sits in the ~395 draws
that are still there — reflector layer mask (~168 draws), grime/debris (~139), storefront signs (~74).
A real win, and a partial one.

### Two method notes, recorded because both cost runs

**The arms were nearly mismatched.** `PERF_LANE_DEFAULTS.idleMs` is 20 000 ms, but every committed
fleet cell was measured at 10 000 ms via an explicit flag. The first after-sweep omitted the flag and
silently ran a 20 s window — same p50, double the samples, and outlier `max` values (828 ms, 852 ms)
that a 10 s window never sees. Caught by reading `idle.windowMs` out of the cells rather than by
trusting that two runs of "the same command" were the same measurement. Those three cells are kept
under `reports/theme-perf-nd-shadow/w20-unmatched/` rather than deleted.

**The after arm voids more often than the before arm, and it is the fix's own fault.** 4 of 7 after-runs
were voided by the pin `rendererPixelRatio moved 1 -> 0.9`; 0 of 3 before-runs were. That 0.9 is the
resolution-tier *startup recommendation* for a 3.6–5.5 MPx display
(`desktop-performance-policy.js:129`), applied asynchronously on a wall-clock schedule from page
load. A faster switch opens the idle window earlier, so the settings pass now lands *inside* the
window instead of before it. Admissibility filtering is therefore not neutral here — but it biases
**against** the fix: the surviving after-cells skew to higher draw counts (411, 395, 370) than the
voided ones (342, 368, 351, 362). The reported −13.9 % is a floor. Raising `--perf-settle-ms` past
the settings pass would remove the confound for future runs; it was not changed mid-measurement.

### ADR-0007

Screenshot captured on an admissible run, `passed=true`, zero genuine console errors: buildings,
wet-road reflections, signage and HUD all render correctly. **A before/after pixel diff is not
available and was not claimed** — the city layout is generated with `Math.random()`
(`generateBuildingPool:2265-2267`), so two runs differ in building placement and signage regardless
of this change. The visual argument rests on the call-graph table above, not on the image.

### Correction: the fleet cell was overwritten with an outlier, and why it stays pre-fix

**Retracted same day.** Commit `64d3cbac` replaced `reports/theme-perf/neon-district.json` with the
after-arm's median cell. That was wrong twice over.

**First, the cell was picked on the wrong axis.** It was selected as the median of the three
admissible after-runs *by `drawCalls.p50`* — the axis the fix targets. On the axes nobody was
looking at, that same cell is the arm's outlier: `switchWallMs` 1562.5 against an arm median of
674.5, and `firstFrameGpuDoneMs` 2294 against the arm's own 1368.8 low. Published against §20's
1202.7, it reads as a **1.9× regression produced by a change that made the theme faster**. Choosing
a representative run requires checking the fields the change was *not* about; a median on one axis
is not a median.

**Second, and more basic: §20 is a single-run snapshot and a later cell does not belong in it.**
All 61 cells carried runId `2026-08-25T10-14-42-798Z`, one adapter, one session — that shared
provenance is exactly what makes the table comparable across themes. The overwrite left 60 cells on
that runId and one on `11-38-09-628Z`. Regenerating `AGGREGATE.{md,json}` would have republished
four tables against a cell from a different run.

The cell is restored to the sweep run (61 cells, one runId; `AGGREGATE.md` and `AGGREGATE.json`
regenerate byte-identical). **The §20 row for neon-district is therefore pre-fix by design.** The
after-fix numbers are the n=3 table above and are not retro-fitted into the fleet snapshot — when
the fleet is next swept end-to-end, the row updates with all the others.

This is the fourth published claim in this document retracted by its own author (§19 records the
first three). The common shape is unchanged: a number was checked on the axis under investigation
and published without checking the axes it was not about.

## 23. moonlit-forest — 2,477 ms → 909 ms (−63.3 %), the fleet's cleanest curve made 3.5x wider

**Commit `a75543fb` (change), this section (evidence). 2026-08-26.** Both arms n=3 admissible, same
instrument build (`8620b5f1`), `--perf-idle-ms 10000`, per-theme cold Dawn cache.

moonlit-forest was row 3.1's counter-example — the theme whose bare `compileAsync` already warmed
the right pipelines (29 async / 9 sync, ~52 ms after-gap, best in the WebGPU fleet). Its whole
remaining cost was r185's per-object await: the cell's `atMs`/`ms` chain showed the timed compiles
strictly serialised, ~2,000 ms of compile in a ~2,300 ms wall (0.86x parallelism, never more than
2 in flight). The fix swaps the bare call for `compileGroupThroughPost` with a **null** post stack —
there is nothing to bind, so the render context is exactly the bare call's, fanned out at
concurrency 6 with the deferred-side-capture fix.

| field | before (med, range) | after (med, range) | delta |
|---|---:|---:|---:|
| **firstFrame (ms)** | **2,476.6** (2,475.5–3,190.1) | **909.3** (898.2–929.8) | **−63.3 %** |
| switchWall (ms) | 2,426.7 (2,423.7–3,129.2) | 860.7 (848.8–877.7) | −64.5 % |
| after-gap (ms) | 51.8 (49.9–60.9) | 49.4 (48.6–52.1) | unchanged |
| async / sync | 29/9 (exact ×3) | 33/1 (exact ×3) | +4 / −8 |
| asyncSum (ms) | 2,002.3 | 2,681.7 | +33.9 % |
| parallelism | 0.86x (0.84–0.87) | 3.53x (3.52–3.65) | 4.1x |
| draws / tris p50 | 32 / 23,141 (exact ×3) | 32 / 23,141 (exact ×3) | 0 |
| cpu p95 / wall p95 (ms) | 0.7 / 8.2 | 0.7 / 8.2 | 0 |

Reading the guards: the after-gap did not move, so no cost was relocated past the switch promise;
draws, triangles, cpu and wall are identical to the digit, so the theme renders the same content at
the same frame cost. `asyncSum` **rose** 34 % — koi-pond's §17 explained why that is the fix
working, not a regression: compiles overlapped under real concurrency each carry their full own
duration, where the serial drain hid queue time inside neighbours. The 9 sync leftovers became
warmed asyncs (29/9 → 33/1): those were the two-pass DoubleSide pipelines the deferred-side-capture
workaround exists for, which the bare call could never warm.

This is now the reference conversion for a no-post theme: **one import, six lines, −1,567 ms**, and
the kill-check margin (delta 1,567 ms vs before-spread 715 ms) is the widest in the campaign.
ADR-0007: the lane's own per-run screenshot + console gate passed on all six runs; the change
touches compile scheduling only, so the rendered image is unchanged by construction.

## 24. ice-temple — 3,414 ms → 1,614 ms (−52.7 %), koi-pond's bug in a second theme

**Commit `35182401` (change), this section (evidence). 2026-08-26.** Both arms n=3 admissible, same
instrument build, `--perf-idle-ms 10000`.

ice-temple's `precompileSceneWithTimeout()` raced a **bare** `compileAsync` against a 3 s budget —
with no target bound, while the live frame draws through `postProcessing.render()` into an
`rgba16float|4|depth24plus` scene pass. That is koi-pond's §17 shape: the warm compiled 11 async
pipelines under a context the live frame partly never looks up, and the first post frame created
**28 more synchronously — 15 of them the scene-pass shape** — behind a ~1,326 ms after-gap. The fix
binds the warm through the post stack (already awaited at the `createScene` call site), pins
`renderTarget.samples`/`texture.type` first (stillwater's `0b15db5d` pin — `PassNode.setup()` has
not run yet), and fans out at concurrency 6. The 3 s timeout race is kept.

| field | before (med, range) | after (med, range) | delta |
|---|---:|---:|---:|
| **firstFrame (ms)** | **3,414.1** (3,387.0–3,511.8) | **1,613.7** (1,594.0–1,629.2) | **−52.7 %** |
| switchWall (ms) | 2,113.1 (2,060.8–2,146.1) | 1,333.0 (1,313.1–1,347.4) | −36.9 % |
| after-gap (ms) | 1,326.2 (1,301.0–1,365.7) | 280.9 (280.7–281.8) | −78.8 % |
| async / sync | 11/28 (exact ×3) | 15/13 (exact ×3) | +4 / −15 |
| asyncSum (ms) | 1,400.0 | 4,061.9 | +190 % |
| parallelism | 0.66x (exact ×3) | 3.03x (2.94–3.06) | 4.6x |
| draws p50 | 114 (112–115) | 110 (109–113) | ranges overlap |
| tris p50 | 43,271 | 43,263 | −0.0 % |
| cpu p95 / wall p95 (ms) | 2.5 / 8.2 | 2.3 / 8.2 | unchanged |

The residue confirms the mechanism rather than merely the outcome: the before-arm's 28 sync rows
included **15 × `rgba16float|4|depth24plus`** (scene pipelines recompiled at the live sample count);
the after-arm has **zero** of that shape — its 13 sync rows are 10 × `rgba16float|1` (the post
graph's own bloom-chain pipelines, which a scene warm cannot reach) plus three singletons.
`asyncSum` nearly tripled because the bind converted work that used to happen twice — once
invisibly async at the wrong key, once sync on the live frame — into once, measured. Both the
switch and the gap got faster: unlike koi-pond (which traded nothing) and stillwater (which traded
switch for gap), ice-temple's fan-out sped up the in-switch compile *and* the bind killed the
post-switch storm.

Unlike stillwater's MRT tier there is no skip branch: this site already ran bare unconditionally,
so a null post stack falling through to an unbound fan-out is today's context, strictly faster.
ADR-0007: lane screenshot + console gates passed on all six runs; compile scheduling and
r185-equivalent target normalisation only (the pin duplicates `PassNode.js:765-767`), so the
rendered image is unchanged by construction.

## 25. koi-pond, part two — the sample pin: 3,024 ms → 2,137 ms (−29.3 %), cumulative −70.2 %

**Commit `e3029aa8` (change), this section (evidence). 2026-08-26.** Both arms n=3 admissible, same
instrument build, `--perf-idle-ms 10000`.

§17's fix bound the warm through the post target but dropped one line of stillwater's `0b15db5d`
recipe: the sample pin. `PassNode.setup()` has not run at warm time, so the scene-pass target still
carried `samples: 1` while the live pass runs at `renderer.samples` (4) — and the WebGPU pipeline
cache key hashes sample count. §17 called the resulting 41-pipeline residue "reflector/bloom",
which the cell refuted (100 % of the sampled rows were the scene-pass shape at `samples: 4`). Two
lines pin `renderTarget.samples` and `texture.type` before the compile.

| field | before (med, range) | after (med, range) | delta |
|---|---:|---:|---:|
| **firstFrame (ms)** | **3,023.8** (2,941.0–3,068.4) | **2,136.6** (2,089.2–2,155.4) | **−29.3 %** |
| switchWall (ms) | 1,947.1 (1,890.3–1,952.0) | 1,748.5 (1,701.4–1,751.6) | −10.2 % |
| after-gap (ms) | 1,076.7 (1,050.7–1,116.4) | 388.1 (387.8–403.8) | −64.0 % |
| async / sync | 31/41 (exact ×3) | 31/**10** (exact ×3) | 0 / −31 |
| asyncSum (ms) | 7,213.7 | 7,012.1 | −2.8 % |
| parallelism | 4.33x | 4.18x | unchanged |
| draws / tris p50 | 43 / 122,096 (exact ×3) | 43 / 122,096 (exact ×3) | 0 |
| cpu / gpu / wall p95 | 1.5 / 0.721 / 8.2 | 1.4 / 0.721 / 8.2 | unchanged |

**The signature is cleanly different from the fan-out fixes, and it is the predicted one.**
moonlit-forest and ice-temple moved `asyncCount` and `asyncSum` (more work warmed, measured under
concurrency); here both are *unchanged* — the pin added no compiles. It made the 31 pipelines the
warm was already building land on the cache key the live pass actually looks up, so the live frame
stopped rebuilding them: sync 41 → 10, and the `samples: 4` scene-shape residue specifically went
41 → 2. The 10 that remain are 7 × `rgba16float|1` post-graph internals (ice-temple's §24 residue
class) plus singletons.

One prediction was wrong and is recorded: the §25 forecast (made in the ranked hit list) expected
`asyncSum` to fall back toward ~5,300 on the theory that the double-compile inflated it. It did not
move (−2.8 %) — the warm-side compiles always cost what they cost; the waste was only ever the
*sync* half. The mechanism proof is the sync-shape elimination, not the async sum.

Cumulative koi-pond: 7,169 ms (§17 baseline) → 2,932 (§17) → **2,137 ms** against this batch's own
n=3 baseline — **−70.2 %** from where the campaign found it, now mid-pack in the fleet.
ADR-0007: lane screenshot + console gates green ×6; the pin duplicates what `PassNode.setup()`
does on the first frame (`PassNode.js:765-767`), so the rendered image is unchanged by construction.

## 26. black-hole — 1,467 ms → 964 ms (−34.3 %), and a trade made visible

**Commit `726654b5` (change), this section (evidence). 2026-08-26.** Both arms n=3 admissible.

black-hole was the fleet's last zero-async WebGPU theme with a real gap: its `prewarmPipelines()`
deliberately warmed by running **one real `postProcessing.render()`**, whose own comment (correctly)
forbids bare `compileAsync` on the MRT path — it predates `compileGroupThroughPost`, which removes
exactly that hazard by binding the scene pass's target and MRT across the compile. The cell showed
the price of the sync warm: 0 async / 21 sync, and since `createRenderPipeline` returns before the
GPU compiles, the switch resolved in ~332 ms while the player paid a **1,111 ms** invisible stall at
the first drawn frame. The fix fans out bound (pin + concurrency 6) and keeps the real render for
the post graph's own pipelines.

| field | before (med, range) | after (med, range) | delta |
|---|---:|---:|---:|
| **firstFrame (ms)** | **1,467.4** (1,442.9–1,516.8) | **964.1** (960.7–984.2) | **−34.3 %** |
| switchWall (ms) | 331.8 (316.4–365.4) | 703.0 (699.1–720.7) | **+111.9 %** |
| after-gap (ms) | 1,111.1 (1,102.0–1,200.4) | 261.6 (261.1–263.5) | −76.5 % |
| async / sync | 0/21 (exact ×3) | 12/9 (exact ×3) | +12 / −12 |
| asyncSum (ms) | 0 | 1,520.6 | — |
| parallelism | — | 2.52x (2.50–2.56) | — |
| draws / tris p50 | 24 / 9,457 (exact ×3) | 24 / 9,457 (exact ×3) | 0 |
| cpu / wall p95 | 0.9 / 15.9 | 1.0 / 15.9 | unchanged |

**The switch got slower, on purpose, and the player got faster.** This is stillwater's §13 trade in
its purest form: the before-arm's 332 ms switch was an artefact of sync pipeline creation — the CPU
call returns instantly and the GPU blocks at the first draw, so the cost was real but unattributed.
The fan-out runs ~600 ms of the same compile *measured, overlapped 2.5x, inside the switch*, and
the first-frame stall drops 850 ms. Anyone comparing `switchWallMs` alone would call this a
regression; `firstFrameGpuDoneMs` is the player-facing number and it fell by a third. The 9
remaining sync rows are the §24 residue class (post-graph internals) plus the two pipelines the
kept render still creates first.

## 27. stellar-drift — 1,992 ms → 1,056 ms (−47.0 %), ice-temple's recipe verbatim

**Commit `3c8ab1e0` (change), this section (evidence). 2026-08-26.** Both arms n=3 admissible.

The same shape as §24 down to the timeout race: a bare `compileAsync` raced against a 3.2 s budget,
unbound, while the theme draws through `postProcessing.render()`. 12 async / 23 sync, with the
serial drain (0.62x parallelism) sitting inside the switch. Bind + pin + fan-out, race kept.

| field | before (med, range) | after (med, range) | delta |
|---|---:|---:|---:|
| **firstFrame (ms)** | **1,991.5** (1,983.8–2,027.6) | **1,055.9** (1,048.8–1,058.8) | **−47.0 %** |
| switchWall (ms) | 1,700.8 (1,694.4–1,735.2) | 980.2 (972.7–981.3) | −42.4 % |
| after-gap (ms) | 290.7 (289.4–292.4) | 76.1 (75.7–77.5) | −73.8 % |
| async / sync | 12/23 (exact ×3) | 13/10 (exact ×3) | +1 / −13 |
| asyncSum (ms) | 1,019.8 | 1,898.6 | +86 % |
| parallelism | 0.62x (0.61–0.62) | 2.41x (2.35–2.41) | 3.9x |
| draws / tris p50 | 55 / 12,175 (exact ×3) | 55 / 12,175 (exact ×3) | 0 |
| cpu / gpu / wall p95 | 1.4 / 2.097 / 8.3 | 1.4 / 2.163 / 8.3 | unchanged |

Nothing traded: switch, gap and first frame all fell together, and the content guards are exact to
the digit across all six runs. The kill-check margin (delta 936 ms vs before-spread 44 ms) is 21x.
ADR-0007 for both sections: lane screenshot + console gates green on all twelve runs; compile
scheduling and the r185-equivalent pin only, rendered image unchanged by construction.

## 28. golden-forest — 4,493 ms → 3,169 ms (−29.5 %), measured through a pinned clock

**Commit `61f2e262` (lane: `--perf-url-params`) + the theme commit before it (change), this section
(evidence). 2026-08-26.** Both arms **n=5** admissible, pinned
`goldenForestFixedDt=16.67&goldenForestSeed=1`, stamped in every cell's manifest.

§18 called golden-forest the fleet's most variable theme — 37 % first-frame spread on identical
code — and it was unmeasurable until the lane could pass determinism flags. The pin collapsed the
spread to **2.3 %** (101 ms over five runs) with draws 304 and triangles 336,745 *exact in all ten
runs*. The theme's gate carried three defects: a dead `webgpuWater` check (only ever assigned null;
its skip branch never ran and had misled two code surveys), an `!useMRT` skip that avoided the warm
exactly where it matters (the hazard it dodged is the one `compileGroupThroughPost` removes), and
the bare unbound call itself while the theme draws through `postComposer`'s scene pass.

| field | before (med, range) | after (med, range) | delta |
|---|---:|---:|---:|
| **firstFrame (ms)** | **4,492.9** (4,454.9–4,555.4) | **3,169.3** (3,160.5–3,208.8) | **−29.5 %** |
| switchWall (ms) | 3,997.5 (3,957.6–4,027.4) | 2,745.2 (2,739.2–2,762.0) | −31.3 % |
| after-gap (ms) | 497.3 (492.8–528.0) | 420.7 (407.3–469.6) | −15.4 % |
| async / sync | 30/106 (exact ×5) | 44/65 (exact ×5) | +14 / −41 |
| asyncSum (ms) | 2,114.0 | 7,254.4 | +243 % |
| parallelism | 0.70x (0.69–0.70) | 2.76x (2.37–2.81) | 3.9x |
| draws / tris p50 | 304 / 336,745 (exact ×10) | — same — | 0 |
| cpu / gpu / wall p95 | 4.2 / 1.507 / 8.3 | 4.3 / 1.573 / 8.2 | unchanged |

The −1,324 ms lands inside the ranked hit list's predicted −1.0 to −1.6 s band. 65 sync pipelines
remain — golden-forest's post graph is the fleet's largest and §24's residue class applies at scale —
so there is a second bite here someday, at diminishing return. Kill-check margin 13x. ADR-0007:
lane gates green ×10; scheduling + the r185-equivalent pin only.

## 29. The fleet, re-measured after the campaign — 95.6 s → 74.6 s of summed first-frame (−22.0 %)

**2026-08-26.** All 61 themes re-swept in ONE run — runId `2026-08-26-fleet-postfix`, one adapter,
one instrument commit, `--perf-idle-ms 10000` — with every campaign fix in the bundle. **61/61
workers passed, 60/61 cells admissible** (neon-dusk's DRS moved its pixel-ratio pin mid-window
again — the same row-4.2 defect §12 caught, still unfixed, still caught). This snapshot **replaces**
`reports/theme-perf/` wholesale under §22's governance rule; §20's run remains in history as the
pre-campaign snapshot.

**Zero GPU-column voids.** stellar-velocity — the only WebGPU theme with no GPU samples in both
earlier runs — reports a full column now; the lane's per-tick `trackTimestamp` re-arm (`8620b5f1`)
closed that defect class fleet-wide, without touching the theme.

| fleet metric (61 themes) | §20 snapshot | this snapshot | delta |
|---|---:|---:|---:|
| summed firstFrameGpuDoneMs | 95,642 ms | 74,617 ms | **−22.0 %** |
| median firstFrameGpuDoneMs | 1,138 ms | 952 ms | −16.3 % |
| worst theme | stillwater 6,505 | stillwater 5,476 | — |

**Attribution discipline.** Snapshot-to-snapshot deltas include machine-day variance: the **49
untouched themes moved −12.6 % median on identical code** (range −54 % to +9 %) — the same class of
day effect §21 measured at +10.5 % in the other direction between the two 08-25 runs. The 12 fixed
themes moved −23.4 % median (−34.2 % summed: 42,377 → 27,890 ms). The per-theme effect claims
therefore live in §13–§17 and §22–§28, whose arms are same-day, protocol-matched, n≥3; this section
claims only the fleet's current state, on one comparable snapshot, with no regression: **no theme
is more than 20 % slower than its §20 cell, and every fixed theme is faster in-fleet**
(moonlit-forest −71.0 %, ice-temple −59.1 %, stellar-drift −59.0 %, golden-forest −45.9 %,
koi-pond −39.1 %, black-hole −36.4 %).

**The remaining top five** are now stillwater 5,476 (its §13 fix stands; what remains is reflector
residue + scale), ocean 4,441 (the live-loop second site, §11's deferred item), **summer 3,534 and
starlight 3,275 — the two reverted themes, holding exactly the cost their reverts predicted** — and
lunara 3,153. The zero-async class is otherwise extinct: 12 of row 3.1's 13 bare-call themes are
converted, and the recipe held on every shape it met.

## 30. stillwater, second attempt — reverted, and three mechanism findings worth the runs

**Attempted and reverted 2026-08-26** (`239bf6b5` + `424a9e08`, reverted in `f612fd48`; evidence
cells in `reports/theme-perf-ab-batch4/stillwater/`). The full sync-row classification (possible
once `4f10d1e1` raised the row caps) split stillwater's 44 residual sync pipelines into 18
MRT-scene-shape + 16 reflector-shape + 9 post internals, and the design targeted the first two:
a scene-wide reveal across the bound compile, and a second fan-out under a private
reflector-formats target with a layer-masked camera.

Measured, n=3/arm: firstFrame **5,585 → 5,324 (−4.7 %)** — but switchWall **3,715 → 4,653
(+25 %)**. The gap fell 64 % and nearly all of it reappeared inside the switch. The kill-check
passed on the letter (delta 261 ms > before-spread 152 ms) and failed in substance: draws/tris/
frame cost unchanged, mechanism claims wrong. Reverted.

**Finding 1 — the 18 "hidden" materials are not hidden; they do not exist yet.** `asyncCount`
rose exactly 3 (the reaction roots the old code already revealed). The scene-wide reveal found
nothing more because those objects are created at activation, after the warm. No reveal reaches
an object that has not been constructed. A real fix is warm-at-creation (compile the material as
the object is added, off the visible frame), which is a different architecture, not a warm-order
tweak.

**Finding 2 — the reflector pass works but cannot overlap.** It compiled the water's
reflector-context monster async (`asyncMax` 2,261 → 3,077 ms) and collapsed the gap — awaited
in-switch at 2.78x parallelism, extending the switch by nearly the gap it saved. The two bound
passes cannot run concurrently: `acquireCompileBinding` refcounts ONE session per renderer, so a
second acquire under a different target would reuse the first binding. Overlapping them needs
either per-target sessions or the live-loop read-redirect machinery.

**Finding 3 — a whole-scene compile under an MRT-null context is a WGSL generator trap.** The
first draft compiled the whole scene under the reflector's single-target context and produced
**112 deterministic console errors** — `struct OutputType: structures must have at least one
member` — one per MRT-only material whose fragment has zero outputs without MRT. Compile honours
camera layers exactly like render (`Renderer._projectObject`), so the fix is a camera clone with
`layers.set(reflectionLayer)`. The lane's console gate voided every such cell — ADR-0016's
machinery working as designed: a warm that creates invalid pipelines never got measured as a win.

stillwater keeps §13 (10,421 → ~5,5 s) and remains the fleet's worst. Its remaining levers, in
order: the ~2.2 s single-pipeline water compile (a shader-size problem — plan 1.3's calibrated
noise swap, the same class as starlight's §31 verdict), and warm-at-creation for activation-time
content.

## 31. summer and starlight, re-diagnosed under the corrected instrument — the reverts hold, for different reasons

**No code change; cells from the 2026-08-26 snapshot.** Both §16 reverts were re-examined with
full row visibility.

**summer (0 async / 121 sync, gap 3,147 ms) — the revert's *theory* was wrong, its *decision*
right.** §16 recorded "no post stack is a reason NOT to warm". The cell refutes the theory: the
121 sync pipelines carry `rgba16float` target shapes (9 × `|4|depth24plus` + 16 × `|1|depth24plus`
in the sample), and the scene has a lake `reflector()` — the failed warm added 2,180 ms because it
was BARE (canvas-context keys that all missed), not because warming cannot help. But the correct
fix is not mechanical either: the effect's post stack lives in a closure the runtime never
exposes (`summer-meadow.effect.js` builds `RenderPipeline` + `scenePass` locally), the cell shows
**no dual-target shape at lane quality** — so the MRT bloom path is not what runs — and the
`rgba16float|4` single-target context owner is not yet identified. Summer needs a diagnostic
session of its own: expose the post stack from the effect, map the `|4` context, then the
standard bind + pin + fan-out. Expected win if the contexts map cleanly: most of the 3.1 s gap.

**starlight (0 async / 14 sync, gap 2,902 ms) — the revert holds outright.** Fourteen pipelines
cannot fill 2.9 s by count; the gap is one or two monster compiles (6 MRT scene materials + post
internals) with **nothing to overlap against** — the switch is only 373 ms. Warming moves the
wait, it cannot shrink it; that is exactly why the §16 attempt measured +77 ms of noise. The
lever is the shader itself: plan §1.3's calibrated-noise swap (the Odyssey lava-lake treatment).
Anything else re-litigates a settled negative.

## 32. ocean — 4,437 ms → 3,826 ms (−13.8 %), the live-loop machinery's first theme

**Commit `2e45b11f` (change), this section (evidence). 2026-08-26.** Both arms n=3 admissible.

Ocean could not take the standard bound warm: its render loop is live before either warm site
runs (`firstRenderCallMs` 1,668 < `switchWallMs` 2,039), and a held global target binding would
redirect concurrent paints into the scene pass. This is the first theme use of
`compileGroupUnderLiveLoop` — Odyssey item 2.11's machinery — which binds nothing: it redirects
the compile's target/MRT *reads* and launches per-object compiles in the scene pass's own
prologue. Both bare sites converted (the critical in-switch compile, still fire-and-forget with
the real post render chained after; and the deferred build's warm, which had been running bare
under a live loop with post active — the row-3.4 hazard class, now closed here).

| field | before (med, range) | after (med, range) | delta |
|---|---:|---:|---:|
| **firstFrame (ms)** | **4,436.5** (4,431.1–4,484.2) | **3,826.3** (3,075.2–4,197.7) | **−13.8 %** |
| switchWall (ms) | 2,024.0 (2,013.7–2,068.6) | 1,493.1 (1,487.9–1,515.9) | −26.2 % |
| async / sync | 51/76 | 50/49 | sync −35.5 % |
| parallelism | 0.52x (0.50–0.53) | 2.66x (1.42–5.35) | 5.1x |
| draws / tris p50 | 196 / 538,349 | 195 / 538,195 | unchanged |
| cpu / gpu / wall p95 | 2.5 / 1.245 / 8.3 | 2.7 / 1.311 / 8.2 | within noise |

Two honest caveats. **The after-arm is noisy** — firstFrame ranges over 1,100 ms — because ocean
streams tens of MB of assets after the reveal and the deferred warm lands at different phases
run to run; the median stands (kill margin 11.5x) and the mechanism moved (sync −27, switch
−531 ms with tight ranges on both). **The gap barely moved** (−3.4 % median): 39 scene-shape sync
pipelines remain, and they are ocean's deferred/streamed content compiling at arrival — §30's
warm-at-creation class, not reachable by any switch-time warm — plus a gap floor set by asset
decode, not pipelines. Ocean's next lever is row 3.3 (fetch/decode in `init()`), not more compile
work.

## 33. halcyon-apex — 2,416 ms → 1,875 ms (−22.4 %), the theme that never warmed

**Commit `282fb1b0` (change), this section (evidence). 2026-08-26. Both arms n=3 admissible.**

halcyon-apex created **zero** pipelines before its first frame — `createScene` built the runtime
and started the loop, no compile of any kind — and paid 62 sync pipelines behind a 1,697 ms gap.
An earlier survey refuted a "bound warm" here because there is no post stack to bind; the
refutation predated moonlit-forest's §23 proof that a **null-bind** fan-out preserves the default
context. With no MRT anywhere in the effect, the reflector-context second pass is safe scene-wide
(the §30 empty-struct trap needs MRT-only materials, which cannot exist here).

| field | before (med, range) | after (med, range) | delta |
|---|---:|---:|---:|
| **firstFrame (ms)** | **2,415.8** (2,380.8–2,488.0) | **1,875.2** (1,872.4–1,885.6) | **−22.4 %** |
| switchWall (ms) | 731.7 (730.9–789.2) | 1,169.0 (1,166.7–1,174.4) | +59.8 % |
| after-gap (ms) | 1,684.1 (1,649.9–1,698.8) | 706.2 (705.7–711.2) | −58.1 % |
| async / sync | 0/62 (exact ×3) | 38/29 (exact ×3) | +38 / −33 |
| parallelism | — | 2.75x (2.75–2.77) | — |
| draws / tris p50 | 308 / 21,389 (exact ×3) | — same — | 0 |
| gpu p95 (ms) | 0.852 | 0.655 | −23 % |

The switch grew 437 ms (the §26 trade — measured compile replacing an invisible first-draw
stall) and the player got 541 ms faster, kill margin 5x.

## 34. sky-children — reverted at +97 %, and the live-loop path's precondition found

**Attempted and reverted 2026-08-26** (`69b37bc4`, reverted in `45d2bd83`; evidence in
`reports/theme-perf-ab-batch5/sky-children/`). firstFrame **2,186 → 4,302 ms (+96.8 %)** — the
worst measured outcome of the campaign, caught by the arm, never shipped beyond the branch.

The mechanism is a precondition of §32's machinery that ocean satisfied silently:
`compileGroupUnderLiveLoop` launches each per-object compile inside the **scene pass's own render
prologue**. Ocean's loop renders through `oceanPost` from its first frame, so launches drain at
frame rate. sky-children's loop runs before `buildScene` but does **not** render through its post
during the build window — so the launches serialised against a prologue that never fired: the
cells show a median of ONE async pipeline at parallelism 1.0, a 3.0 s await extending the switch
7x, and the 34-pipeline sync storm intact behind it. **The live-loop path requires the scene pass
to actually render during the compile window.** The original assessment — sky-children needs its
lifecycle reordered (warm before `startAnimation()`) — stands, now with a measurement behind it.

## 35. misty-lake and bioluminescence — the classic-WebGL gap is not program compile

**Attempted and reverted 2026-08-26** (`e1936e9a`, reverted in `45d2bd83`; evidence in
`reports/theme-perf-ab-batch5/`). First controlled experiment on the classic-renderer half of the
fleet (row 5.6): both themes carry a >1.1 s gap on a tiny switch (misty-lake 1,412 ms on 79;
bioluminescence 1,192 on 268) with zero WebGPU pipelines by construction, and the obvious
hypothesis was sync GLSL program compile at first draw. An awaited classic `compileAsync`
(KHR_parallel_shader_compile) before each loop start tested it.

**Falsified cleanly on both**: the switch grew ~275 ms and the gap moved **−2.7 % / −1.9 %** —
warmed programs would have collapsed it. The classic gap is therefore dominated by something
program compilation cannot touch; the leading candidate is **lazy texture upload at first bind**
(`renderer.initTexture` is the tool for that hypothesis — a different experiment, deliberately
not stacked into this one). Both edits reverted; the GL-fleet gap class (misty-lake,
bioluminescence, solar-eclipse 672, fall 422, luminous-tides 418, pyrestorm's 2.2 s in-switch)
now has one falsified mechanism and one candidate mechanism on record.

## 36. Batch B — the smaller themes, and the law that decides them

**2026-08-26. Six zero-async themes attempted (`da28a0ce` and its parent), n=3/arm each, plus
neon-dusk blocked. Two kept, three reverted, all evidence in `reports/theme-perf-ab-batch5/`.**

| theme | gap before | firstFrame | verdict |
|---|---:|---|---|
| synthwave-sunset | 724 ms | 1,083 → **883 ms (−18.5 %)** | **KEEP** |
| himalayan-peak | 592 ms | 920 → **858 ms (−6.8 %)** | **KEEP** |
| electric-dreams-v3 | 781 ms | 1,111 → 1,150 (+3.6 %) | revert — a wash tipping negative |
| astral-weave | 708 ms | 961 → 1,284 (+33.7 %) | revert — gap eliminated, and still lost |
| serenity-warp | 476 ms | 706 → 1,814 (+156.9 %) | revert — 1.2 s of warm against 114 ms of compile |
| neon-dusk | 821 ms | — | measurement-blocked: its own DRS moves the pixel-ratio pin in 6/6 baseline runs (the row-4.2 defect); unmeasurable until 4.2 lands |

**The small-theme law, measured five ways.** The gap→switch trade wins only when the first-frame
stall exceeds the warm's own awaited wall (`asyncSum / parallelism`). astral-weave is the purest
demonstration: the warm **eliminated** its gap (708 → 46 ms) and the theme still got 324 ms
slower, because the awaited compile cost ~986 ms — the bare first draw, which overlaps its
pipeline compile with everything else in the gap (asset decode, texture upload, layout), was
already the better schedule. Below a gap of roughly **700 ms** at this fleet's typical
parallelism (~2.5–3x), the recipe reliably loses. synthwave-sunset (724 ms gap, good
parallelism) and himalayan-peak (592 ms but a very cheap warm) sit just on the winning side;
serenity-warp (476 ms) was never close.

This closes the systematic sweep of the zero-async class. Every theme in it now carries either a
kept, measured fix or a measured negative with its mechanism — none carries an assumption. The
themes below this line in the gap ranking (wolfhour 529, fall 422, luminous-tides 418, …) sit in
the regime the law says to leave alone, and the remaining large-gap items each need a different
tool: summer a context diagnosis (§31), the GL fleet a texture-upload experiment (§35),
sky-children a lifecycle reorder (§34), neon-dusk the row-4.2 DRS gate, stillwater and starlight
shader-size work (§30/§31).

## 37. summer, second attempt — a perfect wash, and the strongest evidence yet for the law

**Attempted and reverted 2026-08-26** (warm commit reverted in `3230c065`; both arms n=3
admissible in `reports/theme-perf-ab-batch6/summer/`). firstFrame **3,583.1 → 3,569.4 ms
(−0.4 %, 14 ms inside the 43 ms before-spread)** — a wash to the digit.

Unlike the first attempt (§16: a bare serial warm that reached 10 of 121 pipelines), this one
ran the campaign's full toolkit — runtime tick first, scene-wide reveal, null-bind fan-out for
the default context, a private reflector-formats pass for the second context, one real render —
and the mechanism **worked where it could**: 0/121 → 68/47, the reflector class nearly
eliminated (53 → 3), gap 3,210 → 442 ms (−86 %), zero console errors, draws and triangles exact.
And the theme did not get faster, because the switch absorbed ~2.75 s of awaited compile
(asyncSum 8,185 ms at 2.34x) to remove ~2.77 s of gap.

**This is §36's law at its largest scale**: summer's 3.2 s gap was never a naked stall — the GPU
drizzled the 121 sync compiles across early frames, overlapped with asset decode and upload, and
that natural schedule was already efficient. A warm that merely relocates compile cannot beat
overlap; only making the compiles *cheaper* can (plan §1.3's calibrated-noise swap — summer's sky
dome carries 12 `mx_noise_float` calls — the same lever as starlight §31 and stillwater's
remaining monster §30).

**One narrowed puzzle stays on the record**: 42 of the 55 default-context
(`rgba16float|4|depth24plus`) pipelines *still* missed the null-bind warm, while halcyon-apex's
identical-shape class converted fully (§33). Summer's live default context differs from its
compile-time resolution in some way not yet identified — pixel-ratio timing, output-buffer
config, or a per-frame target the wrapper touches. Whoever picks summer up again starts there,
with the reflector-format pass (explicit target, full conversion) as the working control.
