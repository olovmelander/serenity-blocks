# Fast and beautiful on three 0.185.1 — the post-upgrade plan

Status: **ACTIVE — Phase 1 landed 2026-08-21 (measured), Phases 2–7 planned.**
Owner: rendering. Predecessor: [THREE_UPGRADE_RESEARCH_R181_TO_R185_2026-08.md](THREE_UPGRADE_RESEARCH_R181_TO_R185_2026-08.md)
(closed). Governing ADRs: [0007](adr/0007-webgpu-tsl-definition-of-done.md) (screenshot before
"done"), [0016](adr/0016-perf-claims-require-a-verified-instrument.md) (numbers only from a
verified instrument), [0018](adr/0018-three-js-pinning-and-upgrade-protocol.md) (pin + protocol),
[0019](adr/0019-gate-on-renderer-kind-not-backend.md) (renderer kind, not backend).

## 0. Why this plan exists

The upgrade closed with an honest but unsatisfying verdict: r185 removed the load freezes
(−62…−86 %), but **startup wall-clock got slower** (cold 7.03 → 8.05 s total, board visible
9.14 s; the `compiles` bucket 1.43 → 4.15 s cold). The player-facing promise of "three times
faster shader compile" had not materialised. The user asked to dig into exactly that, and into
everything else that would make the game run fast and look good on r185.

This document is (a) the record of what the dig found and landed, and (b) the ranked plan for
what remains, synthesised from seven parallel research reports (startup compile, non-compile
startup buckets, theme switch, "run fast", "look better", debt, ADR-0019 class audit) that were
read against the installed `three@0.185.1` source and the repo's own measurements.

## 1. What "three times faster" turned out to mean — measured

Method: the real game in Chrome 151 (D3D12 backend, **DXC** confirmed via `chrome://gpu`
`use_dxc`), RTX 3070 Laptop, dev server, Odyssey started through `startGameWithMode`, with
`GPUDevice.prototype.createRenderPipelineAsync` wrapped to time every pipeline by label.

### 1.1 The yields were never the problem

1,566 `scheduler.yield()` calls during the startup pool cost **143 ms** in total. r185's yielding
is what removed the freezes; it is not what made startup slower.

### 1.2 One shader was the entire long pole

97 pipelines compile at startup. Sorted by duration, **one** of them —
`renderPipeline_MeshBasicNodeMaterial_34`, the Earth Core **lava lake**
(`earth-core.tsl.js createLavaFloorTSL`) — took **7,235 ms**. The next was `lava-fall` at 1,374 ms,
then three Earth Core `MeshStandardNodeMaterial`s at ~970 ms each. Everything else was under
300 ms. Reproduced in isolation with the emitted WGSL: Tint front-end 22 ms, **fragment stage
6.9 s**, vertex 353 ms. The fragment was only 16 KB / 381 lines.

### 1.3 Root cause: three's MaterialX Perlin noise is a compile-time pathology under DXC

The lake evaluates `snoise3` 20 times (six 3-octave `fbm`s + two hot-spot samples). `snoise3`
was a stand-in for the chapters' original Ashima simplex, implemented as three's
`mx_noise_float` — MaterialX Perlin, which hashes the lattice with an **integer Bob-Jenkins mix**
(8 corner hashes × 7 bit-rotates per sample). Once DXC inlines every call, compile time grows
**superlinearly**: 5 evaluations 0.9 s, 10 → 2.4 s, 20 → 7.4 s.

Identical lake shader, only the noise body swapped (measured):

