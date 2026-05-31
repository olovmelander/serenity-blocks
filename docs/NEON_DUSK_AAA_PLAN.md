# Neon Dusk — AAA Visual Upgrade Plan

> **Goal**: Take Neon Dusk from "a really good synthwave background" to **the best-looking theme in the game** — a cinematic, atmospheric outrun vista with depth, volumetric light, and dense GPU-driven particle life that reacts musically to gameplay. Keep everything you already love (the banded sun, the purple valley, the scrolling tetromino grid) and build *around* it.

> **Status**: Planning. Nothing here is implemented yet. Phased so each phase ships independently and is reversible.

> **Scope note**: Neon Dusk runs a dual backend — WebGPU (TSL node materials + GPU compute + `NeonDuskPost`) and a WebGL2 fallback (`ShaderMaterial` + `EffectComposer`). Every proposal below specifies which path it touches. The headline visual gains target the WebGPU path; the WebGL path gets cheaper approximations so it never looks broken.

---

## TL;DR — The Five Moves That Matter Most

| # | Move | Why it transforms the theme | Cost |
|---|---|---|---|
| 1 | **Volumetric horizon & ground haze** | Right now mountains meet the grid at a hard seam. A glowing atmospheric band at the horizon + low ground fog is the single biggest "AAA vs. tech demo" upgrade — it gives the scene *air*. | Medium |
| 2 | **Three new GPU particle layers** (embers, drifting dust motes, sun-pollen) | The headline ask. Replaces the lone tiny "retro pixels" with a layered, depth-sorted particle ecosystem that fills the frame with parallax life. All on existing compute infra. | Medium |
| 3 | **Cinematic post: DOF + chromatic aberration + CRT + lens flare** | Synthwave *is* analog-artifact aesthetics. We have bloom/grain/vignette/god-rays already; adding depth-of-field, edge RGB-split, subtle scanlines, and an anamorphic sun flare pushes it from "clean" to "album cover." | Medium |
| 4 | **Living sky** (aurora bands, gradient banding, parallax cloud strata) | The sky is a static 3-colour vertex gradient. A subtle animated aurora + horizon cloud strata makes the upper half of the frame as interesting as the lower half. | Low–Medium |
| 5 | **Choreographed camera & reactive composition** | The camera does a gentle idle sway. Add event-driven dolly pushes, combo dolly-zoom, and depth-layered parallax so the *whole frame* breathes with the game. | Low |

These compound: haze + DOF + particles + flare together read as "rendered by a real engine," not "drawn with shaders."

---

## 1. Where Neon Dusk Stands Today (audit)

Read of the current implementation, so the plan builds on reality:

