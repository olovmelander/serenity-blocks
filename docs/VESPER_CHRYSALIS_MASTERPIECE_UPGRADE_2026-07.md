# Vesper Chrysalis → Masterpiece Upgrade Plan

*Closing the gap with hatom.com. Research-backed, mapped to reusable code.*

Status: **v2 WAVES 1–6 BUILT (2026-07-07)** — verified in the playground (WebGPU, zero errors) + build
green + theme live in-game. Shipped: film split-tone grade + near-black value contrast + **mountain-seam
fix**; **PMREM IBL** + **transmission-glass egg** with a dark cracked-vein core; **living lake**
(bioluminescent flow) + **water-ring combo pulses**; **god-ray shaft** + **PBR env-reflective crystals**;
**GPU ember particles**; **6-tier perf scaling**. Deferred to a later pass: ridge-terrain mountains
(near-black cones retained), crack-spark compute bursts + camera-kick, Cosmos monolith/planets beat,
low-tier fresnel-fallback egg, a `.cube` LUT stage, and a bespoke selector icon.

Original plan below. Prereq: M0–M3 (scene + escalation + post grade + aurora veil).
Research: live-inspected hatom.com (asset manifest + hero captures), external art/tech breakdown, and a
full survey of reusable high-fidelity tech already in our codebase. Author: 2026-07-06.
Companion: [VESPER_CHRYSALIS_THEME_MASTERPLAN_2026-07.md](VESPER_CHRYSALIS_THEME_MASTERPLAN_2026-07.md).

---

## 0. The verdict — why Hatom looks premium (and we don't yet)

I pulled Hatom's actual network manifest. It is **authored Blender assets + baked PBR + tiny env map + film LUTs**,
with the *life* (water, atmosphere, particles, glow, grade) done in shader/post:

- `master-scene-compressed.glb` **8.8 MB** — the *entire* landscape (terrain, mountains, crystals, rocks, lakebed) as ONE Draco-compressed Blender scene.
- `embryo.glb` 75 KB + `eggExplosion.glb` 175 KB — the egg's inner cracked-rock core + shatter fragments.
- `egg/normal_low.png` + `egg/ao.png`, `embryo_albedo.jpg` — **baked** egg maps.
- `water-normal.jpg` + `flowmap.jpg` + `caustics.jpg` — **textured animated** water.
- `env-map.jpg` **18 KB** + `crystal-env-map.jpg` — **IBL** reflections (cheap!).
- `SKY_XP.png` — **cubemap** sky. `voronoi-clouds.png`, `clouds-shadow.jpg` — volumetrics.
- `dust-particle.jpg` — particle sprite. `scene_1/2/3.3DL` + `paint_1..5.3DL` — **3D-LUT color grade, one per phase** (5 KB each).
- `detect-gpu` lib → adaptive quality tiers. Stack: **Nuxt/Vue + vanilla Three.js (WebGL2) + GSAP + Lenis + Howler**.

**The ranked levers that actually create the "expensive" feel** (from the external breakdown — nail these in order):

1. **The filmic grade + one disciplined palette (~60% of it).** ACES/AgX tone map → *selective* high-threshold bloom → **split-tone** (shadows→violet, highlights→warm amber) → vignette → **fine grain** (kills sky banding) → whisper of chromatic aberration. Palette is strictly **analogous violet→magenta** + exactly two complementary pops (**cyan** crystals, **amber** core), **lime `#C1FF12` for UI only**. Never a 4th hue. Measured keys: magenta horizon `#F76CFE`, amber core `#ff8a3c`.
2. **Extreme value contrast.** Mountains/terrain are **near-black silhouettes**; ALL luminance is concentrated in the egg, the horizon band, the crystals, and the water reflection. "One hero light in a dark room" = cinematic, not "WebGL demo."
3. **The hero glass egg** — a *layered* effect, not one material (see §2-B).
4. **The mirror-still bioluminescent lake** doubling the hero.
5. **Aerial perspective + micro-motion everywhere** (layered haze, drifting embers, slow bob, parallax).

