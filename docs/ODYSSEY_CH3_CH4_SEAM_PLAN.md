# Odyssey Ch3 → Ch4 Seamless Transition Plan

_2026-06-15. Goal: make Surface World (Ch3, warm golden meadow) and Mountains (Ch4,
cool snowy peaks) feel like **one continuous world with a different mood** — the assets
carry across the seam, only the mood diverges. Grounded in a 3-agent map of both
chapters + the seam machinery._

## What is ALREADY seamless (don't touch)
- **The mountains are the same object.** Ch3 renders Ch4's exact canonical hero chain
  (`canonical-mountain-range.js`) — same size/seed/world-coords — at `coolTemp 0.72`
  (hazy) vs Ch4's `1.0` (saturated). The silhouette is locked → **no swap, no jump.**
- **One shared mountain language** (`mountain-language.js`: palette + displacement +
  `mountainColorNode`) drives every peak, foothill, and Ch3's foothill bridge.
- **The mood bridge works** — `SEAM_34_ALPINE_BRIDGE` crossfades sky/fog/ambient. With
  Ch3 fog now warm gold (`0xb8a47e`), the arc reads **warm meadow → alpine bridge → cool snow**.

## The ONE real break
Ch3 is saturated with vegetation (flowers, trees, spruces, reeds, GLB props). **Ch4 has
ZERO ground vegetation** — pure snow + rock + cultural props. So at the seam all flora
vanishes at once. That disjoint asset vocabulary is what makes it feel like two chapters.

## The design: an altitude-driven ecotone (tree line)
Model the transition the way a real alpine ascent looks — the same vocabulary persists
and transforms with altitude:

```
Ch3 meadow ─► foothills ─► TREE LINE ─► bare snow ─► Ch4 peaks
 flowers +     snow-dusted   conifers      rock +      (shared hero
 deciduous     conifers      thin out      snow caps    chain already
 (warm gold)   climb         (the bridge)  (cool)       continuous)
```

## Assets (provided): winter conifer GLBs
`src/themes/winter/assets/{fir,pine,spruce}_lod.glb` — single-mesh, **vertex-coloured
snow conifers** (fir 23% / pine 10% / spruce 4% baked snow), normals, no textures, ~1.6u
tall Y-up, 180–570 KB (instanceable). Same vertex-colour load path as the Ch3 birds. Three
species = natural variety; fir snowiest (high/cold), spruce lightest (lower belt).

## Implementation (batches, each capture-verifiable)

### Batch 1 — Shared conifer asset module
Copy the 3 `_lod` GLBs to `src/rendering/odyssey/assets/shared/conifers/` and add
`shared/odyssey-conifer-assets.js` (mirrors `chapter-03-bird-assets.js`): records with
id/url/runtimeScale, vertex-colour + snowiness metadata. (Untracked like other Odyssey
assets — `git add` to ship.)

### Batch 2 — Snow-conifer belt instancer (shared builder)
`createSnowConiferBeltTSL(uTime, { count, zone, uSnowBlend })` in a shared module:
- Loads fir/pine/spruce, keeps **vertex colours** on a **lit `MeshLambertNodeMaterial`**
  (form from the chapter key + hemi fill, like the lit procedural trees + the birds).
- Instances across a foothill zone, anchored to terrain, **density thinning with altitude**
  toward a tree line; species mix shifts spruce→fir as it climbs (snowier up high).
- `uSnowBlend` lifts an extra white cap so they whiten further as winter/altitude rises.

### Batch 3 — Plant the seam (the bridge surface)
- **Ch3 side:** scatter the belt on the upper meadow + foothill bridge zone (`getTerrainHeight`),
  thinning toward the seam — the visible tree line as you climb out of the meadow.
- **Ch4 side:** seed the belt sparsely on Ch4's lower slopes / foothill apron so Ch4 isn't
  bare the instant you arrive — the vocabulary continues, snowier + sparser.

### Batch 4 — Snow-adapt the existing Ch3 trees
Feed `uSnowBlend` into `createTreesTSL` / `createSpruceTreesTSL` colorNodes so the *existing*
procedural trees grow white caps + desaturate toward the seam — the deciduous → conifer →
snow gradient reads as one continuous belt, not a hard line.

## Verification
Playground harness (`?effect=ch3-surface-world`, add a seam/Ch4 preview) for the belt look
+ snow adaptation; then a real Ch3→Ch4 journey capture for the in-motion seam. Keep the
mountains + mood bridge untouched (already correct).
