# Neon Dusk Theme - WebGPU Hybrid Upgrade Plan

## Executive Summary

This plan upgrades the Neon Dusk theme to a hybrid WebGPU/WebGL2 renderer with explicit, reliable fallback handling. The theme is a stunning synthwave masterpiece featuring procedural FBM mountains with neon rim lighting, a massive banded sun, perspective grid with wet reflections, twinkling starfield, and retro floating pixels. WebGPU will unlock compute shaders for particle simulation, GPU-driven highlights, enhanced post-processing with emissive-only bloom, and volumetric effects that will elevate this to world-class visual quality.

**Key Outcomes:**
- WebGPU first, explicit fallback to WebGL2
- TSL (Three Shading Language) node materials for all 14 custom shaders on WebGPU path
- Compute shaders for particle physics, highlight management, star twinkle, and retro pixel animation
- Enhanced visual fidelity: volumetric sun rays, true screen-space reflections, rim lighting compute, improved bloom
- Performance improvements through GPU-driven animation and reduced CPU work
- Electron-compatible, with Chromium WebGPU support validated

**Scope:** `src/themes/neon-dusk/` only

---

## Hybrid Approach (Project-Specific Definition)

Use `THREE.WebGPURenderer` from `three/webgpu`, initialize with `await renderer.init()`, and explicitly fall back to `THREE.WebGLRenderer` if WebGPU initialization fails. Feature paths must be gated by actual backend type.

**Core Rule:** WebGPU path uses TSL node materials + `THREE.PostProcessing` + Compute shaders. WebGL fallback path keeps existing `ShaderMaterial` + basic EffectComposer.

