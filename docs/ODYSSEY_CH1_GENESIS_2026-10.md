# Odyssey — Chapter 1: Genesis (2026-10)

**Status: LANDED on `feature/odyssey-ch1-genesis`.** The owner's brief: improve Earth Core's
visuals and atmosphere "in the best way you can think of" — "this amazing start of Odyssey mode".
Builds on the [Act I rebirth plan](ODYSSEY_ACT_I_REBIRTH_PLAN_2026-08.md)'s light language (ONE warm
key below — the lava — and darkness-gated response; Ghibli softness) and on the masterpiece and
seamless passes (the First Heart on the rail, basalt bundles, fissure fields, the lit steam shaft).

## 0. What the opening looked like (captured, main `bbdf5390`)

- The lava lake: a flat saturated red sheet with soft dark blotches — a texture, not a lake. Its
  fine structure disappeared at the grazing opening angle, and the entry basin is mostly molten
  by design, so up close it was uniform.
- The cavern: the vault was black with ember squiggles right down to the lake's far edge — a
  night sky, a ruler-straight horizon, and a black band (the vault BELOW lake level, visible
  beyond the lake's 180 u rim). Nothing showed that the lava is the light of the place.
- The climb: the vault's veins read as flat orange stickers; a 74° teal BOW-TIE fanned out of
  the frame centre on every climbing frame (the "crack at the crown" selected every azimuth
  within ~37° of one axis); sparks were round dots.
- The steam: beige-grey mud between the fire and the water.

## 1. What changed

| Change | Where | What the player sees |
|---|---|---|
| **The lake lights the cavern** | `createVolcanoBackgroundTSL` | the walls glow with the lake's light just above and just below lake level (the black band becomes the glowing far shore), fading with height and breathing with the lake's surge; a faint long tail warms the upper vault the climb looks into. The darkness-gated veins recede where it glows. |
| **The lake mirrors the lit walls** | `createLavaFloorTSL` | grazing sheen in the walls' warm glow (was blue-black obsidian); the far lake hazes into lake-lit air (was near-black smoke) — floor, air and wall read as one chamber |
| **Crust plates on the melt** (High) | `createLavaFloorTSL` + `lavaPlateField` | irregular dark floes jostling on the melt, seams from hairline cracks to wide molten gaps glowing orange with yellow-white cores, open molten rivers where it runs hottest; faded out before grazing range (no aliasing); seams quench silver → teal with the veins |
| **Glowing cracks** | vault veins | a thin hot yellow-orange core in a soft red halo (the same ridged field), not flat orange blobs |
| **The crack at the crown** | vault | a narrow, jagged, rock-bridged fissure round the zenith — the First Heart sits in it — faint early, widening with the ascent |
| **Sparks with speed** | `createRisingEmbers` | each spark stretched along its velocity projected off the view axis (risers up, splash sparks on their arc), up to 3.2× side-on; gold, not white (stretched white-hot sparks read as snow) |
| **Golden steam** | `odyssey-steam-quench.js` | the warm half is amber/gold (shadows 0.34/0.17/0.08, gold STEAM_WARM, less whitening while warm); the pearly flash still peaks at the crossover |

## 2. Verification

- Chapter captures (WebGPU, High, settle 3500) at every step; no console errors.
- Seam 1→2 luma gate: PASS, maxStep 43.1 (the steam ramp's own step; 42.6 before this pass). The
  climb sits at luma 17–22 (thinner veins alone had dropped it to ~14 and pushed the step to 44.6 —
  the long glow tail fixed that).
- Earth Core tests, the TSL build test and the steam/cloud-bank tests pass.

## 3. Performance

Lane A (RTX 3070, High 1080p, GPU p50 ms; `baseline / baseline-repeat`), the Genesis branch vs
main `bbdf5390`, alternating per station:

| Station (p) | Main | Genesis | Draws |
|---|---|---|---|
| 0.003 — the opening (the lake) | 0.85 / 0.85 | 0.92 / 0.92 | 56 → 56 |
| 0.02 — the climb | 1.11 / 1.05 | 1.18 / 1.05 | 56 → 56 |
| 0.051 — the steam | 1.11 / 1.11 | 1.18 / 1.18 | 70 → 70 |

About one timer tick (~0.066 ms, 6–8 %) at each station, no new draws or materials. The crust
plates (18 hashes per lake fragment) are High-only — Medium/Low (Lane B) compile the old lake
graph; the vault's crack/glow terms (3 baked-noise lookups, 2 exp) are on every tier.
JSONs: `repos/odyssey-gpu/perf-baseline/ch1g-1/`.

## 4. Open items

- The First Heart is still a radial sprite; the Act I plan's Calcifer grammar (a teardrop flame
  with pose-based breathing) would give the destination personality.
- The floating molten geodes are low-poly "potatoes"; the basalt-bundle treatment could extend to them.
- The steam is warm tan rather than truly luminous gold; its exposure cap keeps it dim by design
  (the seam gate) — a richer look would trade brightness for saturation further.
