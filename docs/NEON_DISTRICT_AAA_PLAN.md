# Neon District — AAA Visual Upgrade Plan

> **Goal**: Take Neon District from "a competent cyberpunk street" to **a screenshot you'd put on a Steam page** — a rain-soaked Night City canyon where neon *bleeds into the wet asphalt*, the air is thick with colored volumetric fog and god-rays, a hero moon hangs huge over a living skyline, and flying cars streak motion-blurred trails between the towers. The player who loads this theme should think **"wait, this runs in a browser?"**

> **Status**: Planning. Nothing here is implemented yet. Phased so each phase ships independently and is reversible. Every change is gated by quality preset + a `?nd*` debug flag.

> **Scope note**: Neon District already runs the dual backend — WebGPU (TSL node materials + MRT emissive bloom + `NeonDistrictPost`) and a WebGL2 fallback (`ShaderMaterial` + `EffectComposer`). The migration is *done* ([NEON_DISTRICT_WEBGPU_UPGRADE_PLAN.md](NEON_DISTRICT_WEBGPU_UPGRADE_PLAN.md), Phases 1–8 complete). This plan is **purely visual**, building on that foundation. The headline gains target the WebGPU path; WebGL gets cheaper approximations so it never looks broken.

---

## North Star — The Look We're Chasing

The reference is **Blade Runner 2049 / Cyberpunk 2077 Night City at street level in the rain.** The defining traits of that look, and where Neon District sits today:

| AAA cyberpunk trait | Night City / BR2049 | Neon District today |
|---|---|---|
| **Neon reflected in wet street** | Ray-traced reflections of every sign, window, car | ❌ Fake 128px purple cube map; road can't mirror the scene |
| **Thick volumetric fog + colored god-rays** | Volumetric fog is the single most "atmospheric" setting | ❌ Only a flat depth-color fog in post; no light shafts |
| **Huge hero element in the sky** | Looming holograms, the giant ad-blimp, moon | ⚠️ A dim flat gradient disc, barely visible in screenshots |
| **Depth-of-field bokeh on distant neon** | Distant signs melt into glowing circles | ❌ Everything is in perfect focus |
| **Anamorphic lens streaks + flares** | Every bright light streaks horizontally | ❌ Bloom only, no streaks/flares |
| **Color-graded palette** | Teal shadows, magenta highlights, filmic | ⚠️ Per-material tint only, no unified grade |
| **Dense, layered, parallaxing depth** | Foreground silhouettes → mid traffic → far skyline | ✅ Strong: mega-tower, skyline, 8 traffic bands |
| **Reactive, cinematic camera** | — | ⚠️ Great idle sway, but no gameplay reactivity |

