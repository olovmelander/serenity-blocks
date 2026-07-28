# Odyssey Ch3 "Surface World" — masterpiece rebuild plan (2026-07-28)

> Goal: rebuild ch3 to be **(a) far cheaper to compile** (it's the journey's compile monster —
> ~25 distinct materials → ~30–50 pipelines → ~seconds of cold compile that starves the
> background warm of ch4–8, per findings §7) **and (b) more visually stunning**, while bridging
> ch2 Deep-Ocean → ch4 Mountain-Peaks. Playground-first, screenshot-verified, one hero at a time.

## Why it's the compile monster (measured)

Instrumented cold compile was the heaviest of all chapters (findings §7). Root cause is the
**material COUNT**, not noise: ~25 distinct `*NodeMaterial` builders, each ≥1 pipeline × the post
output variants, plus Quaternius **GLB** models carrying their own materials + a big upload. The
current builder list: sky, ocean, golden-lake, landscape, foothill-bridge, grass×2, flowers×2,
trees, spruce, great-tree, tree-line, reeds, falling-leaves, waterfall×2, pollen, snow-motes,
butterflies, birds, sun-disc, sun-rays, clouds, distant-mountain(s), mist, cabin, pass-by.

## Performance strategy — CONSOLIDATE to ~8 shared/instanced materials (the compile fix)

The AAA rule: a chapter should have a *handful* of materials, heavily instanced with per-instance
variation — not 25. Consolidation map (~25 → ~8 pipelines, ~3–4× cheaper compile + far less upload):

| New material (1 pipeline each) | Replaces | Per-instance variation |
|---|---|---|
| **Sky+cloud dome** | sky, clouds | cloud noise in the fragment (no separate cloud meshes) |
| **Hero sun + god-rays** | sun-disc, sun-rays | keep as the 1 authored hero (rays in-shader on a cone/quad) |
| **Golden water** | ocean, golden-lake | ONE reflective golden-hour water (`reflector()` treeline mirror — see [[swedish-forest-golden-water]]) |
| **Terrain** | landscape, foothill-bridge | one procedural-height golden-hour ground (grass/rock/sand blend by height/slope) |
| **Foliage (instanced)** | grass×2, flowers×2, reeds, falling-leaves | `instanceColor` + `aType`/`aPhase` attrs → per-instance species/tint/scale/sway |
| **Trees (instanced)** | trees, spruce, great-tree, tree-line | `aSpecies`/`aScale`/`aTint` → deciduous/spruce/hero from ONE material |
| **Life (instanced/points)** | pollen, snow-motes, butterflies, birds | one points/instanced material, per-instance behavior via attrs |
| **Distant mountains + mist** | distant-mountain(s), mist | one horizon material (keep — cheap, matches ch4) |

Also: **drop the Quaternius GLBs** (replaced by the instanced trees/foliage → removes GLB
materials + upload) and **retire the cabin/pass-by/waterfall** unless they earn their pipeline.
Net: ~8 materials, all instanced → the cold compile drops from the monster to a handful, and the
first-visit UPLOAD shrinks (fewer/instanced buffers). Keep the `uSeason` scalar — it drives all of
them through ONE set of uniforms (no per-season material variants).

## Art direction — "The Emergence" (stunning + journey-fit)

The camera breaches up out of Deep-Ocean's cold blue into a radiant **golden-hour lush surface**,
crosses a mirror lake and a living meadow, and climbs toward the alpine peaks of ch4.

- **Palette bridge** (via `uSeason` 0→1): breach teal (ties to ch2) → warm spring golden-green
  meadow → cool alpine blue-green at the ch4 hand-off. Light-driven, no hard curtains.
- **Hero elements (the "stunning"):**
  1. **Golden mirror-lake** — the memory's golden-water: analytic sun-glint + a real `reflector()`
     mirroring the treeline + sun (RTX-cheap). The centerpiece.
  2. **Majestic hero great-tree** — one landmark tree, PBR-lit (upgrade from Lambert), catching
     the golden rim light.
  3. **Volumetric god-rays** through the low golden sun (the one authored hero light).
  4. **Layered depth** — foreground meadow flowers (instanced) → midground forest (instanced) →
     distant golden peaks + haze. Rule-of-thirds framing; deliberate negative space (BotW discipline).
  5. **Living particles** — pollen drift + butterflies in the warm zone, easing to drifting snow at
     the alpine hand-off (the `uSeason` story), all from ONE instanced/points material.
- **Grade + light:** a cohesive golden-hour master grade (warm key + cool sky fill), soft AO on the
  terrain, atmospheric haze for depth. PBR trees.

## Build sequence (playground-first, one hero per pass, screenshot-verified)

1. **Foundation:** sky+cloud dome + terrain + golden water + master grade — the base composition &
   palette. Screenshot A/B vs the current look.
2. **Instanced foliage** material (the consolidation proof; verify per-instance variation reads as
   varied, not stamped).
3. **Instanced trees** + hero great-tree (PBR) + god-rays.
4. **Life** (instanced particles, `uSeason`-driven).
5. **Port** into surface-world.js / surface-world.tsl.js behind a flag; **compile A/B** (expect the
   monster → a handful) + **in-scene screenshot A/B** for look; verify ch2→ch3→ch4 transitions.

Effect harness: `src/playground/effects/surface-world-emergence.effect.js` (drop-in).
Do NOT claim done without a screenshot; keep to one hero per session (TDR).
