# Synthwave Sunset Theme - WebGPU Hybrid Upgrade Plan

## Executive Summary

This plan upgrades the Synthwave Sunset theme to a hybrid WebGPU/WebGL2 renderer with explicit, reliable fallback handling. The theme features an iconic 80s retrofuturistic aesthetic with a neon grid, volumetric sunset, and procedural cityscape that will benefit significantly from WebGPU's compute shaders and advanced material system. The WebGPU path is allowed to look better than WebGL, while the WebGL fallback remains acceptable and stable.

**Key Outcomes:**
- WebGPU first, explicit fallback to WebGL2
- TSL (Three Shading Language) node materials for all custom shaders on WebGPU path
- Compute shaders for grid scrolling, particle simulation, and highlight management
- Enhanced visual fidelity: volumetric sun rays, screen-space reflections, improved bloom
- Performance improvements through GPU-driven animation and reduced CPU work
- Electron-compatible, with Chromium WebGPU support validated

**Scope:** `src/themes/synthwave-sunset/` only

---

## Finalized Scope (Approved)

**Date:** 2026-02-04

### Keep / Improve
- Single **main ground grid only** (no sky/ceiling grid).
- Reflections on the grid **only from sun + buildings** (no grid self-reflection, no tetromino reflections).
- WebGPU-first with explicit WebGL2 fallback.
- Emissive-only bloom, tasteful grading, and stable performance.

### Explicit Exclusions (Do Not Reintroduce)
- **Procedural city windows** on skyline.
- **Sky-wave / ceiling-grid overlays** of any kind.
- **Film grain** or heavy VHS noise.

These exclusions are binding for the final implementation plan.

---

## Hybrid Approach (Project-Specific Definition)

Use `THREE.WebGPURenderer` from `three/webgpu`, initialize with `await renderer.init()`, and explicitly fall back to `THREE.WebGLRenderer` if WebGPU initialization fails. Feature paths must be gated by actual backend type.

**Core Rule:** WebGPU path uses TSL node materials + `THREE.PostProcessing` + Compute shaders. WebGL fallback path keeps existing `ShaderMaterial` + basic rendering.

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
    console.warn('[SynthwaveSunset] WebGPU init failed, falling back to WebGL2:', error);
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
- `THREE.WebGLRenderer`
- `THREE.FogExp2` for atmospheric depth
- `THREE.Clock` for animation timing
- Manual rAF loop with `registerAnimation()`

### Custom GLSL Shaders (ShaderMaterial)

| Shader | File Location | Purpose |
|--------|--------------|---------|
| `gridVertexShader` / `gridFragmentShader` | synthwave-shaders.js | Scrolling neon grid with wet reflections and horizon fog |
| `sunVertexShader` / `sunFragmentShader` | synthwave-shaders.js | Volumetric sun with simplex noise and gradient stripes |
| `sunGlowVertexShader` / `sunGlowFragmentShader` | synthwave-shaders.js | Additive glow layers around sun |
| `starVertexShader` / `starFragmentShader` | synthwave-shaders.js | Twinkling starfield points |
| `highlightVertexShader` / `highlightFragmentShader` | synthwave-shaders.js | Tetromino cell highlights with edge glow |
| `particleVertexShader` / `particleFragmentShader` | synthwave-shaders.js | Combo effect particles |
| `skyVertexShader` / `skyFragmentShader` | synthwave-shaders.js | Sky gradient (unused, vertex colors used instead) |
| `buildingEdgeVertexShader` / `buildingEdgeFragmentShader` | synthwave-shaders.js | Building edge glow for combos |

### Scene Elements

| Element | Count (High Preset) | Notes |
|---------|---------------------|-------|
| Neon Grid | 1 plane (100x75 segments) | Scrolling, wet reflections |
| Sun | 1 sphere (64x32 segments) | Gradient + noise |
| Sun Glow Layers | 4 planes | Additive blending |
| Starfield | 2,500 points | Twinkling animation |
| Buildings | 90 meshes | Two depth layers |
| Building Edges | 90 line segments | Combo glow effect |
| Highlight Pool | 80 planes | Tetromino placement |
| Particle System | 3,500 points | Combo/line clear effects |
| Sky Dome | 1 sphere (radius 4000) | Vertex-colored gradient |