```js
import * as THREE from 'three/webgpu';

let webgpuRenderer = new THREE.WebGPURenderer({
    antialias: this.getAntialiasEnabled(),
    powerPreference: 'high-performance',
    forceWebGL: false, // set true for local fallback testing
});

try {
    await webgpuRenderer.init();
} catch (error) {
    console.warn('[NeonDusk] WebGPU init failed, falling back to WebGL2:', error);
    webgpuRenderer = null;
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
- `THREE.WebGLRenderer` with 4x MSAA render target for post-processing
- `THREE.EffectComposer` with `UnrealBloomPass` and custom `ShaderPass`
- `THREE.Clock` for animation timing
- Manual rAF loop with `registerAnimation()`
- Perspective camera with gentle sway animation

### Custom GLSL Shaders (ShaderMaterial)

| Shader | File Location | Purpose |
|--------|--------------|---------|
| `skyVertexShader` / `skyFragmentShader` | neon-dusk-shaders.js | Three-color sky gradient (unused, vertex colors used) |
| `starVertexShader` / `starFragmentShader` | neon-dusk-shaders.js | Twinkling starfield with event boost |
| `nebulaVertexShader` / `nebulaFragmentShader` | neon-dusk-shaders.js | Texture-based nebula clouds (optional) |
| `sunVertexShader` / `sunFragmentShader` | neon-dusk-shaders.js | Retro banded sun with perspective stripes |
| `sunGlowVertexShader` / `sunGlowFragmentShader` | neon-dusk-shaders.js | Radial glow layer behind sun |
| `mountainVertexShader` / `mountainFragmentShader` | neon-dusk-shaders.js | FBM mountains with simplex noise and rim lighting |
| `gridVertexShader` / `gridFragmentShader` | neon-dusk-shaders.js | Scrolling neon grid with wet reflections and scanlines |
| `highlightVertexShader` / `highlightFragmentShader` | neon-dusk-shaders.js | Tetromino cell highlights with edge glow |
| `particleVertexShader` / `particleFragmentShader` | neon-dusk-shaders.js | Multi-type particles (circle, ring, square with VHS glitch) |
| `ringVertexShader` / `ringFragmentShader` | neon-dusk-shaders.js | Expanding hologram rings from sun |
| `arcVertexShader` / `arcFragmentShader` | neon-dusk-shaders.js | Electric arc effects (unused) |
| `VHSShader` | neon-dusk-shaders.js | Post-processing: scanlines, tracking, chromatic aberration |
| `VignetteShader` | neon-dusk-shaders.js | Post-processing: edge darkening |

### Scene Elements

| Element | Count (High Preset) | Notes |
|---------|---------------------|-------|
| Sky Gradient | 1 plane (3000x1600) | Vertex-colored gradient |
| Starfield | 2,500 points | Twinkling, event-boosted |
| Sun | 1 sphere (radius 300) | Retro stripes, massive scale |
| Sun Glow | 1 plane (1200x1200) | Additive blending |
| Mountains | 16 meshes | FBM terrain, valley formation |
| Neon Grid | 1 plane (400x300, 100x75 segments) | Scrolling with reflections |
| Highlight Pool | 80 planes | Tetromino cell placement |
| Retro Pixels | 300 points | Floating squares, rising animation |
| Burst Particles | 600 points | Line clear / combo effects |
| Hologram Rings | Up to 10 | Expanding from sun on line clears |

### Quality Presets

```js
Minimal:  { starCount: 800,   mountainSegments: 32,  glowLayers: 2, maxBurstParticles: 100,  maxGridHighlights: 20,  maxRings: 3,  pixelCount: 0 }
Low:      { starCount: 1200,  mountainSegments: 64,  glowLayers: 3, maxBurstParticles: 200,  maxGridHighlights: 40,  maxRings: 5,  pixelCount: 100 }
Medium:   { starCount: 1800,  mountainSegments: 128, glowLayers: 4, maxBurstParticles: 400,  maxGridHighlights: 60,  maxRings: 8,  pixelCount: 200 }
High:     { starCount: 2500,  mountainSegments: 192, glowLayers: 5, maxBurstParticles: 600,  maxGridHighlights: 80,  maxRings: 10, pixelCount: 300 }
Ultra:    { starCount: 3500,  mountainSegments: 256, glowLayers: 6, maxBurstParticles: 800,  maxGridHighlights: 100, maxRings: 12, pixelCount: 400 }
Extreme:  { starCount: 5000,  mountainSegments: 512, glowLayers: 8, maxBurstParticles: 1000, maxGridHighlights: 150, maxRings: 15, pixelCount: 500 }
```

### Event System Integration
- `EVENTS.PIECE_LOCK` → Grid highlights, rising squares burst, pixel twinkle, star boost
- `EVENTS.LINE_CLEAR` → Grid pulse, mountain pulse, hologram rings
- `EVENTS.COMBO` → Sun pulse, rim glow boost, highlight twinkle, VHS glitch, color shift

---

## Compatibility Constraints

- `ShaderMaterial` and GLSL shaders are WebGL-centric; WebGPU path must use TSL node materials
- `EffectComposer` is WebGL-only; WebGPU uses `THREE.PostProcessing`
- Simplex noise in mountain shader must be ported to TSL noise functions
- Point sprite `gl_PointCoord` must use `pointUV` in TSL
- FBM terrain generation is CPU-side (preserved for both backends)
- Retro sun stripes use `fract()` and `step()` - straightforward TSL port

## Platform & Version Constraints

- Three.js version: **0.181.2** (from `package-lock.json`). All WebGPU/TSL APIs must match this revision.
- Electron version: **38.3.0** (from `package.json`). WebGPU must be validated in Electron runtime.
- Visual parity policy: **WebGPU can look better** than WebGL in core look-defining elements (grid reflectance, mountains, etc.). WebGL visuals must remain acceptable and stable, not necessarily identical.
- Platform focus: **Electron is the first-class WebGPU target**. Safari WebGPU is not a target path for this plan and should be treated as fallback-only (or unsupported) if encountered.

## Best-In-Class Additions (Required)

### A. Capability Matrix + Kill Switches
Define a strict capability matrix and per-feature kill switches to avoid brittle startup paths.

**Matrix (example):**
- WebGPU + MRT + Compute → Full feature set
- WebGPU + MRT only → No compute-driven particles/pixels/highlights (CPU fallback)
- WebGPU no MRT → Standard bloom (non-emissive), no emissive isolation
- WebGL2 → Existing ShaderMaterial + EffectComposer path

**New debug flags:**
- `?neonDuskNoCompute=1` - Disable all compute kernels, use CPU updates
- `?neonDuskNoMRT=1` - Disable emissive MRT bloom path
- `?neonDuskNoSSR=1` - Disable screen-space reflections
- `?neonDuskNoRays=1` - Disable god rays

**Rules:**
- Every advanced feature must be guard-railed behind a capability check and a kill switch.
- Startup should never fail due to a missing optional feature.

### B. WebGPU Warm-Up / Render Path
Document a backend-specific render path for Three.js `0.181.2`:
- WebGPU: use `renderAsync()` **or** a one-time warm-up frame to compile pipelines before the first visible frame.
- WebGL2: use `render()`.
- Explicitly state which backend uses which path in the implementation notes.

### C. Storage Buffer Layout & Alignment
Define compute buffer layouts with explicit padding to avoid WGSL alignment issues.

**Example (64-byte stride, alignment-safe):**
```wgsl
struct Particle {
    position : vec4f,   // xyz + 1.0
    velocity : vec4f,   // xyz + type (as f32)
    life     : vec4f,   // life, maxLife, size, active
    misc     : vec4f,   // spare / effect params
}
```
**CPU packing rules:**
- Always upload in 16-byte aligned `vec4f` blocks.
- Treat `type` and `active` as floats to avoid alignment surprises.
- Document byte stride and offsets next to the struct definition.

### D. GPU Pass Timing
Add pass-level GPU timing when supported (timestamp queries).
- Capture per-pass timings (bloom, SSR, rays, compute).
- Use results to drive dynamic resolution scaling (Phase 7).

### E. MRT Emissive Bloom Wiring (Explicit)
Make the emissive-only bloom pipeline explicit and verifiable.
- All neon materials must set `emissiveNode` (or equivalent) to a neon-only signal.
- Use an MRT output where **color** and **emissive** are rendered separately.
- Bloom should only sample from emissive output, not the full color output.

**Pseudo wiring (conceptual):**
```js
// Output both color and emissive
postProcessing.outputNode = renderOutput(
  mrt( output, emissive )
);

