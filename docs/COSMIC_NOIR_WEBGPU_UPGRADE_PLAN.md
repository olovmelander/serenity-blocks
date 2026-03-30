# Cosmic Noir — WebGPU Hybrid Upgrade Plan

> **Goal:** Transform Cosmic Noir into a world-class WebGPU hybrid theme while preserving its signature noir aesthetic — deep blacks, silver/gray palette, cinematic planet, explosive combo effects — and making every visual element significantly more stunning.

**Reference implementations:**
- `src/themes/black-hole/` — Gold standard hybrid pattern (renderer init, MRT, compute, materials)
- `src/themes/chromadelic-highway/` — Production-hardened patterns (device loss recovery, bloom class weights, material return tuples, compile timeout, MRT audit)

**Three.js version:** r181+ with TSL (Three Shading Language) support

---

## Current Architecture (WebGL Only)

| Component | Implementation | Limitations |
|-----------|---------------|-------------|
| Renderer | `WebGLRenderer` | No GPU compute, no TSL, no MRT |
| Starfield | GLSL `ShaderMaterial` (80k points) | CPU-bound twinkle; no gravitational lensing |
| Planet | GLSL `ShaderMaterial` + texture | Static bump mapping; no subsurface scattering |
| Atmosphere | GLSL `ShaderMaterial` (FBM noise) | All noise computed in fragment; heavy per-pixel cost |
| Nebula | Texture planes + GLSL fade | Flat planes, no volumetric depth |
| Void Sparks (Combo) | 24-system GLSL pool, CPU timer | No GPU particle physics; limited burst variety |
| Cosmic Waves | Torus geometry + GLSL | Simple expanding ring |
| Glow Layers | Canvas gradient textures | No real-time glow; static opacity blend |
| Post-Processing | `EffectComposer` → Bloom + Chromatic + Vignette | Full-frame bloom (not emissive-only); sequential passes |

### Current File Structure
```
src/themes/cosmic-noir/
├── cosmic-noir-theme.js        # Main class (1,097 lines)
├── cosmic-noir-shaders.js      # All GLSL shaders (737 lines)
└── cosmic-noir-tetrominos.js   # Tetromino config (59 lines)
```

---

## Target Architecture (WebGPU Hybrid)

### New File Structure
```
src/themes/cosmic-noir/
├── cosmic-noir-theme.js        # Main class — hybrid renderer, scene setup, animation loop
├── cosmic-noir-materials.js    # TSL node material factories (planet, stars, atmosphere, nebula, sparks)
├── cosmic-noir-compute.js      # GPU compute classes (star twinkle, void spark physics, atmosphere flow)
├── cosmic-noir-post.js         # WebGPU PostProcessing class (MRT bloom, vignette, chromatic, grading)
├── cosmic-noir-shaders.js      # GLSL shaders (WebGL fallback — kept and maintained)
└── cosmic-noir-tetrominos.js   # Tetromino config (unchanged)
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
- TSL node materials (`MeshBasicNodeMaterial`, `SpriteNodeMaterial`)
- GPU compute for particles and atmosphere simulation
- `PostProcessing` with MRT (emissive-only bloom)
- Storage buffers for zero-copy GPU particle updates

When **WebGL** fallback:
- Original GLSL `ShaderMaterial` (existing shaders preserved)
- `EffectComposer` + `UnrealBloomPass` + `ShaderPass`
- CPU-side particle timers (current behavior)
- Scene looks identical, just without GPU compute acceleration

---

## Phase Dependency Graph

```
Phase 1 (Renderer Foundation) ──┬──> Phase 2 (TSL Materials)
                                │
                                ├──> Phase 4 (Post-Processing)
                                │
                                └──> Phase 7 (MRT Patching)

Phase 2 ──> Phase 3 (GPU Compute)     ← needs materials for particle rendering

Phase 2 + 4 + 7 ──> Phase 5 (Visual Enhancements)

Phase 3 + 5 ──> Phase 6 (Performance Optimization)
```

**Phases 2 and 4 can be developed in parallel** after Phase 1 is complete.
Phase 7 (MRT patching) should be wired as part of Phase 4 but defined separately for clarity.

---

## Non-Negotiable Engineering Gates

To keep this upgrade "best in class", every phase must pass objective gates before merge:

1. **Deterministic visual baseline**
   - Add seeded randomness (`?cosmicNoirSeed=12345`) so screenshots are reproducible.
   - Capture before/after frames at fixed timestamps (`?cosmicNoirFixedDeltaMs=16.67`).
   - Fail phase signoff if visual diffs exceed target thresholds for fallback parity.

2. **Fallback parity first**
   - WebGL fallback is never a second-class path.
   - Any WebGPU change that regresses fallback visuals or stability blocks the phase.

3. **Single owner per rendering stage**
   - Exactly one stage performs tonemapping.
   - Exactly one stage owns bloom source selection (MRT emissive or full-frame fallback).
   - Exactly one stage writes reactive envelope values per frame.

4. **Measured budgets, not estimates**
   - Track p50/p95 frame time, draw calls, and memory proxies (`renderer.info.memory`, texture/buffer counts) for each quality preset.
   - Record metrics for idle + combat burst scenarios.
   - No phase closes without baseline numbers captured and attached to PR notes.

5. **Fast rollback switches**
   - Every major feature has an immediate runtime kill-switch (`noCompute`, `noMRT`, `noPost`, etc.).
   - Device-loss and runtime failure paths must downgrade without reload loops.

---

## Phase 1: Hybrid Renderer Foundation
**Priority: CRITICAL | Estimated Complexity: Medium**

**Files:** `cosmic-noir-theme.js`

### 1.1 Dual Import Pattern
```javascript
import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';

