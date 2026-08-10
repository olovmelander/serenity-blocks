# Odyssey Ch3→Ch4→Ch5 — "One Bright Painterly Ascent" Plan (2026-08)

*Synthesized from a 5-agent research+review workflow (external technique mining + per-chapter
current-state audits + a cohesion/seam analysis). Governs the repalette of Surface World, Mountain
Peaks and Sky & Drift into a single continuous bright-daylight Ghibli/Genshin/Europa ascent.*

Reference targets: the user's three images (a vivid blue-sky meadow-lake-snowpeak with big cumulus and
flower carpets; a Ghibli floating-meadow lake; a Ghibli sea-and-clouds), the **Europa** game's airy
ascent, and a procedural "painterly world" (Reddit/CodePen refs were fetch-blocked; technique recovered
from equivalent WebGPU/TSL cloud, atmospheric-sky, BOTW-grass, Ghibli-UE4 and stylized-water sources).

> **Reference-driven iteration:** drop the hero image (image 1) into `public/playground-refs/ch3-hero.png`
> and iterate the sky/cloud/water effects against it (`?ref=/playground-refs/ch3-hero.png&refMode=split`)
> before porting, per CLAUDE.md. (I can't write the attached image to disk from here.)

---

## 1. The vision — meadow → peaks → above the clouds, as ONE world

The three chapters already map onto a single climb; we make the *light* continuous so they read as one:

- **Ch3 Surface World** — the meadow shore (≈ image 1): vivid blue sky + big billowing cumulus, a lush
  saturated grass-and-flower meadow, a clean turquoise **reflective** lake mirroring those clouds, the
  snow peak already visible ahead through airy haze.
- **Ch4 Mountain Peaks** — the snow climb: you ascend *toward that same peak* under the *same* blue sky
  and cumulus. Bright, airy alpine — **not** a cold moonlit winter. The summit crests into *more* light.
- **Ch5 Sky & Drift** — the payoff: you break through the cumulus tops into a sunlit sky, drifting over
  the same cloud-sea that capped Ch4's peak. Bright azure, luminous — the top of the ascent (Europa).

**The unifying rule:** one shared bright-daylight palette + one continuous sky/cloud layer + one sun +
one grade, carried across all three. Seams become *elevation changes in one afternoon*, not biome swaps.

---

## 2. Diagnosis — it's the endpoints, not the seams

The crossfade (`ChapterEnvironmentManager.updateGlobalEnvironment` L1378-1409; `OdysseyDirector`
L216-235) already lerps fog colour+density, sky, ambient and exposure across every boundary, and two
wide colour bridges exist (SEAM_34 alpine, SEAM_56 aurora). The chapters still feel disconnected because
of **five endpoint faults**:

1. **Three times of day.** Ch3 golden-hour, Ch4 cool moonlit dusk/night, Ch5 twilight-with-aurora. Every
   smooth lerp travels between incompatible moods.
2. **Fog rotates gold→blue-grey→indigo** (`0xb8a47e`→`0x7d93ad`→`0x303656`, ~173° at 3→4) and **spikes
   3.1×** denser into Ch4 (`0.0016`→`0.005`→`0.0035`). Fog is the #1 "time of day" cue the eye reads.
3. **Two dueling sun systems that both teleport.** The shading-rig `lightDir` (elevation 51°→17°→52°,
   ducks to the horizon in Ch4) and the in-shader sun-disc consts (visible azimuth 209°→60°→159°)
   disagree with each other *inside* every chapter and jump *between* chapters. `lightColor` flips
   warm→moon-blue→cool.
4. **Ambient fill collapses ~9×** ((148,144,134)→(16,19,27)); Ch5, the *highest* chapter, is lit like
   night instead of the brightest.
5. **Grade reinforces the split** (Ch3 warm `[1.04,1.01,0.92]`, Ch4 cool `[1.02,1.00,1.06]`, Ch5 violet
   `[1.05,0.96,1.07]` @contrast 0.98), and there is **no SEAM_45 bridge** for the harshest day→twilight
   cliff.

---

## 3. The shared daylight anchor (the single source of truth)

Introduce ONE bright-midday anchor all three chapters inherit; per-chapter overrides vary only
altitude-driven **brightness/clarity**, never hue/mood.

| Token | Hex | Use |
|---|---|---|
| Sky zenith | `#2E74C9` (~`0x2a6fd8`) | dome top, all 3 |
| Sky horizon | `#A9D6F0` (~`0xbfe4f2`) | dome horizon, all 3 |
| **Aerial haze / fog** | `#BFD9EC` (~`0xbcd8ec`) | **shared** Ch3 lake-distance / Ch4 peak-base / Ch5 cloud-sea horizon |
| Cloud lit top | `#FDFEFF` | cumulus tops |
| Cloud shadow underside | `#B4C6DC` | cumulus undersides |
| Grass near | `#4E9E32` | foreground meadow |
| Grass far | `#8FC07C` | mid-distance meadow |
| Flowers | `#F6D341` yellow · `#FBFBF2` white · `#A98BD0` lavender · `#F3A6C4` pink | scatter + carpets |
| Water shallow | `#4FC6C4` turquoise | lake near |
| Water deep | `#1E6FA8` blue | lake far |
| Snow lit / shadow | `#FDFEFF` / `#C6D4E6` (cool-blue, not grey/black) | peaks |
| Rock | `#7E8794` | peaks |
| **Sun** | warm-white `#FFF4E0` | one key, all 3 |
| **Sun vector** | ≈ `(0.35, 0.62, -0.70)` (high-front) | one vector, rig + every disc const |
| Fog density | `0.0016 / 0.0022 / 0.0016` | monotonic-low; Ch4 only marginally hazier |
| Ambient | `#EAF2FF` @ ~0.58, equalized | Ch5 = brightest |
| Exposure | ~`1.0–1.02`, equalized | one film stock |
| Grade tint | near-neutral (tiny per-chapter deltas), sat ~1.10-1.12, contrast ≥1.0 | one stock |

Implementation: add `ODYSSEY_DAYLIGHT_ANCHOR` (+ a shared `ODYSSEY_SUN`) exports in
`shared/chapter-profile.js`; Ch3/4/5 profiles spread from it. Continuity becomes guaranteed *by
construction* rather than hand-matched hexes.

---

## 4. Per-chapter transformation (exact levers)

### Ch3 Surface World — golden-hour → bright meadow (the hero)
- **Sky** `surface-world.tsl.js createSkyBackgroundTSL` (~L439-483): `uHorizon 0xf0b878`→light cyan
  `0xbfe4f2`; `uHaze`→pale cyan-white; drop/neutralize the sunset-**peach** band (L476-477); raise
  `uZenith` value toward brighter azure `0x2a6fd8`; de-gold the sun core/glow toward near-white.
- **Clouds** `createCloudsTSL` (~L2410-2500): alpha `density*0.10`→~`0.7`; whiten top→~`(0.98,0.99,1.0)`,
  cool base→`(0.62,0.70,0.82)`; replace the flat ellipse (ex 1.7/ey 2.6) with rounder billowing masks +
  a puffier density smoothstep; enlarge + add a thin high-cirrus layer. Keep the InstancedMesh draw-share.
- **Flowers/grass** `surface-world.js L1000`: `createWildflowers(uniforms, 0)`→`~1200` (species palette
  already matches: daisy/buttercup/poppy/lupine/cornflower). Re-enable `createFluffyGrass` (L969-970);
  widen `SURFACE_FLOWER_PATCHES` (surface-world.tsl.js L145-148) for mid-distance carpets.
- **Water** `shared/odyssey-water-surface.tsl.js buildOdysseyWaterSurface` (L149-190) — **Ch3-branched**
  so the Ch2 breach underside is untouched: `bodyCol`→turquoise, `skyRefl` warm-gold→cool sky-blue/white
  (mirror the new blue sky + cumulus), whiten sun-glitter. Consider `ch3HeroMirror` ON (surface-world.js
  L873) for a real reflector() cloud mirror.
- **Terrain green** `createLandscapeTSL` (L772-828): brighter `grassColorLow`; dial back `warmKey`
  darkening (L804) + long-shadow banding (L819); warm distance-fog mix (L828)→cool bright haze.
- **Grade/fog** `chapter-profile.js` Ch3: `fogColor 0xb8a47e`→light blue-white `0xbcd8ec`, `exposure
  0.98`→~`1.05`, key `0xfff1d0`→neutral-cool white. `odyssey-tsl-pipeline.js` Ch3 sig (L131): tint
  `[1.04,1.01,0.92]`→cool/neutral, vignette `0.75`→~`0.55`, keep sat `1.12`.
- **MUST STAY:** the one continuous lake (enlarged sea, river/lake hidden) and the no-hard-edge dissolves
  (landscape farMelt on positionLocal, foothill-bridge FBM ramp) — both fixed recently; do not reintroduce
  square water rims or hard green-card edges.

### Ch4 Mountain Peaks — moonlit dusk → bright airy climb
- **Sky** `mountain-peaks.tsl.js createMountainSkyTSL` (L167-198): zenith `0x132247`→`0x1a5fc0`, alpine
  →azure `0x2f86d8`, silver→light cyan `0xbcd8ee`, gilt→`0xd9e6ea`; cut the aerosol subtract (L197)
  `0.12`→~`0.02` so the top stays blue, not space-dark.
- **Lighting** `mountain-peaks.js` L366-377: recolour ambient `0x2b3a52@0.3`→bright neutral
  `0xbfd4e8@~0.6`; repurpose the "moon" `0xcfe6ff@0.72` key → warm-white **sun** `0xfff1d0` on the shared
  vector; keep the warm alpenFill. Drop the "deep blue shadowed faces" intent.
- **Drop the mid-ascent night** `mountain-peaks.js` L123-124: push `MOUNTAIN_TRANSITION_END` past 1.0
  (off) or lerp the night targets to a mild warm golden-hour dip (never near-black). Keep the
  `uSummitGlow` ignite (L912-916) as a **bright** climax. Re-examine the aurora preview (L961).
- **Hero cumulus** port Ch3's cumulus (surface-world.tsl.js ~L2458-2500) into
  `createMountainPeaksEnvironment` as a sky band 15-40% up; keep the existing cloud-sea deck as the lower
  layer the camera will rise through.
- **Aerial haze** L338-353/L418-422 + `mountain-language.js L96 fogCool`: pass a lighter `uFog 0xbcd2e6`
  into MAIN_PEAK; lift the base-mist so feet fade to airy white-blue, not navy `0x33506e`.
- **Grade/fog** `chapter-profile.js` L224-226: `fogDensity 0.005`→~`0.0022`, `fogColor 0x7d93ad`→
  `0xbcd8ec`. `odyssey-tsl-pipeline.js` Ch4 sig (L135): tint `[1.02,1.00,1.06]`→~`[1.02,1.00,1.01]`.
- **PRESERVE:** the shared canonical peak chain + snow palette (already continuous with Ch3, snow-pinned).

### Ch5 Sky & Drift — twilight/aurora → sunlit cloud-sea payoff
- **Dome** `sky-drift.tsl.js createSkyGradientTSL` (L118-157): zenith→`vec3(0.11,0.34,0.72)`,
  midSky→`(0.36,0.62,0.90)`, horizon→`(0.80,0.90,0.97)`; **DELETE** the `waveVDarkBackstop mul(0.48)` +
  dark min-clamps (L153-157) and neutralize `actT` (L118); keep the Mie sun as a bright warm-white disc,
  stop it dying (remove the `sunAlive` gate L137).
- **Kill the dusk ramp** `sky-drift.js` L413-427/471-520: pin `uDusk` low (clamp ≤~0.15) so nothing
  darkens; remove the sun-death (L517) and the dusk→aurora-green glow lerp (L471-483).
- **Clouds** `createSharedCloudMaterialTSL/createCloudStrataTSL`: white base `0xF6F8FF` (L457-462),
  **NormalBlending** (L421), opacity `mix(0.08,0.16)`→`mix(0.55,0.85)` (L417), higher coverage,
  top-white→underside-bluegrey `0xB9C9DE`; drop the duskT ink-shift (L393-394). **Add the cloud-sea**:
  reuse `mountain-peaks createCloudSeaDeckTSL` (L219) below the rail at bright tints (its Ch4 deck tokens
  `0xf2e3cf/0x9fb3cc/0xb9cee2`) so you drift *above* the same sea — the Europa read + direct Ch4 anchor.
- **Demote night motifs** `sky-drift.js` L296-357: aurora stage base `0.72`→~`0.12` (sky-drift.tsl.js
  L690) or remove `createAuroraRibbons`; remove `createNoctilucentVeilTSL` + `createDarkWispsTSL`. Keep
  god-ray fans + sun-glow (they suit daylight).
- **Lighting** `setupSkyLighting` L373-390: ambient `0x1a1a2e`→`0x9fc4e8@0.6`; purple/cyan cosmic glows
  → warm sun + sky fill; keep sunKey alive.
- **Grade/fog** `chapter-profile.js` L261-271: skyColor→`0x3f7fd0`, fogColor→`0xbcd8ec`, fogDensity
  `0.0035`→~`0.0022`, ambient→`0xeaf2ff@0.58`, exposure `0.96`→~`1.02`. `odyssey-tsl-pipeline.js` Ch5 sig
  (L141-143): tint `[1.05,0.96,1.07]`→`[0.99,1.01,1.05]`, contrast `0.98`→`1.05`, sat→`1.12`.

---

## 5. Cohesion layer (cross-cutting, after the three chapters are in the daylight family)
1. **Shared fog anchor** — Ch3/4/5 fogColor all → `~0xbcd8ec`, density `0.0016/0.0022/0.0016`. *Ranked #1
   leverage: low effort, huge.* SEAM_34 bridge auto-relaxes.
2. **One continuous sun** — reconcile the rig `lightDir` (profile L188/230/268) AND every disc const
   (`SURFACE_SUN_DIR` L428, `mountain-peaks lightDir` L79-81, `SKY_DRIFT_SUN_DIR` L81, `ODYSSEY_WATER_SUN_DIR`
   L47, strays L801/2768) onto `ODYSSEY_SUN ≈ (0.35,0.62,-0.70)`, colour `0xfff4e0`; elevation lifts only
   slightly with altitude.
3. **Raise Ch5 out of night** — ambient + exposure equalized so the highest chapter is the brightest.
4. **Flatten the grade** — converge CHAPTER_SIGNATURES rows 3/4/5 to a near-neutral daylight stock.
5. **Add SEAM_45** — `SEAM_45_SKY_BRIDGE` (light-cyan) + half-width in `seam-bridges.js`, wired into
   `ChapterEnvironmentManager` (mirror SEAM_34 ~L1411-1464) and `OdysseyDirector` (~L255-308).
6. **Cloud continuity** — one cumulus/cirrus vocabulary from Ch3 up through Ch4 into Ch5's deck; the Ch3
   lake reflects that same cloud material, making the cloud the literal through-line.

---

## 5b. Axis 2 — Landscape geometry cohesion (the terrain must be one place, not just one air)

*From a dedicated read-only geometry investigation. Surprising headline: **the mountains are NOT the
discontinuity.** Ch3's distant range, Ch4's climbed peaks and Ch5's receding ring are the **same three
meshes at identical absolute world coordinates** — `getCanonicalMountainRangeWorldSpecs()`
(`canonical-mountain-range.js:58-168`) world-locks them (peak feet anchored to `chapter3Center.y`), and
each host does `meshLocal = worldPos − hostCenter` so `meshWorld = worldPos` regardless of chapter. The
range you see far across the meadow literally IS the range you climb. What swaps is the **FLOOR + the
cloud layers.***

Resolved world-Y climb: Ch3 cam 297→366 (center 332), Ch4 366→516 (center 441), Ch5 516→655 (center 586).

**Geometry discontinuities (ranked levers):**

| # | Discontinuity | Lever | Impact/Effort |
|---|---|---|---|
| **D1** | **Ch5 has NO floor.** Ch4's cloud-sea deck (the silver sea the peaks rise from, world-Y 312, r2600) is Ch4-only and fades out at the seam → the floor *vanishes* entering Ch5 instead of receding below. **Sharpest 4→5 break.** | **L1: extend `createCloudSeaDeckTSL` into Ch5** (world-locked Y≈312) so the SAME sea recedes below as you climb — sells "above the clouds" + is the literal shared cloud through-line the colour plan also wants | **High / Low-Med** |
| **D2** | Ch4 has **two floors 65u apart** — snow-floor disc (Y247, r3000, z−1327) vs cloud-sea deck (Y312, r2600, z−827) | **L2: collapse to one Ch4 datum** aligned to Ch3 hill/water band (~290-314) + peak feet (302-322) so the 3→4→5 floor sits in one ~290-315 ribbon | High / Med |
| **D3** | **Finite planes vs huge discs** — Ch3 terrain is `PlaneGeometry(400,400)` (±200) + water; Ch4's r3000 snow disc undercuts it ~40u and spills past the ±200 rim → a visible *second, lower* floor + horizon-radius jump during crossfade | **L4: give Ch3 the same far floor/horizon disc** (or hand the terrain melt into it) so past the rim the eye sees the shared far floor, not sky-then-second-disc | Med / Med |
| **D4** | **Foothill bridge fades instead of connecting** — Ch3's bridge crest (~325-330) sits 13-78u above Ch4's floor AND `resolveSurfaceWorldSeamRecedeState` dissolves it across the last 22% of Ch3 (`surface-world.js:819-840,1586`) | **L3: make the bridge a real physical ramp** — match `foothillBridgeHeight` crest to Ch4's floor datum + STOP the seam-recede so it persists through the crossfade | High / Med |
| **D5** | **One-sided tree-line** — Ch3 conifers `count:0` (clean meadow) but Ch4 seeds 80 *at* the seam → the forest "begins" at the boundary | Add a thinning far treeline on the Ch3 foothill side (meadow stays clean; only the far approach gets a treeline — natural meadow→treeline→snow), or soften Ch4's seam seeding | Med / Low |
| **D6** | **Coplanar double-draw** — the shared peaks are 3 separate instances co-drawn at identical coords during each crossfade → z-fight/flicker risk + doubled cost | **L5: one hosted canonical-range instance** under a persistent world-anchored group (like the light rig) all three chapters reference | Med / Med-High (perf win too) |
| **D7** | Hero summit (crown 1022) never climbed above (cam maxes 655 Ch5 / 781 Ch6) → stays towering overhead | L6 (optional): lower the center-hero crown anchor or push its base further in Z so it reads distant | Low-Med / Low |

**Weave into the waves:** L4 + L3(Ch3 side) → Wave A/B; L2 → Wave B (Ch4); **L1 (highest) → Wave C (Ch5)**;
L5 → Wave D. The **shared persistent cloud-sea deck (L1)** is the convergence of both axes — it is
simultaneously the geometry floor AND the colour plan's "cloud through-line," so it should become a
world-anchored shared element (like the canonical range) that Ch4 and Ch5 both host.

**Preserve:** the canonical range is already correct — do NOT reposition the peaks; the fix is the floor,
the bridge handoff, and giving Ch5 a floor. `createDistantMountainsTSL` (surface-world.tsl.js:2604) is
dead code (Ch3 uses the canonical builder) — ignore it.

## 6. Technique reference (realtime, WebGPU/TSL r181)
- **Sky:** two-colour vertical gradient by `pow`'d normalized `view.y` (zenith→horizon) + soft sun disc +
  Mie glow. Stylized-clean; no full light-march needed.
- **Clouds (imposter/mesh tier — the right perf call here, not full raymarch):** wrap diffuse
  `dot(N,L)*0.5+0.5` + backlight subsurface `pow(max(dot(-N,L),0),2)*0.4` + top-bias smoothstep on
  billowing instanced cards. (Full raymarch — FBM+Worley density, dual-lobe HG, Beer-Lambert+powder,
  silver-lining — documented as the ceiling if perf allows; gate behind quality tier.)
- **Grass (BOTW):** 5-vert blade, tip-only wind `sin(time + uv/worldpos)`, vertex-colour AO gradient,
  scrolling B/W cloud-shadow texture multiply; half-lambert.
- **Flowers:** hash-scattered instanced quad cards near + colour-splat carpet baked into terrain albedo mid.
- **Water:** depth shallow→deep (Beer-Lambert) + Schlick Fresnel sky/cloud **reflection** (reflector() RTT
  or PMREM baked from the sky dome) + 2 scrolling normals + sun glint + thin shoreline foam.
- **Aerial perspective:** distant geometry gains a blue tint + fades to haze with distance; snow shadow is
  cool-blue, never grey/black — this is what turns "cold winter" into "bright airy range".
- **Grade:** exposure lift, vibrance that protects near-white (clouds/snow stay white), shadows lifted
  toward blue, high-threshold soft bloom on highlights/snow/water glints.

---

## 7. Implementation order (capture-driven, TDR-safe — ONE chapter per capture)

Transform one chapter fully into the daylight anchor, capture it on the dGPU, then the next — so each
wave is a coherent all-daylight chapter and the shared anchor is enforced by using the same tokens.

- **Wave A — Ch3 hero (START HERE).** Sky azure + flowers restored + water turquoise-reflective + terrain
  green + bright-cool grade/fog (all hex/uniform, low-risk) → `--chapter 3`. Then the cumulus rebuild,
  playground-iterated against the hero ref → re-`--chapter 3`.
- **Wave B — Ch4.** Sky rebright + moon→sun + drop night + hero cumulus + airy haze + grade/fog →
  `--chapter 4` + `--seam 3-4`.
- **Wave C — Ch5.** Dome daylight + kill uDusk + white cumulus + cloud-sea deck + demote aurora + re-key
  + re-grade → `--chapter 5` + `--seam 4-5`.
- **Wave D — cohesion.** Shared `ODYSSEY_SUN` + `ODYSSEY_DAYLIGHT_ANCHOR` refactor, flatten grade, add
  SEAM_45 → `--seam 3-4`, `--seam 4-5` re-check.

Risks/guards: the water material is shared with Ch2's breach — branch Ch3 colour changes. `MOUNTAIN_LIGHT_DIR`
also drives alpenglow — retune together. Keep the one-lake + no-hard-edge fixes intact. Foliage restore may
re-load the counts that were zeroed; watch perf (tier-gate flower/grass counts).
