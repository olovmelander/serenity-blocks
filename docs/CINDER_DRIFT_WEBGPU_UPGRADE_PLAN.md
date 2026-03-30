# Cinder Drift Theme — WebGPU Hybrid Upgrade Plan (World-Class Revision)

> **Goal:** Transform Cinder Drift from a WebGL-only monolithic implementation into a production-grade hybrid WebGPU/WebGL2 masterpiece — the definitive volcanic core experience for a modern game scene. Flowing magma, explosive combo effects, volumetric smoke, and cinematic fire that feels alive.

**Reference implementations:**
- `src/themes/black-hole/` — Gold standard hybrid pattern (renderer init, MRT, compute, materials)
- `src/themes/chromadelic-highway/` — Production-hardened patterns (device loss recovery, bloom class weights, material return tuples, compile timeout, MRT audit)

**Three.js version:** r181+ with TSL (Three Shading Language) support

---

## Current Architecture (WebGL Only)

| Component | Implementation | Limitations |
|-----------|---------------|-------------|
| Renderer | `WebGLRenderer` | No GPU compute, no TSL, no MRT, no post-processing |
| Magma Background | GLSL `ShaderMaterial` (6-octave FBM + domain warping) | CPU-only shockwave UV distortion; no emissive isolation |
| Volcanic Rocks | GLSL `ShaderMaterial` (noise displacement, vein cracks) | 7 individual meshes (no instancing); high-subdivision icosahedron (40) |
| Volumetric Smoke | 100 GLSL `Points` (alpha blend) | CPU drift; no curl noise; static smoke look |
| Embers | 2000 GLSL `Points` (curl noise in vertex shader) | No GPU compute; fragment shader has empty `main()` (broken output) |
| Burst Particles | 8-pool GLSL `Points` (4000 particles each, GPU burst physics) | 8 separate draw calls; `gl_PointCoord` dependent |
| Magma Explosion | CPU-updated `TubeGeometry` tendrils + `SphereGeometry` core + 500 splash particles | Per-frame CPU position writes; inline GLSL shaders; geometry regeneration |
| Background Ripple | Shader-based shockwave distortion on magma plane | Good approach but limited to single ripple; no layered effects |
| Post-Processing | **None** | No bloom, no vignette, no chromatic aberration, no tone mapping control |
| Quality Presets | **None** | Single fixed configuration; no adaptive scaling |
| Lifecycle | Partial cleanup; resize listener leak (`bind` creates new ref) | `setTimeout` not tracked; incomplete disposal |

### Current File Structure
```
src/themes/cinder-drift/
├── cinder-drift-theme.js        # Main class (884 lines, monolithic)
├── cinder-drift-shaders.js      # GLSL shaders (589 lines)
└── cinder-drift-tetrominos.js   # Tetromino config (67 lines)
```

### Critical Bugs in Current Implementation
1. **Ember fragment shader is empty** — `emberFragmentShader` computes `strength` but never writes `gl_FragColor`. Embers are invisible or undefined behavior.
2. **Resize listener leak** — `window.addEventListener('resize', this.onWindowResize.bind(this))` creates a new function reference each call; cannot be removed.
3. **No post-processing** — The theme has zero bloom, vignette, or tone mapping. For a volcanic/magma theme this is a massive missed opportunity.
4. **Incomplete disposal** — `cleanup()` does not dispose burst pool geometries individually, explosion group resources, or remove the resize listener.
5. **`createVolcanicRocks()` is defined but never called** in `createScene()` — rocks array is populated but the method is unreachable.

---

## Target Architecture (WebGPU Hybrid)

### New File Structure
```
src/themes/cinder-drift/
├── cinder-drift-theme.js        # Main class — hybrid renderer, scene setup, animation loop
├── cinder-drift-materials.js    # TSL node material factories (magma, rock, smoke, ember, burst, explosion)
├── cinder-drift-compute.js      # GPU compute classes (ember simulation, burst particles, smoke flow)
├── cinder-drift-post.js         # WebGPU PostProcessing class (MRT bloom, heat haze, vignette, grading)
├── cinder-drift-shaders.js      # GLSL shaders (WebGL fallback — preserved and maintained)
└── cinder-drift-tetrominos.js   # Tetromino config (unchanged)
```

### Hybrid Renderer Pattern (Gold Standard)

```
┌─────────────────────────────────────────────┐
│              createScene() (async)           │
│                                              │
│  1. Try WebGPURenderer → await init()        │
│  2. Check backend?.isWebGPUBackend === true  │
│  3. Fallback → WebGLRenderer (silent)        │
│  4. Set this.isWebGPU flag                   │
│  5. Probe capabilities (MRT, compute)        │
│  6. Create scene elements (conditional path) │
│  7. Setup post-processing (conditional path) │
│  8. Start animation loop                     │
└─────────────────────────────────────────────┘
```

When **WebGPU** is available:
- TSL node materials (`MeshBasicNodeMaterial`, `PointsNodeMaterial`, `SpriteNodeMaterial`)
- GPU compute for ember/burst/smoke simulation
- `PostProcessing` with MRT (emissive-only bloom)
- Storage buffers for zero-copy GPU particle updates
- Heat haze distortion as TSL post effect

