# Electric Dreams V2 — Ferrofluid Refactor Plan

> **Goal**: Rebuild Electric Dreams from the ground up as a **best-in-class WebGPU theme** — the most vibrant, visually stunning scene in the game. Target: **120 FPS desktop with headroom**, ferrofluid lava-lamp 2.0 art direction, intentional cinematic composition.

> **Status**: Supersedes [ELECTRIC_DREAMS_WEBGPU_UPGRADE_PLAN.md](ELECTRIC_DREAMS_WEBGPU_UPGRADE_PLAN.md) (v1). V1 successfully landed the WebGPU rails but ended up architecturally sprawled (10,159 LOC across 8 files, with a 6,823-line monolith) and visually flat — see screenshot reference: blobs read as dull disconnected balls, particles look like sparse dust, no intentional composition, GPU compute exists but is disabled across all presets, MRT bloom disabled "until WebGPU path is stable on Windows ANGLE" ([electric-dreams-theme.js:755](../src/themes/electric-dreams/electric-dreams-theme.js#L755)). This plan does not patch v1 — it replaces it.

---

## 1. North Star Vision

A **dreamy, tactile, hypnotic** scene where one massive metaball orb dominates the center, smaller satellite orbs orbit at depth, the whole composition floats inside what feels like a glass aquarium lit from within by something alive. The blobs are not separate spheres — they *gloop and merge* into each other as they pass, with iridescent inner caustics scattering light through their volume. The viewer should feel they're looking *into* something, not *at* it.

**Mood reference**:
- The opening of *Ex Machina* (sealed glass containment, internal glow)
- *Blade Runner 2049* fog volumes pierced by god rays
- Macro footage of ferrofluid spikes responding to magnets
- A bioluminescent aquarium at night

**Non-goals**: We are NOT building a generic Tetris background. Every visual element earns its frame budget by either (a) reinforcing the hero composition or (b) responding to gameplay.

---

## 2. Reference Inspiration & Technical Anchors

| Reference | What we steal | Source |
|---|---|---|
| Codrops liquid raymarching tutorial | SDF metaball smin blending, fixed-iteration raymarch loop, TSL `Fn`/`Loop`/`toVar` patterns | [tympanus.net](https://tympanus.net/codrops/2024/07/15/how-to-create-a-liquid-raymarching-scene-using-three-js-shading-language/) |
| three.js `webgpu_postprocessing_bloom_emissive` | MRT-driven selective bloom on `emissive` channel — solves the v1 "flat colors despite bloom" problem | [threejs.org](https://threejs.org/examples/webgpu_postprocessing_bloom_emissive.html) |
| Maxime Heckel — Field Guide to TSL & WebGPU | Compute dispatch sizing (`[64,1,1]`), storage-buffer particle update pattern, varying-based normal recomputation for deformed geometry | [blog.maximeheckel.com](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/) |
| Codrops "False Earth" | Compute-shader-driven mass particle physics with millions of elements | [tympanus.net/codrops/tag/webgpu](https://tympanus.net/codrops/tag/webgpu/) |
| Codrops "Procedural Vortex in Glass Sphere" | Refractive glass foreground overlay technique | [tympanus.net/codrops/tag/webgpu](https://tympanus.net/codrops/tag/webgpu/) |
| `discourse.threejs.org` volumetric lighting WebGPU thread | Half-resolution offscreen pass + composite for expensive raymarched volumes | [discourse.threejs.org](https://discourse.threejs.org/t/volumetric-lighting-in-webgpu/87959) |
| THREE.Fire (TSL volumetric fire) | TSL implementation reference for volumetric absorption pattern | [github.com/typeWolffo/THREE.Fire](https://github.com/typeWolffo/THREE.Fire) |
| `awwwards.com` Samsy cyberpunk WebGPU | Compositional benchmark: 120+ FPS WebGPU portfolio that proves the target is achievable | [awwwards.com](https://www.awwwards.com/sites/cyberpunk-interactive-3d-desk) |

---

## 3. Intentional Scene Composition

V1's problem is that there is no composition — just 16 floating balls and some sparks distributed randomly. V2 enforces a deliberate **3-act depth structure**:

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 0 — NEBULA SKY (deepest)                             │
│    slow-drifting volumetric noise gradient                  │
│    deep indigo → violet → teal, ~10s loop                   │
│    barely moves: parallax anchor                            │
│ ─────────────────────────────────────────────────────────── │
│  LAYER 1 — BOKEH DUST (far)                                 │
│    ~6000 compute-driven particles, depth-blurred            │
│    very slow drift, no game reactivity                      │
│    creates parallax depth cue                               │
│ ─────────────────────────────────────────────────────────── │
│  LAYER 2 — SATELLITE BLOBS (mid)                            │
│    4–6 instanced surface-shaded orbs, ~2-3u scale           │
│    orbit on lissajous paths around hero, soft IK            │
│    react to combos with color shift + radial drift          │
│ ─────────────────────────────────────────────────────────── │
│  LAYER 3 — HERO RAYMARCHED VOLUME (center)                  │
│    ★ THE CENTERPIECE                                        │
│    Half-res offscreen raymarch (1280×720 → composite)       │
│    3 internal metaballs combined with smin (k=0.6–1.2)      │
│    Iridescent subsurface scattering (3-color gradient)      │
│    Internal turbulent caustics (FBM domain warp)            │
│    Slow morph, fast pulse on line clear                     │
│ ─────────────────────────────────────────────────────────── │
│  LAYER 4 — GOD RAYS (volumetric)                            │
│    Screen-space radial scattering anchored on hero          │
│    16 samples, masked by emissive MRT                       │
│    Intensity ramps with combo level                         │
│ ─────────────────────────────────────────────────────────── │
│  LAYER 5 — FOREGROUND SPARKS (near)                         │
│    ~2000 compute-driven embers, motion-blurred              │
│    Reactive: burst on line clear, drift on idle             │
│    Optional micro-glints (instanced quads, 200)             │
│ ─────────────────────────────────────────────────────────── │
│  LAYER 6 — GLASS AQUARIUM OVERLAY (foreground)              │
│    Subtle barrel-distorted vignette                         │
│    Edge chromatic refraction (mimics curved glass)          │
│    Faint CRT scanline at 5% opacity                         │
│ ─────────────────────────────────────────────────────────── │
│  LAYER 7 — POST STACK                                       │
│    MRT selective bloom (emissive channel only)              │
│    Lens dirt overlay (Ultra+)                               │
│    Chromatic aberration (radial, 0.004u peak)               │
│    ACES tonemap + film grain                                │
└─────────────────────────────────────────────────────────────┘
```

**Focal point math**: hero blob centered at world origin, camera at (0, 0.5, 12), 35° FOV, slow figure-8 dolly (±0.4u over 18s) to keep the composition breathing without disorienting the player.

**Color palette (locked to harmony)**:
- Hero blob iridescence ramp: `#1a0b40` (deep purple) → `#d946ef` (vibrant magenta) → `#06b6d4` (electric cyan) → `#84fae8` (mint highlight)
- Satellites: hot pink `#f04a8a`, amber `#fb923c`, electric blue `#3b82f6`
- Nebula: indigo `#1e1b4b` → violet `#3730a3` → teal `#0e7490`
- Sparks: white core `#ffffff` → cyan tail `#22d3ee`
- All emissives saturated 1.4× to compensate for ACES tonemap rolloff

---

## 4. Target File Architecture

```
src/themes/electric-dreams/
├── electric-dreams-theme.js              ~500 lines  Orchestrator: lifecycle, events, frame loop
├── composition/
│   ├── scene-builder.js                  ~250 lines  Scene graph, lights, camera, layer assembly
│   ├── camera-director.js                ~120 lines  Slow figure-8 dolly + shake response
│   └── quality-presets.js                ~150 lines  Single source of truth for all presets
├── effects/
│   ├── raymarched-hero.js                ~350 lines  Half-res SDF metaball volume + composite
│   ├── satellite-blobs.js                ~200 lines  Instanced surface blobs, lissajous orbit
│   ├── nebula-sky.js                     ~150 lines  Background sky shader sphere
│   ├── compute-particles.js              ~300 lines  Unified compute pool: bokeh + sparks + embers
│   ├── god-rays.js                       ~180 lines  Radial volumetric scattering pass
│   └── glass-foreground.js               ~140 lines  Barrel + scanline + edge refraction
├── materials/
│   ├── tsl-noise-lib.js                  ~120 lines  Reusable hash/noise/FBM/smin TSL fns
│   ├── iridescent-blob.js                ~250 lines  Satellite blob material (SSS, fresnel, iridescence)
│   ├── raymarch-shader.js                ~400 lines  SDF, smin, raymarch loop, lighting model
│   └── nebula-sky-material.js            ~120 lines  Sky gradient + drift noise
├── post/
│   └── post-pipeline.js                  ~300 lines  MRT bloom + chromatic + vignette + grain (TSL)
├── stage-conductor.js                    ~200 lines  Game-state→visual mapping (kept, slimmed)
├── electric-dreams-tetrominos.js         ~60 lines   Tetromino colors (kept as-is)
└── electric-dreams-fallback.js           ~250 lines  Minimal WebGL fallback (basic spheres + bloom)

TOTAL: ~3,840 lines (vs. v1's 10,159 — 62% reduction)
DELETED: webgl-electric-dreams-renderer.js (589 LOC dead code)
DELETED: electric-dreams-hero-particles.js (565 LOC, merged into compute-particles.js)
DELETED: electric-dreams-stage-systems.js (523 LOC, slimmed into stage-conductor.js)
```

**Design principles enforced by structure**:
1. No file exceeds 500 lines (forcing single responsibility)
2. Materials are pure functions returning configured NodeMaterials
3. Effects own their own scene-graph subtree + dispose
4. Quality presets live in one file — no scattered magic numbers
5. The orchestrator never reaches into effect internals; communication is via events + uniform handles

---

## 5. Hero Component Deep Dive: Raymarched Metaball Volume

This is the highest-risk, highest-payoff piece. Without it, we're just rebuilding v1 with cleaner code.

**Technique**: Render a screen-aligned quad into a **half-resolution offscreen render target**. The fragment shader (TSL) raymarches from camera through 3 SDF metaballs combined via smooth minimum. Result is composited additively over the main scene, depth-tested against scene depth.

**Why half-res**: A 40-step raymarch loop at 2560×1440 = 147M raymarch operations/frame. At 1280×720 = 37M ops — 4× cheaper, and the smoothness of metaballs hides the upscale.

**SDF metaball loop (TSL pseudocode)**:
```javascript
const sceneSDF = Fn(([p]) => {
  let d = float(100.0).toVar();
  // 3 metaballs, positions animated on CPU and pushed via uniforms
  d.assign(smin(d, sphereSDF(p.sub(uBall0Pos), uBall0Radius), 0.8));
  d.assign(smin(d, sphereSDF(p.sub(uBall1Pos), uBall1Radius), 0.8));
  d.assign(smin(d, sphereSDF(p.sub(uBall2Pos), uBall2Radius), 0.8));
  // Domain-warped surface displacement
  const warp = fbm(p.mul(1.5).add(uTime.mul(0.2))).mul(0.15);
  return d.add(warp);
});

const raymarch = Fn(() => {
  const ro = cameraPosition;
  const rd = computeRayDir(uv);
  const t = float(0.0).toVar();
  const hit = bool(false).toVar();
  Loop({ start: 0, end: 40, type: 'int' }, ({ i }) => {
    const p = ro.add(rd.mul(t));
    const d = sceneSDF(p);
    If(d.lessThan(0.001), () => { hit.assign(true); Break(); });
    t.addAssign(d);
    If(t.greaterThan(50.0), () => { Break(); });
  });
  return { hit, t };
})();
```

**Lighting model**:
- Surface normal via finite-difference SDF gradient
- 3-light Lambert + Phong (key magenta, fill cyan, rim white)
- **Iridescent SSS**: thickness-based color shift sampling SDF interior at offset (`p - normal × 0.4`), depth-mapped to 3-color iridescence ramp
- Internal caustic: domain-warped FBM evaluated at surface position, modulates emissive intensity
- Fresnel rim with `pow(1-NdotV, 3)` × bright mint highlight

**Composite step**: Sample the half-res target with bicubic upsample, multiply by alpha, additive blend over scene. Depth-test against scene depth buffer so satellite blobs can occlude the volume if they pass in front.

**Game reactivity**:
- Idle: 3 balls drift on slow lissajous paths (period 12-18s)
- Line clear: radii pulse from 0.8 → 1.3 over 0.4s, emissive multiplier 1.0 → 2.5
- Combo: smin k value increases from 0.6 → 1.2 (more gloopy merging)
- Game over: balls drift apart, emissive fades to 0.3

---

## 6. Performance Budget — 120 FPS (8.33 ms/frame)

| Component | Budget | Notes |
|---|---|---|
| **GPU: raymarched hero (half-res)** | 1.8 ms | 40 steps × 1280×720 = ~37M raymarch ops. Single biggest cost. Adaptive step count: 24 (Medium) → 60 (Extreme). |
| **GPU: satellite blobs (instanced)** | 0.3 ms | 6 instances of IcosahedronGeometry(2.0, 4), single draw call via InstancedMesh + NodeMaterial. |
| **GPU: nebula sky** | 0.2 ms | Single fullscreen-equivalent draw on inverted sphere, cheap 2D FBM. |
| **GPU: compute particle update** | 0.4 ms | 8000 particles via WebGPU compute, dispatched as ceil(8000/64) = 125 workgroups. |
| **GPU: compute particle draw** | 0.5 ms | InstancedMesh with billboarded quads, one draw call. |
| **GPU: god-rays pass** | 0.6 ms | Radial blur, 16 samples, masked by emissive MRT. Drops to 8 samples below Ultra. |
| **GPU: glass foreground** | 0.3 ms | Single fullscreen pass, cheap barrel + scanline math. |
| **GPU: MRT bloom** | 0.9 ms | Standard down→up pyramid, 5 mips. TSL bloom() from `three/addons/tsl/display/BloomNode.js`. |
| **GPU: post chain (chromatic + tonemap + grain)** | 0.3 ms | Single combined pass. |
| **CPU: scene + animate** | 0.8 ms | Camera dolly, blob orbit math, uniform updates. Avoid per-frame allocations. |
| **App overhead (Phaser, UI, input)** | 1.5 ms | Existing budget. |
| **Headroom** | 1.2 ms | Buffer for GC, OS jitter, browser tax. |
| **TOTAL** | **8.8 ms** | ~113 FPS sustained; with headroom we hit 120. |

**Adaptive scaling triggers** (extending current system):
- If frame time > 9 ms for 30 consecutive frames → drop raymarch steps by 8
- If frame time > 11 ms → halve raymarch resolution (640×360)
- If frame time > 14 ms → drop one quality tier

**Mobile / Low / Minimal presets**:
- No raymarched volume — use 3 emissive instanced spheres as hero stand-in
- No GPU compute — 500 CPU particles
- No god-rays, no glass foreground, UnrealBloom instead of MRT
- Target 60 FPS

---

## 7. Implementation Phases (with exit criteria)

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Scaffold & cleanup** | Create new file structure, copy stage-conductor + tetrominos verbatim, delete dead WebGL renderer + v1 test file. Wire empty theme into theme-registry. | Theme loads, shows black screen, no console errors, lint clean. |
| **1. Background & camera** | Nebula sky shader + camera director (figure-8 dolly). | Visible drifting nebula gradient, smooth camera motion, 144 FPS. |
| **2. Satellite blobs** | Iridescent surface material + instanced orbit system. | 6 colored orbs visible orbiting the center on lissajous paths. |
| **3. Compute particle pool** | Single WebGPU compute pipeline driving bokeh+sparks+embers via tier-flagged storage buffer. | 8000 drifting particles, depth-blurred bokeh, no CPU per-particle cost. |
| **4. ★ Raymarched hero volume** | Half-res offscreen pass with 3-metaball SDF, smin blending, iridescent SSS, internal caustics, depth composite. | Visible gloopy central metaball complex, 120 FPS on RTX 3070 / M1 Pro. |
| **5. God-rays** | Radial volumetric scattering anchored on hero emissive MRT. | Visible light shafts emanating from hero blob, intensifying on combo. |
| **6. MRT bloom + post chain** | MRT pass with emissive output, BloomNode, chromatic, vignette, ACES, grain. | Vibrant glow on emissive surfaces; non-emissive surfaces don't bloom. |
| **7. Glass foreground** | Barrel distortion + edge chromatic refraction + faint scanline. | Subtle "looking through curved glass" effect; no perceptible perf cost. |
| **8. Gameplay reactivity** | Wire stage-conductor events to: hero pulse, satellite color shift, particle bursts, god-ray intensity, camera shake. | Line clears, combos, game-over all trigger distinct visible responses. |
| **9. Quality presets & adaptive** | All presets defined in quality-presets.js, adaptive scaling validated on each tier. | Theme runs at target FPS on Minimal/Low/Medium/High/Ultra/Extreme. |
| **10. Fallback path** | Minimal WebGL fallback in electric-dreams-fallback.js: nebula + 8 emissive spheres + UnrealBloom. | Theme works on Firefox/Safari without WebGPU at 60 FPS. |
| **11. Polish & profile** | Chrome DevTools GPU profile, find any spike > 2 ms, audit allocations, verify no leaks across theme swaps. | 120 FPS sustained on target hardware; clean memory profile across 10 theme swaps. |

Phases 0-3 unblock parallel work on 4-7. Phase 4 is the critical path.

---

## 8. Open Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Half-res raymarch composite shows visible upscale artifacts on metaball edges | Medium | Bicubic upsample + 1-pixel emissive bleed in MRT bloom hides edge softness. Fallback: render at 0.75× instead of 0.5×. |
| MRT bloom remains unstable on Windows ANGLE (v1's blocker) | Medium | v1 used a custom MRT path; v2 uses official `three/addons/tsl/display/BloomNode.js` which has been hardened. If it still fails, fall back to non-selective bloom — visual loss is minor (rim emissive is ~80% of bloom contribution). |
| WebGPU compute dispatch incompatible on some integrated GPUs | Low | Feature-detect `renderer.backend.hasFeature('compute')` at init; gracefully fall back to CPU particles on miss. |
| Iridescent SSS sampling causes per-pixel divergent loops, killing perf | Medium | Use a fixed 3-tap thickness sample, no loop. Profile shader cost on AMD vs Nvidia early. |
| 120 FPS unreachable on M1 baseline due to thermal throttling on integrated GPU | Medium | Designate M1 Pro as baseline (not M1 base). M1 base runs Medium preset at 60 FPS. Documented in quality-presets.js. |
| Refactor takes longer than estimated; v1 stays broken in interim | High | Keep v1 working on `main` until v2 phase 7 ships. Do work on `feature/electric-dreams-v2` branch. |
| User wants tweaks to art direction mid-refactor (e.g., add lightning arcs) | High | Phase 8 (reactivity) is the natural integration point for late additions. Resist adding before then. |

---

## 9. Non-Negotiable Quality Bars (DoD)

V2 ships only when ALL of the following are true:

- [ ] Sustained 120 FPS on RTX 3070 / M1 Pro at Ultra preset, verified via `renderer.info` + Chrome perf overlay
- [ ] No frame-time spikes > 13 ms in steady state (idle + 4-line clear + 10x combo)
- [ ] Zero console errors, zero shader compile warnings, zero lint errors
- [ ] All shader uniforms updated via cached handles (no `material.uniforms.x.value = ...` in animate loop)
- [ ] Hero composition is *immediately readable* in first frame (focal point unambiguous)
- [ ] Color palette passes WCAG-AAA harmony check (no clashing hues in main gamut)
- [ ] Memory profile flat after 10 theme-in/theme-out cycles (no leaks)
- [ ] WebGL fallback works in Firefox latest, Safari latest at 60 FPS
- [ ] Total source lines ≤ 4,500 across the theme directory
- [ ] Side-by-side screenshot comparison vs. v1 unambiguously demonstrates "best in class"

---

## 10. Out of Scope (Deliberate Cuts)

- No video texture / image assets (everything procedural)
- No multiplayer-specific behavior (theme is single-context; multiplayer overlay is separate)
- No "lightning arcs between blobs" (was in v1 plan, never delivered, adds complexity for marginal payoff — revisit post-V2 if user requests)
- No AR/VR rendering paths
- No editable color picker (palette is locked to harmony)
- No saved-state animation (every frame is procedural from time + game state)

---

## 11. Estimated Effort

| Phase | Estimate |
|---|---|
| 0. Scaffold | 0.5 day |
| 1. Background & camera | 0.5 day |
| 2. Satellite blobs | 1 day |
| 3. Compute particles | 1.5 days |
| 4. ★ Raymarched hero | 3 days |
| 5. God-rays | 1 day |
| 6. MRT bloom & post | 1.5 days |
| 7. Glass foreground | 0.5 day |
| 8. Gameplay reactivity | 1 day |
| 9. Quality presets & adaptive | 1 day |
| 10. Fallback | 1 day |
| 11. Polish & profile | 2 days |
| **TOTAL** | **~14 working days** |

Critical path: 0 → 1 → 2 → 3 → 4 → 6 → 11. Phases 5, 7, 8, 9, 10 can parallelize once 4 lands.

---

## Sources

- [Codrops — How to Create a Liquid Raymarching Scene Using TSL](https://tympanus.net/codrops/2024/07/15/how-to-create-a-liquid-raymarching-scene-using-three-js-shading-language/)
- [three.js — WebGPU Postprocessing Bloom Emissive Example](https://threejs.org/examples/webgpu_postprocessing_bloom_emissive.html)
- [Maxime Heckel — Field Guide to TSL and WebGPU](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)
- [Codrops — WebGPU tutorials tag](https://tympanus.net/codrops/tag/webgpu/)
- [three.js discourse — Volumetric Lighting in WebGPU](https://discourse.threejs.org/t/volumetric-lighting-in-webgpu/87959)
- [THREE.Fire — TSL volumetric fire reference](https://github.com/typeWolffo/THREE.Fire)
- [Awwwards — Samsy cyberpunk WebGPU portfolio (120+ FPS benchmark)](https://www.awwwards.com/sites/cyberpunk-interactive-3d-desk)
- [Utsubo — Migrate Three.js to WebGPU (2026) checklist](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