### Quality Presets

```js
Minimal:  { starCount: 500,  buildingCount: 30,  glowLayers: 1, maxHighlights: 30,  particleBudget: 500  }
Low:      { starCount: 1000, buildingCount: 50,  glowLayers: 2, maxHighlights: 40,  particleBudget: 1000 }
Medium:   { starCount: 1800, buildingCount: 70,  glowLayers: 3, maxHighlights: 60,  particleBudget: 2000 }
High:     { starCount: 2500, buildingCount: 90,  glowLayers: 4, maxHighlights: 80,  particleBudget: 3500 }
Ultra:    { starCount: 4000, buildingCount: 120, glowLayers: 5, maxHighlights: 100, particleBudget: 6000 }
Extreme:  { starCount: 6000, buildingCount: 150, glowLayers: 6, maxHighlights: 150, particleBudget: 10000 }
```

### Event System Integration
- `EVENTS.LINE_CLEAR` → Grid pulse, city glow, horizon burst particles
- `EVENTS.COMBO` → Sun pulse, city glow, highlight twinkle, sun burst particles
- `EVENTS.PIECE_LOCK` → Tetromino highlight spawning on grid

---

## Compatibility Constraints

- `ShaderMaterial` and GLSL shaders are WebGL-centric; WebGPU path must use TSL node materials
- `EffectComposer` is WebGL-only; WebGPU uses `THREE.PostProcessing`
- Simplex noise in GLSL must be ported to TSL noise functions
- Point sprite `gl_PointCoord` must use `pointUV` in TSL
- Building edge `LineSegments` with `LineBasicMaterial` works in both backends

## Platform & Version Constraints

- Three.js version: **0.181.2** (from `package-lock.json`). All WebGPU/TSL APIs in this plan must match this revision.
- Electron version: **38.3.0** (from `package.json`). WebGPU must be validated in the Electron runtime, with robust fallback to WebGL2.
- WebGPU may look better than WebGL. WebGL visuals must remain acceptable and stable, not necessarily identical.

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
- Ping-pong buffers to avoid write/read hazards
- Render path reads buffers via storage attributes or node accessors
- CPU only updates high-level spawn parameters, never per-particle data

---

## WebGPU Visual Enhancement Opportunities

The Synthwave Sunset theme's aesthetic can be dramatically enhanced with WebGPU capabilities:

### 1. Volumetric Sun Rays (God Rays)
- Compute shader-based radial light scattering from sun position
- Occlusion by buildings for dramatic silhouettes
- Dynamic intensity based on sun position and combo effects

### 2. Screen-Space Reflections on Grid
- Current implementation: Basic noise-based fake reflection
- WebGPU upgrade: True screen-space reflections of sun and city
- Animated puddle distortion for "wet street" effect

### 3. Emissive-Only Bloom
- MRT (Multiple Render Targets) to isolate neon elements
- Bloom only affects: grid lines, sun, highlights, building edges
- Prevents bloom bleeding on dark surfaces

### 4. GPU-Driven Particle System
- Compute shader particle simulation (physics, lifetime, spawning)
- 10x particle budget with same CPU cost
- Complex behavior: gravity, wind, grid interaction

### 5. Procedural Animated Grid
- Compute shader for grid vertex displacement
- Wave propagation on piece lock
- Reactive ripples spreading from highlight positions

### 6. Enhanced Starfield
- Physically-based star colors and magnitudes
- Subtle parallax based on camera movement
- Optional shooting stars on high combos

### 7. Atmospheric Scattering
- Realistic sunset gradient computation
- Dynamic color shift as sun drifts
- Volumetric horizon haze

---

## Phased Implementation Plan

### Phase 0: Audit & Baseline (Priority: CRITICAL)
**Objective:** Inventory all WebGL-only features and establish visual/performance baselines.