// WebGL fallback post-processing (only used when !isWebGPU)
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
```
- `THREE` — Standard Three.js for WebGL types (Vector3, Color, Clock, BufferGeometry, WebGLRenderer, etc.)
- `THREE_WEBGPU` — WebGPU-specific renderer only (`WebGPURenderer`)
- WebGL post-processing imports kept for fallback path

### 1.2 Renderer Initialization
```javascript
async initRenderer(container) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    let webgpuRenderer = null;

    // Step 1: Try WebGPU (unless forced to WebGL via URL flag)
    if (!this.flags.forceWebGL) {
        try {
            webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
                antialias: this.getAntialiasEnabled(),
                powerPreference: 'high-performance',
                alpha: false,
            });
            await webgpuRenderer.init();  // CRITICAL: async initialization
        } catch (e) {
            console.warn('[CosmicNoir] WebGPU init failed, falling back to WebGL:', e.message);
            if (webgpuRenderer) webgpuRenderer.dispose();
            webgpuRenderer = null;
        }
    }

    // Step 2: Backend verification (not just truthy — must check actual backend type)
    if (webgpuRenderer && webgpuRenderer.backend?.isWebGPUBackend === true) {
        this.renderer = webgpuRenderer;
        this.isWebGPU = true;
        this.isWebGL = false;
        console.log('[CosmicNoir] WebGPU renderer initialized');
    } else {
        // Step 3: Silent fallback to WebGL2
        if (webgpuRenderer) webgpuRenderer.dispose();
        this.renderer = new THREE.WebGLRenderer({
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
            alpha: false,
        });
        this.isWebGPU = false;
        this.isWebGL = true;
        console.log('[CosmicNoir] WebGL2 renderer initialized (fallback)');
    }

    // Device loss recovery (pattern from chromadelic-highway)
    if (this.isWebGPU) {
        this.renderer.onDeviceLost = (info) => { void this.handleDeviceLoss(info); };
    }

    // Common renderer configuration
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(this.getEffectivePixelRatio());
    this.renderer.setSize(width, height);
    this.renderer.sortObjects = true;

    // Color pipeline ownership:
    // - WebGPU + post graph: post pass owns tonemapping
    // - WebGL fallback (or no post): renderer owns tonemapping
    const postEnabled = this.isWebGPU && this.qualityPreset.enablePostProcessing && !this.flags.noPost;
    if (postEnabled) {
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.toneMappingExposure = 1.0;
    } else {
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
    }
}

async handleDeviceLoss(info) {
    if (this.deviceLossRecoveryInProgress || !this.isActive) return;
    this.deviceLossRecoveryInProgress = true;
    console.error('[CosmicNoir] WebGPU device lost:', info);
    try {
        // Controlled recovery (avoid full stop() to keep lifecycle state coherent)
        this.cancelAnimationLoop();
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.disposeRuntimeResources({ removeCanvas: true });

        // Force WebGL on recovery — disable all WebGPU features
        this.flags.forceWebGL = true;
        this.flags.noCompute = true;
        this.flags.noMRT = true;

        // Restart scene with WebGL fallback
        await this.createScene();
        console.log('[CosmicNoir] Recovery complete: running on WebGL fallback.');
    } catch (error) {
        console.error('[CosmicNoir] Device-loss recovery failed:', error);
        this.isActive = false;
    } finally {
        this.deviceLossRecoveryInProgress = false;
    }
}
```

### 1.3 Capability Probing
After renderer init, query device capabilities for feature gating:
```javascript
probeCapabilities() {
    if (!this.isWebGPU) {
        this.capabilities = { isWebGPU: false };
        return;
    }
    const backend = this.renderer.backend;
    const device = backend?.device;
    this.capabilities = {
        isWebGPU: true,
        maxColorAttachments: device?.limits?.maxColorAttachments ?? 0,
        supportsCompute: !!this.renderer.compute,
    };
}
```

### 1.4 URL Debug Flags
```
?forceWebGL=1            — Force WebGL2 backend
?cosmicNoirNoCompute=1   — Disable GPU compute
?cosmicNoirNoMRT=1       — Disable MRT
?cosmicNoirNoPost=1      — Disable post-processing
?cosmicNoirMrtAudit=1    — Log material MRT metadata for debugging
?cosmicNoirBaseline=1    — Enable baseline performance capture
```

### 1.5 Capability Flags (Derived from Probing)
```javascript
updateCapabilityFlags() {
    const usePost = this.isWebGPU && this.qualityPreset.enablePostProcessing && !this.flags.noPost;
    const supportsMRT = this.capabilities?.maxColorAttachments > 1;
    const useMRT = usePost && !this.flags.noMRT && supportsMRT;
    const useCompute = this.isWebGPU && this.capabilities?.supportsCompute && !this.flags.noCompute;

    this.flags.usePost = usePost;
    this.flags.useMRT = useMRT;
    this.flags.useCompute = useCompute;
}
```

### 1.6 Make `createScene()` Async
The method becomes `async createScene()` to accommodate `await renderer.init()`:
```javascript
async createScene() {
    const container = document.getElementById('cosmic-noir-theme');
    if (!container) return;

    await this.initRenderer(container);
    this.probeCapabilities();
    this.updateCapabilityFlags();

    // Create scene elements (conditional WebGPU/WebGL paths)
    this.createStarfield();
    this.createNebulaClouds();
    this.createPlanet();
    this.createAtmosphere();
    this.createVoidSparks();

    // MRT patching (WebGPU only)
    if (this.isWebGPU && this.flags.useMRT) {
        this.ensureMrtMaterials();
    }

    // Post-processing (conditional path)
    this.setupPostProcessing();
    this.setupResizeHandler();
    this.setupEventListeners();

    // Pre-compile shaders with timeout guard (pattern from chromadelic-highway)
    await this.precompileSceneWithTimeout();

    this.startAnimation();
}
```

### 1.6.1 Timeout-Guarded Compilation
Prevents indefinite stalls during shader compilation on slow devices:
```javascript
async precompileSceneWithTimeout() {
    if (!this.isWebGPU || !this.renderer?.compileAsync) return;

    const TIMEOUT_MS = 3000;
    let timeoutId = null;
    try {
        await Promise.race([
            this.renderer.compileAsync(this.scene, this.camera),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('compile timeout')), TIMEOUT_MS);
            }),
        ]);
        console.log('[CosmicNoir] Scene pre-compiled');
    } catch (e) {
        console.warn('[CosmicNoir] compileAsync skipped:', e.message);
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }
}
```

### 1.7 Rendering (Synchronous)
Both WebGPU and WebGL paths use **synchronous** rendering (matching black hole gold standard):
```javascript
// WebGPU path
if (this.isWebGPU) {
    if (this.postProcessing && this.flags.usePost) {
        this.postProcessing.render();       // sync
    } else {
        this.renderer.render(this.scene, this.camera);  // sync
    }
}
// WebGL path
else {
    if (this.composer) {
        this.composer.render();              // sync
    } else {
        this.renderer.render(this.scene, this.camera);  // sync
    }
}
```

### 1.8 Resize Handling
Must explicitly resize both post-processing pipelines:
```javascript
setupResizeHandler() {
    this.resizeHandler = () => this.onWindowResize();
    window.addEventListener('resize', this.resizeHandler);
}

onWindowResize() {
    if (!this.camera || !this.renderer) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);

    // WebGPU PostProcessing resize
    if (this.postProcessing?.setSize) {
        this.postProcessing.setSize(width, height);
    }
    // WebGL EffectComposer resize
    if (this.composer) {
        this.composer.setSize(width, height);
    }
}
```

### 1.9 Cleanup / Disposal
Explicit disposal for both paths:
```javascript
cancelAnimationLoop() {
    if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }
}

