# Electric Dreams Theme - WebGPU Upgrade Plan

> **Goal**: Elevate the Electric Dreams lava lamp theme into a world-class visual experience by transitioning to WebGPU with GPU compute shaders, TSL node materials, and advanced post-processing - while preserving and refining the beloved floating electric blob aesthetic.

---

## Current State Analysis

### What We Have (WebGL / Three.js)
| Element | Implementation | Count/Detail |
|---------|---------------|-------------|
| **Blobs** | Individual `IcosahedronGeometry(scale, 5)` meshes with custom GLSL ShaderMaterial (FBM noise displacement, SSS simulation, fresnel rim) | 4-18 (quality-dependent) |
| **Spark Particles** | `THREE.Points` with GLSL ShaderMaterial, additive blending, per-particle color/size/phase attributes | 20-200 (quality-dependent) |
| **Background** | Large inverted `SphereGeometry(200)` with animated nebula ShaderMaterial | 1 mesh |
| **Lighting** | Ambient + 3 point lights (core + 2 rim) with dynamic color cycling | 4 lights |
| **Post-Processing** | `EffectComposer` with `UnrealBloomPass` | Single bloom pass |
| **Physics** | CPU-based: layered sine drift, blob proximity detection (O(n^2)), soft repulsion, boundary clamping | Per-frame CPU loops |
| **Event Reactivity** | PIECE_LOCK (pulse + flash), COMBO (intensity/scale/speed/morph/bloom boost), LINE_CLEAR (scaled combo effects) | 3 event types |

### What's Strong (Keep & Refine)
- **Blob color palette**: The 8 electric neon colors (cyan, magenta, acid green, hot orange, electric blue, amber gold, hot pink, electric purple) are stunning
- **Organic blob morphing**: Multi-octave FBM noise displacement creates convincing lava lamp deformation
- **Proximity interaction system**: Blobs that attract, repel, and morph more intensely when near each other
- **Weightless drift physics**: Layered sine waves with unique frequencies per blob create dreamy, non-repeating motion
- **Subsurface scattering simulation**: Rim-based SSS + internal light variation sells the translucent goo feel
- **Combo reactivity**: Dramatic scale/speed/glow/morph responses to game events
- **Overall "electric lava lamp in space" aesthetic**

### What Can Be Dramatically Improved
- **Blob count**: 18 max is limited; with instanced rendering + GPU compute, 30-50 blobs become viable
- **Spark particles**: 200 max is sparse; GPU compute can drive 2,000-5,000 with physics
- **Blob merging visuals**: Proximity morphing is approximated; metaball-style smooth blending would look spectacular
- **No electric arcs**: Missing the "electric" in Electric Dreams - arcs/lightning between nearby blobs
- **Post-processing**: Single bloom pass; no chromatic aberration, no energy distortion, no selective bloom
- **Background**: Very minimal animated nebula; could have reactive energy field, plasma tendrils
- **Blob SSS quality**: Current SSS is a simple rim approximation; TSL can enable proper multi-scatter SSS
- **No energy field**: Space between blobs is empty; could have visible electric energy connecting them
- **Blob surfaces**: Static apart from noise; could have animated color swirls, plasma patterns
- **Particle diversity**: Only one spark type; could add electric motes, plasma wisps, energy ribbons

---

## Architecture Overview

### New File Structure
```
src/themes/electric-dreams/
  electric-dreams-theme.js          # Main theme (refactored for WebGPU path + WebGL fallback)
  electric-dreams-compute.js        # NEW - GPU compute: spark particles, electric motes, energy pulses
  electric-dreams-materials.js      # NEW - TSL node materials for blobs, sparks, background, arcs
  electric-dreams-post.js           # NEW - Post-processing pipeline (bloom, aberration, distortion)
  electric-dreams-tetrominos.js     # KEEP - Tetromino config (unchanged)
  webgl-electric-dreams-renderer.js # KEEP (optional legacy renderer, non-default fallback)
```

### Import Strategy (Following Established Project Patterns)
```javascript
import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import {
    Fn, If, storage, uniform, instanceIndex,
    float, vec3, vec4, sin, cos, mix, smoothstep,
    normalLocal, positionLocal, timerLocal, cameraPosition,
} from 'three/tsl';
```

### WebGPU Detection & Fallback
Do not gate only on `navigator.gpu`. Use runtime renderer negotiation so WebGPU init failures and backend downgrades are handled safely.

