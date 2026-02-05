# Black Hole Theme - WebGPU Hybrid Upgrade Plan

## Executive Summary

This plan upgrades the Black Hole theme to a hybrid WebGPU/WebGL2 renderer with explicit, reliable fallback handling. The theme is a breathtaking cosmic visualization featuring a raymarched black hole with gravitational lensing, volumetric accretion disk with Doppler effects, twinkling starfield, nebula clouds, and GPU-driven stardust particles spiraling into the event horizon. WebGPU will unlock compute shaders for particle physics simulation, enhanced gravitational lensing, real-time ray marching, and advanced post-processing that will elevate this to world-class visual quality.

**Key Outcomes:**
- WebGPU first, explicit fallback to WebGL2
- TSL (Three Shading Language) node materials for all 7 custom shaders on WebGPU path
- Compute shaders for particle physics, gravitational field simulation, and burst spark effects
- Enhanced visual fidelity: improved gravitational lensing, volumetric accretion disk, enhanced bloom
- Performance improvements through GPU-driven animation and reduced CPU work (particle physics offloaded)
- Electron-compatible, with Chromium WebGPU support validated

**Scope:** `src/themes/black-hole/` only

---

## Hybrid Approach (Project-Specific Definition)

Use `THREE.WebGPURenderer` from `three/webgpu`, initialize with `await renderer.init()`, and explicitly fall back to `THREE.WebGLRenderer` if WebGPU initialization fails. Feature paths must be gated by actual backend type.

**Core Rule:** WebGPU path uses TSL node materials + `THREE.PostProcessing` + Compute shaders. WebGL fallback path keeps existing `ShaderMaterial` + basic EffectComposer.

```js
import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';

const forceWebGL = new URLSearchParams(window.location.search).has('forceWebGL');
let webgpuRenderer = null;

if (!forceWebGL) {
    webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
        antialias: this.getAntialiasEnabled(),
        powerPreference: 'high-performance',
    });

    try {
        await webgpuRenderer.init();
    } catch (error) {
        console.warn('[BlackHole] WebGPU init failed, falling back to WebGL2:', error);
        webgpuRenderer.dispose();
        webgpuRenderer = null;
    }
}

if (webgpuRenderer && webgpuRenderer.backend?.isWebGPUBackend === true) {
    this.renderer = webgpuRenderer;
    this.isWebGPU = true;
} else {
    this.renderer = new THREE.WebGLRenderer({
        antialias: this.getAntialiasEnabled(),
        powerPreference: 'high-performance',
    });
    this.isWebGPU = false;
}
```

---

## Current State Snapshot

### Renderer & Scene
- `THREE.WebGLRenderer` with alpha:false
- `THREE.EffectComposer` with `UnrealBloomPass`, `ShaderPass`
- `THREE.Clock` for animation timing
- Manual rAF loop with `registerAnimation()`
- Perspective camera with gentle orbital sway animation

### Custom GLSL Shaders (ShaderMaterial)

| Shader | Location | Purpose |
|--------|----------|---------|
| `BlackHoleShader` | black-hole-theme.js | Event horizon, photon sphere, Hawking radiation shimmer with FBM noise |
| `AccretionDiskShader` | black-hole-theme.js | Volumetric disk with turbulence, spiral arms, temperature gradient, Doppler shift |
| `BurstSparkVertexShader` / `BurstSparkFragmentShader` | black-hole-theme.js | Explosive spherical burst particles from event horizon |
| `VignetteShader` | black-hole-theme.js | Post-processing: edge darkening |
| `ChromaticAberrationShader` | black-hole-theme.js | Post-processing: RGB channel separation |
| Starfield shader (inline) | black-hole-theme.js | Twinkling stars with flash response |
| Particle shader (inline) | black-hole-theme.js | Stardust with color and lifetime |

### Scene Elements

| Element | Count (High Preset) | Notes |
|---------|---------------------|-------|
| Black Hole Core | 1 plane (600x600) | Raymarched shader |
| Event Horizon Sphere | 1 sphere (radius 120) | Solid black mesh |
| Accretion Disk | 2 rings (inner 140, outer 400) | Main + glow layer |
| Starfield | 2,000 points | Twinkling, flash-reactive |
| Nebula Clouds | 15 planes | Canvas-generated gradients |
| Particle System | 6,000 points | Stardust spiraling inward |
| Burst Spark Pool | 8 systems x ~625 particles | Event horizon explosions |

### Quality Presets

```js
Extreme:  { starCount: 3000, particleCount: 10000, nebulaCount: 25, diskSegments: 128, burstSparkCount: 8000, bloomStrength: 0.6 }
Ultra:    { starCount: 2500, particleCount: 8000,  nebulaCount: 20, diskSegments: 96,  burstSparkCount: 6000, bloomStrength: 0.55 }
High:     { starCount: 2000, particleCount: 6000,  nebulaCount: 15, diskSegments: 64,  burstSparkCount: 5000, bloomStrength: 0.5 }
Medium:   { starCount: 1200, particleCount: 4000,  nebulaCount: 10, diskSegments: 48,  burstSparkCount: 3500, bloomStrength: 0.4 }
Low:      { starCount: 600,  particleCount: 2000,  nebulaCount: 6,  diskSegments: 32,  burstSparkCount: 2000, bloomStrength: 0.3 }
Minimal:  { starCount: 300,  particleCount: 1000,  nebulaCount: 4,  diskSegments: 24,  burstSparkCount: 1200, bloomStrength: 0.2 }
```

### Event System Integration
- `EVENTS.PIECE_LOCK` → Core flash, star flash, bloom pulse, chromatic pulse
- `EVENTS.LINE_CLEAR` → Disk intensity boost, rotation speed increase, star/bloom flash
- `EVENTS.COMBO` → Gravity surge (suction), burst phase (explosion), jet particles, burst sparks trigger

