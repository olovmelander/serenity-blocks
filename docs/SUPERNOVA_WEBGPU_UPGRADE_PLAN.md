# Supernova Theme - WebGPU Upgrade Plan

> **Goal**: Elevate the Supernova theme into a world-class visual experience by transitioning to WebGPU with GPU compute shaders, TSL node materials, and advanced post-processing - while preserving the existing aesthetic identity.

---

## Current State Analysis

### What We Have (WebGL)
| Element | Implementation | Count |
|---------|---------------|-------|
| **Core Sphere** | ShaderMaterial with simplex noise plasma + fresnel rim | 1 mesh (64x64 sphere) |
| **Glow Sprite** | Canvas-generated radial gradient texture | 1 sprite |
| **Stars** | PointsMaterial with vertex colors | 2,000 points |
| **Nebula Particles** | ShaderMaterial with orbital rotation | 200 points |
| **Shockwaves** | Torus geometry + ShaderMaterial, spawned on LINE_CLEAR | Dynamic |
| **Solar Flares** | PointsMaterial burst particles, spawned on PIECE_LOCK | Dynamic |
| **Lighting** | Ambient + Point light at core | 2 lights |
| **Post-Processing** | None | - |

### What's Strong (Keep & Refine)
- Core plasma noise aesthetic (red/gold/blue palette)
- Fresnel-based rim glow on the core
- Event-driven reactivity (shockwaves, flares, intensity pulses)
- Drifting main group with figure-8 motion
- Color palette diversity

### What Can Be Dramatically Improved
- **Star count**: 2,000 is sparse; GPU compute can push 15,000-25,000
- **Nebula particles**: 200 is minimal; compute can handle 3,000-5,000
- **Shockwaves**: CPU-managed lifecycle; could be GPU-driven with more complex visuals
- **Solar flares**: Only 20 particles per burst; compute can drive 500+ with physics
- **No post-processing**: No bloom, no chromatic aberration, no vignette
- **Core material**: GLSL shader works but TSL node material enables dynamic composition
- **No accretion disk / corona**: Missing key supernova visual elements

---

## Architecture Overview

### New File Structure
```
src/themes/supernova/
  supernova-theme.js          # Main theme (refactored for WebGPU)
  supernova-materials.js      # NEW - TSL node materials for all elements
  supernova-compute.js        # NEW - GPU compute classes
  supernova-post.js           # NEW - Post-processing pipeline
  supernova-shaders.js        # KEEP - WebGL fallback shaders (unchanged)
  supernova-tetrominos.js     # KEEP - Tetromino config (unchanged)
```

### Import Strategy (Following Black Hole / Stellar Drift Patterns)
```javascript
import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { Fn, storage, uniform, instanceIndex, ... } from 'three/tsl';
```

### Renderer Backend Negotiation & Fallback
Do not gate only on `navigator.gpu`. Use runtime renderer negotiation (same pattern as `black-hole` / `stellar-drift`) so WebGPU init failures and backend downgrades are handled safely.

```javascript
async initRenderer(container) {
    let webgpuRenderer = null;
    let renderer = null;

    try {
        webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
            alpha: true,
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
            forceWebGL: false,
        });
        await webgpuRenderer.init();
        if (webgpuRenderer.backend?.isWebGPUBackend === true) {
            renderer = webgpuRenderer;
        } else {
            webgpuRenderer.dispose();
            webgpuRenderer = null;
        }
    } catch (error) {
        webgpuRenderer?.dispose();
        webgpuRenderer = null;
    }

    if (!renderer) {
        renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });
    }

    this.renderer = renderer;
    this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
    this.capabilities = {
        compute: this.isWebGPU && typeof renderer.compute === 'function',
        post: this.isWebGPU && typeof THREE_WEBGPU.PostProcessing === 'function',
        mrt: this.isWebGPU, // Can be refined by runtime probe
    };
}
```

---

## Phase 1: Foundation - WebGPU Renderer & Quality Presets

### 1.1 WebGPU Renderer Setup
Replace `THREE.WebGLRenderer` with `THREE_WEBGPU.WebGPURenderer` (async init), but always keep WebGL fallback renderer construction in the same init function.

