# Odyssey Mode — Performance & Optimization Masterplan (2026‑06)

> Status: **investigation complete, implementation not started.** Awaiting GO.
> Method: 21‑agent research + code audit (8 web‑research domains, 5 mode‑wide subsystems,
> all 8 chapters) cross‑checked against first‑hand reads of the post pipeline, adaptive‑
> quality controller, and the real in‑app perf overlay. Every finding below cites `file:line`.
>
> **Hard constraint (unchanged):** preserve the AAA visual identity. Every change is either
> *zero‑visual* (instancing, material sharing, culling, compile, memory, loading — ship freely)
> or *minor‑visual* (noise‑bake, octave cuts, overdraw trims — **must be capture‑verified** by
> the user in their desktop session; the WebGPU board cannot be screenshotted headless, and a
> full‑journey capture has TDR‑crashed this machine — per‑chapter short captures only).

---

## 1. Executive summary — three root causes explain everything

The audit is unusually unanimous. **This is not a framerate problem** — steady‑state is already
~149 fps. It is a **cold‑start compile problem + a scroll‑time fill problem + a loading/memory
problem**, and all three have *structural* fixes that keep the look identical.

| # | Root cause | Symptom | Structural fix | Already proven in‑repo? |
|---|------------|---------|----------------|--------------------------|
| **A** | **Pipeline‑variant explosion** — ~202 distinct chapter NodeMaterials (black‑hole 36, urban 38, surface 35), each compiled lazily on first render through the MRT/Pass target. | Cold start p95 **3406 ms** / p99 **8281 ms**, 26 spikes >33 ms; the washed‑out white screen on entry. | **Share one material per archetype** + collapse the 4 post output variants → 1 + thread the quality tier into the pipeline (dead today). | ✅ `createSharedMotifMaterialsTSL` (black‑hole) collapsed 5 motifs' ~10 programs → 2 with zero visual change. |
| **B** | **Per‑fragment FBM/ridged noise** over large co‑visible additive surfaces. 134 noise call‑sites across the 8 chapter `.tsl.js`; helpers expand to 28–40 `snoise3`/pixel (earth‑core lava field), every chapter has 1–2 full‑screen BackSide noise domes. | Scroll lag / stutter at chapter seams (GPU fill, scales with resolution). | **Bake static noise lattice fields to shared textures**, scroll the sample UV by `uTime`. 5–15× per‑fragment ALU cut. | ✅ `odyssey-corridor-field.tsl.js:62‑194` already bakes fbm2 to a 512×512 DataTexture and samples it 3× instead of ~45 octave evals. |
| **C** | **43.4 MB of uncompressed GLBs** loaded on demand; loader wires KTX2 + meshopt but **every GLB ships `extensionsUsed:[]`** (the path is dead code). Hero creatures are 4.4 MB × 4 = 17.6 MB at **75 k raw verts** each. No chapter eviction → memory climbs monotonically. | First‑load latency, Ch2/Ch3 transition decode stalls, VRAM growth. | **Run the existing `optimize-odyssey-glbs.mjs` (meshopt+KTX2), git‑add the artifacts** — zero runtime code. Then decimate hero creatures + LRU‑evict far chapters. | ✅ Loader (`odyssey-gltf-loader.js:25,30`) + transcoder (`public/basics/basis/`) + optimize script all already exist and are inert. |

**Plus two always‑present baseline drags** that cost every frame in every chapter:
- **55 inner fluid cores** are the only un‑instanced orb layer = **55 draws + 55 pipelines** (`LevelNodeManager.js:563‑567`). The shells/glow/locks/stars/sparkles are already 1 instanced draw each.
- **The path** is 3 full‑length tubes (~21 k tris) always drawn, and its fragment shader evaluates **all 8 chapter styles + a 7‑step crossfade per pixel** regardless of which chapter the pixel is in (`odyssey-path-renderer.tsl.js:189‑272`).

---

## 2. Baseline (measured + counted)