**Tasks:**
- [x] List every ShaderMaterial and map to TSL replacement strategy
- [ ] Capture screenshots and FPS for each quality preset (WebGL baseline)
- [x] Add internal `forceWebGL` toggle for testing fallback behavior
- [x] Document current uniform values and animation parameters (ongoing)
- [x] Record exact Three.js + Electron versions used by the theme
- [x] Define parity expectations: WebGPU can be better; WebGL must be acceptable
- [x] Add deterministic test flags (`?synthwaveSeed=`, `?synthwaveFixedDt=`) for consistent capture
- [ ] Decide baseline GPU/CPU frame-time budgets per preset

**ShaderMaterial Inventory:**

| Material | Location | TSL Target |
|----------|----------|-----------|
| Grid material | `createGrid()` | `MeshBasicNodeMaterial` with custom fragment |
| Sun material | `createSun()` | `MeshBasicNodeMaterial` with TSL noise |
| Sun glow materials | `createSun()` | `MeshBasicNodeMaterial` with radial gradient |
| Star material | `createStarField()` | `PointsNodeMaterial` |
| Highlight material | `createHighlightPool()` | `MeshBasicNodeMaterial` |
| Particle material | `createParticleSystem()` | `PointsNodeMaterial` |
| Building edge material | `createBuildings()` | `LineBasicNodeMaterial` |

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
- `?synthwaveBaseline=1` - Enable baseline logging
- `?forceWebGL=1` - Force WebGL2 fallback
- `?synthwaveSeed=1234` - Deterministic RNG seed for captures
- `?synthwaveFixedDt=16.666` - Fixed timestep for deterministic runs (ms)

---

### Phase 1: Hybrid Renderer Bootstrapping (Priority: CRITICAL)
**Objective:** Initialize WebGPU renderer with built-in fallback and set up backend detection.

**Files to modify:**
- `src/themes/synthwave-sunset/synthwave-sunset-theme.js`

**Tasks:**
- [x] Change import from `'three'` to `'three/webgpu'`
- [x] Make `createScene()` async and `await renderer.init()`
- [x] Set `this.isWebGPU = renderer.backend?.isWebGPUBackend === true`
- [x] Keep renderer defaults aligned with existing look (tone mapping, color space)
- [x] Handle init errors gracefully (explicit fallback to WebGL2)
- [x] Update container attachment after async init
- [ ] Add device-lost handler and re-init path (WebGPU only)

**Code Changes:**
```js
// Before
import * as THREE from 'three';
// ...
this.renderer = new THREE.WebGLRenderer({ ... });

// After
import * as THREE from 'three/webgpu';
// ...
this.renderer = new THREE.WebGPURenderer({
    antialias: this.getAntialiasEnabled(),
    powerPreference: 'high-performance',
});

try {
    await this.renderer.init();
} catch (error) {
    console.warn('[SynthwaveSunset] Renderer init error, using fallback:', error.message);
}

this.isWebGPU = this.renderer.backend?.isWebGPUBackend === true;
console.log(`[SynthwaveSunset] Using ${this.isWebGPU ? 'WebGPU' : 'WebGL2'} backend`);
```

---

### Phase 2: Render Loop & Resize (Priority: HIGH)
**Objective:** Ensure animation loop works cleanly across WebGPU and fallback.

**Tasks:**
- [x] Keep current rAF loop for `registerAnimation()` compatibility
- [x] Switch to `renderer.render()` after init (no `renderAsync`)
- [x] Update resize handling for WebGPU PostProcessing passes
- [x] Ensure `this.clock` continues working correctly
- [x] Define per-frame order: compute → material uniform updates → post → render
- [x] Respect `?synthwaveFixedDt=` for deterministic runs

**Resize Handler Update:**
```js
onResize() {
    if (!this.camera || !this.renderer) return;

    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Update WebGPU post-processing if active
    if (this.isWebGPU && this.postProcessing) {
        this.postProcessing.setSize(window.innerWidth, window.innerHeight);
    }
}
```