### Current Particle Physics (CPU-bound)
- Gravitational pull toward black hole center
- Tangential orbital velocity
- Suction surge during combos
- Outward burst phase after combos
- Velocity damping and speed limits
- Respawn when too close or too far

---

## Compatibility Constraints

- `ShaderMaterial` and GLSL shaders are WebGL-centric; WebGPU path must use TSL node materials
- `EffectComposer` is WebGL-only; WebGPU uses `THREE.PostProcessing`
- FBM noise in black hole/disk shaders must be ported to TSL noise functions
- Point sprite `gl_PointCoord` must use `pointUV` in TSL
- WebGPU point primitives are 1px only; stars/particles that need larger sprites must use instanced quads or `Sprite` + `SpriteNodeMaterial` on the WebGPU path
- Canvas-generated nebula textures work in both backends
- Particle physics currently CPU-bound; WebGPU enables compute offload

## Platform & Version Constraints

- Three.js version: **0.181.2** (from `package-lock.json`). All WebGPU/TSL APIs must match this revision.
- Electron version: **38.3.0** (from `package.json`). WebGPU must be validated in Electron runtime.
- Visual parity policy: **WebGPU can look better** than WebGL in core look-defining elements (gravitational lensing, accretion disk, particle density). WebGL visuals must remain acceptable and stable, not necessarily identical.
- Platform focus: **Electron is the first-class WebGPU target**. Safari WebGPU is not a target path and should be treated as fallback-only.

## Best-In-Class Additions (Required)

### A. Capability Matrix + Kill Switches
Define a strict capability matrix and per-feature kill switches to avoid brittle startup paths.

**Matrix (example):**
- WebGPU + MRT + Compute → Full feature set (GPU particles, enhanced lensing, emissive bloom)
- WebGPU + MRT only → No compute-driven particles (CPU fallback), standard TSL materials
- WebGPU no MRT → Standard bloom (non-emissive), no emissive isolation
- WebGL2 → Existing ShaderMaterial + EffectComposer path

**New debug flags:**
- `?blackHoleNoCompute=1` - Disable all compute kernels, use CPU updates
- `?blackHoleNoMRT=1` - Disable emissive MRT bloom path
- `?blackHoleNoLensing=1` - Disable enhanced gravitational lensing compute
- `?blackHoleNoPost=1` - Disable all WebGPU post-processing (use direct render)
- `?forceWebGL=1` - Force WebGL2 fallback

**Rules:**
- Every advanced feature must be guard-railed behind a capability check and a kill switch.
- Startup should never fail due to a missing optional feature.

**Flag Derivation (example):**
- `flags.usePost = isWebGPU && !noPost`
- `flags.useMRT = flags.usePost && !noMRT`
- `flags.useCompute = isWebGPU && !noCompute`
- `flags.useLensing = flags.useCompute && !noLensing`

### B. WebGPU Warm-Up / Render Path
Document a backend-specific render path for Three.js `0.181.2`:
- WebGPU: call `await renderer.init()` once, then use `render()`. Optionally call `await renderer.compileAsync(scene, camera)` or render a hidden warm-up frame to compile pipelines before the first visible frame. (`renderAsync()` is deprecated in r181.)
- WebGL2: use `render()` / `composer.render()`.
- Explicitly state which backend uses which path in the implementation notes.

### C. Storage Buffer Layout & Alignment
Define compute buffer layouts with explicit padding to avoid WGSL alignment issues.

**Example (64-byte stride, alignment-safe):**
```wgsl
struct Particle {
    position : vec4f,   // xyz + spare
    velocity : vec4f,   // xyz + spare
    life     : vec4f,   // lifetime, color.r, color.g, color.b
    misc     : vec4f,   // size, active, random, spare
}
```
**CPU packing rules:**
- Always upload in 16-byte aligned `vec4f` blocks.
- Treat `active` as float to avoid alignment surprises.
- Document byte stride and offsets next to the struct definition.

### D. GPU Pass Timing
Add pass-level GPU timing when supported (timestamp queries).
- Gate on `renderer.hasFeature('timestamp-query')` after `await renderer.init()`.
- Use `TimestampQuery` (from `three/webgpu`) with `renderer.resolveTimestampsAsync(TimestampQuery.COMPUTE/RENDER)`, then read via `renderer.backend.getTimestampFrames()` + `renderer.backend.getTimestamp(uid)`.
- Capture per-pass timings (bloom, chromatic, compute).
- Use results to drive dynamic resolution scaling (Phase 7).

### E. MRT Emissive Bloom Wiring (Explicit)
Make the emissive-only bloom pipeline explicit and verifiable.
- All neon/glow materials must set `emissiveNode` to an emissive-only signal.
- Use an MRT output where **color** and **emissive** are rendered separately.
- Bloom should only sample from emissive output, not the full color output.

## Capability Probes (Best-In-Class Stability)

Before enabling advanced features, probe the backend and GPU support:
- Backend: `renderer.backend?.isWebGPUBackend`
- Feature checks: call `renderer.hasFeature(...)` only after `await renderer.init()` (e.g., `'timestamp-query'`, float/half-float filterability)
- Texture formats: verify required float/half-float render targets for bloom
- MRT support: verify `mrt` path for emissive isolation
- Storage buffers/attributes: verify compute support for particles
- Fallback: confirm WebGL2 support and degrade gracefully if missing features

## Compute → Render Data Flow (Best-In-Class Performance)

Define a zero-readback pipeline where compute writes directly into buffers consumed by render:
- Particle positions/velocities in storage buffers
- Burst spark states in storage buffers
- Gravitational field parameters in uniform buffers
- Ping-pong buffers to avoid write/read hazards
- Render path reads buffers via storage attributes or node accessors
- WebGPU sprite path: feed instance positions/sizes/colors from storage buffers into instanced quads (billboarded)
- CPU only updates high-level event parameters, never per-particle data