```javascript
async initRenderer(container) {
    let renderer = null;
    let webgpuRenderer = null;

    if (!this.flags.forceWebGL) {
        try {
            webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
                alpha: false,
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
    }

    if (!renderer) {
        renderer = new THREE.WebGLRenderer({
            alpha: false,
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });
    }

    this.renderer = renderer;
    this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
    this.capabilities = {
        compute: this.isWebGPU && typeof renderer.compute === 'function',
        post: this.isWebGPU && typeof THREE_WEBGPU.PostProcessing === 'function',
        mrt: this.isWebGPU,
    };

    if (this.isWebGPU) {
        this.renderer.onDeviceLost = (info) => {
            console.error('[ElectricDreams] WebGPU device lost:', info);
            // Trigger controlled downgrade to WebGL path.
        };
    }
}
```

---

## Phase 1: Foundation - WebGPU Renderer & Quality Presets

### 1.1 Renderer Setup (WebGPU + Robust WebGL Fallback)
Use the negotiation path above; only enable compute/post features when capabilities are confirmed at runtime.

```javascript
this.renderer.setSize(w, h);
this.renderer.setPixelRatio(this.getEffectivePixelRatio());
this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
this.renderer.toneMappingExposure = 1.3;
```

### 1.2 Enhanced Quality Preset System
Expand quality presets to cover new GPU-compute-driven systems:

```javascript
const QUALITY_PRESETS = {
    Extreme: {
        blobCount: 40,
        sparkCount: 5000,
        electricMoteCount: 3000,
        energyPulseCount: 500,
        blobDetail: 6,               // Icosahedron subdivision level
        bloomStrength: 0.7,
        bloomRadius: 0.6,
        chromaticAberration: true,
        energyDistortion: true,
        enablePostProcessing: true,
        maxPixelRatio: 1.5,
        postDownsample: 0.85,
        computeFrameSkip: 1,
    },
    Ultra: {
        blobCount: 30,
        sparkCount: 3500,
        electricMoteCount: 2000,
        energyPulseCount: 350,
        blobDetail: 6,
        bloomStrength: 0.6,
        bloomRadius: 0.5,
        chromaticAberration: true,
        energyDistortion: true,
        enablePostProcessing: true,
        maxPixelRatio: 1.4,
        postDownsample: 0.8,
        computeFrameSkip: 1,
    },
    High: {
        blobCount: 22,
        sparkCount: 2000,
        electricMoteCount: 1200,
        energyPulseCount: 200,
        blobDetail: 5,
        bloomStrength: 0.55,
        bloomRadius: 0.45,
        chromaticAberration: false,
        energyDistortion: true,
        enablePostProcessing: true,
        maxPixelRatio: 1.25,
        postDownsample: 0.72,
        computeFrameSkip: 1,
    },
    Medium: {
        blobCount: 14,
        sparkCount: 1000,
        electricMoteCount: 600,
        energyPulseCount: 100,
        blobDetail: 4,
        bloomStrength: 0.45,
        bloomRadius: 0.35,
        chromaticAberration: false,
        energyDistortion: false,
        enablePostProcessing: true,
        maxPixelRatio: 1.1,
        postDownsample: 0.64,
        computeFrameSkip: 2,
    },
    Low: {
        blobCount: 8,
        sparkCount: 400,
        electricMoteCount: 200,
        energyPulseCount: 0,
        blobDetail: 4,
        bloomStrength: 0.35,
        bloomRadius: 0.3,
        chromaticAberration: false,
        energyDistortion: false,
        enablePostProcessing: false,
        maxPixelRatio: 1.0,
        postDownsample: 0.58,
        computeFrameSkip: 3,
    },
    Minimal: {
        blobCount: 5,
        sparkCount: 150,
        electricMoteCount: 0,
        energyPulseCount: 0,
        blobDetail: 3,
        bloomStrength: 0.0,
        bloomRadius: 0.0,
        chromaticAberration: false,
        energyDistortion: false,
        enablePostProcessing: false,
        maxPixelRatio: 0.9,
        postDownsample: 0.5,
        computeFrameSkip: 4,
    },
};
```

Quality detection uses the existing `normalizeQuality()` utility.
Tune `maxPixelRatio` and `postDownsample` via runtime captures per tier.

