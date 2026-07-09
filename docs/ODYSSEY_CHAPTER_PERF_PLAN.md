# Odyssey Runtime FPS — Chapter-by-Chapter Optimization Plan (2026-06-17)

5-agent audit of per-frame cost (4 chapter-pairs + always-present/adaptive-quality). The board is GPU-bound at **Extreme** quality: particle overdraw + additive fill + heavy per-fragment FBM/noise across co-visible chapters during scroll. The audit estimates the chapter reductions recover **~50–70% of the perceived scroll lag**.

Split by **visual impact** — `none` ships without capture; `minor` needs a per-chapter screenshot check (the audit, which read every line, judged these imperceptible at gameplay distance/speed).

---

## ✅ Shipped (zero-visual)
- **Glass shell `48→32` + inner core `32→24` segments** ([LevelNodeManager.js:123](../src/rendering/odyssey/LevelNodeManager.js#L123)) — the 55 orbs render every frame in every chapter (was 4704 tris × 55). ~44% of those tris gone, ~2–3 fps. Verified, 94 tests pass.

---

## Tier A — Always-present (renders EVERY frame in EVERY chapter = highest leverage)
| Win | Impact | Effort | Est. | File |
|---|---|---|---|---|
| Sparkle cloud 7040 particles → per-node count scaled by quality + cull far/off-screen nodes | minor | medium | 2–5 fps in scroll | LevelNodeManager.js:1042, level-node-manager.tsl.js |
| Atmosphere dome `setDomeVisible(false)` for chapters with their own full backdrop (already built, never wired) | none* | small | 2–4 fps in those chapters | OdysseyAtmosphere.js:205, ChapterEnvironmentManager |
| Adaptive quality: react to **scroll** (drop bloom/post tier when camera delta is high, recover slowly) instead of waiting ~7 s | none | medium | 1–2 fps stability | OdysseyAdaptiveQuality.js (1 Hz/6 s/12 s) |
| Corridor field: only render the visible ±1 chapter's particulates/sheets (renders all 8 now) + wire `setQualityScale()` | minor | small | 1–2 fps | odyssey-corridor-field.js:321,641 |
| Path renderer: `StaticDrawUsage` buffers, skip Frenet recompute when path static | none | small | 0.5–1 fps | OdysseyPathRenderer.js:42 |

\* Dome cull is zero-visual *only* for chapters whose backdrop fully covers the screen — must verify per chapter (else black gaps).

## Tier B — Per-chapter particle counts (Extreme is over-aggressive; audit: all drop 25–35% imperceptibly)
| Chapter | Reduction | Est. |
|---|---|---|
| **Ch1 Earth Core** | emberStars 1200→900, smoke 320→200, magmaCloudDeck 220→140 | 15–20% |
| **Ch2 Deep Ocean** | plankton 420→280, bubbles 250→160; jelly tendrils 3→2 | ~15% |
| **Ch3 Surface World** | meadow flowers 3600→2400, pollen 260→180, snow-motes 220→160 | ~2–3 ms |
| **Ch4 Mountain Peaks** | falling snow 1000→700, ray fan 7→5 | ~1 ms |
| **Ch5 Sky Drift** | wisps/strata/aurora ribbons | part of the ~10–14 ms |
| **Ch6 Cosmic** | dust 900/1100, nebula sprites | (capped already; trim) |
| **Ch7 Black Hole** | lensing starfield 1100→700, corridor dust 1200→700 | 15–18% Ch7 |
| **Ch8 Urban** | rain curtain 480, neon haze | ~5% |

## Tier C — Per-chapter geometry LOD + shader trims (minor-visual)
- **Sphere/plane segments −25–35%** everywhere (lava floor 112²→64², domes 48²→32², water ceiling 64²→48², void/sky domes). ~8–12% tris, audit says imperceptible.
- **Noise octave cuts / texture-bake FBM** on the heavy procedural surfaces (lava, ocean ceiling, cloud strata 5→3, void-sky 21→16, nebula warp 2→1, wet-street 2). The single biggest fragment win (~15–20%), esp. Ch5/6.
- **Cap expensive shaders by `uDepth`** — only evaluate full FBM when the camera is mid-chapter, not approaching/leaving.

## Tier D — Draw-call merging (zero-visual, structural)
- **Ch3** vegetation 4 InstancedMesh → 1; Quaternius props 21 meshes → 1–2 merged.
- **Ch7** infall tubes 18 draws → 2 InstancedMesh; glow rings 3 → 1.
- **Ch8** sky-traffic 18 tubes → 2, ground-haze 9 → 1, eagles 3 Mesh → InstancedMesh.
- **Double-sided → front-only** plane cull across Ch5/6 (camera never sees back faces). Zero-visual, ~1.5–2.5 ms.

---

## Recommended order
1. **Tier B + Tier C on the heaviest chapters first (5, 6, 7, then 1/2/3)** — the biggest scroll-FPS recovery. Per chapter: trim particle counts + segment LOD + noise octaves, then **you capture that chapter** to confirm it still looks right. One chapter per pass.
2. **Tier A sparkle-cloud cull + corridor cull** — helps every chapter.
3. **Tier D draw-call merges** (zero-visual, can batch).
4. **Adaptive quality scroll-reactivity** last (delicate — avoid render-scale resize-hitches; prefer bloom/post tier drop on scroll).