clearEventSubscriptions() {
    this.eventUnsubscribers.forEach((unsub) => unsub?.());
    this.eventUnsubscribers = [];
}

removeResizeListener() {
    if (this.resizeHandler) {
        window.removeEventListener('resize', this.resizeHandler);
        this.resizeHandler = null;
    }
}

disposeRuntimeResources({ removeCanvas = true } = {}) {
    if (this.postProcessing) {
        this.postProcessing.dispose();
        this.postProcessing = null;
    }
    if (this.sparkCompute) {
        this.sparkCompute.dispose();
        this.sparkCompute = null;
    }
    if (this.composer) {
        this.composer.dispose?.();
        this.composer = null;
    }
    // dispose scene objects + renderer (+ optional canvas removal)
}

stop() {
    this.cancelAnimationLoop();
    this.clearEventSubscriptions();
    this.removeResizeListener();
    this.disposeRuntimeResources({ removeCanvas: true });
    super.stop();
}
```

---

**Acceptance Criteria (Phase 1):**
- WebGPU renderer initializes on current stable Chrome/Edge/Safari with WebGPU enabled
- WebGL fallback activates silently on Firefox and unsupported browsers
- `?forceWebGL=1` forces WebGL path; all `?cosmicNoirNo*` flags work
- Device loss triggers controlled auto-restart with WebGL (no restart loop, no leaked listeners)
- `compileAsync` completes or times out within 3s without stalling
- Tone mapping is applied exactly once per path (no double tone mapping)
- No console errors on either path
- Theme renders identically to current on WebGL fallback

---

## Phase 2: TSL Node Materials
**Priority: CRITICAL | Estimated Complexity: High**

**Files:** `cosmic-noir-materials.js` (new), `cosmic-noir-shaders.js` (preserved for WebGL)

### 2.0 Required TSL Imports
```javascript
// cosmic-noir-materials.js
import {
    MeshBasicNodeMaterial,
    MeshStandardNodeMaterial,
    PointsNodeMaterial,
    SpriteNodeMaterial,
    AdditiveBlending,
    NormalBlending,
    DoubleSide,
    FrontSide,
} from 'three/webgpu';

import {
    Fn, If,
    attribute, cameraPosition, instanceIndex, positionLocal, positionWorld,
    normalLocal, normalWorld, modelViewMatrix,
    uniform, storage, texture, uv, viewportUV,
    float, vec2, vec3, vec4,
    sin, cos, atan, exp, pow, sqrt, abs, sign,
    floor, fract, step, clamp, min, max, mix, smoothstep,
    dot, length, normalize, cross, reflect,
} from 'three/tsl';
```

### 2.0.1 TSL Noise Helpers (Reusable)
Port the existing GLSL `snoise`/`fbm` to TSL using the proven black hole pattern:
```javascript
// 2D hash function
function tslHash(p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
}