When **WebGL** fallback:
- Original GLSL `ShaderMaterial` (existing shaders preserved)
- `EffectComposer` + `UnrealBloomPass` + `ShaderPass`
- CPU-side particle updates (current behavior, with ember shader fix)
- Scene looks coherent, just without GPU compute acceleration

---

## Visual Pillars (Art Direction Lock)

### Identity Anchors (Non-Negotiable)
- **Flowing magma wall** as the dominant background — multi-layer FBM domain-warped lava with crust/vein structure.
- **Dark volcanic rock silhouettes** floating in the foreground — cracked obsidian with glowing magma interior veins.
- **Rising ember field** creating upward motion language and depth layering.
- **Explosive combo effects** that feel like volcanic eruptions — shockwave ripples through the lava, massive particle bursts, screen-filling energy.

### Masterpiece Visual Upgrades
- **Emissive-isolated bloom** — Magma veins, ember cores, and explosion flashes bloom cinematically without washing out dark rock surfaces.
- **Volumetric smoke with turbulence** — Curl-noise-driven smoke with internal glow from magma light beneath, not just alpha circles.
- **Heat haze distortion** — Screen-space distortion above hot areas (lava surface, explosion sites) for cinematic heat shimmer.
- **Lava crust cooling cycle** — Dynamic crust formation and breakup, not just static FBM noise.
- **Depth-separated layers** — Clear foreground (rocks + embers), midground (smoke + haze), background (magma wall) parallax.
- **Cinematic color grading** — Deep blacks, controlled orange/amber highlights, desaturated mid-tones for dramatic contrast.