// Bloom uses only emissive MRT target
const bloomPass = bloom(emissive, { ... });
```

## Capability Probes (Best-In-Class Stability)

Before enabling advanced features, probe the backend and GPU support:
- Backend: `renderer.backend?.isWebGPUBackend`
- Texture formats: verify required float/half-float render targets for bloom
- MRT support: verify `mrt` path for emissive isolation
- Storage buffers/attributes: verify compute support for particles/highlights
- Fallback: confirm WebGL2 support and degrade gracefully if missing features

## Compute → Render Data Flow (Best-In-Class Performance)

Define a zero-readback pipeline where compute writes directly into buffers consumed by render:
- Particle positions/velocities in storage buffers
- Highlight positions/intensities in storage buffers
- Star twinkle phases in storage buffers
- Retro pixel positions in storage buffers
- Ping-pong buffers to avoid write/read hazards
- Render path reads buffers via storage attributes or node accessors
- CPU only updates high-level spawn parameters, never per-particle data

---

## WebGPU Visual Enhancement Opportunities

The Neon Dusk theme's synthwave aesthetic can be dramatically enhanced with WebGPU capabilities:

### 1. Volumetric Sun Rays (God Rays)
- Compute shader-based radial light scattering from massive sun position
- Occlusion by mountain silhouettes for dramatic valley framing
- Dynamic intensity based on sun pulse and combo effects
- Depth buffer sampling for accurate occlusion

### 2. Enhanced Wet Grid Reflections
- Current implementation: Simple path-based fake reflection
- WebGPU upgrade: Screen-space reflections of sun and mountains
- Animated puddle distortion using compute-generated noise
- Fresnel-based reflection intensity falloff

### 3. Emissive-Only Bloom
- MRT (Multiple Render Targets) to isolate neon elements
- Bloom only affects: grid lines, sun, highlights, rim lights, retro pixels
- Prevents bloom bleeding on dark mountain surfaces
- Configurable bloom radius per-element type

### 4. GPU-Driven Particle Systems
- Compute shader particle simulation for burst particles
- 5x particle budget with same CPU cost
- Complex behavior: gravity, wind, grid interaction, VHS glitch
- GPU-side spawn queue for immediate response to events

### 5. Compute-Driven Retro Pixels
- Current: CPU updates 300-500 pixel positions per frame
- WebGPU: GPU compute handles all motion, wrapping, life pulsing
- Enable 2000+ retro pixels with zero CPU overhead
- Add flocking/attraction behavior for visual interest

### 6. Enhanced Starfield
- Compute shader for parallel twinkle phase updates
- Event-reactive brightness boost computed on GPU
- Shooting star spawning on high combos
- Nebula cloud drift animation

### 7. Mountain Rim Lighting Compute
- Dynamic rim light intensity based on sun position
- Per-vertex pulse propagation for "shockwave" effect
- Subtle vertex animation for breathing mountains

### 8. Procedural Grid Wave Effects
- Vertex displacement on piece lock
- Ripple propagation from highlight positions
- Compute shader calculates wave heights
- Seamless integration with scroll animation

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
- [ ] Add deterministic test flags (`?neonDuskSeed=`, `?neonDuskFixedDt=`) for consistent capture
- [ ] Decide baseline GPU/CPU frame-time budgets per preset

**ShaderMaterial Inventory:**

| Material | Location | TSL Target |
|----------|----------|-----------|
| Star material | `createStarfield()` | `PointsNodeMaterial` |
| Sun material | `createSun()` | `MeshBasicNodeMaterial` with stripe logic |
| Sun glow material | `createSun()` | `MeshBasicNodeMaterial` with radial gradient |
| Mountain material | `createSilhouetteMountain()` | `MeshBasicNodeMaterial` with TSL noise + rim |
| Grid material | `createGrid()` | `MeshBasicNodeMaterial` with scroll + reflection |
| Highlight material | `createHighlightPool()` | `MeshBasicNodeMaterial` with edge glow |
| Particle material | `createBurstParticleSystem()` | `PointsNodeMaterial` with type switching |
| Retro pixel material | `createRetroPixels()` | `PointsNodeMaterial` |
| Ring material | `createHologramRing()` | `MeshBasicNodeMaterial` with ring shape |

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
- `?neonDuskBaseline=1` - Enable baseline logging
- `?forceWebGL=1` - Force WebGL2 fallback
- `?neonDuskSeed=1234` - Deterministic RNG seed for captures
- `?neonDuskFixedDt=16.666` - Fixed timestep for deterministic runs (ms)

---

### Phase 1: Hybrid Renderer Bootstrapping (Priority: CRITICAL)
**Objective:** Initialize WebGPU renderer with built-in fallback and set up backend detection.

**Files to modify:**
- `src/themes/neon-dusk/neon-dusk-theme.js`

**Tasks:**
- [ ] Change import from `'three'` to `'three/webgpu'`
- [ ] Make `createScene()` async and `await renderer.init()`
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
this.renderer = new THREE.WebGLRenderer({ ... });

// After
import * as THREE from 'three/webgpu';
// ...
async initRenderer(container) {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Try WebGPU first
    this.renderer = new THREE.WebGPURenderer({
        antialias: this.getAntialiasEnabled(),
        powerPreference: 'high-performance',
    });

    try {
        await this.renderer.init();
    } catch (error) {
        console.warn('[NeonDusk] Renderer init error, using fallback:', error.message);
    }

    this.isWebGPU = this.renderer.backend?.isWebGPUBackend === true;
    console.log(`[NeonDusk] Using ${this.isWebGPU ? 'WebGPU' : 'WebGL2'} backend`);

    this.renderer.setClearColor(0x08000f, 1);
    this.renderer.setPixelRatio(this.getEffectivePixelRatio());
    this.renderer.setSize(width, height);
    // ... rest of setup
}
```

**Implementation Notes:**
- Enforce the capability matrix and kill switches at renderer init time (`?neonDuskNoCompute`, `?neonDuskNoMRT`, etc.).
- Use the backend-specific render path: WebGPU `renderAsync()` or a warm-up frame; WebGL2 `render()`.
- Keep Electron as the first-class target and treat non-Electron WebGPU as fallback-only.

---

### Phase 2: Render Loop & Resize (Priority: HIGH)
**Objective:** Ensure animation loop works cleanly across WebGPU and fallback.