// 2D value noise (Perlin-like)
function tslNoise(p) {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));  // smoothstep interpolation
    const a = tslHash(i);
    const b = tslHash(i.add(vec2(1, 0)));
    const c = tslHash(i.add(vec2(0, 1)));
    const d = tslHash(i.add(vec2(1, 1)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractional Brownian Motion
function tslFbm(p, octaves = 5) {
    let v = float(0);
    let a = float(0.5);
    let coord = p;
    for (let i = 0; i < octaves; i++) {
        v = v.add(a.mul(tslNoise(coord)));
        coord = coord.mul(2.0);
        a = a.mul(0.5);
    }
    return v;
}
```
These are built at material creation time (compile-time graph construction, not runtime).

### 2.1 Planet Material — `createPlanetNodeMaterial()`

**Visual upgrade goals:**
- Procedural TSL noise for surface detail (no canvas gradient dependency)
- Subsurface scattering simulation for deep void glow on the dark side
- Animated bump mapping via TSL noise displacement
- Fresnel rim lighting with pulse reactivity
- Specular micro-highlights on crater edges

**TSL approach:**
```
colorNode ← mix(deepCharcoal, brightSilver, contrastLuma)
             + fresnelRim × pulseIntensity
             + specularHighlights
normalNode ← perturbedNormal (TSL noise-based bump)
emissiveNode ← rimGlow + pulseGlow (feeds MRT bloom)
```

**Material return tuple pattern** (from chromadelic-highway — returns `{ material, uniforms }` for clean separation):
```javascript
export function createPlanetNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({ side: FrontSide });

    const uTime = uniform(0);
    const uPulseIntensity = uniform(0);
    const uGlowIntensity = uniform(1.0);
    const uSunDirection = uniform(new Vector3(0.6, 0.4, 0.7).normalize());

    // ... build TSL graph ...

    material.colorNode = finalColor;

    // Bloom class weight (from chromadelic-highway pattern)
    // Controls how much this material contributes to MRT emissive bloom
    const PLANET_BLOOM_WEIGHT = 0.7;
    material.emissiveNode = rimGlow.add(pulseGlow).mul(PLANET_BLOOM_WEIGHT);

    return {
        material,
        uniforms: { uTime, uPulseIntensity, uGlowIntensity, uSunDirection },
        meta: { emitsBloom: true, mrtRole: 'planet' },
    };
}
```

**Runtime update in animation loop:**
```javascript
// Uniforms accessed via stored reference (not material.userData)
this.planetUniforms.uTime.value = this.time;
this.planetUniforms.uPulseIntensity.value = this.planetPulseIntensity;
```

### 2.1.1 Bloom Class Weights
Per-material emissive weighting prevents bloom washout (pattern from chromadelic-highway):
```javascript
const BLOOM_CLASS_WEIGHTS = {
    planet:      0.70,  // Strong rim bloom
    atmosphere:  0.55,  // Moderate gas glow
    starfield:   0.15,  // Subtle star halos
    voidSpark:   0.80,  // Hot explosive burst
    cosmicWave:  0.45,  // Gentle ring bloom
    planetGlow:  0.30,  // Background glow layers
    nebula:      0.00,  // No bloom (pure background)
};
```
Each material factory multiplies its `emissiveNode` by the weight, preventing bright elements from dominating the bloom pass.

### 2.2 Starfield Material — `createStarfieldNodeMaterial()`

**Visual upgrade goals:**
- GPU-driven twinkle animation via TSL
- Per-star brightness variation with atmospheric halo
- Event boost reactivity (flash on piece lock)
- Soft circular point sprites with TSL `smoothstep`

**TSL approach:**
```
Vertex:  pointSize ← aSize × pixelRatio × (300 / -mvZ)
         brightness ← aBrightness × (0.7 + sin(time × twinkleSpeed + phase) × 0.3)
         brightness *= (1.0 + eventBoost × 0.5)
Fragment: dist ← length(pointCoord - 0.5) × 2
          softCircle ← 1 - smoothstep(0, 1, dist)
          core ← 1 - smoothstep(0, 0.25, dist)
          color ← vColor × brightness + white × core
```

### 2.3 Atmosphere Material — `createAtmosphereNodeMaterial()`

**Visual upgrade goals:**
- Multi-octave FBM noise computed via TSL (GPU-native, not GLSL string)
- Domain warping for organic swirling gas flow
- Explosion shockwave rings with expanding radius
- Gas tendrils shooting outward during combo
- Energy pulse waves synchronized to combo timing
- Breathing density oscillation

**TSL approach:**
- TSL noise helper functions (`tslSnoise3D`, `tslFbm`) matching existing GLSL behavior
- Domain warping: offset noise coordinates by other noise values for organic flow
- Explosion phases: ignition → expansion → dissipation with smooth transitions
- `emissiveNode` assigned to explosion glow regions for selective bloom

### 2.4 Nebula Material — `createNebulaNodeMaterial()`

**Visual upgrade goals:**
- Texture-sampled with TSL edge fade (same visual as current)
- Pulse reactivity (gameplay events boost brightness)
- Desaturation to pure grayscale (noir enforcement)

### 2.5 Void Spark Material — `createVoidSparkNodeMaterial()`

**Visual upgrade goals:**
- GPU-computed particle positions when compute is available
- Hot white core with silver outer glow
- Noir blue tint on edges
- Smooth fade-out over lifetime

### 2.6 Cosmic Wave Material — `createCosmicWaveNodeMaterial()`

**Visual upgrade goals:**
- Fresnel-based ring intensity
- Additive blending with opacity decay
- `emissiveNode` for bloom contribution

### 2.7 WebGL Fallback
- When `!this.isWebGPU`, all `create*` methods use existing GLSL `ShaderMaterial` from `cosmic-noir-shaders.js`
- No code duplication — GLSL shaders remain in their current file, TSL materials in the new file
- Conditional branching in theme class:
  ```javascript
  if (this.isWebGPU) {
      material = createPlanetNodeMaterial({ ... });
  } else {
      material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, ... });
  }
  ```

---

**Acceptance Criteria (Phase 2):**
- All 6 material factories return `{ material, uniforms, meta }` tuples
- TSL noise helpers (`tslHash`, `tslNoise`, `tslFbm`) produce visuals matching GLSL originals
- Bloom class weights prevent emissive washout in MRT bloom pass
- Planet shows rim glow, animated bump, fresnel pulse reactivity
- Atmosphere FBM matches existing 5-octave noise visually
- WebGL path uses original GLSL shaders without modification
- Side-by-side comparison confirms visual parity (noir aesthetic preserved)

---

## Phase 3: GPU Compute Particles
**Priority: HIGH | Estimated Complexity: High**

**Files:** `cosmic-noir-compute.js` (new)

### 3.1 Void Spark Compute — `CosmicNoirSparkCompute`

**Current limitation:** 24 pooled GLSL point systems with CPU-controlled `uPulseTimer`. Each system is a separate `THREE.Points` with its own geometry and material — wasteful and limits particle count.

**Upgrade:**
- Single unified particle system with `StorageBufferAttribute` for positions, velocities, lifetimes, colors
- GPU compute kernel (TSL `Fn()`) handles:
  - Spherical surface emission (theta, phi → cartesian)
  - Radial burst velocity with random spread
  - Deceleration curve over lifetime
  - Lifetime countdown and alpha fade
  - Respawn on trigger (uniform flag)
- Burst triggering via uniform: `uBurstTrigger` (set to current time on combo)
- Staggered emission: particles have random delay offsets in their lifetime data
- Up to 50,000 particles in a single draw call (vs. 24 × 5,000 = 120k in 24 separate calls)

**Compute kernel pseudocode:**
```
Fn(() => {
    pos = positions.element(instanceIndex)
    vel = velocities.element(instanceIndex)
    life = lifeData.element(instanceIndex)

    age = time - life.x  // birth time
    If(age > 0 && age < maxLife, () => {
        // Burst outward from planet surface
        radialDir = normalize(pos.xyz)
        decel = 1 - pow(age / maxLife, 1.2)
        pos.xyz += vel.xyz * delta * max(decel, 0.35)
        life.y = 1.0 - age / maxLife  // alpha
    })
    If(age >= maxLife, () => {
        // Park particle at origin, invisible
        pos.xyz = vec3(0)
        life.y = 0
    })
})
```

**Compute dispatch in animation loop:**
```javascript
// Each frame, update uniforms and dispatch compute
if (this.isWebGPU && this.flags.useCompute && this.sparkCompute?.computeNode && this.renderer?.compute) {
    this.sparkCompute.uDelta.value = delta;
    this.sparkCompute.uTime.value = this.time;
    this.renderer.compute(this.sparkCompute.computeNode);  // GPU dispatch
}
```

**Disposal:**
```javascript
class CosmicNoirSparkCompute {
    dispose() {
        // StorageBufferAttributes are disposed with their underlying arrays
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.lifeBuffer = null;
        this.computeNode = null;
    }
}
```

**WebGL fallback:** Original 24-pool GLSL system (unchanged).

### 3.2 Star Twinkle Compute (Optional Enhancement)

- Compute per-star brightness values in a storage buffer
- Avoids per-vertex sin() in the vertex shader
- Marginal benefit at 80k stars but demonstrates compute capability

### 3.3 Atmosphere Flow Compute (Optional Enhancement)

- Precompute 3D noise field into a storage texture
- Sample from texture in atmosphere fragment instead of computing FBM per-pixel
- Significant performance gain for the atmosphere's 5-octave FBM

---

**Acceptance Criteria (Phase 3):**
- Single unified particle system replaces 24-pool void sparks
- GPU compute dispatch runs every frame without errors
- Burst triggering via `uBurstTrigger` produces identical stagger patterns to current system
- Up to 50k particles in one draw call (vs. 24 separate draw calls)
- `?cosmicNoirNoCompute=1` disables compute; falls back to CPU pool system
- WebGL path uses original 24-pool GLSL system unchanged
- No performance regression on WebGL fallback

---

## Phase 4: WebGPU Post-Processing
**Priority: HIGH | Estimated Complexity: Medium**

**Files:** `cosmic-noir-post.js` (new)

### 4.0 Required Imports
```javascript
// cosmic-noir-post.js
import * as THREE from 'three/webgpu';

import {
    emissive, mrt, output, pass, viewportUV,
    uniform, clamp, float, length, mix, smoothstep,
    vec2, vec3, dot, fract, sin,
} from 'three/tsl';

