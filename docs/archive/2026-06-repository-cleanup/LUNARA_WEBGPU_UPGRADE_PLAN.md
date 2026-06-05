# Lunara WEBGPU Upgrade Plan — Twin-Moon Crystal Planet

**Theme ID:** `lunara`
**Group:** `cosmic`
**Status:** Active rework (in progress)
**Owner:** olovmelander
**Date:** 2026-05-02

---

## 1. Vision

Transform the existing DOM/CSS-driven Lunara theme into a cinematic WebGPU AAA-quality scene depicting the surface of a distant purple alien planet at night, dominated by **two close, radiant moons** — a large violet primary and a smaller red/pink companion — looming over a layered crystal-spire landscape.

Reference image: a deep-violet sky filled with stars and nebular dust, two large moons hanging low on the horizon, a glowing purple crystalline foreground with bioluminescent flora, soft volumetric haze, and rich parallax depth.

The new Lunara should feel:

- **Mysterious & immersive** — quiet, contemplative, awe-inspiring.
- **Cinematic** — physically grounded lighting, soft bloom, atmospheric perspective, layered composition.
- **Alive** — bioluminescence, slow drifting fog, twinkling stars, subtle magical motes.
- **Polished** — antialiased silhouettes, properly tone-mapped color, no flat 2D silhouettes.

It must remain identifiably *Lunara* (twin moons, purple palette, peaceful mood), but evolve from a flat CSS+canvas composite into a real 3D WebGPU world.

---

## 2. Audit of Current Implementation

### 2.1 File inventory
- `src/themes/lunara/lunara-theme.js` — single 1300-line CSS/DOM theme.
- `src/themes/lunara/lunara-tetrominos.js` — gameplay piece colors (KEEP).
- `src/themes/lunara/lunara-theme-icon.png` — icon (KEEP).
- DOM shell: `index.html` lines 381-393 (`#lunara-sky`, `#lunara-stars`, `#lunara-aurora`, `#lunara-planets`, `#lunara-mountains-distant`, `#lunara-mountains-mid`, `#lunara-forest-left/right`, `#lunara-snowfield`, `#lunara-fog`, `#lunara-grain`).
- CSS: `public/styles/main.css` lines 16791-17260+.

### 2.2 Current rendering pipeline
- **Sky** — single CSS linear-gradient.
- **Stars** — DOM `<div>` elements with CSS twinkle keyframes, ~60-220 elements.
- **Aurora** — currently `display: none` in CSS (disabled). Internal logic still creates DOM.
- **Planets** — single rasterized 2D canvas (`canvas.toDataURL`) baked once and used as a background image. Two flat radial-gradient discs.
- **Mountains** — two procedural canvas silhouettes (3000×600 / 3000×700) baked into background images.
- **Forests** — pure CSS triangles (`border-bottom`) acting as conifer silhouettes.
- **Snowfield / fog** — CSS gradient overlays.
- **Snow** — DOM `<div>`s with linear `lunara-snowfall` animation, 0-130 flakes.
- **Grain** — SVG noise texture overlay.
- **Combo / lock effects** — DOM `<div>` bursts plus optional `webglRenderer.addCustomParticles()` for planet ring debris.

### 2.3 Visual limitations
1. **No real depth.** Mountains and forests are flat silhouettes; no parallax beyond fixed-speed background scroll.
2. **No physical lighting.** All colors are baked. The "moons" cast no light on the world.
3. **No volumetric haze.** Fog is a CSS gradient — no falloff with distance, no scattering.
4. **No reflections / refractions.** The reference image is dominated by glassy crystal spires; current theme has none.
5. **No bioluminescence.** No glowing flora, fungi, or motes.
6. **Wrong palette in places.** Foreground is dark-pink/purple snow; reference asks for violet crystal terrain with cyan/magenta highlights.
7. **DOM costs.** 200+ stars + 100+ snowflakes as DOM elements thrash layout/composite each frame.
8. **No bloom.** Glows are achieved via large `box-shadow` blur — slow, low-quality.
9. **Identifiably 2D.** The composite reads as a parallax matte painting rather than a rendered world.