**Tasks:**
- [ ] Keep current rAF loop for `registerAnimation()` compatibility
- [ ] Switch to `renderer.render()` after init (no `renderAsync`)
- [ ] Update resize handling for WebGPU PostProcessing passes
- [ ] Ensure `this.clock` continues working correctly
- [ ] Define per-frame order: compute → material uniform updates → post → render
- [ ] Respect `?neonDuskFixedDt=` for deterministic runs

**Resize Handler Update:**
```js
onResize() {
    if (!this.camera || !this.renderer) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);

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
- `src/themes/neon-dusk/neon-dusk-materials.js`

**Material Conversion Order:**
1. **Grid Material** - Most visible, core aesthetic, complex reflections
2. **Sun Material** - Requires stripe logic port
3. **Mountain Material** - Requires TSL simplex noise + rim lighting
4. **Highlight Material** - Gameplay feedback, edge glow
5. **Star Material** - Background, twinkle animation
6. **Particle Material** - Multi-type rendering (circle, ring, square)
7. **Retro Pixel Material** - Square particles
8. **Ring Material** - Expanding hologram effect
9. **Sun Glow Material** - Simple radial gradient

**TSL Material Factory Pattern:**
```js
// neon-dusk-materials.js
import {
    MeshBasicNodeMaterial,
    PointsNodeMaterial,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
    float,
    int,
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
    positionWorld,
    positionLocal,
    normalWorld,
    normalLocal,
    cameraPosition,
    time,
    pointUV,
    attribute,
} from 'three/tsl';

// ============================================================================
// GRID MATERIAL (Most Complex)
// ============================================================================

export function createGridNodeMaterial(colors) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });

    // Uniforms
    const uTime = uniform(0);
    const uSpeed = uniform(10.0);
    const uGridColor = uniform(colors.gridColor);
    const uGlowIntensity = uniform(1.0);
    const uPulseIntensity = uniform(0);
    const uColorShift = uniform(colors.gridGlow);
    const uSunPosition = uniform(new THREE.Vector3(0, 50, -900));

    // Grid calculation
    const gridSpacing = float(6.0);
    const lineWidth = float(0.08);

    const worldPos = positionWorld;
    const scrolledZ = worldPos.z.sub(uTime.mul(uSpeed));

    // Distance to nearest grid line
    const gridX = abs(fract(worldPos.x.div(gridSpacing).add(0.5)).sub(0.5)).mul(gridSpacing);
    const gridZ = abs(fract(scrolledZ.div(gridSpacing).add(0.5)).sub(0.5)).mul(gridSpacing);

    // Distance-based line thickness (reduce aliasing)
    const dist = length(vec2(worldPos.x, worldPos.z));
    const distFactor = smoothstep(float(20.0), float(100.0), dist);
    const thicknessMod = float(1.0).add(distFactor.mul(6.0));

    const modLineWidth = lineWidth.mul(2.5).mul(thicknessMod);
    const lineX = smoothstep(modLineWidth, float(0.0), gridX);
    const lineZ = smoothstep(modLineWidth, float(0.0), gridZ);
    const gridLine = max(lineX, lineZ);

    // Distance fade
    const distanceFade = float(1.0).sub(smoothstep(float(10.0), float(80.0), dist));
    const perspectiveFade = float(1.0).sub(smoothstep(float(0.0), float(200.0), worldPos.z.negate()));

    // Sun reflection
    const sunX = uSunPosition.x;
    const sunWidth = float(100.0);
    const pathDist = abs(worldPos.x.sub(sunX));
    const reflection = pow(float(1.0).sub(smoothstep(float(0.0), sunWidth, pathDist)), float(2.0)).mul(0.5);

    // Color mixing
    const baseGridColor = mix(uGridColor, uColorShift, uPulseIntensity.mul(0.5));
    const reflectionColor = vec3(1.0, 0.5, 0.8);

    // Final color
    let finalColor = baseGridColor.mul(gridLine);
    const horizonFade = smoothstep(float(200.0), float(50.0), dist);
    finalColor = finalColor.add(reflectionColor.mul(reflection).mul(0.6).mul(horizonFade));

    // Intensity
    const intensity = gridLine.mul(uGlowIntensity).add(reflection.mul(0.4));
    const alpha = intensity.mul(distanceFade).mul(perspectiveFade);

    material.colorNode = finalColor;
    material.opacityNode = min(alpha, float(1.0));

    // Store uniforms for animation
    material.userData = { uTime, uSpeed, uGridColor, uGlowIntensity, uPulseIntensity, uColorShift, uSunPosition };

    return material;
}

// ============================================================================
// SUN MATERIAL (Retro Stripes)
// ============================================================================

export function createSunNodeMaterial(colors) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: THREE.FrontSide,
        depthWrite: false,
    });

    const uTime = uniform(0);
    const uColorTop = uniform(colors.sunTop);
    const uColorMid = uniform(colors.sunMid);
    const uColorBottom = uniform(colors.sunBottom);
    const uPulseIntensity = uniform(0);
    const uStripeCount = uniform(8.0);

    const uvCoord = uv();
    const y = uvCoord.y;

    // Three-color gradient
    const lowMix = mix(uColorBottom, uColorMid, y.mul(2.0));
    const highMix = mix(uColorMid, uColorTop, y.sub(0.5).mul(2.0));
    const baseColor = mix(lowMix, highMix, step(float(0.5), y));

    // Retro stripes (bottom half only)
    const stripePhase = pow(float(1.0).sub(y), float(2.5)).mul(uStripeCount).mul(3.0);
    const pattern = fract(stripePhase);
    const stripe = step(float(0.5), pattern);
    const blend = smoothstep(float(0.5), float(0.6), y);
    const stripeAlpha = mix(stripe, float(1.0), blend);

    // Fresnel edge glow
    const normal = normalLocal;
    const viewDir = cameraPosition.sub(positionWorld).normalize();
    const fresnel = pow(float(1.0).sub(max(normal.dot(viewDir), float(0.0))), float(3.0));

    // Final color
    let finalColor = baseColor;
    finalColor = finalColor.add(finalColor.mul(uPulseIntensity).mul(0.4));
    finalColor = finalColor.add(vec3(1.0, 0.8, 0.5).mul(fresnel).mul(0.5));

    material.colorNode = finalColor;
    material.opacityNode = mix(stripeAlpha, float(1.0), step(float(0.6), y));

    material.userData = { uTime, uColorTop, uColorMid, uColorBottom, uPulseIntensity, uStripeCount };

    return material;
}