// Addon nodes for bloom and chromatic aberration
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
```

### 4.1 `CosmicNoirPost` Class

**Architecture:**
```javascript
export class CosmicNoirPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.size = { width: 0, height: 0 };
        this.postProcessing = new THREE.PostProcessing(renderer);
        this.useMRT = params.useMRT ?? true;
        this.bloomDownsample = params.bloomDownsample ?? 0.8;

        // Scene pass with MRT (color + emissive)
        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        // Extract render targets
        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT
            ? this.scenePass.getTextureNode('emissive')
            : sceneColor;

        // Bloom (emissive-only via MRT — far more efficient)
        const bloomStrength = params.bloomStrength ?? 0.40;
        const bloomRadius = params.bloomRadius ?? 0.35;
        const bloomThreshold = params.bloomThreshold ?? 0.0;
        this.bloomNode = bloom(bloomSource, bloomStrength, bloomRadius, bloomThreshold);

        // Hook setSize for bloom downsampling
        const originalSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (w, h) => {
            originalSetSize(w * this.bloomDownsample, h * this.bloomDownsample);
        };

        // TSL uniforms for post-processing tuning
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.8);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.2);
        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.004);
        this.uExposure = uniform(params.exposure ?? 1.05);
        this.uContrast = uniform(params.contrast ?? 1.03);
        this.uSaturation = uniform(params.saturation ?? 0.95);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.004);

        // Build TSL post-processing graph
        const uv = viewportUV;

        // 1. Vignette
        const dist = length(uv.sub(0.5).mul(2.0));
        const vig = smoothstep(this.uVignetteOffset, this.uVignetteOffset.sub(0.7), dist);
        const baseSample = sceneColor.sample(uv);
        const vignetted = mix(baseSample.mul(float(1).sub(this.uVignetteDarkness)), baseSample, vig);

        // 2. Chromatic aberration
        const chroma = chromaticAberration(vignetted, this.uChromaticStrength);

        // 3. Add bloom
        const combined = chroma.add(this.bloomNode);

        // 4. Exposure + ACES tone mapping
        const exposed = combined.mul(this.uExposure);
        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);
        const acesNum = exposed.mul(exposed.mul(acesA).add(acesB));
        const acesDen = exposed.mul(exposed.mul(acesC).add(acesD)).add(acesE);
        let graded = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        // 5. Subtle noir grading
        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);

        // 6. Dithering (critical for noir — prevents banding in deep blacks)
        const dither = fract(sin(dot(uv, vec2(12.9898, 78.233))).mul(43758.5453));
        const dithered = clamp(graded.add(dither.sub(0.5).mul(this.uDitherStrength)), 0.0, 1.0);

        this.postProcessing.outputNode = dithered;
        this.postProcessing.needsUpdate = true;
    }

    // Dynamic runtime update (called every frame from animation loop)
    update(params = {}) {
        if (params.bloomStrength !== undefined && this.bloomNode.strength) this.bloomNode.strength.value = params.bloomStrength;
        if (params.bloomRadius !== undefined && this.bloomNode.radius) this.bloomNode.radius.value = params.bloomRadius;
        if (params.bloomThreshold !== undefined && this.bloomNode.threshold) this.bloomNode.threshold.value = params.bloomThreshold;
        if (params.chromaticStrength !== undefined) this.uChromaticStrength.value = params.chromaticStrength;
        if (params.vignetteOffset !== undefined) this.uVignetteOffset.value = params.vignetteOffset;
        if (params.vignetteDarkness !== undefined) this.uVignetteDarkness.value = params.vignetteDarkness;
        if (params.exposure !== undefined) this.uExposure.value = params.exposure;
        if (params.contrast !== undefined) this.uContrast.value = params.contrast;
        if (params.saturation !== undefined) this.uSaturation.value = params.saturation;
        if (params.ditherStrength !== undefined) this.uDitherStrength.value = params.ditherStrength;
        if (params.bloomDownsample !== undefined) {
            this.bloomDownsample = params.bloomDownsample;
            if (this.size.width > 0 && this.size.height > 0 && this.bloomNode?._separableBlurMaterials?.length) {
                this.bloomNode.setSize(this.size.width, this.size.height);
            }
        }
    }

    render() {
        this.postProcessing.render();  // SYNCHRONOUS (matching gold standard)
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        this.scenePass.setSize(width, height);
        if (this.bloomNode?._separableBlurMaterials?.length) {
            this.bloomNode.setSize(width, height);
        }
    }

    dispose() {
        this.scenePass.dispose();
        this.bloomNode.dispose();
        this.postProcessing.dispose();
    }
}
```

### 4.2 MRT (Multiple Render Targets)

- Render scene once, output to two targets: `output` (color) and `emissive` (bloom source)
- Materials with `emissiveNode` set (planet rim, atmosphere glow, spark cores) feed the emissive target
- Bloom operates only on emissive target — no threshold artifacts on dark scene elements
- Materials without `emissiveNode` get patched with `vec3(0)` via `ensureMrtMaterials()`

### 4.3 Bloom Configuration

| Quality | Strength | Radius | Threshold | Downsample |
|---------|----------|--------|-----------|------------|
| Extreme | 0.50 | 0.45 | 0.0 (MRT) | 0.9 |
| Ultra | 0.45 | 0.40 | 0.0 (MRT) | 0.85 |
| High | 0.40 | 0.35 | 0.0 (MRT) | 0.8 |
| Medium | 0.35 | 0.30 | 0.0 (MRT) | 0.7 |
| Low | 0.25 | 0.25 | 0.7 | 0.6 |
| Minimal | 0.20 | 0.20 | 0.7 | 0.5 |

### 4.4 TSL Post-Processing Effects

1. **Vignette** — Darken edges for cinematic noir framing
   ```
   dist = length((viewportUV - 0.5) × 2)
   vig = smoothstep(offset, offset - 0.7, dist)
   color = mix(color × (1 - darkness), color, vig)
   ```

2. **Chromatic Aberration** — Subtle RGB fringing at screen edges
   ```
   dir = viewportUV - 0.5
   aberration = intensity × dot(dir, dir)
   r = sample(uv + dir × aberration).r
   g = sample(uv).g
   b = sample(uv - dir × aberration).b
   ```

3. **ACES Tone Mapping** — Industry-standard cinematic response curve

4. **Color Grading** — Exposure, contrast, saturation tuning for noir aesthetic

5. **Dithering** — Subtle noise to prevent color banding in dark gradients (critical for noir themes with deep blacks)

### 4.5 WebGL Fallback
- When `!this.isWebGPU`: use existing `EffectComposer` + `UnrealBloomPass` + `ShaderPass` chain
- Identical to current implementation

---

**Acceptance Criteria (Phase 4):**
- `CosmicNoirPost` class renders MRT bloom with emissive-only isolation
- Bloom operates on emissive channel — dark scene elements don't false-bloom
- Vignette, chromatic aberration, dithering all active in post chain
- `setSize()` resizes `scenePass` and bloom targets correctly on window resize
- `update()` accepts per-frame params (reactive bloom strength)
- `dispose()` cleans up `scenePass`, bloom node, and post-processing resources
- `?cosmicNoirNoPost=1` disables post-processing entirely
- `?cosmicNoirNoMRT=1` falls back to full-frame bloom
- Tone mapping is not applied twice (renderer + post graph conflict avoided)
- WebGL path uses existing EffectComposer chain unchanged

---

## Phase 5: Visual Enhancements (Both Paths)
**Priority: MEDIUM | Estimated Complexity: Medium**

These improvements apply regardless of WebGPU/WebGL backend.

### 5.1 Planet — Subsurface Scattering Simulation
- Simulate light bleeding through thin edges of the planet
- Soft inner glow on the dark side opposite the sun
- Creates the impression of a translucent atmosphere layer beneath the surface
- Implementation: additional fresnel term with inverted normal dot product

### 5.2 Planet — Animated Surface Flow
- Slow, procedural noise displacement on planet surface
- Creates impression of tectonic movement or magma flow beneath dark crust
- Extremely subtle — 0.02 amplitude displacement over 30-second cycle

### 5.3 Starfield — Depth Layers
- Split stars into 3 depth bands: near (bright, large), mid (medium), far (dim, small)
- Each band has independent parallax speed during camera orbit
- Creates stronger depth perception

### 5.4 Atmosphere — Volumetric Enhancement
- Additional inner atmosphere layer (closer to planet surface)
- Denser, slower-moving gas for depth
- Outer layer remains wispy and fast-moving
- Creates visual depth in the atmosphere

### 5.5 Nebula — Parallax Depth
- More nebula layers at varying Z-depths
- Stronger parallax response to camera movement
- Subtle rotation drift per layer

### 5.6 Reactive Envelope System (from chromadelic-highway)
Replace the current single `planetPulseIntensity` with a multi-channel reactive envelope:
```javascript
this.reactiveEnvelope = {
    pulse: 0,       // Planet pulse + glow layer intensity
    bloom: 0,       // Dynamic bloom strength boost
    spark: 0,       // Void spark burst intensity
    atmosphere: 0,  // Atmosphere gas explosion intensity
    star: 0,        // Starfield flash boost
};