### Color Script
- Deep volcanic black (#0a0200) as dominant base value.
- Magma red/orange (#ff4400 → #ff8800) for active lava channels — concentrated, not diffuse.
- Bright yellow-white (#ffcc00 → #fff5e6) reserved for peak heat moments (combo bursts, fresh lava breakouts).
- Dark reddish smoke (#331100) for atmospheric depth.
- Avoid persistent full-frame orange glow — volcanic scenes need darkness to make the fire feel hot.

### Readability Rules
- Board edge contrast maintained during combo explosions.
- Bloom is emissive-isolated (MRT) — dark rocks don't false-bloom.
- Heat haze distortion is capped and does not affect the game board area.
- Vignette darkens edges to frame the board, not obscure it.

---

## Platform Constraints

- Three.js: `^0.181.2`
- Electron: `^38.3.0`
- Startup must never fail due to WebGPU availability.
- WebGL fallback is a first-class runtime, not a temporary compatibility shim.

---

## Capability Matrix and Kill Switches

| Runtime | Post | MRT | Compute | Expected Path |
|--------|------|-----|---------|---------------|
| WebGPU + MRT + Compute | Yes | Yes | Yes | Full Cinder Drift feature set |
| WebGPU + MRT, no Compute | Yes | Yes | No | Node materials + CPU particle fallback |
| WebGPU, no MRT | Yes | No | Optional | Standard bloom path |
| WebGPU, no Post | No | No | Optional | Direct scene render |
| WebGL2 fallback | `EffectComposer` | No | No | Stable fallback-quality experience |

Required debug flags:
- `?forceWebGL=1`
- `?cinderNoPost=1`
- `?cinderNoMRT=1`
- `?cinderNoCompute=1`
- `?cinderNoHeatHaze=1`
- `?cinderMrtAudit=1`
- `?cinderBaseline=1`
- `?cinderSeed=1234`
- `?cinderFixedDt=16.666`

Rule:
- Every optional rendering feature is gated by capabilities and flags.

---

## Migration Policy

- Stability and observability before visual expansion.
- Introduce one major rendering risk at a time.
- Preserve WebGL visual parity unless a deliberate difference is approved.
- Do not remove fallback code until parity + performance + reliability gates pass.
- Define objective exit criteria per phase; avoid subjective "looks good" completion.

Non-goals until Phase 6+:
- Full volumetric raymarching on all tiers.
- Feature additions that reduce board readability under combo stress.

---

## Non-Negotiable Engineering Gates

1. **Deterministic baseline required before feature work**
   - Seeded runs (`cinderSeed`) + fixed delta (`cinderFixedDt`) + canned event script.
   - Hero-frame captures for WebGPU and WebGL fallback on each quality tier.

2. **Fallback parity blocks merges**
   - Any WebGPU upgrade that regresses WebGL stability/readability blocks phase signoff.

3. **Single owner per render responsibility**
   - Exactly one owner for tone mapping, bloom-source selection, and reactive envelope writes per frame.

4. **Measured budgets, not visual intuition**
   - Phase signoff requires p50/p95 frame-time, 1% low FPS, draw calls, and memory proxies in notes.

5. **Immediate runtime rollback path**
   - Every major feature has kill-switch coverage and can downgrade without reload loops.

---

## Phase Plan

### Phase 0: Baseline Lock, Bug Fixes, and Instrumentation (Critical)

Objective:
- Fix critical bugs, establish deterministic baselines, and prepare for migration.

Files:
- Modify: `src/themes/cinder-drift/cinder-drift-theme.js`
- Modify: `src/themes/cinder-drift/cinder-drift-shaders.js`

Tasks:
- [ ] **Fix ember fragment shader** — Add `gl_FragColor = vec4(vColor, strength * vAlpha);` output.
- [ ] **Fix resize listener leak** — Store bound handler as `this.boundResizeHandler` and use for both add/remove.
- [ ] **Call `createVolcanicRocks()`** in `createScene()` or remove dead code.
- [ ] Extract inline GLSL shaders from `createMagmaExplosion()`, `createTendril()`, `createSplashParticles()` into `cinder-drift-shaders.js`.
- [ ] Centralize all `setTimeout` calls into a tracked timer set (`this.activeTimers`) cleared on `stop()`.
- [ ] Add deterministic controls (`cinderSeed`, `cinderFixedDt`, canned event playback).
- [ ] Add baseline performance capture helper (FPS, 1% low, draw calls, memory).
- [ ] Fix disposal: explicitly dispose burst pool geometries, explosion group, remove resize listener.
- [ ] Record baseline metrics and hero-frame captures.

Exit criteria:
- Ember particles are visible and correctly rendered.
- No resize listener leaks after 100+ theme switches.
- Baseline pack committed and reproducible.
- All inline shaders extracted to shader module.

---

### Phase 1: Renderer Bootstrap and Lifecycle Hardening (Critical)

Objective:
- Introduce robust hybrid boot and cleanup behavior.

Files:
- Modify: `src/themes/cinder-drift/cinder-drift-theme.js`

Tasks:
- [ ] Add dual imports: `import * as THREE from 'three'` + `import * as THREE_WEBGPU from 'three/webgpu'`.
- [ ] Implement explicit WebGPU-first async init with WebGL fallback (`initRenderer` becomes async).
- [ ] Verify backend with `backend?.isWebGPUBackend === true` (not just truthy check).
- [ ] Add consolidated capability object (`this.capabilities`: `webgpu`, `post`, `mrt`, `compute`).
- [ ] Parse/store debug flags in `this.flags`.
- [ ] Add device-loss handling (`renderer.onDeviceLost`) with safe fallback/reinit flow (force WebGL on recovery).
- [ ] Store resize callback with stable reference (`this.boundResizeHandler`).
- [ ] Ensure post/renderer/material/texture cleanup is complete and idempotent.
- [ ] Make `createScene()` fully async.
- [ ] Add timeout-guarded `compileAsync` (3s max) before first frame.
- [ ] Color pipeline ownership: post graph owns tonemapping on WebGPU post path; renderer owns on WebGL/no-post.
- [ ] Add quality preset framework (Extreme/Ultra/High/Medium/Low/Minimal).

Quality Preset Framework:

```javascript
const QUALITY_PRESETS = {
    Extreme: {
        emberCount: 8000,
        smokeCount: 200,
        burstPoolSize: 12,
        burstParticleCount: 6000,
        rockSubdivision: 40,
        rockCount: 7,
        magmaFbmOctaves: 6,
        bloomStrength: 0.55,
        bloomRadius: 0.50,
        bloomDownsample: 0.9,
        enablePostProcessing: true,
        enableCompute: true,
        enableHeatHaze: true,
        splashParticles: 1000,
    },
    Ultra: {
        emberCount: 6000,
        smokeCount: 160,
        burstPoolSize: 10,
        burstParticleCount: 5000,
        rockSubdivision: 32,
        rockCount: 7,
        magmaFbmOctaves: 6,
        bloomStrength: 0.50,
        bloomRadius: 0.45,
        bloomDownsample: 0.85,
        enablePostProcessing: true,
        enableCompute: true,
        enableHeatHaze: true,
        splashParticles: 800,
    },
    High: {
        emberCount: 4000,
        smokeCount: 120,
        burstPoolSize: 8,
        burstParticleCount: 4000,
        rockSubdivision: 24,
        rockCount: 7,
        magmaFbmOctaves: 5,
        bloomStrength: 0.45,
        bloomRadius: 0.40,
        bloomDownsample: 0.8,
        enablePostProcessing: true,
        enableCompute: true,
        enableHeatHaze: true,
        splashParticles: 500,
    },
    Medium: {
        emberCount: 2000,
        smokeCount: 80,
        burstPoolSize: 6,
        burstParticleCount: 3000,
        rockSubdivision: 16,
        rockCount: 5,
        magmaFbmOctaves: 5,
        bloomStrength: 0.38,
        bloomRadius: 0.35,
        bloomDownsample: 0.7,
        enablePostProcessing: true,
        enableCompute: false,
        enableHeatHaze: false,
        splashParticles: 300,
    },
    Low: {
        emberCount: 800,
        smokeCount: 40,
        burstPoolSize: 4,
        burstParticleCount: 2000,
        rockSubdivision: 8,
        rockCount: 3,
        magmaFbmOctaves: 4,
        bloomStrength: 0.28,
        bloomRadius: 0.30,
        bloomDownsample: 0.6,
        enablePostProcessing: false,
        enableCompute: false,
        enableHeatHaze: false,
        splashParticles: 150,
    },
    Minimal: {
        emberCount: 400,
        smokeCount: 20,
        burstPoolSize: 2,
        burstParticleCount: 1000,
        rockSubdivision: 4,
        rockCount: 2,
        magmaFbmOctaves: 3,
        bloomStrength: 0.20,
        bloomRadius: 0.25,
        bloomDownsample: 0.5,
        enablePostProcessing: false,
        enableCompute: false,
        enableHeatHaze: false,
        splashParticles: 0,
    },
};
```

Exit criteria:
- 100+ activate/deactivate cycles with no listener/timer/resource leaks.
- WebGPU init failure and device-loss scenarios recover without black screen.
- `?forceWebGL=1` forces WebGL path; all `?cinderNo*` flags work.
- Tone mapping is applied exactly once per path.
- Quality presets scale all visual parameters correctly.

---

### Phase 2: Render Path Abstraction and Backend Parity (High)

Objective:
- Centralize frame rendering and backend-specific behavior.

Files:
- Modify: `src/themes/cinder-drift/cinder-drift-theme.js`
- Create: `src/themes/cinder-drift/cinder-drift-post.js`

Tasks:
- [ ] Introduce single `renderFrame()` abstraction:
  - WebGPU post path: `this.postProcessing.render()`
  - WebGL composer path: `this.composer.render()`
  - Direct render fallback: `this.renderer.render(this.scene, this.camera)`
- [ ] Create `CinderDriftPost` class for WebGPU post-processing with conservative defaults (no MRT yet).
- [ ] Create WebGL `EffectComposer` path with `UnrealBloomPass` + custom vignette + heat haze `ShaderPass`.
- [ ] Normalize resize behavior across renderer/composer/post targets.
- [ ] Ensure post failure auto-falls back to direct rendering.
- [ ] Keep tone mapping and output color-space behavior aligned across backends.

Exit criteria:
- All flag/capability permutations run without runtime errors.
- WebGL path gains bloom for the first time (immediate visual upgrade).
- WebGL path remains visually coherent versus baseline captures.

---

### Phase 3: Material Modularization and TSL Migration (Critical)

Objective:
- Split material responsibilities and migrate core shaders to node materials on WebGPU.

Files:
- Create: `src/themes/cinder-drift/cinder-drift-materials.js`
- Modify: `src/themes/cinder-drift/cinder-drift-theme.js`

Tasks:
- [ ] Build dual-path material factories (WebGPU node + WebGL fallback shader):
  1. [ ] **Magma Background** (`MeshBasicNodeMaterial`) — Multi-octave FBM, domain warping, crust formation, shockwave distortion, reactive heat boost
  2. [ ] **Volcanic Rock** (`MeshBasicNodeMaterial`) — Noise displacement, vein cracks, magma glow interior, fresnel rim, pulse reactivity
  3. [ ] **Smoke** (`PointsNodeMaterial`) — Soft circle, drift animation, alpha fade cycle, internal glow tinting
  4. [ ] **Embers** (`PointsNodeMaterial`) — Curl noise turbulence, lifetime fade, hot-to-cool color gradient, size attenuation
  5. [ ] **Burst Particles** (`PointsNodeMaterial`) — Radial explosion, gravity, lifetime fade, intensity scaling
  6. [ ] **Explosion Core** (`MeshBasicNodeMaterial`) — Fresnel glow, pulse animation, hot white center
  7. [ ] **Tendril** (`MeshBasicNodeMaterial`) — Hot-to-cool vertical gradient, edge fade, additive blend
  8. [ ] **Splash Particles** (`PointsNodeMaterial`) — Radial glow, lifetime alpha, lava color gradient
- [ ] Each factory returns `{ material, uniforms, meta }` tuple.
- [ ] Add bloom class weights per material:

  ```
  magmaBackground:  0.25  — Subtle lava channel glow (background, not dominant)
  volcanicRock:     0.60  — Magma vein cracks bloom strongly
  smoke:            0.00  — No bloom (atmospheric depth, not emissive)
  ember:            0.45  — Hot ember core glow
  burstParticle:    0.90  — Explosive event bloom (dominant during combos)
  explosionCore:    0.95  — White-hot core flash
  tendril:          0.70  — Lava tendril glow
  splashParticle:   0.80  — Splash droplet bloom
  ```

- [ ] Add material audit checks for emissive readiness before MRT enablement.
- [ ] TSL noise helpers: port existing GLSL `snoise`, `fbm`, `curlNoise` to TSL graph construction.

TSL Noise Helpers (Compile-Time Graph):
```javascript
function tslHash(p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
}

function tslNoise2D(p) {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const a = tslHash(i);
    const b = tslHash(i.add(vec2(1, 0)));
    const c = tslHash(i.add(vec2(0, 1)));
    const d = tslHash(i.add(vec2(1, 1)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

function tslFbm(p, octaves = 6) {
    let v = float(0);
    let a = float(0.5);
    let coord = p;
    for (let i = 0; i < octaves; i++) {
        v = v.add(a.mul(tslNoise2D(coord)));
        coord = coord.mul(2.0);
        a = a.mul(0.5);
    }
    return v;
}
```

Exit criteria:
- WebGPU path compiles cleanly with no material warnings.
- WebGL visuals remain parity-safe.
- All material factories return clean `{ material, uniforms, meta }` tuples.
- TSL noise visually matches existing GLSL FBM.

---

### Phase 4: WebGPU Post Pipeline and MRT Bloom Isolation (High)

Objective:
- Move WebGPU path to native post-processing and isolate bloom via emissive MRT.

Files:
- Modify: `src/themes/cinder-drift/cinder-drift-post.js`
- Modify: `src/themes/cinder-drift/cinder-drift-materials.js`
- Modify: `src/themes/cinder-drift/cinder-drift-theme.js`

### `CinderDriftPost` Class Architecture

```javascript
export class CinderDriftPost {
    constructor(renderer, scene, camera, params = {}) {
        this.postProcessing = new THREE.PostProcessing(renderer);
        this.useMRT = params.useMRT ?? true;

        // Scene pass with MRT (color + emissive)
        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT
            ? this.scenePass.getTextureNode('emissive')
            : sceneColor;

        // Bloom (emissive-only via MRT)
        this.bloomNode = bloom(bloomSource, ...);

        // Heat haze distortion (signature Cinder Drift effect)
        // Screen-space UV warp based on vertical position and time
        // Simulates convective thermal distortion above hot surfaces

        // Vignette — cinematic volcanic framing
        // Chromatic aberration — subtle, event-scaled
        // ACES tone mapping in post graph
        // Volcanic color grading — deep blacks, warm highlights, desaturated mids
        // Dithering — prevent banding in deep dark areas

        this.postProcessing.outputNode = finalOutput;
    }

    update(params) { /* Per-frame reactive params */ }
    render() { this.postProcessing.render(); }
    setSize(w, h) { /* Resize targets */ }
    dispose() { /* Clean up all resources */ }
}
```

Tasks:
- [ ] Implement `CinderDriftPost` class with `THREE.PostProcessing` chain:
  - Scene pass with MRT (`output` + `emissive`)
  - Bloom on emissive channel only (threshold 0.0 with MRT)
  - TSL heat haze distortion (vertical UV warp, time-animated, intensity-reactive)
  - TSL vignette (dark edges, volcanic framing)
  - TSL chromatic aberration (event-scaled, subtle)
  - ACES tone mapping in post graph
  - Volcanic color grading (exposure, contrast, warm saturation bias)
  - Dithering (prevent banding in deep blacks)
- [ ] Gate MRT by capability and flag (`!cinderNoMRT`).
- [ ] Ensure non-bloom surfaces output zero emissive in MRT mode.
- [ ] Keep fallback to non-MRT post and then direct render when needed.
- [ ] Add `update()` method for per-frame reactive params (bloom strength surge on combo, heat haze intensity).
- [ ] Add `ensureMrtMaterials()` fail-safe.
- [ ] Add dev-only MRT diagnostics (`?cinderMrtAudit=1`).

Bloom Configuration:

| Quality | Strength | Radius | Threshold | Downsample |
|---------|----------|--------|-----------|------------|
| Extreme | 0.55 | 0.50 | 0.0 (MRT) | 0.9 |
| Ultra | 0.50 | 0.45 | 0.0 (MRT) | 0.85 |
| High | 0.45 | 0.40 | 0.0 (MRT) | 0.8 |
| Medium | 0.38 | 0.35 | 0.0 (MRT) | 0.7 |
| Low | 0.28 | 0.30 | 0.7 | 0.6 |
| Minimal | 0.20 | 0.25 | 0.7 | 0.5 |

Exit criteria:
- Bloom affects intended emissive elements only — dark rock surfaces don't false-bloom.
- Heat haze distortion is visible above magma surface and explosion sites.
- No MRT validation errors; fallback path always available.
- Volcanic color grading creates cinematic deep-black contrast.

---

### Phase 5: Compute Migration and Instancing (High)

Objective:
- Reduce CPU simulation load and draw-call overhead with safe fallbacks.

Files:
- Create: `src/themes/cinder-drift/cinder-drift-compute.js`
- Modify: `src/themes/cinder-drift/cinder-drift-theme.js`

### 5.1 Volcanic Rock Instancing (Both Paths)
- [ ] Convert 7 individual rock `Mesh` objects to `InstancedMesh` sharing a single geometry.
- [ ] Store per-instance transform, rotation speed, bob offset, and size in instance attributes.
- [ ] Collapse 7 draw calls to 1 instanced draw call.
- [ ] Scale rock count by quality preset (2-7 rocks depending on tier).

### 5.2 Ember Compute — `CinderDriftEmberCompute`
- [ ] Move ember particle simulation (position, velocity, curl noise turbulence, lifetime) to GPU compute.
- [ ] `StorageBufferAttribute` for positions, velocities, lifetimes — zero CPU readback.
- [ ] Compute kernel: upward drift + curl noise displacement + lifetime wrap-around + size decay.
- [ ] Scale ember count dramatically: up to 8000 on Extreme (vs 2000 current) in a single draw call.
- [ ] Keep deterministic CPU fallback for WebGL and `cinderNoCompute` mode.

### 5.3 Burst Particle Compute — `CinderDriftBurstCompute`
- [ ] Replace 8-pool separate `Points` objects with a single unified compute-backed particle system.
- [ ] `StorageBufferAttribute` for positions, velocities, lifetimes, colors.
- [ ] Compute kernel: radial burst velocity, gravity, deceleration curve, lifetime countdown, alpha fade, respawn on trigger.
- [ ] Burst triggering via uniform (`uBurstTrigger` + `uBurstCenter` + `uBurstIntensity`).
- [ ] Up to 50,000 particles in a single draw call (vs 8 × 4000 = 32k in 8 separate calls).
- [ ] WebGL fallback: retain current 8-pool GLSL system (with fixed fragment shader).

### 5.4 Smoke Flow Compute (Optional, Quality-Gated)
- [ ] GPU-computed curl noise displacement for smoke particles on High+ tiers.
- [ ] Adds turbulent, organic smoke motion that CPU path cannot afford at scale.
- [ ] CPU fallback: simple upward drift (current behavior).

### 5.5 Compute Buffer Layout Contract
- [ ] Use explicit 16-byte aligned struct layout for all compute buffers (`vec4`-packed).
- [ ] Document byte stride/offsets in `cinder-drift-compute.js`.
- [ ] No per-frame GPU-to-CPU readback in hot paths.

### Compute Budgets by Quality Tier

| Tier | Max Embers | Max Burst Particles | Max Smoke | Compute Enabled |
|------|-----------|---------------------|-----------|-----------------|
| Extreme | 8000 | 50000 | 200 | Yes |
| Ultra | 6000 | 40000 | 160 | Yes |
| High | 4000 | 30000 | 120 | Yes |
| Medium | 2000 | 15000 | 80 | Optional |
| Low | 800 | 5000 | 40 | No |
| Minimal | 400 | 2000 | 20 | No |

Exit criteria:
- Rock draw calls collapse to 1 instanced call.
- Ember and burst particle simulation run entirely on GPU with no CPU position writes.
- Compute and CPU paths are runtime-switch safe and visually close.
- No GPU validation errors or CPU readbacks in hot path.

---

### Phase 6: Masterpiece Visual Expansion (Critical)

Objective:
- Raise visual ceiling to world-class masterpiece level while preserving hierarchy and readability.

Files:
- Modify: `src/themes/cinder-drift/cinder-drift-theme.js`
- Modify: `src/themes/cinder-drift/cinder-drift-materials.js`
- Modify: `src/themes/cinder-drift/cinder-drift-post.js`

#### 6A. Magma Background Overhaul
- [ ] **Dynamic crust cycle** — Procedural crust formation and breakup: dark plates drift and crack, revealing bright lava beneath, then slowly re-cool. Creates living, breathing lava surface.
- [ ] **Multi-layer depth** — Add a deeper, slower magma layer beneath the surface flow for parallax depth.
- [ ] **Lava river channels** — More defined hot channels using sharp domain-warped noise (Voronoi-like cracks).
- [ ] **Reactive heat zones** — Combo explosions leave temporary hot spots that slowly cool (persistent heat map uniform).
- [ ] **Subtle surface shimmer** — Micro-scale specular animation on the crust surface for obsidian glass quality.

#### 6B. Volcanic Rock Enhancement
- [ ] **Magma interior glow upgrade** — Cracks glow with animated TSL noise for pulsing magma flow inside the rock.
- [ ] **Obsidian surface quality** — Micro-roughness noise for realistic dark volcanic glass appearance.
- [ ] **Event-driven fracture flash** — On combo events, rock cracks briefly flash white-hot, suggesting internal pressure surge.
- [ ] **Depth-haze integration** — Distant rocks fade into atmospheric haze for depth perception.
- [ ] **Subtle ember emission from rock cracks** — Small ember particles spawn from glowing rock veins (quality-gated).

#### 6C. Enhanced Combo Effects (Your Favorite!)
- [ ] **Unified reactive envelope system** — Multi-channel envelope replacing single `coreIntensity`:
  ```javascript
  this.reactiveEnvelope = {
      heat: 0,        // Global magma brightness and crust breakup rate
      bloom: 0,       // Dynamic bloom strength surge
      shake: 0,       // Camera shake intensity
      haze: 0,        // Heat haze distortion strength
      chromatic: 0,   // Chromatic aberration intensity
      ember: 0,       // Ember spawn rate boost
      ripple: 0,      // Background shockwave amplitude
  };
  ```
- [ ] **Layered combo escalation:**
  - Combo 1-2: Background ripple + ember burst + bloom surge
  - Combo 3-4: + Camera shake + heat haze spike + rock fracture flash
  - Combo 5-6: + Chromatic aberration + magma crust breakup acceleration
  - Combo 7+: + Full volcanic eruption mode: massive particle burst, screen-edge lava splash, sustained bloom peak, all channels maxed
- [ ] **Lava splash curtain** — High combos spawn a curtain of lava droplets that arc upward from the bottom edge (billboard sprites with gravity parabola).
- [ ] **Shockwave ring upgrade** — Combo shockwave becomes a visible expanding distortion ring with an emissive leading edge.
- [ ] **Persistent heat map** — Combo explosion sites leave a fading heat residue on the magma background (30-60 second cool-down).
- [ ] **Screen flash** — Brief full-screen additive flash on high combos, decaying in 100ms.
- [ ] Cap cumulative envelope intensity to prevent overexposure at high combo rates.
- [ ] Ensure all reactive boosts decay predictably and deterministically.

Event mapping to reactive envelope:
```javascript
PIECE_LOCK:    pushEnvelope({ heat: 0.05, ember: 0.1 })
LINE_CLEAR(n): pushEnvelope({ heat: 0.1+n*0.08, bloom: 0.05+n*0.06, ripple: 0.1+n*0.1, ember: 0.1+n*0.05 })
COMBO(n):      pushEnvelope({
    heat: 0.2+n*0.12, bloom: 0.1+n*0.08, shake: 0.02+n*0.04,
    haze: 0.05+n*0.06, chromatic: 0.03+n*0.08, ember: 0.15+n*0.1,
    ripple: 0.15+n*0.12
})
```

#### 6D. Smoke and Atmosphere Enhancement
- [ ] **Volumetric smoke upgrade** — Larger, softer smoke sprites with internal glow from magma light beneath.
- [ ] **Turbulent motion** — GPU curl-noise-driven displacement for organic, swirling smoke.
- [ ] **Depth layering** — Multiple smoke layers at different Z-depths with independent motion.
- [ ] **Volcanic ash particles** — Quality-gated fine ash motes drifting in the scene for atmospheric richness.
- [ ] **Heat column effect** — Visible rising heat columns above explosion sites (quality-gated, High+ only).

#### 6E. Ambient Effects
- [ ] **Distant lightning flashes** — Rare, brief illumination flashes deep in the magma background for environmental drama.
- [ ] **Slow magma color breathing** — Very subtle hue shift cycle (±5° hue) over 30-60 seconds for organic life.
- [ ] **Foreground ember depth** — Nearest embers are bright, slightly blurred (DOF suggestion); farthest are dim.

Exit criteria:
- Hero-frame visual review passes art-direction checks.
- High-combo gameplay remains readable — board edges never obscured.
- Combo effects feel dramatically more impressive than current (A/B comparison).
- Reactive envelope system works smoothly across all event types.

---

### Phase 7: Performance Scaling and Thermal Safety (Critical)

Objective:
- Hit stable frame budgets across quality tiers and long sessions.

Files:
- Modify: `src/themes/cinder-drift/cinder-drift-theme.js`
- Modify: `src/themes/cinder-drift/cinder-drift-post.js`

Tasks:
- [ ] Add adaptive scaler (resolution + effect budget) with quality floor based on smoothed frame time.
- [ ] Add optional pipeline/material warmup (`compileAsync`) where useful.
- [ ] Validate preset switching during gameplay under stress.
- [ ] Tune quality tables by hardware class and backend path.
- [ ] Set hard budgets for draw calls, particle counts, and post cost per tier.
- [ ] Profile and optimize hot paths: magma FBM, ember simulation, burst lifecycle.

### Quality Budget Targets

| Tier | Max Draw Calls | Max Post Cost (ms) | Max Embers | Max Burst Particles | Adaptive Resolution Scale |
|------|----------------|--------------------|-----------|---------------------|---------------------------|
| Minimal | 120 | 2.0 | 400 | 2000 | 0.50 - 0.78 |
| Low | 160 | 2.5 | 800 | 5000 | 0.56 - 0.84 |
| Medium | 220 | 3.0 | 2000 | 15000 | 0.62 - 0.94 |
| High | 300 | 3.8 | 4000 | 30000 | 0.68 - 1.00 |
| Ultra | 360 | 4.2 | 6000 | 40000 | 0.72 - 1.00 |
| Extreme | 420 | 4.5 | 8000 | 50000 | 0.74 - 1.00 |

Initial target budgets:
- High @ 1080p: `>= 60 FPS`, `1% low >= 50 FPS`.
- Medium fallback path: stable `>= 60 FPS` on WebGL-equivalent mode.
- 20-minute soak: no sustained memory growth.

Exit criteria:
- Budgets met on required hardware matrix.
- No thermal runaway or severe frame pacing spikes.

---

### Phase 8: Validation Matrix and Release Gate (Critical)

Objective:
- Final correctness, fallback, and stability validation before release.

Tasks:
- [ ] Validate all capability/flag permutations (WebGPU, forced WebGL, noPost, noMRT, noCompute, noHeatHaze).
- [ ] Run repeated theme-switch and long-session soak tests (100+ activate/deactivate cycles).
- [ ] Verify no GPU/renderer/resource leaks in dev diagnostics.
- [ ] Validate all gameplay events: `LINE_CLEAR`, `COMBO`, `PIECE_LOCK`.
- [ ] Verify no rendering artifacts (flicker, z-fighting, exploding bloom, heat haze bleed).
- [ ] Run 30+ minute soak tests for memory stability.
- [ ] Freeze final quality budgets and update documentation.
- [ ] Remove proven-dead legacy branches only after signoff.

Exit criteria:
- Validation checklist passes on required platforms.
- Release candidate approved with reproducible capture package.
- No regressions in gameplay-triggered visuals.
- No growing memory trend during soak tests.

---

## Testing and Validation Matrix

### Functional
- Backend startup scenarios:
  - WebGPU available
  - WebGPU unavailable
  - forced WebGL
  - post disabled
  - MRT disabled
  - compute disabled
  - heat haze disabled
- Theme switch stress: repeated activate/deactivate cycles.
- Event stress: deterministic combo spam sequences.

### Visual
- Side-by-side captures by preset/backend against baseline pack.
- Hero-frame checks:
  - magma flow quality and crust definition
  - rock silhouette contrast against magma
  - ember depth layering and brightness
  - bloom containment (dark rocks don't glow)
  - combo effect intensity and readability
  - heat haze distortion quality

### Hardware Matrix (Required)
- Windows desktop NVIDIA (WebGPU + WebGL).
- Windows desktop AMD/Intel (WebGPU + WebGL).
- Apple Silicon macOS (WebGPU + WebGL).
- Intel macOS (WebGL mandatory, WebGPU optional).
- Linux desktop target class (WebGL mandatory, WebGPU optional).

### Performance
- Track per backend/preset:
  - average FPS
  - 1% low
  - frame-time variance
  - draw calls
  - memory footprint
- 20-minute soak test for leak detection.

---

## Risk Register and Mitigations

1. **Magma FBM is expensive on low-end hardware.**
   Mitigation: Quality-tiered octave count (3-6); adaptive resolution scaling on post targets.

2. **Compute instability on driver/browser combinations.**
   Mitigation: Capability gating, immediate CPU fallback, and diagnostic logging.

3. **MRT incompatibility or material misconfiguration.**
   Mitigation: Explicit emissive audits and automatic non-MRT fallback path.

4. **Heat haze distortion bleeds into game board area.**
   Mitigation: UV-space masking of board region; kill switch (`cinderNoHeatHaze`); per-preset enable/disable.

5. **Bloom washout on volcanic scenes (everything is orange).**
   Mitigation: Per-material bloom class weights; MRT emissive isolation; deep-black grading.

6. **Lifecycle leaks during frequent theme switching.**
   Mitigation: Centralized disposable tracking, timer set cleanup, and automated soak validation.

7. **Combo effects stack to overexposure.**
   Mitigation: Hard intensity caps on reactive envelope; cumulative ceiling per channel.

8. **Double tone mapping (washed highlights).**
   Mitigation: Explicit color-pipeline ownership: post graph OR renderer, never both.

9. **Ember shader currently broken (empty fragment).**
   Mitigation: Fixed in Phase 0 before any further work.

10. **Rock instancing regressions (individual material variations).**
    Mitigation: Use per-instance attributes for variation; keep fallback individual meshes during development.

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rendering mode | Synchronous `render()` | Matches gold standard; avoids async frame timing complexity |
| Material return pattern | `{ material, uniforms, meta }` tuple | Clean separation; enables MRT audit logging |
| Bloom control | Per-material class weights | Prevents bloom washout on volcanic scenes (critical for this theme) |
| Noise implementation | TSL `tslHash` + `tslNoise2D` + `tslFbm` | Compile-time graph construction; GPU-native |
| Rock architecture | `InstancedMesh` | 7x draw-call reduction; scalable rock count |
| Ember architecture | GPU compute + `PointsNodeMaterial` | Massive particle count with zero CPU overhead |
| Burst architecture | Single compute pool | Eliminates 8-pool draw call overhead; enables 50k particles |
| Heat haze | TSL post-processing effect | Screen-space efficiency; per-frame reactive intensity |
| MRT fail-safe | Disable MRT if any non-node material | Prevents mixed-material rendering crashes |
| Device loss | Auto-restart with WebGL fallback | Graceful recovery without user intervention |
| Color pipeline | Post owns tonemapping on WebGPU post path | Prevents double tonemap and highlight washout |
| Shader compilation | Timeout-guarded `compileAsync` (3s max) | Prevents indefinite stall on slow devices |
| Timer management | Tracked timer set, cleared on `stop()` | Prevents setTimeout leaks across theme switches |
| Compute buffer layout | 16-byte aligned `vec4` packing | Cross-driver WGSL safety |
| Combo effects | Multi-channel reactive envelope with decay | Extensible, capped, deterministic |

---

## Definition of Done

- Stable hybrid rendering with silent WebGL fallback.
- Deterministic baseline and replay tooling in place.
- WebGPU visual uplift validated as masterpiece-quality volcanic environment.
- Emissive-only bloom creates cinematic magma glow without washing out dark surfaces.
- Heat haze distortion adds cinematic depth above hot surfaces.
- Combo effects are dramatically more impressive with layered escalation and reactive envelope.
- Gameplay readability preserved under all combo stress scenarios.
- Performance/reliability targets met across required hardware matrix.
- Documentation reflects shipped architecture, flags, and quality budgets.
- All Phase 0 bugs fixed (ember shader, resize leak, disposal gaps).
- Volcanic rocks visible and properly instanced.
- No `setTimeout` leaks on theme switch.