### Files Modified
- `electric-dreams-theme.js` - Renderer swap, quality presets, async init, WebGPU/WebGL branching

---

## Phase 2: TSL Node Materials (`electric-dreams-materials.js`)

Replace all GLSL ShaderMaterials with TSL node materials for WebGPU compatibility and composability.

### 2.1 Blob Node Material (`createBlobNodeMaterial`)

The crown jewel. Translates and enhances the current blob shader into TSL with significantly improved visuals.

**Current GLSL Features (Preserve)**:
- Multi-octave FBM noise vertex displacement
- Fresnel rim glow
- Subsurface scattering simulation
- Internal light variation from noise
- Pulse intensity reactivity

**New TSL Enhancements**:
- **Animated surface color swirls**: Instead of a flat `uColor`, blend 2-3 color tones across the surface using animated noise patterns, creating visible liquid flowing inside the blob
- **Improved SSS**: Multi-layer subsurface approximation - light penetrates deeper in thin areas (near edges), creating translucent glow pools
- **Iridescent rim**: Subtle rainbow shimmer at extreme grazing angles (view-dependent hue shift), mimicking light refracting through glass
- **Hot spots**: Bright white/saturated spots that slowly drift across the surface where noise peaks, like bubbles of heat inside the blob
- **Depth-dependent translucency**: Blobs closer to camera appear more solid; distant blobs are more ghostly/translucent
- **Emissive output for selective bloom**: Core glow and SSS regions write to emissive channel so bloom only affects the right areas

```javascript
// TSL pseudocode for enhanced blob material
const time = timerLocal(0.15);
const pos = positionLocal;

// Multi-octave FBM displacement (keep existing organic morphing)
const n1 = mx_noise_float(pos.mul(0.8).add(time.mul(0.3)));
const n2 = mx_noise_float(pos.mul(2.0).add(time.mul(0.5))).mul(0.5);
const n3 = mx_noise_float(pos.mul(4.0).sub(time.mul(0.2))).mul(0.25);
const totalNoise = n1.add(n2).add(n3);
const displacement = totalNoise.mul(0.25).mul(morphFactor);
material.positionNode = positionLocal.add(normalLocal.mul(displacement));

// Animated color swirls - liquid-inside effect
const swirl1 = mx_noise_float(pos.mul(1.2).add(time.mul(0.4)));
const swirl2 = mx_noise_float(pos.mul(0.6).sub(time.mul(0.25)));
const colorMix = swirl1.mul(0.6).add(swirl2.mul(0.4));
const baseColor = mix(primaryColor, secondaryColor, colorMix);

// Subsurface scattering (enhanced)
const rim = sub(1.0, max(0.0, dot(normalView, viewDir)));
const sss = pow(rim, 1.5);
const coreGlow = sub(1.0, rim).mul(0.3).add(0.6); // Brighter deep center

// Iridescent rim shimmer
const iridescentHue = rim.mul(2.0).add(time.mul(0.1));
const iridescentColor = hsl2rgb(iridescentHue, 0.8, 0.7);
const iridescentMask = smoothstep(0.6, 0.95, rim).mul(0.15);

// Hot spots
const hotSpot = smoothstep(0.75, 0.95, totalNoise);
const hotColor = mix(baseColor, vec3(1.0, 1.0, 0.95), hotSpot.mul(0.4));

// Combine
const finalColor = hotColor.mul(coreGlow).add(sssColor).add(iridescentColor.mul(iridescentMask));
material.colorNode = finalColor;
material.emissiveNode = baseColor.mul(sss.mul(0.4).add(coreGlow.mul(0.2)));
material.opacityNode = float(0.95);
```

### 2.2 Spark Particle Node Material (`createSparkNodeMaterial`)

**Features**:
- Per-particle color from GPU compute buffer
- Size attenuation by depth
- Soft circular glow shape with bright core
- Alpha from compute life buffer
- Additive blending
- Combo-reactive brightness and color shift

### 2.3 Electric Mote Node Material (`createElectricMoteNodeMaterial`)

**Purpose**: New particle type - tiny floating electric motes that drift through the scene, creating ambient "electricity in the air."

**Features**:
- Very small (1-3px), sharp bright points
- Occasional rapid flicker (like fireflies)
- Color sampled from nearest blob (proximity-based coloring)
- Faint trails when moving fast during combos
- Additive blending

