# Odyssey Mode — Best-in-Class Performance Optimization Plan

> Target: a 3D cinematic level-select journey (`src/rendering/odyssey/`) — a camera dollies a
> spline through 8 themed chapters on three.js (~r0.181) `WebGPURenderer` + TSL `NodeMaterial`,
> finished with a single-pass post graph (CA → bloom → ACES → master grade → vignette → grain,
> plus a ch7 gravitational-lensing UV warp). **The user reports it lags badly and feels buggy.**
>
> This plan synthesizes 4 code-investigation audits + 3 web-research briefs into one prioritized,
> ship-it-in-waves program. Every claim below was spot-verified against the source on
> 2026-06-07 (line numbers are accurate as of this branch).

---

## 1. Executive Summary — Honest Diagnosis

"Lags **and** feels buggy" is two distinct problems with opposite fixes:

- **Lag** = steady low FPS = **GPU fill-rate bound** (overdraw + a heavy always-on post stack at 4× MSAA).
- **Buggy** = periodic hitches = **CPU stutter** = shader/pipeline **recompiles at chapter seams** + **per-frame GC** + per-frame attribute re-uploads.

The good news: the residency system **already gates per-frame draw and update by `group.visible`**
(`ChapterEnvironmentManager.updateVisibility` sets `env.group.visible=false` when crossfade opacity
hits 0; corridor field early-outs hidden chapters). So in steady mid-chapter state only ~1–2 chapters
render — the lag is **not** "8× everything." It is dominated by (a) what the *visible* chapter costs in
overdraw + draw calls and (b) the unconditional post + MSAA cost paid on every frame in every chapter.

### Top 5 Root Causes (quantified)

| # | Root cause | Magnitude | Type |
|---|-----------|-----------|------|
| 1 | **4× MSAA on a full-res HalfFloat scene PassNode** (`antialias:true`) + **~13 full-screen post passes/frame** (12 bloom + 1 mega-pass) at ~1.25× DPR, with **no dynamic resolution** | Scene pass ≈ 4× rasterization/bandwidth; post is a constant per-pixel tax in **all 8 chapters** | GPU fill |
| 2 | **Stacked large additive `depthWrite:false` `frustumCulled:false` planes** — atmosphere dome + 3 corridor sheets + chapter domes + per-chapter cloud/nebula/godray/haze. At a seam, **20+ near-fullscreen additive FBM layers** overlap | The classic fill-rate multiplier; **the single biggest lever** | GPU fill |
| 3 | **Chapter-seam shader recompiles**: (a) the visible **light set changes** at every seam → `LightsNode.customCacheKey` re-resolves every lit material; (b) `setGroupOpacity` flips `material.transparent` + sets `needsUpdate=true` mid-crossfade → pipeline recompiles. **This is the "buggy at transitions" report.** | Multi-ms → 100s-of-ms hitch **exactly at each boundary** | CPU stutter |
| 4 | **Per-frame GC churn**: `resolveChapterBlendState` runs ~2×/frame allocating ~25–50 transient objects (nested spreads in `getChapterBoardTransition`); `LevelNodeManager.update` allocates per-node `Vector3`/array/`Color` across 55 nodes; `OdysseyPathRenderer` allocates ~8 `THREE.Color`/frame even when idle | Sawtooth heap → periodic GC pauses | CPU stutter |
| 5 | **Un-instanced draw-call hotspots on the visible chapter**: Urban = **240 Box towers, each a unique `BoxGeometry` + a freshly-created facade `NodeMaterial`** (~240 draws + ~240 programs); Black Hole ~55 draws; Deep Ocean jellyfish = 24 Groups × 3 meshes (~72 draws) | Largest single draw-call + shader-compile source when that chapter is visible | CPU submit + compile |

### The single highest-impact fix

**Drop scene-pass MSAA from 4× and wire in the dynamic-resolution controller that already exists.**
Set `antialias:false` on the `WebGPURenderer` (rely on the post pass for AA), and call
`evaluateDynamicResolutionAdjustment` (already in `desktop-performance-policy.js:233`, never called by
the board) from the frame loop so render scale sheds under load. Because *every* fill-bound cost
(scene, the 20+ additive layers, the ~13 post passes) scales with pixel × sample count, this one
change attacks the steady lag globally for near-zero visual loss in a post-graded pipeline. It is also
the lowest-risk and the fastest to ship.

---

## 2. Measured / Estimated Cost Table — Biggest Hotspots

