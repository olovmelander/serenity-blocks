# Odyssey Mode — Performance & Architecture Masterplan (2026‑06‑22, re‑baselined)

> **Status:** investigation complete; supersedes/re‑baselines `docs/ODYSSEY_PERFORMANCE_MASTERPLAN_2026-06.md`.
> **Method:** 38‑agent evidence audit (7 mode subsystems + all 8 chapters + 5 reference themes), then 4 cross‑cutting
> analyses, then 14 adversarial verifications — every claim re‑read against the **current working tree** (which has
> uncommitted perf work in flight) and corrected where the prior masterplan went stale. Every finding cites `file:line`.
>
> **Why a new doc:** the prior masterplan (excellent, but written against an older tree) is now **partly stale** — several of
> its headline claims are *no longer true* (board is parked‑not‑disposed; blackout is a readiness gate; god‑rays already 6→1;
> corridor renders only co‑visible chapters; ch8 facades already collapsed). This doc (a) re‑baselines implementation status so
> we never re‑recommend done work, (b) adds the **reference‑theme comparison** the prior plan lacked, and (c) gives an explicit
> **best‑in‑class / scalability verdict**.
>
> **Hard constraint (unchanged):** preserve the AAA visual identity. Every change is either *zero‑visual* (instancing, material
> sharing, culling, compile, memory, loading — ship freely) or *minor‑visual* (noise‑bake, octave cuts, overdraw trims —
> **must be capture‑verified** per‑chapter by the user; the WebGPU board cannot be screenshotted headless and a full‑journey
> capture has TDR‑crashed the dev machine — short per‑chapter captures only).

---

## 0. The three questions, answered up front