```javascript
this.renderer.setPixelRatio(this.getEffectivePixelRatio(this.qualityPreset.maxPixelRatio));
this.renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(this.renderer.domElement);

if (this.isWebGPU) {
    this.renderer.onDeviceLost = (info) => {
        console.error('[Supernova] WebGPU device lost:', info);
    };
}
```

### 1.2 Quality Preset System
Define tiered quality presets following the Stellar Drift pattern:

```javascript
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 25000,
        nebulaParticleCount: 5000,
        coronaParticleCount: 3000,
        flareBurstCount: 500,
        shockwaveSegments: 128,
        coreDetail: 128,           // Sphere segments
        bloomStrength: 0.65,
        bloomRadius: 0.7,
        chromaticAberration: true,
        enablePostProcessing: true,
        postDownsample: 0.85,
        maxPixelRatio: 1.5,
        computeFrameSkip: 1,
    },
    Ultra: {
        starCount: 18000,
        nebulaParticleCount: 3500,
        coronaParticleCount: 2000,
        flareBurstCount: 350,
        shockwaveSegments: 96,
        coreDetail: 96,
        bloomStrength: 0.55,
        bloomRadius: 0.6,
        chromaticAberration: true,
        enablePostProcessing: true,
        postDownsample: 0.78,
        maxPixelRatio: 1.4,
        computeFrameSkip: 1,
    },
    High: {
        starCount: 12000,
        nebulaParticleCount: 2500,
        coronaParticleCount: 1500,
        flareBurstCount: 250,
        shockwaveSegments: 64,
        coreDetail: 64,
        bloomStrength: 0.5,
        bloomRadius: 0.5,
        chromaticAberration: false,
        enablePostProcessing: true,
        postDownsample: 0.7,
        maxPixelRatio: 1.25,
        computeFrameSkip: 1,
    },
    Medium: {
        starCount: 6000,
        nebulaParticleCount: 1200,
        coronaParticleCount: 800,
        flareBurstCount: 150,
        shockwaveSegments: 48,
        coreDetail: 48,
        bloomStrength: 0.4,
        bloomRadius: 0.4,
        chromaticAberration: false,
        enablePostProcessing: true,
        postDownsample: 0.62,
        maxPixelRatio: 1.1,
        computeFrameSkip: 2,
    },
    Low: {
        starCount: 3000,
        nebulaParticleCount: 500,
        coronaParticleCount: 300,
        flareBurstCount: 80,
        shockwaveSegments: 32,
        coreDetail: 32,
        bloomStrength: 0.0,
        bloomRadius: 0.0,
        chromaticAberration: false,
        enablePostProcessing: false,
        postDownsample: 0.55,
        maxPixelRatio: 1.0,
        computeFrameSkip: 3,
    },
    Minimal: {
        starCount: 1500,
        nebulaParticleCount: 180,
        coronaParticleCount: 100,
        flareBurstCount: 40,
        shockwaveSegments: 24,
        coreDetail: 24,
        bloomStrength: 0.0,
        bloomRadius: 0.0,
        chromaticAberration: false,
        enablePostProcessing: false,
        postDownsample: 0.5,
        maxPixelRatio: 0.9,
        computeFrameSkip: 4,
    },
};
```

Quality detection uses `normalizeQuality()` utility already available in the codebase.

```javascript
const normalized = normalizeQuality(window.settings?.effectQuality);
this.qualityPreset = QUALITY_PRESETS[normalized] ?? QUALITY_PRESETS.High;
```

### 1.3 Capability Probing & Feature Flags
After renderer init, derive capabilities and gate feature creation:

- `compute`: only create `StorageBufferAttribute` particle systems if compute is supported.
- `post`: only create `SupernovaPost` if post-processing stack is supported.
- `mrt`: if unavailable, run non-MRT bloom or skip selective bloom.

### 1.4 Adaptive Runtime Governor (Required)
Use rolling frame-time averages to avoid hard stutter on mid-tier hardware:

- If average frame time `> 18.5ms` for ~30 frames: reduce post downsample, then drop one quality tier.
- If average frame time `< 12ms` for ~180 frames: allow one tier increase (up to user-selected cap).
- Never auto-upgrade above the explicit user quality level.
- If `document.hidden` is true: disable post and increase compute frame skip aggressively.