| Hotspot | Why expensive | File(s) | Est. impact |
|---------|---------------|---------|-------------|
| **4× MSAA on full-res HalfFloat scene RT** | Every scene fragment shaded with 4 coverage samples into a 16-bit-per-channel offscreen target at ~1.25× DPR, then resolved ≈ 4× rasterization + bandwidth. In a post-composited pipeline MSAA buys little vs FXAA/SMAA. | `OdysseyBoardController.js:571` (`antialias:true`) → `three/.../PassNode.js:698` (RT inherits `renderer.samples`) | **High** |
| **Stacked additive fullscreen-ish planes (overdraw)** | No early-Z; every covered pixel re-shaded by many additive FBM layers each frame; none frustum-cullable. At a seam 20+ layers stack. | `composition/odyssey-corridor-field.js:265-268` (3 sheets, `frustumCulled=false`), `OdysseyAtmosphere.js:38,69` (dome r=4000), `sky-drift.js` (10 cloud strata + ~96 deck sprites) | **High** |
| **~13 full-screen post passes/frame** | 12 bloom (1 high-pass + 5 mips × 2 blur dirs + composite) + 1 combined output pass (CA 3-tap + lensing + bloom add + ACES + 2-stage grade + vignette + grain), all at full internal res, no dynamic res. | `odyssey-tsl-pipeline.js:269-382`; `three/.../tsl/display/BloomNode.js:296-335` (`_nMips=5`) | **High** |
| **Seam light-set churn → material re-resolution** | `LightsNode.customCacheKey` hashes each active `light.id`; both adjacent chapter groups are visible during crossfade, so the active light set changes at every seam, nulling `_lightNodes` and re-resolving every lit material. | `three/.../nodes/lighting/LightsNode.js:117-143,407-412`; `ChapterEnvironmentManager.js:713-714` | **High** |
| **`material.transparent` flip + `needsUpdate=true` during crossfade** | Toggling `.transparent` invalidates the cached pipeline → recompile mid-fade. Runs across many env materials per seam. | `ChapterEnvironmentManager.js:790-801` (`setGroupOpacity`) | **High** |
| **Urban: 240 unique tower meshes + 240 fresh materials** | ~240 draw calls + ~240 unique shader programs + 240 geometries, zero instancing/sharing. Largest draw-call + compile source when ch8 visible. | `urban-dreams.tsl.js:246-289` (`createCityBlocksTSL`) | **High** |
| **Earth Core: 14 non-shadowed PointLights active** | WebGPU forward lighting loops every light per lit fragment; ~8× the lighting ALU of a 3-light chapter, on the **opening** chapter the user sees first. | `earth-core.js:856-869` (≤8 magma bounce), `883-907` (4 accents + lava + glow) | **High** |
| **`resolveChapterBlendState` ~2×/frame, ~25–50 transient allocs** | Nested object spreads in `getChapterBoardTransition`/`getChapterTransitionForChapter`, per boundary, in both `resolveEcotoneOverlap` and the seam loop; recomputed redundantly inside `updateGlobalEnvironment`. | `ChapterEnvironmentManager.js:256-354,198-203,875`; `chapter-profile.js:428` | **High** |
| **`LevelNodeManager.update`: per-node allocs + 7040-particle re-upload/frame** | Per visible node allocates a 3-`Vector3` `starPositions` array + `.clone()`s + scale `Vector3` + fallback `Color`; unconditionally flags 3 instanced attributes `needsUpdate=true` (full GPU re-upload of 55×128 particles). | `LevelNodeManager.js:884-1027` (allocs 958, 968-972, 978-981, 1003) | **High** |
| **Black Hole: ~55 draws + per-frame camera-lock + shard re-upload** | 25 meshes from 5 motifs × 5, 9 infall tubes, ~20 unique disk/shell programs; per frame: `getWorldDirection`+2 cross+4 normalize+`lookAt`+`rotateX/Z`, 9-stream retarget, element-wise rewrite of the shards `aBase` Float32Array + `needsUpdate`. | `black-hole-transcendence.js:225-299,343-395,515-629` | **Medium** |
| **No dynamic resolution wired into the board** | `evaluateDynamicResolutionAdjustment` exists (downscale @1.14×, upscale @0.9×, 6s/12s cooldowns, 0.5–1.25 clamp) but the board pins a static ratio at init/resize only. | `desktop-performance-policy.js:233`; `OdysseyBoardController.js:561-566,980-985` | **Medium** |
| **Post lensing/CA math runs every pixel in all 8 chapters** | ch7 lens warp + hero-CA collapses to no-op via `uLensStrength=0` *multiply*, not a branch; ALU still executes per pixel everywhere. | `odyssey-tsl-pipeline.js:273-313` | **Medium** |
| **`frustumCulled=false` ~54× across 19 files** | Off-screen + behind-camera content in a visible group still submitted every frame; backdrop sheets/domes can never be rejected. | corridor-field `192,249,267,303,330`; ocean/mountain/urban/sky billboards | **Medium** |
| **Per-frame full attribute re-uploads via JS loops** | Mountain snow 1000, sky wisps 380, urban rain 480, BH shards 220 — element-wise loop + `needsUpdate=true` = CPU loop + full GPU upload each frame. | `mountain-peaks.js:592-608`, `sky-drift.js:318-333`, `urban-dreams.js:477-489`, `black-hole-transcendence.js:620-629` | **Medium** |
| **Deep Ocean jellyfish: 24 Groups × 3 meshes (~72 draws)** | Un-instanced Sphere(24×16)+Sphere(16×12)+Sprite per jelly, own material each, per-jelly CPU loop + 3× `getObjectByName` scene-walk/frame. | `deep-ocean.js:276-357,514-543` | **Medium** |
| **High-segment static geometry resident permanently** | Path tubes ~38k verts (radial/tubular 32/480, 24/480, 20/480 + `computeFrenetFrames(480)`); Mountains 7× `Plane(128,128)` ≈116k verts; Surface landscape/bridge/peaks. | `OdysseyPathRenderer.js:137-192`; `mountain-peaks.tsl.js:116-141` | **Medium** |
| **`OdysseyPathRenderer` allocates ~8 `Color`/frame (even idle)** | `getChapterColor` does `new THREE.Color()` per marker inside an 8-ring `forEach` on the always-on path; `applyTransitionUniforms` allocates a `[...].filter(Boolean)` array per call. | `OdysseyPathRenderer.js:301-305,424-433,475-480` | **Low** |