---

### Phase 3: TSL Material Library (Priority: CRITICAL)
**Objective:** Create TSL node materials for all custom shaders.

**Files to create:**
- `src/themes/synthwave-sunset/synthwave-sunset-materials.js`

**Material Conversion Order:**
1. **Grid Material** - Most visible, core aesthetic
2. **Sun Material** - Requires noise port
3. **Sun Glow Materials** - Radial gradient
4. **Highlight Material** - Gameplay feedback
5. **Particle Material** - Effects
6. **Star Material** - Background detail

**TSL Material Factory Pattern:**
```js
// synthwave-sunset-materials.js
import {
    MeshBasicNodeMaterial,
    PointsNodeMaterial,
    uniform,
    uv,
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
    positionWorld,
    time,
} from 'three/tsl';

export function createGridNodeMaterial(colors) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });

    const uTime = uniform(0);
    const uSpeed = uniform(-5.0);
    const uGridColor = uniform(colors.gridPink);
    const uPulseIntensity = uniform(0);
    const uGlowIntensity = uniform(1.0);

    // Grid calculation in TSL
    const gridSpacing = float(1.5);
    const lineWidth = float(0.04);

    const worldPos = positionWorld;
    const scrolledZ = worldPos.z.add(uTime.mul(uSpeed));

    const gridX = abs(fract(worldPos.x.div(gridSpacing).add(0.5)).sub(0.5)).mul(gridSpacing);
    const gridZ = abs(fract(scrolledZ.div(gridSpacing).add(0.5)).sub(0.5)).mul(gridSpacing);

    const lineX = smoothstep(lineWidth.mul(2.0), float(0.0), gridX);
    const lineZ = smoothstep(lineWidth.mul(2.0), float(0.0), gridZ);
    const gridLine = lineX.max(lineZ);

    // Distance fade
    const dist = length(worldPos.xz);
    const distanceFade = float(1.0).sub(smoothstep(float(5.0), float(60.0), dist));
    const perspectiveFade = float(1.0).sub(smoothstep(float(0.0), float(80.0), worldPos.z.negate()));

    // Final intensity
    const intensity = gridLine.mul(uGlowIntensity).mul(distanceFade).mul(perspectiveFade);
    const finalIntensity = intensity.add(intensity.mul(uPulseIntensity).mul(0.5));

    const color = uGridColor.mul(finalIntensity);
    const alpha = finalIntensity.mul(0.9);

    material.colorNode = color;
    material.opacityNode = alpha.mul(distanceFade);

    // Store uniforms for animation updates
    material.userData = { uTime, uSpeed, uGridColor, uPulseIntensity, uGlowIntensity };

    return material;
}

export function createSunNodeMaterial(colors) {
    // TSL port of sun shader with noise
    // ...
}

export function createStarNodeMaterial() {
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    // Use pointUV instead of gl_PointCoord
    const pointCoord = pointUV;
    const center = pointCoord.sub(0.5);
    const dist = length(center);

    // ... TSL star rendering logic

    return material;
}
```

**Tasks:**
- [x] Create `synthwave-sunset-materials.js` with material factory functions
- [x] Port simplex noise to TSL (or use `mx_noise_float` from MaterialX nodes)
- [x] Add emissive outputs for MRT bloom compatibility
- [x] Gate material selection on `this.isWebGPU`
- [x] Ensure color management matches WebGL (output color space + tone mapping)
- [x] Add explicit `emissiveNode` or MRT output nodes for neon-only bloom

---

### Phase 4: WebGPU Post-Processing (Priority: HIGH)
**Objective:** Implement advanced post-processing for WebGPU path.

**Files to create:**
- `src/themes/synthwave-sunset/synthwave-sunset-post.js`

**Post-Processing Stack:**
1. **Emissive-Only Bloom** - MRT to isolate neon elements
2. **Vignette** - Subtle darkening at edges
3. **Color Grading** - Enhance synthwave palette
4. **Optional: Chromatic Aberration** - Subtle for VHS feel
5. **Optional: Scanlines** - Retro CRT effect (toggleable)