pushReactiveEnvelope(values) {
    for (const [key, val] of Object.entries(values)) {
        this.reactiveEnvelope[key] = Math.min(
            (this.reactiveEnvelope[key] || 0) + val, 1.0
        );
    }
}

updateReactiveEnvelope(delta) {
    const decay = 1 - delta * 3.0;  // ~3× per second decay
    for (const key of Object.keys(this.reactiveEnvelope)) {
        this.reactiveEnvelope[key] *= decay;
        if (this.reactiveEnvelope[key] < 0.01) this.reactiveEnvelope[key] = 0;
    }
}
```

Event handlers push multi-channel envelopes:
```javascript
PIECE_LOCK:  pushReactiveEnvelope({ pulse: 0.12, star: 0.2 })
COMBO(n):    pushReactiveEnvelope({ pulse: 0.2+n*0.1, bloom: 0.1+n*0.08, spark: 0.3+n*0.15, atmosphere: 0.2+n*0.1 })
LINE_CLEAR:  pushReactiveEnvelope({ pulse: 0.15+lines*0.1, bloom: 0.05+lines*0.08 })
```

Animation loop reads envelope channels to drive each subsystem independently. This replaces the current single `planetPulseIntensity` + `starEventBoost` + `gasExplosionIntensity` with a unified, extensible system.

### 5.7 Combo Effects — Enhanced Void Burst
- More particle variety: trailing sparks, expanding shockwave ring, central flash
- Screen-space lens flare on high combos (>=6)
- Camera shake impulse (subtle, 2-3 pixel offset decaying over 200ms)
- Atmosphere ignition brighter and longer-lasting
- Shockwave rings with thickness variation
- Dynamic bloom strength boost via reactive envelope (not just static preset)

### 5.8 Planet Glow Layers — Replace Canvas Gradients
- Current: 6-8 `PlaneGeometry` meshes with `CanvasTexture` radial gradients
- Upgrade (WebGPU): Replace with TSL-based `SpriteNodeMaterial` using procedural radial gradient
  - No canvas texture allocation — pure GPU computation
  - Dynamic glow radius reactive to pulse intensity
  - `emissiveNode` for selective bloom contribution
- Upgrade (WebGL): Keep current canvas gradient approach (works fine)

### 5.9 Ambient Dust (Optional, Quality-Gated)
- Very subtle floating dust motes in near-field
- Only on High/Ultra/Extreme quality
- Adds depth and atmosphere without cluttering the noir aesthetic

---

**Acceptance Criteria (Phase 5):**
- Planet subsurface scattering visible on dark side edge
- Starfield 3-layer parallax creates stronger depth perception
- Atmosphere dual-layer (inner/outer) visible in WebGPU path
- Reactive envelope replaces single `planetPulseIntensity` — multi-channel decay works
- Combo effects trigger identical thresholds to current system
- High combos (>=6) produce lens flare and camera shake
- A/B comparison confirms combo effects "feel the same but better"

---

## Phase 6: Performance Optimizations
**Priority: MEDIUM | Estimated Complexity: Low**

### 6.1 GPU Compute Advantages
| Feature | WebGL (CPU) | WebGPU (Compute) | Improvement |
|---------|-------------|-------------------|-------------|
| Void Sparks | 24 draw calls, CPU timer | 1 draw call, GPU physics | ~20× fewer draw calls |
| Star Twinkle | Per-vertex sin() | Storage buffer precompute | Marginal |
| Atmosphere FBM | Per-pixel 5-octave noise | Precomputed noise texture | ~3× fragment perf |

### 6.2 MRT Bloom Efficiency
- Current: Full-frame bloom → processes entire scene including deep black areas
- Upgrade: Emissive-only bloom → processes only glowing elements
- Estimated 40-60% reduction in bloom pass cost

### 6.3 Bloom Downsampling
- Render bloom at 70-90% resolution (quality-dependent)
- Bilinear upscale back to screen size
- Imperceptible quality loss, significant performance gain

### 6.4 Single Unified Particle System
- Replace 24 separate `THREE.Points` objects with one instanced system
- Reduces state changes, buffer binds, and draw calls
- GPU compute handles all particle state updates

### 6.5 Material Compilation
- `await renderer.compileAsync(scene, camera)` before first frame
- Prevents shader compilation stutter during gameplay

---

**Acceptance Criteria (Phase 6):**
- `compileAsync()` either succeeds or times out within 3s (no startup stall loops)
- WebGPU High preset meets `p95 <= 16.7ms` frame time at 1080p on GTX 1660 / RX 580 class hardware
- WebGL High fallback frame time regression is <= 5% versus current production baseline
- Burst scenarios show draw-call reduction >= 70% versus current void spark architecture
- Bloom downsampling remains visually clean in A/B captures (no halo stepping or smear artifacts)
- 10-minute soak shows stable memory usage (no monotonic growth after warm-up)
- Quality presets scale features correctly across all 6 levels with no runtime exceptions

---

## Phase 7: MRT Material Patching
**Priority: HIGH | Estimated Complexity: Low**

### 7.1 `isNodeMaterial()` Detection Helper
Multi-level detection to handle all Three.js node material types:
```javascript
isNodeMaterial(material) {
    if (!material) return false;
    if (material.isNodeMaterial) return true;
    if (material.isMeshBasicNodeMaterial
        || material.isMeshStandardNodeMaterial
        || material.isMeshPhysicalNodeMaterial
        || material.isMeshPhongNodeMaterial
        || material.isPointsNodeMaterial
        || material.isSpriteNodeMaterial) return true;
    const type = material.type || material.constructor?.name || '';
    return type.includes('NodeMaterial');
}
```

### 7.2 `ensureMrtMaterials()` — Fail-Safe MRT Setup
**Critical:** If ANY non-node material is found in the scene, MRT is disabled entirely to prevent rendering errors.
```javascript
ensureMrtMaterials() {
    if (!this.isWebGPU || !this.flags.useMRT) return;

    const seen = new Set();
    const nonNodeMaterials = [];
    const nodeMaterials = [];
    const zeroEmissive = vec3(0, 0, 0);

    const recordMaterial = (mat, objectName = 'UnknownObject') => {
        if (!mat) return;
        if (Array.isArray(mat)) {
            mat.forEach((entry) => recordMaterial(entry, objectName));
            return;
        }
        if (seen.has(mat)) return;
        seen.add(mat);

        if (!this.isNodeMaterial(mat)) {
            nonNodeMaterials.push({
                objectName,
                materialName: mat.name || mat.type || mat.constructor?.name || 'UnknownMaterial',
            });
            return;
        }

        nodeMaterials.push(mat);
        if (!mat.emissiveNode) {
            mat.emissiveNode = zeroEmissive;
        }
        mat.mrtNode = mrt({ emissive: mat.emissiveNode || zeroEmissive });
        mat.needsUpdate = true;
    };

    if (this.scene.material) {
        recordMaterial(this.scene.material, this.scene.name || this.scene.type);
    }
    this.scene.traverse((child) => {
        if (child.material) {
            recordMaterial(child.material, child.name || child.type);
        }
    });

    // FAIL-SAFE: If any non-node material found, disable MRT entirely
    if (nonNodeMaterials.length > 0) {
        nodeMaterials.forEach((mat) => {
            mat.mrtNode = null;
            mat.needsUpdate = true;
        });
        console.warn('[CosmicNoir] MRT disabled — non-node materials detected:', nonNodeMaterials);
        this.flags.useMRT = false;
    }
}
```

### 7.3 Emissive Assignment Strategy
| Material | Emissive Content | Bloom Contribution |
|----------|-----------------|-------------------|
| Planet | Rim glow + pulse + specular highlights | Strong rim bloom |
| Atmosphere | Explosion glow + shockwave rings | Dramatic combo bloom |
| Starfield | Bright core × brightness | Subtle star glow |
| Void Sparks | Hot white core | Explosive burst bloom |
| Cosmic Waves | Wave color × opacity | Expanding ring bloom |
| Nebula | Zero (background, no bloom) | None |
| Glow Layers | Zero (already additive) | None |

---

**Acceptance Criteria (Phase 7):**
- `isNodeMaterial()` correctly identifies all Three.js node material types
- `ensureMrtMaterials()` patches all scene materials with `emissiveNode` or `vec3(0)`
- Fail-safe triggers: if any non-node material detected, MRT disables entirely
- `?cosmicNoirMrtAudit=1` logs all material MRT metadata to console
- No rendering errors when MRT is active with mixed material types

---

## Implementation Order

### Sprint 0: Guardrails + Baselines
1. Add deterministic capture flags (`?cosmicNoirSeed`, `?cosmicNoirFixedDeltaMs`).
2. Add baseline capture helper for frame time, draw calls, and VRAM snapshots.
3. Validate fallback smoke paths (`forceWebGL`, `noPost`, `noMRT`, `noCompute`) before feature work.

### Sprint 1: Foundation (Phase 1 + Phase 2 core)
1. Set up dual imports and async `initRenderer()` with fallback.
2. Add capability probing, color pipeline ownership, and device-loss recovery.
3. Create `cosmic-noir-materials.js` with planet + starfield TSL materials.
4. Wire conditional material creation in theme class.
5. Verify WebGL fallback still looks and behaves identically.

### Sprint 2: Full Materials + Post (Phase 2 complete + Phase 4 + Phase 7)
1. Add atmosphere, nebula, void spark, cosmic wave TSL materials.
2. Create `cosmic-noir-post.js` with MRT post-processing.
3. Wire conditional post stack (WebGPU post graph vs WebGL EffectComposer).
4. Implement hardened `ensureMrtMaterials()` (array-safe, fail-safe downgrade).
5. Validate emissive-only bloom behavior with `?cosmicNoirMrtAudit=1`.

### Sprint 3: GPU Compute (Phase 3)
1. Create `cosmic-noir-compute.js` with `CosmicNoirSparkCompute`.
2. Replace 24-pool void sparks with unified GPU compute system.
3. Wire compute update in animation loop with kill-switch fallback.
4. Verify burst timing parity versus current gameplay behavior.

### Sprint 4: Visual Polish (Phase 5)
1. Planet subsurface scattering + animated surface flow.
2. Starfield depth layers + enhanced parallax.
3. Atmosphere volumetric enhancement (dual layers).
4. Enhanced combo effects (lens flare, camera shake, richer bursts).

### Sprint 5: Performance + QA (Phase 6 + Signoff Pack)
1. Bloom downsampling and post tuning across presets.
2. `compileAsync()` integration with timeout telemetry.
3. Quality preset tuning for all 6 levels.
4. Cross-browser probe-path testing (Chromium, Safari, Firefox, one mobile class).
5. Produce full release signoff pack and hold merge until all gates pass.

---

## Quality Preset Updates

```javascript
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 80000,
        nebulaCount: 25,
        voidSparks: 50000,        // ↑ from 24k (GPU compute handles it)
        bloomStrength: 0.50,
        bloomRadius: 0.45,
        bloomDownsample: 0.9,     // NEW
        enablePostProcessing: true,
        enableCompute: true,       // NEW
        planetDetail: 64,
        glowLayers: 8,
        atmosphereLayers: 2,       // NEW: dual atmosphere
        dustParticles: 500,        // NEW: ambient dust
    },
    // ... scaled down for each level
    Minimal: {
        starCount: 4000,
        nebulaCount: 4,
        voidSparks: 3500,
        bloomStrength: 0.20,
        bloomRadius: 0.20,
        bloomDownsample: 0.5,
        enablePostProcessing: false,
        enableCompute: false,
        planetDetail: 16,
        glowLayers: 3,
        atmosphereLayers: 1,
        dustParticles: 0,
    },
};
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| WebGPU not available | Silent fallback to WebGL; existing shaders preserved verbatim |
| WebGPU device lost mid-session | `handleDeviceLoss()` auto-restarts with WebGL (from chromadelic-highway) |
| TSL material visual mismatch | Side-by-side comparison screenshots during development |
| Compute shader bugs | `?cosmicNoirNoCompute=1` flag disables compute; falls back to CPU pool |
| MRT not supported | `?cosmicNoirNoMRT=1` flag; full-frame bloom as fallback |
| MRT mixed materials | `ensureMrtMaterials()` fail-safe disables MRT if non-node material found |
| Bloom washout/flicker | Per-material bloom class weights control emissive contribution |
| Double tone mapping (washed highlights) | Explicit color-pipeline ownership: post graph OR renderer, never both |
| Event/listener leaks on restart | Stable handler refs (`resizeHandler`), explicit remove in `stop()` |
| Non-deterministic visual QA | Seeded random + fixed-delta capture flags for reproducible diffs |
| Shader compile stall | `precompileSceneWithTimeout()` aborts after 3s; renders without precompile |
| Performance regression | Per-phase profiling; quality presets gate features |
| Combo effect feel changes | A/B test combo triggers; preserve exact timing and thresholds |