### 2.4 What we keep
- Twin-moon identity (one large purple, one smaller red/pink).
- Purple/violet palette dominance with accent cyan/magenta.
- Peaceful mood (no aggressive motion).
- Public combo / line-clear / lock event hooks (`EVENTS.LINE_CLEAR`, `EVENTS.COMBO`, `EVENTS.PIECE_LOCK`).
- DOM shell IDs (so `index.html` stays unchanged) — but most child elements collapse into a single `<canvas>` mounted into `#lunara-theme`.
- `LUNARA_TETROMINOS` config (gameplay piece visuals).

---

## 3. Target Architecture

Follow the established WebGPU pattern used by `moonlit-forest`, `ice-temple`, `ocean`, `black-hole`, `synthwave-sunset`:

```
src/themes/lunara/
├── lunara-theme.js          # Orchestrator: renderer, scene, animation loop, events
├── lunara-materials.js      # TSL node materials (WebGPU) + GLSL fallbacks (WebGL)
├── lunara-compute.js        # Optional GPU compute (mote/particle drift)
├── lunara-post.js           # PostProcessing: bloom + soft vignette + tone curve
├── lunara-tetrominos.js     # (UNCHANGED)
├── lunara-theme-icon.png    # (UNCHANGED)
```

### 3.1 Backend selection
- Try `WEBGPU.WebGPURenderer({ antialias, powerPreference: 'high-performance', alpha: false })` then `await renderer.init()`.
- If `renderer.backend?.isWebGPUBackend !== true`, fall back to `THREE.WebGLRenderer`.
- Honor `?forceWebGL=1` query flag for QA.
- Tone mapping: `THREE.ACESFilmicToneMapping`, exposure ~1.0.
- Output color space: `THREE.SRGBColorSpace`.

### 3.2 Scene graph
- `THREE.Scene` with `FogExp2(0x1a0a2a, ~0.0015)`.
- `THREE.PerspectiveCamera(55°, aspect, 0.1, 4000)` placed at `(0, 8, 30)` looking slightly down toward `(0, 4, -200)`.
- Subtle camera breathing: tiny low-frequency Perlin offsets on x/y so the world feels alive without parallax sickness.

### 3.3 Visual layers (back → front)
1. **Sky dome** — large inverted sphere (`SphereGeometry(2400)`, `BackSide`). Vertical gradient deep-violet → violet-magenta → near-black with subtle nebula bands.
2. **Starfield** — `Points` cloud, ~1500-2500 stars, colored with rare pink/cyan accent stars, gentle per-star twinkle, additive blending.
3. **Galactic dust band** — wide rectangular mesh on the sky dome with TSL noise creating the diagonal nebula streak from the reference image.
4. **Primary moon** — large violet sphere ~radius 24 placed at `(-22, 26, -180)`, soft swirl bands, halo billboard sprite for atmospheric glow.
5. **Companion moon** — smaller red/pink sphere ~radius 12 placed at `(8, 22, -160)`, with crescent shading and pink halo billboard.
6. **Distant mountain ridge** — single low-poly silhouette mesh (~50-segment plane bent into ridge profile) ~Z=-220, dark lavender, atmospheric fade.
7. **Mid mountain ridge** — second silhouette ~Z=-140, slightly lighter, more defined.
8. **Crystal spire field** — instanced mesh of jagged crystal prisms, ~80-150 instances, mid-distance + foreground. Translucent purple TSL material with internal refraction-like fake (sample sky-color tinted by depth into the prism).
9. **Foreground crystal cluster** — handful of large hero crystals near camera, slightly chromatic, catching moonlight on edges.
10. **Bioluminescent flora** — tiny instanced "bloom" sprites scattered at ground level: cyan cores + magenta tips, pulsing slowly.
11. **Floating motes / pollen** — GPU compute particle system (~3000-8000 motes at Ultra/Extreme) drifting vertically with horizontal wobble.
12. **Volumetric haze** — multiple large transparent quads ("fog cards") at varying Z, additive, scrolling noise texture, simulating valley fog.
13. **Ground plane** — wide dark-violet plane with TSL noise + emissive cracks (faintly glowing veins). FogExp2 takes over near the back to fade into mountains.

### 3.4 Lighting model
Even though most materials use unlit/emissive node materials for performance and stylization, we add:
- `THREE.AmbientLight(0x4030a0, 0.45)` — overall violet wash.
- `THREE.DirectionalLight(0xc080ff, 0.7)` from the primary moon direction — primary cool moonlight.
- `THREE.DirectionalLight(0xff7090, 0.35)` from the companion moon direction — pink rim light.
- `THREE.HemisphereLight(0x6040a0, 0x1a0a2e, 0.25)` — soft sky/ground tint.