**Implementation:**
```js
// synthwave-sunset-post.js
import { PostProcessing, mrt, output, emissive } from 'three/webgpu';
import { bloom, vignette, renderOutput } from 'three/tsl';

export class SynthwaveSunsetPost {
    constructor(renderer, scene, camera) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        // Enable MRT for emissive isolation
        this.postProcessing = new PostProcessing(renderer);

        // Configure MRT outputs
        this.postProcessing.outputNode = this.createOutputNode();
    }

    createOutputNode() {
        // Bloom only affects emissive surfaces
        const bloomPass = bloom(emissive, {
            intensity: 1.5,
            radius: 0.4,
            threshold: 0.1,
        });

        // Combine color output with bloomed emissive
        const combined = output.add(bloomPass);

        // Apply vignette
        const vignetted = vignette(combined, {
            offset: 0.5,
            darkness: 0.6,
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
- [x] Create `synthwave-sunset-post.js` with MRT bloom pipeline
- [x] Add emissive outputs to all node materials
- [x] Implement vignette and optional scanlines
- [x] Integrate with main theme render loop
- [x] WebGL fallback uses standard rendering (no post-processing or basic bloom)
- [x] Add resolution scaling for heavy passes (bloom)
- [ ] Add optional TAA or reprojection for temporal stability (deferred)

---

### Phase 5: GPU Compute Shaders (Priority: HIGH - WebGPU Exclusive)
**Objective:** Offload animation logic to GPU for massive performance gains.

**Files to create:**
- `src/themes/synthwave-sunset/synthwave-sunset-compute.js`

**Compute Shader Applications:**

#### 5.1 Particle System Compute
- Physics simulation (velocity, gravity, lifetime)
- Spawn/despawn management
- 10,000+ particles with minimal CPU overhead

```js
// Particle compute kernel
const particleComputeShader = wgslFn(`
    struct Particle {
        position: vec3f,
        velocity: vec3f,
        life: f32,
        maxLife: f32,
        size: f32,
        active: u32,
    }

    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) id: vec3u) {
        let i = id.x;
        if (i >= arrayLength(&particles)) { return; }

        var p = particles[i];
        if (p.active == 0u) { return; }

        // Physics update
        p.velocity.y -= uniforms.gravity * uniforms.deltaTime;
        p.position += p.velocity * uniforms.deltaTime;
        p.life -= uniforms.deltaTime / p.maxLife;

        if (p.life <= 0.0) {
            p.active = 0u;
        }

        particles[i] = p;
    }
`);
```

#### 5.2 Highlight Scroll Compute
- Update all highlight positions in parallel
- Handle lifecycle (spawn, fade, despawn)
- Grid synchronization

#### 5.3 Star Twinkle Compute
- Parallel twinkle phase updates
- Size oscillation
- Potential shooting star spawning

**Tasks:**
- [x] Create `synthwave-sunset-compute.js` with compute shader kernels
- [x] Implement GPU particle buffer management
- [x] Port particle physics to compute shader
- [x] Port highlight scroll logic to compute shader
- [x] WebGL fallback uses existing CPU animation
- [x] Define storage buffer layouts and bind groups for compute → render flow
- [ ] Use ping-pong buffers (positions/velocities) to avoid CPU readback (optional)
- [ ] Add GPU-side spawn counters for particles/highlights (optional)

---

### Phase 6: Visual Enhancements (Priority: MEDIUM)
**Objective:** Achieve "world-class" visuals leveraging WebGPU capabilities.

#### 6.1 Volumetric Sun Rays (God Rays)
- Radial blur from sun position
- Building occlusion for dramatic silhouettes
- Dynamic intensity based on combo state
- Use depth/occlusion buffer for stable silhouettes

#### 6.2 Enhanced Wet Reflections (Scoped)
- Screen-space reflection of **sun + buildings** on the grid only
- **No grid self-reflection**
- Subtle distortion only if stable (optional)

#### 6.3 Improved Starfield
- Constellation patterns
- Shooting stars on high combos
- Subtle parallax

#### 6.4 Color & Tone Mastering (Best-In-Class)
- Filmic tone mapping tuned for neon highlights
- Subtle color grading LUT for synthwave palette
- Dither only if needed (**no film grain**)

**Tasks:**
- [x] Implement god rays post-processing node (simple screen-space)
- [x] Create TSL wet reflection material (grid-only)
- [ ] Enhance starfield with parallax and shooting stars
- [ ] Optional: Fresnel-stable SSR refinement (if needed)

---

### Phase 7: Performance Optimization (Priority: HIGH)
**Objective:** Maximize performance on both backends.

**Optimizations:**

#### 7.1 Building Batching
- Merge building geometries per layer
- Use `BatchedMesh` for buildings with shared material
- Reduce draw calls from 90+ to 2

#### 7.2 Highlight Instancing
- Convert highlight pool to `InstancedMesh`
- Single draw call for all active highlights
- Instance buffer for position/color/intensity

#### 7.3 Uniform Buffer Optimization
- Group frequently updated uniforms
- Minimize per-frame CPU-GPU transfers
- Use uniform blocks where possible

#### 7.4 LOD for Distant Elements
- Reduce star count based on camera angle
- Simplify distant buildings
- Adaptive glow layer count

#### 7.5 Frustum Culling
- Manual culling for off-screen buildings
- Skip updates for non-visible highlights

**Tasks:**
- [x] Implement building geometry batching
- [x] Convert highlights to InstancedMesh
- [x] Optimize uniform update patterns
- [x] Add LOD system for stars/buildings
- [x] Profile and optimize hot paths (baseline instrumentation added)
- [x] Add dynamic resolution scaling based on GPU frame time
- [ ] Capture GPU/CPU timings per pass for budget enforcement

---

### Phase 8: QA & Validation (Priority: CRITICAL)
**Objective:** Ensure visual parity and seamless fallback.

**Testing Checklist:**

#### Visual Parity
- [ ] Grid scrolling speed matches
- [ ] Sun gradient colors match
- [ ] Star twinkle timing matches
- [ ] Highlight intensity matches
- [ ] Particle behavior matches
- [ ] Building silhouettes match

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
- [ ] Electron build (production packaging, GPU on/off)

**Debug Flags:**
- `?synthwaveBaseline=1` - Log FPS, backend, preset info
- `?forceWebGL=1` - Force WebGL2 fallback
- `?synthwaveDebug=1` - Enable visual debug overlays
- `?synthwaveNoPost=1` - Disable post-processing
- `?synthwaveSeed=1234` - Deterministic RNG seed for captures
- `?synthwaveFixedDt=16.666` - Fixed timestep for deterministic runs (ms)

**Tasks:**
- [ ] Create automated screenshot comparison tests
- [x] Add FPS logging for baseline comparison (baseline helper + budget logging)
- [ ] Test on multiple GPU vendors (NVIDIA, AMD, Intel)
- [ ] Validate on mobile devices (if applicable)
- [ ] Document known limitations per backend
- [x] Add deterministic capture mode (fixed dt + seed)
- [ ] Add long-run soak test for memory/GPU stability

---

## File Layout After Migration

```
src/themes/synthwave-sunset/
├── synthwave-sunset-theme.js       # Main theme (hybrid rendering)
├── synthwave-sunset-materials.js   # NEW: TSL material factory
├── synthwave-sunset-post.js        # NEW: WebGPU post-processing
├── synthwave-sunset-compute.js     # NEW: GPU compute shaders
├── synthwave-sunset-tetrominos.js  # Unchanged
└── synthwave-shaders.js            # Kept for WebGL fallback
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