---

## WebGPU Visual Enhancement Opportunities

The Black Hole theme's cosmic aesthetic can be dramatically enhanced with WebGPU capabilities:

### 1. Enhanced Gravitational Lensing
- Compute shader-based light bending simulation
- Real-time Einstein ring calculation around event horizon
- Star position distortion in lensing field
- Background warping based on distance to singularity

### 2. Volumetric Accretion Disk
- Current implementation: 2D ring with shader
- WebGPU upgrade: 3D volumetric ray marching through disk
- Variable density based on distance from center
- More accurate light absorption and emission

### 3. Emissive-Only Bloom
- MRT (Multiple Render Targets) to isolate glowing elements
- Bloom only affects: photon sphere, accretion disk, particles, burst sparks
- Prevents bloom bleeding on dark background
- Configurable bloom radius per-element type

### 4. GPU-Driven Particle Physics
- Compute shader gravitational simulation
- 20,000+ particles with same CPU cost as current 6,000
- Accurate orbital mechanics around Schwarzschild metric
- Real-time gravitational time dilation visualization

### 5. Compute-Driven Burst Sparks
- Current: 8-system pool with shader-driven positions
- WebGPU: Single compute-driven system with 50,000+ particles
- GPU-side spawn queue for immediate burst response
- Complex particle interactions (collision, attraction)

### 6. Enhanced Starfield
- Gravitational lensing effect on background stars
- Stars visibly stretched near event horizon
- Compute shader for parallax distortion
- Higher density starfield with GPU instancing

### 7. Hawking Radiation Visualization
- Compute shader particle spawning at event horizon
- Virtual particle pair creation/annihilation
- Photon escape trajectory calculation

### 8. Relativistic Jet Effects
- Compute-driven bipolar jets from poles
- Magnetic field line visualization
- Particle acceleration along jet axis

---

## Phased Implementation Plan

### Phase 0: Audit & Baseline (Priority: CRITICAL)
**Objective:** Inventory all WebGL-only features and establish visual/performance baselines.

**Tasks:**
- [ ] List every ShaderMaterial and map to TSL replacement strategy
- [ ] Capture screenshots and FPS for each quality preset (WebGL baseline)
- [ ] Add internal `forceWebGL` toggle for testing fallback behavior
- [ ] Document current uniform values and animation parameters
- [ ] Record exact Three.js + Electron versions used by the theme
- [ ] Define parity expectations: WebGPU can be better; WebGL must be acceptable
- [ ] Add deterministic test flags (`?blackHoleSeed=`, `?blackHoleFixedDt=`) for consistent capture
- [ ] Decide baseline GPU/CPU frame-time budgets per preset

**ShaderMaterial Inventory:**

| Material | Location | TSL Target |
|----------|----------|-----------|
| Black hole core material | `createBlackHoleCore()` | `MeshBasicNodeMaterial` with TSL FBM |
| Accretion disk material | `createAccretionDisk()` | `MeshBasicNodeMaterial` with TSL noise |
| Starfield material | `createStarfield()` | `SpriteNodeMaterial` (WebGPU instanced quads) / `PointsNodeMaterial` (WebGL) |
| Particle material | `createParticleSystem()` | `SpriteNodeMaterial` (WebGPU instanced quads) / `PointsNodeMaterial` (WebGL) |
| Burst spark material | `createBurstSparks()` | `PointsNodeMaterial` with compute |
| Nebula material | `createNebulaClouds()` | `MeshBasicMaterial` (unchanged) |

**Baseline Capture Template:**
```
- Machine/GPU:
- Browser + version:
- Resolution + pixel ratio:
- Preset (Minimal/Low/Medium/High/Ultra/Extreme):
- Backend (WebGL2/WebGPU):
- Avg FPS / 1% low:
- Notes (visual issues, errors):
- Screenshot path:
```

**Debug flags:**
- `?blackHoleBaseline=1` - Enable baseline logging
- `?forceWebGL=1` - Force WebGL2 fallback
- `?blackHoleSeed=1234` - Deterministic RNG seed for captures
- `?blackHoleFixedDt=16.666` - Fixed timestep for deterministic runs (ms)

---

### Phase 1: Hybrid Renderer Bootstrapping (Priority: CRITICAL)
**Objective:** Initialize WebGPU renderer with built-in fallback and set up backend detection.

**Files to modify:**
- `src/themes/black-hole/black-hole-theme.js`

**Tasks:**
- [ ] Use dual imports: `three/webgpu` for WebGPU + nodes, `three` for WebGL fallback
- [ ] Make `createScene()` async and `await renderer.init()`
- [ ] Call `renderer.hasFeature()` / access `renderer.backend` only after `await renderer.init()` (avoid deprecated `renderAsync()`)
- [ ] Set `this.isWebGPU = renderer.backend?.isWebGPUBackend === true`
- [ ] Keep renderer defaults aligned with existing look (tone mapping, color space)
- [ ] Handle init errors gracefully (explicit fallback to WebGL2)
- [ ] Update container attachment after async init
- [ ] Add device-lost handler and re-init path (WebGPU only)

**Code Changes:**
```js
// Before
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
// ...
this.renderer = new THREE.WebGLRenderer({ antialias: this.getAntialiasEnabled(), alpha: false });

// After
import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
// ...
async initRenderer(container) {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Try WebGPU first
    let webgpuRenderer = null;
    if (!this.flags.forceWebGL) {
        webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });

        try {
            await webgpuRenderer.init();
        } catch (error) {
            console.warn('[BlackHole] Renderer init error, using fallback:', error.message);
            webgpuRenderer.dispose();
            webgpuRenderer = null;
        }
    }

    if (webgpuRenderer && webgpuRenderer.backend?.isWebGPUBackend === true) {
        this.renderer = webgpuRenderer;
        this.isWebGPU = true;
    } else {
        this.renderer = new THREE.WebGLRenderer({
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });
        this.isWebGPU = false;
    }

    console.log(`[BlackHole] Using ${this.isWebGPU ? 'WebGPU' : 'WebGL2'} backend`);

    this.renderer.setClearColor(0x000005, 1);
    this.renderer.setPixelRatio(this.getEffectivePixelRatio());
    this.renderer.setSize(width, height);
    // ... rest of setup
}
```