---

## 3. QUICK WINS (high impact / low effort — ship these first)

Batch 1. Each is independent, low-risk, and targets a confirmed root cause. Expected combined result:
the largest single FPS recovery in the program, plus elimination of the seam hitch.

| # | What | File(s) | Expected win |
|---|------|---------|--------------|
| QW1 | **Drop scene MSAA.** Set `antialias:false` on the renderer (or pass `{samples:2}` to the scene pass). Post AA (ACES/grade/grain already soften edges). | `OdysseyBoardController.js:571` | Removes the ~4× sample multiplier on the whole scene pass — **biggest steady-state GPU win.** |
| QW2 | **Wire dynamic resolution.** Feed board frame times into `evaluateDynamicResolutionAdjustment`; on `changed`, call `renderer.setPixelRatio(computeScenePixelRatio({renderScale: next, sceneType:'odyssey', ...}))` + `postProcessingStack.resize(...)`. Debounce; never per-frame. | `OdysseyBoardController.js` frame loop; `desktop-performance-policy.js:233` | Heaviest chapters (ch7) degrade gracefully instead of lagging. Universal fill-rate backstop. |
| QW3 | **Lower the odyssey pixel-ratio cap.** Reduce `maxPixelRatio` 1.5 → ~1.2 and/or the per-tier `odyssey` caps (currently 1.0–1.25). | `OdysseyBoardController.js:564`; `desktop-performance-policy.js:20-58` | Large low-risk win — the heavy grade/grain masks resolution loss. |
| QW4 | **Kill the seam recompile (lights).** Stop toggling `group.visible` on groups *containing lights*. Pull all chapter lights into ONE persistent fixed-count rig and crossfade `light.intensity` by chapter weight (you already crossfade ambient this way). Mesh/particle groups can stay `.visible`-toggled — it is specifically lights that recompile. | `ChapterEnvironmentManager.js:713-714`; per-chapter light authoring | **Eliminates the "buggy at transitions" hitch.** |
| QW5 | **Kill the seam recompile (transparency flip).** Build all fade-eligible env materials `transparent:true` permanently and drive only the `uOpacity` uniform path; remove the `material.transparent` flip + `needsUpdate=true`. | `ChapterEnvironmentManager.js:790-801` | Removes pipeline recompiles mid-crossfade. |
| QW6 | **De-duplicate blend-state.** Pass the existing `blendState` from `renderFrame` into `updateGlobalEnvironment` so `resolveChapterBlendState` runs **once/frame, not twice.** | `ChapterEnvironmentManager.js:875`; `OdysseyBoardController.js:1137,1174` | Halves the heaviest GC source. |
| QW7 | **Cache per-chapter transitions.** `getChapterBoardTransition`/`getChapterTransitionForChapter` return static-per-`chapterId` data via 2 spreads each call — precompute a frozen 8-entry table once and return cached objects. | `ChapterEnvironmentManager.js:198-203`; `chapter-profile.js:428` | Removes the largest per-frame transient-alloc source. |
| QW8 | **Instance the Urban towers.** Replace 240 Box meshes + 240 fresh materials with ONE `InstancedMesh` sharing one facade material + per-instance attributes (seed/cols/rows/size). | `urban-dreams.tsl.js:246-289` | ~240 draws + ~240 programs → ~1. Biggest FPS win when ch8 is visible. |
| QW9 | **Cut Earth Core lights.** Cap to ~2–3 key PointLights (lava + one glow); bake the 8 magma-bounce + 4 crater accents as emissive material color. | `earth-core.js:856-869,883-907` | ~10 fewer per-fragment light iterations on the **opening** chapter. |
| QW10 | **Re-enable frustum culling on bounded set pieces.** Remove the explicit `frustumCulled=false` on corridor backdrop **sheets**, BH secondary motifs, ocean creatures/kelp, sky cloud decks, urban towers/haze; give each a valid bounding sphere. Keep `false` ONLY on the dome and camera-locked follow-particulate + BH hero. | corridor-field `265-268`; per-chapter billboards (54 sites) | Free draw-call + overdraw reduction for off-screen content. |
| QW11 | **Hoist `LevelNodeManager` allocations + gate re-uploads.** Move the `starPositions` Vector3s, lock-scale Vector3, and fallback Color to reused scratch; replace `.clone()` with `.copy()`; only set particle/instance `needsUpdate=true` behind a dirty flag (hover/select/visibility/progress delta). | `LevelNodeManager.js:884-1027` | ~7 allocs/visible-node/frame gone + no 7040-particle re-upload when nothing changed. |
| QW12 | **Cache `OdysseyPathRenderer` colors.** Precompute a per-chapter `THREE.Color[]`; build the `applyTransitionUniforms` targets array once as a member. | `OdysseyPathRenderer.js:301-305,475-480` | ~8 `Color` + 1 array alloc/frame gone, including idle path. |
| QW13 | **Reduce bloom mips 5 → 3.** Radius is small (0.7); high mips contribute little. Saves 4 of the 12 bloom passes. | `BloomNode` construction in `odyssey-tsl-pipeline.js:215-220` | ~30% off the bloom cost, no visible change. |
| QW14 | **Honor `enableBloom:false`.** Minimal preset sets it but the TSL pipeline ignores it; skip the bloom node entirely on that tier and on dark/low-key chapters (Deep Ocean, Black Hole void) when bloom weight ≈ 0. | `odyssey-tsl-pipeline.js`; `OdysseyBoardController` presets | Removes 12 passes/frame when bloom can't contribute. |