| noise primitive | pipeline compile |
|---|---|
| `mx_noise_float` as emitted by r185 | **7,349 ms** |
| same, with r181's `if/else` emission of `mx_select` instead of r185's `select()` | 3,945 ms |
| Ashima simplex (float permute) | **978 ms** |
| float-hash value noise (the lib's own `noise3`) | 418 ms |
| baked 3D texture lookup | 139 ms |

So r185 did make it worse (the `select()` emission in `mx_noise.js` doubled it), but the primitive
was already pathological on r181; r181 merely hid it by never awaiting the pipeline on the
startup barrier the same way.

### 1.4 A second, independent finding: layout-less `Fn` inlines

A TSL `Fn` **without `setLayout`** is an *inline* function — its body is re-emitted at every call
site. Only `setLayout` produces a real WGSL `fn`. The shared Odyssey noise lib's `hash21 / hash31 /
noise2 / noise3` had no layouts, so every `fbm3` octave was a fresh inlined body (cosmic-expanse:
14 `fbm3` × 5 octaves = 70 bodies). The first simplex port, also layout-less, produced a
**113 KB, zero-function** lake fragment that compiled in 3.7 s; with layouts it is 14 KB with five
`fn`s and compiles in 1.9 s.

### 1.5 A third finding: the prewarm's `compileAsync` arguments were inverted

three's contract (JSDoc, r181 and r185 alike): `compileAsync(objectToCompile, camera,
targetScene)`. The repo called `compileAsync(scene, camera, group)` — projecting the **whole
scene** per "targeted" prewarm and taking lights/background from a `Group`. r181 tolerated it
(sync build, cache hits); r185's per-object yielding loop made four concurrent whole-scene walks
cost seconds, and reading `background` off a Group is what threw `isColor` — the "upstream r185
bug" drafted as Issue 1 was this misuse. **Issue 1 is withdrawn**; Issue 2 (`dispose()` under
in-flight timestamp resolves) stands.

### 1.6 r185's per-object pipeline await serialises a compile call — and the inverted call had hidden it

`Renderer.compileAsync` awaits `Promise.all(pipelinePromises)` **per object** (r181 awaited once at
the end), so one call keeps at most one `createRenderPipelineAsync` in flight and a group compiles
as the *sum* of its shader compile times. The inverted call had masked this by accident: four
whole-scene walks drained the same object list concurrently, i.e. ~4 pipelines in flight. Fixing
the argument order alone therefore **regressed** the Electron cold start (ch1 5.4 s = lake 1.65 +
0.8 + 0.46 + 0.44 + 0.37 …; measured with the new per-pipeline instrument). The fix that keeps
both is a deliberate fan-out: `compileGroupThroughPost` now compiles a group's renderables through
a pool of targeted `compileAsync(object, camera, scene)` calls (width 6), with one representative
per bucket of three's own builder identity (`RenderObject.getMaterialCacheKey`: material
instance + vertex layout + receiveShadow; per-object for InstancedMesh / `count > 1` / Batched /
Skinned — RenderObject.js:833). Both mistakes were measured on the way: collapsing the One World
forest's 40 instanced chunks to one call moved 39 node builds onto the first frames (load p99
344 → 2,820 ms); compiling every object individually paid ~22 ms of compileAsync overhead per
cache-hit call (the world's 50 objects: 1.1 s for nothing).

### 1.7 Instrument gaps closed on the way

- `scripts/odyssey-perf-session.mjs` now wraps `createRenderPipelineAsync` before the mode starts
  and records `browser.pipelines` (count, sum, top 15 by label) and the **actual adapter** from
  `navigator.gpu.requestAdapter()` (three 0.185.1's `WebGPUBackend` never stores its adapter, so
  `manifest.gpu` had always been null). `scripts/odyssey-pipeline-probe.mjs` is the one-shot
  version (`--url-flag`, `--low-power`).
- **Electron on the 82JU lands on the Vega 8 iGPU unless `force_high_performance_gpu` is passed**
  (no `UserGpuPreferences` entry for `electron.exe`). The perf session and capture harness pass
  it; the ledger is RTX. Lane B is therefore trivially reproducible here (`--low-power` →
  `amd / gcn-5`), which reopens every "lane-B only" item in Phase 4.
- `perf-driver.sh` needs a dev server on its port (the session does not start one) — documented
  in the script.
- **Renderer-level key trace** (`ODYSSEY_PERF_KEY_TRACE=1` on the session): hooks
  `Pipelines._getRenderPipeline` on the board renderer (trapped through
  `gameModeManager._ensureMode` — `window.odysseyMode` is assigned only after the board is ready)
  and records, per pipeline creation, the material/dynamic/initial cache keys, render-context id,
  call depth, light count + lights key, program ids vs the render object's previous pipeline and
  the backend key — so a "compiled but created again" pipeline reads as *which field differed*
  (`browser.keyTrace`). The GPU-level hook sees descriptors; this sees causes. It found 2.9 (c)–(e)
  in one afternoon after a day of inference.

## 2. Phase 1 — landed 2026-08-21

| change | file | verification |
|---|---|---|
| `snoise3` = Ashima simplex TSL port (`simplex3`), **calibrated to `mx_noise_float`'s distribution**: input × 0.664 (zero-crossing rate 0.819 vs 1.234 per unit) and an odd quintic quantile map `0.7058·v − 0.1769·v³ + 0.4543·v⁵` on the output. A plain linear amplitude scale matched the std but squashed Perlin's longer upper tail (p99.9 0.61 vs 0.71) — the terms that live there (`pow(noise, 4)` hot-spots, `smoothstep(0.62, 0.70)` glints, the 0.60–0.90 crust window) lost their pale pools. The quintic matches std (0.2656 / 0.2650), every quantile from p50 to p99.99 within ~1 %, and the tail mass (P(v>0.7) 0.0012 / 0.0012). `?odysseySimplex=0` A/B lever (dev URL) | `chapter-environments/shared/odyssey-tsl-noise.js` | §2.2 |
| `setLayout` on every `Fn` in the noise lib (hash21/31, noise2/3, simplex helpers, `od_snoise3`) | same | lake fragment 113 KB → 14 KB, real `fn`s; pinned by `tests/unit/odyssey-tsl-noise-emission.test.js` (builds the WGSL through `WGSLNodeBuilder`: 20 calls → one `od_simplex3` body, no `mx_*`, `fbm3(…, 5)` → one `od_noise3` body called 5×) |
| `compileAsync(group, camera, scene)` (was inverted) **plus the fan-out** (`compileObjectsFannedOut`: pool of 6 targeted calls, one representative per builder-identity bucket); `group.background = null` patch removed; parameter order pinned from the installed source | `warmup/post-target-compile.js`, `tests/unit/odyssey-post-target-compile.test.js` | 19 unit tests (pool width, bucket rule incl. instanced/receiveShadow/layout, binding held across the whole fan-out); Issue 1 withdrawn in `UPSTREAM_THREE_R185_ISSUES_READY_TO_FILE.md` |

**Measured effect — Chrome 151, warm-ish Dawn cache, in-browser instrument (diagnosis only):**

| | before (mx, inverted compile) | after noise swap | + layouts | + compile order |
|---|---|---|---|---|
| slowest pipeline (lava lake) | 7,235 ms | 3,757 ms | **1,927 ms** | — |
| `odyssey:compiles` bucket | 8,281 ms | 4,818 ms | 3,015 ms | see §2.1 |
| `odyssey:mode:board-visible` | 12,615 ms | 9,369 ms | 7,465 ms | 6,984 ms |

**Measured effect — Electron 38 (the player lane), RTX 3070, COLD Dawn cache (fresh profile), the
perf session's own configuration (Extreme, 1280×720, 240 Hz target), per-pipeline instrument:**

| | mx + inverted compile (r185 ledger) | simplex + corrected compile, serial | + fan-out (final) |
|---|---|---|---|
| lava lake pipeline | (3.0 s, probe) | 1,654 ms | 1,979–2,161 ms |
| `compile-breakdown` ch1 / one-world | 4,179 / 4,207 (whole-scene walks) | 5,361 / 3,514 | 2,300–2,600 / 700–1,600 |
| `odyssey:compiles` bucket | 4,146 ms | 4,127 ms | **811–1,485 ms** |
| startup total | 8,051 ms | 8,229 ms | **5,167–6,155 ms** |
| board visible | 9,084 ms | 9,152 ms | **6,277–7,282 ms** |

(single instrumented runs; the ADR-0016 cells are in §2.1.) For reference r181 measured 7,031 ms
total / 8,054 ms board-visible cold on this machine: **r185 is now faster to the board than r181
was**, while keeping r185's freeze removal.

### 2.1 ADR-0016 numbers (process-per-run driver, n = 3, medians)

Full tables and reading in `reports/odyssey-perf/rtx3070-r181-vs-r185/AGGREGATE.md` (section r185p1).

| cell | metric | r181 | r185 | **r185p1** |
|---|---|---|---|---|
| load/cold | startup total | 7,031 | 8,051 | **5,316 (−34 % vs r185, −24 % vs r181)** |
| load/cold | `compiles` bucket | 1,434 | 4,146 | **1,225 (−70 %)** |
| load/cold | board visible | 8,054 | 9,084 | **6,444 (−29 %)** |
| load/warm | startup total | 4,943 | 5,153 | 5,186 (flat) |
| idle/warm | frame p50 / p99 | 11.2 / 15.8 | 11.4 / 16.2 | **10.9 / 15.4** |
| idle/warm | long tasks total / max | 34,995 / 5,687 | 28,869 / 4,349 | **23,836 / 3,076** |

Load-window frame health after the reveal is worse in the table (p99 2.1–2.8 s) **and not
like-for-like**: those frames are the background chapter creations rebuilding every visible
pipeline (item 2.9), which the r185 ledger's window never reached. **Closed later the same day**
(`r185p1light` cells, item 2.9): post-reveal p99 573 / 574 ms cold / warm, idle frame max 26 ms,
idle long-task total 13.7 s — startup cold 5,510, warm 5,456. Content match holds
(80 / 104 draws, 255 k / 538 k triangles in all trees).

### 2.2 Visual A/B — frozen-clock chapter matrix (ADR-0007)

`scripts/odyssey-chapter-capture.mjs --time 9 --frames 4` per chapter, one fresh Electron per run,
default (simplex) vs `--url-flag odysseySimplex=0` (MaterialX), four local stations each. Luminance
statistics per station pair (mean Y, p50, top-5 %, bottom-5 %; scratch `png-metrics.mjs`):

| chapter | stations within ±1.5 % on every statistic | note |
|---|---|---|
| 2 Deep Ocean | 4 / 4 | caustic shapes differ in realization only |
| 3 Surface World | 4 / 4 | |
| 4 Mountain Peaks | 4 / 4 | |
| 1 Earth Core | 3 / 4 (stations 0.333 / 0.667 / 1.0) | station 0.0 (the entry view) reads ~35 % darker in the sky |
| 6 Cosmic (value-noise path, layouts only) | sanity run, console clean | |

The Earth Core entry station was investigated as a possible calibration bias and is not one:
the camera sits low over one small patch of the flowing lava field, so that frame is dominated
by the *realization* under it — **with the same primitive**, the sky luminance at that station
swings 0.16 → 0.39 → 0.38 across frozen clocks 9 / 40 / 120, and the paired mx-vs-simplex sign
flips with time (mx brighter at t=9: 0.258 vs 0.157; simplex brighter at t=40: 0.255 vs 0.389 and
t=120: 0.175 vs 0.378). In play the field flows (`uTime × 0.15`), so the player sees many
realizations; the statistics — matched to p99.99 — are what govern the look, and the other 15
station pairs confirm them. Seeked in-game stations p0.012 / p0.055 were also screenshot under
both primitives (same molten/crust balance, filament veins; the uncalibrated port had read darker
with speckled veins, which is what prompted the calibration).

## 3. The remaining ladder — ranked, with gates

Each item names the instrument that proves it (ADR-0016) and the visual gate (ADR-0007). Effort
S/M/L. Items are ordered by expected player impact per unit of risk.

### Phase 2 — Odyssey startup structure (cold 8.05 s → target ≤ 5.5 s total)

| # | item | expected | effort | gate |
|---|---|---|---|---|
| 2.1 | **World bakes off the critical path — DONE 2026-08-21.** A DevTools sampling profile of the activation decomposed the 1.74 s `world` task (cloud-field sculpt 685, relief 596, sun fields 383, macro 318 ms inclusive; hero clouds sculpted unconditionally for a mesh never mounted); a 4-lens + 2-design + critique workflow chose the Worker over main-thread slicing (8 vs 4: slicing cannot hide CPU behind CPU-bound startup work). Landed: the five texture bakes extracted verbatim into a pure, worker-safe module (`odyssey-world-bake-data.js`; ground-bakes and cloud-field split into data + wrap pairs), `odyssey-world-bake.worker.js` + loader (relief posted first, then the plates, then the cloud field, buffers transferred; synchronous twin on the first stage access when there is no Worker — one code path, 12 goldens incl. new relief/macro pins), the bake started before `renderer.init()`, the nodes seated from the relief stage, the world built after the nodes from the landed arrays (`createOdysseyWorld({ prebaked })`, `stats.prebaked` provenance), hero clouds gated on `heroes`. Production worker chunk 107 KB (three core, no WebGPU). Flag `?odysseyWorldBakeSync=1`. Design: `ODYSSEY_WORLD_BAKE_WORKER_2026-08.md`. **Measured (n = 3, AGGREGATE.md r185p1world vs r185p1live)**: `world` 1,737 → 195 ms; cold startup **5,580 → 4,008** (−43 % vs r181), warm 5,349 → 3,516; board visible 6,615 → 5,015 / 6,269 → 4,551; post-reveal frame max 1,747 → 464; long-task totals −30 %. The ≤ 300 ms long-task gate is missed only by the app-boot task in `main.js` (662–691 ms, before Odyssey). | −1.0…−1.4 s cold (got −1.57) | done | `tests/unit/odyssey-world-bakes-golden.test.js` (12), `odyssey-world-bake-loader.test.js` (4); session `world` bucket + `world-bake` events |
| 2.2 | **Launch one-world / corridor / breach compiles when their groups exist** (world at ~3.6 s), not inside `setupDirector` (~4.85 s). All 12 world materials are unlit `MeshBasicNodeMaterial`, `fog=false` → no light-set re-specialisation. | −0.8…−1.2 s cold | S | `compile-breakdown`: one-world ends ≤ ch1 |
| 2.3 | **Focus-only barrier**: reveal on ch1; the world is act-gated invisible at p=0, so its warm need not block the reveal (scroll-into-Act-II guard required). | −0.5…−1.0 s board-visible | M | `board visible`; backward-stall 0 gate |
| 2.4 | **`nodes` bucket was 90 % yield latency — DONE 2026-08-22.** The startup's CPU steps yielded with a DOUBLE `requestAnimationFrame`; during startup a frame is 40–60 ms (chapter compiles and the world worker in flight), so the 11 node batches alone burned ~1 s for < 50 ms of work. The overlay never needed those frames — its ring/star animations are CSS `transform`/`opacity` keyframes, i.e. compositor-driven — so the CPU-only steps now yield a TASK (`scheduler.yield`, MessageChannel fallback); the warm-up replay keeps its rAF pacing. Same item, the level-icon atlas: each of the 52 distinct icons decoded synchronously through its own TextureLoader + canvas and then set `needsUpdate`, re-uploading the WHOLE DataArrayTexture (~14 MB × 52 ≈ **720 MB per boot**) to land one layer; now `img.decode()` off-thread, one reused canvas, and `addLayerUpdate(layer)` → ~13 MB. **Measured**: `nodes` 1,029 → **75 ms**. | `nodes` 844 → ≤100 ms | done | bucket; `compiles` must not grow *(it did — see 2.13)* |
| 2.5 | **GPU device at menu-idle — BUILT, OPT-IN (`?gpuWarm=1`) 2026-08-22.** `rendering/webgpu-device-warm.js` requests the adapter+device as bootstrap starts and the board injects it (r185 takes `parameters.device` and only destroys a device it created itself, so the warmed one survives a board teardown and the next entry reuses it; the descriptor mirrors three's exactly — `featureLevel: 'compatibility'`, all adapter features, same `powerPreference` — or `compatibilityMode`/MSAA would differ). It works: `renderer` 323 → **42 ms**. It is **not on by default** because the saving is eaten twice over: n = 3, cold startup 2,847 → 3,267, `nodes` 88 → 406, `world` 150 → 798. `await initRenderer()` was 320 ms of main-thread IDLE during which the world-bake workers ran unimpeded — deleting it does not shorten the critical path, it moves the same time into the steps that await the bake, and adds core contention. Switch on together with a menu-time bake start (2.16). | −0.3 s (once 2.16 lands) | built | `renderer` bucket; total must not grow |
| 2.6 | **Restore Dawn pipeline parallelism**: collect `_pipelines.getForRender` promises during a pooled compile and await once at the end (repo-owned hook in `compileGroupThroughPost`, pinned by a contract test) — measured 4 → 71 in flight. | −0.5…−1.5 s cold (less now that the long pole is 1.9 s) | S–M | `compiles` cold; contract test on `Pipelines.getForRender` |
| 2.7 | Overlay dismiss is a fixed 862 ms fade; Odyssey mode chunk is lazy-imported on click; `timeToMenuReadyMs` measured but never recorded. | −0.4 s board-visible; −0.15…−0.4 s click-to-board | S | measures; art call for the fade |
| 2.9 | **The prewarm never hit: five independent reasons, all FIXED 2026-08-21.** Found one under the other with the per-pipeline instrument and then a renderer-level key trace (`ODYSSEY_PERF_KEY_TRACE=1`, §1.7). **(a) Light set** — each background chapter creation added its freshly-constructed lights to the rig; `LightsNode.customCacheKey()` hashes **each light's id** (three `LightsNode.js:147-173`) → every visible builder state invalidated, 41–101 sync creations, 2–3 s frames, three times per first launch. Fix `shared/chapter-light-pool.js` **v2**: chapters `acquireChapterLight()` **virtual** lights (`visible=false`, never in the render list; same parameters, same group, same animation), the rig holds **9 fixed slots** (4 point, 3 directional, 1 hemisphere, 1 merged ambient = max over adjacent chapter pairs) and `syncChapterLightSlots()` copies the active chapters' lights into them each frame at intensity × blend weight (the crossfade). v1 (18 resident lights) removed the churn but cost +0.43 s cold startup (Earth Core MeshStandard 0.5 → 0.8 s) — rejected. Atmosphere rig hoist is now the default (`?odysseyLightsLate=1` to opt out). Contract test builds every chapter through the registry. **(b) The reveal traversals** (`_prewarmGroup`, `_prewarmChapterEnvironment`, `_renderWarmChapterOffscreen`) set every child visible — including the virtual lights — so warm renders built against 14–15 lights, the live pass against 12; lights are now skipped. **(c) Render-context call depth**: `compileAsync` resolves `RenderContexts.get(rt, mrt)` at depth 0, the post scene pass renders nested at depth 1, and `RenderObject.getMaterialCacheKey` appends the context id → `beginNestedContextDepth` remaps depth 0 → 1 inside every compile/warm binding (upstream Issue 4). **(d) r185 regression**: `_createObjectPipeline` queues work items and `compileAsync` drains them after `renderObject()`/`_renderTransparents` restored `material.side = DoubleSide` — every transparent double-sided material compiled one DoubleSide pipeline and the live BackSide/FrontSide pair was created synchronously (two per material, 45 on the first frame; programs identical, backend key differed in `side` only) → `beginDeferredSideCapture` re-applies the queued side per drained item (upstream Issue 3; two-pass buckets of one material serialised, everything else still fans out — serialising all same-instance buckets measured one-world 1.26 → 4.72 s and was rejected). **(e) The board's own presentation** (path tube/rings, 55 level nodes + instanced glass/glow/lock/star, starfield) is added straight to the scene and was in no prewarm group → `_boardPresentationGroup()` pseudo-group joins the startup pool. **Result**: sync creations on the first live post frame 45–52 → **5** (the Bloom passes); after the reveal the only sync creations left are the background render-warms of chapters 6–8 at 13–14 s (78, by design — live-loop `compileAsync` is unsafe on r185, see the drain's comment; that is item 2.11). **Measured (n = 3 medians, `AGGREGATE.md` r185p1light vs r185p1lake)**: idle/warm frame max 714 → 26 ms, long-task total 22.2 → 13.7 s; load post-reveal p99 cold 1,703 → 573 ms, warm 1,299 → 574; startup cold 5,462 → 5,510 (flat), warm 5,283 → 5,456 (+3 %: the pool carries the board prewarm and the now-correct BackSide/FrontSide pair per two-pass material — follow-up: `forceSinglePass` audit of the flat cards). | post-reveal 2–3 s stalls removed; first-frame wave removed | done | `tests/unit/chapter-light-pool.test.js`; `tests/unit/odyssey-post-target-compile.test.js` (27, incl. r185 drain double + source contract); session `pipelines.sync`, `keyTrace` |
| 2.10 | **Warp-transition pre-init compiled its GLSL synchronously on the GPU process** (classic `WebGLRenderer`, five noise-heavy `ShaderMaterial`s → ANGLE → FXC): `preinit-warp` measured 2.9–5.9 s cold, 126–500 ms when ANGLE had it cached, stalling the WebGPU board for that long ~10 s after reveal. **LANDED 2026-08-21**: `WarpTransitionRenderer.prewarmAsync()` → `WebGLRenderer.compileAsync` (KHR_parallel_shader_compile) then the hidden prewarm frame; `preInitWarp` no longer renders synchronously. Cold idle run: sync part 83 ms, largest frame in 30 s 737 ms. | −3…−6 s first-launch stall | S (done) | `preinit-warp` measure; idle/load frame max |
| 2.11 | **Background chapter warms compiled synchronously — DONE 2026-08-21 (live-loop compile).** The post-reveal drain ran the synchronous private-target render-warm alone because r185's `compileAsync` was unsafe under the live loop: it queues work items and drains them across `scheduler.yield()` tasks, every node build reads the LIVE `getRenderTarget()`/`getMRT()` (before the first yield in `NodeMaterial.setup`, after the last in `WGSLNodeBuilder.buildCode`) and caches under the item's correct context key; a global binding across the await redirects the RenderPipeline quad into the bound target / aliases the scene-pass output texture (the 2026-08-12 poison). Researched with 4 read lenses + 2 designs + an adversarial critique (`ODYSSEY_BACKGROUND_COMPILE_2026-08.md`). Fix `compileGroupUnderLiveLoop`: the scene-pass target + MRT + call depth are applied for compileAsync's SYNCHRONOUS prologue only (object revealed for the same instant), and the drained builds' reads are answered by instance accessors on the renderer's own `_renderTarget`/`_mrt` fields (covers `isOutputTarget`-derived getters and `currentSamples`), suspended for the synchronous extent of render/compute/clear*/copy*/setSize* and of the drain's own `_nodes.update*` hooks; the side capture re-applies before the pipeline key; device loss checked. The drain compiles, then the unchanged render-warm runs as a cache hit (4–8 ms); the sweep / `_deferRenderWarm` never "warm anyway". Upstream Issue 5 drafted. Flag `?odysseyLiveCompile=0`. **Result**: sync pipeline creations after the reveal **78 → 0** (cold + warm sessions); Chrome: ch 6/7/8 compiled in 1086/693/627 ms while the loop rendered, warmed in 4/5/8 ms, travel to 6 and 8 created 0 pipelines, renders identical, no WebGPU errors. **Measured (n = 3 medians, `AGGREGATE.md` r185p1live vs r185p1light)**: sync creations after the reveal 0 in all nine cells; load post-reveal p99 cold 573 → 265 ms, warm 574 → 172; idle long-task total 13.7 → 9.9 s; startup/board-visible flat (cold 5,580 / 6,615, warm 5,349 / 6,269). | post-reveal stalls 0.6–1.8 s removed | done | `tests/unit/odyssey-post-target-compile.test.js` (38: r185 prologue/drain + accessor doubles, source pins); session `pipelines.sync` after the reveal = 0 |
| 2.12 | **Bloom's five passes compiled on the first post frame — DONE 2026-08-21.** Cause: fast-start skipped `warmOutputVariants` entirely and the warm sample at p=0 bound the no-bloom variant (director bloom weight 0), so the bloom variant's quad pipelines (5 bloom + the output quad) were created synchronously on the first live frame (~49 ms). Fix: fast-start warms the lean pair minus the live variant (`warmOutputVariants(yield, { lensStates: [false], skipActive: true })`) — one render + the restore, 21 ms of JS behind the overlay; the ch7 lens variants still warm on first visit. Session: no sync creations between the reveal and the background warms; startup/board-visible unchanged (5,490 / 6,546 single cold run). | first live frame: 0 sync creations | done | `tests/unit/odyssey-tsl-pipeline-sharpen.test.js` (warmOutputVariants cases); session `pipelines.sync` |
| 2.13 | **The two-pass tax on flat transparent surfaces — DONE 2026-08-22.** `transparent + side: DoubleSide` makes three draw an object twice (BackSide, then FrontSide) so a CLOSED transparent shell sorts against itself, and r185 compiles a SEPARATE pipeline per pass (`material.side` is in the backend cache key — the fact behind upstream Issue 3). A runtime census of the startup groups found **33** such materials and not one closed shell: billboard quads, planes, an instanced particle quad, a flat contact-shadow ring, five god-ray cones (Additive → order-independent) and the water sheet. 21 materials across 7 files now set `forceSinglePass`; the water keeps its split, documented in place (displaced sheet, NORMAL blending, the rail passes under it). **Measured**: async pipelines 132 → 117, `compiles` 2,308 → 1,876, cold startup −0.8 s. | −0.5…−0.9 s cold | done | runtime census = 0 two-pass; `pipelines.count` |
| 2.14 | **Forest scatter into the bake worker — DONE 2026-08-22.** `scatterZonedForest` is pure arithmetic over the height mirror + rail (no three import), so it runs as a lane on the kept-warm band-1 worker the moment the relief bands merge, in parallel with the sun march; the main thread keeps the per-(species, LOD, variant) geometry and the InstancedMesh compose. **Measured**: 107 ms off the main thread, `world` 247 → 151 ms; census identical (7,039 trees, same species split, same bucket keys — pinned by test). | −0.1 s cold | done | `world` bucket; scatter census test |
| 2.15 | **One World left the pre-reveal compile barrier — DONE 2026-08-22.** `compile-breakdown` showed chapter 1 taking 2,543 ms of driver time while One World (1,944), the corridor field (1,023) and the seam breach (559) compiled beside it, none of which the reveal frame draws. Item 2.11 made compiling under the live loop safe, so the first cut deferred all three — and **the n = 3 ledger rejected it**: cold startup 3,156 → 3,420 ms, board visible +348, frame max 467 → 707, `warmup` 62 → 203. Cause: the pre-reveal warm-up replay renders the WHOLE scene, so a group the barrier no longer compiled was compiled *synchronously* inside that render — the work moved from a parallel async pool into a serial one. Only One World is provably absent from that render (the act gate keeps it invisible at p=0, verified live), and it was the biggest single competitor, so it alone is deferred; corridor and breach stay. `_prewarmGroup` also skips its deep-reveal under a live loop (revealing a group across the await made live frames draw it and create 13 pipelines synchronously). `?odysseyDeferSeamCompiles=0` restores the old barrier. **Measured (n = 3, dwell)**: cold startup 3,156 → **2,847**, board visible 4,148 → **3,850**, warm 3,145 → 2,639, idle 2,993 → 2,679, `compiles` 1,747 → 1,417; post-reveal sync pipeline creations still 0 and driving straight through the first seam into Act II creates none. Cost: cold frame max 467 → 591 ms (One World's node builds now run under the loop; p99 flat at 215, and the pre-2.15 cell's own spread reached 601). | −0.3 s cold | done | `compiles` bucket; 0 sync creations after reveal; first-transition hitch 0 |
| 2.16 | **The startup is BAKE-BOUND — the finding that reframes what is left (2026-08-22).** Three measured experiments all said the same thing. (a) Fan-out width 20 vs 6: `compiles` 1,417 → 858 but total 2,847 → **3,338** — r185 builds every render object's node graph on the MAIN thread between yields, so widening the pool relabels that cost into `nodes`/`world`/`creates` instead of removing it. (b) Deferring corridor+breach past the reveal: total → 3,420, because the pre-reveal warm-up replay renders the whole scene and compiles them serially instead (item 2.15). (c) The GPU device warm: `renderer` → 42 ms, total → 3,267, because that await was free bake time. **So**: from `renderer` through `world` the critical path is the world bake, and `compiles` (1,417) is mostly main-thread node building for chapter 1. | finding | done | recorded in AGGREGATE.md |
| 2.16a | **Lever (a) — start the bake at menu time: MEASURED AND CLOSED 2026-08-22.** The idea was that the terrain and plate lanes need only the quality setting, so they could run while the player reads the menu — and that this is what would let item 2.5 pay off. An upper-bound spike prewarmed **all six lanes** at MENU_VISIBLE + 250 ms and the board adopted the handle wholesale (no cache key, no lane split), verifying the two resolutions and all 48 rail samples before accepting it — the rail IS computable at menu time (`ODYSSEY_LAYOUT_DATA` and `ODYSSEY_PATH_DATA` control points are byte-identical), and every run logged a claim. **Measured: 2,847 → 4,013 alone (+1,166) and 3,785 paired with `?gpuWarm=1` (+938)**, against a pre-set ship gate of ≤ 2,597. The bake gets *slower* in the menu window — its worker wall 868 → 2,027–2,269 ms for only 479–850 ms of lead — so the board waits 1,676–2,047 ms for it (23–34 ms at baseline) and the still-running workers cost `compiles` +730 ms by taking cores from the 6-wide pool. **The menu window is not idle**: it is three's evaluation, Phaser, the intro scene, the deferred initial theme and the first AudioContext. Item 2.5 therefore stays opt-in with no route to switching it on. | rejected (−1.2 s gate missed) | done | AGGREGATE.md r185p1spike / r185p1spikegpu |
| 2.16b | **`compiles` is PER-MATERIAL cost, not graph size — model corrected and first material deleted, 2026-08-22.** Measured: chapter 1 is 26 materials / 7,843 TSL nodes, and node building costs **6.5–8.4 µs per node (~125 nodes/ms)** — so the whole chapter's graph construction is ~50–65 ms of a 1,990 ms barrier, i.e. **~76 ms per material** of which ~95 % is fixed cost (bind groups, pipeline descriptor, WGSL assembly, DXC scheduling). Also: the per-pipeline ms table is a QUEUEING profile, not a cost profile — `createRenderPipelineAsync` cannot resolve while the main thread builds the next graph, so a 15-node sprite reads in the same 600 ms band as a 1,103-node material. **Landed**: the selenite chapel shared the six node pockets' molten material instead of building a seventh identical copy (26 → 25 materials, 7,843 → 6,940 nodes) — **cold 2,847 → 2,749, ch1 1,990 → 1,899, board visible 3,850 → 3,700**, clean separation at n = 3. Verified a visual no-op structurally (seeded `Math.random`: all 53 drawables byte-identical, only the material count differs) because the builder's 61 unseeded `Math.random()` calls make pixel diffs meaningless. **Rejected**: three node-count proposals — two of them would have shipped invalid WGSL (see 2.16c). | −0.1 s cold | done | AGGREGATE.md r185p1mat25; material ceiling pinned in earth-core-drawable-budget.test.js |
| 2.16c | **The layout-Fn binding trap — do not wrap a texture-sampling helper in a shared `Fn().setLayout()`.** r185 caches a layout Fn's generated body in a module-level WeakMap keyed backend → shaderNode (`NodeBuilder.buildFunctionNode`). On a cache hit the body is never re-flowed, so `getUniformFromNode` never runs in the second material's builder and NO texture or sampler binding is registered there — while binding names come from a per-builder counter (`nodeUniform` + index). Material A declares `var nodeUniform0 : texture_3d<f32>`; material B includes the identical cached body calling `textureSample(nodeUniform0, …)`, declares no texture, and its own `nodeUniform0` is an unrelated f32 — Dawn rejects it. Reproduced against the real `WGSLNodeBuilder`; the existing emission harness could not see it because it builds every material against a FRESH stub renderer (each gets its own function cache — the inverse of the running app). Pure-math helpers are unaffected, which is why the shared noise lib stays shared. Pinned by `tests/unit/odyssey-tsl-fn-binding-guard.test.js`, positive control included. Upstream-worthy. | guard | done | that test |
| 2.16d | **Next: keep deleting materials.** 25 × ~76–90 ms IS the pre-reveal barrier, so every material shared or moved past the reveal is worth ~90 ms — 30× what any graph-shrinking buys. Candidates already enumerated: seven 15-node `SpriteNodeMaterial` instances in chapter 1 (several byte-identical: three basin coronas built inside a `forEach`), and two buckets the reveal frame provably does not draw (the lava-fall hero and its splash). Note the sprite hoist was REJECTED on pipeline-count grounds — r185 already collapses identical shader sources to one `ProgrammableStage` — but that argument prices pipelines, not the per-material main-thread cost the 2.16b measurement isolated. Settle it with a cell, not an argument. | −0.1…−0.4 s cold | S each | `compiles`, compile-breakdown ch1; material ceiling test |
| 2.7b | **Lava lake remake — Stage 1 SHIPPED 2026-08-21** ([ODYSSEY_EARTH_CORE_LAVA_LAKE_REMAKE_2026-08.md](ODYSSEY_EARTH_CORE_LAVA_LAKE_REMAKE_2026-08.md) §0): the calibrated primitive baked into a periodic R16F 3D texture through the `fbm(…, sn)` seam. Measured: lake pipeline 1,602 → 234 ms cold (RTX), 382 ms on the Vega 8; lake fill 4.45 → 1.96 ms of the iGPU frame (−2.5 ms/frame), 0.79 → 0.20 ms on the RTX; tier masks within ±3 pts; no tiling; WebGL2 clean. Stage 2: flow from the fall **on** (motion direction measured), rim crust measured imperceptible (lever kept off), LUT deferred. | done | — | §0–0.1 of that doc |
| 2.8 | **Next slowest shaders**: lava-fall (0.34 s), Earth Core Standard materials (~0.47 s each, 3), `MeshBasicNodeMaterial_18` (0.41 s). Same diagnosis loop: label → material → emitted WGSL → which primitive. | ch1 compile ≤ 1.5 s | S each | per-pipeline timing hook |

### Phase 3 — Theme switch (first entry median 1.18 s, max 6.3 s golden-forest / 6.2 s koi-pond)

| # | item | expected | effort | gate |
|---|---|---|---|---|
| 3.1 | **Route every theme warm through the bound-compile recipe** (`compileGroupThroughPost`: post target + MRT held across the await, bounded pool) and delete the bare whole-scene `compileAsync` from the 12 post-pipeline themes. Mechanism (verified, corrected 2026-08-21): the builder-state key (`RenderObject.getMaterialCacheKey`) **includes the render-context id** (RenderObject.js:835; contexts are keyed by attachment formats + MRT), so a canvas-bound compile builds states the post pass's context never looks up — pure waste — and the scene pass then builds its own synchronously on its first frame. | −0.5…−4 s first entry on stellar-drift, ice-temple, chromadelic, stellar-velocity, neon-district, ocean, koi-pond, black-hole, golden-forest, cosmic-noir, chiral-gold, wolfhour; removes the first-post-frame freeze | M | new theme-switch lane: per-switch wall, `compile` mark, rAF max in first 5 s; screenshot per MRT theme |
| 3.2 | **Snapshot-and-crossfade switch**: `createImageBitmap(canvas)` in the same task as the outgoing theme's last render, paint as backdrop, dispose, fade on the new theme's first presented frame. Today the canvas is removed before the new theme is even imported. | black-gap → 0 ms on every switch | S–M | per-switch black-gap measure; screenshots mid-switch |
| 3.3 | **`init()` as a device-free prebuild stage** for asset-heavy themes (ocean ≈30 MB GLB, neon-district 15 + 24 MB textures, lunara 9 MB, stellar-drift 7 MB): fetch + decode in `init()` so adjacent/idle preload hides it; today all 13 `init()` overrides are no-ops and heavy themes are excluded from preload. | −0.5…−2 s first entry on heavy themes | M | `assets` phase mark |
| 3.4 | **Retire the theme-manager "final prewarm compile"** (bare `compileAsync` with a 3 s race that *abandons* an r185 build loop) and neon-district's live-loop bare compiles. | −0…−3 s boot-warm; removes the last "deferred builds under a live loop" hazard | S | theme-switch lane |
| 3.5 | **MaterialX noise sweep in themes** — same primitive swap as Phase 1 (calibrated simplex, layouts) at the 18 direct `mx_*` sites: winter (30 calls), fluid-dreams (19), tornado, stillwater, koi-pond, black-hole, synthwave-sunset, starlight. Measure first: the production matrix shows winter's first entry at 1.13 s, so this is a cold-Dawn-cache lever, not a headline one. `mx_worley_*` has no simplex twin — leave. | first-entry cold −0.3…−2 s on the noise-heavy themes (estimate; measure) | S per theme | 61/61 `capture:themes` before/after; per-theme eyeball; theme-switch lane cold cells |
| — | Shared `GPUDevice` across themes: **not** on 0.185.1 — `device.lost.then(closure)` pins every disposed renderer (the SB-15 mechanism). | negative | — | — |

### Phase 4 — Run fast (frame time)

Lane A (RTX 3070) is **not GPU-bound**: GPU p50 1.44 ms of an ~11 ms frame at ch1; no CPU profile
exists. Lane B (iGPU) is fill-bound (31 ms) and is where r185's GPU features buy frames.

| # | item | lane | expected | effort | gate |
|---|---|---|---|---|---|
| 4.0 | **Recover Lane B on this machine — zero code. CONFIRMED 2026-08-21: without `force_high_performance_gpu` Electron's default adapter here IS the Vega 8 (`amd / gcn-5`); `odyssey-pipeline-probe.mjs --low-power` selects it explicitly.** The 82JU's Vega 8 (PCI 1002:1638, GCN5) is present, enabled and *drives the panel* (hybrid mode). The "Lane B unreproducible" verdict came from a test in **Chrome**, which Windows pins to the RTX (`HKCU UserGpuPreferences chrome.exe → 2`) and whose page-level `powerPreference` Chromium ignores; the harness's **process-level** `force_low_power_gpu` (`odyssey-gpu-split.mjs --lane B --low-power`) was never tried on this machine. Assert `report.adapter.vendor === 'amd'` / architecture `gcn-5`. If it works, every "lane-B only, unmeasurable" item below becomes an admissible cell. | B | unlocks fill-cost pricing for the player population | S | adapter assertion in the report; 2022 AMD driver may trip Dawn — record the outcome either way |
| 4.1 | **CPU-profile the idle frame first** (chrome-devtools trace at the pinned ch1 station, 10 s): self-time of `_renderObjectDirect`, `Bindings._update`, `writeBuffer`, `updateMatrixWorld`, app update. Nothing below is admissible until this exists. | A | prerequisite | S | trace attached to the report |
| 4.2 | **DRS is bottleneck-blind**: it sheds resolution on wall frame time while the GPU is 13 % of the frame — blurs the board for zero gain at high-Hz targets. Gate resolution shedding on GPU time (timestamp lane exists). | A, look | no resolution loss when GPU < 40 % budget | S | perf-session `--target-frame-rate 165`: `renderScale` stays 1 |
| 4.3 | **FSR1 (EASU + RCAS) over `scenePass.setResolutionScale`** replacing the SharpenNode wrapper; floor 0.65 → 0.5. | B | −25…−35 % GPU at the floor | M | lane-A proxy (`?odysseyPixelRatio=2.5`) + Lane B when a machine exists; screenshots |
| 4.4 | **`renderGroup` for shared per-frame uniforms** (615 `uniform(` in Odyssey; zero `renderGroup`) — each mesh sharing a material re-compares and `writeBuffer`s its own UBO. | A CPU | 0.2–0.8 ms (unprofiled) | S | 4.1 before/after |
| 4.5 | **`reversedDepthBuffer: true`** on the Odyssey renderer (near 0.1 / far 9000 on 24-bit today → ~2.7 u resolution at 3 km; r185 flips to depth32float + reversed compare). Enables deleting z-bias lifts. | A+B, look | depth precision at distance; GPU 0 | S | gpu-split (draws/tris identical); far-foreground screenshots |
| 4.6 | **Supersample policy on lane A**: pixel ratio is clamped to `min(DPR, cap)` so a DPR-1 panel never exceeds 1.0 while the GPU idles. After 4.2. | A, look | sharper board for +1–2 ms GPU at 1.5× | S | gpu-split at 1.5×; screenshots |
| 4.7 | ClusteredLighting for neon-district (16–18 point lights; re-enables billboard lights on WebGPU). | B, look | iGPU lit-fragment cost | M | new theme timestamp cell; screenshots |
| 4.8 | `BloomNode.setResolutionScale` replaces 16 `setSize` monkey-patches; 7 themes still run 0.5 × 5 mips. | all | hygiene; B wins on the 7 | S/theme | screenshot A/B |
| 4.9 | **First-run GPU classifier feeding `deriveQualityTier`**: today the tier is screen-pixel-only (`desktop-performance-policy.js` — a 1080p iGPU boots as **Ultra**), the runtime ladders shed resolution only, and every "tier-gateable" feature above assumes a tier signal that does not exist. `adapter.info` (vendor/architecture) works in Electron 38 and the timestamp instrument exists — probe once, classify, persist. | B (players) | the only "fast" lever that reaches hardware the owner cannot benchmark | M | tier chosen on the 82JU under `force_low_power_gpu` ≠ tier on the RTX; Lane B cells per tier |
| — | Render bundles: **do not** on r185 — bundles execute after every direct draw in the pass; transparent ordering breaks. TAAU: deferred (needs a velocity MRT). | | | | |

### Phase 5 — Look better (r185 features mapped to themes that can use them)

| # | item | themes | effort | gate |
|---|---|---|---|---|
| 5.1 | **Shadow softness + bias retune under r185's Vogel PCF** (`shadow.radius` 1 → 2–3, `normalBias` up): both shadowed themes run the 5-tap disk at a 1-texel radius = hard, grainy edges. Cost 0. | golden-forest, neon-district | S | playground + theme capture |
| 5.2 | **`GodraysNode`** replaces golden-forest's painted god-ray plane (canopy-occluded shafts; sun is backlit, FogExp2 exists). | golden-forest (then neon-district) | M | playground effect, `?t=` shots, timestamp cost ≤ 0.6 ms |
| 5.3 | **Hero-crystal `dispersion` (+ iridescence)** on already-transmissive physical materials, Ultra/Extreme-gated. | lunara, ice-temple, fluid-dreams | S | playground; tune 0.2–0.5 |
| 5.4 | **GTAO + `denoise`** on `pass()` pipelines (contact shadows between stacked pieces). | neon-district, golden-forest, lunara, ice-temple, koi-pond | M | playground; ≤ 1 ms on A |
| 5.5 | `radialBlur` for the five hand-rolled radial marches; `bloom.setResolutionScale` hygiene; `Lut3DNode` grading consistency; `lensflare()` off the bloom buffer. | various | S each | screenshot A/B |
| 5.6 | **Classic-WebGL lane parity (upgrade debt, quantified)**: r185's `UnrealBloomPass` composite rewrite (premultiplied additive, `3.0` baked into rgb) brightens every classic bloom by ~1/S — ×1.4 (blood-moon) … ×3.6 (sunset) … ×5 (CosmicExploration bg, S=0.2) — across 14 classic-only themes + the intro WebGL path; transient pulses flatten from quadratic to linear. And the `Water.js` rework (`rf0` 0.3 → 0.02, ambient floor and `reflectionSample*0.9` removed) cuts crystal-cave's mirrored crystal glow ~12× and bioluminescence's ~5×. The 61-theme matrix passed *at a glance*; no retune has landed. Settle it with a **pixel A/B against the r181 worktree** (top-5 % luminance mean + mean Y per theme), then either retune `strength` (parity ≈ S²) / vendor r181's Water.js (verified viable, MIT, 373 lines) or record "new look accepted" per theme. | blood-moon, sunset, bioluminescence, crystal-cave, rainy-window, CosmicExploration, intro, + classic fallbacks | M | per-theme r181-vs-r185 pixel metrics; look call recorded per theme |
| — | `SSAONode` / `depthAwareBlur` do **not** exist in 0.185.1 (post-r185); SSR/SSGI need MRT normals/velocity — defer. | | | |

### Phase 6 — Debt that hides bugs

| # | item | effort |
|---|---|---|
| 6.1 | **winter is the neon-district bug, unfixed** (ADR-0019 class B): `isWebGPU = backend.isWebGPUBackend` gates ~20 `ShaderMaterial` twins + an `EffectComposer`; black on the WebGL2 backend. Same fix shape as neon-district. | M |
| 6.2 | **`?forceWebGL` holes**: starlight, shifting-sands, tornado, verdant-hills cannot be forced onto the WebGL2 lane by URL → the ADR-0019 matrix cannot cover them. neon-dusk leaks a WebGL2 context on its fallback path. ice-temple has a latent classic-material variant on a failed runtime init. | S each |
| 6.3 | **`THREE.Clock` → `Timer`** via a Clock-semantics shim (60 constructions; Clock warns on *every* construction = 63 % of all warnings in the 61-theme matrix, drowning real ones). | M |
| 6.4 | **Wrong-version instancing folklore** in 7 live comments ("r181 applies the instance matrix before `positionNode`" — the plan proved the opposite; they describe r185 mislabelled). Rewrite. | S |
| 6.5 | `frustumCulled=false` bulk (454 sites) and per-frame allocation stragglers — A/B per ADR-0016 before any claim. | M |
| 6.6 | **Electron 38.8.6 (Chromium 140) is EOL since 2026-03-10** and predates Chromium 141's Tint IR completion and 144's 2× `writeBuffer`. An Electron → 43.x A/B with three held at 0.185.1 is cheap to run. Caveat from §1: the lava-lake cost was in **DXC**, not Tint (Chrome 151, which already has Tint IR, still took 7 s), so do not expect it to fix shader-compile poles — measure `compiles`, theme `firstTargetSelection`, idle GPU p50 (must not move). Prerequisite: the perf manifest records `process.versions.{electron,chrome}` and a page-side adapter probe — today `manifest.gpu` is **always null** because three 0.185.1's `WebGPUBackend` never stores `adapter`. | S (bump) + instrument fix |

### Phase 7 — App boot (before Odyssey; added 2026-08-21)

The r185p1world cells left the 0.66–0.69 s app-boot task in `main.js` as the largest task in every
cell. Profiled under ELECTRON (a new `--cpu-profile` on the session: CDP Profiler attached on
`did-navigate`; Chrome 151 traces of the same build showed a different, faster picture) and
researched with a 4-lens + 2-design + critique workflow.

| # | item | expected | effort | gate |
|---|---|---|---|---|
| 7.1 | **The menu's first `AudioContext` blocked the boot for 346 ms — DONE.** 621 of 623 ticks of `SoundManager.resumeAudioContext` sat on `new AudioContext()`: the audio service starting while the GPU process starts (60 ms in a bare Electron window). The first track switch forced the analyser graph synchronously before `play()`; the analyser (music-reactive visuals) is not needed to hear the music, so the first context attaches at idle (≤ 2.5 s). Measured: 21 ms at t ≈ 3.8 s. `?audioAnalysisSync=1` restores the old order. | −346 ms boot | done | Electron cpu profile: no `resumeAudioContext` ticks before the menu |
| 7.2 | **The production boot evaluated essentially the whole game — DONE (structural).** Rollup's function-form `manualChunks` absorbs every unclaimed static dependency of a manual-chunk root, so shared modules (`constants.js`, `viewport.js`, the Odyssey palette behind the custom cursor, the intro config, Vite's preload helper) were captured by lazy theme/mode chunks and main statically imported three, Phaser, the Odyssey mode chunk and all 60 theme chunks: **75 chunks / 9.8 MB** before the menu, modulepreloaded by the loader. Fix: `output.onlyExplicitManualChunks`, the preload helper pinned to `app-runtime`, theme/mode rules restricted to runtime JS, `base-theme.js` out of the three-importing `theme-shared`, theme-imported playground effects assigned to their theme, no rendering-phaser/canvas chunks (cycles), the breathing renderer loaded on first use, and the **playground removed from the production inputs** (Rollup places a dynamically imported module into the chunk that already imports it statically — Odyssey's lazy chapter loads ran the playground's init). `scripts/check-boot-closure.mjs` guards it on every `npm run build`. **Result**: entry closure 2.19 MB → 12 KB, main's 9.8 MB → **0.8 MB / 3 chunks**, the first boot task 438–572 → 115–179 ms, ~370 ms less main-thread work around the menu. **Honest limit**: V8 compiles streamed chunks off-thread and lazily, so 9 MB less JS is a structural/memory win, not a proportional startup win; menu-visible moved only ~1,175 → ~1,100 ms, and three's evaluation (needed by every mode/theme) is now requested first thing in `bootstrap()` so a click the instant the menu appears does not pay it serially. | structural: boot parses 0.8 MB not 9.8 MB | done | `check-boot-closure` in `npm run build`; `browser.boot` milestones |
| 7.3 | **Protocol: the ledger measured an impossible click.** The session activated Odyssey the instant `gameModeManager` existed — before the menu was painted — so every idle-time deferral (7.1, the three warm) was counted against the Odyssey startup instead of before it (dev cold 4,704 vs 4,224 ms with a 1.5 s dwell). From 2026-08-21 the ledger runs with `--menu-dwell 1500` (`ODYSSEY_PERF_MENU_DWELL`): wait for the visible menu, then a player's reaction time. Cells `r185p1world2` (the 2.1 tree re-measured under the dwell) and `r185p1boot` (7.1 + 7.2) are the comparable pair; older cells are immediate-activation. **Measured (n = 3 medians, dwell 1.5 s, `r185p1world2` → `r185p1boot`)**: cold startup 4,263 → 4,231, board visible 5,190 → 5,237, launch-to-board 8,656 → 8,805; warm 3,556 → 3,529, launch-to-board 7,504 → 7,434; menu-visible 1,341 → 1,335 cold / 1,159 → 1,118 warm — all inside the cells' spread. The boot work is neutral on the Odyssey cells by construction: its effects (the 346 ms stall right after the menu appears; 9.8 → 0.8 MB of JS at boot) sit outside what these cells measure. Note the dwell protocol's own artefact: the immediate-activation `r185p1world` cells are ~250 ms faster than `r185p1world2` because a 1.5 s dwell lands right before the +2 s deferred-task release. | honest cells | done | `AGGREGATE.md` protocol note |
| 7.4 | **Next in this phase**: the `retry-veil` shared chunk (343–395 ms task during Odyssey activation — find what Rollup put there), Phaser's `Game` creation before the menu (Phaser 1.6 MB + a second WebGL context ≈ 300 ms; needs `ensurePhaserGame` inside `activateMode` because every harness calls it directly), the 115–179 ms first task (HTML/CSS/manifest parse: 163 KB index.html, 25 stylesheets, 109 KB manifest JSON parsed on the main thread). | −0.3…−0.6 s boot | M | boot milestones |

## 4. Protocol

- **Every perf claim**: `reports/odyssey-perf/rtx3070-r181-vs-r185/perf-driver.sh` (process per run,
  n ≥ 3, median + range, content match on draws/tris), aggregated next to the existing r181/r185
  cells. In-browser instruments are for *diagnosis* (they found the lake); the driver is for
  *claims*. **Nothing else may be rendering on the GPU during a driver run** — a Chrome tab left on
  the Odyssey board inflated idle p50 11.6 → 13.0 ms and contaminated a whole r185p1 sweep on
  2026-08-21 (blank the tab; the session now records the adapter so the lane is auditable).
- **Diagnose in the player lane**: Chrome 151 and Electron 38 (Chromium 140) have different Dawn
  vintages and cache states; a Chrome finding is a hypothesis until the Electron instrument
  (`odyssey-pipeline-probe.mjs` or the session's `browser.pipelines`) confirms it.
- **Every visual change**: playground first where an effect is new; a seeked, frozen-clock
  station (`odyssey-chapter-capture.mjs --time 9`, `--url-flag` for the A/B lever) or the
  Electron theme matrix for anything that touches a shipped surface; console clean of WebGPU
  validation errors.
- **Shader-compile regressions are now cheap to catch**: wrap `createRenderPipelineAsync` in an
  `initScript`, sort by duration, read the label. Any single pipeline over ~1 s is a bug in the
  shader, not in three.
- **New TSL rule** (added to the skill): a shared helper `Fn` **must** carry `setLayout`; never use
  `mx_noise_*` / `mx_fractal_noise_*` for anything evaluated more than a handful of times per
  fragment.

## 5. Execution log

- **2026-08-21** — Phase 1 landed and measured (§2.1). Findings on the way, each by experiment:
  the lava lake's 7.2 s MaterialX compile (§1.3); layout-less `Fn` inlining (§1.4); the inverted
  `compileAsync` call and the parallelism it had accidentally provided (§1.5–1.6) → fan-out with
  three's builder identity as the bucket rule (two wrong bucket rules measured and rejected);
  Electron defaults to the iGPU here without `force_high_performance_gpu` (Lane B recoverable);
  a Chrome tab on the board contaminated a sweep (protocol §4); warp pre-init compiled GLSL
  synchronously (2.10, fixed); background chapter creation invalidates every pipeline via the
  light set (2.9, diagnosed, open). Instruments: session records adapter + every pipeline
  creation; `odyssey-pipeline-probe.mjs`; aggregator takes N tags. Chapter A/B captures (§2.2).
  Upstream Issue 1 withdrawn. Research reports' ranked tables are §3.
- **2026-08-21 (later)** — 2.9 closed: light pool v2 (virtual lights + 9 slots; v1's 18 resident
  lights measured and rejected), lights skipped by the reveal traversals, compile at the scene
  pass's call depth, the r185 deferred-drain `side` regression worked around, the board's own
  presentation prewarmed. First live post frame: 45–52 sync creations → 5. Upstream Issues 3 and 4
  drafted (`UPSTREAM_THREE_R185_ISSUES_READY_TO_FILE.md`). Renderer-level key trace added to the
  session. Next: 2.11 (background warms still sync), 2.12 (Bloom passes), then 2.1.
- **2026-08-21 (evening)** — 2.12 (bloom variant warmed pre-reveal, 21 ms) and 2.11 landed: background
  chapters now compile UNDER the live loop through per-item read interception (design doc
  `ODYSSEY_BACKGROUND_COMPILE_2026-08.md`, researched by a 4-lens + 2-design + critique workflow; the
  critique's amendments are in, its runtime backing-assertion was tried and reverted). Sync pipeline
  creations after the reveal: 78 → 0. Upstream Issue 5 drafted. **Measured (n = 3 medians, `AGGREGATE.md` r185p1live vs r185p1light)**: sync creations after the reveal 0 in all nine cells; load post-reveal p99 cold 573 → 265 ms, warm 574 → 172; idle long-task total 13.7 → 9.9 s; startup/board-visible flat (cold 5,580 / 6,615, warm 5,349 / 6,269). Next: 2.1 (world bake off
  the critical path — the 1.7 s long task is now the largest frame in every cell), then the
  `forceSinglePass` audit of the flat two-pass cards (startup +3 % from 2.9), then 2.2–2.5.
- **2026-08-21 (night)** — 2.1 landed: One World bakes in a Worker started before the renderer
  (profile → 4-lens research → worker design with the critique's amendments; placeholder phase
  deliberately not adopted, see the design doc §2.4). Cold startup 5,580 → 4,008 ms (−43 % vs
  r181), world 1,737 → 195, the 1.7 s long task gone. Next: the app-boot `main.js` long task
  (0.68 s, now the largest in every cell — outside this plan's Odyssey scope but the obvious
  follow-on), 2.4 (`nodes` yield latency + the level-icon `getImageData` readbacks, ~0.45 s of
  callbacks), 2.2/2.5, the forest scatter into the worker, an IndexedDB bake cache.
- **2026-08-21 (late)** — Phase 7 (app boot) opened and 7.1–7.3 landed: the first AudioContext
  at idle (−346 ms on the boot path, Electron-only contention); the production chunk graph
  un-absorbed (main's boot closure 75 chunks / 9.8 MB → 3 / 0.8 MB; playground out of the
  build; `check-boot-closure` guard); the ledger protocol corrected to a 1.5 s menu dwell after
  finding that immediate activation punished every idle-time deferral. **Measured (n = 3 medians, dwell 1.5 s, `r185p1world2` → `r185p1boot`)**: cold startup 4,263 → 4,231, board visible 5,190 → 5,237, launch-to-board 8,656 → 8,805; warm 3,556 → 3,529, launch-to-board 7,504 → 7,434; menu-visible 1,341 → 1,335 cold / 1,159 → 1,118 warm — all inside the cells' spread. The boot work is neutral on the Odyssey cells by construction: its effects (the 346 ms stall right after the menu appears; 9.8 → 0.8 MB of JS at boot) sit outside what these cells measure. Note the dwell protocol's own artefact: the immediate-activation `r185p1world` cells are ~250 ms faster than `r185p1world2` because a 1.5 s dwell lands right before the +2 s deferred-task release.
- **2026-08-22** — 2.4 landed (task yields + the icon atlas), then two follow-ons the profile
  pointed at: 2.13 (the `forceSinglePass` audit — 21 flat transparent materials stopped compiling
  and drawing a second pass) and 2.14 (the forest scatter into the bake worker). Cold startup
  4,231 → **3,209 ms** and board visible 5,237 → **4,212** (n = 3, dwell protocol), i.e. −1.0 s on
  top of everything before. Honest note: 2.4 by itself moved little wall-clock — the yield latency
  had been HIDING the compile barrier, which is why 2.13 mattered and why 2.15 is now the item.
  **Measured (n = 3 medians, dwell protocol, `r185p1boot` → `r185p1forest`)**: cold startup 4,231 → 3,156 ms, board visible 5,237 → 4,148, frame max 617 → 467; warm 3,529 → 3,145; idle 4,032 → 2,993 and board visible 5,028 → 3,937. Buckets (cold): nodes 1,029 → 90, world 390 → 160, compiles 1,508 → 1,747 (it stopped hiding behind the yields).
- **2026-08-22 (later)** — 2.15: One World compiles after the reveal through item 2.11's live-loop
  path. Cold startup 3,156 → 2,847 ms and board visible 4,148 → 3,850 (n = 3). The first cut also
  deferred corridor + breach and the ledger said no — the warm-up replay renders the whole scene,
  so a deferred group compiles synchronously inside it. Recorded rather than quietly narrowed:
  the trap is the reason the split is what it is. Next is 2.16.
- **2026-08-22 (evening)** — three experiments, three negative results, one finding. Compile
  fan-out width 20 (relabels main-thread node building, total +491), deferring corridor+breach
  (warm-up replay compiles them serially, total +264 — see 2.15), and the GPU device warm
  (`renderer` 323 → 42 ms, total +420 because that await was free bake time). All are recorded
  with their cells rather than deleted: together they say the startup is bake-bound, which is what
  2.16 now attacks. The device warm ships behind `?gpuWarm=1`, ready for the day the bake starts
  at menu time; `?odysseyCompileWidth=N` and `?odysseyBakeBands=N` stay as instruments.
- **2026-08-22 (late)** — row 2.16 lever (a), the menu-time world bake, was measured as an
  upper-bound spike and **rejected**: +1,166 ms alone, +938 ms paired with the device warm,
  against a ship gate of −250 ms. The bake runs ~2.3× slower in the menu window than at board
  t=0 and its workers steal the compile pool's cores. An adversarial design review caught, before
  any of it was measured, that the two-phase loader written for this row dropped the scatter
  worker's reply on the join path and would have hung Odyssey permanently — the four unit tests
  written alongside it all passed, because a fake Worker that never replies never reaches the
  broken line. Lesson recorded: a worker stub that only records jobs cannot test a protocol.
  (numbers: AGGREGATE.md r185p1spike / r185p1spikegpu)
- **2026-08-23** — `compiles` re-measured from the inside and the model corrected: it is ~76 ms
  PER MATERIAL, not node-building time (node building is ~125 nodes/ms, ~50–65 ms for all of
  chapter 1). First material deleted — the selenite chapel now shares the node pockets' molten
  material — for **cold 2,847 → 2,749 ms**. An adversarial review killed the three larger
  node-count proposals, two of which would have shipped invalid WGSL (row 2.16c); that trap is
  now pinned by a test with a positive control. Also fixed a latent hang found in the same pass:
  `?odysseyBakeBands=1` terminated the host worker mid sun-march and the board waited forever.



