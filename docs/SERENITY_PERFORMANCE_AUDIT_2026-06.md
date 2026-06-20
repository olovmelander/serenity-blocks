# Serenity Blocks — Performance Audit & Plan (2026-06-17)

Multi-agent audit across four dimensions: Odyssey board **pipeline-count** (the cold-start compile bottleneck), board **runtime FPS**, gameplay/theme **runtime FPS**, and **asset/load**. Findings ranked by ROI ÷ effort ÷ risk.

> **Framing for cold-start:** the board warm-up is ~16–20 s split between **(a) WebGPU pipeline compilation** and **(b) GPU asset upload** (43 MB of uncompressed GLB textures/geometry). Slicing chapters only moves cost between buckets. The two real levers are **fewer unique pipelines** (compile side) and **KTX2/meshopt** (upload side). Also: the dev server recompiles every reload — measure cold-start on `npm run build` + preview, not dev.

---

## Tier 0 — Safe quick wins (no visual change; shippable without capture verification)

| # | Win | File | Est. | Status |
|---|---|---|---|---|
| 0.1 | Raise node re-upload epsilon `1e-5→1e-4` (idle sway no longer re-flushes 7040-particle buffer) | [LevelNodeManager.js:87](../src/rendering/odyssey/LevelNodeManager.js#L87) | 0.4–0.8 ms/frame idle | ✅ **shipped** |
| 0.2 | `warmOutputVariants` skip when eager-window active (far ch7/dark variants warm on first visit) | OdysseyBoardController `_warmUpJourney` | ~7 s cold-start | ✅ **shipped (earlier)** |
| 0.3 | Cache `blendState`, thread into `updateGlobalEnvironment()` (stop re-resolving seam math) | OdysseyBoardController:1436/1494 | 0.1–0.3 ms/frame | ✅ **already done** (QW6 cache) |
| 0.4 | Gate light-rig crossfade writes on weight-change > 1e-4 (skip redundant intensity writes on settled frames) | ChapterEnvironmentManager:1103 | 0.3–0.6 ms/frame | ✅ **shipped** |
| 0.5 | `Matrix4.equals()` → position+quaternion compare | LevelNodeManager:1183 | — | skipped (equals is allocation-free + is the guard) |
| 0.6 | Gate atmosphere/threshold/path idle updates on state-change | OdysseyAtmosphere:137, OdysseyPathRenderer:467 | ~0.1 ms/frame | TODO (marginal) |

Tier-0 total board idle saving ≈ **1.5–2.5 ms/frame**, pure CPU caching, zero visual risk.

---

## Tier 1 — Gameplay FPS (general perf; affects actual play, esp. cascades)

| # | Win | File | Est. | Risk |
|---|---|---|---|---|
| 1.1 | ✅ **SHIPPED** — Pooled the per-frame/per-region `Map`/`Set`/array allocations in board draw (`colorCache`, `visited`, flood-fill `group`+`stack`, traceLoops `startMap`+`used` → instance fields `.clear()`d) | [base-board-scene.js:827,874,887,1339,1357](../src/rendering/phaser/base-board-scene.js#L827) | **15–25 % fewer GC pauses** during cascades | low (logic-identical; 173 tests pass) |
| 1.2 | Particle buffers: `bufferData(full)` every frame → `bufferSubData(changed-range)` / skip-frame for low-variance particles | [renderer.js:620,637](../src/rendering/renderer.js#L620) | **20–40 % WebGL bandwidth** | medium (pop-in) |
| 1.3 | Radial-wave: spawn **1 emitter w/ N particles** instead of N emitters w/ 1 (mega-combos spawn 160 emitters) | [shared-effects.js:770](../src/rendering/phaser/shared-effects.js#L770) | 10–15 % GC on big combos | low |
| 1.4 | Firefly behavior: pre-baked wander LUT + single phase counter (drop 6-float blink state machine); −15 % count on heavy themes | renderer.js:379 | 10–20 % particle CPU | low-med |
| 1.5 | Peak eagles: skip `mixer.update()` every other frame (skinned-mesh palette is costly, eagles are distant) | peak-eagles.js:163 | 5–10 % transform cost | low |

**1.1 is the headline gameplay win** — logic-identical allocation pooling, smooths frame-time during line clears/cascades.

---

## Tier 2 — Cold-start: KTX2 + meshopt (the asset-upload lever)

The Odyssey GLBs total **43 MB uncompressed** with **no KTX2Loader / no MeshoptDecoder** registered. This is a large chunk of the `creates` + warm-up upload cost (chapter 3 alone loads ~24 MB Quaternius; flying birds are 4.4 MB each).

| # | Win | File | Est. |
|---|---|---|---|
| 2.1 | ✅ **SHIPPED** — `KTX2Loader` + `MeshoptDecoder` registered in the shared loader; `setOdysseyGltfRenderer(renderer)` calls `detectSupport` at board init. Backward-compatible (still loads current uncompressed GLBs). | [odyssey-gltf-loader.js](../src/rendering/odyssey/chapter-environments/shared/odyssey-gltf-loader.js), OdysseyBoardController:418 | enables the rest |
| 2.2 | Re-export GLBs → KTX2 + meshopt via **[scripts/optimize-odyssey-glbs.mjs](../scripts/optimize-odyssey-glbs.mjs)** (needs `toktx`/KTX-Software). Skinning-safe (no simplify/join/weld). Backs up originals to `assets/_originals/`. | assets/*/*.glb (25 files, 43 MB) | **43 MB → ~6–8 MB**, ~8–12 s less VRAM decode + upload |
| 2.3 | LOD the 4.4 MB flying birds (low-poly billboard for distant) | surface-world.js:211 | ~12 MB off cold-load |
| 2.4 | `eager:true → lazy` asset globs (stop bundling unused chapter asset URLs) | chapter-0x-*-assets.js | ~20–30 KB JS/chapter |

⚠️ KTX2/meshopt needs the **C:\AI Blender pipeline** for re-export, and re-export is lossy → **per-chapter screenshot re-capture** after. The loader wiring (2.1) is safe code; the asset re-export is the work. **This is likely the single highest-ROI cold-start change.**

---

## Tier 3 — Cold-start: pipeline-count consolidation (your chosen refactor; the compile lever)

Estimated ~120–185 unique pipelines compiled at cold start. Consolidation targets, ordered by pipelines-saved ÷ effort. **All touch visual TSL → require per-chapter screenshot verification (your capture sessions) per CLAUDE.md.**

| # | Win | Est. pipelines | Effort | Risk |
|---|---|---|---|---|
| 3.1 | **One shared additive-billboard-particle material** (texture/tint/opacity as uniforms) replacing the per-chapter copies (sparkles, smoke, embers, leaves, motes…) | **40–60** | medium | visual |
| 3.2 | **One hero-surface builder per TYPE** (liquid / sky / terrain) with a chapter-palette uniform, replacing 8× near-identical noise materials | **40–50** | medium | visual |
| 3.3 | Per-node fluid-core → one shared material w/ optional theme-texture uniform (placeholder when null, so no pipeline fork) | 15–25 | small | visual |
| 3.4 | Promote hardcoded per-chapter colors/scales to **uniforms** (kills invisible pipeline splits) | 10–20 | small | low |
| 3.5 | Downgrade unlit/self-emissive `MeshStandardNodeMaterial` → `MeshBasicNodeMaterial` | 5–10 | small | low |
| 3.6 | Bake chapter hero-surface noise to a DataTexture (mirror the corridor-field pattern) instead of 300-line procedural graphs | 20–30 (compile latency) | large | visual |

**Recommended order:** 3.4 → 3.5 (low-risk, no visual change) → 3.3 → 3.1 → 3.2 → 3.6. Each batch verified by a per-chapter capture before the next. Realistic compile reduction: **~30–40 %** of the pipeline count if 3.1+3.2+3.3 land.

---

## Tier 4 — Load hygiene (low priority)
- `<link rel=prefetch>` for the next chapter's chunk + GLBs (200–500 ms less scroll-in stutter).
- `rollup-plugin-visualizer` in build to flag chunk-size regressions (OdysseyMode is 505 KB).
- Split `odyssey/composition/` into its own chunk (~80 KB off critical path).

---

## Recommended sequence
1. **Tier 0 + Tier 1.1** (safe, no capture needed) — ship now: board idle + gameplay cascade smoothness.
2. **Tier 2.1 + 2.4** (loader wiring + lazy globs, safe code) — then the asset re-export (2.2) when the Blender pipeline + capture session are available. Biggest cold-start win.
3. **Tier 3** pipeline consolidation, low-risk batches first (3.4, 3.5), each gated on a per-chapter capture.
4. **Tier 1.2–1.5, Tier 4** opportunistically.

Cold-start realistically lands at **~8–12 s** (from ~24 s) with Tier 2 + Tier 3 together; the rest is general FPS/quality-of-life.