### 1.5 Shader Warmup & Hitch Prevention
Before enabling full-intensity visuals:

- Precompile material variants (`renderer.compileAsync(scene, camera)` with timeout guard).
- Run 2-3 warmup frames that execute compute + post paths once to populate pipelines.
- Delay high-cost first-event visuals until warmup completes.

### Files Modified
- `supernova-theme.js` - Renderer swap, quality detection, async init

---

## Phase 2: GPU Compute Particle Systems (`supernova-compute.js`)

All particle systems move to GPU compute using `StorageBufferAttribute` and TSL `Fn()` compute nodes. The per-frame simulation is GPU-driven; CPU is still responsible for event-triggered spawn writes (burst triggers, intensity uniforms, quality changes). If `capabilities.compute` is false, keep current CPU particle path.

### 2.1 SupernovaStarCompute

**Purpose**: Dense, layered starfield with depth parallax and twinkle.

**Buffer Layout** (vec4 per star):
| Buffer | x | y | z | w |
|--------|---|---|---|---|
| `positionBuffer` | x | y | z | depth layer (0-2) |
| `miscBuffer` | base size | twinkle phase | twinkle speed | brightness |

**Compute Logic**:
- Slow rotation around scene center (parallax: near stars rotate faster)
- Per-star twinkle: `brightness = base + sin(time * speed + phase) * 0.3`
- Size attenuation by depth
- Event reactivity: LINE_CLEAR causes a brightness pulse wave expanding outward

**Count**: 15,000 - 25,000 (quality-dependent)

### 2.2 SupernovaNebulaCompute

**Purpose**: Swirling nebula cloud particles orbiting the core in a flattened disc.

**Buffer Layout** (vec4 per particle):
| Buffer | x | y | z | w |
|--------|---|---|---|---|
| `positionBuffer` | x | y | z | orbital radius |
| `velocityBuffer` | vx | vy | vz | angular velocity |
| `lifeBuffer` | age | max life | fade | active |
| `colorBuffer` | r | g | b | alpha |

**Compute Logic**:
- Keplerian orbital motion (inner particles faster than outer)
- Vertical oscillation: `y += sin(time + phase) * amplitude`
- Subtle gravitational pull toward core center
- Color interpolation along palette based on orbital radius (red near core, blue at edges)
- Size pulsing in sync with core intensity uniform
- Event reactivity: COMBO causes orbital speed burst + color flash

**Count**: 2,500 - 5,000 (quality-dependent)

### 2.3 SupernovaCoronaCompute

**Purpose**: **New effect** - Dense particle corona hugging the core surface, simulating stellar atmosphere.

**Buffer Layout** (vec4 per particle):
| Buffer | x | y | z | w |
|--------|---|---|---|---|
| `positionBuffer` | x | y | z | active |
| `velocityBuffer` | vx | vy | vz | speed |
| `miscBuffer` | size | life | maxLife | type (0=ambient, 1=eruption) |

**Compute Logic**:
- Particles spawn on core surface (radius ~3.0-3.5)
- Ambient type: slow drift outward with gravity pull back, creating a breathing halo
- Eruption type: triggered by events, burst outward at high velocity with arc trajectories
- Both types fade with distance from core
- Color: hot white near surface, transitioning through gold to red as they cool (distance-based)

**Count**: 1,500 - 3,000 (quality-dependent)

### 2.4 SupernovaFlareBurstCompute

**Purpose**: Replaces CPU solar flares with GPU-driven directional bursts.

**Buffer Layout** (vec4 per particle):
| Buffer | x | y | z | w |
|--------|---|---|---|---|
| `positionBuffer` | x | y | z | active |
| `velocityBuffer` | vx | vy | vz | drag |
| `lifeBuffer` | age | maxLife | unused | unused |

**Compute Logic**:
- Particles start inactive; activated in batches via uniform trigger
- Directional burst from core surface with spread angle
- Velocity decay (drag) for natural arc
- Gravity pull back toward core (particles curve back)
- Trail-like appearance via size decay over lifetime
- Event reactivity: PIECE_LOCK triggers burst of 100-500 particles