Crystals and the ground use `MeshStandardNodeMaterial` (WebGPU) / `MeshStandardMaterial` (WebGL) so they receive these directional lights and produce the colored rim catch from the moons.

### 3.5 Post-processing (`lunara-post.js`)
- WebGPU path: `THREE.PostProcessing` with `BloomNode` driven by `pass(scene, camera).getTextureNode('emissive')` when MRT is supported, otherwise the regular output.
- Optional cheap vignette node multiplied into the final output.
- Tone curve: gentle filmic lift on shadows, slight desaturation in deep blacks to keep the violets readable.
- WebGL fallback: `EffectComposer` with `RenderPass` + `UnrealBloomPass(strength≈0.55, radius≈0.32, threshold≈0.42)`.

### 3.6 GPU compute (`lunara-compute.js`) — WebGPU only
- One compute kernel for floating motes:
  - vec4 positions storage
  - vec4 velocities (gentle upward drift, sinusoidal wobble)
  - per-particle random seed
  - respawn at the bottom when out of vertical bounds
- Falls back to a CPU-driven `BufferGeometry.attributes.position.needsUpdate` path on WebGL with reduced count.

### 3.7 Materials (`lunara-materials.js`)

| Material | WebGPU Node | WebGL fallback | Bloom MRT? |
|---|---|---|---|
| Sky dome | `MeshBasicNodeMaterial` w/ TSL gradient + nebula noise | `ShaderMaterial` | no |
| Starfield | `PointsNodeMaterial` (sizeNode + twinkle) | `PointsMaterial` w/ shader | yes |
| Moon (primary) | `MeshBasicNodeMaterial` w/ TSL bands + emissive | `ShaderMaterial` | yes |
| Moon halo | `MeshBasicNodeMaterial` additive billboard | `ShaderMaterial` additive | yes |
| Mountain ridge | `MeshBasicNodeMaterial` w/ depth tint | `MeshBasicMaterial` | no |
| Crystal spire | `MeshStandardNodeMaterial` (transmission-like fake), emissive edges | `MeshStandardMaterial` w/ emissive | yes (edges only) |
| Bioluminescent flora | `SpriteNodeMaterial` additive, animated alpha | `SpriteMaterial` additive | yes |
| Floating motes | `PointsNodeMaterial` w/ compute storage | `PointsMaterial` | yes |
| Fog card | `MeshBasicNodeMaterial` additive w/ scrolling noise | `ShaderMaterial` | no |
| Ground | `MeshStandardNodeMaterial` w/ TSL noise cracks | `MeshStandardMaterial` w/ emissive | partial |

All bloom-emitting materials set `material.emissiveNode` (WebGPU) or `material.userData.emitsBloom = true` (WebGL) so the post pass can pick them up.

### 3.8 Quality presets

```
Minimal:  starCount: 600,  motes: 0,    crystalCount: 30,  flora: 0,   bloomDownsample: 0.45
Low:      starCount: 1000, motes: 1500, crystalCount: 50,  flora: 30,  bloomDownsample: 0.55
Medium:   starCount: 1500, motes: 2800, crystalCount: 80,  flora: 60,  bloomDownsample: 0.65
High:     starCount: 2000, motes: 4500, crystalCount: 110, flora: 100, bloomDownsample: 0.75
Ultra:    starCount: 2400, motes: 6500, crystalCount: 140, flora: 140, bloomDownsample: 0.85
Extreme:  starCount: 2800, motes: 8500, crystalCount: 170, flora: 180, bloomDownsample: 1.0
```

Effect quality is read from `window.settings.effectQuality` and re-applied on `settingsChanged`.

---

## 4. Reactive Game Effects

Preserve the existing `eventBus` integration and elevate combo/line-clear/lock visuals:

- `PIECE_LOCK` → small sparkle burst on a random nearby crystal + brief moon halo pulse.
- `LINE_CLEAR` → ripple ring originating between the two moons; secondary aurora-curtain glow band that fades over ~1.2s.
- `COMBO` (≥3) → companion-moon flare + brief saturation/exposure pop in post (clamped); for combos ≥6 a shooting star streak across the sky.
- `LINE_CLEAR.lineCount === 4` (Tetris) → screen-wide bioluminescent shockwave through the flora field.