// ============================================================================
// STAR MATERIAL
// ============================================================================

export function createStarNodeMaterial() {
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
    });

    const uTime = uniform(0);
    const uPixelRatio = uniform(1.0);
    const uEventBoost = uniform(0);

    // Attributes
    const aSize = attribute('aSize');
    const aTwinkle = attribute('aTwinkle'); // vec2: phase, speed
    const aBrightness = attribute('aBrightness');

    // Twinkle animation
    const twinkle = sin(uTime.mul(aTwinkle.y).add(aTwinkle.x));
    const brightness = aBrightness.mul(float(0.6).add(twinkle.mul(0.4)));
    const boostedBrightness = brightness.mul(float(1.0).add(uEventBoost.mul(0.5)));

    // Point size (handled via sizeNode)
    material.sizeNode = aSize.mul(uPixelRatio);

    // Fragment: soft circular glow
    const center = pointUV.sub(0.5);
    const dist = length(center).mul(2.0);
    const softCircle = pow(float(1.0).sub(smoothstep(float(0.0), float(1.0), dist)), float(2.0));

    const alpha = softCircle.mul(boostedBrightness).mul(0.7);

    material.colorNode = vec3(1.0, 1.0, 1.0).mul(boostedBrightness).mul(0.8);
    material.opacityNode = alpha;

    material.userData = { uTime, uPixelRatio, uEventBoost };

    return material;
}

// ============================================================================
// MOUNTAIN MATERIAL (with TSL Simplex Noise)
// ============================================================================

export function createMountainNodeMaterial(colors, layer) {
    const material = new MeshBasicNodeMaterial({
        transparent: false,
    });

    const uBaseColor = uniform(colors.mountainDark);
    const uRimColor = uniform(colors.mountainRim);
    const uMountainLayer = uniform(layer);
    const uTime = uniform(0);

    // Height-based gradient
    const height = positionLocal.y;
    const heightFactor = smoothstep(float(0.0), float(150.0), height);
    const detailColor = mix(uBaseColor, uRimColor.mul(0.3), heightFactor);

    // TSL Simplex Noise (using MaterialX nodes if available, or custom)
    // For now, use simple procedural noise approximation
    const noiseCoord = positionWorld.xz.mul(0.02);
    const noiseVal = sin(noiseCoord.x.mul(12.9898).add(noiseCoord.y.mul(78.233))).mul(43758.5453);
    const noise = fract(noiseVal).sub(0.5).mul(2.0);

    let color = detailColor.add(uRimColor.mul(max(float(0.0), noise)).mul(0.1).mul(heightFactor));

    // Rim lighting
    const normal = normalWorld;
    const viewDir = cameraPosition.sub(positionWorld).normalize();
    const fresnel = pow(float(1.0).sub(max(normal.dot(viewDir), float(0.0))), float(3.0));
    const topLight = smoothstep(float(40.0), float(150.0), height);
    const rim = uRimColor.mul(fresnel).mul(topLight).mul(2.5);

    // Ground fog
    const groundFog = float(1.0).sub(smoothstep(float(-10.0), float(80.0), height));
    const fogColor = vec3(0.02, 0.0, 0.05);
    color = mix(color, fogColor, groundFog.mul(0.9));
    color = color.add(rim.mul(float(1.0).sub(groundFog.mul(0.6))));

    // Distance haze
    const dist = length(positionWorld.xz);
    const fogFactor = smoothstep(float(200.0), float(900.0), dist);
    const hazeColor = vec3(0.1, 0.05, 0.2);
    color = mix(color, hazeColor, fogFactor.mul(0.7));

    material.colorNode = color;

    material.userData = { uBaseColor, uRimColor, uMountainLayer, uTime };

    return material;
}

// ... Additional materials follow same pattern
```

**Tasks:**
- [ ] Create `neon-dusk-materials.js` with material factory functions
- [ ] Port simplex noise to TSL (or use simple procedural approximation)
- [ ] Add emissive outputs for MRT bloom compatibility
- [ ] Gate material selection on `this.isWebGPU`
- [ ] Ensure color management matches WebGL (output color space + tone mapping)
- [ ] Add explicit `emissiveNode` for neon-only bloom

---

### Phase 4: WebGPU Post-Processing (Priority: HIGH)
**Objective:** Implement advanced post-processing for WebGPU path.

**Files to create:**
- `src/themes/neon-dusk/neon-dusk-post.js`

**Post-Processing Stack:**
1. **Emissive-Only Bloom** - MRT to isolate neon elements (grid, sun, highlights, rim lights)
2. **Vignette** - Subtle darkening at edges (match current VignetteShader)
3. **Optional: VHS Effect** - Scanlines, chromatic aberration, tracking
4. **Optional: God Rays** - Volumetric sun rays through mountain valley

**Implementation:**
```js
// neon-dusk-post.js
import { PostProcessing, mrt, output, emissive } from 'three/webgpu';
import { bloom, vignette, renderOutput } from 'three/tsl';

