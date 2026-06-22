# Winter — Distant Trees Across the Lake: a best-in-class plan

**Question (user):** do we really need 340 detailed trees in the distance? Should we use
silhouettes / other techniques to make the far treeline more beautiful?

**Short answer:** No. The far treeline should be **colour + shape**, not geometry. The
single biggest beauty lever is **atmospheric perspective** (Firewatch's whole trick),
not more detail. Keep a thin band of real trees near the shore; dissolve everything
behind it into cool haze.

---

## 1. Why the current treeline underperforms

The current belt = **340 fully-modelled stacked-tier spruces** (3 variants), 6 rows,
`z -1880 → -2540`, heights 90–190, instanced
([winter-wonderland.effect.js:87-89](../src/playground/effects/winter-wonderland.effect.js#L87) +
[:599-612](../src/playground/effects/winter-wonderland.effect.js#L599),
[framing-spruces.js placeTreeline:198](../src/themes/winter/rendering/framing-spruces.js#L198)).

- **It's busy.** 340 individually-readable trees fight the calm, graphic look of the
  rest of the scene (low-poly peaks, flat lake, big aurora). Detail at distance reads as
  noise, not richness.
- **It shimmers.** Tiny tree tops are sub-pixel → temporal aliasing (the flicker you saw).
  We've patched it twice; the *real* fix is to not have sub-pixel geometry at all.
- **No aerial perspective.** The trees get **no scene fog** — only the drifting mist
  bands pass in front of them ([buildSnowMist:460](../src/playground/effects/winter-wonderland.effect.js#L460)).
  So the far rows are nearly as saturated/dark as the near ones → depth collapses, and at
  night the dark green crushes toward black (the worst thing for depth).
- **Wasted cost.** ~840k tris + the z-fight polygonOffset, for geometry no one can resolve.

## 2. The principle (from the research)

Firewatch removes detail and lets **colour carry depth**: a distance-driven colour ramp +
"trees puff out" alpha, so distant forest becomes clean flat silhouettes that **lighten,
cool, blue-shift, and lose contrast** with distance, finally melting into the **sky-horizon
colour**. Rules that matter for us:

- **Value must LIGHTEN with distance at night** — never crush the far treeline to black, or
  depth dies. Our `GREEN 0x4a7a4f` does the opposite right now.
- **Far stop = sky horizon colour** so the treeline dissolves with no hard seam.
- **Detail is irrelevant past the first row or two** — silhouette + colour is everything.

## 3. Approaches, ranked

| # | Approach | Looks like | Effort | Fit |
|---|---|---|---|---|
| A | **Atmospheric colour-ramp fade on the existing trees** (TSL distance fade to haze, lighten+cool with depth, far melts into horizon) | Calm, deep, painterly; far rows dissolve into mist | **Low** (material only) | ★★★★★ quick win |
| B | **Layered silhouette / colour BANDS** (2–3 flat alpha-cutout strips receding into fog, each cooler/lighter/softer) replacing the far ~280 trees | Classic stylised depth (Gris/Firewatch); kilometres of recession, zero shimmer | Med | ★★★★★ the beautiful move |
| C | **Cross / X alpha-card belt** for the *near* 1–2 rows (2–3 crossed billboards per tree + TSL wind) | Real low-poly forest with volume + sway near the shore | Low–Med | ★★★★ near rows |
| D | Octahedral / SpeedTree impostors | Orbit-correct 3D card | High | ✗ wasted here (near-static head-on view) |

(Backdrop-as-one-baked-card is a valid cheapest option, but a *gradient/SDF band* beats a
baked photo here because it stays in the cold palette and needs no texture bake.)

## 4. Recommendation — **Hybrid: real near band + atmospheric far bands**

Best beauty-per-effort, and it directly kills the shimmer:

1. **Keep only the near 1–2 rows** of the actual stacked-tier spruces (~40–70 trees, the
   ones whose silhouette/snow you *can* resolve). Give them a gentle TSL wind sway like the
   heroes. These read as the believable shoreline forest.
2. **Replace the far ~270 trees** with **2–3 silhouette/colour bands** — flat, wide,
   alpha-cutout or SDF strips at increasing `z`, each **lighter + cooler + lower-contrast +
   softer-edged**, the farthest matched to the sky-horizon colour so it melts in. No
   per-tree geometry → no shimmer, ~3 draws instead of ~9 heavy instanced ones.
3. **Atmospheric colour-ramp fade (A) on everything** — near band + bands fade toward the
   cold haze with distance (lighten, blue-shift). The codebase already has the exact
   pattern: [arctic-fox.js makeFurMaterial](../src/themes/winter/rendering/arctic-fox.js#L16)
   does `mix(col, hazeColor, smoothstep(near,far,dist))` in TSL. Reuse it.
4. **Finishing (optional):** a faint moon rim-light on the band tops + a soft (smoothstep/SDF)
   top edge so the silhouettes feel lit, not stamped.

Net: calmer, deeper, more "painting," no flicker, cheaper.

## 5. Implementation steps (grounded in the real hooks)

**Quick win (ship today) — option A, ~1 effect file change:**
- Switch the treeline materials from `MeshStandardMaterial` to TSL node materials (the
  scene is WebGPU/TSL) **or** add a `colorNode` haze-mix, modelled on
  [arctic-fox.js:16-31](../src/themes/winter/rendering/arctic-fox.js#L16):
  `length(positionWorld - cameraPosition)` → `smoothstep(nearFade, farFade, dist)` →
  `mix(albedo·light, HAZE, t)`, with `HAZE` = the sky-horizon colour (`PAL.skyHorizon`
  region / `0xbcd3e3`-ish), and a small **lighten** term so far = lighter not darker.
- In [TREELINE config:87](../src/playground/effects/winter-wonderland.effect.js#L87): drop
  `rows 6→3`, `count 340→~120`, raise `hMin/hMax` variance down a touch. Instantly less busy.
- This alone removes the shimmer (far tops fade out before sub-pixel) and adds real depth.

**The beautiful move — option B bands:**
- Add `buildTreelineBands()` near [buildSnowMist:460](../src/playground/effects/winter-wonderland.effect.js#L460):
  2–3 wide quads at `z ≈ -2100 / -2500 / -2900`, each a TSL `MeshBasicNodeMaterial` whose
  `opacityNode` is a **silhouette** — either a tiled SDF "treeline" (sin-noise ridge of
  conifer bumps, `smoothstep` for a crisp AA edge) or a thin baked alpha strip from the
  existing spruce. `colorNode` = per-band cool tint → horizon colour; nearer band darker,
  far band ≈ sky. `depthWrite:false`, sorted behind the lake/near band.
- Shrink the instanced belt to the near rows only (step 1).

**Keep (already good):** the mist bands (great between-layer haze), the near framing heroes,
the peaks.

## 6. Quick wins vs the bigger move

- **Today (1–2 hrs):** Option A haze-fade on the belt materials + cut `rows`/`count`. Kills
  shimmer, adds depth, less busy. Highest ROI; low risk.
- **Next (½–1 day):** Option B silhouette/colour bands for the deep background; trim the
  instanced belt to 1–2 near rows + add wind. This is the "best-in-class" result.
- **Skip:** octahedral/SpeedTree impostors (effort wasted on a near-static head-on view).

## Caveats (this scene)
- In-game runs through **WinterPipeline** (exposure 0.82 + ACES + cold tint) → tune in the
  playground but **overshoot brighter/warmer**; the graded render can't be screenshotted.
- Iterate as the one `winter-wonderland` playground effect; verify via chrome-devtools
  (`window.__PLAYGROUND_READY__`, no WebGPU errors) before calling it done.

---
*Sources: Camposanto dev blog; Halis Avakis "Firewatch multi-coloured fog"; NoirBear Firewatch
sky/fog; atmospheric-perspective refs; GPU Gems 3 ch.4 + SpeedTree (impostors); Alpha-Trees /
polycount / 80.lv (alpha cards); Inigo Quilez / gmshaders (SDF). Code hooks from the live
`winter-wonderland.effect.js` + `framing-spruces.js`.*