All effects run on dedicated short-lived TSL node materials or transient sprites; they auto-dispose with timeouts registered via the existing `BaseTheme.registerTimeout()`.

---

## 5. Performance & Stability

- Target 60+ FPS on WebGL2 mid-tier and 120 FPS on WebGPU.
- Target draw-call budget: ≤ 90 (Ultra), ≤ 130 (Extreme).
- All transient materials reuse pooled geometries/material instances.
- `BaseTheme.releaseManagedGpuResources()` honored: theme tagged `resourceProfile = 'heavy-gpu'` so it disposes scene, post, compute on `releaseInactiveResources()`.
- WebGPU device-loss → switch to WebGL fallback path automatically (mirror the moonlit-forest pattern).
- WebGL context loss → rebuild scene through `EVENTS.CONTEXT_RESTORED` hook.

---

## 6. Phased Implementation

### Phase 1 — Skeleton (this PR)
- New files `lunara-materials.js`, `lunara-compute.js`, `lunara-post.js`.
- Rewrite `lunara-theme.js`:
  - `BaseTheme.start()` → `initRenderer(container)` → `createScene()` → `animate()`.
  - Render: sky dome, starfield, twin moons + halos, two mountain ridges, instanced crystal spires, ground, FogExp2, lights, ACES tone mapping, bloom.
  - Old DOM children inside `#lunara-theme` (`#lunara-sky`, etc.) hidden via inline style or removed (they remain in `index.html` to keep the DOM contract — we just stop updating them).
- Tetromino config import path unchanged.
- CSS additions: a single rule to ensure `#lunara-theme > div` legacy children are hidden by default and the new `<canvas>` fills the container.
- Wire `eventBus` for piece-lock halo pulse, line-clear ripple, combo flare.

### Phase 2 — Polish
- Bioluminescent flora sprites + slow pulse.
- GPU compute motes (WebGPU) + WebGL fallback.
- Volumetric fog cards with scrolling noise.
- Galactic dust nebula band on the sky dome.
- Foreground hero crystals.

### Phase 3 — Reactive flourishes
- Screen-wide bioluminescent shockwave on Tetris.
- Shooting stars (3D, not DOM).
- Adaptive bloom intensity reacting to combo energy.

### Phase 4 — QA
- Manual sweep across quality presets in DevTools.
- Verify WebGL fallback path (`?forceWebGL=1`).
- Verify cleanup: switch theme, reload, ensure no leaked canvases or animation IDs.
- Visual regression vs. reference image (planet placement, palette, depth).

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| WebGPU node materials not available on user's three.js version | Verified `three/webgpu` and `three/tsl` already used by ice-temple, moonlit-forest, ocean — same import surface. |
| Refractive crystal materials drop frame rate on integrated GPUs | Use a fake-transmission TSL node (sample sky color + Fresnel) — no real `transmission` channel, no extra render target. |
| Compute path breaks on older WebGPU drivers | Conditional behind `capabilities.compute === true`; CPU buffer attribute fallback. |
| MRT bloom adds extra render targets | Mirror moonlit-forest: bloom from `getTextureNode('emissive')` only when `maxColorAttachments > 1`. Otherwise bloom over scene output. |
| DOM children of `#lunara-theme` re-appearing during reflow | Hide them via `display: none` in the CSS rule for `#lunara-theme > div:not(canvas)` once new path is active. |
| Visual change is jarring for existing players | Theme retains identity (twin moons, violet palette). No theme ID change. |

---

## 8. Acceptance Criteria

A reviewer should be able to load the theme and verify visually:

1. Two prominent moons in the upper sky — one large violet, one smaller red/pink.
2. Moons cast colored rim light onto crystals and ground.
3. A starfield with subtle twinkle and a faint diagonal nebula band.
4. Crystal spires fill the foreground/midground with depth and parallax silhouette.
5. Distant mountains fade into atmospheric haze.
6. Bioluminescent specks glow softly through the scene.
7. Soft volumetric haze sits in valleys and around moons.
8. Combo / line clear effects trigger non-jarring lighting flourishes.
9. Frame rate is stable on WebGL2 (≥ 50 fps) and WebGPU (≥ 90 fps) at High preset on a recent laptop GPU.
10. Switching themes away then back disposes all GPU resources (no growing memory across hot-swaps).