### 2.4 Energy Pulse Node Material (`createEnergyPulseNodeMaterial`)

**Purpose**: New effect - expanding ring-shaped energy pulses that emanate from blobs during events.

**Features**:
- Thin ring shape (procedural in fragment shader)
- Color inherited from triggering blob
- Fade with expansion
- Optional local distortion mask for post-processing (scalar mask sampled by distortion pass)
- If normal-based refraction is desired, add an explicit third MRT target; do not assume it exists by default

### 2.5 Background Node Material (`createBackgroundNodeMaterial`)

**Enhanced Features**:
- Procedural deep space gradient (preserve current near-black aesthetic)
- **Reactive energy field**: Subtle, slow-moving Voronoi/cellular pattern in the background that brightens and pulses during combos - as if the space itself is electrified
- **Distant nebula wisps**: 2-3 layers of very faint, slowly drifting noise clouds with blob-palette coloring
- **Star dust**: Tiny static points scattered across the background for depth

### 2.6 Electric Arc Material (`createElectricArcNodeMaterial`)

**Purpose**: New effect - visible electric arcs/lightning tendrils that arc between nearby blobs.

**Features**:
- Bright, jagged line rendered as a mesh strip
- Color blends between the two connected blobs
- Animated jitter/displacement for lightning feel
- Brightness proportional to blob proximity
- Fades in/out as blobs approach/separate
- Additive blending with strong emissive for bloom

### Files Created
- `electric-dreams-materials.js` - All TSL node material factory functions

---

## Phase 3: GPU Compute Particle Systems (`electric-dreams-compute.js`)

All particle systems move to GPU compute using `StorageBufferAttribute` and TSL `Fn()` compute nodes. Zero CPU particle updates per frame.

Shared input contract for particle compute:
- `blobStateBuffer` (`vec4` per blob: x, y, z, scale) is available to spark/mote/pulse compute kernels
- This enables nearest-blob coloring/attraction without CPU-side per-particle work

### 3.1 ElectricSparkCompute

**Purpose**: Replaces the current CPU-driven spark system with a massive GPU-driven particle field.

**Buffer Layout** (vec4 per particle):
| Buffer | x | y | z | w |
|--------|---|---|---|---|
| `positionBuffer` | x | y | z | active |
| `velocityBuffer` | vx | vy | vz | drag |
| `lifeBuffer` | age | maxLife | phase | type (0=ambient, 1=burst) |
| `colorBuffer` | r | g | b | alpha |

**Compute Logic**:
- **Ambient sparks**: Continuous slow drift with sine-wave motion, similar to current shader but computed on GPU
- **Burst sparks**: Triggered by events - spawn at blob positions, burst outward with velocity and drag
- Position wrapping at screen boundaries
- Alpha fade based on life cycle: `alpha = smoothstep(0, 0.15, t) * smoothstep(1, 0.75, t)`
- Combo reactivity: speed boost, scatter expansion, brightness increase
- Color inherited from nearest blob at spawn time

**Count**: 400 - 5,000 (quality-dependent)

### 3.2 ElectricMoteCompute

**Purpose**: Ambient electric atmosphere particles - tiny bright points that fill the space.

**Buffer Layout** (vec4 per particle):
| Buffer | x | y | z | w |
|--------|---|---|---|---|
| `positionBuffer` | x | y | z | active |
| `miscBuffer` | size | flickerPhase | flickerSpeed | brightness |

**Compute Logic**:
- Very slow Brownian-style drift (random walk with momentum)
- Subtle gravitational attraction toward nearest blob center (creates clustering near blobs)
- Flicker: rapid brightness oscillation `brightness = base + step(sin(time * flickerSpeed + phase), 0.7) * 0.8`
- Boundary wrapping
- During combos: all motes briefly flash bright white, then return to color

**Count**: 0 - 3,000 (quality-dependent)

### 3.3 EnergyPulseCompute

**Purpose**: Expanding energy rings that spawn from blob positions on game events.

**Buffer Layout** (vec4 per pulse):
| Buffer | x | y | z | w |
|--------|---|---|---|---|
| `positionBuffer` | x | y | z | active |
| `stateBuffer` | radius | maxRadius | age | maxAge |
| `colorBuffer` | r | g | b | alpha |