Industry confirmation: in Cyberpunk 2077, disabling **Screen Space Reflections** "removes reflections from wet roads and specular surfaces," and **volumetric fog** is described as among the most taxing *and* most transformative settings — it generates depth, god-rays, and the rain-soaked atmosphere ([rendering analysis](https://zhangdoa.com/rendering-analysis-cyberpunk-2077/), [PCGamesN ray-tracing breakdown](https://www.pcgamesn.com/cyberpunk-2077/ray-tracing-techniques)). Modern real-time cyberpunk workflows lean hard on **layered volumetric fog → god-rays → ray-traced neon reflections in puddles** ([D5 Render cyberpunk city guide](https://www.d5render.com/posts/cyberpunk-city)). Those three are exactly Neon District's three biggest gaps.

---

## TL;DR — The Five Moves That Matter Most

| # | Move | Why it transforms the theme | Cost |
|---|---|---|---|
| 1 | **Real reflections on the wet street** (SSR on WebGPU + real HDR env fallback) | THE cyberpunk money shot. Right now the road reflects a 128px fake purple cube; making it mirror the actual neon/windows/sky is the single biggest "AAA vs. tech demo" leap. | High |
| 2 | **Volumetric fog + colored god-rays** | The air is empty. Thick street-level fog tinted by nearby signs, with light shafts stabbing down from searchlights/windows, is what gives the canyon *atmosphere and depth*. | Medium–High |
| 3 | **Cinematic post stack** (DOF bokeh + anamorphic streaks + LUT grade + restored grain/CA + vehicle motion blur) | r181 ships every one of these as a ready TSL node. Together they turn "clean render" into "album cover." Distant neon → bokeh circles, every light → anamorphic streak, whole frame → filmic grade. | Medium |
| 4 | **Hero sky** (glowing moon with halo + lens flare, drifting smog/cloud strata, distant heat-lightning) | The upper half of the frame is dead black in the screenshots. A looming, bloom-driven moon + parallax cloud bands + occasional sheet-lightning makes the sky earn its screen space. | Medium |
| 5 | **Living facades** (colored window emissive, parallax interiors, richer storefronts, sign light-cones) | Windows are monochrome white/warm. Colored interior glow, fake-3D parallax window interiors, and neon signs that *cast colored light cones into the fog* make buildings feel inhabited, not printed. | Medium |

These compound. SSR + volumetric fog + DOF + anamorphic flare together read as "rendered by a real engine," not "drawn with shaders."

---

## 1. Where Neon District Stands Today (audit)

Read of the current implementation so the plan builds on reality. Strong, mature foundation — the gaps are visual, not structural.

**Renderer & post** — WebGPU (TSL + MRT emissive bloom) with WebGL2 fallback. Mature quality-preset system ([QUALITY_PRESETS:82](../src/themes/neon-district/neon-district-theme.js#L82)), dynamic resolution, GPU-timing/baseline instrumentation, LOD tiers, prewarming, ~30 `?nd*` debug flags ([getDebugFlags:570](../src/themes/neon-district/neon-district-theme.js#L570)).

**Post-processing** ([neon-district-post.js](../src/themes/neon-district/neon-district-post.js)): **only** MRT emissive bloom + radial vignette + linear-depth color fog. Chromatic aberration and film grain were *deliberately removed* for perf — the uniforms still exist but are hard-forced to `0` ([neon-district-post.js:86-90](../src/themes/neon-district/neon-district-post.js#L86)). **No DOF, no SSR, no anamorphic flare, no lens flare, no LUT grade, no motion blur.**

**Sky** ([createSkyNodeMaterial:207](../src/themes/neon-district/neon-district-materials.js#L207)): static 3-colour vertical gradient + a purple haze band near the horizon. No clouds, no motion, no volumetric. Dome sphere r=9000.

**Moon** ([createMoonNodeMaterial:488](../src/themes/neon-district/neon-district-materials.js#L488), placed [createMoon:5061](../src/themes/neon-district/neon-district-theme.js#L5061)): a flat gradient disc (magenta→cyan) with scanlines, multiplied by **0.3** so it's very dim, parked at `(-2500, 2700, -6000)`. In the screenshots it's effectively invisible — the sky reads as dead black.

**Wet asphalt** ([createWetGroundNodeMaterial:678](../src/themes/neon-district/neon-district-materials.js#L678)): genuinely sophisticated — `MeshPhysicalNodeMaterial` with PBR asphalt maps (`aerial_asphalt_01`), FBM-driven puddles, animated rain-ripple normal perturbation, clearcoat wet sheen (puddle roughness → 0.005), procedural neon colour streaks, periodic light pools. **But its reflections come from `scene.environment` = a procedurally-painted 128px purple/cyan cube map** ([createPurpleEnvironmentMap:7276](../src/themes/neon-district/neon-district-theme.js#L7276)). It physically *cannot* reflect the real buildings/signs/cars. A real `shanghai_bund_2k.hdr` (6.4 MB) is shipped in `public/textures/neon-district/` and **never loaded** — the code comment literally says "no golden HDR." This is the highest-leverage single fix in the whole theme.

**Buildings** ([createBuildingNodeMaterial:265](../src/themes/neon-district/neon-district-materials.js#L265) + asset SynthCity materials): procedural window grid with distance quantization/LOD. Window glow is **white/warm only** ([winColor mix pureWhite↔warmWhite:368](../src/themes/neon-district/neon-district-materials.js#L368)). No coloured interiors, no parallax depth, no facade variety beyond geometry stacking. Storefronts are a single textured box ([createStorefront:3089](../src/themes/neon-district/neon-district-theme.js#L3089)) + dark grime/debris boxes ([addGroundLevelDetails:3114](../src/themes/neon-district/neon-district-theme.js#L3114)).

**Neon signage** — reasonably rich already: animated VHS billboards (scanlines+glitch+CA, [createVhsBillboardNodeMaterial:429](../src/themes/neon-district/neon-district-materials.js#L429)), holographic billboards ([createHologramNodeMaterial:567](../src/themes/neon-district/neon-district-materials.js#L567)), neon strips/banners/kanji, instanced ad atlas. Signs are emissive (→ bloom) but **cast no light into the world** — no colored point/spot contribution, no fog interaction.

**Rain** ([createRain:6360](../src/themes/neon-district/neon-district-theme.js#L6360)): camera-relative instanced additive quad streaks + ground splash points ([createSplashNodeMaterial:638](../src/themes/neon-district/neon-district-materials.js#L638)). Functional but flat — streaks are a single blue-white tint, not lit by the neon they fall through; no lens droplets on camera; splashes don't catch sign colour.

**Flying vehicles** ([createFlyingVehicles:6979](../src/themes/neon-district/neon-district-theme.js#L6979)): instanced spinners (body/canopy/engine/exhaust/head+tail lights) across 8 weighted altitude bands — good density and parallax. But **no motion-blur trails, no volumetric headlight cones, no reflection in the road.**

**Lighting** ([setupSceneLighting:7340](../src/themes/neon-district/neon-district-theme.js#L7340)): ambient + top-down moonlight directional (4096 shadow map) + fill + hemisphere + 2–4 point lights. Env = the fake purple cube. No volumetric shafts.

**Composition / camera** ([updateCameraSway:8365](../src/themes/neon-district/neon-district-theme.js#L8365)): sophisticated idle choreography — multi-frequency sway, pointer parallax, vertical rise with a "peak nod" toward the moon, subtle roll. Excellent resting state. But **nothing reacts to gameplay** (line clears, combos, Tetris) and there's no DOF-framing.

**Reactive FX already wired** (great hooks to amplify): [triggerComboEffects:7583](../src/themes/neon-district/neon-district-theme.js#L7583), [spawnComboSparks:7618](../src/themes/neon-district/neon-district-theme.js#L7618), [triggerNeonSignSurge:7735](../src/themes/neon-district/neon-district-theme.js#L7735), [spawnLightningArc:7741](../src/themes/neon-district/neon-district-theme.js#L7741), [triggerGlitchWave:7848](../src/themes/neon-district/neon-district-theme.js#L7848).

### The ready-made arsenal we're not using

Three.js **r0.181** (current, [package.json](../package.json)) already ships these as importable TSL display nodes under `three/addons/tsl/display/` — no custom shader authoring required:

| Node | File | Use in Neon District |
|---|---|---|
| `ssr()` | `SSRNode.js` | **Real reflections on the wet road** |
| `dof()` | `DepthOfFieldNode.js` | Bokeh on distant neon / foreground |
| `anamorphic()` | `AnamorphicNode.js` | Horizontal lens streaks off bright lights |
| `lensflare()` | `LensflareNode.js` | Moon + hero-sign flare |
| `chromaticAberration()` | `ChromaticAberrationNode.js` | Edge RGB-split (radial) |
| `lut3D()` | `Lut3DNode.js` | Filmic color grade |
| `motionBlur()` | `MotionBlur.js` | Flying-car / sign streaks |
| `ao()` (GTAO) | `GTAONode.js` | Contact shadows in alley corners |
| `ssgi()` | `SSGINode.js` | (stretch) bounced neon color |
| `traa()` | `TRAANode.js` | (stretch) high-quality temporal AA |
| `reflector()` | `src/nodes/utils/ReflectorNode.js` | Planar mirror for the near road (SSR alternative) |

The official [WebGPU SSR example](https://threejs.org/examples/webgpu_postprocessing_ssr.html) shows the exact pattern: `ssr(beautyColor, depth, normal, metalness, roughness, camera)` composited over the scene pass. This is the backbone of Move #1.

---

## 2. The Cinematic Vision

You're standing in a rain-drenched canyon between mega-towers, looking down a street that races toward a colossal hologram-haloed moon. The wet asphalt is a **second sky** — it mirrors the magenta ramen sign, the cyan window grids, the streaking tail-lights of a passing spinner, all smeared and shimmering through the ripples. The air is *thick*: a violet volumetric fog pools at street level, and shafts of colored light from the searchlights and the brightest signs cut visible god-rays through it. Rain falls lit by the neon it passes — pink near the ramen shop, cyan under the cosmic-bar sign — and beads on the camera lens. Distant signs melt into soft bokeh circles; every bright light throws a horizontal anamorphic streak. The whole frame is graded teal-shadow / magenta-highlight. On a line clear the camera dollies forward into the canyon as a shockwave ripples the puddles and the signs surge brighter; on a Tetris, sheet-lightning flashes the smog and the moon flares.

**Design rule:** the wet road (bottom third) and the neon canyon (middle) are the stars. This plan makes the **air between them** (fog/god-rays/DOF/rain) and the **sky above** (moon/clouds/lightning) earn their screen space, and ties the wet road to *real* reflections so the floor stops being a flat purple wash.

---

## 3. Phase Breakdown

### Phase 1 — Real Reflections on the Wet Street *(biggest single ROI)*

The wet ground material is already excellent — it just reflects a lie. Feed it the truth.

**1a. WebGPU Screen-Space Reflections.** Wire `ssr()` from `SSRNode.js` into `NeonDistrictPost`, fed the MRT/scene color, the existing `getLinearDepthNode()`, a normal pass, and the road's low roughness/metalness. Composite SSR over the beauty pass so the puddles mirror the actual neon, windows, cars, and moon. The road material already exposes mirror-grade roughness in puddles ([puddleRoughness 0.005:901](../src/themes/neon-district/neon-district-materials.js#L901)) — SSR will light up exactly there. This is the shot.
- *Cost control:* SSR `maxDistance` is the main knob; gate to High/Ultra/Extreme, render at the existing post downscale, and reuse the depth node already created in post ([getLinearDepthNode:59](../src/themes/neon-district/neon-district-post.js#L59)). Add `?ndNoSSR=1`.

**1b. Replace the fake env map with the real HDR.** Load the unused `shanghai_bund_2k.hdr` via `RGBELoader` → `PMREMGenerator`, tint/darken it toward the purple palette, and set it as `scene.environment`. Even where SSR can't reach (grazing angles, far road, off-screen sources) the road then reflects a *real* HDRI city instead of a 128px painting. Keep the procedural cube as the WebGL/Low fallback.

**1c. Planar reflector for the hero near-road (alternative/supplement).** For the bottom strip closest to camera — where reflections read most — a `reflector()` planar mirror gives perfect, cheap, full-scene reflection without SSR's screen-edge artifacts. Blend reflector (near) → SSR (mid) → env (far) by distance. Optional; SSR alone may suffice.

**1d. Reflected neon "smear."** Stretch the reflection vertically and add ripple-driven horizontal jitter (the ripple normals already exist, [getRipples:734](../src/themes/neon-district/neon-district-materials.js#L734)) so reflections shimmer and elongate like the reference photos, not act as a crisp mirror.

**WebGL fallback:** keep the procedural env + the existing baked neon streaks; no SSR.

**Outcome:** the floor becomes the most beautiful surface in the scene instead of a flat purple wash.

---

### Phase 2 — Volumetric Atmosphere & God-Rays

The canyon air is empty. Fill it.

**2a. Street-level volumetric fog.** A ray-marched fog volume (TSL `Fn` marching the depth buffer, or layered additive fog slabs hugging `y≈0–120`), tinted violet and **locally colored by nearby sign/point-light positions** so fog glows pink by the ramen shop and cyan under the bar. This is the "thick air" that defines the genre. The post already has a flat depth-fog ([fogFactor:60](../src/themes/neon-district/neon-district-post.js#L60)) — upgrade it to height-banded + light-tinted instead of a single grey lerp.

**2b. God-ray light shafts.** Volumetric shafts from the searchlights ([createSearchlights:5233](../src/themes/neon-district/neon-district-theme.js#L5233)) and the brightest signs/windows, stabbing down through the fog. Cheapest path: radial god-ray screen-space pass anchored to the on-screen brightest emitters (reuse the bloom emissive target as the occlusion source). Heavier path: per-light cone meshes with soft additive falloff.

**2c. Sign light-cones.** The brightest neon signs project a soft colored cone of light into the fog and onto the facade/road below them — sells "this sign is a real light source." A few additive cone meshes oriented sign→street, colored from the sign palette.

**2d. Real distance fog falloff for the buildings.** Fold the same fog color into the building/skyline emissive so far towers desaturate into the haze, unifying the world under one atmosphere (the wet-ground material already does this manually, [atmosphericDarkening:773](../src/themes/neon-district/neon-district-materials.js#L773); extend it scene-wide).

**WebGL fallback:** the existing depth-color fog + a single cheap radial god-ray `ShaderPass`; skip ray-marched volume.

**Outcome:** depth, mood, and the unmistakable "rain-soaked Night City" air.

---

### Phase 3 — Cinematic Post-Processing & Color Grade

Compose these in `NeonDistrictPost` *after* bloom, fused where possible into a single output node to stay within one full-screen read. Every one is a ready r181 node.

**3a. Depth-of-field (bokeh).** `dof()` keyed off the existing linear-depth node — focus the mid-street, let distant signs melt into glowing bokeh circles and near rain/foreground softly defocus. The single biggest "cinematic" multiplier and it makes the dense distant neon read as *atmosphere* instead of noise (cf. the busy aliased far-field in screenshot 1).

**3b. Anamorphic light streaks.** `anamorphic()` over the bloom source → horizontal streaks off every bright sign/headlight. This is *the* synthwave/cyberpunk lens signature and it makes screenshots pop.

**3c. Restore radial chromatic aberration + film grain.** They were removed wholesale for perf ([forced to 0:86-90](../src/themes/neon-district/neon-district-post.js#L86)); bring them back as *radial* CA (0 at center, a few px at corners) + subtle grain, gated to High+ and driven up briefly on combo/glitch events (hooks already exist, [triggerGlitchWave:7848](../src/themes/neon-district/neon-district-theme.js#L7848)). Use `chromaticAberration()` / `FilmNode.js`.

**3d. Filmic LUT color grade.** `lut3D()` with a teal-shadow / magenta-highlight cyberpunk LUT for one unified, graded palette instead of per-material tinting. Ship a baked `.cube`/`.png` LUT to match the menu-AAA art direction.

**3e. Lens flare on the moon + hero sign.** `lensflare()` anchored to the moon (Phase 4a) and optionally the single brightest hero sign — ghosts + halo that bloom with the moon's glow.

**3f. Motion blur for the flying cars.** `motionBlur()` (velocity-buffer) so spinners leave the long light-trails that sell speed in Night City flythroughs.

**3g. Tiered bloom.** Split today's single bloom ([bloom():33](../src/themes/neon-district/neon-district-post.js#L33)) into a tight high-threshold core + a wide soft bloom for "neon bleeding into the dark," and lift the conservative strengths.

**WebGL fallback:** cheap `ShaderPass` chromatic aberration + a static radial flare sprite on the moon; skip DOF/anamorphic/motion-blur/LUT (or a 2D LUT approximation).

---

### Phase 4 — Hero Sky

The top half of the frame is dead. Wake it up.

**4a. Hero moon.** Rebuild [createMoonNodeMaterial:488](../src/themes/neon-district/neon-district-materials.js#L488): drop the `×0.3` dimming, add a soft emissive corona ring + atmospheric scatter halo, faint surface detail (craters/banding), and let MRT bloom + the new lens flare do the rest. Make it **loom** — bigger, brighter, the anchor the camera's peak-nod already reaches for ([peakNod:8426](../src/themes/neon-district/neon-district-theme.js#L8426)).

**4b. Drifting smog / cloud strata.** 2–3 slow horizontal cloud/smog bands high in the sky (additive, drifting opposite directions, FBM-textured), tinted from the palette, occasionally backlit by the moon. Turns the flat gradient into living atmosphere.

**4c. Distant heat-/sheet-lightning.** Occasional silent sheet-lightning behind the far skyline that briefly flashes the smog and rim-lights the towers — reuse [spawnLightningArc:7741](../src/themes/neon-district/neon-district-theme.js#L7741), trigger ambiently + on Tetris.

**4d. Aurora / sky-glow shimmer.** A faint animated city-glow band on the horizon (the "light pollution" dome) so the bottom of the sky glows where the city is densest.

**WebGL fallback:** brighter moon + a couple of static cloud sprites + the existing lightning hook.

---

### Phase 5 — Living Facades & Storefronts

Make the buildings feel inhabited, not printed.

**5a. Colored window emissive.** Windows are white/warm only ([winColor:368](../src/themes/neon-district/neon-district-materials.js#L368)). Add a minority of cyan/magenta/amber lit windows (hash-driven per cell) for the chromatic variety Night City has — and let the colored windows feed the SSR reflections + fog tint.

**5b. Parallax window interiors.** Fake-3D interior depth via parallax-occlusion-style UV offset in the building shader (interior box illusion) so windows have *depth* instead of being flat lit rectangles. Big perceived-quality jump for ~free fragment cost; gate to near LOD only.

**5c. Richer storefronts.** Today's storefront is one textured box + grime/debris ([createStorefront:3089](../src/themes/neon-district/neon-district-theme.js#L3089)). Add awnings, hanging vertical signs (the iconic kanji blade-signs), recessed glowing doorways, and steam vents ([createSmokeEffects:5851](../src/themes/neon-district/neon-district-theme.js#L5851) already exists — place more at street level by storefronts).

**5d. Sign light bleed onto facades.** Where a neon sign sits on a wall, bleed its color onto the surrounding facade (emissive decal or a cheap colored point light) so signs feel attached to real surfaces.

**5e. GTAO contact shadows.** `ao()` (GTAO) for soft contact darkening in alley corners, under awnings, where buildings meet the road — adds grounding and depth cheaply on WebGPU. Gate High+.

**WebGL fallback:** colored windows (cheap) + extra storefront geometry; skip parallax interiors + GTAO.

---

### Phase 6 — Rain, Vehicles & Particle Life

**6a. Neon-lit rain.** Tint rain streaks by the nearest dominant sign color as they fall (sample a coarse light grid or just modulate by world-X zones) so rain glows pink by the ramen shop, cyan under the bar — instead of uniform blue-white ([rainMaterial color 0xd0e0f0:6385](../src/themes/neon-district/neon-district-theme.js#L6385)).

**6b. Lens rain droplets.** Animated water beads/streaks on the "camera lens" (screen-space overlay in post) that refract the scene behind them — a top-tier "you are *there* in the rain" cue.

**6c. Heavier near-camera rain + light-catching splashes.** A denser foreground streak layer and splash particles that flash the color of whatever sign is overhead.

**6d. Volumetric headlight cones + road reflection for vehicles.** Soft additive light cones in front of the spinners (visible through the fog) and let their head/tail lights show up in the SSR road reflection (free once Phase 1 lands). Combined with Phase 3f motion blur, the traffic becomes a hero element.

**WebGL fallback:** colored rain (cheap) + keep current splashes; skip lens droplets + headlight cones.

---

### Phase 7 — Composition & Camera Choreography

The idle sway is already excellent ([updateCameraSway:8365](../src/themes/neon-district/neon-district-theme.js#L8365)) — make it *react*.

**7a. Reactive camera channel.** Add an event-driven offset on top of the idle sway:
- **Line clear** → short dolly-push down the canyon, then ease back; a puddle shockwave ripple.
- **Tetris** → bigger push + brief FOV widen (dolly-zoom) + sheet-lightning (4c) + moon flare.
- **Combo ≥ N** → slow saturation/LUT-mix ramp + tighter bloom + sign surge ([triggerNeonSignSurge:7735](../src/themes/neon-district/neon-district-theme.js#L7735)).

**7b. Graduated parallax depth.** Extend the existing pointer parallax to the new fog, cloud strata, and moon at graduated strengths so movement reveals real depth between layers.

**7c. DOF-framed foreground.** A near, dark, out-of-focus silhouette element at a bottom corner (a chrome railing, a hanging cable, a fire-escape) to frame the shot and give the DOF something to blur in front. Subtle, optional.

---

## 4. Performance Budget & Safety

- The expensive newcomers are **SSR, ray-marched fog, DOF, GTAO**. Everything else (anamorphic, CA, grain, LUT, lens flare, motion blur, colored windows, neon rain) is cheap fragment work.
- **Fuse the post stack:** DOF + CA + LUT + grain + anamorphic composite should share as few full-screen passes as possible in `NeonDistrictPost`, not stack as independent passes.
- **Gate hard by preset.** Suggested:
  - *Extreme/Ultra:* SSR + ray-marched fog + DOF + GTAO + full post.
  - *High:* SSR (short range) + height fog + DOF + anamorphic + LUT; GTAO off.
  - *Medium:* env-HDR reflections (no SSR) + height fog + LUT; no DOF/GTAO.
  - *Low/Minimal:* current look + brighter moon + colored windows only.
- Add `QUALITY_PRESETS` keys (`enableSSR`, `enableVolumetricFog`, `enableDOF`, `enableGTAO`, `fogTint`) and matching debug flags (`?ndNoSSR`, `?ndNoFog`, `?ndNoDOF`, `?ndNoGrade`) following the existing pattern ([getDebugFlags:570](../src/themes/neon-district/neon-district-theme.js#L570)).
- The existing **dynamic-resolution + slow-frame guard** + GPU profiling already protect against overruns — validate every phase with `?ndBaseline=1` and `?ndProfile=1`, and keep `?forceWebGL=1` green throughout.
- Target unchanged: stable 60 FPS on **High**, 120 where the panel allows.

---

## 5. Suggested Implementation Order (each independently shippable)

1. **Phase 1a + 1b** (SSR + real HDR env) — *the* leap; do it first. Instantly elevates every screenshot.
2. **Phase 2a + 2b** (volumetric/height fog + god-rays) — the atmosphere that defines the genre.
3. **Phase 3a + 3b + 3d** (DOF + anamorphic + LUT) — turns "clean" into "cinematic."
4. **Phase 4a** (hero moon + flare) — the sky anchor; cheap, huge.
5. **Phase 5a + 5b** (colored + parallax windows) — facades come alive.
6. **Phase 7a** (reactive camera) — ties visuals to game feel.
7. **Remaining polish** (3c/3e/3f/3g, 4b–d, 5c–e, 6a–d, 7b–c) once the core lands.

---

## 6. File-by-File Touch List

- [neon-district-post.js](../src/themes/neon-district/neon-district-post.js) — SSR, DOF, anamorphic, lens flare, LUT, motion blur, restored CA/grain, tiered bloom, upgraded light-tinted fog. The bulk of the work; keep it fused.
- [neon-district-materials.js](../src/themes/neon-district/neon-district-materials.js) — hero-moon material; colored + parallax-interior windows; reflected-neon smear in wet ground; cloud-strata + sky-glow + fog-cone materials; neon-lit rain.
- [neon-district-theme.js](../src/themes/neon-district/neon-district-theme.js) — load `shanghai_bund_2k.hdr` env (replace [createPurpleEnvironmentMap:7276](../src/themes/neon-district/neon-district-theme.js#L7276)); wire SSR/normal pass; volumetric fog + god-ray setup; sign light-cones + light bleed; richer storefronts; headlight cones; reactive camera in [updateCameraSway:8365](../src/themes/neon-district/neon-district-theme.js#L8365); new `QUALITY_PRESETS` keys + debug flags.
- [neon-district-assets.js](../src/themes/neon-district/neon-district-assets.js) — storefront/awning/hanging-sign variants; ensure normal/roughness available for SSR-lit surfaces.
- **New (optional):** `neon-district-volumetrics.js` — ray-marched fog + god-ray TSL helpers, kept out of the already-huge theme file.

---

## 7. Open Questions

- **SSR vs. planar reflector vs. both** for the near road — SSR is more general but has screen-edge artifacts; a planar reflector is flawless but flat-plane-only. Prototype both on the hero strip and compare cost/look.
- **Volumetric fog fidelity** — full ray-march (best, costly) vs. layered additive slabs (cheap, 90% of the look)? Lean cheap first, upgrade if budget allows.
- **LUT** — ship a baked `.cube`/`.png` (controllable, matches menu-AAA art direction) or grade procedurally in TSL?
- **HDR weight** — `shanghai_bund_2k.hdr` is 6.4 MB. Keep at 2k, downsample to 1k, or convert to a smaller compressed env? It's only needed for reflections, so a lower-res PMREM is fine.
- **WebGL parity** — push some heavy WebGPU-only wins (SSR, volumetric) into a deliberately simpler WebGL tier, or accept a clearly two-tier experience? (Recommend: accept the gap; WebGPU is the showcase.)