export class NeonDuskPost {
    constructor(renderer, scene, camera, preset) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.preset = preset;

        this.postProcessing = new PostProcessing(renderer);
        this.postProcessing.outputNode = this.createOutputNode();
    }

    createOutputNode() {
        // Bloom only affects emissive surfaces (neon elements)
        const bloomPass = bloom(emissive, {
            intensity: this.preset.bloomStrength || 0.2,
            radius: this.preset.bloomRadius || 0.35,
            threshold: this.preset.bloomThreshold || 0.55,
        });

        // Combine color output with bloomed emissive
        const combined = output.add(bloomPass);

        // Apply vignette
        const vignetted = vignette(combined, {
            offset: 1.2,
            darkness: 0.5,
        });

        return renderOutput(vignetted);
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
- [ ] Create `neon-dusk-post.js` with MRT bloom pipeline
- [ ] Add emissive outputs to all node materials (grid, sun, highlights, etc.)
- [ ] Implement vignette matching current VignetteShader
- [ ] Optional: Port VHS shader to TSL post-processing node
- [ ] Integrate with main theme render loop
- [ ] WebGL fallback uses existing EffectComposer pipeline
- [ ] Add resolution scaling for heavy passes

**Implementation Notes:**
- Implement explicit MRT wiring (color + emissive) and ensure bloom samples emissive only.
- Gate bloom/SSR/god rays behind capability checks and kill switches (`?neonDuskNoMRT`, `?neonDuskNoSSR`, `?neonDuskNoRays`).
- Add pass-level GPU timing (when supported) to validate post stack costs.

---

### Phase 5: GPU Compute Shaders (Priority: HIGH - WebGPU Exclusive)
**Objective:** Offload animation logic to GPU for massive performance gains.

**Files to create:**
- `src/themes/neon-dusk/neon-dusk-compute.js`

**Compute Shader Applications:**

#### 5.1 Burst Particle System Compute
- Physics simulation (velocity, gravity, lifetime)
- Spawn/despawn management
- VHS glitch effect parameters
- 2000+ particles with minimal CPU overhead

```js
// Particle compute kernel (conceptual WGSL)
const particleComputeShader = wgslFn(`
    struct Particle {
        position: vec3f,
        velocity: vec3f,
        life: f32,
        maxLife: f32,
        size: f32,
        type: u32,
        active: u32,
    }

    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) id: vec3u) {
        let i = id.x;
        if (i >= arrayLength(&particles)) { return; }

        var p = particles[i];
        if (p.active == 0u) { return; }

        // Physics update
        if (p.type == 2u) {
            // Rising squares: slow down, no gravity
            p.velocity.y *= 0.98;
        } else {
            // Other types: gravity
            p.velocity.y -= uniforms.gravity * uniforms.deltaTime;
        }

        p.position += p.velocity * uniforms.deltaTime;
        p.life -= uniforms.deltaTime / p.maxLife;

        if (p.life <= 0.0) {
            p.active = 0u;
        }

        particles[i] = p;
    }
`);
```

#### 5.2 Retro Pixels Compute
- Floating animation (rise, drift, wrap)
- Life pulsing calculation
- 2000+ pixels with zero CPU cost

#### 5.3 Highlight Scroll Compute
- Update all highlight positions with grid scroll
- Distance fade calculation
- Lifecycle management (spawn, fade, despawn)

#### 5.4 Star Twinkle Compute
- Parallel twinkle phase updates
- Event boost propagation
- Potential shooting star spawning

**Tasks:**
- [ ] Create `neon-dusk-compute.js` with compute shader kernels
- [ ] Implement GPU particle buffer management
- [ ] Port burst particle physics to compute shader
- [ ] Port retro pixel animation to compute shader
- [ ] Port highlight scroll logic to compute shader
- [ ] WebGL fallback uses existing CPU animation
- [ ] Define storage buffer layouts and bind groups
- [ ] Use ping-pong buffers for positions/velocities

---

### Phase 6: Visual Enhancements (Priority: MEDIUM)
**Objective:** Achieve "world-class" visuals leveraging WebGPU capabilities.

#### 6.1 Volumetric Sun Rays (God Rays)
- Radial blur from sun position through mountain valley
- Mountain occlusion for dramatic silhouettes
- Dynamic intensity based on combo/pulse state
- Use depth buffer for accurate occlusion

#### 6.2 Enhanced Wet Grid Reflections
- Screen-space reflection of sun on grid
- Animated distortion using compute-generated noise
- Fresnel-based reflection intensity
- Mirror mountains faintly in wet surface

#### 6.3 Dynamic Mountain Rim Lighting
- Compute shader updates rim intensity based on events
- Per-vertex pulse propagation for "shockwave" effect
- Color shift during combos

#### 6.4 Enhanced Retro Pixels
- Attraction/flocking behavior toward sun
- Color cycling based on event state
- Trail effects for fast-moving pixels

#### 6.5 Improved Starfield
- Constellation patterns
- Shooting stars on high combos
- Subtle parallax based on camera sway

#### 6.6 Grid Wave Effects
- Vertex displacement on piece lock
- Ripple propagation from highlight positions
- Seamless integration with scroll

#### 6.7 Color & Tone Mastering
- Filmic tone mapping tuned for neon highlights
- Subtle color grading for deeper synthwave palette
- Dither/film grain to reduce gradient banding