> **Note on overdraw (QW-adjacent, ship in batch 1 if cheap):** also instance Deep Ocean jellyfish
> (`deep-ocean.js:276-357`) into the chapter's existing billboard system, and trim the corridor sheet
> count from 3 → 2 per chapter where the field reads as a mass. See §3b for the structural versions.

---

## 3b. STRUCTURAL Fixes (bigger lifts, larger ceilings)

### Instancing / BatchedMesh / merged geometry — target < 100 draw calls/frame
- **Urban towers → `InstancedMesh`** (also QW8). For varied tower geometry sharing one neon material, `BatchedMesh` (r150+ `multiDraw`) is the alternative. `urban-dreams.tsl.js:246-289`.
- **Black Hole motif chain** → instance the repeated sub-parts. 5 motifs × (horizon + disk + photon ring + halo + lens shell) = 25 meshes; share ONE accretion-disk material + ONE lensing-shell material with per-instance uniforms instead of ~20 unique programs. Infall = 9 separate `TubeGeometry` → instanced or merged. `black-hole-transcendence.js:225-299,343-395`.
- **Deep Ocean jellyfish** → instanced billboard impostors with a shared material (60 spheres + 20 sprites → 1 instanced system). `deep-ocean.js:276-357`.
- **Static set pieces** → `BufferGeometryUtils.mergeGeometries` for same-material static meshes (sky ray-fan blades, traffic trails, ground-haze planes).
- Material sharing already done well: the 6 god-ray cones share one material; the corridor particulate and BH shards/starfield are instanced — **extend that pattern**, don't reinvent it.

### Async shader precompile — kill first-use hitches
- Switch `_prewarmChapterEnvironment` from `compileAsync(scene, camera)` (compiles the **entire** scene with that chapter force-shown — redundant work that grows with 8 chapters, and the temporary `visible=true` can spike a frame) to the **targeted** form `compileAsync(scene, camera, env.group)` so each prewarm builds only that group's pipelines. Keep the `frustumCulled` override only for the compile duration. `OdysseyBoardController.js:521-558`.
- Pair prewarm with the **residency window** (below) so you're not prewarming all 8 up front.

