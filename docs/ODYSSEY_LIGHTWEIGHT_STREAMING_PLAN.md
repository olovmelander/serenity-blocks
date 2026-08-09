# Odyssey "keep the journey, make it light" — lightweight streaming plan (2026-07-28)

> User steer: *"I want it quick to start and smooth while active."* Keep the cinematic
> scroll-through-8-worlds journey, but render **full detail only near the player** (AAA
> streaming/LOD working set) + lighten each chapter — and in doing so **reduce net complexity**
> (replace the intricate warm/prewarm/eviction machinery with one windowed model).

## Diagnosis (measured from code)

Two costs are paid for the whole 8-chapter journey when only 1–2 chapters are ever on screen:

- **Working set:** steady-state residency is **8/8 full-detail environments** (LEVER-2 eviction ships
  OFF, `OdysseyBoardController.js` 317–324). Only 1 chapter is drawn mid-chapter / 2 at a seam
  (`updateVisibility` sets `group.visible = opacity>0`). So ~6–7 chapters cost VRAM + a share of the
  **union light set** + traversal, for no draw calls.
- **Per-chapter weight, front-loaded onto two chapters:**
  - **surface-world (Ch3):** ~**28** distinct NodeMaterial pipelines (24 MeshBasic + 4 Lambert) →
    ~28 cold compiles = the Ch3 first-visit freeze; ~**2,556** live instances (1400 meadow-flowers +
    600 pollen + 220 reeds…); **23 GLB** placements / 15 models (~1.6 MB); a real `reflector()` = a
    **2nd full scene render per frame** (the only chapter with one) + 2 MRT.
  - **earth-core (Ch1):** ~19 materials (the set's only 2 PBR), ~2,100 particles, 72×72 terrain, a
    **measured 3.1–3.8 s cold compile**. Material ranking across chapters: 28/19/17/13/12/12/10/9.
- **Machinery:** `OdysseyBoardController.js` + `ChapterEnvironmentManager.js` carry **~1,300–1,450 LOC**
  of scheduling whose only job is to *hide* those compiles by front-loading/re-ordering — none of it
  reduces them. Three journey-spanning background paths + a ~240-LOC warm replay + five bounded-wait/
  retry/starvation escapes + a ~450-LOC adaptive-quality controller whose freeze/resume exists mainly
  to survive the warm sweep's own frame-time pollution ("low-res at 222fps").
- **So:** slow start = pre-reveal replay + eager full builds gating first paint on cold compiles;
  scroll lag = at a seam the outgoing chapter pays full particle/reflector/MRT cost while fading.

## Target architecture

**One residency scheduler + one on-approach warm + one continuous LOD signal**, all driven off the
arc-length blend weights `resolveChapterBlendState`/`updateVisibility` already compute each frame —
*replacing* three front-loaders, five escape hatches, and the adaptive freeze/resume. Three tiers
keyed on distance-from-player:

- **NEAR** (active ± seam partner): full detail — all materials, reflector, MRT, full density.
  Untouched → the cinematic look is preserved exactly where the player looks.
- **MID** (adjacent, visible off-center): a per-frame `detailLevel` gate tells the chapter's own
  `update()` to early-out its heaviest sublayers (drop the reflector pass, freeze/hide big additive
  clouds, skip secondary instanced meshes) **without teardown** → no re-create hitch, no recompile.
- **FAR** (outside the window): the environment is **evicted** (LEVER-2 already implemented), leaving
  a cheap **far-proxy** (fogged silhouette card) + **one placeholder light**, so a far chapter costs
  ~1 draw + 1 light instead of ~25 materials and its share of the union light set.

Because near/mid absorb the transition band and the proxy hides the horizon, the resident window can
shrink to **active±2**. This **replaces rather than adds**: once the window is the single source of
residency truth, the whole-journey render-warm sweep, the background loader, and the warm replay are
duplicative, and the five escape hatches lose their reason to exist. **Net: ~350–500 LOC removed**,
three schedulers → one, five escape hatches → zero — while the cinematic journey stays intact.

## Staged plan (each independently shippable, flag-gated where risky)

| # | Goal | Effort | Risk | Perceivable win |
|---|---|---|---|---|
| **1 ✅** | `detailLevel` signal + surface-world sublayer gate (`?odysseyChapterLOD=1`) | med | safe | Smoother Ch3 seams (reflector + ~2k quads not drawn while Ch3 is off-center) |
| 2 | Extend `detailLevel` early-outs to every chapter + safe density trims (meadow 1400→~700, pollen 600→~300, earth-core terrain 72²→48², cosmic dust 1450→~900) | med | safe | Flatter frame-time across all seams + lighter builds |
| 3 | Decouple "eviction owns residency" from "eviction disables warm"; window = active±2; flip eviction default on | med | mod | Lower VRAM + smaller light/pipeline surface, no re-enter hitch |
| 4 | Shrink the pre-reveal eager window (focus±1 → focus) now neighbors show as MID/proxy | med | mod | Reveal happens sooner |
| 5 | Land far-proxy + placeholder-light tier; **DELETE** the redundant front-loaders (~350–500 LOC) | large | mod | Far chapters read as fogged silhouettes; system predictable; the "less complex" payoff |
| 6 | (Optional) bake compile at source: earth-core noise → texture; consolidate surface-world's 24 MeshBasic billboards → ~8–10 shared pipelines | large | risky | Even a cold GPU streams without a visible hitch |

**Ordering discipline:** land 1–2 (pure additive, safe) and prove the scroll win before Stage 3
changes residency; do not delete any front-loader (Stage 5) until Stage 3 has made the window
authoritative and it's verified in-game. Deletion is the last, revert-only step.

## Stage 1 — SHIPPED

Flag `?odysseyChapterLOD=1` (default OFF → byte-identical). Additive, no teardown, no recompile.
- `OdysseyBoardController`: `chapterLodEnabled` flag (mirrors `chapterEvictionEnabled`), threaded into
  the manager options.
- `ChapterEnvironmentManager.updateVisibility`: writes `group.userData.detailLevel`
  (near/mid/far/hidden) from opacity + activeChapter; OFF → always near/hidden.
- `surface-world.updateSurfaceWorldEnvironment`: when off-center (not `near`), hides the ocean/
  reflector subgroup (skips the 2nd scene render) + the meadow-flower + pollen clouds; restored the
  instant it's centered again.

**Verify (in-game):** load Odyssey with `?odysseyChapterLOD=1`, scroll the 2→3 and 3→4 seams watching
frame-time (should hold flatter than flag-off); center Ch3 and confirm the lake mirror + meadow/pollen
are full (identical to off). The only visible difference is on off-center frames — your A/B is the
acceptance gate (the board can't be captured headless).

## Guards

Touches **only** `src/rendering/odyssey/**` + `OdysseyMode.js` — zero overlap with the parallel
stillwater work; stage exact files at commit. Every stage flag-gated with an off switch. Each early
stage names a specific checkable win — if the A/B shows none, stop rather than proceed on faith. The
re-create hitch (why eviction shipped OFF) is not reintroduced early: Stage 3 keeps on-approach warm
and only ships after 1–2 lighten the compile. NEAR/MID keep the persistent light rig (no seam
recompile); the placeholder-light fold (the only light-SET change) lands last, isolated.
