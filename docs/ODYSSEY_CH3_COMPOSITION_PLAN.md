# Odyssey Chapter 3 (Surface World) — Composition & Framing Plan

_Date: 2026-06-15. Grounded in a live capture (localhost:5173, ~9% progress) + a
parallel code-lever map of the sun/sky, trees, landscape/lake, and camera-framing
subsystems. Screenshot-driven per `CLAUDE.md`; full-chapter capture is the user's
(TDR constraint — batch code, then one short per-chapter capture)._

## What the capture shows (the honest read)

A pretty but **washed, flat-midground, focal-less** frame:

- **No visible hero sun.** The disc exists but sits front-**right** and low, often
  off-frame or lost; the sky reads cool daytime. No warm focal point, no leading line.
- **Mountains over-hazed.** The distant snow range is half-dissolved in heavy white
  mist — depth cue overshot into "washed out."
- **Lake is a stripe.** Water covers ~12% of the plane and reads as a thin band
  between green hills, not a destination/feature.
- **Trees read as scattered toy stamps.** Sparse, uniform color, flat — no
  per-instance variety, no golden-hour rim on the GLBs (procedurals get rim, GLBs don't).
- **Midground void.** Terrain is soft broad ripples with no near silhouette or
  mid crest; the eye floats over it to the sky.

## Key reframe: the "world-of-claudecraft trees"

WoC's foliage uses the **same Quaternius Stylized Nature MegaKit (CC0)** that
Chapter 3 already owns (all 18 models). So importing its *models* gains nothing.
What WoC has that we lack is the **system**: per-instance HSL tint jitter
(`softTint`), scale/rotation jitter, density scatter via `InstancedMesh`, gentle
wind sway. **Recommendation: ADAPT the variety ideas, don't port the WebGL system.**

## Sun question → yes, and on the left

Moving the sun to the **left of the mountain ridge** is the right call:
1. It gives the frame the focal point + golden-hour warmth it's missing.
2. It **unifies the light source** — the terrain key light already rakes from the
   left `(-90,38,-120)`, but the visible sun is on the right. Today's frame lights
   from one side and shows the sun on the other.
3. Bloom is available (global `UnrealBloomPass`, strength 0.4–0.8) — a brighter
   additive disc will actually glow without needing the (off) MRT selective path.

## Prioritized work (impact × low-risk-first; each batch is capture-verifiable)

### Batch 1 — Hero sun + atmosphere balance _(highest impact, mostly low risk)_
- Expose `sunDir` as one shared constant (today it's a magic number duplicated in
  `createSunDiscTSL` [surface-world.tsl.js:1719] and the sky dome ~:354).
- Move it **left + just above the ridge** (≈ `(-0.42, 0.20, -0.88)`), grow/brighten
  the core+corona, confirm it blooms.
- Re-aim the god-ray fan + warm the rays to originate from the new sun.
- **Dial the mountain mist DOWN** so the range reads solid again; add a thin warm
  golden-hour belt just above the ridgeline instead of a white wash.
- _Playground-prototype the disc+rays in isolation, screenshot, then port._

### Batch 2 — Trees with real variety _("better trees" using assets we own)_
- Stop flat-recoloring the GLB trees; keep/relight their own materials (same trick
  that just worked for the birds) **or** add per-instance hue/sat/scale jitter to
  the role-recolor (`resolveQuaterniusRuntimeColor` / placement `colorJitter`).
- Add a golden-hour rim term to the GLB tree materials so they match the procedurals.
- Increase cluster density + scale spread so forests read as masses, not dots.

### Batch 3 — Lake as a feature
- Expand sea extent (`CH3_WATER_READABILITY_SETTINGS` seaWidth/seaDepth) toward
  ~20–25% of the plane; warm the shallow color; add a soft **sand→grass shore**
  transition (kill the 1-unit painted wet band).
- Make the water catch the new sun (specular/reflection toward sunDir).

### Batch 4 — Depth & framing
- Add a single mid-distance haze *belt* (not a full wash) between near land and far
  mountains; add one mid-foreground terrain crest for near/mid/far recession.
- Camera: dip the eye slightly + small parallax toward the Great Tree at the hero
  beat (`OdysseyCameraController` CHAPTER_FRAMING_OVERRIDES[3] / resolveChapter3Framing).
- Optional foreground framing anchor (dark frame-edge foliage) to embed the camera
  in the valley instead of floating above it.

## Constraints
- One small effect per playground session (iGPU TDR risk on big captures).
- Camera changes affect gameplay readability — keep gentle, verify the board still reads.
- Batch code changes, then hand off for ONE short Chapter-3 capture per batch.