**Runtime (real, from the in‑app perf overlay, EXTREME, RTX 5080 Laptop):**
- Steady‑state **~149 fps (~6.7 ms)** once warm — ceiling is fine.
- Cold start tail: **p50 5.8 ms / p95 3406 ms / p99 8281 ms**, 26 spikes >33 ms, "last" 3407 ms.
- Memory ~359 MB and climbing on idle (no chapter eviction).

**Static counts (verified):**
- **GLB payload: 25 files, 43.4 MB, 100% uncompressed.** Hero creatures: manta 4.41 MB / whale 4.41 MB / swallow 4.41 MB / goldfinch 4.41 MB (= 17.6 MB, 40% of payload; manta = 74,966 verts). Quaternius trees/props ≈ 24 MB (texture‑heavy PNGs, ~18 models in Ch3).
- **~202 chapter NodeMaterials** (compile surface). **134 noise call‑sites** across chapter shaders (earth‑core 35, deep‑ocean 15, cosmic 14, surface 13).
- **94× `frustumCulled = false`** scattered across the codebase (culling largely disabled).
- **Post:** BloomNode allocates 11 HalfFloat targets, **4 are dead** after `nMips=3` but never freed; **4 output‑node variants** (~95% identical) quadruple the output‑shader compile; **quality tier is never forwarded** to the pipeline constructor, so `enableBloom`/`bloomScale` tiering is dead.
- **Warmup:** `_warmUpJourney` replays the **full** `renderFrame()` across ~17 progress samples (every resident chapter's `update()` + a full MRT post render) before reveal = the 16–22 s pre‑reveal cost.

**Already excellent — do NOT touch:** `OdysseyAdaptiveQuality` (alloc‑free ring buffer, hysteresis, cheapest‑first shedding), the board loop's settled‑gate decoupling, the post graph's fused single‑quad output, the orbs' shell/glow/lock/star/sparkle instancing, GPU‑side particle motion.

---

## 3. The nine structural levers (ranked by impact ÷ effort ÷ risk)

| Lever | Root cause | Impact | Effort | Visual risk | Where |
|-------|-----------|--------|--------|-------------|-------|
| **L1. Asset compression pass** (run optimize script + git‑add) | C | High | **Low** | None | `scripts/optimize-odyssey-glbs.mjs`, all GLBs |
| **L2. Share one material per archetype** (generalize motif pattern) | A | High | Med | None | every chapter `create()`; `black-hole-…tsl.js:296` is the template |
| **L3. Collapse 4 post output variants → 1 + thread quality tier + free dead bloom mips** | A | High | Med | Low | `odyssey-tsl-pipeline.js`, board constructor call |
| **L4. Minimal warmup render + reveal focus‑chapter‑only** | A | High | Med | Low | `OdysseyBoardController.js:1688‑1783` |
| **L5. Noise‑bake to texture** (generalize corridor pattern) for the 5 noise‑heaviest chapters | B | High | Med‑High | Low‑Med | earth‑core, cosmic, black‑hole, mountain, sky‑drift `.tsl.js` |
| **L6. Instance the 55 inner cores → 1 draw + 1 material** | A+draws | High | Med | Low | `LevelNodeManager.js:563‑567` |
| **L7. Chunk the path per‑chapter + build‑time style specialization** | B+vtx | High | High | Low | `OdysseyPathRenderer.js`, `odyssey-path-renderer.tsl.js` |
| **L8. Wire `setDomeVisible(false)` per‑chapter (kill global+chapter dome double‑draw)** | B/fill | High | **Low** | Low | `OdysseyAtmosphere` + `ChapterEnvironmentManager.js` |
| **L9. Frame‑pacing freebies: clamp rAF delta + `getBlendState` scratch** | pacing | Med‑High | **Low** | None | `OdysseyBoardController.js:1542`, `renderFrame` |

Cross‑cutting cheap wins that ride along: collapse the glass‑orb 8‑way super‑shader to the
2–3 terms the snow‑globe glassify keeps (`level-node-manager.tsl.js:104‑341`/`299‑317` — it
already discards ~92% of the per‑style ALU via `×0.08`); re‑enable `frustumCulled` on bounded
set‑pieces (94 sites); LRU‑evict chapters >2 from the camera; parallelize + prewarm GLB loads
during the park‑the‑board warm; lower the camera far plane 9000 → ~2000.

---

## 4. Chapter‑by‑chapter plan

Every chapter shares the same two diseases (full‑screen noise dome + per‑prop materials);
the per‑chapter rows below list the *specific* heaviest items and the hero elements to protect.

### Ch1 — Earth Core · `gpu-fill` · ~80–95 draws
- **Heaviest:** `moltenRockField` ~40 `snoise3`/px shared by ~24 lit meshes; lava lake (10,368‑tri plane) ~30 evals/px; **two full‑screen noise domes** (background 17 noise3 + magma canopy 20 `snoise3`, `depthTest:false` → full overdraw).
- **Fixes:** bake molten‑rock + background‑dome + canopy noise to textures (L5); re‑enable depth on the canopy; share the 4 god‑ray / 3 horizon / decal materials (L2); merge ~21 contact‑shadow decals into one instanced batch; distance‑LOD the lake colorNode.
- **Preserve:** the First Heart caldera, the opaque molten lake mirror, the lava‑fall hero, god‑ray ember shafts, the ~70% near‑black charred‑rock value hierarchy, seam choreography.

### Ch2 — Deep Ocean · `gpu-fill` · ~17–20 draws
- **Heaviest:** **6 god‑ray cones drawn as 6 separate meshes** (not instanced), each 3 `snoise3`/px additive `DoubleSide`; seabed fragment fbm3(5)+caustics; per‑frame **bubble attribute re‑upload** (full `aBase` flush every frame, even off‑screen) + 8 short‑lived `{x,y,z}` objects/frame from `posAt` closures in the manta updater.
- **Fixes:** merge the 6 god‑rays to 1 instanced draw; pool the `posAt` closures (kill GC); gate the bubble re‑upload to a dirty flag; parallelize the serial manta→whale `await` (`deep-ocean-manta.js:194‑200`); **decimate manta/whale 75k → ~10–15k verts** (capture‑gated).
- **Preserve:** the manta + whale escorts (named heroes — verify silhouette after decimation), bioluminescent rim (`COLOR_0`), water‑ceiling caustics, the darkness‑inversion arc.

### Ch3 — Surface World · `gpu-fill` · ~95–110 draws (heaviest non‑cosmic)
- **Heaviest:** **two full Ch2 Gerstner water planes reused verbatim** (sea scaled 4.2× → ~1260 u additive overdraw); stacked landscape (18 k tris) + foothill skirt (23 k) + 3 distant‑mountain planes (98 k tris combined), all transparent `frustumCulled=false`; ~58 un‑merged decorative draws (clouds 15, rays 7, mist 4, butterflies 20, birds 8, waterfall 4); **23 Quaternius props cloned per‑placement** (not instanced).
- **Fixes:** share ONE water material between sea+river; collapse clouds/rays/mist/butterflies/birds into single InstancedMesh draws (~58 → ~6); **instance the 23 Quaternius props by asset** (L1's partner); shrink the oversized sea quad + god‑ray planes; LOD/cull distant mountains when the alpine ramp is ~0.
- **Preserve:** the hero tree, meadow, sun, water, distant alpine promise, flying birds.

### Ch4 — Mountain Peaks · `gpu-fill` · ~22–24 draws
- **Heaviest:** **6 co‑visible FBM peaks** (3 hero + 3 foothill, each 64×64 plane) at ~10 `mx_noise_float`/px + full lighting, heavy peak‑on‑peak overdraw; each peak its own Mesh + material + uniforms (compile multiplier).
- **Fixes:** bake the 3 static peak FBM fields to a texture (L5); collapse 6 per‑peak materials → 2 shared (hero/foothill) + instance; distance‑LOD the octave count; frustum‑cull + progress‑gate the foothill apron and climax‑only sun‑ray fan.
- **Preserve:** hero center peak, three‑zone alpine snow, alpenglow, cloud‑sea, summit ignite, aurora promise.

### Ch5 — Sky Drift · `gpu-fill` · ~31–33 draws
- **Heaviest:** **6 cloud strata at ~9 octaves each** (base+detail fbm2 — the single heaviest load); fullscreen 5‑octave dome mottle recomputed every frame though time‑invariant; 5‑oct set‑pieces forced `frustumCulled=false`; 6 separate cloud meshes + 6 separate aurora meshes (batchable).
- **Fixes:** bake the dome mottle + Mie sun to a texture; **halve cloud octaves 9 → 5** by merging base+detail into one domain‑warped fbm2; instance the 6 strata + 6 aurora curtains → 2 draws; frustum‑cull + dusk‑gate set‑pieces; delete 4 dead PointLights (all materials are unlit).
- **Preserve:** warm Mie sun, aurora hero curtains, threaded cloud volume, god‑ray fans, dusk staging.

### Ch6 — Cosmic Expanse · `gpu-fill` · ~40–55 draws
- **Heaviest:** **void‑sky dome** (2400‑radius sphere, ~31 FBM/ridged octaves = ~250 hash trilerps/px) — the single most expensive fragment in the mode; 200 large additive nebula quads (far tier at 4 octaves on the biggest sprites); **3100‑quad static starfield** (pure billboard/overdraw waste).
- **Fixes:** **bake the void dome to a cubemap** (~50–100× fragment cut + removes its compile from first frame); cap far‑nebula octaves to 2 + share the per‑sprite noise Fn; bake the static starfields to a star cubemap (keep ~80–150 live near pinpoints); visibility‑gate the dissolved aurora bridge + pillar; stop the 5×/frame `material.opacity` traverse.
- **Preserve:** the volumetric black hole, banded gas giant, distant galaxy, domain‑warped nebula pocketing, crisp pinpoint stars, suction infall, pillar reveal.

### Ch7 — Black Hole · `gpu-fill` · ~70–75 draws
- **Heaviest:** camera sits **inside two additive full‑frame procedural‑noise spheres** every frame (void dome ~160 hash/px at 5 oct + ambient wash ~80, neither early‑Z‑able); 25 secondary‑motif draws + 18 infall‑tube draws (materials shared, draws not); 7 accretion disks each running 5‑oct fbm3.
- **Fixes:** bake the void dome + wash to a texture (L5); **drop dome/wash octaves 5 → 2–3** (instant, near‑zero risk); instance the 5 motifs (25 → 5) and merge the 18 infall tubes (→ 2) with GPU‑side spin; frustum/distance‑cull the staggered motifs (only 1–2 visible); optionally fold the wash into the dome (medium risk — playground‑verify).
- **Preserve:** the camera‑locked lensed hero (disk + photon ring + Einstein shell + Gargantua fold arcs), Doppler asymmetry, the multi‑hued violet void that defeats RGB‑black.

### Ch8 — Urban Dreams · **`compile`** · ~55–60 draws
- **Heaviest:** **9 byte‑identical ground‑haze NodeMaterials built in a loop** (9 pipeline compiles for the same math); ~30+ unique materials across rings/tubes/signs/haze for math that wants ~5 shared programs; overlapping additive fill at the finale (7 haze billboards + 9 pools + 500‑r sun halo + wet street); fullscreen 5‑oct fbm2 sky dome.
- **Fixes:** **share ONE ground‑haze material** (9 → 1); fuse 9 rings + 9 pools + 18 traffic tubes into instanced meshes with GPU‑side motion (deletes two per‑frame `forEach` loops too); **warm the reveal/shock‑ring pipelines off the critical path** (they only appear at progress >0.82 so they stutter at the finale today); bake the sky‑dome noise; cut torus/tube tessellation on glow primitives (rails 96 → 24).
- **Preserve:** synthwave sun, igniting spire, lit‑window canyon, wet street, two‑tone palette, rain.

---

## 5. Mode‑wide plan

- **Post pipeline** (`odyssey-tsl-pipeline.js`): thread the quality tier into the constructor (un‑deads bloom/post tiering); collapse the 4 output variants → 1 uniform‑branched (~40% post‑compile cut); free the 4 dead bloom mips; gate `BloomNode.setSize` on actual size change; consolidate redundant luma dots; delete the dead `PostProcessingStack.js` + `odyssey-post-fallback.js` (0 live pipelines). Optional: a from‑scratch dual‑filter mip‑chain bloom (8 passes → ~5).
- **Warmup / lifecycle** (`OdysseyBoardController.js` / `ChapterEnvironmentManager.js`): reveal after warming **only the focus chapter + its seams**, idle‑warm the rest; strip the warm render to visibility‑state + `postProcessing.render()` (skip the 6 CPU subsystem ticks); add an **LRU eviction window** (dispose chapters >2 from camera, gated off keep‑board on RTX‑class GPUs); defer lens/no‑bloom variant warming to post‑reveal idle.
- **Board loop / pacing** (`OdysseyBoardController.js`): **clamp `delta = min(getDelta(), 0.05)`** (kills the lurch after every spike); thread a scratch into `getBlendState()` (removes ~600 garbage objects/sec); gate `_resolveRenderTimestamps()` behind the debug‑overlay flag; reduce tick rate of pure‑bookkeeping conductors when settled; `renderAsync()` + chain next rAF.
- **Atmosphere / corridor**: **wire `setDomeVisible(false)` per‑chapter** (kills the global+chapter dome double‑draw in 7/8 chapters — the hook exists, was never called); reorder the global dome after opaque geometry so `depthTest` early‑Z works; collapse the corridor seam so only the dominant chapter's particulate field renders.
- **Nodes / path**: instance the 55 inner cores → 1; pack sparkle attributes **55‑wide not 5,280‑wide** + progress‑cull the cloud; per‑chapter‑segment the path so each fragment bakes one style; convert the 8 lit `MeshStandardMaterial` chapter rings → 1 instanced emissive material; collapse the glass‑orb super‑shader.
- **Culling / LOD**: replace the 94 blanket `frustumCulled=false` with correct bounding volumes + `frustumCulled=true` on bounded set‑pieces; chapter `group.visible=false` outside `[active‑1 .. active+1]`; far plane 9000 → ~2000; `BatchedMesh` for same‑material static clutter (surface 26, earth‑core 17).
- **Particles / overdraw**: optional half/quarter‑res off‑screen additive pass for the always‑present soft glows (sparkle cloud + corridor motes), upsampled into the HDR scene before bloom; behind‑camera + distance cull in the shared `billboardWorld` helper; tighten the soft‑sprite quad to the visible disc (free ~36% rasterized‑area cut).
- **Loading**: run L1; `ktx2Loader.setWorkerLimit(4‑6)`; parallelize the serial manta→whale await; prefetch all chapters during the park‑the‑board warm (cache already dedupes by URL); progressive `active±1` streaming on idle.

---

## 6. Sequencing — five capture‑gated waves

Each wave is independently shippable, test‑gated (`webgpu-tsl-build` + lint + unit), and ends
with a per‑chapter capture checkpoint. Ordered so each wave makes the next cheaper.

- **Wave 0 — Asset compression (zero runtime code).** L1: run `optimize-odyssey-glbs.mjs`, git‑add KTX2/meshopt artifacts, verify load. ~43 → ~12–18 MB, VRAM ~10× lower on trees. *No board capture needed (binary‑identical render); just confirm load.*
- **Wave 1 — Cold‑start compile + frame pacing (mostly zero‑visual).** L2 (share materials per archetype), L3 (post variants → 1, thread tier, free dead mips), L4 (minimal warmup + focus reveal), L9 (delta clamp, getBlendState scratch), Ch8 ground‑haze share + reveal‑pipeline warm. **Target: p95 cold‑start 3406 ms → <1000 ms, no white‑wash.**
- **Wave 2 — Draw‑call / instancing (zero‑visual).** L6 (inner cores 55 → 1), L8 (dome double‑draw), Ch2 god‑rays 6 → 1, Ch3 decorative groups + Quaternius props instanced, Ch7 motifs 25 → 5 + tubes 18 → 2, Ch8 rings/pools/traffic fused, chapter rings → 1 instanced. **Target: steady‑state +15–30 fps headroom + lower seam stutter.**
- **Wave 3 — GPU‑fill noise‑bake (minor‑visual → capture every chapter).** L5 across earth‑core / cosmic / black‑hole / mountain / sky‑drift, glass‑orb super‑shader collapse, octave cuts, dome bakes, overdraw trims. **Target: kill scroll lag at seams.**
- **Wave 4 — Memory & loading lifecycle + hero decimation (capture‑gated).** LRU eviction, parallel prefetch during warm, `active±1` streaming, manta/whale decimation, far‑plane cut, `frustumCulled` re‑enable sweep. **Target: flat memory, faster transitions.**

---

## 7. Before/after measurement protocol

The board runs in the user's session (headless WebGPU board capture is unreliable + TDR‑risky),
so the **source of truth is the in‑app `perfMonitor`** + per‑chapter captures.

**Per wave, the user captures (per‑chapter, short sessions):**
1. **Cold start:** fresh load → Odyssey → record overlay `p50/p95/p99 + spikes>33ms` and wall‑clock to first interactive frame. (`window.perfMonitor.getSpikes()`)
2. **Steady scroll:** slow‑scroll each chapter → record fps + frame‑time p95 per chapter (chapters 3, 5, 6, 7 are the watch list).
3. **Transition:** enter→exit one level → record the return‑to‑map hitch.
4. **Memory:** idle 60 s in Odyssey → record `memoryUsed` drift (Wave 4 target: flat).
5. **Visual:** one capture per touched chapter, compared to the pre‑wave capture for the named hero elements.

I will also profile individual effects on the **playground** via Chrome DevTools (ch2/3/5/6 have
playground effects) for shader‑level before/after where the board can't be driven headless.

---

## 8. Tradeoffs, risks & guardrails

- **Noise‑bake (Wave 3) is the only broad minor‑visual risk.** Low‑frequency haze/nebula is 8‑bit‑identical (corridor proved it); **hero high‑frequency detail** (lava veins, accretion swirl, nebula filaments) stays analytic or bakes to a higher‑res/derivative‑packed texture. Every baked chapter is capture‑gated.
- **Hero‑creature decimation (Wave 4)** is the highest single visual risk (manta/whale are named heroes) — conservative `simplify(0.15–0.25)`, keep `COLOR_0`, capture before/after.
- **LRU eviction** must be gated off `keepBoardAlive`/RTX‑class GPUs so it never adds a transition compile on a machine with VRAM to spare; window = `active±2`.
- **Dawn pipeline cache:** part of the 16–20 s is a *first‑visit‑only* cost the browser already eliminates on repeat (DawnWebGPUCache). Wave 1 should re‑baseline cold‑vs‑warm‑cache first so we don't over‑attribute.
- **Never:** TAA (ghosts on the moving board), MSAA (correctly off), or full‑journey headless capture (TDR).

## 9. Visual‑preservation guarantee

The per‑chapter `heroElementsToPreserve` lists (§4) are the contract. Waves 0–2 are
pixel‑identical by construction (compression, instancing, material‑sharing, culling, compile,
memory — no fragment math changes). Only Waves 3–4 alter fragments/geometry, and each is
gated behind a per‑chapter capture comparing the named heroes. If any chapter reads as cheaper,
that item is reverted or dialed back — the look is the acceptance test, not the framerate.