**Implementation Notes:**
- Enforce the capability matrix and kill switches at renderer init time (`?blackHoleNoCompute`, `?blackHoleNoMRT`, etc.).
- Parse query params once into a `this.flags` object and thread into materials/post/compute.
- Use the backend-specific render path: WebGPU `render()` after `await renderer.init()` (optionally `compileAsync`/warm-up), WebGL2 `render()`.
- Keep Electron as the first-class target.

---

### Phase 2: Render Loop & Resize (Priority: HIGH)
**Objective:** Ensure animation loop works cleanly across WebGPU and fallback.

**Tasks:**
- [ ] Keep current rAF loop for `registerAnimation()` compatibility
- [ ] Switch to `renderer.render()` after init (no `renderAsync`)
- [ ] If WebGPU + PostProcessing and `?blackHoleNoPost` is not set, call `postProcessing.render()` instead of `renderer.render()`
- [ ] WebGL fallback uses `composer.render()`
- [ ] Update resize handling for WebGPU PostProcessing passes
- [ ] Ensure `this.clock` continues working correctly
- [ ] Define per-frame order: compute → material uniform updates → post → render
- [ ] Respect `?blackHoleFixedDt=` for deterministic runs

**Resize Handler Update:**
```js
resize(width, height) {
    if (this.camera) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }
    if (this.renderer) this.renderer.setSize(width, height);

    // WebGPU post-processing
    if (this.isWebGPU && this.postProcessing) {
        this.postProcessing.setSize(width, height);
    }

    // WebGL EffectComposer
    if (!this.isWebGPU && this.composer) {
        this.composer.setSize(width, height);
    }
}
```

---

### Phase 3: TSL Material Library (Priority: CRITICAL)
**Objective:** Create TSL node materials for all custom shaders.

**Files to create:**
- `src/themes/black-hole/black-hole-materials.js`

**Material Conversion Order:**
1. **Black Hole Core Material** - Most complex, FBM noise + gravitational lensing
2. **Accretion Disk Material** - FBM turbulence + Doppler effect
3. **Starfield Material** - Twinkling with flash response
4. **Particle Material** - Stardust with lifetime
5. **Burst Spark Material** - Explosive particles (later compute-driven)

**Critical WebGPU Constraint (Points):**
- WebGPU supports 1px point size for `Points` only. Stars/particles that rely on larger sprites must be rendered as instanced quads (`Sprite`/`InstancedMesh`) on the WebGPU path.
- Keep the WebGL fallback path on `Points` + GLSL to avoid regressions.