---

## Success Criteria

### Phase 1 Complete
- [x] WebGPU renderer initializes without errors
- [x] Fallback to WebGL2 works silently
- [x] Basic scene renders on both backends

### Phase 4 Complete
- [ ] All materials converted to TSL (WebGPU path)
- [ ] Bloom only affects neon elements
- [ ] WebGPU visuals are clearly superior without regressions
- [ ] WebGL fallback remains stable and visually acceptable

### Phase 7 Complete
- [ ] WebGPU path 20%+ faster than WebGL baseline
- [ ] Draw calls reduced by 50%+
- [ ] Particle budget doubled with same CPU cost

### Full Migration Complete
- [ ] "World-class" visual quality on WebGPU
- [ ] Seamless WebGL fallback
- [ ] All quality presets working
- [ ] All game events trigger effects correctly

---

## Timeline Estimate (Flexible)

| Phase | Complexity | Estimated Effort |
|-------|-----------|------------------|
| 0 - Audit & Baseline | Low | 1-2 hours |
| 1 - Renderer Bootstrap | Medium | 2-4 hours |
| 2 - Render Loop | Low | 1-2 hours |
| 3 - TSL Materials | High | 8-12 hours |
| 4 - Post-Processing | Medium | 4-6 hours |
| 5 - Compute Shaders | High | 8-12 hours |
| 6 - Visual Enhancements | Medium | 6-10 hours |
| 7 - Performance | High | 4-8 hours |
| 8 - QA & Validation | Medium | 4-6 hours |