---

## Release Signoff Pack

Each sprint closes with a signoff pack attached to the PR/release note:

| Gate | Measurement | Pass Condition |
|------|-------------|----------------|
| Functional | Manual scenario checklist + automated smoke path | No blocking defects on WebGPU or forced WebGL |
| Visual parity | Seeded screenshot diff set at fixed timestamps | Fallback visual drift below agreed threshold |
| Performance | Baseline capture (`p50`, `p95`, draw calls, memory proxies) | Meets Phase 6 budgets for target presets |
| Stability soak | 10-minute idle + 10-minute combo stress run | No crashes, no device-loss loops, no memory creep |
| Recovery | Forced device-loss and feature kill-switch tests | Clean downgrade to WebGL path without user action |

No release candidate is approved until every gate is green for both:
1. Natural WebGPU path
2. `?forceWebGL=1` fallback path

---

## Success Criteria

1. **WebGPU path renders at 60fps** on mid-range desktop GPU (GTX 1660 / RX 580 class) at High quality
2. **WebGL fallback looks identical** to current theme (no visual regression)
3. **Combo effects feel the same** — identical trigger thresholds, timing, and stagger patterns
4. **Bloom is more cinematic** — emissive-only bloom eliminates false glow on dark objects
5. **Planet is more stunning** — subsurface scattering, animated surface, richer rim lighting
6. **Atmosphere is more alive** — dual layers, deeper volumetric feel, more dramatic explosions
7. **Void sparks are more explosive** — 50k unified particles vs 24 separate pools
8. **No console errors** on either path; graceful degradation is silent
9. **Debug flags work** for isolating and testing each feature independently
10. **Performance budgets are met** — p95 frame-time targets and draw-call reductions pass signoff
11. **Soak stability is clean** — no device-loss loops or memory creep in 20-minute stress runs

