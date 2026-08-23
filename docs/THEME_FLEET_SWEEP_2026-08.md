# Theme fleet sweep — 61 themes, Stage 1 (static census + ranked hit list)

Status: **Stage 1 complete (2026-08-23). Stage 2 (the one measured GPU sweep) NOT run — awaiting go-ahead.**
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