**Tasks:**
- [ ] Implement god rays post-processing node
- [ ] Create enhanced SSR grid reflection material
- [ ] Add compute-driven rim lighting updates
- [ ] Enhance retro pixels with flocking behavior
- [ ] Implement shooting stars system
- [ ] Create grid vertex displacement compute shader

---

### Phase 7: Performance Optimization (Priority: HIGH)
**Objective:** Maximize performance on both backends.

**Optimizations:**

#### 7.1 Mountain Batching
- Merge mountain geometries per layer
- Use `BatchedMesh` for mountains with shared material
- Reduce draw calls from 16+ to 2-3

#### 7.2 Highlight Instancing
- Convert highlight pool to `InstancedMesh`
- Single draw call for all active highlights
- Instance buffer for position/color/intensity

#### 7.3 Ring Instancing
- Convert hologram rings to `InstancedMesh`
- Single draw call for all expanding rings
- Instance buffer for life/radius/color

#### 7.4 Uniform Buffer Optimization
- Group frequently updated uniforms
- Minimize per-frame CPU-GPU transfers
- Use uniform blocks where possible

#### 7.5 LOD for Distant Elements
- Reduce star count based on camera angle
- Simplify distant mountain detail
- Adaptive glow layer count

#### 7.6 Frustum Culling
- Manual culling for off-screen mountains
- Skip updates for non-visible highlights

**Tasks:**
- [ ] Implement mountain geometry batching
- [ ] Convert highlights to InstancedMesh
- [ ] Convert rings to InstancedMesh
- [ ] Optimize uniform update patterns
- [ ] Add LOD system for stars
- [ ] Profile and optimize hot paths
- [ ] Add dynamic resolution scaling based on GPU frame time

---

### Phase 8: QA & Validation (Priority: CRITICAL)
**Objective:** Ensure visual quality and seamless fallback.

**Testing Checklist:**

#### Visual Quality
- [ ] Grid scrolling speed matches
- [ ] Sun gradient colors and stripes match
- [ ] Mountain rim lighting appears correctly
- [ ] Star twinkle timing matches
- [ ] Highlight intensity and edge glow match
- [ ] Particle behavior matches (rising squares, bursts)
- [ ] Retro pixels float and pulse correctly
- [ ] Hologram rings expand and fade correctly

#### Performance Validation
- [ ] WebGPU FPS >= WebGL FPS on all presets
- [ ] No frame drops during combo effects
- [ ] Memory usage stable over time
- [ ] No GPU hangs or stutters
- [ ] Pass-level GPU timing within preset budgets

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
- `?neonDuskBaseline=1` - Log FPS, backend, preset info
- `?forceWebGL=1` - Force WebGL2 fallback
- `?neonDuskDebug=1` - Enable visual debug overlays
- `?neonDuskNoPost=1` - Disable post-processing
- `?neonDuskSeed=1234` - Deterministic RNG seed
- `?neonDuskFixedDt=16.666` - Fixed timestep (ms)

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
src/themes/neon-dusk/
├── neon-dusk-theme.js          # Main theme (hybrid rendering)
├── neon-dusk-materials.js      # NEW: TSL material factory
├── neon-dusk-post.js           # NEW: WebGPU post-processing
├── neon-dusk-compute.js        # NEW: GPU compute shaders
├── neon-dusk-tetrominos.js     # Unchanged
└── neon-dusk-shaders.js        # Kept for WebGL fallback
```

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| TSL noise parity | Visual drift | Side-by-side comparison, tune parameters |
| WebGPU browser support | Limited reach | Silent fallback, WebGL path always works |
| Performance regression | User experience | Profile after each phase, keep WebGL baseline |
| MRT compatibility | Render failures | Ensure all materials have emissive output |
| Compute shader complexity | Development time | Prioritize particle system first, iterate |
| Device lost (WebGPU) | Black screen | Add device-lost handler and re-init path |
| Version/API drift | Build errors | Pin to Three.js 0.181.2 or update plan on bump |
| Electron GPU blocked | No WebGPU | Detect and fall back to WebGL2 |
| Retro stripe aliasing | Visual artifacts | Test stripe rendering on multiple resolutions |

---

## Success Criteria

### Phase 1 Complete
- [ ] WebGPU renderer initializes without errors
- [ ] Fallback to WebGL2 works silently
- [ ] Basic scene renders on both backends

### Phase 4 Complete
- [ ] All materials converted to TSL (WebGPU path)
- [ ] Bloom only affects neon elements
- [ ] WebGPU visuals are clearly superior without regressions
- [ ] WebGL fallback remains stable and visually acceptable

### Phase 7 Complete
- [ ] WebGPU path 20%+ faster than WebGL baseline
- [ ] Draw calls reduced by 50%+
- [ ] Particle/pixel budget doubled with same CPU cost

### Full Migration Complete
- [ ] "World-class" visual quality on WebGPU
- [ ] Seamless WebGL fallback
- [ ] All quality presets working
- [ ] All game events trigger effects correctly
- [ ] Volumetric sun rays through mountain valley
- [ ] Enhanced wet grid reflections

---

## Appendix A: TSL Simplex Noise Implementation

Port of simplex noise for mountain shader:

```js
import { float, vec2, vec3, vec4, floor, fract, abs, step, dot, mix, max } from 'three/tsl';

// TSL simplex noise (2D)
function mod289_vec3(x) {
    return x.sub(floor(x.mul(1.0 / 289.0)).mul(289.0));
}