**Our core problem:** Vesper is **flat `MeshBasicNodeMaterial` (unlit) on procedural primitives** (icosphere egg, *cone* mountains/shards, plane lake) with **no IBL, no PBR, no real transmission, no textures, no compute particles**, a **hand-coded** grade, and **too-bright, low-contrast** values (our mountains aren't black; our sky washes). We're 80% composition, 20% render fidelity. This plan flips that.

---

## 1. Gap analysis — element by element

| Element | Hatom | Vesper now | Upgrade | Reuse (our code) |
|---|---|---|---|---|
| **Grade** | ACES + selective bloom + **split-tone** + grain + CA + **per-phase 3D LUT** | ACES + threshold bloom + basic split-tone + grain | Refine split-tone, add subtle CA, **crush blacks**, add optional `.cube` **LUT** stage, per-beat grade drift | `stellar-drift-post.js` (CA term-by-term); LUT = new small loader |
| **Value contrast** | near-black silhouettes, light only on hero | mountains/terrain too light, sky washes | Darken peaks→near-black, deepen sky, concentrate luminance | palette pass in effect |
| **Egg** | transmission shell + attenuation tint + crack veins + blue fresnel rim + **separate emissive core** seen *through* glass + bloom halo | flat basic shell + fake core through low opacity + emissive cracks | **`MeshPhysicalNodeMaterial`** transmission/ior/attenuation/iridescence + PMREM env + inner emissive core mesh + fresnel + halo | `fluid-dreams` (iridescence cfg), `lunara-materials.js` `createLunaraCrystalMaterialWebGPU` (transmission+voronoi), `ice-temple` pillars |
| **IBL / reflections** | 18 KB env map (image-based lighting) | none (unlit) | **`PMREMGenerator.fromScene()`** bake a twilight env (no asset) → `scene.environment` | `lunara-theme.js:654-704` (`fromScene`), `lunara-assets.js:123-169` (HDRI path) |
| **Mountains** | authored jagged ridges, layered ranges, hazed | 12 flat `ConeGeometry` | **ridge-terrain heightfield** (ridged-multifractal) + 2–3 fogged parallax layers | `himalayan-peak/rendering/ridge-terrain.js` + `himalayan-noise.js` (`ridged2`,`fbm2`,`domainWarp2`) |
| **Mountain–lake SEAM** *(bug)* | seated in fog, no gap | cone bases exactly on `y=0`, **no scene.fog** → reflector mirrors void behind → visible gap | **sink bases below waterline** + **`scene.fog`** tinted to sky + distance-fade to fog color | `halcyon-apex.effect.js:681-688` (bury base −16) + `:137` (`scene.fog`); `ridge-terrain.js:150-158` (aerial fade) |
| **Terrain / ground** | rich textured displaced rock + **glowing bioluminescent river** of light | flat plane (the lake only) | add a displaced shore/riverbed with **emissive bioluminescent veins** flowing magenta | ridge-terrain + emissive flow noise |
| **Lake** | planar reflection + **normal-map ripple** + **flow-mapped bioluminescent** noise + caustics | `reflector()` + sine ripple + sparse sparkle | add flow-noise bioluminescence + normal ripple + fresnel depth + **caustics** | `reflector()` (have); `halcyon` water rings; caustics tex optional |
| **Crystals** | **faked** fresnel-emissive + matcap (cheap), env-reflective | flat cones | fresnel-emissive `MeshStandardNodeMaterial` + env map (NOT real transmission) | `lunara` crystal, `ice-temple` shards |
| **Particles** | GPU sprites: dust/embers/fireflies, bloom-fed | none | **GPU-compute embers/motes** rising off relic + fireflies | `ice-temple-compute.js` `IceTempleSnowCompute` + `PointsNodeMaterial` |
| **Atmosphere** | height fog, aerial perspective, god-rays, haze | none | height fog + god-ray shaft from relic + depth haze | `pyrestorm-v2/rendering/god-rays.js`; fog |
| **Sky** | indigo→violet→**magenta band**→low amber radial glow, grain | gradient + stars + band | add low **amber radial "afterglow"** behind peaks + grain (anti-band) | current sky + tweaks |
| **Combo/lock FX** | n/a (it's a website) — but WE need them | inline director drives S only | **water-ring pulses**, **crack-spark bursts**, relic flare, camera kick | `halcyon` uRing pool + `ice-temple` `spawnBurst` + `winter/storm-director.js` |

---

## 2. The upgrade — element deep-dives

### 2-A. THE GRADE + PALETTE + CONTRAST (do this FIRST — highest ROI, cheapest)
The external breakdown is emphatic: **get the grade right on a grey box before touching models.** Concretely, in the existing post pass (`vesper-chrysalis.effect.js`):
- **Crush blacks + lift contrast**: our shadows are muddy violet, not near-black. Add a black-point lift-then-crush + a filmic shoulder.
- **Split-tone**: shadows → deep violet `#1a0e2e`-ish, highlights → warm amber. We have a basic version; tune it hard toward the Hatom key (`#F76CFE` mid, `#ff8a3c` warm).
- **Selective bloom**: keep threshold high (only egg core/cracks/crystals/band/particles bloom) — already threshold-based; verify mountains/terrain don't bloom.
- **Fine grain** (already present) + **subtle chromatic aberration** (copy the term-by-term CA from `stellar-drift-post.js:88-104`, dialed very low, edges only).
- **Optional 3D-LUT stage**: load a `.cube` LUT (author one in DaVinci/Photoshop or grab a free filmic teal-orange→violet LUT) and apply as the final grade tap — this is how Hatom gets its cohesion for 5 KB. New tiny loader; sample a 3D texture in the output node.
- **Palette discipline pass**: darken mountains toward near-black, deepen the sky, ensure no 4th hue. This *value-contrast* change alone will read as a big jump.

### 2-B. THE HERO EGG (spend the budget here — ONE object)
Rebuild the relic shell as a **layered** jewel (external breakdown §2-A):
1. **PMREM env first** (§2-D) so the glass has something to refract/reflect.
2. **Shell** → `MeshPhysicalNodeMaterial`: `transmission` (grows 0.4→0.95 with `uS`? or fixed ~0.9), `ior≈1.45`, `thickness`, `attenuationColor` violet-blue + `attenuationDistance`, `roughness≈0.08`, `iridescence≈0.6`+`iridescenceIOR≈1.3` (oil-sheen), `clearcoat` for wet highlight. Reference config: `fluid-dreams-theme.js:580-593` + `lunara-materials.js:1044-1117`.
3. **Crack veins**: keep our procedural FBM iso-line cracks, but route them into `roughnessNode`/`emissiveNode` so light leaks through when the core brightens.
4. **Blue fresnel rim** (the #1 "premium glass" cue) into emissive.
5. **Separate inner core mesh** (organic blob / low icosphere) with emissive amber + molten FBM, seen *refracted through* the shell — pulsing with `uS`.
6. **Bloom halo** from the core (already have) + a soft additive backlight sprite.
Perf: transmission re-renders the scene to a buffer — **fine for one hero egg**; never on crystals.

### 2-C. THE LAKE (doubling the hero = huge cheap win — mostly there)
Keep the `reflector()`. Add: (a) **bioluminescent flow noise** — animated magenta/violet emissive blotches in the water color node (flow-map style); (b) **normal-map ripple** distorting the reflection UV (subtle dudv, not choppy); (c) **fresnel depth** (cleaner mirror at grazing/far, darker near); (d) optional **caustics** texture; (e) **combo ripple rings** (§2-F). The mirror already grounds the scene — this makes it *alive*.

### 2-D. IBL — PMREM env from a procedural scene (no asset download)
`new PMREMGenerator(renderer).fromScene(twilightEnvScene, 0.04)` → `scene.environment`. Build a tiny BackSide gradient dome (our exact sky palette) + one warm emissive "relic" sphere so crystals/egg reflect the ember. Reference: `lunara-theme.js:654-704`. This unlocks PBR reflections everywhere for ~0 cost. (If we later author an HDRI via the Blender pipeline, swap in `fromEquirectangular` — `lunara-assets.js:123-169`.)

### 2-E. MOUNTAINS + ATMOSPHERE + THE SEAM FIX
- **Replace the 12 cones** with one **ridge-terrain heightfield** (`himalayan-peak/rendering/ridge-terrain.js` + `himalayan-noise.js` `ridged2`/`domainWarp2`) fed a twilight `uFogColor`/`uSkyHorizon`; add 2–3 **parallax silhouette layers** each fogged more (Firewatch depth stack).
- **SEAM FIX (root cause identified):** our cones sit at `y = h*0.5` (base on `y=0`) with **no `scene.fog`**, so the reflector mirrors the void/sky behind the sharp cone bases. Fix = **sink geometry a few units below the waterline** (`halcyon:681-688` buries base −16) **+ add `scene.fog`** tinted to the sky-horizon color **+ distance-fade** color to fog (`ridge-terrain:150-158`). This removes the gap *and* adds premium depth.
- **God-ray shaft** rising from the relic (`pyrestorm-v2/rendering/god-rays.js`, additive inverted cone, `uIntensity` = `uS`).
- **Height fog / depth haze** tinted to the horizon magenta.

### 2-F. LOCK-PIECE & COMBO EFFECTS (WebGPU particles are key)
We already forward gameplay events to `runtime.pulse(kind,payload)`. Wire real effects:
1. **Water-ring pulses** (highest ROI — our scene ≈ halcyon's): copy the `uRing` `vec4` pool + `ringHeight`/`ringGlow` into the lake material; `spawnRing(x,z,amp)` from `applyPulse('lineClear')`. Expanding light-rings on the mirror at every clear, reflected for free. Ref: `halcyon-apex.effect.js:104-125, 840-901, 1793-1818, 1926-2003`.
2. **Crack-spall spark bursts** (GPU compute): `IceTempleShardBurstCompute.spawnBurst(count, x, z, {style:'crack-front'})` fired along the egg fracture on `lineClear`/`tspin`. Ref: `ice-temple-compute.js:196-510`.
3. **Continuous ember/mote field** (GPU compute): `IceTempleSnowCompute` recolored amber→cyan, additive `PointsNodeMaterial`, rising off the relic; density scales with `uS`. Ref: `ice-temple-compute.js:20-194`, `ice-temple-materials.js:206-296`.
4. **Relic flare + camera kick/trauma** on Tetris/perfect-clear: swap the inline director for `winter/composition/storm-director.js` (eased intensity + `gust/flare/kick/trauma` channels, `onLineClear`/`onCombo`/`onTSpin`/`onPerfectClear`) — cleaner, testable, adds camera trauma.
5. **Piece-lock**: a small ripple + ember puff at the relic; **level-up**: sky-deepen step + arm Cosmos.
6. **Ascension/Cosmos beats**: aurora curtains (`winter/rendering/aurora-volume.js`) + monolith/planets reveal at high `uS`.

### 2-G. CRYSTALS + SECONDARY
Faceted crystals → `MeshStandardNodeMaterial` + **fresnel emissive** (cyan) + env map (from §2-D), **NOT** real transmission (budget discipline). Vary sizes/clusters. Optional matcap for cheap chrome facets.

---

## 3. Asset strategy — a fork to decide

Hatom's landscape is one **8.8 MB authored GLB**. Two paths (not mutually exclusive):

- **Path A — Procedural-PBR-first (recommended to start):** ridge-terrain + PBR crystals + PMREM env + baked-look normal via noise + LUT grade. **Zero downloads**, fully tier-scalable, matches ~85% of the look, ships fast, no Electron asset-path risk. This is where the grade/contrast/egg/lake/atmosphere wins live — and those are 90% of "premium."
- **Path B — Author hero GLBs via the Blender pipeline (later polish):** use the Blender MCP + PolyHaven + TRELLIS + KTX2 (`ktx` now on PATH) to author (i) a **relic/geode GLB** with baked normal/AO, and optionally (ii) a **landscape GLB**. Load via `winter-trees.js` `?url`+DRACO or the odyssey `odyssey-gltf-loader.js` (KTX2+Meshopt+cache). Bundle in `assets/`, tier-gate LOD. Bigger effort + download; reserve for the hero relic + maybe crystals.

**Cheap wins to take regardless:** the **`.cube` LUT** grade stage (5 KB, huge cohesion) and the **PMREM env** (0 KB, unlocks all reflections).

---

## 4. Prioritized roadmap (waves — each independently shippable & screenshot-verified)

Ordered by *visual-impact ÷ effort*, front-loading the grade/contrast/seam wins the research says matter most.

- **Wave 1 — Grade, palette, contrast, SEAM (½–1 session, massive ROI):** crush blacks + tune split-tone + subtle CA + verify grain; darken mountains to near-black + deepen sky; **sink mountain bases + add `scene.fog`** (seam fix) + distance-fade. *No new systems — this alone reads as a big jump.*
- **Wave 2 — IBL + hero egg:** PMREM `fromScene` env → rebuild egg as `MeshPhysicalNodeMaterial` transmission/iridescence + inner emissive core + fresnel + halo. *The single biggest fidelity jump.*
- **Wave 3 — Lake alive + water-ring combos:** bioluminescent flow noise + normal ripple + fresnel depth; wire `spawnRing()` to `pulse()`. *Doubling hero + first real combo FX.*
- **Wave 4 — Atmosphere + terrain:** ridge-terrain replacing cones + parallax fogged ranges + god-ray shaft + height haze. *Depth & realism.*
- **Wave 5 — GPU particles:** compute ember/mote field (continuous) + crack-spall bursts on line-clear + storm-director (camera kick/trauma). *Life & juice.*
- **Wave 6 — Crystals PBR + Cosmos beat + polish:** fresnel-emissive crystals w/ env; aurora curtains + monolith/planets at high `uS`; **6-tier perf scaling + WebGL fallback**; bespoke icon; optional authored relic GLB (Path B).

Each wave: playground-first, screenshot-verified (chrome-devtools MCP), `?inspector=1` for real per-pass GPU cost, one effect/session (TDR), then port + in-game check.

---

## 5. Performance budget & tiering (bake in from Wave 1)
New costs: transmission (1 hero egg only), PMREM (one-time bake), compute particles, extra reflector work, ridge-terrain fill. Levers for the 6 tiers (`window.settings.graphicsQuality`): reflector `resolutionScale`, bloom downsample, particle counts (`setActiveCount`), ridge-terrain segments, transmission→fake-fresnel fallback on low tiers, aurora/god-ray steps, crystal count, CA/grain toggles. **WebGL fallback**: no compute (CPU particles), no transmission (fresnel-emissive egg), fake reflection. Target ≥120 fps Extreme/RTX; playable on the AMD 610M. Use `renderer.info` (fill-vs-draw) + `?inspector=1` to verify per-pass — recall the mx_noise fill trap that cost 2 fps.

---

## 6. Open decisions (I'll default unless you steer)
1. **Asset path:** default **Path A (procedural-PBR-first)** now; Path B (author relic GLB via Blender) as Wave-6 polish. *(Or go straight to authoring a landscape GLB if you want max fidelity fastest — bigger lift.)*
2. **LUT:** default add a `.cube` LUT grade stage in Wave 1 (author/grab a filmic violet-teal LUT). 
3. **Egg transmission on low tiers:** default fall back to fresnel-emissive (no transmission) below High.
4. **Start now with Wave 1?** It's the highest-ROI, lowest-risk jump and needs no new assets.

---

## 7. One-paragraph brief for whoever implements
Vesper reads "WebGL demo" not "cinema" because it's flat-unlit primitives with a hand-coded grade and washed values, while Hatom is authored-PBR-in-a-disciplined-filmic-grade with near-black silhouettes and one hero jewel. Fix it in this order: **(1) the grade + value contrast + palette discipline + the mountain-seam fog fix** (cheap, huge), **(2) IBL + a real transmission-glass egg with a separate glowing core**, **(3) a living bioluminescent mirror-lake with combo ripple-rings**, **(4) atmospheric ridge-terrain replacing the cones**, **(5) GPU-compute embers + crack-spark bursts + camera juice**, **(6) PBR crystals, the Cosmos beat, perf tiers, and an authored hero GLB.** Every piece maps to proven code already in this repo.