---

## Browser Compatibility Matrix

This matrix is capability-driven (not version-pinned) to avoid plan drift as browser support changes.

| Browser Family | WebGPU Expectation | Fallback | Expected Path |
|----------------|--------------------|----------|---------------|
| Chromium Desktop | Prefer WebGPU when feature probe passes | WebGL2 | WebGPU + TSL + Compute + MRT (or fallback by flags/capability) |
| Safari Desktop | Prefer WebGPU when feature probe passes | WebGL2 | WebGPU + TSL; compute/MRT gated by probe |
| Firefox Desktop | Usually fallback unless probe passes | WebGL2 | WebGL2 fallback by default; WebGPU optional |
| Mobile (iOS/Android) | Capability-dependent | WebGL2 | Probe-driven: WebGPU when stable, else WebGL2 fallback |

**Testing checklist per sprint:**
1. Chromium desktop WebGPU path
2. Chromium desktop `?forceWebGL=1` fallback path
3. Safari desktop probe path (WebGPU if supported, fallback otherwise)
4. Firefox natural fallback path
5. One mobile device class (probe path + fallback path)
6. Each `?cosmicNoirNo*` flag in isolation
7. Quality preset switching at runtime
8. Combo effect triggering at various combo levels (2, 4, 8+)

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rendering mode | Synchronous `render()` | Matches both reference themes; avoids async frame timing complexity |
| Material return pattern | `{ material, uniforms, meta }` tuple | Clean separation; enables MRT audit logging (from chromadelic-highway) |
| Bloom control | Per-material class weights | Prevents bloom washout; fine-grained emissive tuning (from chromadelic-highway) |
| Noise implementation | TSL `tslHash` + `tslNoise` + `tslFbm` | Compile-time graph construction; GPU-native (from black-hole) |
| Spark architecture | Single compute system vs 24-pool | 20× fewer draw calls; enables 50k particles |
| MRT fail-safe | Disable MRT if any non-node material | Prevents mixed-material rendering crashes (from black-hole) |
| Device loss | Auto-restart with WebGL fallback | Graceful recovery without user intervention (from chromadelic-highway) |
| Color pipeline | Post owns tonemapping on WebGPU post path | Prevents double tonemap and highlight washout |
| Shader compilation | Timeout-guarded `compileAsync` (3s max) | Prevents indefinite stall on slow devices (from chromadelic-highway) |
| Post-processing dithering | Always on | Critical for noir aesthetic — prevents banding in deep blacks |
| Bloom threshold | 0.0 with MRT (emissive-only) | Eliminates false glow on dark scene elements |
| Post-processing update | `update()` method with per-frame params | Enables reactive bloom strength tied to gameplay events |
| Visual QA reproducibility | Seeded random + fixed-delta capture mode | Enables objective visual diff gating across builds |