**Compute Logic**:
- Pulses start inactive; activated via uniform trigger
- Radius expands linearly over lifetime
- Alpha decays as radius grows
- Ring rendered via particle ring or mesh in material
- PIECE_LOCK: spawn 1 pulse from a random blob
- LINE_CLEAR: spawn 2-4 pulses from multiple blobs
- COMBO: spawn pulses from all blobs simultaneously

**Count**: 0 - 500 (quality-dependent, max active at once ~20-30)

### 3.4 Unified Compute Dispatch

```javascript
// Per-frame compute dispatch
if (this.capabilities.compute && frameCount % computeFrameSkip === 0) {
    this.renderer.compute(this.sparkCompute.computeNode);
    if (this.moteCompute?.computeNode) this.renderer.compute(this.moteCompute.computeNode);
    if (this.pulseCompute?.computeNode) this.renderer.compute(this.pulseCompute.computeNode);
}
```

### Files Created
- `electric-dreams-compute.js` - All GPU compute classes

---

## Phase 4: Post-Processing Pipeline (`electric-dreams-post.js`)

### 4.1 Multi-Render Target (MRT) Setup

```javascript
const scenePass = pass(this.scene, this.camera);
scenePass.setMRT(mrt({ output, emissive }));
```

Separates color from emissive channels. Blobs write emissive for their SSS/core glow; sparks and arcs are fully emissive. Background is not emissive (no bloom bleed into dark space).

Each emissive material must explicitly wire MRT output:

```javascript
const zeroEmissive = vec3(0.0);
material.emissiveNode = emissiveColorNode; // or vec3(0.0) for non-emissive
material.mrtNode = mrt({ emissive: material.emissiveNode || zeroEmissive });
```

### 4.2 Selective Bloom (Emissive-Only)

- **Strength**: 0.35-0.7 (quality-dependent, boosted during combos)
- **Radius**: 0.3-0.6
- Applied only to emissive channel via MRT
- Blobs get soft halo glow; arcs and sparks bloom intensely
- Dynamic strength: base + combo boost that decays

### 4.3 Chromatic Aberration (Ultra+ Quality)

Subtle RGB channel offset radiating from screen center:
- **Base intensity**: 0.001-0.003 (barely noticeable)
- **Event spike**: Jumps to 0.008-0.015 during LINE_CLEAR/COMBO, then decays
- Creates an "electric distortion" feel - as if the blobs are bending light

### 4.4 Energy Distortion (High+ Quality)

Screen-space distortion near blob positions:
- Subtle warping of the background behind and around each blob
- Intensity based on blob proximity to camera
- Creates a heat-haze/refraction effect, selling the "hot electric goo" feel
- Increases during combos

### 4.5 Vignette

- Subtle darkening at screen corners
- Tinted slightly toward deep purple/indigo to match the theme palette
- Intensity: 0.25-0.4

### Pipeline Order
```
Scene Render (MRT: output + emissive)
  -> Bloom (emissive channel only)
  -> Energy Distortion (optional, High+)
  -> Chromatic Aberration (optional, Ultra+)
  -> Vignette
  -> Final Output
```

### 4.6 Post-Processing Fallback Modes

- If MRT setup fails, fallback to non-MRT bloom with conservative threshold/strength to avoid background washout.
- If WebGPU post-processing construction fails, render scene directly and continue gameplay (no hard failure).

### Files Created
- `electric-dreams-post.js` - `ElectricDreamsPost` class

---

## Phase 5: Enhanced Blob System

### 5.1 Instanced Blob Rendering

Currently, each blob is a separate mesh with its own geometry and material. With 30-40 blobs, this creates excessive draw calls.

**Optimization**: Use `THREE.InstancedMesh` with a single shared `IcosahedronGeometry` and a single TSL node material that reads per-instance data from buffers.

**Per-Instance Buffers**:
| Buffer | x | y | z | w |
|--------|---|---|---|---|
| `instancePositionBuffer` | x | y | z | baseScale |
| `instanceColorBuffer` | r | g | b | morphIntensity |
| `instanceMiscBuffer` | phaseX | phaseY | phaseZ | pulseIntensity |

The vertex shader reads instance data to apply per-blob position, scale, color, and morph parameters.

**Benefit**: All blobs rendered in **1 draw call** instead of 18+.

**Transparency Caveat**:
- Instanced transparent meshes cannot be per-instance depth-sorted.
- Mitigation: keep blobs mostly opaque, test depth-write/depth-test combinations, and keep a quality fallback to non-instanced blobs if sorting artifacts are unacceptable.

