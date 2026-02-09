# Swedish Forest Theme - WebGPU Hybrid Upgrade Plan

## Firewatch-Inspired World-Class Environment

> **Goal**: Transform the Swedish Forest theme into a world-class, Firewatch-inspired masterpiece using WebGPU hybrid rendering with TSL (Three Shading Language) materials, while maintaining silent WebGL 2.0 fallback compatibility.

> **Gold Standard Reference**: Black Hole theme (`src/themes/black-hole/`)

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Firewatch Art Direction Reference](#firewatch-art-direction-reference)
3. [Architecture Overview](#architecture-overview)
4. [File Structure](#file-structure)
5. [Phase 1: Hybrid Renderer Foundation](#phase-1-hybrid-renderer-foundation)
6. [Phase 2: TSL Sky & Atmospheric System](#phase-2-tsl-sky--atmospheric-system)
7. [Phase 3: TSL Water System](#phase-3-tsl-water-system)
8. [Phase 4: TSL Forest & Vegetation](#phase-4-tsl-forest--vegetation)
9. [Phase 5: TSL Mountains & Terrain](#phase-5-tsl-mountains--terrain)
10. [Phase 6: TSL Particle Systems & Effects](#phase-6-tsl-particle-systems--effects)
11. [Phase 7: WebGPU Post-Processing Pipeline](#phase-7-webgpu-post-processing-pipeline)
12. [Phase 8: GPU Compute Systems](#phase-8-gpu-compute-systems)
13. [Phase 9: Polish, Performance & QA](#phase-9-polish-performance--qa)
14. [Visual Enhancement Targets](#visual-enhancement-targets)
15. [Performance Budget](#performance-budget)
16. [Testing & Validation Checklist](#testing--validation-checklist)

---

## Current State Analysis

### Existing Implementation
- **Renderer**: `THREE.WebGLRenderer` only (no WebGPU support)
- **Materials**: All GLSL `ShaderMaterial` with raw vertex/fragment shader strings
- **Water**: Custom `SwedishForestWater` class using planar mirror reflection (WebGL only)
- **Birds**: `GPUComputationRenderer`-based flocking (WebGL compute via RTT)
- **Post-Processing**: None (raw render output)
- **Scene Elements**: ~25+ distinct visual systems (sky dome, sun, mountains, trees, water, birds, fireflies, god rays, dust motes, clouds, haze, grass, shore rocks, logs, reeds, lens flares, spirits, spirit winds, aurora, mist, silhouette grass, shore foam, lake framing trees)
- **File Size**: Main theme file is ~4700+ lines (monolithic)
- **Shaders**: ~1560 lines in `swedish-forest-shaders.js` (all GLSL)

### Key Problems to Solve
1. No WebGPU support - missing modern rendering path
2. Monolithic theme file - hard to maintain
3. No post-processing pipeline (no bloom, no tone mapping, no color grading)
4. Water system is WebGL-only (uses `WebGLRenderTarget`, `renderer.state`)
5. All materials are raw GLSL - cannot leverage TSL node graph benefits
6. Birds use `GPUComputationRenderer` (WebGL-only compute simulation)
7. No MRT (Multiple Render Targets) for efficient emissive bloom
8. No quality-adaptive rendering

---

## Firewatch Art Direction Reference

### Signature Visual Language
The game **Firewatch** by Campo Santo (art directed by Olly Moss and Jane Ng) is celebrated for its **painterly, layered landscape aesthetic**. Key characteristics:

#### Color Philosophy
- **Warm-dominant palette**: Deep burnt oranges, rich ambers, dusty golds, muted crimsons
- **Atmospheric depth through color**: Near objects are dark silhouettes (nearly black), distant objects progressively desaturate toward warm haze colors
- **Limited, intentional palette**: Each scene uses 4-6 core colors with smooth gradient transitions
- **Time-of-day drama**: Sunset scenes use dramatic orange-to-crimson sky gradients with golden light flooding the scene

#### Layered Depth System (Critical to Firewatch Look)
- **5-7 distinct depth layers** from foreground to background
- Each layer is a **flat-colored silhouette** with slight gradient variation
- Layers progressively lighten and warm toward the horizon
- **Atmospheric haze** between layers creates depth separation
- Foreground: Nearly black silhouettes
- Midground: Dark warm browns/maroons
- Background: Warm oranges and golden haze
- Sky: Rich gradient from crimson top to golden horizon

#### Tree Treatment
- **Triangular/conical spruce silhouettes** - iconic pointed shapes
- Trees are rendered as **flat color blocks** (no texture detail)
- Variation through height, width, and slight lean angle
- Dense forest layers with overlapping silhouettes
- Canopy edges create dramatic skyline profiles

#### Water
- **Reflective surface** mirroring the sky gradient
- Horizontal ripple distortion breaking up reflections
- Sun path: Bright column of light across water toward sun
- Dark tree silhouette reflections with ripple distortion
- Shore foam with warm cream/gold tones
- Depth gradient: darker near camera, lighter golden toward horizon

#### Mountains
- **Layered silhouettes** with jagged, angular peaks
- Each layer a distinct color value (darker front, lighter back)
- Atmospheric perspective: distant layers fade into warm haze
- Subtle rim lighting on peak edges catching backlight

#### Atmospheric Effects
- **God rays**: Soft volumetric light beams from sun through tree gaps
- **Haze layers**: Semi-transparent warm-toned planes between depth layers
- **Dust motes**: Tiny golden particles catching sunlight
- **Warm fog**: Orange-golden atmospheric scattering near horizon

#### Post-Processing (What Makes It Feel Cinematic)
- **Bloom**: Soft glow around sun and bright surfaces
- **Vignette**: Subtle darkening at screen edges
- **Color grading**: Warm LUT with slightly crushed blacks
- **Film grain**: Very subtle noise for organic texture (optional)
- **ACES tone mapping**: Natural highlight rolloff

---

## Architecture Overview

### Hybrid Renderer Pattern (Following Black Hole Gold Standard)

```
                    ┌─────────────────────────┐
                    │   SwedishForestTheme     │
                    │   (extends BaseTheme)    │
                    └─────────┬───────────────┘
                              │
                    ┌─────────▼───────────────┐
                    │    initRenderer()        │
                    │  Try WebGPURenderer      │
                    │  Check isWebGPUBackend   │
                    │  Fallback WebGLRenderer  │
                    └─────────┬───────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
    ┌─────────▼─────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │  TSL Materials │ │ Post-Process│ │ GPU Compute │
    │  (WebGPU path) │ │  Pipeline   │ │  (Birds)    │
    │                │ │             │ │             │
    │  Falls back to │ │ WebGPU: MRT │ │ WebGPU: TSL │
    │  GLSL Shader   │ │ + PostProc  │ │  Fn() nodes │
    │  Material on   │ │             │ │             │
    │  WebGL         │ │ WebGL:      │ │ WebGL: GPU  │
    │                │ │ EffectComp  │ │ Computation │
    │                │ │ + Bloom     │ │ Renderer    │
    └────────────────┘ └─────────────┘ └─────────────┘
```

### Key Principle: Same Scene, Dual Paths
- The **scene graph** (meshes, geometries, positions) is **identical** for both paths
- Only **materials**, **post-processing**, and **compute** differ between WebGPU and WebGL
- The `this.isWebGPU` flag gates which code path runs
- All WebGPU-specific code is guarded by capability checks

---

## File Structure

### New File Organization
```
src/themes/swedish-forest/
├── swedish-forest-theme.js          # Main theme class (refactored, ~2000 lines)
├── swedish-forest-materials.js      # NEW: TSL node material factories
├── swedish-forest-shaders.js        # KEEP: GLSL shaders (WebGL fallback)
├── swedish-forest-post.js           # NEW: WebGPU PostProcessing class
├── swedish-forest-compute.js        # NEW: GPU compute (birds, particles)
├── swedish-forest-water.js          # REFACTORED: Hybrid water system
├── swedish-forest-birds.js          # REFACTORED: Hybrid bird flocking
├── swedish-forest-tetrominos.js     # KEEP: Tetromino config (unchanged)
├── swedish-forest-scene.js          # NEW: Scene element creation helpers
└── assets/                          # Textures, normal maps
```

### Import Pattern (Dual Imports)
```javascript
// Standard Three.js (WebGL path)
import * as THREE from 'three';

// WebGPU renderer
import * as THREE_WEBGPU from 'three/webgpu';

// TSL (Three Shading Language) for node materials
import {
    uniform, float, vec2, vec3, vec4, color,
    mix, smoothstep, sin, cos, abs, pow, clamp, max, min,
    uv, time, positionWorld, positionLocal, normalWorld,
    texture, Fn, If,
    output, emissive, mrt,
} from 'three/tsl';

// WebGL post-processing (fallback)
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
```

---

## Phase 1: Hybrid Renderer Foundation

**Priority**: CRITICAL - Must be done first
**Estimated Scope**: Main theme file renderer initialization
**Risk Level**: Medium (can break rendering if done wrong)

### Tasks

#### 1.1 Add Dual Import Headers
```javascript
import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
```

#### 1.2 Implement `initRenderer()` Method
Following the Black Hole pattern exactly:

```javascript
async initRenderer(container) {
    let webgpuRenderer = null;

    // Step 1: Try WebGPU (unless forced WebGL via URL param)
    const urlParams = new URLSearchParams(window.location.search);
    const forceWebGL = urlParams.get('forceWebGL') === '1';

    if (!forceWebGL) {
        try {
            webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
                antialias: this.getAntialiasEnabled(),
                powerPreference: 'high-performance',
                alpha: true,
            });
            await webgpuRenderer.init();
        } catch (error) {
            console.warn('[SwedishForest] WebGPU init failed, falling back:', error);
            if (webgpuRenderer) webgpuRenderer.dispose();
            webgpuRenderer = null;
        }
    }

    // Step 2: Verify WebGPU backend
    if (webgpuRenderer && webgpuRenderer.backend?.isWebGPUBackend === true) {
        this.renderer = webgpuRenderer;
        this.isWebGPU = true;
        this.renderer.onDeviceLost = (info) => {
            console.error('[SwedishForest] WebGPU device lost:', info);
        };
        console.log('[SwedishForest] Using WebGPU backend');
    } else {
        // Step 3: Fallback to WebGL 2.0
        if (webgpuRenderer) webgpuRenderer.dispose();
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });
        this.isWebGPU = false;
        console.log('[SwedishForest] Using WebGL2 backend');
    }

    // Common setup
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(this.getEffectivePixelRatio());
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
}
```

#### 1.3 Convert `createScene()` to Async
- Change from synchronous to `async createScene()`
- Call `await this.initRenderer(container)` before scene element creation
- Add `this.isWebGPU = false` default in constructor

#### 1.4 Add Debug URL Parameters
- `?forceWebGL=1` - Force WebGL fallback
- `?noPost=1` - Disable post-processing
- `?noCompute=1` - Disable GPU compute
- `?debug=1` - Show renderer info overlay

#### 1.5 Capability Probing
```javascript
probeCapabilities() {
    if (!this.isWebGPU) {
        this.capabilities = { isWebGPU: false };
        return;
    }
    const device = this.renderer.backend?.device;
    this.capabilities = {
        isWebGPU: true,
        maxColorAttachments: device?.limits?.maxColorAttachments ?? 0,
        supportsTimestampQuery: device?.features?.has('timestamp-query') ?? false,
    };
}
```

### Validation Criteria
- [ ] WebGPU renderer initializes on Chrome 113+
- [ ] Falls back silently to WebGL on Safari/Firefox (no errors)
- [ ] `?forceWebGL=1` forces WebGL path
- [ ] `this.isWebGPU` correctly set
- [ ] Existing scene renders identically on WebGL path
- [ ] No console errors on either path

---

## Phase 2: TSL Sky & Atmospheric System

**Priority**: High
**Estimated Scope**: Sky dome, sun, god rays, clouds, haze
**Dependencies**: Phase 1

### Tasks

#### 2.1 TSL Sky Dome Material (`swedish-forest-materials.js`)
Convert the GLSL sky dome shader to a TSL node material:

```javascript
export function createSkyDomeNodeMaterial(params = {}) {
    const uTopColor = uniform(color(params.topColor));
    const uMidColor = uniform(color(params.midColor));
    const uHorizonColor = uniform(color(params.horizonColor));
    const uSunDirection = uniform(vec3(params.sunDirection));
    const uSunDiscRadius = uniform(float(params.sunDiscRadius));
    const uSunHaloRadius = uniform(float(params.sunHaloRadius));

    // Build TSL node graph for sky gradient + sun disc + halo
    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide,
        depthWrite: false,
    });

    // Sky gradient based on world direction Y component
    const dir = normalWorld.normalize();
    const t = clamp(dir.y.mul(0.5).add(0.5), 0.0, 1.0);
    const sky = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.55, t));
    const skyFinal = mix(sky, uTopColor, smoothstep(0.3, 1.0, t));

    // Sun disc and halo
    const sunDot = max(dir.dot(uSunDirection.normalize()), 0.0);
    const sunDistance = float(1.0).sub(sunDot);
    const sunDisk = float(1.0).sub(smoothstep(0.0, uSunDiscRadius, sunDistance));
    const sunHalo = float(1.0).sub(smoothstep(0.0, uSunHaloRadius, sunDistance));

    material.colorNode = skyFinal
        .add(color(params.sunColor).mul(sunDisk).mul(params.sunDiscIntensity))
        .add(color(params.haloColor).mul(pow(sunHalo, 2.0)).mul(params.sunHaloIntensity));

    return { material, uniforms: { uSunDirection } };
}
```

#### 2.2 TSL Sun Material
- Animated turbulence using TSL noise functions
- Core/corona/edge glow layers in node graph
- Pulse animation via `time` uniform

#### 2.3 TSL God Ray Material
- Volumetric ray beam accumulation in TSL
- Dust particle noise modulation
- Animated sway with time-based offsets

#### 2.4 TSL Cloud Card Material
- FBM noise in TSL for cloud shapes
- Edge fade, drift animation
- Fog integration at distance

#### 2.5 TSL Haze Layer Material
- Animated noise for organic haze movement
- Vertical falloff gradient
- Warm color shift at bottom

#### 2.6 GLSL Fallback
- Keep existing GLSL shaders in `swedish-forest-shaders.js`
- Material factory pattern:
```javascript
createSkyMaterial() {
    if (this.isWebGPU) {
        return createSkyDomeNodeMaterial(params);
    } else {
        return new THREE.ShaderMaterial({
            vertexShader: skyDomeVertexShader,
            fragmentShader: skyDomeFragmentShader,
            uniforms: {...},
        });
    }
}
```

### Visual Enhancement Targets
- **Richer sky gradients**: More color stops in the sunset transition
- **Animated sun corona**: Subtle turbulence creating living sun feel
- **Volumetric god rays**: More natural dust-in-light scattering
- **Layered clouds**: Parallax cloud movement at different speeds
- **Enhanced haze**: More organic, painterly atmospheric layers

---

## Phase 3: TSL Water System

**Priority**: High
**Estimated Scope**: Complete water system rewrite
**Dependencies**: Phase 1

### Tasks

#### 3.1 Hybrid Water Class
The current `SwedishForestWater` is deeply tied to WebGL (uses `WebGLRenderTarget`, `renderer.state.buffers`). Need a dual-path approach:

**WebGPU Path**:
- Use TSL node material for water surface
- Reflection via `reflector()` or render-to-texture with `THREE.RenderTarget`
- TSL-based wave displacement, Fresnel, sun path, tree reflections
- MRT emissive output for specular bloom

**WebGL Path**:
- Keep existing `SwedishForestWater` class (proven, working)
- Minor improvements to match visual parity

```javascript
// In swedish-forest-water.js
export class SwedishForestWaterHybrid {
    constructor(geometry, options, isWebGPU) {
        if (isWebGPU) {
            return this.createWebGPUWater(geometry, options);
        } else {
            return new SwedishForestWater(geometry, options);
        }
    }
}
```

#### 3.2 TSL Water Material Features
- **Animated wave displacement**: Multiple sine wave layers in vertex node
- **Depth-based color gradient**: Near=rich orange, far=golden
- **Sun path reflection**: Bright vertical column with shimmer
- **Tree silhouette reflections**: Procedural tree pattern with ripple distortion
- **Shore foam**: Animated foam near edges and around objects
- **Fresnel effect**: Low Fresnel for uniform warm color
- **Shore vignette**: Darkened edges near shoreline

#### 3.3 Water Reflection System
- WebGPU: Use `THREE.RenderTarget` (not WebGLRenderTarget)
- Mirror camera setup remains same math (just render target API differs)
- Reflection quality tied to quality preset

### Visual Enhancement
- More natural wave motion with overlapping frequencies
- Better sun path sparkle with animated noise
- Smoother shore foam transitions
- Higher-resolution reflection on higher quality presets

---

## Phase 4: TSL Forest & Vegetation

**Priority**: High
**Estimated Scope**: Trees, grass, reeds, silhouette grass
**Dependencies**: Phase 1

### Tasks

#### 4.1 TSL Instanced Foliage Material
Convert tree foliage to TSL node material:
- Per-instance color via instance attributes
- Wind sway in vertex node using `time` + `positionWorld`
- Edge highlighting for depth perception
- Event glow (warm amber on game events)

#### 4.2 TSL Instanced Trunk Material
- Per-instance trunk color
- Height-based shading gradient
- Rune glow effect during game events

#### 4.3 TSL Grass Material
- Billboard cross-plane geometry (existing approach is good)
- Wind animation in TSL vertex node
- Base-to-tip color gradient (dark brown to golden)
- Sunset tint at tips
- Spirit glow reactivity
- Atmospheric fog integration

#### 4.4 TSL Shore Reeds Material
- Gentle sway animation
- Dark silhouette rendering
- Height-based transparency fade

#### 4.5 TSL Silhouette Grass Material
- Dense foreground grass clumps
- Nearly black silhouette color
- Subtle wind animation

#### 4.6 Lake Framing Trees
- Silhouette trees at water edges
- Dark, flat rendering for framing effect

### Visual Enhancement
- **More tree variation**: Slight random lean, height variation per instance
- **Better wind coherence**: Wind waves propagating through forest
- **Grass LOD**: Reduce grass density at distance
- **Firewatch-style flat shading**: Ensure trees remain stylized silhouettes (not photorealistic)

---

## Phase 5: TSL Mountains & Terrain

**Priority**: Medium-High
**Estimated Scope**: 3D mountains, 2D mountain silhouettes, ground plane
**Dependencies**: Phase 1

### Tasks

#### 5.1 TSL Mountain Silhouette Material (2D layers)
Convert the procedural mountain shader:
- Height sampling via TSL noise functions
- Discard fragments outside silhouette
- Normal-based lighting from height map gradients
- Atmospheric perspective fog
- Warm mist at base
- Rim lighting on peak edges

#### 5.2 TSL 3D Mountain Material
Convert the heightmap mountain shader:
- Height-based color zones (shadow → mid → highlight → rim)
- Backlit rim lighting from sun
- Atmospheric fog with distance
- Base mist/haze
- Noise-based surface detail

#### 5.3 TSL Ground Plane Material
- Distorted noise pattern for painterly terrain look
- Depth-based lighting gradient (dark near, warm far)
- Atmospheric fog integration
- Event glow reactivity

### Visual Enhancement
- **More dramatic peaks**: Steeper, more angular silhouettes
- **Better atmospheric layering**: Each mountain layer more distinct
- **Improved rim lighting**: Brighter backlit edges catching sunset
- **Ground texture**: More organic, painterly look with noise warping

---

## Phase 6: TSL Particle Systems & Effects

**Priority**: Medium
**Estimated Scope**: Fireflies, dust, spirits, lens flares, leaves
**Dependencies**: Phase 1

### Tasks

#### 6.1 TSL Firefly Material
- Point sprite rendering in TSL
- Per-particle twinkle animation using `time` + phase attributes
- Warm amber/orange color with slight hue variation
- Size pulsing on game events (piece lock boost)
- Soft glow falloff from point center

#### 6.2 TSL Dust Mote Material
- Floating motion via vertex position offset
- Golden twinkling particles catching sunlight
- Size attenuation with distance

#### 6.3 TSL Forest Spirit Material
- Ethereal orb glow with shimmer noise
- Warm amber/golden color
- Pulse animation
- Billboard facing (lookAt camera)

#### 6.4 TSL Lens Flare Material
- Multiple flare types (circle, ring, hexagon, streak)
- Position along sun-to-camera axis
- Flicker animation (sun peeking through tree gaps)
- View-angle-dependent visibility

#### 6.5 TSL Spirit Wind Material
- Ribbon-shaped flowing energy
- Flow noise animation
- Warm golden color with horizontal movement

#### 6.6 Falling Leaf Material (if re-enabled)
- Spinning, drifting leaf particles
- Warm autumn colors

### Visual Enhancement
- **Better firefly glow**: Softer, larger glow halos
- **More natural dust floating**: Multiple motion frequencies
- **Spirit wind trails**: Longer, more visible energy streams
- **Improved lens flares**: More cinematic, subtle anamorphic streaks

---

## Phase 7: WebGPU Post-Processing Pipeline

**Priority**: HIGH - Major visual upgrade
**Estimated Scope**: New file `swedish-forest-post.js`
**Dependencies**: Phase 1, Phase 2 (for MRT materials)

### Tasks

#### 7.1 Create `SwedishForestPost` Class (WebGPU Path)

```javascript
// swedish-forest-post.js
import { PostProcessing, pass, bloom, mrt, output, emissive } from 'three/webgpu';

export class SwedishForestPost {
    constructor(renderer, scene, camera, params = {}) {
        this.postProcessing = new PostProcessing(renderer);

        // Scene pass with MRT (separate emissive for bloom source)
        this.scenePass = pass(scene, camera);
        this.scenePass.setMRT(mrt({ output, emissive }));

        const sceneColor = this.scenePass.getTextureNode('output');
        const emissiveColor = this.scenePass.getTextureNode('emissive');

        // Bloom from emissive only (sun, god rays, fireflies, specular highlights)
        this.bloomNode = bloom(emissiveColor, params.bloomStrength, params.bloomRadius, params.bloomThreshold);

        // Combine scene + bloom
        let combined = sceneColor.add(this.bloomNode);

        // Vignette (subtle warm darkening at edges)
        // ... TSL vignette node

        // Color grading (Firewatch warm tones, slightly crushed blacks)
        // ... ACES tone mapping in TSL

        // Film grain (very subtle, optional)
        // ... noise-based grain

        this.postProcessing.outputNode = combined;
    }
}
```

#### 7.2 WebGL Fallback Post-Processing (EffectComposer)

```javascript
setupWebGLPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Bloom pass
    this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.4,   // strength (subtle)
        0.6,   // radius
        0.85,  // threshold
    );
    this.composer.addPass(this.bloomPass);

    // Color grading pass (custom GLSL)
    // ... warm tone mapping, vignette, grain
}
```

#### 7.3 MRT Material Tagging
Materials that should contribute to bloom need emissive output:
- Sun material: emissive = bright core
- God ray material: emissive = ray light
- Firefly material: emissive = glow
- Water specular highlights: emissive = sun path sparkle
- Lens flare material: emissive = flare glow

#### 7.4 Post-Processing Parameters (Firewatch-Tuned)

| Parameter | Value | Notes |
|-----------|-------|-------|
| Bloom Strength | 0.35 | Subtle warm glow |
| Bloom Radius | 0.5 | Medium spread |
| Bloom Threshold | 0.8 | Only bright areas |
| Vignette Darkness | 0.4 | Subtle edge darkening |
| Vignette Offset | 1.3 | Gradual falloff |
| Exposure | 1.05 | Slightly bright |
| Contrast | 1.03 | Very slight boost |
| Saturation | 1.1 | Warm, rich colors |
| Warm Tint | 0.15 | Subtle orange push |
| Film Grain | 0.02 | Barely perceptible |

### Visual Impact
This phase provides the **single biggest visual upgrade**:
- Sun and god rays will glow naturally via bloom
- Water specular highlights will shimmer with bloom
- Fireflies will have soft glow halos
- Overall scene gets cinematic color grading
- Vignette draws eye to center (sun/lake)
- ACES tone mapping prevents harsh clipping

---

## Phase 8: GPU Compute Systems

**Priority**: Medium
**Estimated Scope**: Bird flocking, particle systems
**Dependencies**: Phase 1

### Tasks

#### 8.1 Hybrid Bird Compute
The current bird system uses `GPUComputationRenderer` which is WebGL-only (render-to-texture compute). Need dual path:

**WebGPU Path** (TSL Compute):
```javascript
// swedish-forest-compute.js
import { Fn, storage, instanceIndex, float, vec3, uniform } from 'three/tsl';
import { StorageBufferAttribute } from 'three/webgpu';

export class SwedishForestBirdCompute {
    constructor(renderer, birdCount) {
        // Position and velocity storage buffers
        this.positionBuffer = new StorageBufferAttribute(new Float32Array(birdCount * 4), 4);
        this.velocityBuffer = new StorageBufferAttribute(new Float32Array(birdCount * 4), 4);

        // Position update compute node
        this.updatePositionNode = Fn(() => {
            const pos = storage(this.positionBuffer, 'vec4', birdCount);
            const vel = storage(this.velocityBuffer, 'vec4', birdCount);
            // ... flocking logic in TSL
        })().compute(birdCount);
    }
}
```

**WebGL Path**:
- Keep existing `GPUComputationRenderer` approach (proven, working)
- No changes needed

#### 8.2 Compute-Based Firefly Positioning (Optional Enhancement)
- Move firefly position updates to GPU compute
- More fireflies possible without CPU overhead
- Only on WebGPU path; WebGL uses existing CPU-driven positions

#### 8.3 Compute-Based Dust Mote Animation (Optional)
- Similar to fireflies but for dust particles
- GPU-driven floating motion

### Note on Bird System
The bird flocking simulation is already GPU-accelerated via `GPUComputationRenderer`. The WebGPU TSL compute upgrade provides:
- Better integration with WebGPU pipeline (no WebGL render target workaround)
- Potential for more birds on WebGPU-capable hardware
- Cleaner code using TSL `Fn()` instead of GLSL strings

---

## Phase 9: Polish, Performance & QA

**Priority**: High (final phase)
**Estimated Scope**: Cross-browser testing, performance tuning, visual polish
**Dependencies**: All previous phases

### Tasks

#### 9.1 Quality Preset Integration
```javascript
getQualityPreset(quality) {
    const presets = {
        extreme: {
            birdCount: 1024,
            treeCount: 600,
            grassDensity: 1.0,
            dustCount: 200,
            fireflyCount: 150,
            enablePostProcessing: true,
            enableCompute: true,
            bloomStrength: 0.4,
            waterReflectionRes: 1024,
            shadowMapSize: 2048,
        },
        ultra: {
            birdCount: 512,
            treeCount: 500,
            grassDensity: 0.8,
            dustCount: 150,
            fireflyCount: 120,
            enablePostProcessing: true,
            enableCompute: true,
            bloomStrength: 0.35,
            waterReflectionRes: 512,
            shadowMapSize: 1024,
        },
        high: {
            birdCount: 256,
            treeCount: 400,
            grassDensity: 0.6,
            dustCount: 100,
            fireflyCount: 80,
            enablePostProcessing: true,
            enableCompute: true,
            bloomStrength: 0.3,
            waterReflectionRes: 512,
            shadowMapSize: 1024,
        },
        medium: {
            birdCount: 128,
            treeCount: 300,
            grassDensity: 0.4,
            dustCount: 60,
            fireflyCount: 50,
            enablePostProcessing: false,
            enableCompute: false,
            bloomStrength: 0,
            waterReflectionRes: 256,
            shadowMapSize: 512,
        },
        low: {
            birdCount: 64,
            treeCount: 200,
            grassDensity: 0.2,
            dustCount: 30,
            fireflyCount: 30,
            enablePostProcessing: false,
            enableCompute: false,
            bloomStrength: 0,
            waterReflectionRes: 256,
            shadowMapSize: 256,
        },
        minimal: {
            birdCount: 0,
            treeCount: 150,
            grassDensity: 0,
            dustCount: 0,
            fireflyCount: 15,
            enablePostProcessing: false,
            enableCompute: false,
            bloomStrength: 0,
            waterReflectionRes: 128,
            shadowMapSize: 0,
        },
    };
    return presets[normalizeQuality(quality)] || presets.high;
}
```

#### 9.2 Performance Monitoring
- FPS counter (debug mode)
- GPU memory tracking
- Draw call monitoring
- Automatic quality downgrade on sustained low FPS

#### 9.3 Dispose/Cleanup
- Proper disposal of all WebGPU resources
- Storage buffer cleanup
- PostProcessing disposal
- Compute node cleanup
- Texture disposal

#### 9.4 Cross-Browser Testing Matrix

| Browser | WebGPU | WebGL Fallback |
|---------|--------|----------------|
| Chrome 113+ | Primary path | - |
| Chrome <113 | - | Fallback |
| Edge 113+ | Primary path | - |
| Firefox (Nightly) | Primary path | - |
| Firefox (Stable) | - | Fallback |
| Safari 18+ | Primary path | - |
| Safari <18 | - | Fallback |
| Mobile Chrome | Varies | Fallback |
| Mobile Safari | - | Fallback |

#### 9.5 Visual Polish Checklist
- [ ] Sun glow bloom looks natural (not overblown)
- [ ] God rays blend smoothly with scene
- [ ] Water reflections are convincing
- [ ] Tree silhouettes have crisp edges
- [ ] Mountain layering creates proper depth
- [ ] Firefly glow has soft halo
- [ ] Color grading feels warm and cinematic
- [ ] Vignette is subtle (not distracting)
- [ ] Shore foam looks organic
- [ ] Bird silhouettes are visible against sky
- [ ] Dust motes catch sunlight naturally
- [ ] Overall palette matches Firewatch sunset reference
- [ ] No visual artifacts on either rendering path
- [ ] Smooth transitions between quality presets

---

## Visual Enhancement Targets

### Before vs After Summary

| Element | Current (WebGL) | Target (WebGPU Hybrid) |
|---------|----------------|----------------------|
| **Sun** | Shader sphere + sprite glow | Same + bloom glow halo (post-process) |
| **Sky** | GLSL gradient | TSL gradient + better sun halo |
| **God Rays** | GLSL shader plane | TSL + emissive bloom for natural glow |
| **Water** | Custom mirror shader | TSL water + bloom specular highlights |
| **Trees** | GLSL instanced shader | TSL instanced + better wind |
| **Mountains** | GLSL procedural | TSL procedural + better rim light |
| **Fireflies** | GLSL points | TSL points + bloom glow |
| **Birds** | GPUComputationRenderer | TSL compute (WebGPU) / kept (WebGL) |
| **Post-Processing** | None | MRT bloom + vignette + color grading |
| **Tone Mapping** | None | ACES (natural highlight rolloff) |
| **Color Grading** | None | Warm Firewatch tones, crushed blacks |
| **Performance** | Good | Better (fewer passes, GPU compute) |

### Key Visual Wins
1. **Bloom on emissive surfaces** - Sun, god rays, fireflies, water specular all glow naturally
2. **ACES tone mapping** - No more harsh clipping, natural highlight rolloff
3. **Warm color grading** - Deeper Firewatch feel with richer oranges
4. **Vignette** - Draws attention to center composition
5. **Better water specular** - Sun path sparkles with bloom
6. **Film grain** (subtle) - Organic, painterly texture

---

## Performance Budget

### Target Frame Rate: 60 FPS on mid-range desktop GPU

| Metric | Budget |
|--------|--------|
| Draw calls | < 100 (instancing helps) |
| Triangles | < 500K |
| GPU memory | < 256 MB |
| Post-process passes (WebGPU) | 2 (MRT render + composite) |
| Post-process passes (WebGL) | 4 (render + bloom + grade + output) |
| Compute dispatches | 1-2 per frame (birds) |
| Texture memory | < 32 MB |

### Performance Strategy
- **Instanced rendering** for trees (already done - keep)
- **MRT** reduces post-processing passes from 4+ to 2
- **Quality presets** scale complexity with hardware
- **Frustum culling** for off-screen objects
- **LOD** for distant trees and grass
- **Dynamic resolution** on sustained low FPS

---

## Testing & Validation Checklist

### Phase 1 (Renderer)
- [ ] WebGPU initializes on supported browsers
- [ ] WebGL fallback is silent (no console errors)
- [ ] `?forceWebGL=1` works
- [ ] Scene renders on both paths
- [ ] Pixel ratio respected

### Phase 2 (Sky & Atmosphere)
- [ ] Sky gradient matches current look on WebGL
- [ ] TSL sky gradient is visually identical/better on WebGPU
- [ ] Sun disc and halo render correctly
- [ ] God rays animate smoothly
- [ ] Clouds drift at correct speed
- [ ] Haze layers create depth

### Phase 3 (Water)
- [ ] Water reflections work on both paths
- [ ] Wave animation is smooth
- [ ] Sun path reflection visible
- [ ] Shore foam animates
- [ ] No z-fighting at water edges

### Phase 4 (Forest)
- [ ] Trees render with correct depth layering
- [ ] Wind sway animates correctly
- [ ] Grass renders with wind
- [ ] No instancing artifacts
- [ ] Event glow effects work

### Phase 5 (Mountains)
- [ ] Mountain silhouettes render correctly
- [ ] 3D mountains have proper lighting
- [ ] Atmospheric perspective works
- [ ] Rim lighting visible on peak edges

### Phase 6 (Particles)
- [ ] Fireflies glow and twinkle
- [ ] Dust motes float naturally
- [ ] Spirits wander and glow
- [ ] Lens flares flicker appropriately
- [ ] Bird flocking works on both paths

### Phase 7 (Post-Processing)
- [ ] Bloom is subtle and warm (not overblown)
- [ ] Vignette is barely noticeable
- [ ] Color grading enhances warmth
- [ ] ACES tone mapping prevents clipping
- [ ] WebGL fallback (EffectComposer) works
- [ ] No performance regression vs no post-processing

### Phase 8 (Compute)
- [ ] Bird compute works on WebGPU
- [ ] Bird GPUComputationRenderer still works on WebGL
- [ ] No visual difference between paths

### Phase 9 (Polish)
- [ ] All quality presets work
- [ ] No memory leaks (check dispose)
- [ ] Smooth theme start/stop transitions
- [ ] Event bus handlers work (piece lock, combo, line clear)
- [ ] Window resize handled correctly
- [ ] Resolution settings respected

---

## Implementation Priority Order

1. **Phase 1** (Renderer) - Foundation, must be first
2. **Phase 7** (Post-Processing) - Biggest visual bang
3. **Phase 2** (Sky) - High visibility, sets the tone
4. **Phase 3** (Water) - Complex, needs early attention
5. **Phase 4** (Forest) - Core visual element
6. **Phase 5** (Mountains) - Important for depth
7. **Phase 6** (Particles) - Enhancement layer
8. **Phase 8** (Compute) - Optional optimization
9. **Phase 9** (Polish) - Final quality pass

---

## Notes

- **Do not break existing WebGL rendering** at any point during development
- **Test on WebGL after every phase** to ensure fallback works
- **Keep the Firewatch aesthetic** - resist the urge to add photorealistic detail; the style is about **simplicity, color, and atmosphere**
- **The theme should feel meditative** - slow camera movement, gentle animations, warm colors
- **Post-processing is the #1 visual upgrade** - even without TSL materials, adding bloom + color grading to the WebGL path would be transformative