### Overdraw reduction — the prime fill lever (research-backed)
- **Half/quarter-res off-screen transparency pass.** Render the heavy low-frequency translucency (corridor sheets + particulate, atmosphere, god-rays, nebula, cloud strata, haze) into a dedicated ½–¼-res color target, then upsample/composite over the opaque scene *before* the post graph's CA/bloom sample. NVIDIA GPU Gems 3 measured **25→61 FPS (2.4×)** on fill-bound particle scenes with 4×4 downsampling. Use a **MAX-of-region** depth downsample to avoid halos; keep pinpoint content (starfield, neon edges, BH photon ring) full-res. **This is the single biggest structural lever for Odyssey.**
- **Fewer-bigger additive layers.** One richer FBM layer beats many faint overlapping ones. Cut corridor sheets 3→2 per chapter, Sky 10 cloud strata → fewer, tighten radial feather so sheets cover fewer pixels.
- **Bake FBM to a texture.** `createCorridorSheetMaterial` recomputes `fbm2` *per pixel per layer every frame* although the noise is static — sample a precomputed `CanvasTexture`/`DataTexture` instead. `composition/odyssey-corridor-field.tsl.js`.
- **Alpha-trim / discard.** Round particulate feathers corners to 0 but still shades them — add `discard` when alpha < ~0.01; reshape big sprites toward an n-gon fan hugging the silhouette.
- **Dual-filter (Kawase) bloom** for an equal-looking but ~1.5–3× cheaper wide glow; drop bloom working res to ¼ (`bloomScale 0.25`) — bloom is low-frequency, quarter-res is usually indistinguishable.

### Depth / soft particles
- **Soft particles:** fade sprite alpha near intersections with opaque set pieces (sample scenePass depth) — removes hard seams against the leviathan/peaks/towers AND reduces the overdraw spike where the sprite would paint a full layer over the set piece. Compare against the MAX-downsampled depth from the half-res transparency pass.
- Keep **additive** (order-independent — no back-to-front sort) for glow layers; keep `depthTest:true`.

### LOD + a real residency / visibility window
- **Residency window:** keep only `[active-1, active, active+1]` chapters built; dispose/rebuild far ones on approach (the manager already has `createChapterEnvironment` + `dispose` + `prewarm` + background-load plumbing — extend it to **unload** distant chapters). Cuts VRAM, resident shader-program count, init compile time, and the worst seam double-cost by ~3–4×.
- **Geometry LOD:** drop path tubes 32/480 → ~16/256 (or merge core+glow into the outer material); Mountains/Surface displacement planes 128×128 → 64×64 (silhouettes barely change — sheds ~80–100k resident verts).
- **Tighten ecotone/seam bands on lower tiers** (`ECOTONE_SPAN_FRACTION 0.18`, corridor `SEAM_OVERLAP`/`SEAM_CARRY`) so fewer chapters render simultaneously across a seam.

---

## 4. ADAPTIVE QUALITY SYSTEM (best-in-class)

Goal: one codebase that serves a weak laptop iGPU and a 4090 by reacting to **measured frame time** —
scaling resolution → particle/instance counts → effects → light count → post features across the
existing `Minimal..Extreme` presets, with hysteresis so it never oscillates.

### 4.1 The controller (`OdysseyAdaptiveQuality`)
A small runtime module owned by `OdysseyBoardController`, ticked once per second from the frame loop:

1. Maintain a rolling window (~20–60 frames) of frame times; compute **p95/p99**.
2. Call `evaluateDynamicResolutionAdjustment({ currentRenderScale, baselineRenderScale, releaseGates:{ frameTime:{ p95, p99 } }, targetFrameRate:60, lastScaleChangeAt, stableSince })` — already in `desktop-performance-policy.js:233`. It downscales at **p95 > 1.14× budget** (and p99 > 1.23×), upscales at **p95 < 0.9× budget**, with **6s down / 12s up cooldowns** and a **0.5–1.25 clamp**.
3. On `changed`, apply in order of cheapness:

| Frame-time pressure tier | Action | Knob |
|---|---|---|
| **Tier 0 (first response)** | Lower render scale | `renderer.setPixelRatio(computeScenePixelRatio({ renderScale: nextRenderScale, sceneType:'odyssey', maxPixelRatio }))` + `postProcessingStack.resize(...)` |
| **Tier 1** | Drop bloom working res, then disable bloom | `bloomScale 0.5→0.25`; then skip bloom node |
| **Tier 2** | Gate cheapest post terms to no-op | `uGrain`, `uDither`, edge-CA, the ch7 lens branch → quality uniform |
| **Tier 3** | Scale particle/instance counts | live `particleCount` multiplier (see 4.3) |
| **Tier 4** | Reduce active lights | cap simultaneous lights to the active-chapter rig |
| **Tier 5 (last resort)** | Tighten ecotone/seam overlap; reduce corridor sheets 3→2 | `ECOTONE_SPAN_FRACTION`, `SHEET_DEPTHS` count |