### 5.2 GPU-Assisted Blob Physics

Default path: keep O(n^2) proximity on CPU for <= 40 blobs (780 pairs max) because it is simple, deterministic, and avoids GPU->CPU sync stalls.

Optional WebGPU path (only for higher blob counts):
- Run full blob simulation on GPU compute
- Write results directly to render-consumed buffers/instance data
- **No per-frame CPU readback**

This keeps the upgrade low-risk while preserving a future path for >40 blobs.

### 5.3 Electric Arcs Between Blobs

When two blobs are within interaction range, render a visible electric arc between them:

**Implementation**:
- CPU detects blob pairs within range (from proximity pass) and generates arc control points
- Arc rendered as a mesh strip (or line segments) with the electric arc TSL material
- 3-5 intermediate points with animated jitter displacement perpendicular to the arc axis
- Brightness and width proportional to proximity
- Arc color: blend of the two connected blob colors
- Multiple arc segments for a branching lightning look
- Maximum 8-12 simultaneous arcs to avoid visual clutter

**Event Reactivity**:
- COMBO: Arcs intensify, become thicker and brighter, more branching
- LINE_CLEAR (Tetris): All nearby blob pairs get arcs simultaneously, brief overload effect

### 5.4 Blob Color Breathing

Enhance the static per-blob color with slow, continuous color cycling:
- Each blob's hue slowly shifts ±15 degrees over 20-30 seconds
- Adjacent blobs influence each other's colors when close (color bleed)
- During combos, all blobs briefly flash toward white/high-saturation, then return

---

## Phase 6: New Visual Elements

### 6.1 Plasma Tendrils

Thin, wispy plasma trails that extend from blob surfaces:

- **Implementation**: GPU-driven line particles or thin mesh strips
- **Behavior**: Spawn on blob surface, extend outward in curved arcs following noise patterns, fade and retract
- **Count**: 2-4 tendrils per blob (quality-dependent)
- **Visual**: Thin, bright, same color as parent blob with slight white core
- **Event reactivity**: Tendrils extend further and multiply during combos

### 6.2 Reactive Background Energy Field

The background shifts from a static dark sphere to a living energy field:

- **Implementation**: TSL background material with animated Voronoi/cellular noise
- **Behavior**: Normally very dark and subtle; during combos, cells brighten and pulse, creating a "space is alive with electricity" effect
- **Color**: Deep purples and blues normally; flashes blob-palette colors during events
- **Always very subtle** to keep focus on the blobs

### 6.3 Blob Interaction Glow Bridges

When two blobs are very close (nearly merging), a bright glow bridge forms between them:

- **Implementation**: Billboard sprite or procedural mesh positioned at the midpoint between close blobs
- **Visual**: Soft, bright glow in the color blend of both blobs
- **Size**: Proportional to proximity (larger when closer)
- **This is different from electric arcs** - arcs are jagged/electric; glow bridges are smooth and warm

---

## Phase 7: Enhanced Event Reactivity

### Current Events (Enhanced)

| Event | Current Effect | WebGPU Enhanced Effect |
|-------|---------------|----------------------|
| `PIECE_LOCK` | Pulse intensity + glow flash | Pulse + flash + 1 energy pulse ring from random blob + spark burst (50-200 particles) from random blob + motes flash |
| `COMBO` | Intensity/scale/speed/morph/bloom boost | All PIECE_LOCK effects + electric arcs intensify + background energy field pulses + all blob tendrils extend + chromatic aberration spike + bloom strength spike + color flash toward white |
| `LINE_CLEAR` | Scaled combo effects | Combo effects scaled by line count + energy pulse rings from multiple blobs + spark super-burst + Tetris (4-line) triggers screen-wide energy overload |

### New Event Response: Tetris (4-Line Clear)

A special, dramatic response for clearing 4 lines simultaneously:
- All blobs briefly flash white/ultra-bright
- Energy pulse rings spawn from every blob
- Electric arcs connect all nearby blob pairs
- Massive spark burst (1000+ particles)
- Background energy field fully illuminates for 0.5s
- Chromatic aberration spikes to maximum
- Bloom strength doubles momentarily
- All effects decay back to normal over 1.5-2 seconds

---

## Phase 8: Animation Loop Refactor