**TSL Material Factory Pattern:**
```js
// black-hole-materials.js
import {
    AdditiveBlending,
    DoubleSide,
    MeshBasicNodeMaterial,
    NormalBlending,
    PointsNodeMaterial,
    SpriteNodeMaterial,
} from 'three/webgpu';
import {
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
    float,
    sin,
    cos,
    smoothstep,
    mix,
    fract,
    abs,
    length,
    step,
    pow,
    max,
    min,
    exp,
    atan2,
    dot,
    floor,
    positionLocal,
    pointUV,
    attribute,
} from 'three/tsl';

// ============================================================================
// TSL NOISE FUNCTIONS
// ============================================================================

function tslHash(p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
}

function tslNoise(p) {
    const i = floor(p);
    const f = fract(p);
    const smoothF = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

    const a = tslHash(i);
    const b = tslHash(i.add(vec2(1.0, 0.0)));
    const c = tslHash(i.add(vec2(0.0, 1.0)));
    const d = tslHash(i.add(vec2(1.0, 1.0)));

    return mix(mix(a, b, smoothF.x), mix(c, d, smoothF.x), smoothF.y);
}

function tslFbm(p, octaves = 5) {
    let v = float(0.0);
    let a = float(0.5);
    let coord = p;
    for (let i = 0; i < octaves; i++) {
        v = v.add(a.mul(tslNoise(coord)));
        coord = coord.mul(2.0);
        a = a.mul(0.5);
    }
    return v;
}

// ============================================================================
// BLACK HOLE CORE MATERIAL
// ============================================================================

export function createBlackHoleCoreNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
        blending: AdditiveBlending,
    });

    const uTime = uniform(0);
    const uIntensity = uniform(1.0);
    const uScale = uniform(1.0);

    const uvCoord = uv().mul(2.0).sub(1.0);
    const dist = length(uvCoord);

    // Event horizon (absolute black center)
    const eventHorizon = float(0.25).mul(uScale);

    // Photon sphere (bright ring)
    const photonSphere = float(0.4).mul(uScale);
    const photonWidth = float(0.08);

    // Black hole center
    const black = smoothstep(eventHorizon.add(0.02), eventHorizon.sub(0.02), dist);

    // Photon ring glow
    const photonDist = dist.sub(photonSphere).div(photonWidth);
    const photonRing = exp(photonDist.mul(photonDist).negate()).mul(uIntensity);

    // Hawking radiation shimmer
    const shimmerCoord = uvCoord.mul(8.0).add(uTime.mul(0.5));
    const shimmer = tslFbm(shimmerCoord, 5).mul(0.3);
    const shimmerMask = smoothstep(float(0.5), float(0.3), dist).mul(float(1.0).sub(black));
    const photonRingWithShimmer = photonRing.add(shimmer.mul(shimmerMask));

    // Colors
    const orangeColor = vec3(1.0, 0.6, 0.2);
    const whiteColor = vec3(1.0, 1.0, 1.0);
    const blueColor = vec3(0.4, 0.6, 1.0);

    let photonColor = mix(orangeColor, whiteColor, photonRingWithShimmer);
    photonColor = mix(photonColor, blueColor, smoothstep(float(0.35), float(0.5), dist).mul(0.3));

    // Final color
    let color = photonColor.mul(photonRingWithShimmer).mul(uIntensity);
    color = mix(color, vec3(0.0, 0.0, 0.0), black);

    const alpha = photonRingWithShimmer.mul(float(1.0).sub(black)).add(black.mul(0.95));

    material.colorNode = color;
    material.opacityNode = alpha;

    material.userData = { uTime, uIntensity, uScale };

    return material;
}

// ============================================================================
// ACCRETION DISK MATERIAL
// ============================================================================

export function createAccretionDiskNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
        blending: NormalBlending,
    });

    const uTime = uniform(0);
    const uIntensity = uniform(1.0);
    const uRotationSpeed = uniform(1.0);

    const pos = positionLocal;
    const angle = atan2(pos.z, pos.x);
    const radius = length(vec2(pos.x, pos.z));

    // Normalize radius
    const innerRadius = float(120.0);
    const outerRadius = float(400.0);
    const normalizedRadius = radius.sub(innerRadius).div(outerRadius.sub(innerRadius)).clamp(0.0, 1.0);

    // Animated rotation
    const rotatedAngle = angle.add(uTime.mul(uRotationSpeed).mul(0.15));

    // Turbulent plasma flow
    const turbUv = vec2(rotatedAngle.mul(2.0), normalizedRadius.mul(8.0));
    const turb = tslFbm(turbUv.add(uTime.mul(0.1)), 5);

    // Spiral arms
    const spirals = sin(rotatedAngle.mul(3.0).add(normalizedRadius.mul(15.0)).add(turb.mul(3.0)));
    const spiralFactor = spirals.mul(0.3).add(0.7);

    // Temperature gradient
    const temp = float(1.0).sub(pow(normalizedRadius, float(0.5)));

    // Color palette
    const innerColor = vec3(1.0, 0.7, 0.4);
    const midColor = vec3(0.9, 0.4, 0.15);
    const outerColor = vec3(0.5, 0.15, 0.08);

    const lowMix = mix(outerColor, midColor, temp.mul(2.0));
    const highMix = mix(midColor, innerColor, temp.sub(0.5).mul(2.0));
    let baseColor = mix(lowMix, highMix, step(float(0.5), temp));

    // Turbulence effect
    baseColor = baseColor.mul(float(0.8).add(turb.mul(0.4)));

    // Doppler effect
    const doppler = sin(angle).mul(0.15);
    const blueShift = vec3(0.6, 0.7, 1.0);
    const redShift = vec3(0.9, 0.2, 0.05);
    baseColor = mix(baseColor, blueShift, max(float(0.0), doppler));
    baseColor = mix(baseColor, redShift, max(float(0.0), doppler.negate()));

    // Brightness
    const brightness = float(0.4).add(spiralFactor.mul(0.3)).add(turb.mul(0.2)).mul(uIntensity).mul(0.6);

    // Edge fade
    const innerFade = smoothstep(float(0.0), float(0.25), normalizedRadius);
    const outerFade = smoothstep(float(1.0), float(0.7), normalizedRadius);
    const edgeFade = innerFade.mul(outerFade);

    material.colorNode = baseColor.mul(brightness);
    material.opacityNode = edgeFade.mul(brightness).mul(0.7);

    material.userData = { uTime, uIntensity, uRotationSpeed };

    return material;
}

// ============================================================================
// STARFIELD MATERIAL
// ============================================================================

export function createStarfieldNodeMaterial() {
    // WebGPU path: use SpriteNodeMaterial + instanced quads for >1px size
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexColors: true,
    });

    const uTime = uniform(0);
    const uFlashIntensity = uniform(0);

    const aSize = attribute('size');
    const aPhase = attribute('phase');

    // Twinkle animation
    const twinkle = sin(uTime.mul(2.0).add(aPhase)).mul(0.3).add(0.7);
    const flash = float(1.0).add(uFlashIntensity);

    material.sizeNode = aSize;

    // Fragment: soft circular point
    const center = pointUV.sub(0.5); // WebGL points path. For WebGPU sprite/quad path use uv().sub(0.5).
    const dist = length(center);
    const alpha = float(1.0).sub(dist.mul(2.0)).mul(twinkle).mul(flash);

    material.colorNode = vec3(1.0, 1.0, 1.0).mul(flash);
    material.opacityNode = alpha;

    material.userData = { uTime, uFlashIntensity };

    return material;
}

// ============================================================================
// PARTICLE MATERIAL
// ============================================================================

export function createParticleNodeMaterial() {
    // WebGPU path: use SpriteNodeMaterial + instanced quads for >1px size
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexColors: true,
    });

    const aLifetime = attribute('lifetime');
    const aSize = attribute('size');

    material.sizeNode = aSize;

    // Fragment: soft circular point with lifetime fade
    const center = pointUV.sub(0.5); // WebGL points path. For WebGPU sprite/quad path use uv().sub(0.5).
    const dist = length(center);
    const alpha = float(1.0).sub(dist.mul(2.0)).mul(min(float(1.0), aLifetime));

    material.opacityNode = alpha.mul(0.8);

    material.userData = {};

    return material;
}
```

**Tasks:**
- [ ] Create `black-hole-materials.js` with material factory functions
- [ ] Port FBM noise to TSL
- [ ] WebGPU: replace starfield/particle `Points` with instanced sprites/quads (use `SpriteNodeMaterial` or instanced planes) to support >1px size
- [ ] Adjust UV usage (`pointUV` for WebGL points, `uv()` for WebGPU sprites)
- [ ] Add emissive outputs for MRT bloom compatibility
- [ ] Gate material selection on `this.isWebGPU`
- [ ] Ensure color management matches WebGL
- [ ] Add explicit `emissiveNode` for bloom-only elements