Reverse the order on recovery, one tier per up-cooldown, with hysteresis. Never change resolution
per-frame (RT realloc + possible black frame) — debounce as the policy's cooldowns enforce.

### 4.2 Tie-in to `computeScenePixelRatio`
`computeScenePixelRatio({ renderScale, sceneType:'odyssey', maxPixelRatio, devicePixelRatio })` already
multiplies the per-tier `odyssey` cap (1.0–1.25) by `renderScale`. The controller's only job is to feed
a live `renderScale` (currently hardcoded `1` at `OdysseyBoardController.js:562`) and re-apply on change.
The presets in `QUALITY_PIXEL_RATIO_CAPS` (`desktop-performance-policy.js:20-58`) become the **ceiling**;
the dynamic `renderScale` is the **floor** the controller rides between them.

### 4.3 Tie-in to chapter builders' `particleCount`
Today only Earth Core / Mountains / Cosmic read `options.particleCount`; the heaviest systems
**hardcode** counts (BH 1100/460/220 `black-hole-transcendence.tsl.js:322,452,499`; corridor field;
urban 240 towers + 480 rain; surface 700 grass/600 petals; mountains 1000 snow + 1000 stars). Two steps:

1. **Wire every count to the preset** — multiply each hardcoded literal by a `qualityScale` (preset `particleCount / 600`).
2. **Make it live** — expose a `setQualityScale(scale)` on each chapter env that resizes/hides a *suffix* of each `InstancedMesh` (set `instanceCount`, no rebuild) so the adaptive controller can shrink particle systems at runtime without reallocating buffers. Per-instance hidden via `instanceCount` is O(1).

### 4.4 Preset matrix (target shape)

| Preset | renderScale ceiling (odyssey cap) | particle ×scale | bloom | post extras (CA/grain/dither/lens) | max lights | corridor sheets |
|---|---|---|---|---|---|---|
| Minimal | 1.0 × ~0.6 floor | 0.25 | off | off | 3 | 1 |
| Low | 1.05 | 0.4 | ¼-res | grain off | 4 | 2 |
| Medium | 1.15 | 0.7 | ½-res | CA on | 5 | 2 |
| High | 1.2 | 1.0 | ½-res | all on | 6 | 3 |
| Ultra | 1.25 | 1.25 | ½-res | all on | 8 | 3 |
| Extreme | 1.25 | 1.5 | ½-res | all on | 8 | 3 |

---

## 5. The "Buggy" / Stutter Fixes (CPU — periodic hitches)

These are distinct from the lag fixes and address the *intermittent* jank.

### 5.1 Shader / pipeline recompile at seams (the dominant hitch)
- **Lights:** keep a **fixed-count** light rig in the scene; crossfade `intensity`, never add/hide lights → no `LightsNode.customCacheKey` change (QW4). `LightsNode.js:117-143`; `ChapterEnvironmentManager.js:713-714`.
- **Transparency:** make fade materials permanently `transparent:true`, drive `uOpacity`, drop the `needsUpdate` flip (QW5). `ChapterEnvironmentManager.js:790-801`.
- **Prewarm targeted:** `compileAsync(scene, camera, env.group)` so first-sight-of-chapter doesn't hitch and prewarm doesn't recompile the world. `OdysseyBoardController.js:521-558`.
- **Post variants:** compile a lean output node WITHOUT the lensing/hero-CA branch (default) and the full graph (ch7 only); swap `postProcessing.outputNode` when entering/leaving ch7 instead of running no-op ALU everywhere. `odyssey-tsl-pipeline.js:273-313`.

### 5.2 GC / allocation elimination
- De-dup `resolveChapterBlendState` (QW6) and cache transition objects (QW7) — the two biggest sources. `ChapterEnvironmentManager.js:256-354,875`.
- Reuse a preallocated `weights` map (zeroed each call) instead of `const weights = {}` in both `resolveChapterBlendState` and `resolveEcotoneOverlap`.
- Hoist `LevelNodeManager` per-node allocs to scratch (QW11). `LevelNodeManager.js:958,968-972,978-981,1003`.
- Cache `OdysseyPathRenderer` colors + targets array (QW12). `OdysseyPathRenderer.js:301-305,475-480`.
- Cache Deep Ocean `getObjectByName` lookups on `group.userData` at create time (stop 3× scene-walk/frame). `deep-ocean.js:514-543`.
- Verify with Chrome DevTools allocation profile — a **sawtooth heap = per-frame garbage**.