### Current Loop (CPU-bound)
```javascript
animate() {
    updateTime();
    decayEffects();              // CPU
    animateBloom();              // CPU
    updateBlobs();               // CPU - O(n^2) proximity + position updates
    updateSparkUniforms();       // CPU
    updateBackgroundUniform();   // CPU
    updateLightColor();          // CPU
    render();                    // composer.render()
}
```

### WebGPU Loop (GPU-compute-driven)
```javascript
animate() {
    updateTime();
    decayEffects();                // CPU (simple exponential decays, keep as-is)
    updateUniforms();              // CPU (set time, combo intensity, etc.)

    // GPU compute - all particles updated on GPU
    if (this.capabilities.compute && frameCount % computeFrameSkip === 0) {
        this.renderer.compute(sparkCompute.computeNode);
        this.renderer.compute(moteCompute.computeNode);
        this.renderer.compute(pulseCompute.computeNode);
        // Optional: this.renderer.compute(blobPhysicsCompute.computeNode);
    }

    updateBlobPositions();         // CPU (simple sine drift) or GPU compute
    updateElectricArcs();          // CPU (arc geometry from proximity data)

    // Post-processing renders the scene
    postProcessing.render();
}
```

**CPU Budget**: Near zero for particle updates. Only uniform updates, blob drift (simple trig), and arc geometry generation remain on CPU.

---

## Phase 9: Dispose & Cleanup

Extend the existing dispose pattern to clean up:
- All `StorageBufferAttribute` instances (spark, mote, pulse, blob physics buffers)
- Compute nodes
- Post-processing pipeline (MRT, bloom, aberration passes)
- TSL node materials (blob, spark, mote, arc, background, pulse materials)
- Instanced mesh geometry and instance buffers
- Electric arc mesh geometry
- Any additional textures

Follow the existing `cleanup()` pattern already in the theme, plus:
```javascript
// Dispose compute buffers
[sparkCompute, moteCompute, pulseCompute].forEach(compute => {
    if (compute) {
        compute.positionBuffer?.array && (compute.positionBuffer = null);
        // ... dispose all storage buffers
    }
});

// Dispose post-processing
if (this.postProcessing) {
    this.postProcessing.dispose();
}
```

---

## Implementation Order & Priority

| Step | Phase | Priority | Complexity |
|------|-------|----------|------------|
| 1 | Phase 1 - WebGPU renderer + quality presets | **Critical** | Medium |
| 2 | Phase 2.1 - Blob TSL node material | **Critical** | Medium-High |
| 3 | Phase 2.5 - Background TSL node material | **High** | Low-Medium |
| 4 | Phase 5.1 - Instanced blob rendering | **High** | Medium |
| 5 | Phase 3.1 - Spark GPU compute | **High** | Medium |
| 6 | Phase 4.1-4.2 - MRT + Selective bloom | **High** | Medium |
| 7 | Phase 2.2 - Spark particle node material | **High** | Low-Medium |
| 8 | Phase 3.2 - Electric mote GPU compute | **Medium** | Medium |
| 9 | Phase 2.3 - Electric mote node material | **Medium** | Low |
| 10 | Phase 5.3 - Electric arcs between blobs | **Medium** | Medium-High |
| 11 | Phase 2.6 - Electric arc node material | **Medium** | Medium |
| 12 | Phase 7 - Enhanced event reactivity | **Medium** | Low-Medium |
| 13 | Phase 3.3 - Energy pulse compute | **Medium** | Medium |
| 14 | Phase 2.4 - Energy pulse node material | **Medium** | Low-Medium |
| 15 | Phase 4.3 - Chromatic aberration | **Low** | Low |
| 16 | Phase 4.4 - Energy distortion | **Low** | Medium |
| 17 | Phase 4.5 - Vignette | **Low** | Low |
| 18 | Phase 6.1 - Plasma tendrils | **Low** | Medium-High |
| 19 | Phase 6.2 - Reactive background energy field | **Low** | Medium |
| 20 | Phase 6.3 - Glow bridges | **Low** | Low-Medium |
| 21 | Phase 5.2 - GPU blob physics (optional) | **Low** | Medium |
| 22 | Phase 5.4 - Blob color breathing | **Low** | Low |
| 23 | Phase 8 - Animation loop refactor | **Ongoing** | Integrated with each step |
| 24 | Phase 9 - Cleanup & dispose | **Final** | Low |