**Count**: 250 - 500 per burst (quality-dependent)

### 2.5 Burst Pooling & Ring Buffer Strategy (Required)

To avoid unbounded allocations during high-action gameplay:

- Pre-allocate fixed-capacity buffers per burst system (flare/corona/shockwave).
- Use `spawnCursor` ring-buffer writes for event bursts (overwrite oldest inactive or oldest active entries).
- Clamp per-event spawn budgets by quality preset (`flareBurstCount`, `coronaBurstCount`).
- Never allocate new geometries/buffers in `onLineClear()` / `onCombo()` / `onPieceLock()`.

### 2.6 SupernovaShockwaveCompute (Optional Enhancement)

**Purpose**: GPU-driven expanding shockwave ring particles instead of CPU-managed torus meshes.

**Compute Logic**:
- Ring of particles expanding outward from core
- Per-particle wobble for organic feel
- Fade and size decay over distance
- Multiple overlapping rings with different colors from palette

**Count**: 200-400 particles per wave

### Unified Compute Dispatch
Following the intro animation pattern, all particle types can share a unified buffer with type-based branching, or use separate compute nodes dispatched in one frame without per-node `await` serialization.

```javascript
const shouldRunCompute = this.capabilities.compute
    && this.frameCount % this.qualityPreset.computeFrameSkip === 0;

if (shouldRunCompute) {
    this.renderer.compute(this.starComputeNode);
    this.renderer.compute(this.nebulaComputeNode);
    this.renderer.compute(this.coronaComputeNode);
    this.renderer.compute(this.flareComputeNode);
}
```

### Files Created
- `supernova-compute.js` - All compute classes

---

## Phase 3: TSL Node Materials (`supernova-materials.js`)

Replace all GLSL ShaderMaterials with TSL node materials for composability and WebGPU compatibility.

### 3.1 Core Node Material (`createSupernovaCoreNodeMaterial`)

Translates the current simplex noise plasma shader to TSL:

**Features**:
- Multi-octave simplex noise (TSL `mx_noise_float()` or custom)
- Fresnel rim glow with configurable sharpness
- Three-color palette mixing (primary/secondary/tertiary)
- Hot white center spots in brightest noise regions
- Pulsing intensity driven by game events
- **New**: Animated surface displacement (vertex offset along normals based on noise)
- **New**: Emissive output for selective bloom (core glows, space doesn't)

```javascript
// TSL pseudocode
const noise1 = mx_noise_float(positionLocal.mul(0.5).add(timerLocal(0.2)));
const noise2 = mx_noise_float(positionLocal.mul(1.5).sub(timerLocal(0.4)));
const plasma = noise1.add(noise2.mul(0.5)).mul(0.5).add(0.5);

const fresnel = pow(sub(1.0, dot(normalView, cameraDirection)), 1.5);
const coreColor = mix(colorPrimary, colorSecondary, plasma);
const finalColor = mix(coreColor, colorTertiary, fresnel.mul(0.9));

material.colorNode = finalColor.mul(add(1.0, intensity.mul(0.5)));
material.emissiveNode = finalColor.mul(intensity); // For bloom
```

### 3.2 Corona/Glow Node Material (`createSupernovaGlowNodeMaterial`)

Replaces the canvas-generated glow sprite with a proper TSL material:

**Features**:
- Procedural radial gradient (no texture needed)
- Color shifts based on core intensity
- Pulsing scale driven by game events
- Additive blending with depth-write disabled

### 3.3 Star Node Material (`createStarNodeMaterial`)

**Features**:
- Per-star color from buffer attribute
- Size attenuation by depth
- Soft circular point shape (discard outside radius)
- Twinkle alpha modulation from compute buffer
- Additive blending

### 3.4 Nebula Particle Node Material (`createNebulaParticleNodeMaterial`)

**Features**:
- Per-particle color from compute buffer
- Soft gaussian falloff shape
- Alpha from compute life buffer
- Additive blending
- **New**: Slight color shift over lifetime (hot -> cool)

### 3.5 Flare/Burst Node Material (`createFlareBurstNodeMaterial`)

**Features**:
- Bright white/yellow core fading to palette color
- Size from compute buffer
- Trail elongation in velocity direction (stretch point along movement)
- Additive blending

### 3.6 Shockwave Node Material (`createShockwaveNodeMaterial`)

**Features**:
- Edge glow with normal-based intensity
- Per-wave color from palette
- Opacity decay driven by compute or uniform
- **New**: Distortion/ripple pattern along the ring surface

### Files Created
- `supernova-materials.js` - All TSL node material factory functions

---

## Phase 4: Post-Processing Pipeline (`supernova-post.js`)

Following the Shifting Sands and Black Hole patterns, implement TSL-based post-processing.

### 4.1 Multi-Render Target (MRT) Setup

```javascript
const scenePass = pass(this.scene, this.camera);
scenePass.setMRT(mrt({ output, emissive }));
```

This separates the color output from emissive channels, allowing selective bloom only on bright elements (core, flares, shockwaves) without blooming the entire scene.

### 4.2 Bloom (Emissive-Only)

- **Strength**: 0.4-0.65 (quality-dependent)
- **Radius**: 0.4-0.7
- **Threshold**: Applied via MRT emissive channel
- Core and flare particles write to emissive; stars and nebula do not
- Creates the characteristic supernova glow halo

### 4.3 Chromatic Aberration (High+ Quality)

Subtle RGB channel offset at screen edges:
- Intensity: 0.002-0.004 (very subtle)
- Increases briefly during LINE_CLEAR events (energy pulse feel)
- Driven by a uniform that decays back to base value

### 4.4 Vignette

Subtle darkening at screen corners:
- Enhances focus on the central core
- Intensity: 0.3-0.5
- Slight color tint toward deep purple/blue at edges

### 4.5 Color Grading (Optional)

- Slight contrast boost
- Warm tone shift toward the supernova palette
- Subtle film grain for cinematic quality (very low intensity)

### Pipeline Order
```
Scene Render (MRT: output + emissive)
  -> Bloom (emissive channel only)
  -> Chromatic Aberration
  -> Vignette
  -> Color Grading
  -> Final Output
```

### 4.6 Post-Processing Fallback Paths (Required)
Post stack setup must degrade gracefully at runtime:

- If `capabilities.post` is false: render scene directly (`renderer.render(scene, camera)`).
- If post is supported but `mrt` is false: run non-selective bloom or reduced bloom stack without MRT.
- If post creation throws at runtime: disable post flags, dispose post stack, continue direct rendering.

```javascript
try {
    this.postProcessing = new SupernovaPost(this.renderer, this.scene, this.camera, {
        useMRT: this.capabilities.mrt,
        bloomDownsample: this.qualityPreset.postDownsample,
    });
} catch (error) {
    this.capabilities.post = false;
    this.flags.usePost = false;
    this.postProcessing = null;
}
```

### Files Created
- `supernova-post.js` - `SupernovaPost` class

---

## Phase 5: New Visual Elements

### 5.1 Accretion Ring

A flattened torus/disc of material orbiting the core, visible as a glowing ring:

- **Geometry**: Thin disc or ring mesh with TSL material
- **Material**: Animated noise-based coloring (orange/red inner, blue outer)
- **Rotation**: Slow continuous rotation, speed increases on events
- **Opacity**: Semi-transparent with additive blending
- **Emissive**: Yes - contributes to bloom

### 5.2 Energy Tendrils (Corona Wisps)

Thin line-like structures extending from the core:

- **Implementation**: GPU-driven line segments or thin tube geometry
- **Behavior**: Extend outward, curve, and retract in organic patterns
- **Count**: 6-12 tendrils
- **Event reactivity**: Extend further and brighten on LINE_CLEAR

### 5.3 Gravitational Lensing Hint (Extreme Quality Only)

A subtle distortion effect around the core simulating light bending:

- **Implementation**: Post-processing distortion pass
- **Subtlety**: Very mild - just enough to notice space warping slightly near the core
- **Only on Extreme preset** to avoid performance cost

### 5.4 Improved Background

- **Deep space gradient**: Procedural background gradient instead of flat color
- **Distant nebula clouds**: 3-5 large, subtle billboard sprites with procedural noise
- **Depth fog**: Enhanced fog with color variation (purple near core, deep blue at edges)

---

## Phase 6: Enhanced Event Reactivity

### Current Events (Enhanced)

| Event | Current Effect | WebGPU Enhanced Effect |
|-------|---------------|----------------------|
| `LINE_CLEAR` | Core intensity boost + 1 shockwave | Core intensity + displacement pulse + shockwave particle ring + star brightness wave + chromatic aberration spike + corona eruption |
| `COMBO` | Core intensity + fast shockwave | All LINE_CLEAR effects scaled by combo count + nebula speed burst + accretion ring acceleration |
| `PIECE_LOCK` | Core pulse + 20-particle flare | Core micro-pulse + 200-500 particle GPU flare burst with arc trajectories |

### New Event Responses

| Event | Effect |
|-------|--------|
| `PIECE_LOCK` (enhanced) | Corona particles erupt in the direction corresponding to piece placement |
| `LINE_CLEAR` x4 (Tetris) | Massive supernova pulse: all effects at 3x intensity, screen-wide shockwave, temporary white flash on core |
| `COMBO` > 5 | Color palette temporarily shifts to ultra-bright white/cyan, "overcharged" state |

---

## Phase 7: Animation Loop Refactor

### Current Loop (CPU-bound)
```javascript
animate() {
    updateTime();
    rotateStars();           // CPU
    lerpCoreIntensity();     // CPU
    driftMainGroup();        // CPU
    updateShockwaves();      // CPU loop over array
    updateFlares();          // CPU loop + position writes
    render();
}
```

### WebGPU Loop (GPU-compute-driven)
```javascript
animate() {
    this.frameCount += 1;
    updateTime();
    driftMainGroup();      // CPU (simple, keep as-is)
    lerpCoreIntensity();   // CPU (simple uniform lerp)

    if (this.capabilities.compute
        && this.frameCount % this.qualityPreset.computeFrameSkip === 0) {
        this.renderer.compute(this.starComputeNode);
        this.renderer.compute(this.nebulaComputeNode);
        this.renderer.compute(this.coronaComputeNode);
        this.renderer.compute(this.flareComputeNode);
    } else if (!this.capabilities.compute) {
        updateParticlesCPUFallback();
    }

    if (this.flags.usePost && this.postProcessing) {
        this.postProcessing.render();
    } else {
        this.renderer.render(this.scene, this.camera);
    }
}
```

**CPU Budget**: Near zero for particle updates when compute is available. CPU fallback path remains deterministic and visually consistent.

**Visibility Handling**: In background/tab-hidden mode, disable post-processing and throttle compute dispatch to a low-frequency budget.

---

## Phase 8: Dispose & Cleanup

Extend the existing dispose pattern to clean up:
- All `StorageBufferAttribute` instances
- Compute nodes
- Post-processing pipeline
- TSL node materials
- Any additional geometries/textures
- Stored resize handler reference (`this.boundOnResize`) instead of `bind()` at add/remove call sites
- Event subscriptions and any pooled runtime arrays/cursors

Follow the existing `scene.traverse()` disposal pattern already in the theme.

---

## Implementation Order & Priority

| Step | Phase | Priority | Estimated Complexity |
|------|-------|----------|---------------------|
| 1 | Phase 1.1 + 1.3 - Renderer negotiation + capability flags | **Critical** | Medium |
| 2 | Phase 3.1 - Core TSL node material | **Critical** | Medium |
| 3 | Phase 2.1 - Star compute | **High** | Medium |
| 4 | Phase 2.2 - Nebula compute | **High** | Medium |
| 5 | Phase 2.5 - Burst pooling/ring buffers | **High** | Medium |
| 6 | Phase 4.1 + 4.2 + 4.6 - Post pipeline with fallback | **High** | Medium |
| 7 | Phase 2.3 - Corona compute (new effect) | **Medium** | Medium-High |
| 8 | Phase 2.4 - Flare burst compute | **Medium** | Medium |
| 9 | Phase 3 (remaining) - All other TSL materials | **Medium** | Medium |
| 10 | Phase 6 - Enhanced event reactivity | **Medium** | Low-Medium |
| 11 | Phase 1.4 + 1.5 - Adaptive runtime governor + warmup | **Medium** | Medium |
| 12 | Phase 5.1 - Accretion ring | **Medium** | Medium |
| 13 | Phase 5.4 - Improved background | **Low** | Low |
| 14 | Phase 4.3-4.5 - Chromatic aberration, color grading | **Low** | Low |
| 15 | Phase 5.2 - Energy tendrils | **Low** | Medium-High |
| 16 | Phase 5.3 - Gravitational lensing (Extreme only) | **Low** | Medium |
| 17 | Phase 7 - Animation loop refactor | **Ongoing** | Integrated with each step |
| 18 | Phase 8 - Cleanup & dispose | **Final** | Low |

---

## Performance Targets

| Metric | Current (WebGL) | Target (WebGPU) |
|--------|----------------|-----------------|
| Star count | 2,000 | 15,000 - 25,000 |
| Nebula particles | 200 | 2,500 - 5,000 |
| Corona particles | 0 | 1,500 - 3,000 |
| Flare burst particles | 20 | 200 - 500 |
| CPU particle updates/frame | All | Zero on compute-capable backend |
| Draw calls (particles) | 3+ | 2-4 (quality and feature dependent) |
| Post-processing passes | 0 | 3-5 |
| Target frame time | 16.7ms | 16.7ms (mid-range target) |
| GPU memory overhead | ~10MB | Resolution-scaled: < 130MB @1080p, < 260MB @1440p |

---

## WebGL Fallback Strategy

The existing `supernova-theme.js` code is preserved as the WebGL fallback path. WebGPU usage is decided by renderer backend negotiation, not only `navigator.gpu`:

- `supernova-shaders.js` and `supernova-tetrominos.js` remain **unchanged**
- `supernova-theme.js` gains `initRenderer()` that tries WebGPU, validates `backend.isWebGPUBackend`, then falls back to `THREE.WebGLRenderer`
- Compute/post/MRT features are independently gated by `capabilities` flags
- All new files (`supernova-materials.js`, `supernova-compute.js`, `supernova-post.js`) are dynamically imported only on WebGPU path
- Users on WebGL see the exact same experience as today - no regression

---

## Key Dependencies

- `three/webgpu` - WebGPU renderer
- `three/tsl` - Three.js Shading Language for node materials and compute
- `three@0.181.2` - validated version in this repo
- `normalizeQuality()` from `src/utils/quality.js` - Quality tier detection
- `BaseTheme` methods: `getEffectivePixelRatio()`, `getAntialiasEnabled()`, `registerAnimation()`

---

## Validation & Release Gates

### Functional
- WebGPU backend path renders correctly on supported devices.
- Forced-WebGL path preserves current visual baseline with no regressions.
- Event reactions (`LINE_CLEAR`, `COMBO`, `PIECE_LOCK`) trigger expected layered effects.

### Performance
- 5-minute stress run with frequent events has no quality thrash, memory growth, or dropped renderer state.
- Mid-tier hardware sustains ~60 FPS at user-selected tier (or auto-degrades gracefully).
- Background/tab-hidden mode reduces compute/post work to minimal safe budget.

### Reliability
- `renderer.init()` failure, post stack failure, and runtime render failure all degrade safely to direct render path.
- Device-lost callback is wired and logged.
- Dispose path leaves no stale canvases, event listeners, or growth in GPU buffers after repeated theme swaps.

---

## Summary

This upgrade transforms the Supernova theme from a solid WebGL implementation into a GPU-compute-powered visual spectacle:

1. **10-12x more particles** across all systems (stars, nebula, corona, flares)
2. **Near-zero CPU particle cost** on compute-capable backend
3. **Selective bloom** via MRT - core and effects glow without washing out the scene
4. **New visual elements** - corona, accretion ring, enhanced background
5. **Richer event responses** - every game action triggers layered, multi-system visual feedback
6. **Quality scaling** - runs beautifully from low-end to high-end hardware
7. **No regression** - WebGL fallback preserves the current experience exactly