| Question | Answer |
|---|---|
| **Is Odyssey best‑in‑class?** | **No — and the gap is architectural, not tuning.** Five polished, reliably‑fast reference themes (electric‑dreams‑v3, lunara, shifting‑sands, winter, summer) independently converged on the *same* WebGPU/TSL pattern; Odyssey violates almost every pillar of it (below). A single Odyssey chapter (ch1 ~81 draws, ch7 ~52‑68 draws) already exceeds a *whole* reference scene (e‑d‑v3 = 2 draws / 2 materials; shifting‑sands ~15 draws / 6 materials), and Odyssey then keeps **all 8 chapters GPU‑resident at once**. |
| **Is multi‑chapter the right/scalable structure?** | **Multi‑chapter is fine; the flaw is the *residency model*, not the chapter count.** The code itself documents that building all 8 up front was *tried and reverted* ([OdysseyMode.js:3417‑3421](../src/core/game-modes/OdysseyMode.js#L3417)). The current compromise defers the *blocking* cost but **all 8 chapters still end up resident and are never freed** (zero `evict`/`unloadChapter`/`environments.delete` anywhere; the only `environmentGroup.remove()` is the all‑at‑once `dispose()`). That is monotonic memory by construction and the structural reason it won't scale to a 9th chapter or a weaker GPU. The fix is an **active±N streaming window with per‑chapter eviction**, not fewer chapters. |
| **Are all chapters / assets loaded at once?** | **Cold‑start: NO** (blocking set = small eager window `1..furthest+1`, [OdysseyMode.js:3422](../src/core/game-modes/OdysseyMode.js#L3422)). **Steady‑state: effectively YES** — within ~2 s of reveal `loadChaptersInBackground` setTimeout‑builds every remaining chapter ([ChapterEnvironmentManager.js:781‑831](../src/rendering/odyssey/ChapterEnvironmentManager.js#L781)) and they stay resident forever. Assets: the live GLB payload is only ~9.5 MB (ch2 manta+whale + conifers), but ~33.8 MB of ch3 GLBs are **dead‑disabled yet still committed and bundled**. |

---

## 1. Executive summary — the diagnosis is unchanged in *shape*, but the baseline moved

Odyssey is **not a steady‑state framerate problem** (warm ≈149 fps on RTX 5080 Laptop). It is **(A) a cold‑start compile problem + (B) a scroll‑time per‑fragment fill problem + (C) a loading/memory problem** — exactly the prior masterplan's three root causes. What changed: **a real, well‑engineered cold‑start/lifecycle pass has shipped (or is in flight)** that substantially mitigates *the loading axis of A and the perceived‑wait part of C*, while **B and the residency core of C are essentially untouched.**

The single most important new finding for planning: **the reference themes prove the target is reachable.** They are the existence proof that a polished WebGPU/TSL scene runs in 2–15 draws with 2–30 up‑front‑compiled materials and 1–2 noise surfaces. Odyssey's job is not to invent anything — it is to adopt the five disciplines those themes all share (§4), adapted to a multi‑chapter journey.

---

## 2. Re‑baseline — what is DONE / IN‑FLIGHT / NOT‑STARTED (read this before planning)

> The prior masterplan said "investigation complete, implementation not started." That is **no longer accurate.** A prior
> "startup‑optimization" pass + the large **uncommitted** working‑tree branch (OdysseyBoardController +334, OdysseyMode +108,
> perf‑monitor +61, new `odyssey-performance-flags.js`) have landed/are‑landing the following. **Do not re‑recommend these.**

### ✅ DONE / IN‑FLIGHT (verified in current tree)
| Item | Evidence |
|---|---|
| **Board PARKED, not disposed**, across level entry/return (keep‑alive default‑on; return = resume, not rebuild) | [OdysseyMode.js:721‑727](../src/core/game-modes/OdysseyMode.js#L721), `_parkOdysseyBoard`:3703; `_buildOdysseyBoard` early‑returns if controller exists |
| **Blackout is a READINESS GATE**, not a fixed timer (reveal gated on `readySettled`; `maxBlackoutHoldMs` only aborts) | `JourneyEntryTransition` reveal path |
| **Fast‑start focus‑chapter reveal** (warm only the focus chapter via a single `buildPointWarmSamples` frame; defer rest) — now the **default** | [OdysseyBoardController.js:2033‑2040](../src/rendering/odyssey/OdysseyBoardController.js#L2033); `odyssey-performance-flags.js` `normalizeOdysseyWarmupMode` → `'current'` default |
| **Post‑reveal background offscreen render‑warm** of far chapters (nearest‑first, setTimeout‑paced) | `_startBackgroundRenderWarm` OBC:929‑996 |
| **Eager window** (blocking build = `1..max(2,furthest+1)`, not all 8) | [OdysseyMode.js:3409‑3431](../src/core/game-modes/OdysseyMode.js#L3409) |
| **rAF delta clamp** `min(getDelta(), 0.05)` (kills hitch‑driven multi‑second lurch) | OBC:1813 |
| **Persistent light rig** — every chapter's lights reparented into one never‑hidden rig, crossfaded by intensity → **constant light set across the journey → no per‑seam LightsNode recompile** (a genuine Odyssey innovation) | CEM:482‑704 |
| **Bloom mips 5→3 + quarter‑res bloom** (`bloomScale=0.25`) | odyssey-tsl-pipeline.js:261‑271 |
| **`enableBloom` quality‑tier threading** (Minimal kills bloom) | OBC:1285‑1295 (uncommitted) |
| **Orb shells instanced** (glass/glow/lock/star = 4 InstancedMesh) + **orb update dirty‑gated** (no per‑frame re‑upload at rest) | LevelNodeManager.js:388/427/451/469; :1028‑1039 |
| **Corridor field renders only co‑visible chapters** (`_visibilityWeight` gates `group.visible`) | odyssey-corridor-field.js:602‑609 |
| **Ch2 god‑rays 6→1 InstancedMesh** (prior masterplan's "6→1" lever) | deep-ocean.tsl.js:326 |
| **Ch8 facade canyon collapsed to ONE shared material** (per‑instance `aFacade`) + towers (240)/haze/rain instanced | urban-dreams.tsl.js:401‑457 (QW8) |
| **Ch7 motifs instanced** (15→4) + motif disk/shell materials shared (10→2) + shards GPU‑side | black-hole-transcendence.js:351‑415 |
| **Cosmic octaves trimmed 5→3** + nebula/dust culling re‑enabled; **sky‑drift cloud octaves trimmed 9→6** | cosmic-expanse.tsl.js:99‑101; sky-drift.tsl.js:290‑296 |
| **Adaptive‑quality controller** (ring buffer, p95/p99, hysteresis, 5 pressure tiers resolution→bloom→post) | OdysseyAdaptiveQuality.js — *more sophisticated than any single reference theme* |
| **Diagnostics/measurement protocol** (perf‑context spike collector, frame‑time p50/p95/p99 log, startup trace) | uncommitted OBC `_buildPerfContext`/`getPerfSnapshot`; perf-monitor `getFrameTimeSummary` |

### ❌ NOT STARTED (this is the actual remaining work)
| Lever | Status | Where |
|---|---|---|
| **L1** KTX2/meshopt re‑export (loader wired but **inert**; 0 `.ktx2`) + delete dead bundled GLBs | not‑started | `scripts/optimize-odyssey-glbs.mjs` (never run); ch3 assets |
| **L2** Shared **archetype‑material registry** (proven in *exactly one* chapter — black‑hole) | not‑started | `createSharedMotifMaterialsTSL` used only at black-hole-transcendence.js:305 |
| **L5** Noise‑bake / octave cuts on the heaviest full‑screen domes | not‑started | ch7/ch6/ch1 `.tsl.js` |
| **L6** Instance the **55 inner fluid cores** (lone un‑instanced orb layer) | not‑started | LevelNodeManager.js:563‑564 |
| **L7** Chunk path per‑chapter / bake style+colour to a 1D LUT | not‑started | odyssey-path-renderer.tsl.js:198,223‑272 |
| **L8** Call `setDomeVisible(false)` per chapter (hook exists, **zero callers**) | not‑started | OdysseyAtmosphere.js:205 |
| **L9 part 2** Kill per‑frame `getBlendState` allocation (delta‑clamp half is done) | not‑started | OBC:1828 → CEM:995‑997 |
| **Chapter LRU eviction** (THE memory lever — no per‑chapter dispose exists) | not‑started | ChapterEnvironmentManager |
| Per‑chapter un‑instanced clusters (ch8 41 draws, ch7 18 tubes, ch1 ~22 decals, ch3 28 birds/butterflies, ch4 3 eagles) | not‑started | per chapter |
| Selective emissive‑MRT bloom + free 4 dead 1×1 bloom RTs + delete dead WebGL post files | not‑started | odyssey-tsl-pipeline.js; PostProcessingStack.js + odyssey-post-fallback.js (0 live importers) |

---

## 3. Root causes — re‑validated with corrected numbers

### Root cause A — pipeline‑variant explosion (cold‑start compile)
Each chapter builds **per‑prop NodeMaterials compiled lazily through the MRT/Pass target on first render** → cold‑start p95 3406 ms / p99 8281 ms + the white‑wash on entry. **~150–202 distinct NodeMaterials across 8 chapters.** The shared‑archetype pattern that fixes this is proven but used in **exactly one chapter**.

- **Verified worst offender:** earth‑core builds **~20 molten‑pocket `MeshStandardNodeMaterial`s**, of which **11 are byte‑identical obsidian column/slab graphs** (`isColumn=true`, only geometry/transform differ) — each a fresh uncached compile of the heaviest graph ([earth-core.js:1050‑1106](../src/rendering/odyssey/chapter-environments/earth-core.js#L1050)).
- **Plus the 55 inner orb cores** = 55 distinct `MeshBasicNodeMaterial`s compiled at cold start (LevelNodeManager.js:563).
- **Mitigation already in place:** fast‑start bounds the *blocking* compile to the focus chapter; the rest are deferred to the background render‑warm. **But that background loop is throttled/optional** (`?odysseyBgWarm=0`, gated by `_canRunBackgroundTask` = idle+settled), so **an out‑scrolling player or a starved loop re‑introduces the first‑visit compile hitch on a visible frame.**

### Root cause B — per‑fragment multi‑octave FBM over large co‑visible additive/full‑screen surfaces (scroll fill)
`fbm3`/`ridged3` default to **5 octaves** (each octave = one `noise3` = 8‑corner hash trilerp; [odyssey-tsl-noise.js:106‑130](../src/rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js#L106)). Verified hot surfaces:

- **Ch7 = TWO overlapping full‑screen BackSide noise domes**: `voidDome` (r520, 4 noise calls / ~20 oct) **+** `ambientWash` (r360, `depthTest:false` additive, 2 calls / ~10 oct) = **~30 octaves on every overlapping background pixel**, live in‑game (black-hole-transcendence.js:90,578).
- **Ch6** void‑sky dome ~**26 octaves** (~208 hash/px) on a r2400 backstop (cosmic-expanse.tsl.js:85‑130).
- **Ch1** lava lake: **6 `fbm` + 1 `snoise3` ≈ 25 noise evals/px** on a 360×360 *opaque* plane the camera looks across (earth-core.tsl.js:248‑298).
- **The shared PATH** (always present, every chapter): the outer tube fragment evaluates `chapterAt()` (a 7‑iteration crossfade over all 8 chapters) **AND** `stylePattern()` (builds **all 8** style expressions then mix‑selects) — **O(chapter_count) per pixel** down the whole path, though only 1–2 chapters are ever co‑visible (odyssey-path-renderer.tsl.js:198,223‑272,343‑344).

> **Verification corrections (don't overstate B):** ch4/ch3 "6 FBM mountain peaks per fragment" was **misattributed** — those 6 FBM evals are **CPU‑baked geometry displacement at build time** (`mountainCpuDisplacement`), *not* per‑fragment GPU cost; the real per‑fragment peak cost is ~3 `fbmValue2` (~10 `snoise3` octaves) in the colorNode, plus peak‑on‑peak overdraw. Path live tri count is disputed between ~11k and ~20k depending on whether `pathData.radialSegments=8` or `PATH_LOD 16/12/12` wins the `Math.min` — **the per‑fragment O(8) cost is the architectural issue regardless of exact tri count.**

### Root cause C — loading & memory
- **43.36 MB / 25 uncompressed GLBs; 0 `.ktx2`.** The `KTX2Loader` + `MeshoptDecoder` are **wired but 100% inert** (assets never re‑exported; `optimize-odyssey-glbs.mjs` never ran — no `assets/_originals/`). odyssey-gltf-loader.js:25‑30.
- **~33.84 MB is DEAD‑but‑bundled:** the ch3 Quaternius props + 2 flying birds were disabled 2026‑06‑18 (`loadQuaterniusNatureAssets` is intentionally uncalled) **but the files remain committed and are still emitted into the Vite bundle** via eager `import.meta.glob` (chapter-03-quaternius-assets.js:16‑21). Pure ship/checkout/bundle weight, zero runtime benefit.
- **Live GLB payload ≈ 9.52 MB:** ch2 manta (4.52) + whale (4.52) loaded **serially** (`await manta; await whale`, deep-ocean-manta.js:194/200) + 3 conifer LODs (~0.95, correctly cached + instanced).
- **NO chapter eviction.** All 8 chapters build once and stay GPU‑resident; far chapters only `group.visible=false`. The only `environmentGroup.remove()` is in `dispose()` (whole‑subsystem). **Monotonic memory by construction.**
- Smaller drags: per‑frame `getBlendState` allocation (L9 part 2); ch2 bubble attribute re‑upload every frame (ungated); 100 `frustumCulled=false` sites (reference themes use 2–3 each, all justified).

---

## 4. Reference‑theme comparison — the five disciplines Odyssey violates

The audit extracted the architecture of all five reference themes. They **independently converged** on the same pattern. This is the best‑in‑class target.

| Discipline | Reference themes | Odyssey today |
|---|---|---|
| **1. Tiny, shared, up‑front material set** | e‑d‑v3 **2**, shifting‑sands **~6**, summer **~13**, lunara **~18‑20**, winter **~30** — **all built at scene creation** (no lazy first‑render compile) | **~150‑202** built lazily through MRT/Pass on first scroll → cold‑start white‑wash (RC‑A). Shared‑archetype pattern used in 1/8 chapters. |
| **2. Instance everything repeated, motion on GPU** | One InstancedMesh per repeated element reading a **compute storage buffer** directly in the vertex node — *no per‑frame CPU upload* (e‑d‑v3 90K particles = 1 draw; winter 11,512 flakes = 4 draws; summer 20K vegetation = ~12 draws; lunara/shifting‑sands rocks/crystals/particles) | Orb shells instanced ✅, but **55 inner cores un‑instanced**, ch8 41 un‑instanced draws, ch7 18 infall tubes, ch1 ~22 decals. **No GPU‑compute particle sim** — billboard clouds with in‑shader motion. |
| **3. Noise centralized + confined or baked** | One shared noise lib; noise used for *look* on small/distant surfaces or **baked per‑vertex** (winter bakes height/AO/crest CPU; e‑d‑v3 noise on one 192‑tri sphere) | ~106‑134 per‑fragment noise call‑sites; **two stacked full‑screen noise domes** in ch7; path evaluates all 8 styles/pixel (RC‑B). |
| **4. Zero/tiny procedural‑or‑async asset payload** | e‑d‑v3 / lunara / shifting‑sands = **0 bytes** (100% procedural); summer ~622 KB (abandoned 17.6 MB tree GLBs for a 73 KB instanced template); winter one 1.92 MB async fox. First frame needs **no assets**. | 43.36 MB uncompressed GLBs, dead KTX2 path, 33.8 MB dead‑but‑bundled (RC‑C). |
| **5. Authoritative dispose() — memory returns to baseline** | Every theme has a complete `stop()`/`dispose()` walking geometry/material/**uniform‑textures**/compute buffers + unsubscribing listeners (`BaseTheme.disposeThreeJSGroup` even frees `material.uniforms[*].value` textures) | No per‑chapter dispose; only whole‑subsystem teardown, and **even that skips textures** (CEM:1404‑1413 disposes geometry+material only). Monotonic memory. |

**Selective emissive‑MRT bloom** is a sixth, near‑universal reference pattern (e‑d‑v3, shifting‑sands, winter, lunara use `setMRT(mrt({output, emissive}))` so only `emissiveNode` surfaces bloom; summer gates bloom behind a flag). **Odyssey uses full‑frame *threshold* bloom** (`useMRT` defaults false and is never passed), so its ~9 per‑chapter `emitsBloom` tags are dead and bloom can't be art‑directed cheaply.

**Where Odyssey is genuinely ahead of the themes (preserve these):**
- **Adaptive‑quality controller** (ring‑buffer p95/p99 + hysteresis + 5 pressure tiers) — more sophisticated than any single theme. *Improve it by feeding a scroll/seam signal (lunara's EMA closed‑loop is the model) so it pre‑sheds before a seam spike instead of reacting ~1 Hz after.*
- **Persistent light rig** killing per‑seam pipeline recompile — themes don't need this (1 fixed scene) but it's the correct multi‑chapter solution.
- **Warm‑up/cold‑start machinery** (warmupMode, focus reveal, background render‑warm, startup trace) — themes don't need it; for Odyssey it's load‑bearing and well‑built.

---

## 5. Per‑chapter findings

Draw counts and material counts are *current‑tree* (corrected from the prior masterplan). "uninst" = separate meshes trivially mergeable to InstancedMesh.

| Ch | Name | Draws (uninst) | Mats | Heaviest per‑pixel | Top fixes (type) | GLB? |
|----|------|-----|------|--------------------|------------------|------|
| **1** | Earth Core | **~81 (36)** | ~36 | Lava lake ~25 noise/px (360² opaque); `moltenRockField` shared by ~20 mats | Share 1 column + 1 pocket material (**~18 fewer compiles**, zero‑visual); merge ~22 contact‑decals→1 (zero); lava‑lake fbm 4→3 oct + collapse the 2 domes (minor) | none |
| **2** | Deep Ocean | **~14 (0)** | 14 | 6 god‑ray cones (already 1 draw) 3 snoise3/px; seabed fbm3(5) | Parallelize manta+whale load (zero); gate bubble re‑upload (zero); KTX2 the 9 MB creatures + weld 75k→~25k verts (zero‑visual, 3:1 vert:tri); seabed 5→3 oct (minor) | **9 MB live** |
| **3** | Surface World | **~60 (26)** | ~36 | 3 canonical FBM mountains ~11 evals/px; 6 conifer mats | **Delete ~33.8 MB dead bundled GLBs** (zero); instance 28 birds+butterflies→2 (zero); share 6 conifer mats→3 (zero); mountain sparkle 3→2 oct (minor) | dead 33.8 MB; ~0.95 MB live conifers |
| **4** | Mountain Peaks | **~22 (8)** | ~16 | 6 co‑visible FBM peaks (~10 snoise3‑oct/px colorNode) + peak overdraw; cloud‑sea r2600 disc | Collapse 3 byte‑identical hero‑peak mats→1 (zero); instance 3 eagles→1, merge cairns (zero); foothill snowNoise 4→2 oct + bake static peak FBM (minor); progress‑gate cloud‑sea/plume off‑window (zero) | none |
| **5** | Sky Drift | **~27 (18)** | ~19 | 6 cloud strata (~36 fbm oct total) + 6 aurora curtains | **Collapse 6 strata→1 + 6 aurora→1 + 3 god‑rays→1 (instanced, zero‑visual: ~13 fewer compiles, ~12 fewer draws)**; bake time‑invariant dome mottle (zero); delete 4 dead PointLights (zero) | none |
| **6** | Cosmic Expanse | **~23 (11)** | ~23 | Void‑sky dome ~26 oct (~208 hash/px); ~3100 static star quads | **Bake void dome → cubemap** (~50‑100× fragment cut, minor); **bake static far starfield → cubemap** (zero‑ish); collapse 3 planet‑ring + 2 BH‑glow mats (zero); replace 5×/frame opacity traverse with a uniform (zero) | none |
| **7** | Black Hole | **~52‑68 (24)** | ~13 (already shared) | **TWO stacked full‑screen noise domes** (voidDome 4 calls + ambientWash 2 calls ≈ 30 oct/px) | **Fold ambientWash floor into voidDome + delete the wash mesh** (minor, removes a full‑screen pass); voidDome+wash 5→3 oct (zero‑ish); collapse accretion‑disk 3 compiles→1 + lensShell 3→1 (zero); merge/trim 18 infall tubes (minor) | none |
| **8** | Urban Dreams | **~57 (41)** | 18 (facade already 1) | Wet‑street fbm2(4) on 280×1400 floor; 7 haze curtains fbm2(5) | **Instance 18 sky‑traffic tubes→1, 9 rails→1, 4 signs→1, 4 spire conduits→1 mat** (zero); wet‑street 4→3 oct + shrink far half (minor); haze‑stack 5→3 oct + cull (minor) | none |

**Hero elements to preserve** are documented per chapter in the agent maps (e.g. ch1 First Heart caldera + lava‑fall + obsidian colonnade; ch2 god‑ray shafts + manta/whale escort; ch7 the camera‑locked lensed Gargantua hero + fold arcs). Every minor‑visual change is capture‑gated against these.

---

## 6. Mode‑global findings (the shared frame — highest leverage)

1. **Two full‑screen domes drawn every frame** — the global `OdysseyAtmosphere` r4000 camera‑locked dome (renderOrder −10000) paints the whole screen first, then each chapter's own full‑coverage sky dome overpaints it. `setDomeVisible(false)` exists but has **zero callers**. *Correction: chapter sky domes are **transparent** (`depthWrite:false`), so reordering won't enable early‑Z against them — the fix must **hide the global dome** per chapter, not reorder.* **L8.**
2. **55 inner fluid cores un‑instanced** — 55 compiled pipelines at cold start; ~20‑25 *drawn* per frame (proximity‑culled, so the prior "55 draws/frame" was inflated — but the 55‑pipeline cold‑start cost is real). The shells already prove the instancing pattern. **L6.**
3. **Path evaluates all 8 chapter styles per outer‑tube fragment** — `chapterAt` + `stylePattern`, O(chapter_count)/pixel, always present. The one cost that *grows* with chapter count. **L7.**
4. **Post:** `useMRT` always false (full‑frame threshold bloom, not selective emissive); `BloomNode` allocates **11 HalfFloat RTs at `_nMips=5` in its ctor**, then `_nMips` is lowered to 3 → **4 dead 1×1 RTs** freed only on dispose; film grain + dither run full ALU on every tier (amplitude‑scaled, not branched). **`PostProcessingStack.js` + `odyssey-post-fallback.js` are dead** (0 live importers — deletable). *Note: the 4 lazy output variants are the **shipped optimization**, not a regression — do NOT collapse them (the prior masterplan's L3 "collapse to 1" is **obsolete/wrong**: it would re‑introduce ch7 lens ALU on all 8 chapters and keep bloom rendering on dark chapters).*
5. **Per‑frame `getBlendState` allocation** — the hot path calls the public `getBlendState` which omits the scratch arg, allocating the return object + a `weights` map every frame (+ `ecotoneWeights` inside seam bands). *Correction: the bypass is **deliberate** (the result is threaded to multiple consumers and must not alias the internal `_blendStateScratch`); the real fix is a **separate board‑owned scratch**, not reusing the existing one.* **L9 part 2.**
6. **Background chapter loading has no progress‑awareness or eviction** — a player who never leaves ch1 still pays the build+upload of ch2‑8, and nothing is ever freed. **The streaming‑window fix.**

---

## 7. Target architecture (the best‑in‑class end state)

None of this requires rewriting the chapter system — these are surgical changes to the shared frame + a new eviction path.

- **(A) Active±N chapter streaming window + LRU eviction.** Add a **per‑chapter partial‑dispose helper** (today only whole‑subsystem `dispose()` exists, and it skips textures) that frees geometry/material/**uniform‑textures**/RTs for chapters outside the window; re‑create on approach (`createChapterEnvironment` already short‑circuits on `environments.has`, so re‑creation is supported). Adopt `BaseTheme.disposeThreeJSGroup`'s texture‑walk as the teardown template. **This is the structural fix for RC‑C and the scalability ceiling.** Gate off `keepBoardAlive`/RTX‑class GPUs so it never adds a transition compile where VRAM is ample (window = active±2).
- **(B) One shared archetype‑material registry.** Generalize `createSharedMotifMaterialsTSL` (proven for black‑hole) into per‑archetype parameterized graphs (rock / glow / disk / dome / foliage) driven by uniforms/instance attributes. Start with earth‑core (11 byte‑identical columns→1) and surface‑world. **Biggest remaining RC‑A lever.**
- **(C) Instance + compute the orb cores.** Collapse the 55 inner cores to one InstancedMesh sharing one `createFluidInnerTSL` material with per‑instance attributes (the shells prove it). Consider porting the sparkle cloud to a GPU‑compute storage buffer read in the vertex node (the e‑d‑v3/shifting‑sands/winter pattern).
- **(D) Path as a per‑segment 1‑D LUT.** Bake base/emissive colour + style id into a 1‑D `DataTexture` sampled by `vUv.x`, or gate `stylePattern`/`chapterAt` to the 1‑2 chapters the visible segment spans. Removes the O(8)/pixel cost and makes the path scalable to a 9th chapter.
- **(E) Activate the inert KTX2/meshopt path.** Run `optimize-odyssey-glbs.mjs` on the live GLBs, git‑add the artifacts, wire it into `package.json` + a CI/commit gate; delete/move the dead ch3 GLBs out of the eager glob.
- **(F) Selective emissive‑MRT bloom** (wrap `setMRT` in try/catch with single‑target fallback, like e‑d‑v3) so bloom is art‑directed; free the 4 dead bloom RTs (vendor/subclass `BloomNode` to alloc at `_nMips=3`).
- **(G) Scroll/seam‑aware adaptive quality** — feed the existing controller a coarse scroll‑velocity / seam‑proximity signal (lunara's EMA closed loop) so it pre‑sheds before the seam double‑render spike.
- **(H) Hard device‑safety cap** on the highest‑overdraw subsystem independent of preset (shifting‑sands caps sand‑smoke billboards at 560 on D3D to avoid WebGPU TDR — directly relevant to this machine).

---

## 8. Prioritized implementation plan — capture‑gated waves

Ordered by impact ÷ effort ÷ risk; each wave is independently shippable, test‑gated (`webgpu-tsl-build` + lint + unit), and ends with the per‑chapter capture checkpoint (§9).

### Wave 0 — Land the in‑flight diagnostics branch + free dead weight (zero‑visual, no capture)
- **Commit the uncommitted warmup‑mode/diagnostics/deferred‑loading branch first** — it implements the §9 measurement protocol and is the prerequisite for capture‑gating everything else.
- **L1a: delete/move the ~33.8 MB dead ch3 Quaternius/bird GLBs** + remove their eager `import.meta.glob`. (git‑rm + `.gitignore`, or move out of the globbed dir.) Pure bundle/checkout win.
- **Delete dead post files** `PostProcessingStack.js` + `odyssey-post-fallback.js` (0 live importers).
- *Target: −33.8 MB bundle; cleaner tree. No render change.*

### Wave 1 — Asset compression + cheap cold‑start/pacing wins (zero‑visual, confirm‑load only)
- **L1b: run `optimize-odyssey-glbs.mjs`** on the 5 live GLBs (manta/whale dominate), git‑add KTX2/meshopt artifacts, wire into `package.json` + commit gate.
- **Parallelize manta+whale load** (`Promise.all`, deep-ocean-manta.js:194/200); **gate the ch2 bubble re‑upload** behind a dirty flag.
- **L9 part 2:** add a board‑owned blend‑state scratch for the per‑frame `getBlendState` call.
- *Target: live GLB ~9.5 MB → ~3‑4 MB; ch2 build latency halved; ~600 alloc/s removed. Confirm binary‑identical render.*

### Wave 2 — Draw‑call / instancing / dome (zero‑visual, per‑chapter capture)
- **L6: instance the 55 inner cores → 1 InstancedMesh.**
- **L8: `setDomeVisible(false)`** per chapter that owns a full‑coverage sky dome (one line each).
- **Per‑chapter clusters:** ch5 6 strata→1 + 6 aurora→1 + 3 god‑rays→1; ch8 18 traffic→1 + 9 rails→1 + 4 signs→1 + 4 conduit mats→1; ch1 ~22 decals→1 + 11 column mats→1 + ~20 pocket mats→2; ch3 28 birds/butterflies→2 + 6 conifer mats→3; ch4 3 hero‑peak mats→1 + 3 eagles→1; ch6 5 ring mats→2 + opacity‑traverse→uniform; ch7 accretion 3→1 + lensShell 3→1.
- *Target: −~120 cold‑start pipeline compiles; one full‑screen overdraw layer removed per chapter; steady‑state +15‑30 fps headroom + lower seam stutter.*

### Wave 3 — GPU‑fill noise‑bake / octave cuts (minor‑visual, capture EVERY touched chapter)
- **L5:** ch6 void dome → cubemap + far starfield → cubemap (the single biggest fill win); ch7 fold ambientWash into voidDome + 5→3 oct; ch1 lava‑lake fbm 4→3 + collapse 2 domes; ch4 foothill snowNoise 4→2 + bake static peak FBM; ch5 bake time‑invariant dome mottle; ch8 wet‑street/haze 5→3 oct.
- **L7:** path → 1‑D LUT (or segment gate).
- **F:** selective emissive‑MRT bloom + free 4 dead bloom RTs.
- *Target: kill scroll lag at seams; the heaviest fragments drop 40‑100×.*

### Wave 4 — Streaming window + memory lifecycle (capture‑gated, highest structural value)
- **(A) Active±2 chapter LRU eviction** + per‑chapter dispose helper (with texture walk) + re‑create‑on‑approach; gate progress‑aware background creation.
- **(G) Scroll/seam‑aware adaptive quality**; **(H) device‑safety overdraw cap**.
- Re‑enable `frustumCulled` on the ~100 blanket‑disabled bounded set‑pieces; far‑plane trim.
- *Target: flat memory on idle (no monotonic growth), scalable to N chapters, TDR‑safe headroom on weaker GPUs.*

---

## 9. Performance targets & measurement protocol

**The board cannot be screenshotted headless and a full‑journey capture has TDR‑crashed the dev machine.** The source of truth is the **in‑app `perfMonitor`** (the Wave‑0 diagnostics branch already adds p50/p95/p99 + spike collector + startup trace) + **short per‑chapter captures by the user**. The static counts in this doc (bytes, draw calls, material counts, noise octaves, `frustumCulled` sites) *are* measurements and gate the zero‑visual waves without capture.

| Metric | Baseline (measured/counted) | Target |
|---|---|---|
| Cold‑start p95 / p99 | 3406 ms / 8281 ms | **p95 < 1000 ms, p99 < 2500 ms**, no white‑wash |
| Cold‑start spikes >33 ms | 26 | < 8 |
| Steady‑state fps (warm, Extreme) | ~149 | ≥ 149 (no regression) + lower variance |
| First‑scroll‑into‑far‑chapter hitch | present if bg‑warm out‑scrolled | **0 visible‑frame compiles** (force synchronous warm on approach) |
| Live GLB payload | 9.52 MB uncompressed | ~3‑4 MB KTX2/meshopt |
| Bundle GLB weight | 43.36 MB committed | ~6‑10 MB (dead deleted + live compressed) |
| Idle memory drift (60 s in‑mode) | climbing (no eviction) | **flat** (Wave 4) |
| Cold‑start pipeline compiles | ~150‑202 materials + 55 cores | < ~60 (archetype registry + instanced cores) |
| Per‑chapter peak fragment cost | ch6 ~26 oct, ch7 ~30 oct, ch1 ~25 evals | ≤ ~6 oct (baked) on full‑screen domes |

**Per wave the user captures (short per‑chapter sessions):** (1) cold start → overlay p50/p95/p99 + spikes; (2) slow‑scroll each chapter → fps + frame‑time p95 (watch list: ch1, ch3, ch6, ch7); (3) enter→exit one level → return hitch; (4) idle 60 s → memory drift; (5) one capture per touched chapter vs the pre‑wave capture for the named hero elements.

---

## 10. Risks, dependencies & regressions to monitor

- **Noise‑bake (Wave 3) is the broadest minor‑visual risk.** Low‑frequency haze/dome bakes are 8‑bit‑identical (the corridor field already proved it); hero high‑frequency detail stays analytic. Every baked chapter is capture‑gated against its hero list.
- **Streaming‑window eviction (Wave 4)** must be gated off `keepBoardAlive`/RTX‑class GPUs so it never *adds* a transition compile where VRAM is ample (window = active±2). Re‑create‑on‑approach must force a synchronous warm so it doesn't reintroduce the first‑visit hitch the eviction is supposed to be safe around. **Highest structural risk; ship behind a flag with full‑resident fallback.**
- **Path LUT (Wave 3, L7)** must preserve the seam crossfade band — verify the 1‑2 co‑visible chapters still blend smoothly at the boundary.
- **Hero‑creature weld/decimate** (ch2 manta/whale, 3:1 vert:tri) is the highest single visual risk after baking — conservative `simplify`, keep `COLOR_0`, capture before/after.
- **Selective MRT bloom (Wave 3, F)** — `useMRT` has never been exercised on this board's pipeline (defaults false); wrap in try/catch with the threshold‑bloom fallback (e‑d‑v3 pattern) so a GPU that rejects MRT doesn't black the frame. Re‑tune additive brightnesses only *after* MRT is live.
- **Do NOT:** collapse the 4 post output variants (that's the shipped optimization, not a regression); add TAA (ghosts on the moving board) or MSAA (correctly off); attempt full‑journey headless capture (TDR).
- **Dependency:** Wave 0 (diagnostics branch) must land first — it is the measurement substrate for capture‑gating every later wave.
- **Stale‑comment cleanups (low‑risk, do alongside):** fast‑start "opt‑in" comments (it's default‑on); the "7040‑particle" sparkle comments (actually 96/node = 5280); the path‑renderer "live renderer untouched / raw GLSL" header (the TSL builders ARE the live path now); CEM:799‑800 "all‑chapters eager window ... no‑op" (the live window is small).

---

## 11. Visual‑preservation guarantee

The per‑chapter hero lists (in the agent maps, summarized §5) are the contract. **Waves 0‑2 are pixel‑identical by construction** (deletion of dead assets, compression, instancing, material‑sharing, dome‑hide, allocation fixes — no fragment math changes). Only Waves 3‑4 alter fragments/geometry/residency, and each is gated behind a per‑chapter capture comparing the named heroes. If any chapter reads as cheaper, that item is reverted or dialed back — **the look is the acceptance test, not the framerate.**