**Scene graph** ([neon-dusk-theme.js:888](../src/themes/neon-dusk/neon-dusk-theme.js#L888) `createScene`):
- Sky gradient — static vertex-coloured plane, 3 colours, no motion ([createSkyGradient:1043](../src/themes/neon-dusk/neon-dusk-theme.js#L1043))
- Starfield — point sprites, twinkle, GPU-compute twinkle on WebGPU, shooting-star pool, distance LOD ([createStarfield:1085](../src/themes/neon-dusk/neon-dusk-theme.js#L1085))
- Sun — 300-radius sphere with retro horizontal bands + fresnel, plus an additive glow plane ([createSun:1380](../src/themes/neon-dusk/neon-dusk-theme.js#L1380))
- Mountains — procedural FBM silhouettes, `BatchedMesh`, rim lighting + haze ([createMountains:1439](../src/themes/neon-dusk/neon-dusk-theme.js#L1439))
- Grid — perspective scroll, magenta lines + cyan glow, sun-path reflection, **SSR fresnel reflection on WebGPU**, ripple-wave on piece lock ([createGrid:1666](../src/themes/neon-dusk/neon-dusk-theme.js#L1666), material at [neon-dusk-materials.js:40](../src/themes/neon-dusk/neon-dusk-materials.js#L40))
- Grid highlights — tetromino-shaped cells spawned on piece lock, scroll toward camera, GPU compute ([spawnHighlightCell:2268](../src/themes/neon-dusk/neon-dusk-theme.js#L2268))
- Retro pixels — tiny floating squares (0.5–2px) + trails, drift up with sun attraction, GPU compute ([createRetroPixels:2876](../src/themes/neon-dusk/neon-dusk-theme.js#L2876))
- Burst particles — rising squares on piece lock ([createBurstParticleSystem:1908](../src/themes/neon-dusk/neon-dusk-theme.js#L1908))
- Hologram rings — expanding rings from the sun on line clears ([createHologramRing:2519](../src/themes/neon-dusk/neon-dusk-theme.js#L2519))

**Post** ([neon-dusk-post.js](../src/themes/neon-dusk/neon-dusk-post.js)): WebGPU = MRT emissive bloom + vignette + radial god-rays anchored to the sun + film grain + saturation. WebGL = `UnrealBloomPass` + vignette only.

**Strong foundations we will exploit:**
- A real GPU-compute particle framework already exists — `NeonDuskParticleCompute`, `NeonDuskPixelCompute`, `NeonDuskHighlightCompute`, `NeonDuskStarCompute` ([neon-dusk-compute.js](../src/themes/neon-dusk/neon-dusk-compute.js)). **Adding new particle layers is cheap** — clone the pixel-compute pattern.
- MRT emissive bloom is wired ([neon-dusk-post.js:39](../src/themes/neon-dusk/neon-dusk-post.js#L39)). Anything with an `emissiveNode` glows for free.
- Quality-preset + dynamic-resolution + GPU-timing infra is mature ([QUALITY_PRESETS:70](../src/themes/neon-dusk/neon-dusk-theme.js#L70)).

**The three highest-leverage gaps:**
1. **Dead code worth reviving / replacing.** `createAmbientParticles()` ([1842](../src/themes/neon-dusk/neon-dusk-theme.js#L1842)), `createNebulaClouds()` ([1315](../src/themes/neon-dusk/neon-dusk-theme.js#L1315)) and `updateNebulas()` ([3253](../src/themes/neon-dusk/neon-dusk-theme.js#L3253)) are **defined but never called** — `createScene` skips them, and their preset keys (`ambientParticles`, `nebulaCount`) don't exist in `QUALITY_PRESETS`. There's a whole atmosphere/particle layer the scene was clearly meant to have and never got. We either revive these or replace them with the GPU-compute versions below.
2. **No atmospheric depth between layers.** Mountains, grid, and sky are crisp and separate. No haze band, no DOF, no fog falloff tying them together — this is what reads as "flat."
3. **Bloom is conservative.** `High` = 0.2 strength, `Extreme` = 0.3 ([QUALITY_PRESETS:120](../src/themes/neon-dusk/neon-dusk-theme.js#L120)). Synthwave wants juicier, *tiered* glow (a tight core bloom + a wide soft bloom).

---

## 2. The Cinematic Vision

A traveller's-eye view across an endless neon desert at dusk. The sun hangs huge and banded behind a violet mountain valley; an anamorphic flare streaks off it. The chrome grid races toward you, its surface faintly mirroring the sky. The air is *thick* — a warm haze glows along the horizon, low fog drifts between the foreground peaks, and motes of light hang in the depth-of-field blur. Embers rise lazily; pollen-like sparks drift toward the sun. The upper sky shimmers with a faint aurora and slow cloud strata. Every line clear sends a shockwave ring across the haze and a dolly-push into the valley.

**Design rule:** the bottom half of the frame (grid) is already the star. This plan makes the **middle band** (horizon/sun/haze) and the **air itself** (particles/fog/DOF) earn their screen space, so the eye has somewhere to travel.

---

## 3. Phase Breakdown

### Phase 1 — Atmosphere & Depth *(biggest visual ROI, do first)*

**1a. Volumetric horizon haze band.** A wide additive gradient plane (or screen-space band in post) sitting just above the mountain seam, tinted from the sun palette (`sunBottom`→`skyMid`), pulsing subtly with `sunPulseIntensity`. Hides the hard mountain/grid seam and gives the sun atmosphere to sit in.
- *WebGPU & WebGL:* a single emissive plane behind the mountains, `AdditiveBlending`, soft vertical falloff. Cheap, universal.

**1b. Low ground fog.** Drifting fog slabs between the foreground mountains and over the near grid, so the grid appears to *emerge* from mist. Revive the intent of `createNebulaClouds()` but as 3–5 soft animated planes hugging `y≈0`, scrolling on X, tinted violet, very low opacity. Distance-fades into the haze band.

**1c. Real distance fog falloff.** Add `scene.fog` (exp²) or fold a fog term into the mountain/grid emissive so far geometry desaturates into the haze colour. Mountains already do a manual haze ([neon-dusk-materials.js:333](../src/themes/neon-dusk/neon-dusk-materials.js#L333)); unify it with the grid so the whole world shares one atmosphere.

**1d. Heat-haze shimmer around the sun.** A subtle screen-space UV warp in `NeonDuskPost` (sin-based, radial from `uSunScreen`) applied only near the sun, sells "radiating heat." WebGPU-only; WebGL skips.

**Outcome:** instant cohesion. The scene stops looking like stacked cardboard cutouts.

---

### Phase 2 — Particle Ecosystem *(the headline ask: "more particles in a cool way")*

Replace the single tiny retro-pixel layer with **three depth-stratified GPU particle systems**, each on the existing `NeonDuskPixelCompute` pattern (clone the class, swap the compute body). All emissive → all bloom for free. Each is depth-sorted into a parallax band so they read as volume, not confetti.

| Layer | Z band | Look | Motion | Count (Ultra) |
|---|---|---|---|---|
| **Drifting dust motes** | far (-200…-600) | soft round, dim cyan/white, DOF-blurred | very slow lateral drift, no gravity | 1500 |
| **Rising embers** | mid (-50…-250) | warm orange/pink, soft, glowing | rise + curl noise + slight sun-pull | 800 |
| **Sun-pollen sparks** | near (50…-100) | bright magenta/cyan specks + trails (reuse existing trail material) | drift up, accelerate toward sun, twinkle | 600 |

Implementation notes:
- **Reuse `NeonDuskPixelCompute`** ([neon-dusk-compute.js:155](../src/themes/neon-dusk/neon-dusk-compute.js#L155)) — it already does sun-attraction + drag + wrap. Add a `curlNoise` term (cheap `mx_noise_float`/sin-based curl in TSL) for the embers so motion isn't linear.
- **Depth-of-field interplay:** the far dust band should sit *outside* the DOF focus plane (Phase 3) so it's softly blurred — this is what makes particles feel atmospheric rather than stuck to the lens.
- **Size by depth, not uniform.** Current retro pixels are uniformly tiny ([createRetroPixels:2932](../src/themes/neon-dusk/neon-dusk-theme.js#L2932)). Vary base size per layer and let near particles be larger/brighter.
- **WebGL fallback:** keep one consolidated CPU-updated `Points` cloud (the current retro-pixel path already works on WebGL) at reduced counts; skip the third layer on Low/Minimal.
- **Quality scaling:** add `dustCount`, `emberCount`, `pollenCount` to `QUALITY_PRESETS`; gate the whole ecosystem off on `Minimal`, dust-only on `Low`.

**Reactive bursts (build on what exists):**
- Line clear → inject an outward velocity impulse into the ember field near the clear's X (turbulence injection, not just spawning new sprites).
- Combo → raise `colorShift`/twinkle on pollen (already plumbed via `effectState.colorShift`) and briefly boost emission rate.
- Tetris → a one-shot radial spark fountain from the horizon (reuse `createBurstParticleSystem`).

**Outcome:** the frame is alive with parallax light at every depth, and the particles *belong* to the world (sun-lit, fogged, DOF-blurred) instead of floating on top.

---

### Phase 3 — Cinematic Post-Processing & Color Grade

We already have bloom + vignette + god-rays + grain + saturation in `NeonDuskPost`. Add the analog-film layer that defines the genre, composed in TSL after the existing stack:

**3a. Depth-of-field (bokeh).** Focus plane on the sun/horizon, near foreground particles and far dust softly defocused. WebGPU has the depth texture already exposed in `NeonDuskPost` (`scenePass.getTextureNode('depth')`, [neon-dusk-post.js:87](../src/themes/neon-dusk/neon-dusk-post.js#L87)) — a circle-of-confusion blur keyed off linear depth is a natural add. Single biggest "cinematic" multiplier.

**3b. Edge chromatic aberration.** Radial RGB-split that ramps from 0 at center to a few px at the corners (lens-edge dispersion). Maxime Heckel's vaporwave reference uses a flat `RGBShift` of 0.0015; ours should be *radial* so the center stays crisp. Modulate amount with `vhsIntensity`/`colorShift` so combos visibly distort.

**3c. CRT/scanline pass (subtle).** Faint horizontal scanlines (≤5% opacity) + very slight barrel distortion + corner darkening. The original code had a `VHSShader` that's currently commented out ([neon-dusk-theme.js:2072](../src/themes/neon-dusk/neon-dusk-theme.js#L2072)) — reintroduce a tamed version in the node graph. Keep it tasteful; this is seasoning, not the meal.

**3d. Anamorphic sun flare.** A horizontal streak + chromatic halo anchored to `uSunScreen` (already computed every frame, [neon-dusk-theme.js:2704](../src/themes/neon-dusk/neon-dusk-theme.js#L2704)). Brightens with `sunPulseIntensity`. This is the shot that makes screenshots pop.

**3e. Tiered bloom + LUT grade.** Split bloom into a tight high-threshold core glow and a wide low-threshold soft bloom for that "neon bleeding into the dark" look; raise the strengths from today's conservative 0.2–0.3. Finish with a filmic LUT (teal-shadows / magenta-highlights) for a consistent graded palette instead of per-material saturation only.

**WebGL fallback:** add cheap `ShaderPass` versions of chromatic aberration + scanlines to the `EffectComposer` chain; skip DOF + anamorphic flare (or use a static radial flare sprite on the sun).

---

### Phase 4 — Hero-Element Polish

**4a. Sun.** Add a slow heat-shimmer to the bands, a soft corona ring, and have the banded gaps glow rather than go transparent. Optionally a second, larger, very-dim glow disk for atmosphere bleed.

**4b. Chrome grid.** Push the existing WebGPU SSR ([neon-dusk-materials.js:105](../src/themes/neon-dusk/neon-dusk-materials.js#L105)) toward a wet-chrome floor: stronger sky/sun reflection in the reflection path, a faint moving specular streak under the sun, and subtle per-cell emissive flicker so the grid feels electrified, not printed. WebGL gets a stronger baked sun-reflection gradient.

**4c. Mountains.** Add a thin animated neon ridge-line highlight that catches the sun (a bright fresnel-rim crest), and snow/scanline texture in the rim band for detail at the silhouette edge.

**4d. Sky strata.** Two or three very slow horizontal cloud/aurora bands high in the sky (additive, drifting opposite directions), plus subtle gradient banding (intentional 8-bit-style steps) for retro authenticity. Revives the *intent* of the unused nebula code as a tasteful upper-sky layer.

---

### Phase 5 — Composition & Camera Choreography

**5a. Reactive camera.** Extend `updateCamera` ([2668](../src/themes/neon-dusk/neon-dusk-theme.js#L2668)) with an event-driven offset channel:
- Line clear → short dolly-push toward the valley, then ease back.
- Tetris → bigger push + brief FOV widen (subtle dolly-zoom).
- Combo ≥7 → slow saturation ramp (drive the LUT mix) + tighter bloom.
- Idle → keep the current gentle sway as the resting state.

**5b. Parallax depth separation.** Stars already parallax ([updateStars:3264](../src/themes/neon-dusk/neon-dusk-theme.js#L3264)); extend the same camera-offset parallax to the new haze band, cloud strata, and dust layer at graduated strengths so mouse movement and camera sway reveal real depth.

**5c. Foreground framing.** A couple of dark, near, out-of-focus silhouette elements at the bottom corners (e.g. a wireframe palm or chrome pillar) to frame the vista and give the DOF something to blur in front. Optional, very subtle.

---

## 4. Performance Budget & Safety

- Everything new is **emissive + additive + GPU-compute** → cost is bandwidth/fill, not draw calls. Particle counts scale per quality tier; the existing dynamic-resolution + slow-frame guard ([updateDynamicResolution:701](../src/themes/neon-dusk/neon-dusk-theme.js#L701)) already protects against overruns.
- New post passes are the main GPU cost. DOF + chromatic aberration + CRT should be **fused into one fragment pass** in `NeonDuskPost`, not stacked separately, to stay within one full-screen read.
- Gate aggressively: `Minimal`/`Low` skip DOF, anamorphic flare, heat-haze, and the third particle layer. Use the existing `neonDuskNoPost` / `neonDuskNoRays` debug flags pattern for new toggles (`neonDuskNoDOF`, `neonDuskNoFog`) so it stays debuggable.
- Target unchanged: stable 60 FPS on the `High` preset, 120 where the panel allows. Validate with the existing baseline logger (`?neonDuskBaseline=1`).

---

## 5. Suggested Implementation Order (each independently shippable)

1. **Phase 1a + 1b** (haze band + ground fog) — highest ROI, low risk, instantly more cinematic.
2. **Phase 2** (particle ecosystem) — the headline ask; lands on existing compute infra.
3. **Phase 3a + 3b** (DOF + radial chromatic aberration) — turns "clean" into "cinematic."
4. **Phase 4a + 4b** (sun flare/corona + chrome grid) — the screenshot money shots.
5. **Phase 5a** (reactive camera) — ties visuals to game feel.
6. **Phase 3c–e, 4c–d, 5b–c** — polish passes once the core lands.

---

## 6. File-by-File Touch List

- [neon-dusk-theme.js](../src/themes/neon-dusk/neon-dusk-theme.js) — wire new layers into `createScene`/`animate`/`stop`; add reactive camera + event hooks; new `QUALITY_PRESETS` keys.
- [neon-dusk-materials.js](../src/themes/neon-dusk/neon-dusk-materials.js) — haze-band, ground-fog, cloud-strata, sun-flare materials; chrome-grid reflection boost.
- [neon-dusk-compute.js](../src/themes/neon-dusk/neon-dusk-compute.js) — `NeonDuskDustCompute` / `NeonDuskEmberCompute` (clone of `NeonDuskPixelCompute` + curl-noise term).
- [neon-dusk-post.js](../src/themes/neon-dusk/neon-dusk-post.js) — DOF, radial chromatic aberration, CRT/scanline, anamorphic flare, heat-haze, tiered bloom, LUT — fused into the existing output node.
- [neon-dusk-shaders.js](../src/themes/neon-dusk/neon-dusk-shaders.js) — WebGL fallbacks for haze/fog/chromatic-aberration/scanline passes; un-comment + tame `VHSShader`.

---

## 7. Open Questions

- LUT grade: ship a baked `.png` LUT (more controllable, matches the menu-AAA art direction) or do it procedurally in TSL?
- Foreground framing elements (5c): worth the art cost, or keep the vista clean and unobstructed?
- Do we want the heavier WebGPU-only effects (DOF, GI-style bounce) to *also* nudge the WebGL path, or accept a deliberately simpler WebGL tier?