---

## 9. Visual Reference — No Man's Sky & Outer Wilds

Art-direction lessons applied to Lunara revision 2 (post-screenshot iteration):

### 9.1 Moon framing (No Man's Sky)
- One moon **dominates** the composition (25-40% of vertical FOV); the second is jewelry, not symmetrical pairing.
- Disc body is **desaturated**; the saturated chroma lives in the *atmospheric rim* and a tight halo (1.2-1.6× disc radius), never in the disc center.
- Soft Rayleigh-style limb glow: a 1-3% darkening just inside the silhouette, then a thin rim *brighter* than the disc center.
- Halo is short and density-graded — not a bloom blowout.

### 9.2 Sky gradient (NMS GDC 2015 — Grant Duncan's complementary rule)
- **Three stops:** zenith (deep cool, near-black violet) → mid (saturated dominant hue) → horizon (warm complementary accent, e.g. rose/coral/amber thread).
- Even on a purple world, the horizon is *warm* — pure violet everywhere is the monotone failure mode.
- Anti-monotone trick: keep dominant hue but shift **value and temperature** across the dome, not hue.

### 9.3 Nebulae (Outer Wilds — Mobius Digital atmosphere talks)
- **Off-axis and cropped** — never centered, lets it exit the frame.
- Sample noise on **view direction or spherical UV**, not 3D worldspace plane (the plane-wave artifact in revision 1).
- Very low contrast (~15-25% additive over base sky); reads atmospheric, not painted.
- Star density tapers — denser near the galactic band, sparser at zenith.

### 9.4 Bioluminescence (NMS exotic biome flora)
- **Shaped emissive surfaces** beat blanket additive sprites — leaf edges, vein patterns, fruit pods.
- **Complementary hue** to the world: violet world → cyan/mint/chartreuse flora, never same-hue glow.
- Sparse hero plants, low-frequency pulse (~0.3-0.6 Hz), low amplitude.

### 9.5 Atmospheric haze (Outer Wilds Rayleigh+Mie)
- Distance haze does 80% of the "alien moon" mood — exponential height fog tinted toward horizon color.
- **Three depth layers minimum** (foreground silhouette → mid haze → far silhouette → sky) for scale.
- Tint haze slightly **warmer** than the sky to separate foreground from background.

### 9.6 Color discipline
- Duncan's "60-30-10 chroma" rule: reserve maximum saturation for tiny areas (moon halo, hero glows, horizon line). Big surfaces (sky body, terrain, spires) stay desaturated.
- **Value range > hue range.** Outer Wilds clips zenith near-black; this gives the bioluminescence somewhere to glow against.

### 9.7 Tone mapping & bloom (both games)
- **Restrained bloom.** Outer Wilds uses tight, low-threshold, low-intensity bloom. Aim threshold ≥ 1.0 in linear, intensity 0.3-0.5, small radius.
- ACES (already on) — Reinhard washes purples to gray.
- Gate bloom on **emissive intensity**, not luminance — only stars and bioluminescence should bloom.

### 9.8 Revision-2 corrections applied
| Symptom in screenshot | Fix |
|---|---|
| Diagonal sky stripes | Replace plane-wave `sin(dot(dir, axis))` nebula with multi-rotation product noise |
| Tiny, washed-out white moons | 1.7× radius, drop emissive 0.55→0.10, push surface contrast, add bright Rayleigh rim |
| Halo dominates the moons | Halo scale 4.2×→1.8×, lower opacity, sharper power curve |
| Monotone purple sky | 3-stop gradient with warm rose horizon scatter |
| Bloom blowout | Strength preset 0.55→0.35, threshold 0.32→0.55, exposure 1.05→0.92 |
| Pink flora blends with sky | Flora hue shifts to cyan/mint (complementary) |
| Flat cardboard crystals | Higher poly, emissive concentrated at tips via height factor + tighter fresnel |

## 10. Out of Scope

- Modifying `LUNARA_TETROMINOS` colors (gameplay-tuned).
- Replacing the theme icon.
- Audio / sound design.
- Multiplayer-specific Lunara visuals (handled by FFA effects layer).
- Generating a baseline performance protocol in the same depth as moonlit-forest/ice-temple — lunara is a lighter scene and uses `BaseTheme` defaults plus a single quality preset switch.