### 5.3 Per-frame attribute re-uploads → move to the shader
- Push snow/rain/wisps/shard drift into the TSL material driven by `uTime` (the corridor particulate already does this; BH twinkle already is — extend to vertical drift). Eliminates 4 CPU loops over hundreds–thousands of floats + their full GPU re-uploads. `mountain-peaks.js:592-608`, `sky-drift.js:318-333`, `urban-dreams.js:477-489`, `black-hole-transcendence.js:620-629`.
- On WebGPU, consider TSL **compute + `instancedArray`** so positions never round-trip the CPU. (Also mitigates the known `WebGPURenderer` per-render-item UBO cost, three.js #30560 — fewer resident items helps directly.)

### 5.4 Decouple update rate
- When `_isCameraSettled` and no seam is active, throttle **position-derived** work (visibility, corridor parallax, blend-state) to ~30 Hz while keeping time-driven uniform ticks at 60 Hz — visuals don't change between settled frames.
- Gate the **BH per-frame camera-lock + infall retarget + `setLensTarget`** on `activeChapter===7` (or the 6→7 / 7→8 seam) so chapters 1–6/8 stop paying the BH tax. `OdysseyBoardController` (`setLensTarget` call); `black-hole-transcendence.js:515-649`.
- Cache `getBoundingClientRect()` in `onMouseMove` (invalidate on resize/scroll) to avoid layout-thrash on the raycast hot path.
- Consider **on-demand rendering** (skip `render()`) when the board is idle/settled and no animated uniform is changing — the biggest possible win when the user is just reading the screen.

---

## 6. Measurement & Verification Plan

> The user captures/runs in their **desktop session** (the WebGPU board can't be auto-screenshot
> headless here). So: batch instrumented changes, hand off a measurement checklist, then iterate.

### 6.1 Instrument first (step zero — don't guess)
Add to `odyssey-debug-overlay.js` (already gated behind `?odysseyAAA=1`):
- `renderer.info.render.{drawCalls, triangles, calls}` and `renderer.info.memory.{geometries, textures}`.
- **CPU vs GPU split** via WebGPU timestamp queries: construct the renderer with `trackTimestamp:true`, then `renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER)` → `renderer.info.render.timestamp`. Wrap the **scene pass vs the post pass** separately. (Timestamps quantize to ~100µs unless Chrome `enable-webgpu-developer-features` is on; comparable only on the same GPU.)
- `stats-gl` (`trackGPU:true`) for an at-a-glance CPU+GPU ms overlay.
- A seam-hitch marker: log max frame time in the ±0.02 progress window around each boundary.

### 6.2 The litmus test (decides the whole plan)
**Drop the pixel ratio to 0.5 and see if FPS jumps.** If yes → **fill-rate bound** → prioritize §3 QW1–QW3, the half-res transparency pass, overdraw cuts. If no → **CPU/draw-call bound** → prioritize instancing (QW8), GC (QW6/7/11/12), and update throttling. (Expectation from the audits: primarily fill-bound, with a CPU seam-hitch overlay.)

### 6.3 Targets / budget

| Metric | Target | Tool |
|---|---|---|
| Frame time | ≤ 16.6 ms (60 FPS); ideally p99 ≤ 16.6 | stats-gl / timestamp queries |
| Draw calls | < 100/frame (smooth-60 guideline; < 500 hard ceiling) | `renderer.info.render.calls` |
| Triangles | track per chapter; flag the path-tube/mountain offenders | `renderer.info.render.triangles` |
| GPU scene pass | < ~8 ms | timestamp query (scene pass) |
| GPU post pass | < ~4 ms | timestamp query (post pass) |
| Overdraw | no full-screen additive stack > ~3 layers deep | Spector.js capture / visual |
| Seam hitch | no frame > ~33 ms at any boundary | seam marker |
| Heap | no sawtooth (stable steady-state) | Chrome DevTools Memory |

### 6.4 Before/after methodology
1. Capture baseline per chapter (drive the full journey slowly): draw calls, triangles, scene/post GPU ms, p95/p99 frame time, seam max frame time, heap sawtooth amplitude.
2. Use **Spector.js** for a full WebGL2-fallback frame capture (overdraw, redundant state, program count) — easiest path to *see* the additive stack and the 240 tower programs.
3. Use **Chrome Performance** to confirm GC pauses align with seam crossings and `resolveChapterBlendState`.
4. Apply one batch, re-capture the same per-chapter sweep, diff. Re-run §6.2 litmus after each batch to confirm the bottleneck is moving as predicted.

---

## 7. Prioritized Roadmap (impact-to-effort, parallelizable waves)

Each batch lists the **disjoint files** it touches so batches can run as parallel agent waves with
minimal merge conflict. Order is impact-to-effort.

### Batch 0 — Instrumentation (gate everything on this)
**Win:** know the bottleneck; required before claiming any improvement.
- `src/rendering/odyssey/odyssey-debug-overlay.js` — renderer.info + timestamp split + seam marker.
- `src/rendering/odyssey/OdysseyBoardController.js` — `trackTimestamp:true`, `resolveTimestampsAsync` call.

### Batch 1 — Quick wins (fill + seam hitch) ← **ship first, highest ROI**
**Win:** biggest steady FPS recovery + eliminates the transition hitch. Mostly one-liners / small edits.
- `OdysseyBoardController.js` — QW1 (`antialias:false`), QW2 (wire DRS), QW3 (lower cap).
- `desktop-performance-policy.js` — QW3 (per-tier `odyssey` caps). *(shared with above — sequence these two)*
- `ChapterEnvironmentManager.js` — QW4 (fixed light rig), QW5 (transparency flip), QW6 (de-dup blend-state), QW7 (cache transitions).
- `odyssey-tsl-pipeline.js` — QW13 (mips 5→3), QW14 (honor `enableBloom:false`).

### Batch 2 — Draw-call + GC (CPU submit + stutter) — parallel with Batch 3
**Win:** removes the worst draw-call source + steady GC pressure.
- `urban-dreams.tsl.js` — QW8 (instance towers).
- `deep-ocean.js` — instance jellyfish; cache `getObjectByName`.
- `LevelNodeManager.js` — QW11 (hoist allocs + gate re-uploads).
- `OdysseyPathRenderer.js` — QW12 (cache colors + targets); LOD path tubes 32/480→16/256.
- `earth-core.js` — QW9 (cut lights).

### Batch 3 — Overdraw structural (the big fill lever) — parallel with Batch 2
**Win:** the largest remaining GPU win after Batch 1.
- `composition/odyssey-corridor-field.js` + `.tsl.js` — QW10 (frustum-cull sheets), sheets 3→2, bake FBM to texture, alpha discard.
- New `odyssey-post/odyssey-transparency-pass.js` — half-res off-screen transparency target + composite.
- `OdysseyAtmosphere.js` — feather/size the dome; route into the transparency pass.
- `sky-drift.js`, `cosmic-expanse.js`, `mountain-peaks.tsl.js` — fewer-bigger additive layers; LOD displacement planes 128→64.

### Batch 4 — Adaptive quality system + residency window
**Win:** graceful degradation on weak GPUs; cuts VRAM/init/seam cost.
- New `OdysseyAdaptiveQuality.js` controller (§4) wired into `OdysseyBoardController.js` frame loop.
- Each `chapter-environments/*.js` + `*.tsl.js` — `setQualityScale` + wire hardcoded counts to preset (independent per chapter → parallel sub-agents).
- `ChapterEnvironmentManager.js` — residency window (build/keep `active±1`, dispose far); targeted `compileAsync`.

### Batch 5 — Per-frame attribute work → GPU + update throttling
**Win:** removes remaining CPU loops/uploads + decouples update rate.
- `mountain-peaks.js`, `sky-drift.js`, `urban-dreams.js`, `black-hole-transcendence.js` — drift to TSL `uTime` (independent per file → parallel).
- `OdysseyBoardController.js` — 30 Hz throttle when settled; gate BH/`setLensTarget` on ch7.
- `odyssey-tsl-pipeline.js` — two post variants (lean vs ch7 lens), swap `outputNode`.

### Batch 6 — Polish / soft particles / dual-filter bloom
**Win:** quality at lower cost; removes intersection seams.
- `odyssey-post/odyssey-transparency-pass.js` — soft-particle depth fade vs MAX-downsampled depth.
- `odyssey-tsl-pipeline.js` — dual-filter (Kawase) bloom; `bloomScale 0.25`.

---

### Appendix — Sanity notes verified in code (2026-06-07)
- Eager all-8 build confirmed: `OdysseyBoardController.js:312-328`.
- `antialias:true` + `maxPixelRatio:1.5` confirmed: `OdysseyBoardController.js:564,571`.
- Visibility gating works (per-frame draw/update skipped for hidden chapters): `ChapterEnvironmentManager.js:689-731`; corridor field `:583-590`.
- `setGroupOpacity` flips `material.transparent` + `needsUpdate=true`: `ChapterEnvironmentManager.js:790-801`.
- ch7 lens math is a uniform-multiply no-op (not branched) → runs every pixel everywhere: `odyssey-tsl-pipeline.js:273-313`.
- 240 unique tower meshes + materials confirmed: `urban-dreams.tsl.js:246-289`.
- `evaluateDynamicResolutionAdjustment` exists (1.14×/0.9×, 6s/12s, 0.5–1.25 clamp) but is **never called by the board**: `desktop-performance-policy.js:233-281`.
- Per-tier odyssey caps 1.0–1.25 confirmed: `desktop-performance-policy.js:20-58`.