function mod289_vec2(x) {
    return x.sub(floor(x.mul(1.0 / 289.0)).mul(289.0));
}

function permute(x) {
    return mod289_vec3(x.mul(34.0).add(1.0).mul(x));
}

export function snoise(v) {
    const C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);

    const i = floor(v.add(dot(v, vec2(C.y, C.y))));
    const x0 = v.sub(i).add(dot(i, vec2(C.x, C.x)));

    const i1x = step(x0.y, x0.x);
    const i1y = float(1.0).sub(i1x);
    const i1 = vec2(i1x, i1y);

    const x12 = vec4(
        x0.x.sub(i1.x).add(C.x),
        x0.y.sub(i1.y).add(C.x),
        x0.x.add(C.z),
        x0.y.add(C.z)
    );

    const iMod = mod289_vec2(i);
    const p = permute(permute(
        vec3(iMod.y, iMod.y.add(i1.y), iMod.y.add(1.0))
    ).add(vec3(iMod.x, iMod.x.add(i1.x), iMod.x.add(1.0))));

    const m = max(
        float(0.5).sub(vec3(
            dot(x0, x0),
            dot(vec2(x12.x, x12.y), vec2(x12.x, x12.y)),
            dot(vec2(x12.z, x12.w), vec2(x12.z, x12.w))
        )),
        float(0.0)
    );

    const m2 = m.mul(m);
    const m4 = m2.mul(m2);

    const x = fract(p.mul(C.w)).mul(2.0).sub(1.0);
    const h = abs(x).sub(0.5);
    const ox = floor(x.add(0.5));
    const a0 = x.sub(ox);

    const norm = float(1.79284291400159).sub(
        float(0.85373472095314).mul(a0.mul(a0).add(h.mul(h)))
    );

    const g = vec3(
        a0.x.mul(x0.x).add(h.x.mul(x0.y)),
        a0.y.mul(x12.x).add(h.y.mul(x12.y)),
        a0.z.mul(x12.z).add(h.z.mul(x12.w))
    );

    return float(130.0).mul(dot(m4.mul(norm), g));
}
```

---

## Appendix B: Material Uniform Reference

### Grid Material Uniforms
| Uniform | Type | Default | Animation |
|---------|------|---------|-----------|
| uTime | float | 0 | `clock.getElapsedTime()` |
| uSpeed | float | 10.0 | From quality preset |
| uGridColor | vec3 | #ff00ff | Static (magenta) |
| uGlowIntensity | float | 1.0 | Static |
| uPulseIntensity | float | 0 | Decay 0.92x per frame |
| uColorShift | vec3 | #00ffff | Static (cyan) |
| uSunPosition | vec3 | (0, 50, -900) | Updated from sun mesh |

### Sun Material Uniforms
| Uniform | Type | Default | Animation |
|---------|------|---------|-----------|
| uTime | float | 0 | `clock.getElapsedTime()` |
| uColorTop | vec3 | #ffff66 | Static |
| uColorMid | vec3 | #ff8822 | Static |
| uColorBottom | vec3 | #ff4477 | Static |
| uStripeCount | float | 8.0 | Static |
| uPulseIntensity | float | 0 | Decay 0.92x per frame |

### Mountain Material Uniforms
| Uniform | Type | Default | Animation |
|---------|------|---------|-----------|
| uBaseColor | vec3 | #1a0525 | Static |
| uRimColor | vec3 | #cc44ff | Static |
| uMountainLayer | float | varies | Per-mountain (0.0-0.9) |
| uTime | float | 0 | `clock.getElapsedTime()` |

### Highlight Material Uniforms
| Uniform | Type | Default | Animation |
|---------|------|---------|-----------|
| uColor | vec3 | varies | Per-tetromino color |
| uIntensity | float | 0-2.5 | Fade over distance/time |
| uTime | float | 0 | `clock.getElapsedTime()` |
| uTwinkle | float | 0 | From effectState.highlightTwinkle |

### Star Material Uniforms
| Uniform | Type | Default | Animation |
|---------|------|---------|-----------|
| uTime | float | 0 | `clock.getElapsedTime()` |
| uPixelRatio | float | DPR | From renderer |
| uEventBoost | float | 0 | Decay 0.92x per frame |

### Particle Material Uniforms
| Uniform | Type | Default | Animation |
|---------|------|---------|-----------|
| uTime | float | 0 | `clock.getElapsedTime()` |
| uPixelRatio | float | DPR | From renderer |
| uTwinkle | float | 0 | From effectState.pixelTwinkle |

---

## Appendix C: Event-Driven Effect State

```js
effectState = {
    gridPulseIntensity: 0,      // 0-1, triggers on PIECE_LOCK/LINE_CLEAR
    sunPulseIntensity: 0,       // 0-1, triggers on LINE_CLEAR(3+)/COMBO(2+)
    mountainPulseIntensity: 0,  // 0-1, triggers on LINE_CLEAR
    mountainShockwave: 0,       // 0-1, triggers on PIECE_LOCK
    rimGlowIntensity: 1.0,      // 1.0-2.0, boosts on COMBO
    highlightTwinkle: 0,        // 0-1.5, triggers on PIECE_LOCK/COMBO
    colorShift: 0,              // 0-1, shifts grid color on COMBO
    vhsIntensity: 0,            // 0-1.5, triggers VHS glitch on COMBO
    pixelTwinkle: 0,            // 0-2.0, triggers pixel flash on PIECE_LOCK
};
```

All values decay exponentially: `value *= 0.92 ** (delta * 60)` per frame.

---

## Changelog

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-02-04 | 1.0 | Claude | Initial plan creation |
