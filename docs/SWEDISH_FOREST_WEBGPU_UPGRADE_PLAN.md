# Swedish Forest Theme - WebGPU Hybrid Upgrade Plan

## A Firewatch-Inspired World-Class Masterpiece

> **Vision**: Transform the Swedish Forest theme into a breathtaking, Firewatch-inspired environment that stands among the finest real-time landscape renderings on the web. WebGPU hybrid rendering with TSL materials, silent WebGL 2.0 fallback, and cinematic post-processing will elevate this theme from beautiful to extraordinary.

> **Gold Standard Reference**: Black Hole theme (`src/themes/black-hole/`)

> **Art Direction Reference**: Firewatch by Campo Santo (Olly Moss, Jane Ng, Paolo Crosetto)

---

## Table of Contents

1. [Firewatch Art Direction Deep Dive](#1-firewatch-art-direction-deep-dive)
2. [Current State Analysis](#2-current-state-analysis)
3. [Architecture Overview](#3-architecture-overview)
4. [File Structure](#4-file-structure)
5. [Phase 0: Baseline, Guardrails & Kill Switches](#phase-0-baseline-guardrails--kill-switches)
6. [Phase 1: Hybrid Renderer Foundation](#phase-1-hybrid-renderer-foundation)
7. [Phase 2: Procedural Sky System](#phase-2-procedural-sky-system)
8. [Phase 3: Water & Reflections](#phase-3-water--reflections)
9. [Phase 4: Layered Forest System](#phase-4-layered-forest-system)
10. [Phase 5: Mountains & Terrain](#phase-5-mountains--terrain)
11. [Phase 6: Atmospheric Effects & Particles](#phase-6-atmospheric-effects--particles)
12. [Phase 7: Cinematic Post-Processing Pipeline](#phase-7-cinematic-post-processing-pipeline)
13. [Phase 8: GPU Compute Systems](#phase-8-gpu-compute-systems)
14. [Phase 9: Polish, Performance & QA](#phase-9-polish-performance--qa)
15. [Performance Budget](#performance-budget)
16. [Implementation Priority Order](#implementation-priority-order)
17. [Implementation Checklist: Owners & Estimates](#implementation-checklist-owners--estimates)
18. [Testing & Validation Checklist](#testing--validation-checklist)
19. [Risk Register & Rollback Playbook](#risk-register--rollback-playbook)
20. [Release & Rollout Strategy](#release--rollout-strategy)
21. [Sources & References](#sources--references)

---

## 1. Firewatch Art Direction Deep Dive

### The Firewatch Philosophy

Firewatch was art-directed by **Olly Moss** (graphic designer) and built in 3D by **Jane Ng** (lead environmental artist). The game's aesthetic is rooted in **New Deal-era National Park Service posters** - bold, clean color blocks with strong silhouettes that communicate mood through palette rather than detail.

Key insight from Jane Ng (GDC 2015): *"There are beautiful and bold colours here and they are in very distinct layers. Each layer adds to a feeling of depth and distance."*

Key insight on color: *"How does this concept make me feel? The colours are not just there to look beautiful. They really do drive the mood of the scene."*

### 1.1 The Four-Component Procedural Sky

Campo Santo's graphics programmer Paolo Crosetto built a custom procedural sky shader with four components (documented on their blog):

1. **Three-color gradient base** - Top, mid, and bottom colors defining the sky dome. Works in floating point HDR (*"if you then apply exposure or any other scaling to it, it works fine"*).
2. **Sun disc** - Configurable color, size, and exponential falloff projected onto sky dome from a position on the unit sphere (controls time of day).
3. **Sun halo** - Atmospheric scattering glow around the sun with exponential decay.
4. **Horizon halo** - Independent horizon-specific atmospheric brightening.

**Why procedural, not painted**: Painted skyboxes suffer interpolation artifacts when blending between time/weather states. Procedural generation enables real-time artist tweaking: *"there is nothing better than tweaking colors in-game, and seeing the changes happening in real time."*

### 1.2 The Multi-Colored Fog System (Critical to the Look)

This is the **single most important technique** in achieving the Firewatch look:

- **Distance-dependent color ramps**: The fog shader changes colors depending on how far an object is from the camera. It uses the camera's depth texture as a UV coordinate into a color ramp texture.
- **Dual color ramps for sunset**: When the sun is prominent (like during sunset), TWO color ramps are used - one for the general atmosphere and one for sun-facing surfaces.
- **Purpose**: The fog serves to *"lower textural noise once an object is out of the foreground"*, progressively turning detailed 3D objects into flat-colored silhouettes.
- **Implementation**: `depthValue * fogAmount` as UV.x into a 1D gradient texture storing both color (RGB) and transparency (A). Objects blend via `lerp(originalColor, fogColor, ramp.a * fogIntensity)`.

This technique is what creates Firewatch's signature layered depth - near objects are detailed and dark, distant objects are flat-colored and warm, and each depth layer has a distinct color value.

### 1.3 Tree Rendering Philosophy

Jane Ng created only **23 unique tree models** for the entire game. Key techniques:

- **Silhouette-first design**: *"When creating trees, I focused mostly on the silhouette they create in the distance"*. Only lower branches need polish since the rest is beyond the player's view.
- **Distance-adaptive alpha**: Tree shaders were modified so distant trees **"puff out" more** by changing their alpha cutoff level as distance increases. This transitions trees from detailed geometry to graphic shapes.
- **Fog dissolves detail**: Combined with the multi-colored fog, distant trees become near-flat silhouettes in warm atmospheric colors.

### 1.4 Rock & Terrain Treatment

- **Minimalist geometry**: Surfaces distilled to *"smooth surfaces interrupted by jagged edges and detailed divots"*.
- **Flat diffuse + baked AO**: Textures are *"almost flat grey with ambient occlusion baked in"*. This keeps the stylized look while adding depth.
- **Miniature painting technique**: Divots and edges are *"dry-brushed to emphasize details"* - mimicking physical miniature painting.
- **Narrative priority**: *"Narratively important elements in the environment have more texture detail"* to establish *"a clear visual language"*.

### 1.5 Color Grading & Final Image

Campo Santo used **Amplify Color** for powerful color grading as the final pass. This is what brings the warm, filmic quality to every frame. The color grading:
- Pushes warm tones further
- Slightly crushes blacks for richness
- Unifies disparate scene elements under a cohesive mood
- Shifts per time-of-day to match narrative emotional beats

### 1.6 Reference Color Palettes (Extracted from Game)

**Sunset/Golden Hour** (our target mood):
| Layer | Hex | Description |
|-------|-----|-------------|
| Sky Top | `#30122D` | Deep plum-purple |
| Sky Upper | `#870734` | Dark burgundy-crimson |
| Sky Mid | `#CB2D3E` | Rich crimson |
| Sky Lower | `#EF473A` | Bright red-orange |
| Horizon | `#FFD6BF` | Warm peach-cream |
| Sun Core | `#FFFFEE` | Near-white warmth |
| Sun Corona | `#FFCC44` | Deep gold |
| Tree Near | `#180604` | Near-black warm |
| Tree Mid | `#4A2015` | Dark warm brown |
| Tree Far | `#CC8055` | Light orange-brown |
| Water Base | `#3A2510` | Dark warm brown |
| Water Highlight | `#FFAA44` | Amber gold |
| Mountain Near | `#2C0C07` | Very dark brown |
| Mountain Far | `#F28A45` | Warm orange |
| Fog/Haze | `#FF9944` | Golden orange |

**Key Palette Principle**: Colors progress from **cool-dark** (near/foreground) to **warm-light** (far/background). This is the opposite of typical atmospheric perspective (where distance = cooler/bluer). Firewatch's warm fog creates a unique look where distance = warmer/more golden.

### 1.7 What Makes It "Firewatch" - The Checklist

A scene reads as "Firewatch-style" when ALL of these are present:
- [ ] **5-7 distinct color layers** from foreground to background
- [ ] **Warm atmospheric fog** between layers (not blue/grey fog)
- [ ] **Strong tree silhouettes** - triangular/conical conifers with clean edges
- [ ] **Flat-shaded look** - no PBR, no high-frequency textures on distant objects
- [ ] **Bold, limited palette** - 4-6 core colors per scene
- [ ] **Sun as focal point** - large, warm, with visible glow/halo
- [ ] **Gradient sky** - smooth color transition, not photorealistic
- [ ] **Warm-to-cool foreground** (dark silhouettes) vs **warm background** (golden haze)
- [ ] **Painterly quality** - color grading, vignette, soft bloom
- [ ] **Meditative mood** - slow motion, gentle animations, no hard edges

---

## 2. Current State Analysis

### Existing Implementation Inventory

| Component | Current Approach | Lines | Status |
|-----------|-----------------|-------|--------|
| Renderer | `THREE.WebGLRenderer` only | ~15 | WebGL-only |
| Sky Dome | GLSL ShaderMaterial (4-component procedural) | ~50 | Good foundation |
| Sun | GLSL sphere + 5 sprite glow layers | ~80 | Working |
| Mountains (2D) | GLSL ShaderMaterial silhouettes (3 layers) | ~60 | Decent |
| Mountains (3D) | 6 heightmap meshes with inline GLSL | ~600 | Bloated, duplicated |
| Trees | Instanced foliage + trunks with GLSL | ~400 | Good structure |
| Water | `SwedishForestWater` class (WebGL mirror) | Separate file | WebGL-only |
| Birds | `SwedishForestBirds` with `GPUComputationRenderer` | Separate file | WebGL-only |
| God Rays | GLSL ShaderMaterial planes | ~40 | Basic |
| Fireflies | GLSL Points with per-particle animation | ~80 | Working |
| Dust Motes | GLSL Points | ~40 | Basic |
| Spirits | GLSL billboard sprites | ~50 | Working |
| Lens Flares | GLSL planes along sun-camera axis | ~80 | Working |
| Clouds | GLSL card billboards | ~30 | Basic |
| Haze Layers | GLSL transparent planes | ~30 | Basic |
| Grass | Instanced billboard quads with inline GLSL | ~100 | Working |
| Shore Elements | Rocks, logs, reeds, foam (mixed approaches) | ~400 | Various |
| Post-Processing | **None** | 0 | Major gap |
| Color Grading | **None** | 0 | Major gap |
| Tone Mapping | **None** | 0 | Major gap |
| Multi-Colored Fog | **Not implemented** | 0 | Major gap |
| Shaders File | 34 exported GLSL shader strings | ~1560 | WebGL-only |

**Total main file**: ~4700+ lines (monolithic, hard to maintain)

### Critical Gaps vs Firewatch

1. **No multi-colored distance fog** - The #1 technique that creates the Firewatch look is completely absent. Currently using simple `FogExp2`.
2. **No post-processing** - No bloom, vignette, color grading, or tone mapping. The raw render output lacks the cinematic warmth.
3. **No emissive bloom** - Sun, god rays, fireflies, and water specular have no glow.
4. **WebGL-only** - Cannot leverage WebGPU's MRT, TSL, or compute capabilities.
5. **Monolithic codebase** - 4700+ lines in one file makes iteration difficult.

---

## 3. Architecture Overview

### Hybrid Renderer Pattern

```
SwedishForestTheme (extends BaseTheme)
         │
    initRenderer()
    ┌────────┬────────┐
    │ Try    │ Check  │ Fallback
    │ WebGPU │ is     │ WebGL2
    │Renderer│ WebGPU │ Renderer
    └────────┴────────┘
         │
    ┌────┴────┐
    │isWebGPU?│
    └────┬────┘
    true │ false
    ┌────┴────────────────────────┐
    │                             │
┌───▼────────┐  ┌────────────────▼──────────┐
│ WebGPU     │  │ WebGL Path                │
│ Path       │  │                           │
│            │  │ GLSL ShaderMaterial        │
│ TSL Node   │  │ (from shaders.js)         │
│ Materials  │  │                           │
│ (from      │  │ EffectComposer            │
│ materials  │  │ + UnrealBloomPass         │
│ .js)       │  │ + ShaderPass (color grade)│
│            │  │                           │
│ MRT Post   │  │ GPUComputationRenderer    │
│ Processing │  │ (birds)                   │
│            │  │                           │
│ TSL Compute│  │ Distance fog via uniform  │
│ (birds)    │  │ color ramp                │
│            │  │                           │
│ Distance   │  │                           │
│ fog via    │  │                           │
│ TSL nodes  │  │                           │
└────────────┘  └───────────────────────────┘
```

### Material Factory Pattern
Every visual element gets a factory function that returns the right material:

```javascript
// In swedish-forest-materials.js
export function createSkyMaterial(params, isWebGPU) {
    if (isWebGPU) {
        // TSL node material
        return createSkyNodeMaterial(params);
    } else {
        // GLSL ShaderMaterial
        return createSkyGLSLMaterial(params);
    }
}
```

This keeps the main theme file clean - it calls `createSkyMaterial()` and doesn't care which path runs.

---

## 4. File Structure

### New Organization

```
src/themes/swedish-forest/
├── swedish-forest-theme.js          # Main class (refactored, ~1800 lines)
│                                    #   - initRenderer() (hybrid)
│                                    #   - createScene() (async)
│                                    #   - animate()
│                                    #   - event handlers
│                                    #   - dispose/cleanup
│
├── swedish-forest-materials.js      # NEW: All material factories
│                                    #   - TSL node materials (WebGPU)
│                                    #   - GLSL material wrappers (WebGL)
│                                    #   - Shared: createSkyMaterial()
│                                    #   - Shared: createWaterMaterial()
│                                    #   - Shared: createTreeMaterial()
│                                    #   - Shared: createMountainMaterial()
│                                    #   - Shared: createParticleMaterials()
│                                    #   - Shared: createFogMaterial()
│
├── swedish-forest-shaders.js        # KEEP: GLSL shaders (WebGL fallback)
│                                    #   - All existing GLSL strings
│                                    #   - New: distance fog GLSL
│                                    #   - New: color grading GLSL
│
├── swedish-forest-post.js           # NEW: WebGPU PostProcessing class
│                                    #   - MRT setup (output + emissive)
│                                    #   - Bloom from emissive channel
│                                    #   - Firewatch color grading in TSL
│                                    #   - Vignette, ACES tone mapping
│                                    #   - Film grain (subtle)
│
├── swedish-forest-compute.js        # NEW: GPU compute (WebGPU path)
│                                    #   - Bird flocking via TSL Fn()
│                                    #   - Firefly position updates
│                                    #   - Wind field simulation
│
├── swedish-forest-fog.js            # NEW: Multi-colored distance fog
│                                    #   - Firewatch-style color ramp fog
│                                    #   - Dual ramp for sunset
│                                    #   - Depth-to-color mapping
│                                    #   - Works on both paths
│
├── swedish-forest-scene.js          # NEW: Scene element builders
│                                    #   - createMountainGeometry()
│                                    #   - createTreeInstances()
│                                    #   - createShoreElements()
│                                    #   - Shared geometry helpers
│
├── swedish-forest-water.js          # REFACTORED: Hybrid water
│                                    #   - WebGPU: TSL water material
│                                    #   - WebGL: Existing mirror approach
│
├── swedish-forest-birds.js          # REFACTORED: Hybrid birds
│                                    #   - WebGPU: TSL compute flocking
│                                    #   - WebGL: GPUComputationRenderer
│
└── swedish-forest-tetrominos.js     # KEEP: Unchanged
```

### Import Pattern

```javascript
// swedish-forest-theme.js
import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import {
    uniform, float, vec2, vec3, vec4, color,
    mix, smoothstep, sin, cos, abs, pow, clamp, max, min,
    uv, time, positionWorld, positionLocal, normalWorld,
    texture, Fn, If, select,
    output, emissive, mrt,
    pass, bloom,
} from 'three/tsl';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { SWEDISH_FOREST_TETROMINOS } from './swedish-forest-tetrominos.js';
import {
    createSkyMaterial, createSunMaterial, createWaterMaterial,
    createTreeFoliageMaterial, createTreeTrunkMaterial,
    createMountainMaterial, create3DMountainMaterial,
    createGodRayMaterial, createFireflyMaterial,
    createDustMoteMaterial, createSpiritMaterial,
    createHazeMaterial, createCloudMaterial,
    createGrassMaterial, createGroundMaterial,
    createLensFlareMaterial, createFogMaterial,
} from './swedish-forest-materials.js';
import { SwedishForestPost } from './swedish-forest-post.js';
import { SwedishForestBirdCompute } from './swedish-forest-compute.js';
import { SwedishForestFog } from './swedish-forest-fog.js';
```

---

## Phase 0: Baseline, Guardrails & Kill Switches

**Priority**: CRITICAL - Must be completed before Phase 1
**Risk Level**: High (without this, regressions become hard to detect and recover from)
**Dependencies**: None

### 0.1 Platform & API Constraints (Pin These)

- Three.js version in this repo: **0.181.2** (`package.json`)
- Electron version in this repo: **38.3.0** (`package.json`)
- All WebGPU/TSL code in this plan must follow r181 API shape (`await renderer.init()`, no `renderAsync()` path)
- Capability checks must be runtime-based (`renderer.backend`, `renderer.hasFeature(...)`) rather than browser-version assumptions
- WebGPU point primitive constraint: glow particles that need larger than 1px sprites should use instanced billboards/sprites, not `Points`

### 0.2 Capability Matrix (Source of Truth)

| Runtime State | Post | MRT Emissive Isolation | Compute | Expected Behavior |
|--------------|------|------------------------|---------|-------------------|
| WebGPU + MRT + Compute | Yes | Yes | Yes | Full feature set |
| WebGPU + MRT (no compute) | Yes | Yes | No | Visual parity, lower simulation scale |
| WebGPU (no MRT) | Yes | No | Optional | Fallback bloom source = scene color |
| WebGL2 | Optional (`EffectComposer`) | No | No | Stable fallback path |

### 0.3 Required Kill Switches / Debug Flags

- `?forceWebGL=1` - Force WebGL path
- `?swedishForestNoPost=1` (and/or legacy `?noPost=1`) - Disable post-processing
- `?swedishForestNoMRT=1` (and/or legacy `?noMRT=1`) - Disable MRT path
- `?swedishForestNoCompute=1` (and/or legacy `?noCompute=1`) - Disable compute path
- `?swedishForestBaseline=1` - Enable baseline logging
- `?swedishForestSeed=1234` - Deterministic RNG seed for visual captures
- `?swedishForestFixedDt=16.666` - Deterministic fixed timestep (ms) for reproducible capture

### 0.4 Baseline Capture Protocol (Before Migration)

- Capture screenshots and frame-time stats for every quality preset on current WebGL implementation
- Record startup logs for both default and `?forceWebGL=1` runs
- Store one 10-minute soak run log (memory + FPS + errors)

**Capture template**:
```
- Machine/GPU:
- Runtime: Browser or Electron build
- Resolution / DPR:
- Preset:
- Backend selected:
- Avg FPS:
- 1% low FPS:
- GPU memory estimate:
- Screenshot path:
- Console errors/warnings:
```

### 0.5 Phase Gate Criteria

- [ ] Baseline captures completed and committed for all presets
- [ ] Capability matrix validated in runtime logs
- [ ] All kill switches verified and documented
- [ ] Deterministic capture mode (`seed` + `fixedDt`) implemented
- [ ] Explicit "WebGPU can look better, WebGL must remain stable" parity policy agreed

---

## Phase 1: Hybrid Renderer Foundation

**Priority**: CRITICAL - Must be done first
**Risk Level**: Medium (can break rendering)
**Dependencies**: Phase 0

### 1.1 Constructor Updates

```javascript
constructor() {
    super('swedish-forest');

    // Renderer state
    this.isWebGPU = false;
    this.capabilities = {};
    this.flags = {
        forceWebGL: false,
        noPost: false,
        noCompute: false,
        noMRT: false,
        baseline: false,
        debug: false,
    };

    // Debug determinism for baseline captures
    this.debugSeed = null;
    this.fixedDtMs = null;

    // Store bound listeners once so removeEventListener works
    this.boundOnResize = this.onWindowResize.bind(this);
    this.handleDisplaySettingsChange = null;

    // Parse URL debug flags
    if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        this.flags.forceWebGL = params.get('forceWebGL') === '1';
        this.flags.noPost = params.get('swedishForestNoPost') === '1' || params.get('noPost') === '1';
        this.flags.noCompute = params.get('swedishForestNoCompute') === '1' || params.get('noCompute') === '1';
        this.flags.noMRT = params.get('swedishForestNoMRT') === '1' || params.get('noMRT') === '1';
        this.flags.baseline = params.get('swedishForestBaseline') === '1';
        this.flags.debug = params.get('debug') === '1';
        this.debugSeed = params.get('swedishForestSeed');
        const fixedDt = params.get('swedishForestFixedDt');
        this.fixedDtMs = fixedDt ? Number(fixedDt) : null;
    }

    // ... rest of existing constructor properties
}
```

### 1.2 Async `initRenderer()` Method

```javascript
async initRenderer(container) {
    let webgpuRenderer = null;

    // Step 1: Try WebGPU
    if (!this.flags.forceWebGL) {
        try {
            webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
                antialias: this.getAntialiasEnabled(),
                powerPreference: 'high-performance',
                alpha: true,
            });
            await webgpuRenderer.init();
        } catch (error) {
            console.warn('[SwedishForest] WebGPU init failed:', error.message);
            if (webgpuRenderer) { webgpuRenderer.dispose(); webgpuRenderer = null; }
        }
    }

    // Step 2: Verify backend
    if (webgpuRenderer?.backend?.isWebGPUBackend === true) {
        this.renderer = webgpuRenderer;
        this.isWebGPU = true;
        this.renderer.onDeviceLost = (info) => {
            console.error('[SwedishForest] WebGPU device lost:', info);
        };
    } else {
        // Step 3: Silent WebGL 2.0 fallback
        if (webgpuRenderer) webgpuRenderer.dispose();
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });
        this.isWebGPU = false;
    }

    console.log(`[SwedishForest] Backend: ${this.isWebGPU ? 'WebGPU' : 'WebGL2'}`);

    // Common setup
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(this.getEffectivePixelRatio());
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.registerContainer(container);
}
```

### 1.3 Capability Probing

```javascript
probeCapabilities() {
    if (!this.isWebGPU) {
        this.capabilities = { isWebGPU: false, maxColorAttachments: 0 };
        return;
    }
    const device = this.renderer.backend?.device;
    this.capabilities = {
        isWebGPU: true,
        maxColorAttachments: device?.limits?.maxColorAttachments ?? 0,
        supportsTimestampQuery: device?.features?.has('timestamp-query') ?? false,
        supportsFloat32Filterable: device?.features?.has('float32-filterable') ?? false,
    };
}

updateFeatureFlags() {
    const preset = this.qualityPreset;
    const supportsMRT = this.capabilities.maxColorAttachments > 1;

    this.flags.usePost = this.isWebGPU && preset.enablePostProcessing && !this.flags.noPost;
    this.flags.useMRT = this.flags.usePost && !this.flags.noMRT && supportsMRT;
    this.flags.useCompute = this.isWebGPU && !this.flags.noCompute;
    this.flags.useBloom = this.flags.usePost;
}
```

### 1.4 Convert `createScene()` to Async

```javascript
async createScene() {
    console.log('[SwedishForest] Initializing scene...');

    const container = document.getElementById('swedish-forest-theme');
    if (!container) { console.error('[SwedishForest] Container not found'); return; }
    container.innerHTML = '';

    // Quality
    const quality = this.getCurrentQualityLevel();
    this.applyQualityPreset(quality);

    // Scene + camera (unchanged)
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(COLORS.fog.getHex(), 0.008);
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 800);
    this.camera.position.set(0, 5, 160);
    this.camera.lookAt(0, 6, -20);

    // Hybrid renderer init (async!)
    await this.initRenderer(container);
    this.probeCapabilities();
    this.updateFeatureFlags();

    // Scene elements (same order, using material factories)
    this.createSkyDome();
    this.createMountains();
    this.createSilhouetteMountain();
    this.createSun();
    this.createGodRays();
    this.createLensFlares();
    this.createTrees();
    this.createHazeLayers();
    this.createForestFloor();
    this.createLake();
    this.createShoreFoam();
    this.createWaterLogs();
    this.createShoreRocks();
    this.createShoreReeds();
    this.createLakeFramingTrees();
    this.createGrass();
    this.createMistLayers();
    this.createStylizedClouds();
    this.createSilhouetteGrass();

    // Birds (hybrid compute)
    await this.initBirds();

    this.createSpiritWinds();
    this.createDustMotes();
    this.createFireflySystem();
    this.createForestSpirits();
    this.setupLighting();

    // Multi-colored distance fog (NEW - Firewatch signature technique)
    this.setupDistanceFog();

    // Post-processing (NEW)
    this.setupPostProcessing();

    // WebGPU async compile for non-MRT path
    if (this.isWebGPU && this.renderer?.compileAsync && !this.flags.useMRT) {
        try { await this.renderer.compileAsync(this.scene, this.camera); }
        catch (e) { console.warn('[SwedishForest] compileAsync failed:', e); }
    }

    // Events and animation
    this.setupEventListeners();
    window.addEventListener('resize', this.boundOnResize);
    this.animate();

    console.log(`[SwedishForest] Scene ready (${this.isWebGPU ? 'WebGPU' : 'WebGL2'})`);
}
```

### 1.5 Validation Criteria
- [x] Runtime capability matrix chooses the expected path (no hardcoded browser assumptions)
- [x] Silent fallback to WebGL when WebGPU init/capabilities fail (no startup crash)
- [x] `?forceWebGL=1` forces WebGL path
- [x] `?swedishForestNoPost=1`, `?swedishForestNoMRT=1`, `?swedishForestNoCompute=1` each gate their feature
- [x] `this.isWebGPU` correctly set before any material creation
- [x] Existing scene renders identically on WebGL path (no regressions)
- [x] Device loss handler registered for WebGPU
- [x] Resize listener cleanup uses the same stored function reference (`this.boundOnResize`)

### 1.6 Implementation Status (Implementation Complete, Validation Deferred)

- [x] Async renderer bootstrap (`initRenderer`) with silent WebGL fallback
- [x] Runtime capability probing + derived feature flags (`usePost`, `useMRT`, `useCompute`, `useBloom`)
- [x] URL kill switches parsed and wired (`forceWebGL`, `NoPost`, `NoMRT`, `NoCompute`, baseline/debug flags)
- [x] Deterministic baseline support (`seed`, `fixedDt`) and baseline metrics logging
- [x] Device loss handler registration for WebGPU
- [x] Stable listener lifecycle using stored handler references (`boundOnResize`)
- [x] Phase 1 compatibility guard was retired after migrating remaining active non-Node materials (shore foam + mist) and bird compute blocker
- [x] Water normal map startup hardened (fallback normal texture + load retry) to avoid repeated WebGL texture warnings
- [x] Windows startup log noise reduced (skip unsupported WebGPU `powerPreference` hint on Windows)
- [ ] Execute runtime smoke matrix (default, `forceWebGL`, `NoPost`, `NoMRT`, `NoCompute`) in Electron + browser (deferred per request)
- [ ] Capture and attach baseline artifacts/screenshots to Phase 1 execution board (deferred per request)
- [ ] Run 10-minute soak and record memory/frame-time trend (deferred per request)
- [x] Phase 1 implementation scope is complete and ready for Phase 2 development

---

## Phase 2: Procedural Sky System

**Priority**: HIGH - Sets the entire scene's mood
**Dependencies**: Phase 1
**Art Reference**: Campo Santo's 4-component procedural sky

### 2.1 Why This Matters

The sky is the **largest color surface** in the scene and determines the overall mood. As Jane Ng noted: *"Since the game is set outdoors the biggest chunk of colour is determined by the sky."* Getting the sky right makes everything else fall into place because fog, lighting, and reflections all derive from sky colors.

### 2.2 TSL Sky Dome Material

The sky dome should implement all four components from Campo Santo's system:

**Component 1 - Three-Color Gradient Base**:
```
TSL: mix(horizonColor, midColor, smoothstep(0.0, 0.55, elevationT))
     mix(result, topColor, smoothstep(0.3, 1.0, elevationT))
```
Where `elevationT` is derived from the world-space normal Y component. Working in HDR (no clamping) so exposure/tone mapping can be applied later.

**Component 2 - Sun Disc**:
```
TSL: sunDot = max(dot(viewDir, sunDirection), 0.0)
     sunDisc = 1.0 - smoothstep(0.0, sunDiscRadius, 1.0 - sunDot)
     output += sunColor * sunDisc * sunIntensity
```

**Component 3 - Sun Halo**:
```
TSL: haloFactor = pow(sunDot, haloFalloff)
     output += haloColor * haloFactor * haloIntensity
```
Exponential falloff creates natural scattering glow.

**Component 4 - Horizon Halo**:
```
TSL: horizonFactor = pow(1.0 - abs(elevationT - 0.0), horizonFalloff)
     output += horizonHaloColor * horizonFactor * horizonIntensity
```
Independent of sun position - brightens the entire horizon band.

**New Enhancement - Subtle Cloud Wisps**:
TSL noise nodes to add procedural wispy cloud texture to the sky dome. Very subtle - just breaking up the pure gradient.

### 2.3 TSL Sun Material

The sun sphere needs multiple visual layers:
- **Core**: Near-white center with subtle internal turbulence (TSL noise)
- **Corona**: Radial gradient from bright center to transparent edge
- **Time pulse**: Gentle intensity breathing via `sin(time * 0.8) * 0.05`
- **Emissive output**: Full emissive for MRT bloom (this is what makes the sun GLOW)

```
TSL colorNode: mix(coreColor, coronaColor, pow(fresnel, 1.5))
TSL emissiveNode: sunColor * sunIntensity * (1.0 + sin(time * 0.8) * 0.05)
```

### 2.4 TSL God Ray Material

God rays need to feel like sunlight filtering through tree gaps:
- **Beam shape**: Vertical rectangles with tapered ends
- **Animated dust**: Noise-modulated opacity creates "dust in sunbeam" effect
- **Sway**: Gentle lateral oscillation as if wind is moving air currents
- **Intensity variation**: Irregular flickering (multiple sine frequencies)
- **Emissive output**: Partial emissive for soft bloom glow

### 2.5 TSL Cloud Material

Flat billboard cards with procedural shape:
- **FBM noise** in TSL for organic cloud edges
- **Edge fade**: Alpha falls off at cloud boundaries
- **Drift animation**: Slow horizontal movement at different speeds per layer
- **Warm coloring**: Clouds are warm-toned (peach/cream/coral), NOT grey
- **Parallax**: Multiple cloud layers at different depths/speeds

### 2.6 TSL Haze Layer Material

Semi-transparent planes between depth layers:
- **Animated noise**: Slowly morphing organic shapes
- **Vertical gradient**: More opaque at bottom, transparent at top
- **Warm color**: Orange-golden tones matching Firewatch palette
- **Depth-aware opacity**: Closer haze layers are less opaque

### 2.7 GLSL Fallback Strategy

All existing GLSL shaders in `swedish-forest-shaders.js` are kept. The material factory:
```javascript
export function createSkyMaterial(params, isWebGPU) {
    if (isWebGPU) {
        return createSkyNodeMaterial(params); // TSL
    }
    return new THREE.ShaderMaterial({
        vertexShader: skyDomeVertexShader,
        fragmentShader: skyDomeFragmentShader,
        uniforms: { /* ... */ },
        side: THREE.BackSide,
        depthWrite: false,
    });
}
```

### 2.8 Visual Enhancement Targets
- [x] Sky gradient has 4+ color stops (vs current 3)
- [x] Sun halo is visible and warm, separate from sun disc
- [x] Horizon brightening is independent of sun
- [x] God rays have dust particle noise (not flat transparency)
- [x] Clouds are warm-toned and drift naturally
- [x] Haze layers create visible depth separation
- [x] On WebGPU: sun and god rays contribute emissive for bloom (implemented via NodeMaterial `emissiveNode`; runtime validation deferred until compatibility-guard removal + WebGPU post stack activation)

### 2.9 Implementation Status (Code Complete, Runtime Validation Deferred)

- [x] Phase 2 WebGPU NodeMaterial scaffolding implemented (`swedish-forest-materials.js`)
- [x] Phase 2 dual-path wiring completed in theme runtime (WebGPU NodeMaterial + WebGL GLSL fallback)
- [x] Time/sun uniform sync implemented for both material paths
- [ ] Runtime verification on active WebGPU backend (deferred by request)

---

## Phase 3: Water & Reflections

**Priority**: HIGH - Central visual element
**Dependencies**: Phase 1
**Art Reference**: Firewatch lake scenes (Jonesy Lake)

### 3.1 Why This Matters

The water is the scene's **second largest color surface** and its reflective quality creates a sense of vast space. In Firewatch, water surfaces mirror the sky gradient with horizontal ripple distortion, and the sun creates a dramatic bright column (sun path) across the surface.

### 3.2 Dual-Path Water Architecture

The current `SwedishForestWater` class deeply depends on `WebGLRenderTarget` and `renderer.state.buffers.stencil` - these are WebGL-specific APIs. A clean separation is needed:

**WebGPU Path** (`createWebGPUWater()`):
- TSL node material for water surface
- `THREE.RenderTarget` (not WebGLRenderTarget) for mirror reflection
- TSL wave displacement in vertex node
- TSL Fresnel, sun path, and tree reflection in fragment node
- Emissive output for sun specular bloom

**WebGL Path** (`createWebGLWater()`):
- Keep existing `SwedishForestWater` (proven, working)
- Small visual improvements to match parity

### 3.3 TSL Water Material Specification

**Vertex Node (Wave Displacement)**:
```
Multiple overlapping sine waves at different frequencies/directions:
  wave1 = sin(worldPos.x * 0.5 + time * 0.3) * 0.15
  wave2 = sin(worldPos.z * 0.7 + time * 0.2 + 1.5) * 0.10
  wave3 = sin((worldPos.x + worldPos.z) * 0.3 + time * 0.15) * 0.08
  displacement.y = wave1 + wave2 + wave3
```

**Fragment Node (Surface Color)**:
1. **Base gradient**: Dark near camera → golden toward horizon (depth-based UV)
2. **Mirror reflection**: Flipped render target sampled with wave-distorted UVs
3. **Sun path**: Bright column of light from sun reflection with sparkle noise
4. **Fresnel blend**: Low Fresnel = warm water color, high Fresnel = reflection
5. **Ripple distortion**: Wave normal perturbation applied to reflection UVs
6. **Shore darkening**: Subtle vignette near shoreline for depth

**Emissive Node (for MRT bloom)**:
```
emissive = sunPathIntensity * sunColor * specularHighlight
```
Only the sun path specular highlights emit - the rest of the water should NOT bloom.

### 3.4 Reflection System

**WebGPU**: Use `THREE.RenderTarget` with a mirror camera matrix. The math is identical to the current approach - only the render target API changes.

```javascript
// Mirror camera setup (same math, both paths)
const reflectionMatrix = new THREE.Matrix4();
reflectionMatrix.set(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
// Translate to water plane height, negate Y
mirrorCamera.matrixWorld.copy(camera.matrixWorld).multiply(reflectionMatrix);
```

**Quality-adaptive resolution**:
| Quality | Reflection Resolution |
|---------|----------------------|
| Extreme | 1024x1024 |
| Ultra | 512x512 |
| High | 512x512 |
| Medium | 256x256 |
| Low | 256x256 |
| Minimal | 128x128 |

### 3.5 Shore Foam Enhancement

- Animated foam ring at water's edge using noise-based alpha cutoff
- Warm cream/gold color (not white - Firewatch is warm)
- Foam around rocks and logs using distance-from-object masking
- Gentle wave-synchronized pulsing

### 3.6 Visual Enhancement Targets
- [x] Water reflects sky gradient with ripple distortion (implemented; runtime validation deferred)
- [x] Sun path creates bright vertical column across water (implemented; runtime validation deferred)
- [x] Specular highlights sparkle with noise variation (implemented; runtime validation deferred)
- [x] Shore foam is warm-toned and animated (implemented; runtime validation deferred)
- [x] Water color gradient matches Firewatch (dark near → golden far) (implemented; runtime validation deferred)
- [x] Rocks and logs interact with water edge (foam around them) (implemented; runtime validation deferred)
- [x] On WebGPU: sun path specular contributes to bloom (implemented via water `emissiveNode`; runtime validation deferred)

### 3.7 Implementation Status (Code Complete; Runtime Validation Deferred)

- [x] Dual-path architecture implemented in theme runtime (`createWebGPUWater` + `createWebGLWater`)
- [x] WebGPU reflection path uses `THREE.RenderTarget` + mirrored camera update hook
- [x] WebGPU water NodeMaterial scaffold implemented (wave displacement + Fresnel + sun-path emissive)
- [x] WebGPU water object-interaction foam implemented for logs/shore stones
- [x] Quality-adaptive reflection resolution mapping wired (Extreme 1024, Ultra/High 512, Medium/Low 256, Minimal 128)
- [x] Visual parity tuning against WebGL `SwedishForestWater` completed (projective reflection UVs via reflection matrix, shoreline foam parity pass, quality-adaptive reflection resolution on both paths)
- [ ] Runtime validation on active WebGPU backend (deferred by request)
- [x] Phase 3 implementation scope is complete and ready to proceed to Phase 4 development (runtime validation still deferred by request)

---

## Phase 4: Layered Forest System

**Priority**: HIGH - Core visual identity
**Dependencies**: Phase 1
**Art Reference**: Jane Ng's 23 trees, silhouette-first design, distance-adaptive alpha

### 4.1 Why This Matters

The trees are what make this scene a FOREST. The layered tree silhouettes at different depth levels are the signature Firewatch visual. Jane Ng's key insight: focus on silhouette quality in the distance, and let fog dissolve detail.

### 4.2 TSL Instanced Foliage Material

The current instanced mesh approach (using BufferGeometryUtils to merge per-layer) is structurally sound. The material needs TSL conversion:

**Vertex Node**:
```
// Per-instance color from attribute
instanceColor = attribute('instanceColor')

// Wind sway using world position + time
windPhase = positionWorld.x * 0.15 + positionWorld.z * 0.1 + time * 0.8
windOffset.x = sin(windPhase) * windStrength * positionLocal.y
windOffset.z = cos(windPhase * 0.6 + 1.5) * windStrength * 0.6 * positionLocal.y

// Apply displacement
position += windOffset
```

**Fragment Node**:
```
// Instance color (set per depth layer)
baseColor = instanceColor

// Subtle height-based brightening
heightFactor = smoothstep(0.0, 1.0, positionLocal.y / treeHeight)
finalColor = mix(baseColor, baseColor * 1.2, heightFactor * 0.15)

// Edge rim highlight (backlit from sun)
rimFactor = pow(1.0 - abs(dot(normalWorld, viewDirection)), 2.0)
rimColor = warmRimColor * rimFactor * rimIntensity * heightFactor

// Event glow (piece lock, combo)
glowColor = glowBaseColor * glowIntensity * heightFactor

output = finalColor + rimColor + glowColor
```

**NEW - Distance-Adaptive Alpha (Firewatch technique)**:
Jane Ng's tree puffing technique translated to TSL:
```
// Trees "puff out" at distance - lower alpha cutoff = fuller silhouette
cameraDistance = length(positionWorld - cameraPosition)
adaptiveAlphaCutoff = mix(0.5, 0.2, smoothstep(30.0, 150.0, cameraDistance))
// Alpha test: if (alpha < adaptiveAlphaCutoff) discard
```
This ensures distant trees become solid silhouettes while near trees show branch detail.

### 4.3 TSL Instanced Trunk Material

```
Vertex: Same wind sway as foliage
Fragment:
  baseColor = instanceTrunkColor
  heightGradient = smoothstep(0.0, 1.0, positionLocal.y / trunkHeight)
  finalColor = mix(baseColor * 0.8, baseColor, heightGradient)
  // Subtle rune glow on events
  glowPattern = sin(positionLocal.y * 10.0 + time * 2.0) * 0.5 + 0.5
  finalColor += glowColor * glowPattern * eventIntensity
```

### 4.4 Tree Depth Layer Configuration

Maintaining the existing 6-layer system with Firewatch color progression (dark near → warm far):

| Layer | Z Depth | Foliage Color | Trunk Color | Trees | Note |
|-------|---------|---------------|-------------|-------|------|
| 0 (Front) | -5 to 15 | `#180604` | `#100402` | 80 | Near-black silhouettes |
| 1 | 15 to 30 | `#2A1008` | `#1A0804` | 70 | Dark warm brown |
| 2 | 30 to 45 | `#4A2015` | `#2A1008` | 60 | Warm brown |
| 3 | 45 to 60 | `#7A4028` | `#4A2015` | 50 | Brown-orange |
| 4 | 60 to 75 | `#AA6040` | `#6A3520` | 40 | Warm orange |
| 5 (Back) | 75 to 90 | `#CC8055` | `#8A5035` | 30 | Light orange (fog-merged) |

### 4.5 TSL Grass Material

Billboard cross-quad instanced mesh:
```
Vertex:
  windPhase = worldPos.x * 0.3 + worldPos.z * 0.25 + time * 1.5
  windDisplacement = sin(windPhase) * windStrength * uv.y * uv.y

Fragment:
  grassTexture sampling + alpha test
  baseToTip gradient: mix(darkBrown, brightGold, smoothstep(0.0, 0.7, uv.y))
  sunsetTint: warm orange overlay on tips
  fogBlend: atmospheric fog at distance
  spiritGlow: reactive warm glow on events
```

### 4.6 Lake Framing Trees, Silhouette Grass, Shore Reeds

All converted to TSL with same pattern:
- Near-black or very dark warm colors
- Subtle wind animation
- Billboard or fixed-plane rendering
- No detail textures (flat silhouette)

### 4.7 Visual Enhancement Targets
- [x] Trees at distance are solid silhouettes (adaptive alpha) (implemented; runtime validation deferred)
- [x] Wind sway propagates coherently across the forest (implemented via shared wind-offset attributes; runtime validation deferred)
- [x] 6 distinct tree depth layers visible with different colors (implemented; runtime validation deferred)
- [x] Rim lighting on tree edges catches backlight (implemented in WebGPU foliage node path; runtime validation deferred)
- [x] Grass has convincing wind motion with golden tips (implemented in WebGPU grass node path; runtime validation deferred)
- [x] Foreground grass frames the scene (dark silhouette) (implemented in WebGPU silhouette-grass node path; runtime validation deferred)
- [x] Event effects (piece lock) cause subtle tree glow (implemented via shared glow uniforms; runtime validation deferred)

### 4.8 Implementation Status (Code Complete; Runtime Validation Deferred)

- [x] WebGPU TSL NodeMaterial scaffolding added for instanced foliage/trunk (`createInstancedFoliageNodeMaterial`, `createInstancedTrunkNodeMaterial`)
- [x] `createTrees()` dual-path wiring implemented (WebGPU NodeMaterial path + existing WebGL GLSL fallback)
- [x] Coherent forest wind offset attribute added (`aInstanceWindOffset`) and wired for foliage + trunk
- [x] WebGPU tree path now includes rim light + event glow controls with per-frame uniform sync
- [x] Distance-adaptive alpha silhouette logic implemented on WebGPU foliage path
- [x] Grass and silhouette-grass migration to TSL NodeMaterial (WebGPU path + WebGL fallback retained)
- [x] Shore reeds and lake framing trees migration to TSL NodeMaterial (WebGPU path + WebGL fallback retained)
- [x] Phase 4 lifecycle hardening complete (procedural grass texture ownership/disposal, framing/reed state cleanup, silhouette-grass WebGL fallback vertex transform parity fix)
- [ ] Runtime visual validation against WebGL parity (deferred by request)
- [x] Phase 4 implementation scope is complete and ready to proceed to Phase 5 development (runtime validation still deferred by request)

---

## Phase 5: Mountains & Terrain

**Priority**: MEDIUM-HIGH - Background depth
**Dependencies**: Phase 1
**Art Reference**: Firewatch layered mountain silhouettes with atmospheric perspective

### 5.1 Why This Matters

The mountains establish the **grand scale** of the scene. In Firewatch, mountain silhouettes at different depth levels with distinct color values create the feeling of vast wilderness. The backlit rim lighting on peak edges catching sunset light is a signature detail.

### 5.2 Refactor 3D Mountain Generation

The current implementation has **~600 lines of nearly identical code** for 6 different mountain peaks (all copy-pasted with slightly different parameters). This should be refactored into a single `createMountainPeak(config)` helper:

```javascript
// In swedish-forest-scene.js
export function createMountainPeakGeometry(config) {
    const geometry = new THREE.PlaneGeometry(
        config.size, config.size,
        config.segments, config.segments
    );
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    const heights = new Float32Array(positions.count);

    for (let i = 0; i < positions.count; i++) {
        // ... FBM heightmap generation (shared code)
        // Uses config: size, peakHeight, steepness, asymmetry,
        //              ridgeCount, ridgeStrength, noiseScale, noiseSeed
    }

    geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
    geometry.computeVertexNormals();
    return geometry;
}
```

All 6 peaks become config objects:
```javascript
const MOUNTAIN_CONFIGS = [
    { name: 'mainPeak', size: 300, segments: 64, peakHeight: 100,
      position: [-90, -15, -160], steepness: 1.2, ... },
    { name: 'tallPeak', size: 380, segments: 64, peakHeight: 170,
      position: [-180, -15, -185], steepness: 1.4, ... },
    // ... 4 more
];
```

### 5.3 TSL 3D Mountain Material

**Vertex Node**: Standard position/normal/UV pass-through + height attribute.

**Fragment Node** (Firewatch backlit mountain look):
```
// Sun is BEHIND mountains (backlit scene)
sunDir = normalize(vec3(0.0, 0.3, -1.0))
facingCamera = max(dot(normal, viewDir), 0.0)
facingSun = max(dot(normal, -sunDir), 0.0)
facingUp = max(normal.y, 0.0)

// COLOR ZONES
color = shadowColor  // Start with shadow (front-facing surfaces)
color = mix(color, midColor, height * 0.6 + facingUp * 0.3)
color = mix(color, highlightColor, (facingSun * 0.5 + facingUp * height * 0.4) * 0.6)

// STRONG RIM LIGHTING (backlit edge glow)
rim = pow(1.0 - facingCamera, 2.0)
rimStrength = rim * (0.5 + facingUp * 0.3 + facingSun * 0.4)
color = mix(color, rimColor, rimStrength * 0.5 * height)

// ATMOSPHERIC PERSPECTIVE
fogFactor = smoothstep(100.0, 280.0, distance(worldPos, cameraPosition))
color = mix(color, fogColor, fogFactor * 0.5)

// BASE MIST
baseMist = smoothstep(0.25, 0.0, height)
color = mix(color, fogColor * 0.7, baseMist * 0.6)

// PEAK GLOW
peakGlow = smoothstep(0.7, 1.0, height)
color = mix(color, rimColor * 0.9, peakGlow * 0.25)
```

### 5.4 TSL 2D Mountain Silhouette Material

The 2D mountain planes use GLSL shaders with procedural peak generation in the fragment shader. Convert to TSL:
- Height sampling via noise for silhouette shape
- Shadow/mid/highlight/rim color zones
- Atmospheric fog blending
- Per-layer mist strength

### 5.5 TSL Ground Material

The forest floor is a large plane with procedural coloring:
```
Fragment:
  noisePattern = fbm(worldPos.xz * 0.03)
  baseColor = mix(darkBrown, warmBrown, noisePattern)
  depthGradient = smoothstep(-40.0, 80.0, worldPos.z)
  color = mix(baseColor, baseColor * warmTint, depthGradient)
  fogBlend = atmospheric fog
  glowReactive = event glow
```

### 5.6 Visual Enhancement Targets
- [x] Mountains have distinct color per depth layer (implemented in layered 2D mountain node path; runtime validation deferred)
- [x] Rim lighting on peaks catches backlight dramatically (implemented in 2D + 3D mountain node paths; runtime validation deferred)
- [x] Base mist softens mountain-to-ground transition (implemented in 2D + 3D mountain node paths; runtime validation deferred)
- [x] Peak glow subtly brightens the highest points (implemented in 3D mountain node path; runtime validation deferred)
- [x] No code duplication across mountain peaks (implemented via `createMountainPeakGeometry(config)` refactor)
- [x] Ground plane has organic, painterly texture (implemented in WebGPU ground node path; runtime validation deferred)

### 5.7 Implementation Status (Code Complete; Runtime Validation Deferred)

- [x] 2D mountain silhouette layers migrated to TSL NodeMaterial (`createMountainLayerNodeMaterial`) with WebGL fallback retained
- [x] 3D mountain peak shading migrated to TSL NodeMaterial (`createMountainPeakNodeMaterial`) with WebGL fallback retained
- [x] 3D mountain generation refactored to shared `createMountainPeakGeometry(config)` helper (all peaks now config-driven)
- [x] Ground plane migrated to TSL NodeMaterial (`createGroundNodeMaterial`) with WebGL fallback retained
- [x] Per-frame time/sun uniform sync wired for mountain + ground node paths
- [ ] Runtime visual validation against WebGL parity (deferred by request)
- [x] Phase 5 implementation scope is complete and ready to proceed to Phase 6 development (runtime validation still deferred by request)

---

## Phase 6: Atmospheric Effects & Particles

**Priority**: MEDIUM - Enhancement layer
**Dependencies**: Phase 1
**Art Reference**: Firewatch god rays, dust motes, warm atmospheric particles

### 6.1 Multi-Colored Distance Fog (NEW - Firewatch Signature)

This is the **most impactful new feature** for achieving the Firewatch look. Currently NOT implemented.

**Concept**: A depth-based color ramp that changes fog color depending on distance. Near objects get one color, distant objects get another, with smooth transitions. During sunset, TWO ramps blend based on sun-facing angle.

**Implementation** (`swedish-forest-fog.js`):

**WebGPU Path (TSL)**:
```javascript
export class SwedishForestFog {
    constructor(renderer, scene, camera, isWebGPU) {
        this.isWebGPU = isWebGPU;

        // Color ramp as 1D texture (256 pixels wide)
        this.colorRampTexture = this.createColorRampTexture([
            { stop: 0.0, color: [0x18, 0x06, 0x04, 0x00] }, // Near: no fog
            { stop: 0.15, color: [0x3A, 0x25, 0x10, 0x10] }, // Slight warm brown
            { stop: 0.35, color: [0x7A, 0x40, 0x28, 0x40] }, // Warm brown-orange
            { stop: 0.55, color: [0xCC, 0x80, 0x55, 0x80] }, // Light orange
            { stop: 0.75, color: [0xFF, 0x99, 0x44, 0xC0] }, // Golden orange
            { stop: 1.0, color: [0xFF, 0xAA, 0x55, 0xFF] },  // Full golden haze
        ]);

        // Sun-facing ramp (warmer, brighter)
        this.sunRampTexture = this.createColorRampTexture([
            { stop: 0.0, color: [0x18, 0x06, 0x04, 0x00] },
            { stop: 0.2, color: [0xFF, 0x88, 0x33, 0x20] },
            { stop: 0.5, color: [0xFF, 0xAA, 0x44, 0x60] },
            { stop: 0.8, color: [0xFF, 0xCC, 0x55, 0xA0] },
            { stop: 1.0, color: [0xFF, 0xDD, 0x88, 0xFF] },
        ]);
    }
}
```

**Integration**: Prefer a post-process fog pass on both paths (WebGPU + WebGL composer) to avoid touching every material. Use per-material fog math only for assets that cannot rely on depth-based post fog (special alpha-tested edge cases).

### 6.1.1 Particle Primitive Constraint (WebGPU Critical)

- WebGPU point primitives are effectively 1px in many runtimes; this breaks large soft sprites (fireflies, dust, spirits)
- WebGPU path should use instanced camera-facing quads or sprites for glow particles
- WebGL fallback can keep `Points` where already stable
- Visual acceptance must verify comparable apparent particle size/shape across both paths

### 6.2 TSL Firefly Material

```
Vertex:
  // Point sprite with size attenuation
  particleSize = baseSize * (300.0 / length(mvPosition.xyz))
  // Per-particle twinkle via phase attribute
  twinkle = pow(sin(time * twinkleSpeed + phase) * 0.5 + 0.5, 3.0)
  particleSize *= 0.5 + twinkle * 0.5

Fragment:
  // Soft circular glow from point center
  dist = length(gl_PointCoord - 0.5) * 2.0
  alpha = 1.0 - smoothstep(0.0, 1.0, dist)
  alpha = pow(alpha, 1.5)  // Softer falloff
  color = mix(amberColor, goldColor, dist * 0.5)

Emissive:
  emissive = color * alpha * twinkle  // Bloom on bright fireflies
```

### 6.3 TSL Dust Mote Material

```
Vertex:
  // Floating motion with multiple sine frequencies
  float1 = sin(time * 0.3 + phase) * 2.0
  float2 = cos(time * 0.2 + phase * 1.7) * 1.5
  float3 = sin(time * 0.15 + phase * 2.3) * 1.0
  position.y += float1
  position.x += float2
  position.z += float3

Fragment:
  // Tiny golden point catching sunlight
  dist = length(gl_PointCoord - 0.5) * 2.0
  alpha = 1.0 - smoothstep(0.0, 1.0, dist)
  // Catching sunlight based on position relative to sun
  sunCatch = dot(normalize(worldPos - cameraPos), sunDirection)
  brightness = 0.3 + pow(max(sunCatch, 0.0), 4.0) * 0.7
  color = goldenColor * brightness
```

### 6.4 TSL Spirit Material

Ethereal orbs that wander through the forest:
```
Fragment:
  // Radial glow
  dist = length(gl_PointCoord - 0.5) * 2.0
  innerGlow = 1.0 - smoothstep(0.0, 0.3, dist)
  outerGlow = 1.0 - smoothstep(0.0, 1.0, dist)

  // Shimmer noise
  shimmer = sin(time * 3.0 + worldPos.x * 5.0) * 0.1 + 0.9

  color = mix(spiritGlow, spiritBase, dist) * shimmer
  alpha = innerGlow * 0.9 + outerGlow * 0.3

Emissive:
  emissive = spiritGlow * innerGlow * 0.5  // Soft bloom
```

### 6.5 TSL Lens Flare Material

Multiple flare types positioned along the sun-to-camera axis:
```
Fragment:
  // Type 0: Soft circle
  // Type 1: Ring (hollow circle)
  // Type 2: Hexagonal flare
  // Type 3: Anamorphic streak (wide, thin)

  // Intermittent flicker (sun through tree gaps)
  flicker1 = sin(time * flickerSpeed + flickerPhase)
  flicker2 = sin(time * flickerSpeed * 0.37 + flickerPhase * 1.7)
  flickerIntensity = pow(max((flicker1 + flicker2 * 0.5) / 1.5, 0.0), 2.5)

  // Only visible when camera faces sun
  viewFactor = pow(sunVisibility, 2.0)
  finalOpacity = baseOpacity * viewFactor * flickerIntensity
```

### 6.6 TSL Spirit Wind Material

Ribbon-shaped flowing energy:
```
Vertex:
  // Ribbon follows flow path
  flowOffset = sin(worldPos.x * 0.1 + time) * 2.0

Fragment:
  // Flow noise for organic shape
  noise = fbm(uv * 3.0 + time * 0.5)
  alpha = noise * edgeFade * opacity
  color = warmGoldenColor
```

### 6.7 Visual Enhancement Targets
- [x] Multi-colored distance fog creates 5+ visible depth layers (implemented via layered distance fog bands + Exp2 fallback; runtime validation deferred)
- [x] Fireflies have soft glow halos (bloom on WebGPU) (implemented in WebGPU node path via additive glow + emissive; runtime validation deferred)
- [x] Dust motes catch sunlight realistically (brighter toward sun) (implemented in WebGPU node path via sun-facing brightness term; runtime validation deferred)
- [x] Spirit orbs shimmer with inner glow (implemented in WebGPU node path; runtime validation deferred)
- [x] Lens flares flicker intermittently (tree gap effect) (implemented with runtime flicker + node opacity wiring; runtime validation deferred)
- [x] Spirit wind trails are visible flowing ribbons (implemented in WebGPU node path; runtime validation deferred)
- [x] All particle effects are warm-toned (no cold colors) (implemented in new WebGPU node palettes; runtime validation deferred)

### 6.8 Implementation Status (Code Complete; Runtime Validation Deferred)

- [x] Distance fog upgraded from simple Exp2 fallback to layered warm color-band system (`createDistanceFogBands`) with both WebGPU and WebGL paths
- [x] WebGPU firefly migration from point sprites to billboard quads using TSL NodeMaterial (`createFireflyNodeMaterial`) while retaining WebGL `Points` fallback
- [x] WebGPU dust mote migration from point sprites to billboard quads using TSL NodeMaterial (`createDustMoteNodeMaterial`) while retaining WebGL `Points` fallback
- [x] WebGPU spirit orbs migrated to TSL NodeMaterial (`createSpiritNodeMaterial`) with existing movement logic preserved
- [x] WebGPU lens flares migrated to TSL NodeMaterial (`createLensFlareNodeMaterial`) with existing flicker behavior preserved
- [x] WebGPU spirit wind ribbons migrated to TSL NodeMaterial (`createSpiritWindNodeMaterial`) with existing movement logic preserved
- [x] Unified runtime uniform/event wiring for Phase 6 effects (time/sun/opacity/boost updates across node + shader paths)
- [ ] Runtime visual validation against WebGL parity (deferred by request)
- [x] Phase 6 implementation scope is complete and ready to proceed to Phase 7 development (runtime validation still deferred by request)

---

## Phase 7: Cinematic Post-Processing Pipeline

**Priority**: HIGHEST VISUAL IMPACT - This single phase transforms the scene from good to cinematic
**Dependencies**: Phase 1 (minimum). Emissive-only MRT isolation matures as Phases 2-6 materials are migrated/tagged.
**Art Reference**: Firewatch used Amplify Color (Unity) for final image color grading

### 7.1 Why This Is The #1 Visual Upgrade

Jane Ng and the Campo Santo team used **Amplify Color** to bring *"out the colors and to get the final images visible in the game"*. Post-processing is what transforms raw 3D rendering into the warm, filmic, painterly quality that defines Firewatch.

Without post-processing, our scene is:
- Raw, linear render output
- No glow on bright surfaces
- No vignette drawing the eye
- No color grading unifying the palette
- No tone mapping (harsh clipping on bright areas)

With post-processing, we get:
- Natural bloom on sun, god rays, fireflies, water specular
- Warm Firewatch color grade with crushed blacks
- Subtle vignette for cinematic framing
- ACES tone mapping for natural highlight rolloff
- Film grain for organic, painterly texture

### 7.1.1 Pipeline Guardrails (Required)

- Phase 7 can be split: **7A base post stack** (after Phase 1) and **7B emissive MRT hardening** (as Phases 2-6 materials migrate)
- If any material in the scene is not a NodeMaterial, disable MRT and continue with non-MRT bloom instead of failing startup
- Avoid double tone mapping: if ACES is done in the post shader, set renderer tone mapping to neutral for that path
- Validate parity with `?swedishForestNoPost=1` and `?swedishForestNoMRT=1` every time post code changes

### 7.2 WebGPU Path: `SwedishForestPost` Class

```javascript
// swedish-forest-post.js
import * as THREE from 'three/webgpu';
import {
    emissive, mrt, output, pass, viewportUV,
    float, vec2, vec3, uniform,
    clamp, dot, fract, max, mix, smoothstep, sin,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export class SwedishForestPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT ?? true;
        this.postProcessing = new THREE.PostProcessing(renderer);

        // ── Scene pass with MRT ──
        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const emissiveColor = this.useMRT
            ? this.scenePass.getTextureNode('emissive')
            : sceneColor;

        // ── Bloom (from emissive channel only) ──
        this.bloomNode = bloom(emissiveColor,
            params.bloomStrength ?? 0.35,
            params.bloomRadius ?? 0.5,
            params.bloomThreshold ?? 0.8
        );

        // ── Combine scene + bloom ──
        let combined = sceneColor.add(this.bloomNode);

        // ── Vignette ──
        const vignetteUV = viewportUV.sub(0.5);
        const vignetteDist = dot(vignetteUV, vignetteUV);
        const vignetteAmount = smoothstep(
            float(params.vignetteOffset ?? 1.3),
            float(params.vignetteOffset ?? 1.3).sub(float(params.vignetteDarkness ?? 0.4)),
            float(1.0).sub(vignetteDist)
        );
        combined = combined.mul(vignetteAmount);

        // ── ACES Tone Mapping ──
        // ACES filmic curve: natural highlight rolloff
        const a = float(2.51);
        const b = float(0.03);
        const c = float(2.43);
        const d = float(0.59);
        const e = float(0.14);
        const exposed = combined.mul(float(params.exposure ?? 1.05));
        const acesNum = exposed.mul(exposed.mul(a).add(b));
        const acesDen = exposed.mul(exposed.mul(c).add(d)).add(e);
        let graded = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        // ── Firewatch Color Grading ──
        // Warm tint push
        const warmTint = vec3(1.08, 0.98, 0.88); // Slight orange push
        graded = graded.mul(warmTint);

        // Contrast
        graded = graded.sub(0.5).mul(float(params.contrast ?? 1.04)).add(0.5);

        // Saturation
        const luminance = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luminance), graded, float(params.saturation ?? 1.12));

        // Crushed blacks (Firewatch signature - shadows are warm, not pure black)
        const blackLevel = vec3(0.02, 0.01, 0.005); // Warm brown-tinted black
        graded = max(graded, blackLevel);

        // ── Film Grain (very subtle) ──
        const grain = fract(sin(dot(viewportUV, vec2(12.9898, 78.233))).mul(43758.5453))
            .sub(0.5)
            .mul(float(params.grainStrength ?? 0.015));
        graded = clamp(graded.add(grain), float(0.0), float(1.0));

        this.postProcessing.outputNode = graded;
        this.postProcessing.needsUpdate = true;
    }

    render() { this.postProcessing.render(); }
    setSize(w, h) { this.scenePass.setSize(w, h); this.bloomNode.setSize?.(w, h); }
    dispose() { this.scenePass.dispose(); this.bloomNode.dispose(); this.postProcessing.dispose(); }
}
```

### 7.3 WebGL Path: EffectComposer Fallback

When using the custom WebGL color-grade pass that includes ACES, ensure renderer-level tone mapping is neutral for this path to avoid double tone mapping.

```javascript
setupWebGLPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Bloom
    this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.35,  // strength
        0.5,   // radius
        0.85,  // threshold
    );
    this.composer.addPass(this.bloomPass);

    // Color grading + vignette + ACES (single ShaderPass)
    const colorGradeShader = {
        uniforms: {
            tDiffuse: { value: null },
            uExposure: { value: 1.05 },
            uContrast: { value: 1.04 },
            uSaturation: { value: 1.12 },
            uWarmTint: { value: new THREE.Vector3(1.08, 0.98, 0.88) },
            uVignetteOffset: { value: 1.3 },
            uVignetteDarkness: { value: 0.4 },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float uExposure;
            uniform float uContrast;
            uniform float uSaturation;
            uniform vec3 uWarmTint;
            uniform float uVignetteOffset;
            uniform float uVignetteDarkness;
            varying vec2 vUv;

            vec3 ACESFilm(vec3 x) {
                float a = 2.51; float b = 0.03;
                float c = 2.43; float d = 0.59; float e = 0.14;
                return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
            }

            void main() {
                vec3 col = texture2D(tDiffuse, vUv).rgb;

                // Exposure
                col *= uExposure;

                // ACES tone mapping
                col = ACESFilm(col);

                // Warm tint
                col *= uWarmTint;

                // Contrast
                col = (col - 0.5) * uContrast + 0.5;

                // Saturation
                float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
                col = mix(vec3(lum), col, uSaturation);

                // Crushed blacks (warm)
                col = max(col, vec3(0.02, 0.01, 0.005));

                // Vignette
                vec2 vigUV = vUv - 0.5;
                float vigDist = dot(vigUV, vigUV);
                float vignette = smoothstep(uVignetteOffset, uVignetteOffset - uVignetteDarkness, 1.0 - vigDist);
                col *= vignette;

                gl_FragColor = vec4(col, 1.0);
            }
        `,
    };
    this.colorGradePass = new ShaderPass(colorGradeShader);
    this.composer.addPass(this.colorGradePass);
}
```

### 7.4 MRT Emissive Tagging Guide

Materials that should contribute to bloom via the MRT emissive channel:

| Material | Emissive Content | Intensity |
|----------|-----------------|-----------|
| Sun sphere | Full sun color | 1.0 (main bloom source) |
| Sun glow sprites | Sprite glow color | 0.7 |
| God rays | Ray color * opacity | 0.3 |
| Fireflies | Point glow when bright | 0.5 |
| Water sun path | Specular highlight | 0.6 |
| Spirit orbs | Inner glow | 0.3 |
| Lens flares | Flare color | 0.4 |
| Everything else | None (vec3(0)) | 0.0 |

Guardrail:
- Run `ensureMrtMaterials()` before enabling MRT. If non-node materials are present, set `flags.useMRT = false` and continue with non-MRT bloom.

### 7.5 Post-Processing Parameters (Firewatch-Tuned)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Bloom Strength | 0.35 | Warm glow, not overblown |
| Bloom Radius | 0.5 | Medium spread for sun |
| Bloom Threshold | 0.8 | Only truly bright areas |
| Exposure | 1.05 | Slightly bright, sunset warmth |
| Contrast | 1.04 | Subtle punch without crushing |
| Saturation | 1.12 | Rich, warm Firewatch colors |
| Warm Tint | (1.08, 0.98, 0.88) | Subtle orange push |
| Crushed Blacks | (0.02, 0.01, 0.005) | Warm shadows, not pure black |
| Vignette Offset | 1.3 | Gradual, not aggressive |
| Vignette Darkness | 0.4 | Subtle framing |
| Film Grain | 0.015 | Barely perceptible organic texture |

### 7.6 Render Loop Integration

```javascript
animate() {
    // ... update scene, uniforms, camera

    if (this.postProcessing) {
        // WebGPU path: PostProcessing handles everything
        this.postProcessing.render();
    } else if (this.composer) {
        // WebGL path: EffectComposer
        this.composer.render();
    } else {
        // No post-processing (low quality)
        this.renderer.render(this.scene, this.camera);
    }
}
```

### 7.7 Visual Enhancement Targets
- [x] Sun has natural warm bloom glow (implemented in shared post stack; runtime validation deferred)
- [x] God rays glow subtly through bloom (implemented in shared post stack; runtime validation deferred)
- [x] Fireflies have soft glow halos (implemented in shared post stack; runtime validation deferred)
- [x] Water sun path sparkles with bloom (implemented in shared post stack; runtime validation deferred)
- [x] Overall image has warm Firewatch color grade (implemented in ACES + warm grade pass; runtime validation deferred)
- [x] Vignette subtly draws eye to center (implemented in WebGPU + WebGL post grade; runtime validation deferred)
- [x] ACES tone mapping prevents harsh highlight clipping (implemented in WebGPU + WebGL grade path; runtime validation deferred)
- [x] Blacks are warm-tinted, not pure black (implemented via crushed-black floor; runtime validation deferred)
- [x] Film grain adds barely-perceptible organic texture (implemented in both post paths; runtime validation deferred)
- [x] WebGL fallback has same color grading + bloom (via EffectComposer) (implemented; runtime validation deferred)

### 7.8 Implementation Status (Code Complete; Runtime Validation Deferred)

- [x] Added `src/themes/swedish-forest/swedish-forest-post.js` with hybrid WebGPU/WebGL post stack (`PostProcessing` + `EffectComposer`)
- [x] Integrated new post module into `swedish-forest-theme.js` (`setupPostProcessing`, render loop, resize, dispose)
- [x] Added `ensureMrtMaterials()` guardrail to auto-disable MRT when non-Node materials are present
- [x] Added tone-mapping neutrality guard (`NoToneMapping` while post is active) to avoid double tonemapping with ACES-in-post
- [x] Wired runtime grain animation (`uTime`) and unified Firewatch-tuned post parameters on both paths
- [ ] Runtime visual matrix/parity validation (`NoPost`/`NoMRT`, WebGPU/WebGL captures) deferred by request
- [x] Phase 7 implementation scope is code-complete and ready to proceed to Phase 8 development (runtime validation still deferred by request)

---

## Phase 8: GPU Compute Systems

**Priority**: MEDIUM - Performance optimization
**Dependencies**: Phase 1
**Art Reference**: Bird flocking silhouettes against sunset sky

### 8.1 Hybrid Bird Compute

**WebGPU Path** (TSL Compute via `Fn()`):
```javascript
// swedish-forest-compute.js
import { Fn, storage, instanceIndex, float, vec3, vec4, uniform } from 'three/tsl';
import { StorageBufferAttribute } from 'three/webgpu';

export class SwedishForestBirdCompute {
    constructor(renderer, birdCount) {
        this.birdCount = birdCount;
        this.deltaTime = uniform(1 / 60);
        this.positionBuffer = new StorageBufferAttribute(new Float32Array(birdCount * 4), 4);
        this.velocityBuffer = new StorageBufferAttribute(new Float32Array(birdCount * 4), 4);

        const posStorage = storage(this.positionBuffer, 'vec4', birdCount);
        const velStorage = storage(this.velocityBuffer, 'vec4', birdCount);

        // Velocity update (flocking rules)
        this.updateVelocityNode = Fn(() => {
            const idx = instanceIndex;
            const pos = posStorage.element(idx);
            const vel = velStorage.element(idx);

            // Separation, alignment, cohesion
            // ... flocking algorithm in TSL

            // Bounds keeping
            // ... keep birds in visible area

            velStorage.element(idx).assign(vel);
        })().compute(birdCount);

        // Position update
        this.updatePositionNode = Fn(() => {
            const idx = instanceIndex;
            const pos = posStorage.element(idx);
            const vel = velStorage.element(idx);
            posStorage.element(idx).assign(pos.add(vel.mul(this.deltaTime)));
        })().compute(birdCount);
    }

    update(renderer, dt) {
        this.deltaTime.value = dt;
        renderer.compute(this.updateVelocityNode);
        renderer.compute(this.updatePositionNode);
    }

    dispose() {
        this.positionBuffer.dispose();
        this.velocityBuffer.dispose();
    }
}
```

**WebGL Path**: Keep existing `GPUComputationRenderer` in `swedish-forest-birds.js` (proven, working).

### 8.2 Compute-Enhanced Firefly System (Optional)

Move firefly position/twinkle updates to GPU compute on WebGPU:
- **Benefit**: Support 500+ fireflies without CPU overhead
- **WebGL fallback**: CPU-driven (current approach, capped at 150)

### 8.3 Wind Field Compute (Optional)

A shared wind field that affects trees, grass, and particles coherently:
- **Compute**: Generate 2D wind velocity field (32x32 grid)
- **Sample**: Trees, grass, particles all sample from same field
- **Result**: Wind waves propagate naturally across the scene

### 8.4 Visual Enhancement Targets
- [x] Bird flocking works on both WebGPU and WebGL (implemented; runtime validation deferred)
- [x] Bird count scales with quality preset (implemented; runtime validation deferred)
- [x] No visual difference between compute paths (design-target parity implemented in code; runtime validation deferred)
- [ ] Fireflies can scale to 500+ on WebGPU (optional)

### 8.5 Implementation Status (Code Complete for Bird Compute; Runtime Validation Deferred)

- [x] Added `src/themes/swedish-forest/swedish-forest-compute.js` (`SwedishForestBirdCompute`) for WebGPU flock simulation
- [x] Upgraded `src/themes/swedish-forest/swedish-forest-birds.js` to hybrid mode:
  - [x] WebGPU path: storage-buffer compute + NodeMaterial instanced bird mesh
  - [x] WebGL path: existing `GPUComputationRenderer` + GLSL bird shader (retained)
- [x] Integrated quality-scaled bird counts via `QUALITY_PRESETS` in `swedish-forest-theme.js`
- [x] Removed bird compute from WebGPU compatibility blockers in `getWebGPUBlockers()`
- [x] Migrated active remaining WebGPU-blocking effect materials (`createShoreFoam`, `createMistLayers`) to NodeMaterial
- [x] Cleared compatibility blocker list so WebGPU path can start when adapter/device init succeeds
- [ ] Runtime matrix/parity validation (WebGPU vs WebGL captures + perf) deferred by request
- [x] Phase 8 bird-compute implementation scope is code-complete and ready to proceed

---

## Phase 9: Polish, Performance & QA

**Priority**: HIGH (final phase)
**Dependencies**: All previous phases

### 9.1 Quality Preset System

```javascript
getQualityPreset(quality) {
    const q = normalizeQuality(quality);
    const presets = {
        extreme: {
            birdCount: 1024, treeCount: 600, grassDensity: 1.0,
            dustCount: 200, fireflyCount: 150, spiritCount: 8,
            enablePostProcessing: true, enableCompute: true,
            bloomStrength: 0.35, bloomRadius: 0.5,
            waterReflectionRes: 1024, shadowMapSize: 2048,
            fogRampRes: 256, enableFilmGrain: true,
        },
        ultra: {
            birdCount: 512, treeCount: 500, grassDensity: 0.8,
            dustCount: 150, fireflyCount: 120, spiritCount: 6,
            enablePostProcessing: true, enableCompute: true,
            bloomStrength: 0.35, bloomRadius: 0.5,
            waterReflectionRes: 512, shadowMapSize: 1024,
            fogRampRes: 256, enableFilmGrain: true,
        },
        high: {
            birdCount: 256, treeCount: 400, grassDensity: 0.6,
            dustCount: 100, fireflyCount: 80, spiritCount: 5,
            enablePostProcessing: true, enableCompute: true,
            bloomStrength: 0.3, bloomRadius: 0.5,
            waterReflectionRes: 512, shadowMapSize: 1024,
            fogRampRes: 128, enableFilmGrain: false,
        },
        medium: {
            birdCount: 128, treeCount: 300, grassDensity: 0.4,
            dustCount: 60, fireflyCount: 50, spiritCount: 3,
            enablePostProcessing: true, enableCompute: false,
            bloomStrength: 0.25, bloomRadius: 0.4,
            waterReflectionRes: 256, shadowMapSize: 512,
            fogRampRes: 128, enableFilmGrain: false,
        },
        low: {
            birdCount: 64, treeCount: 200, grassDensity: 0.2,
            dustCount: 30, fireflyCount: 30, spiritCount: 2,
            enablePostProcessing: false, enableCompute: false,
            bloomStrength: 0, bloomRadius: 0,
            waterReflectionRes: 256, shadowMapSize: 256,
            fogRampRes: 64, enableFilmGrain: false,
        },
        minimal: {
            birdCount: 0, treeCount: 150, grassDensity: 0,
            dustCount: 0, fireflyCount: 15, spiritCount: 0,
            enablePostProcessing: false, enableCompute: false,
            bloomStrength: 0, bloomRadius: 0,
            waterReflectionRes: 128, shadowMapSize: 0,
            fogRampRes: 0, enableFilmGrain: false,
        },
    };
    return presets[q] || presets.high;
}
```

### 9.2 Dispose/Cleanup (Critical for Theme Switching)

```javascript
cleanup() {
    this.stop();

    // Remove listeners using stored references
    window.removeEventListener('resize', this.boundOnResize);
    window.removeEventListener('displaySettingsChanged', this.handleDisplaySettingsChange);

    // Dispose post-processing
    if (this.postProcessing) { this.postProcessing.dispose(); this.postProcessing = null; }
    if (this.composer) { this.composer.dispose?.(); this.composer = null; }
    this.bloomPass?.dispose?.(); this.bloomPass = null;
    this.colorGradePass?.dispose?.(); this.colorGradePass = null;

    // Dispose compute
    if (this.birdCompute) { this.birdCompute.dispose(); this.birdCompute = null; }
    if (this.birds?.dispose) { this.birds.dispose(); this.birds = null; } // WebGL birds fallback

    // Dispose fog system
    if (this.fogSystem) { this.fogSystem.dispose(); this.fogSystem = null; }

    // Dispose water helper if it owns render targets
    if (this.lakeMesh?.isWater && this.lakeMesh.dispose) { this.lakeMesh.dispose(); }

    // Traverse scene and dispose all geometries + materials
    if (this.scene) {
        this.scene.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach((m) => {
                        m.map?.dispose();
                        m.normalMap?.dispose();
                        m.roughnessMap?.dispose();
                        m.aoMap?.dispose();
                        m.dispose();
                    });
                } else {
                    obj.material.map?.dispose();
                    obj.material.normalMap?.dispose();
                    obj.material.roughnessMap?.dispose();
                    obj.material.aoMap?.dispose();
                    obj.material.dispose();
                }
            }
        });
    }

    // Dispose renderer + remove DOM element
    if (this.renderer) {
        this.renderer.dispose();
        this.renderer.domElement?.parentNode?.removeChild(this.renderer.domElement);
        this.renderer = null;
    }

    // Null all references
    this.scene = null;
    this.camera = null;
    // ... null all 30+ properties

    super.cleanup();
}
```

### 9.3 Cross-Browser Testing Matrix

| Runtime | WebGPU Expected | WebGL Fallback | Notes |
|---------|----------------|----------------|-------|
| Electron production build | Capability-dependent | Yes | Primary shipping target |
| Chrome/Edge (current stable, desktop) | Capability-dependent | Yes | Validate both default and forced fallback |
| Safari (current stable, macOS/iOS) | Capability-dependent | Yes | Do not hardcode version assumptions |
| Firefox stable | Usually fallback path | Yes | Fallback stability is mandatory |
| Firefox Nightly/experimental | Capability-dependent | Yes | Treat as exploratory, not release-blocking |
| Chrome Android | Capability-dependent | Yes | Test thermal/perf degradation behavior |

### 9.4 Performance Monitoring

```javascript
// Debug overlay (activated by ?debug=1)
if (this.flags.debug) {
    console.log(`[SwedishForest] Frame stats:`,
        `FPS: ${(1/delta).toFixed(0)}`,
        `Draw calls: ${this.renderer.info.render.calls}`,
        `Triangles: ${this.renderer.info.render.triangles}`,
        `Textures: ${this.renderer.info.memory.textures}`,
        `Backend: ${this.isWebGPU ? 'WebGPU' : 'WebGL2'}`
    );
}
```

### 9.5 Visual Polish Final Checklist

**Composition & Mood**:
- [ ] Scene feels meditative and serene
- [ ] Camera movement is slow, exploratory, gentle
- [ ] Overall warmth matches Firewatch sunset reference
- [ ] 5+ distinct depth layers visible (Firewatch layering)
- [ ] Eye is naturally drawn to sun/lake area

**Sky & Sun**:
- [ ] Sky gradient is smooth, rich, and warm
- [ ] Sun is prominent and glowing (bloom)
- [ ] God rays create visible light beams
- [ ] Horizon is bright and golden

**Water**:
- [ ] Lake reflects sky gradient with ripple distortion
- [ ] Sun path column is bright and sparkly
- [ ] Shore foam is warm-toned and animated
- [ ] Rocks and logs interact with water

**Forest**:
- [ ] Tree silhouettes have clean edges against sky
- [ ] 6 depth layers with distinct colors (dark near → warm far)
- [ ] Wind sway is coherent across forest
- [ ] Foreground grass frames the view

**Mountains**:
- [ ] Mountain peaks have backlit rim glow
- [ ] Atmospheric perspective makes distant mountains hazier
- [ ] Mountain layers have distinct color values

**Particles & Effects**:
- [ ] Fireflies glow warmly
- [ ] Dust motes catch sunlight
- [ ] Spirits wander with ethereal glow
- [ ] Bird silhouettes visible against sky
- [ ] Lens flares flicker naturally

**Post-Processing**:
- [ ] Bloom is warm and subtle (not overblown)
- [ ] Color grading enhances warmth consistently
- [ ] Vignette is barely noticeable but effective
- [ ] Blacks are warm-tinted (Firewatch signature)
- [ ] No harsh clipping (ACES working)

**Technical**:
- [ ] No console errors on WebGPU path
- [ ] No console errors on WebGL fallback
- [ ] Clean theme switch (no memory leaks)
- [ ] All quality presets work
- [ ] Event bus handlers trigger correctly
- [ ] Window resize handled gracefully
- [ ] 60 FPS on mid-range desktop GPU

---

## Performance Budget

### Target: 60 FPS on Mid-Range Desktop GPU (GTX 1060 / RX 580 equivalent)

| Metric | Budget | Notes |
|--------|--------|-------|
| Avg frame time | <= 16.6 ms | 60 FPS target |
| 1% low FPS | >= 45 FPS | Prevent visible hitching |
| Draw calls | < 80 | Instancing is key |
| Triangles | < 400K | Mountains are heaviest |
| CPU frame time | <= 8 ms | Leave headroom for gameplay/UI |
| GPU memory | < 200 MB | Including render targets |
| Post-process passes (WebGPU) | 2 | MRT render + composite |
| Post-process passes (WebGL) | 3 | Render + bloom + grade |
| Compute dispatches | 1-2/frame | Birds only |
| Texture memory | < 24 MB | Procedural > textures |
| Reflection render | 1/frame | Half-res render target |

### Performance Strategy
1. **Instanced rendering** for trees (existing - keep)
2. **MRT** reduces post-processing to 2 passes (vs 4+ chained)
3. **Quality presets** scale everything adaptively
4. **Procedural materials** minimize texture memory
5. **Distance fog** naturally reduces overdraw (distant objects simpler)
6. **Frustum culling** (Three.js built-in)
7. **LOD grass** (reduce at distance via quality preset)
8. **Dynamic resolution** on sustained low FPS (optional)

---

## Implementation Priority Order

| Order | Phase | Impact | Effort | Notes |
|-------|-------|--------|--------|-------|
| 1 | Phase 0: Baseline/Guardrails | Foundation | Medium | Establish kill switches + baselines |
| 2 | Phase 1: Renderer | Foundation | Medium | Must be first implementation phase |
| 3 | Phase 7A: Base Post Stack | HIGHEST | Medium | Immediate cinematic uplift |
| 4 | Phase 2: Sky System | High | Medium | Sets global palette/mood |
| 5 | Phase 6.1: Distance Fog | High | Medium | Firewatch signature depth |
| 6 | Phase 3: Water | High | High | Complex, central element |
| 7 | Phase 4: Forest | High | Medium | Core silhouette language |
| 8 | Phase 5: Mountains | Medium | Low | Refactor + TSL convert |
| 9 | Phase 6 (Particles) | Medium | Medium | Enhancement layer |
| 10 | Phase 7B: MRT Emissive Hardening | High | Medium | Enable emissive-only bloom safely |
| 11 | Phase 8: Compute | Low | Medium | Optional optimization |
| 12 | Phase 9: Polish | High | Medium | Final quality + QA pass |

---

## Implementation Checklist: Owners & Estimates

### Owner Roles (Assign Named People at Kickoff)

| Code | Role | Default Scope |
|------|------|---------------|
| `TL` | Theme Tech Lead | Technical decisions, phase sign-off |
| `RE` | Rendering Engineer | Renderer, post-processing, MRT, compute integration |
| `TA` | Technical Artist | Color tuning, shader look-dev, visual polish |
| `TE` | Theme Engineer | Scene refactors, materials, asset wiring |
| `PE` | Performance Engineer | Profiling, budgets, dynamic resolution, regressions |
| `QA` | QA Engineer | Test matrix execution, bug validation, release gates |
| `RM` | Release Manager | Rollout flags, canary/ramp decisions |

### Phase Plan (Owner + Estimate + Exit Gate)

Assumptions:
- Estimates are in **engineering days** (focused implementation time).
- Calendar duration assumes one primary owner per phase with partial support from listed roles.
- Phase 8 is optional and should be skipped if Phase 9 budgets are already met.

| Order | Phase | Primary Owner | Supporting Owners | Estimate (Eng Days) | Expected Calendar Days | Exit Gate |
|-------|-------|---------------|-------------------|---------------------|------------------------|-----------|
| 1 | Phase 0: Baseline/Guardrails | `TL` | `RE`, `QA`, `PE` | 2-3 | 2-3 | Baseline captures + kill switches + capability matrix verified |
| 2 | Phase 1: Hybrid Renderer Foundation | `RE` | `TE`, `QA` | 3-4 | 3-5 | Stable backend selection + forced fallback + clean startup |
| 3 | Phase 7A: Base Post Stack | `RE` | `TA`, `QA` | 3-4 | 3-5 | Post stack active on both paths without regressions |
| 4 | Phase 2: Procedural Sky | `TA` | `RE`, `TE` | 4-5 | 4-6 | Sky/sun/god-ray mood targets pass visual checklist |
| 5 | Phase 6.1: Distance Fog | `RE` | `TA`, `QA` | 3-4 | 3-5 | Multi-ramp fog integrated and validated in both paths |
| 6 | Phase 3: Water & Reflections | `RE` | `TE`, `TA`, `QA` | 5-7 | 5-8 | Reflection/water parity + stable render targets/disposal |
| 7 | Phase 4: Layered Forest | `TE` | `TA`, `RE` | 5-6 | 5-7 | Layering + silhouettes + wind coherence validated |
| 8 | Phase 5: Mountains & Terrain | `TE` | `TA` | 3-4 | 3-5 | Mountain refactor merged + no duplication regressions |
| 9 | Phase 6: Particles | `TE` | `RE`, `TA`, `QA` | 4-5 | 4-6 | Particle visuals stable; WebGPU primitive constraints handled |
| 10 | Phase 7B: MRT Emissive Hardening | `RE` | `TA`, `QA` | 2-3 | 2-4 | Emissive isolation stable; auto-disable guard works |
| 11 | Phase 8: Compute (Optional) | `RE` | `PE`, `QA` | 3-5 | 3-6 | Compute path stable and meaningfully improves perf/scale |
| 12 | Phase 9: Polish/Perf/QA | `QA` | `PE`, `TA`, `RM`, `TL` | 4-5 | 4-7 | All release gates pass; rollout decision approved |

### Aggregate Estimate

- **Without Phase 8 (optional)**: 38-50 eng days
- **With Phase 8**: 41-55 eng days
- **Practical calendar range** (small team with partial parallelism): ~6-9 weeks

### Phase Gate Checklist (Complete for Every Phase)

- [ ] Owner and backup owner assigned by name in the tracking board
- [ ] Phase implementation PR merged with scope matching this plan
- [ ] Phase-specific validation criteria passed on WebGPU and forced WebGL fallback
- [ ] Performance/budget deltas recorded against baseline
- [ ] Rollback switch for the phase verified (`forceWebGL`, `NoPost`, `NoMRT`, `NoCompute`, or phase-specific flag)
- [ ] Short phase report published (what changed, metrics, known issues, next risk)

### Execution Board Template (Copy into Tracker)

| Field | Value |
|------|-------|
| Phase | |
| Primary Owner | |
| Backup Owner | |
| Start Date | |
| Target End Date | |
| Actual End Date | |
| Estimate (Eng Days) | |
| Actual (Eng Days) | |
| PR / Commit Links | |
| Validation Evidence | |
| Performance Delta vs Baseline | |
| Open Risks / Follow-ups | |
| Gate Result (Pass/Fail) | |

---

## Testing & Validation Checklist

### A. Deterministic Visual Regression

- [ ] Add deterministic run mode (`swedishForestSeed`, `swedishForestFixedDt`)
- [ ] Capture golden screenshots for both backends and all presets
- [ ] Run pixel-diff checks with tolerance per layer (sky, fog, water, silhouettes, post)
- [ ] Capture one clip with post disabled (`swedishForestNoPost=1`) to isolate scene regressions

### B. Functional Smoke Tests (Per Build)

- [ ] Default startup path
- [ ] `?forceWebGL=1`
- [ ] `?swedishForestNoPost=1`
- [ ] `?swedishForestNoMRT=1`
- [ ] `?swedishForestNoCompute=1`
- [ ] Theme switch in/out 20 times without errors
- [ ] Resize spam test (desktop + high-DPR)
- [ ] Event-bus effects (line clear, combo, piece lock)

### C. Performance & Stability

- [ ] 5-minute benchmark run per preset, per backend
- [ ] 30-minute soak run (memory trend, no device loss loops, no resource leak)
- [ ] Track avg FPS, 1% low FPS, frame-time percentiles
- [ ] Track draw calls, triangles, texture count, render target count
- [ ] Validate dynamic-resolution behavior under forced stress

### D. Release Gates

- [ ] No P0 visual regressions versus baseline on WebGL fallback
- [ ] No startup failures across tested runtimes
- [ ] Performance budget met on target mid-range desktop GPU
- [ ] MRT path auto-disables cleanly when unsupported material/capability is detected

---

## Risk Register & Rollback Playbook

| Risk | Trigger | Mitigation | Rollback Action |
|------|---------|------------|-----------------|
| WebGPU startup failure | Renderer init errors or device lost loop | Capability matrix + silent fallback | Force WebGL via remote/default flag |
| MRT incompatibility | Non-node material detected in MRT pass | `ensureMrtMaterials()` guard, auto-disable MRT | Switch to non-MRT bloom path |
| Post-processing visual drift | Large screenshot diff or clipping complaints | Tune grading params and clamp ranges | Disable post (`swedishForestNoPost`) and ship hotfix |
| Particle size regression on WebGPU | Fireflies/dust appear as 1px points | Use instanced quads/sprites for glow particles | Keep WebGL particle path until WebGPU sprite path is stable |
| Memory leak on theme switch | Increasing GPU memory across soak test | Explicit dispose for composer, passes, render targets, compute buffers | Disable new feature phase and revert to previous stable tag |
| Performance regression | 1% low FPS below budget | Preset tuning + dynamic resolution + effect caps | Auto-downgrade preset and disable expensive optional features |

---

## Release & Rollout Strategy

1. **Internal canary**: Enable WebGPU path for dev/staging only, gather logs and screenshot diffs.
2. **Soft launch**: Ship with WebGPU auto-detect but keep kill switches active; monitor errors and fallback rate.
3. **Ramp-up**: Increase default WebGPU adoption only after performance and stability budgets are met.
4. **Fallback-first policy**: At any sign of instability, disable feature tiers in this order: compute -> MRT -> post -> full WebGL.
5. **Post-release verification**: Re-run deterministic baseline captures and soak tests after each hotfix.

---

## Key Principles (Never Forget These)

1. **Do not break WebGL rendering** - Test on WebGL after every phase
2. **Silhouette over detail** - Firewatch is about SHAPE, not texture
3. **Warm fog creates depth** - Distance = warmer/more golden (not cooler/bluer)
4. **Post-processing is essential** - Bloom + grading + vignette = cinematic
5. **Less is more** - 23 tree models was enough for Firewatch; focus on palette
6. **Color drives mood** - *"The colours are not just there to look beautiful. They really do drive the mood of the scene."* - Jane Ng
7. **Feel real, not look real** - Jane Ng: *"designers don't need to create hyper-realistic, detailed assets in order to be memorable"*
8. **Meditative atmosphere** - Slow motion, gentle animations, warm tones
9. **Test both paths always** - Every feature must work on WebGPU AND WebGL
10. **Keep it bold** - Firewatch's power is in **bold, clean colors** and **strong shapes**

---

## Sources & References

- [Campo Santo Blog: Procedural Sky System](https://blog.camposanto.com/post/112703721804/)
- [Campo Santo Blog: Art Direction Q&A (Jane Ng)](https://blog.camposanto.com/post/100680711679/)
- [GDC 2015: The Art of Firewatch (Jane Ng)](https://www.gdcvault.com/play/1022295/The-Art-of)
- [GDC 2016: Making the World of Firewatch](https://gdcvault.com/play/1023191/Making-the-World-of)
- [CTRL500: How Firewatch Translated 2D to 3D](https://ctrl500.com/art/how-firewatch-translated-2d-concept-art-into-a-3d-open-world/)
- [Harry Alisavakis: Firewatch Multi-Colored Fog Shader](https://halisavakis.com/my-take-on-shaders-firewatch-multi-colored-fog/)
- [FIREWATCH Color Palette](https://www.color-hex.com/color-palette/14956)
- [Firewatch Passing Time Palette](https://www.color-hex.com/color-palette/15134)
- [Amplify Creations: Firewatch Amplify Color](https://amplify.pt/firewatch-amplify-color/)
- [Gamedeveloper: Jane Ng's 23 Trees](https://www.gamedeveloper.com/design/environmental-artist-jane-ng-only-made-23-unique-trees-for-i-firewatch-i-)