---

## Performance Targets

| Metric | Current (WebGL) | Target (WebGPU) |
|--------|----------------|-----------------|
| Blob count | 4-18 | 5-40 |
| Spark particles | 20-200 | 400-5,000 |
| Electric motes | 0 | 0-3,000 |
| Energy pulses | 0 | 0-500 |
| CPU particle updates/frame | All sparks | Zero |
| Draw calls (blobs) | 18 separate | 1 instanced |
| Draw calls (particles) | 1 | 1-3 (instanced/points) |
| Post-processing passes | 1 (bloom) | 3-5 (MRT + bloom + aberration + vignette) |
| Target frame time | 16.7ms | 16.7ms |
| GPU memory overhead | ~15MB | < 60MB |

---

## WebGL Fallback Strategy

The existing Three.js WebGL Electric Dreams scene remains the canonical fallback path. Selection is done via runtime renderer negotiation (not `navigator.gpu` alone):

- `electric-dreams-tetrominos.js` remains **unchanged**
- `electric-dreams-theme.js` keeps current WebGL scene construction as fallback and adds WebGPU modules behind capability checks
- `webgl-electric-dreams-renderer.js` can remain as a legacy/experimental renderer, but is not required for parity fallback
- New files (`electric-dreams-materials.js`, `electric-dreams-compute.js`, `electric-dreams-post.js`) are loaded only when `isWebGPU === true` (dynamic import)
- If WebGPU device loss or post/compute init fails, degrade gracefully to WebGL rendering path
- Users on WebGL see the exact same experience as today - no regression

---

## Key Dependencies

- `three/webgpu` - WebGPU renderer
- `three/tsl` - Three.js Shading Language for node materials and compute
- `normalizeQuality()` from `src/utils/quality.js` - Quality tier detection
- `BaseTheme` methods: `getEffectivePixelRatio()`, `getAntialiasEnabled()`, `registerAnimation()`, `registerContainer()`
- `eventBus` / `EVENTS` from `src/events/event-bus.js` - Game event reactivity

---

## Validation & Release Gates

Before considering the upgrade complete:

1. Renderer negotiation and resilience
   - WebGPU success path confirms `renderer.backend?.isWebGPUBackend === true`
   - Forced WebGL (`forceWebGL`) runs with full visual parity and no runtime errors
   - WebGPU init failure and device-loss paths downgrade cleanly without crashing
2. Feature parity and event reactivity
   - `PIECE_LOCK`, `COMBO`, and `LINE_CLEAR` trigger all intended layered effects
   - Base mood/aesthetic remains recognizable when effects are idle
3. Performance budgets (per quality tier)
   - 60 FPS target on tier-appropriate hardware
   - No sustained frame-time spikes when combo effects stack
   - GPU memory remains under target envelope (< 60MB overhead)
4. Cleanup / leak checks
   - Repeated start/stop cycles (50+) do not grow GPU memory or CPU heap
   - All compute buffers, node materials, passes, and render targets are disposed
5. Visual QA
   - Bloom isolation verified (no background washout)
   - Instanced blob transparency shows no objectionable depth-sorting artifacts
   - Arc/tendril density remains readable and does not over-clutter gameplay
   - Quality tiers degrade gracefully (no hard visual discontinuities)

---

## Summary

This upgrade transforms the Electric Dreams theme from a beautiful WebGL lava lamp into a GPU-compute-powered electric plasma dreamscape:

1. **2-3x more blobs** rendered in a single instanced draw call instead of individual meshes
2. **25x more particles** across spark, mote, and pulse systems (200 -> 5,000+)
3. **Zero CPU particle cost** - all particle physics and animation on GPU compute
4. **Enhanced blob materials** - animated color swirls, improved SSS, iridescent rims, hot spots
5. **Electric arcs** - visible lightning connections between nearby blobs (the "electric" in Electric Dreams)
6. **Selective bloom** via MRT - blobs and effects glow without washing out the dark background
7. **Advanced post-processing** - chromatic aberration, energy distortion, vignette
8. **Richer event responses** - every game action triggers layered, multi-system visual feedback
9. **New ambient effects** - electric motes, energy pulses, plasma tendrils, reactive background
10. **Quality scaling** - runs beautifully from minimal to extreme hardware
11. **No regression** - WebGL fallback preserves the current experience exactly