---

### Phase 4: WebGPU Post-Processing (Priority: HIGH)
**Objective:** Implement advanced post-processing for WebGPU path.

**Files to create:**
- `src/themes/black-hole/black-hole-post.js`

**Post-Processing Stack:**
1. **Emissive-Only Bloom** - MRT to isolate glowing elements (photon ring, accretion disk, particles)
2. **Chromatic Aberration** - RGB channel separation
3. **Vignette** - Edge darkening

**Implementation:**
```js
// black-hole-post.js
import { PostProcessing } from 'three/webgpu';
import { pass, mrt, output, emissive, renderOutput, uv, float, length, smoothstep, Fn } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';

// Custom vignette helper (TSL). Port from VignetteShader.
const applyVignette = Fn( ( [ node, offset, darkness ] ) => {
    const dist = length( uv().sub( 0.5 ) ).mul( offset );
    const vig = smoothstep( float( 0.6 ), float( 1.0 ), dist ).mul( darkness );
    return node.mul( float( 1.0 ).sub( vig ) );
} );

export class BlackHolePost {
    constructor(renderer, scene, camera, preset, flags) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.preset = preset;
        this.flags = flags;

        this.postProcessing = new PostProcessing(renderer);
        this.postProcessing.outputNode = this.createOutputNode();
    }

    createOutputNode() {
        const scenePass = pass(this.scene, this.camera);

        if (this.flags.useMRT) {
            scenePass.setMRT(mrt({ output, emissive }));
        }

        const color = scenePass.getTextureNode('output');
        const emissiveTex = this.flags.useMRT ? scenePass.getTextureNode('emissive') : color;

        let result = color;

        if (this.flags.useBloom) {
            result = result.add(
                bloom(emissiveTex, this.preset.bloomStrength || 0.5, this.preset.bloomRadius || 0.6, 0.5)
            );
        }

        if (this.flags.useChromatic) {
            result = chromaticAberration(result, this.preset.chromaticStrength || 0.002);
        }

        result = applyVignette(result, 1.2, 0.5);
        return renderOutput(result);
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        this.postProcessing.setSize(width, height);
    }

    dispose() {
        this.postProcessing.dispose();
    }
}
```

**Tasks:**
- [ ] Create `black-hole-post.js` with MRT bloom pipeline
- [ ] Use `pass(scene, camera)` and `scenePass.setMRT(mrt({ output, emissive }))` to isolate emissive
- [ ] Use `bloom` and `chromaticAberration` from `three/addons/tsl/display/*`
- [ ] Add emissive outputs to all node materials
- [ ] Port chromatic aberration to TSL post-processing node
- [ ] Implement vignette as a custom TSL node (no built-in node in `three/tsl`)
- [ ] Integrate with main theme render loop
- [ ] WebGL fallback uses existing EffectComposer pipeline
- [ ] Add resolution scaling for heavy passes

**Implementation Notes:**
- Implement explicit MRT wiring (color + emissive) and ensure bloom samples emissive only.
- Gate bloom/chromatic behind capability checks and kill switches.
- Add pass-level GPU timing (when supported) to validate post stack costs.

---

### Phase 5: GPU Compute Shaders (Priority: HIGH - WebGPU Exclusive)
**Objective:** Offload particle physics to GPU for massive performance gains.

**Files to create:**
- `src/themes/black-hole/black-hole-compute.js`

**Compute Shader Applications:**

#### 5.1 Particle Physics Compute
- Gravitational field simulation
- Orbital velocity calculation
- Schwarzschild metric approximation
- Burst/suction phase physics
- 20,000+ particles with zero CPU physics overhead

```wgsl
// Particle compute kernel (conceptual WGSL)
struct Particle {
    position: vec4f,   // xyz + spare
    velocity: vec4f,   // xyz + spare
    life: vec4f,       // lifetime, colorR, colorG, colorB
    misc: vec4f,       // size, active, random, spare
}

struct Uniforms {
    blackHolePos: vec4f,
    deltaTime: f32,
    gravitySurgeFactor: f32,
    burstFactor: f32,
    burstPhase: f32,
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
    if (i >= arrayLength(&particles)) { return; }

    var p = particles[i];
    if (p.misc.y < 0.5) { return; } // inactive

    let bhPos = uniforms.blackHolePos.xyz;
    let toCenter = bhPos - p.position.xyz;
    let dist = length(toCenter);

    if (dist > 50.0) {
        let dir = normalize(toCenter);

        if (uniforms.burstPhase > 0.5) {
            // Outward burst
            let burstStrength = uniforms.burstFactor * (400.0 / (dist + 50.0)) * uniforms.deltaTime;
            p.velocity.xyz -= dir * burstStrength;
            p.velocity.xyz *= 0.998;
        } else {
            // Gravitational pull
            var pullStrength = (800.0 / (dist * dist + 100.0)) * uniforms.deltaTime;
            if (uniforms.gravitySurgeFactor > 0.0) {
                pullStrength *= (5.0 + uniforms.gravitySurgeFactor * 2.0);
            }
            p.velocity.xyz += dir * pullStrength;
            p.velocity.xyz *= 0.995;
        }

        // Speed limit
        let speed = length(p.velocity.xyz);
        let maxSpeed = select(8.0, 15.0 + uniforms.burstFactor * 3.0, uniforms.burstPhase > 0.5);
        if (speed > maxSpeed) {
            p.velocity.xyz = normalize(p.velocity.xyz) * maxSpeed;
        }
    }

    // Update position
    p.position.xyz += p.velocity.xyz;

    // Respawn check
    let maxDist = select(1500.0, 2500.0, uniforms.burstPhase > 0.5);
    if (dist < 80.0 || dist > maxDist) {
        // Reset particle (simplified - full respawn logic in JS)
        p.misc.y = 0.0; // Mark for respawn
    }

    particles[i] = p;
}
```