**Recommended Order:** 0 → 1 → 2 → 3 → 4 → 7 → 5 → 6 → 8

---

## References

### Local References
- `src/themes/neon-district/neon-district-theme.js` - Hybrid WebGPU implementation
- `src/themes/neon-district/neon-district-materials.js` - TSL material patterns
- `src/themes/neon-district/neon-district-post.js` - MRT bloom pipeline
- `src/themes/verdant-hills/verdant-hills-theme.js` - Hybrid setup patterns
- `docs/NEON_DISTRICT_WEBGPU_UPGRADE_PLAN.md` - Reference upgrade plan

### External References
- [Three.js WebGPU Documentation](https://threejs.org/docs/#manual/en/introduction/How-to-use-WebGPU)
- [Three.js TSL Guide](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [WebGPU Compute Shaders](https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders.html)

---

## Appendix A: TSL Noise Implementation

Port of simplex noise for sun shader:

```js
import { float, vec2, vec3, vec4, floor, fract, abs, step, dot, mix } from 'three/tsl';

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

    const i = floor(v.add(dot(v, C.yy)));
    const x0 = v.sub(i).add(dot(i, C.xx));

    const i1 = step(x0.y, x0.x).mul(vec2(1.0, 0.0)).add(
        step(x0.x, x0.y).mul(vec2(0.0, 1.0))
    );

    // ... continue port

    return result; // Returns float in range [-1, 1]
}
```

---

## Appendix B: Material Uniform Reference

### Grid Material Uniforms
| Uniform | Type | Default | Animation |
|---------|------|---------|-----------|
| time | float | 0 | `clock.getElapsedTime()` |
| speed | float | -5.0 | Static |
| gridColor | vec3 | #ff0066 | Combo shift to cyan |
| glowIntensity | float | 1.0 | Static |
| pulseIntensity | float | 0 | Decay 0.95x per frame |

### Sun Material Uniforms
| Uniform | Type | Default | Animation |
|---------|------|---------|-----------|
| time | float | 0 | `clock.getElapsedTime()` |
| colorTop | vec3 | #ffdd00 | Static |
| colorMid | vec3 | #ff8800 | Static |
| colorBottom | vec3 | #ff0066 | Static |
| stripeCount | float | 12.0 | Static |
| pulseIntensity | float | 0 | Decay 0.97x per frame |

### Highlight Material Uniforms
| Uniform | Type | Default | Animation |
|---------|------|---------|-----------|
| color | vec3 | varies | Per-tetromino color |
| intensity | float | 0 | Fade over time |
| time | float | 0 | `clock.getElapsedTime()` |

---

## Changelog

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-02-04 | 1.0 | Claude | Initial plan creation |
| 2026-02-04 | 1.1 | Codex | Best-in-class upgrades, explicit fallback, Electron constraints |