#### 5.2 Burst Sparks Compute
- Explosive spherical expansion
- Spiral motion calculation
- GPU-side lifecycle management
- Single system instead of 8-pool

#### 5.3 Gravitational Lensing Compute
- Star position distortion calculation
- Einstein ring generation
- Background warping field

**Tasks:**
- [ ] Create `black-hole-compute.js` with compute shader kernels
- [ ] Implement GPU particle buffer management
- [ ] Port particle physics to compute shader
- [ ] Port burst spark animation to compute shader
- [ ] WebGL fallback uses existing CPU animation
- [ ] Define storage buffer layouts and bind groups
- [ ] Bind compute outputs to render via `StorageBufferAttribute` / instanced attributes (no readback)
- [ ] Use ping-pong buffers for positions/velocities

---

### Phase 6: Visual Enhancements (Priority: MEDIUM)
**Objective:** Achieve "world-class" visuals leveraging WebGPU capabilities.

#### 6.1 Enhanced Gravitational Lensing
- Compute shader for star distortion around event horizon
- Visible Einstein ring effect
- Background warping near singularity
- Dynamic based on combo intensity

#### 6.2 Volumetric Accretion Disk
- Ray marching through 3D volume
- Variable density profile
- More accurate light transport
- Enhanced Doppler shifting

#### 6.3 Improved Photon Sphere
- More accurate light bending
- Multiple photon orbit visualization
- Frame dragging effects

#### 6.4 Enhanced Starfield
- Stars visibly stretched near event horizon
- Lensing-based parallax
- Higher density with GPU instancing

#### 6.5 Hawking Radiation
- Particle pair creation at event horizon
- Virtual particle visualization
- Event-reactive intensity

#### 6.6 Color & Tone Mastering
- Filmic tone mapping tuned for cosmic visuals
- Subtle color grading for deep space palette
- Dither to reduce banding in gradients

**Tasks:**
- [ ] Implement gravitational lensing compute shader
- [ ] Create enhanced star distortion material
- [ ] Add Hawking radiation particle system
- [ ] Implement volumetric disk ray marching (optional)
- [ ] Color grading pass for cosmic palette

---

### Phase 7: Performance Optimization (Priority: HIGH)
**Objective:** Maximize performance on both backends.

**Optimizations:**

#### 7.1 Particle System Consolidation
- Merge stardust and burst sparks into single GPU system
- Unified compute pass for all particles
- Reduce draw calls from multiple systems to 1-2

#### 7.2 Nebula Cloud Batching
- Merge nebula planes into single geometry
- Use instancing for cloud rendering
- Reduce draw calls from 15+ to 1

#### 7.3 Uniform Buffer Optimization
- Group frequently updated uniforms
- Minimize per-frame CPU-GPU transfers
- Use uniform blocks where possible

#### 7.4 LOD for Distant Elements
- Reduce star count based on distance
- Adaptive particle density
- Quality-based nebula detail

#### 7.5 Dynamic Resolution Scaling
- Monitor GPU frame time
- Scale render resolution when behind budget
- Maintain smooth 60fps target

**Tasks:**
- [ ] Implement particle system consolidation
- [ ] Add nebula cloud batching
- [ ] Optimize uniform update patterns
- [ ] Add LOD system for quality scaling
- [ ] Profile and optimize hot paths
- [ ] Add dynamic resolution scaling based on GPU frame time

---

### Phase 8: QA & Validation (Priority: CRITICAL)
**Objective:** Ensure visual quality and seamless fallback.

**Testing Checklist:**

#### Visual Quality
- [ ] Black hole core renders correctly
- [ ] Photon sphere glow matches
- [ ] Accretion disk spiral animation matches
- [ ] Doppler shift colors correct
- [ ] Particle gravity behavior matches
- [ ] Burst sparks explosion timing matches
- [ ] Starfield twinkling matches
- [ ] Star/particle sprite size correct on WebGPU (instanced sprites, not 1px points)
- [ ] Nebula clouds appear correctly

#### Performance Validation
- [ ] WebGPU FPS >= WebGL FPS on all presets
- [ ] No frame drops during combo effects
- [ ] Memory usage stable over time
- [ ] No GPU hangs or stutters
- [ ] Particle physics offloaded to GPU (WebGPU path)

#### Fallback Validation
- [ ] `?forceWebGL=1` uses WebGL2 backend
- [ ] No console errors on fallback
- [ ] Visual appearance acceptable on fallback
- [ ] All game events trigger correctly

#### Browser Testing
- [ ] Chrome (WebGPU + fallback)
- [ ] Firefox (fallback only, WebGPU experimental)
- [ ] Safari (WebGPU on supported versions)
- [ ] Edge (WebGPU + fallback)
- [ ] Electron build (production packaging)

**Debug Flags:**
- `?blackHoleBaseline=1` - Log FPS, backend, preset info
- `?forceWebGL=1` - Force WebGL2 fallback
- `?blackHoleDebug=1` - Enable visual debug overlays
- `?blackHoleNoPost=1` - Disable post-processing
- `?blackHoleNoCompute=1` - Disable compute shaders
- `?blackHoleSeed=1234` - Deterministic RNG seed
- `?blackHoleFixedDt=16.666` - Fixed timestep (ms)

**Tasks:**
- [ ] Create automated screenshot comparison tests
- [ ] Add FPS logging for baseline comparison
- [ ] Test on multiple GPU vendors (NVIDIA, AMD, Intel)
- [ ] Validate on mobile devices (if applicable)
- [ ] Document known limitations per backend
- [ ] Add long-run soak test for memory/GPU stability

---

## File Layout After Migration

```
src/themes/black-hole/
├── black-hole-theme.js          # Main theme (hybrid rendering)
├── black-hole-materials.js      # NEW: TSL material factory
├── black-hole-post.js           # NEW: WebGPU post-processing
├── black-hole-compute.js        # NEW: GPU compute shaders
├── black-hole-tetrominos.js     # Unchanged
└── black-hole-shaders.js        # NEW: Extracted GLSL for WebGL fallback (optional)
```

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| TSL FBM noise parity | Visual drift | Side-by-side comparison, tune parameters |
| WebGPU browser support | Limited reach | Silent fallback, WebGL path always works |
| Performance regression | User experience | Profile after each phase, keep WebGL baseline |
| MRT compatibility | Render failures | Ensure all materials have emissive output |
| WebGPU 1px point limitation | Stars/particles too small | Use instanced sprites/quads on WebGPU |
| Compute shader complexity | Development time | Prioritize particle system first, iterate |
| Device lost (WebGPU) | Black screen | Add device-lost handler and re-init path |
| Version/API drift | Build errors | Pin to Three.js 0.181.2 or update plan on bump |
| Electron GPU blocked | No WebGPU | Detect and fall back to WebGL2 |
| Gravitational lensing math | Incorrect visuals | Test against reference renders |

---

## Success Criteria

### Phase 1 Complete
- [ ] WebGPU renderer initializes without errors
- [ ] Fallback to WebGL2 works silently
- [ ] Basic scene renders on both backends

### Phase 4 Complete
- [ ] All materials converted to TSL (WebGPU path)
- [ ] Bloom only affects emissive elements
- [ ] WebGPU visuals are clearly superior without regressions
- [ ] WebGL fallback remains stable and visually acceptable

### Phase 7 Complete
- [ ] WebGPU path 30%+ faster than WebGL baseline
- [ ] Particle count doubled with same CPU cost
- [ ] Draw calls reduced by 50%+

### Full Migration Complete
- [ ] "World-class" visual quality on WebGPU
- [ ] Seamless WebGL fallback
- [ ] All quality presets working
- [ ] All game events trigger effects correctly
- [ ] GPU-driven particle physics with 20,000+ particles
- [ ] Enhanced gravitational lensing effect

---

## Appendix A: Uniform Reference

### Black Hole Core Uniforms
| Uniform | Type | Default | Animation |
|---------|------|---------|-----------|
| uTime | float | 0 | `clock.getElapsedTime()` |
| uIntensity | float | 1.0 | coreIntensity (decays to 1.0) |
| uScale | float | 1.0 | Static |

### Accretion Disk Uniforms
| Uniform | Type | Default | Animation |
|---------|------|---------|-----------|
| uTime | float | 0 | `clock.getElapsedTime()` |
| uIntensity | float | 1.0 | diskIntensity (decays to 1.0) |
| uRotationSpeed | float | 1.0 | diskRotationSpeed (decays to 1.0) |

### Starfield Uniforms
| Uniform | Type | Default | Animation |
|---------|------|---------|-----------|
| uTime | float | 0 | `clock.getElapsedTime()` |
| uFlashIntensity | float | 0 | starFlashIntensity (decays to 0) |

### Burst Sparks Uniforms
| Uniform | Type | Default | Animation |
|---------|------|---------|-----------|
| uTime | float | 0 | `clock.getElapsedTime()` |
| uPulseTimer | float | -100.0 | Advances during burst (0→60), resets to -100 |
| uBlackHolePos | vec2 | (0,0) | driftX, driftY |

---

## Appendix B: Event-Driven Effect State

```js
effectState = {
    diskIntensity: 1.0,           // 1.0-2.5, triggers on LINE_CLEAR
    coreIntensity: 1.0,           // 1.0-3.0, triggers on PIECE_LOCK/LINE_CLEAR
    diskRotationSpeed: 1.0,       // 1.0-3.5, triggers on LINE_CLEAR
    starFlashIntensity: 0,        // 0-1.5, triggers on events
    bloomPulseIntensity: 0,       // 0-0.8, triggers on events
    chromaticPulse: 0.002,        // 0.002-0.015, triggers on events
    gravitySurgeFactor: 0,        // 0-10, triggers on COMBO
    burstFactor: 0,               // 0-15, triggers after suction phase
    burstPhase: false,            // true during outward explosion
};
```

Decay rates per frame:
- `diskIntensity`: lerp 0.1 toward target
- `coreIntensity`: lerp 0.15 toward target
- `diskRotationSpeed`: lerp 0.05 toward target
- `starFlashIntensity`: *= 0.92
- `bloomPulseIntensity`: *= 0.94
- `chromaticPulse`: *= 0.95 (min 0.002)
- `gravitySurgeFactor`: *= 0.95
- `burstFactor`: *= 0.96

---

## Appendix C: Black Hole Drift Motion

The black hole wanders across the screen using superposition of sine waves:

```js
const t = this.time * 0.01; // Slow time factor
const widthRange = window.innerWidth * 0.35;
const heightRange = window.innerHeight * 0.35;

this.driftX = (Math.sin(t + this.driftPhaseX) + Math.cos(t * 1.34 + this.driftPhaseX)) * 0.5 * widthRange;
this.driftY = (Math.cos(t * 0.89 + this.driftPhaseY) + Math.sin(t * 1.67 + this.driftPhaseY)) * 0.5 * heightRange;
```

All black hole elements (core, event horizon, accretion disk, burst sparks origin) follow this drift.

---

## Changelog

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-02-04 | 1.1 | Codex | Corrected WebGPU API usage, added point-size constraint + sprite path, updated post-processing wiring, clarified timing + render path |
| 2026-02-04 | 1.0 | Claude | Initial plan creation |
