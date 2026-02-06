# Winter Wonderland Theme - WebGPU Hybrid Upgrade Plan

## Executive Summary

This plan upgrades the Winter Wonderland theme to a hybrid WebGPU/WebGL2 renderer using Three.js's built-in fallback system. The goal is to preserve the current look on WebGL while enabling a WebGPU path that uses TSL (Three Shading Language) node materials, compute shaders for particle systems, and modern post-processing for higher visual fidelity and better performance.

Key outcomes:
- WebGPU first, automatic silent fallback to WebGL2.
- TSL node materials for all custom shaders on the WebGPU path.
- GPU compute shaders for snow particle physics (WebGPU only).
- Enhanced aurora borealis with volumetric rendering and compute-driven animation.
- Emissive-only bloom for moon glow, aurora, and ice effects.
- Performance improvements through compute shaders, batching, and reduced CPU work.

Scope: `src/themes/winter/` only.

---

## Hybrid Approach (Project-Specific Definition)

Use `THREE.WebGPURenderer` from `three/webgpu`, initialize it with `await renderer.init()`, and let Three.js select the best backend. If WebGPU is unsupported, it will transparently fall back to a WebGL2 backend. Feature paths must be gated by the actual backend type.

**Core rule**: WebGPU path uses TSL node materials + `THREE.PostProcessing` + compute shaders. WebGL fallback path keeps existing `ShaderMaterial` + `EffectComposer`.

```js
import * as THREE from 'three/webgpu';

this.renderer = new THREE.WebGPURenderer({
    antialias: this.getAntialiasEnabled(),
    powerPreference: 'high-performance',
    forceWebGL: false, // set true for local fallback testing
});

try {
    await this.renderer.init();
} catch (error) {
    console.error('[WinterTheme] Renderer init failed:', error);
}

this.isWebGPU = this.renderer.backend?.isWebGPUBackend === true;
```

Fallback should be silent (no UI errors). Avoid extra logging around fallback; if strict silence is required, filter the Three.js fallback warning in production builds.

---

## Current State Snapshot (Winter Wonderland)

**Renderer & Post-Processing**
- `THREE.WebGLRenderer`
- `EffectComposer`, `RenderPass`, `UnrealBloomPass`, custom Vignette `ShaderPass`

**Custom Shaders (ShaderMaterial)**

| Shader | Location | Purpose | TSL Target |
|--------|----------|---------|------------|
| `VolumetricAuroraShader` | inline | Multi-layer aurora with FBM noise | `MeshBasicNodeMaterial` + TSL noise nodes |
| `MoonShader` | inline | Moon rim lighting + internal glow | `MeshBasicNodeMaterial` |
| `VignetteShader` | inline | Post-process vignette + cold color grading | TSL post-processing node |
| `SnowShader` | inline | 3D snow particles with wind/turbulence | `PointsNodeMaterial` + compute shader |
| `StreakShader` | inline | Wind streak particles | `PointsNodeMaterial` |
| `VortexShader` | inline | Spiral snow vortex | `PointsNodeMaterial` |
| `IceBurstShader` | inline | Ice particle bursts | `PointsNodeMaterial` |
| `FrozenLightningShader` | inline | Fractal ice lightning | `LineBasicNodeMaterial` |
| `iceWispVertexShader/FragmentShader` | winter-shaders.js | Floating spirit particles | `PointsNodeMaterial` |
| `cometTrail*Shader` | winter-shaders.js | Shooting star trails | `MeshBasicNodeMaterial` |
| `cometHead*Shader` | winter-shaders.js | Shooting star heads | `PointsNodeMaterial` |
| `iceCrystal*Shader` | winter-shaders.js | Ice crystal crash effects | `PointsNodeMaterial` |
| `iceShardDebris*Shader` | winter-shaders.js | Ice shard debris | `PointsNodeMaterial` |
| `frostRingShockwave*Shader` | winter-shaders.js | Frost shockwave rings | `MeshBasicNodeMaterial` |
| `iceMist*Shader` | winter-shaders.js | Ice mist effects | `MeshBasicNodeMaterial` |
| `blizzardWave*Shader` | winter-shaders.js | Blizzard wave particles | `PointsNodeMaterial` |
| `volumetricFog*Shader` | winter-shaders.js | Fog layers | `MeshBasicNodeMaterial` |
| `moonRay*Shader` | winter-shaders.js | Moon god-rays | `MeshBasicNodeMaterial` |
| `frostSnap*Shader` | winter-shaders.js | Frost snap effects | `PointsNodeMaterial` |
| Starfield shader | inline | Twinkling stars | `PointsNodeMaterial` |
| Sky gradient shader | inline | Atmosphere backdrop | `MeshBasicNodeMaterial` |
| Mountain shader | inline | Snow-capped mountains | `MeshBasicNodeMaterial` |

**Quality Presets**
- Extreme: 20,000 snow particles, 4 aurora layers, 40 ice wisps
- Ultra: 15,000 snow particles, 3 aurora layers, 30 ice wisps
- High: 10,000 snow particles, 2 aurora layers, 25 ice wisps
- Medium: 6,000 snow particles, 1 aurora layer, 15 ice wisps
- Low: 3,000 snow particles, 1 aurora layer, 8 ice wisps

**Key Visual Features**
- Multi-layer aurora borealis with FBM noise-based curtain animation
- Glowing moon with atmospheric halo and god-rays
- GPU-accelerated 3D snow particle system with depth parallax
- Wind streaks, vortexes, and hard turbulence ("Storm" logic)
- Ice wisps (floating spirit particles)
- Shooting stars/comets
- Ice crystal crashes with explosion effects
- Blizzard waves (line clear effects)
- Volumetric fog layers
- Detailed snow-capped mountains
- Dynamic camera breathing animation

---

## Compatibility Constraints

- `ShaderMaterial` and `EffectComposer` are WebGL-centric. WebGPU path must use node materials and `THREE.PostProcessing`.
- `renderer.renderAsync()` is deprecated. Use `await renderer.init()` once, then `renderer.render()` or `renderer.setAnimationLoop()`.
- Node materials compile to WGSL (WebGPU) and GLSL (WebGL backend), making them ideal for hybrid use.
- Compute shaders are WebGPU-only; WebGL path must use CPU-side particle physics.
- `gl_PointCoord` becomes `pointUV` in TSL for particle materials.
- Use `three/webgpu` imports consistently across Winter WebGPU modules (`winter-theme.js`, `winter-materials.js`, `winter-post.js`, `winter-compute.js`) to avoid mixed class instances.

---

## Upgrade Strategy

1. **Keep WebGL path intact** as a stable fallback.
2. **Introduce WebGPU path** in parallel (TSL + PostProcessing + Compute).
3. **Convert ShaderMaterials to NodeMaterials** in priority order.
4. **Gate every WebGPU-only feature** on `this.isWebGPU`.
5. **Add compute shaders** for snow physics (WebGPU only).

---

## Phased Implementation Plan

### Phase 0: Audit & Baseline (Priority: CRITICAL)
**Objective**: Inventory all WebGL-only features and establish visual/performance baselines.

**Tasks**:
- [ ] List every ShaderMaterial in `winter-theme.js` and `winter-shaders.js` and map to a TSL replacement.
- [ ] Capture screenshots and FPS for each quality preset (Extreme, Ultra, High, Medium, Low).
- [ ] Add an internal `forceWebGL` toggle for testing fallback behavior.
- [ ] Document current particle counts and effect complexity per preset.

**Audit Checklist**:
- ShaderMaterial inventory in `src/themes/winter/winter-theme.js`:
  - `VolumetricAuroraShader` - FBM noise aurora (TSL: `MeshBasicNodeMaterial` + noise nodes)
  - `MoonShader` - Moon glow (TSL: `MeshBasicNodeMaterial`)
  - `VignetteShader` - Post-process (TSL: post-processing node)
  - `SnowShader` - Snow particles (TSL: `PointsNodeMaterial`)
  - `StreakShader` - Wind streaks (TSL: `PointsNodeMaterial`)
  - `VortexShader` - Vortex particles (TSL: `PointsNodeMaterial`)
  - `IceBurstShader` - Ice bursts (TSL: `PointsNodeMaterial`)
  - `FrozenLightningShader` - Lightning (TSL: `LineBasicNodeMaterial`)
  - Starfield shader - Stars (TSL: `PointsNodeMaterial`)
  - Sky gradient shader - Sky dome (TSL: `MeshBasicNodeMaterial`)
  - Mountain shader - Mountains (TSL: `MeshBasicNodeMaterial`)

- ShaderMaterial inventory in `src/themes/winter/winter-shaders.js`:
  - Ice wisp shaders (TSL: `PointsNodeMaterial`)
  - Comet trail/head shaders (TSL: `MeshBasicNodeMaterial`/`PointsNodeMaterial`)
  - Ice crystal crash shaders (TSL: `PointsNodeMaterial`)
  - Ice shard debris shaders (TSL: `PointsNodeMaterial`)
  - Frost ring shockwave shaders (TSL: `MeshBasicNodeMaterial`)
  - Blizzard wave shaders (TSL: `PointsNodeMaterial`)
  - Volumetric fog shaders (TSL: `MeshBasicNodeMaterial`)
  - Moon ray shaders (TSL: `MeshBasicNodeMaterial`)
  - Frost snap shaders (TSL: `PointsNodeMaterial`)

**Baseline Capture Template**:
- Machine/GPU:
- Browser + version:
- Resolution + pixel ratio:
- Preset (Low/Medium/High/Ultra/Extreme):
- Backend (WebGL2/WebGPU):
- Avg FPS / 1% low:
- Notes (visual issues, errors):
- Screenshot path:
- Enable logging: append `?winterBaseline=1` to the URL (optional: `?forceWebGL=1` for fallback checks).

---

### Phase 1: Hybrid Renderer Bootstrapping (Priority: CRITICAL)
**Objective**: Initialize WebGPU renderer with built-in fallback and set up backend detection.

**Files to modify**:
- `src/themes/winter/winter-theme.js`

**Tasks**:
- [ ] Switch import to `three/webgpu` at the top of the file.
- [ ] Make `createScene()` async and `await renderer.init()`.
- [ ] Make `initRenderer()` async and `await` it inside `createScene()` before any scene setup.
- [ ] Set `this.isWebGPU` using `renderer.backend.isWebGPUBackend`.
- [ ] Keep renderer defaults (tone mapping, color space, pixel ratio) aligned with existing look.
- [ ] Ensure any WebGPU init errors do not break fallback flow.
- [ ] Update `initRenderer()` method:

```js
async initRenderer(container) {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.renderer = new THREE.WebGPURenderer({
        antialias: this.getAntialiasEnabled(),
        powerPreference: 'high-performance',
        forceWebGL: false,
    });

    try {
        await this.renderer.init();
    } catch (error) {
        console.error('[WinterTheme] Renderer init failed:', error);
    }

    this.isWebGPU = this.renderer.backend?.isWebGPUBackend === true;
    // Optional dev-only log for backend verification.
    // console.log(`[WinterTheme] Using ${this.isWebGPU ? 'WebGPU' : 'WebGL2'} backend`);

    this.renderer.setClearColor(0x020408, 1);
    this.renderer.setPixelRatio(this.getEffectivePixelRatio());
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ... rest of setup
}
```

---

### Phase 2: Render Loop & Resize (Priority: HIGH)
**Objective**: Ensure the animation loop works cleanly across WebGPU and fallback.

**Tasks**:
- [ ] Keep the current rAF loop (for `registerAnimation`) but switch to `renderer.render()` after `init()`.
- [ ] Optionally migrate to `renderer.setAnimationLoop()` if removing rAF tracking becomes desirable.
- [ ] Update resize handling to also resize `PostProcessing` passes on the WebGPU path.
- [ ] Ensure `composer` (WebGL) and `postProcessing` (WebGPU) both resize correctly.

---

### Phase 3: WebGPU Post-Processing (Priority: HIGH)
**Objective**: Replace `EffectComposer` with `THREE.PostProcessing` for WebGPU.

**Files to create**:
- `src/themes/winter/winter-post.js`

**Tasks**:
- [ ] Implement emissive-only bloom with MRT (`mrt({ output, emissive })`).
- [ ] Add a node-based vignette with cold blue color grading.
- [ ] Use `WinterPost` only when `this.isWebGPU === true`.
- [ ] Keep existing `EffectComposer` for fallback.
- [ ] Export `createWinterPostProcessing()` factory function.

**Emissive Bloom Strategy**:
- Aurora layers: high emissive (bloom contributor)
- Moon and moon rays: high emissive
- Snow particles: low/no emissive
- Ice wisps: medium emissive
- Starfield: low emissive
- Mountains: no emissive

```js
// winter-post.js example structure (align with Neon District / Shifting Sands)
import * as THREE from 'three/webgpu';
import {
    emissive,
    mrt,
    output,
    pass,
    viewportUV,
    float,
    length,
    mix,
    smoothstep,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export function createWinterPostProcessing(renderer, scene, camera, params = {}) {
    const postProcessing = new THREE.PostProcessing(renderer);
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, emissive }));

    const sceneColor = scenePass.getTextureNode('output');
    const emissivePass = scenePass.getTextureNode('emissive');
    const bloomNode = bloom(
        emissivePass,
        params.bloomStrength ?? 0.25,
        params.bloomRadius ?? 0.5,
        params.bloomThreshold ?? 0.85,
    );

    // Cold vignette + subtle blue grade
    const uv = viewportUV;
    const centered = uv.sub(0.5).mul(2.0);
    const dist = length(centered);
    const vignetteOffset = float(params.vignetteOffset ?? 1.0);
    const vignetteDarkness = float(params.vignetteDarkness ?? 0.6);
    const vignette = smoothstep(vignetteOffset, vignetteOffset.sub(0.5), dist);
    const baseSample = sceneColor.sample(uv);
    const coldTint = vec3(0.05, 0.08, 0.15);
    const gradeStrength = float(params.gradeStrength ?? 0.2);
    const graded = vec4(mix(baseSample.rgb, baseSample.rgb.mul(coldTint), gradeStrength), baseSample.a);
    const vignetteColor = mix(
        graded.mul(float(1.0).sub(vignetteDarkness)),
        graded,
        vignette,
    );

    postProcessing.outputNode = vignetteColor.add(bloomNode);
    postProcessing.needsUpdate = true;

    return { postProcessing, scenePass, bloomNode };
}
```

---

### Phase 3.5: MRT Compatibility Pass (Priority: CRITICAL)
**Objective**: Make MRT emissive output valid for **every** material in the WebGPU scene.

**Why**: WebGPU MRT requires a fragment output for every target in the render pass. Any material without an emissive output will fail pipeline validation.

**Tasks**:
- [ ] Audit materials used in the WebGPU path and confirm each is a NodeMaterial.
- [ ] Add `?winterMrtAudit=1` debug flag that logs materials missing `emissiveNode`.
- [ ] Explicitly set `emissiveNode` on every NodeMaterial:
  - `emissiveNode = vec3(0.0)` for non-bloom materials (mountains, sky)
  - `emissiveNode = colorNode * intensity` for bloom contributors (aurora, moon, ice)
- [ ] Centralize emissive defaults in `winter-materials.js`.
- [ ] If you add a `useMRT` toggle, only call `scenePass.setMRT(...)` when `useMRT === true`.

---

### Phase 4: TSL Material Migration (Priority: CRITICAL)
**Objective**: Convert all custom ShaderMaterials to TSL node materials for WebGPU.

**Files to create**:
- `src/themes/winter/winter-materials.js`

**Conversion order (recommended by visual impact)**:

1. **Aurora Borealis** (most visible, defines the theme atmosphere)
2. **Snow Particle System** (largest surface coverage, performance critical)
3. **Moon + God Rays** (focal point, emissive bloom)
4. **Starfield** (background element)
5. **Ice Wisps** (mid-ground ambient)
6. **Mountains** (background, snow line effect)
7. **Sky Gradient** (backdrop)
8. **Volumetric Fog Layers** (atmosphere depth)
9. **Wind Streaks** (storm effects)
10. **Ice Burst Particles** (game events)
11. **Vortex System** (combo effects)
12. **Shooting Stars/Comets** (ambient events)
13. **Ice Crystal Crashes** (high combo effects)
14. **Blizzard Waves** (line clear effects)
15. **Frost Snap + Shockwave** (piece lock effects)
16. **Frozen Lightning** (tetris effects)

**Tasks**:
- [ ] Create `winter-materials.js` with factory functions for each material type.
- [ ] Add emissive outputs to node materials for MRT bloom isolation.
- [ ] Use `pointUV` for particle materials instead of `gl_PointCoord`.
- [ ] Implement TSL noise functions for aurora (FBM noise).
- [ ] Gate material creation: `this.isWebGPU ? createAuroraNodeMaterial() : createAuroraShaderMaterial()`.

**Example: Aurora Node Material**:
```js
import {
    MeshBasicNodeMaterial,
    uniform, uv, time, sin, cos, smoothstep, mix, vec3, float
} from 'three/tsl';
import { mx_noise_float } from 'three/addons/nodes/materialx/lib/mx_noise.js';

export function createAuroraNodeMaterial(options = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    const uTime = uniform(0);
    const uIntensity = uniform(options.intensity || 1.0);
    const uOpacity = uniform(options.opacity || 0.6);
    const uOffset = uniform(options.offset || 0.0);
    const uColor1 = uniform(new THREE.Color(0x00ff99)); // Emerald
    const uColor2 = uniform(new THREE.Color(0x3366ff)); // Royal Blue
    const uColor3 = uniform(new THREE.Color(0x8800ff)); // Purple

    const vUv = uv();
    const t = uTime.mul(0.15).add(uOffset);

    // FBM-like noise layers
    const n1 = mx_noise_float(vec3(vUv.x.mul(3).add(t), vUv.y.mul(1.5), 0));
    const n2 = mx_noise_float(vec3(vUv.x.mul(6).sub(t.mul(0.5)), vUv.y.mul(5).add(t.mul(0.2)), 0));
    const n3 = mx_noise_float(vec3(vUv.x.mul(12).add(t.mul(0.8)), vUv.y.mul(8), 0));

    const noise = n1.mul(0.5).add(n2.mul(0.3)).add(n3.mul(0.2));

    // Vertical fade
    const vFade = smoothstep(0.0, 0.15, vUv.y).mul(smoothstep(1.0, 0.4, vUv.y));

    // Curtain folds
    const folds = sin(vUv.x.mul(8).add(noise.mul(3)).add(t)).mul(0.5).add(0.5);
    const intensity = folds.pow(2).mul(vFade).mul(float(0.6).add(noise.mul(0.4)));

    // Color gradient
    const hue = vUv.y.add(noise.mul(0.2));
    const color1 = mix(uColor1, uColor2, smoothstep(0.0, 0.5, hue));
    const color = mix(color1, uColor3, smoothstep(0.5, 1.0, hue));

    material.colorNode = color.mul(1.5).mul(uIntensity);
    material.opacityNode = intensity.mul(uOpacity).mul(uIntensity);

    // Emissive for bloom
    material.emissiveNode = color.mul(intensity).mul(uIntensity).mul(0.8);

    material.userData = { uTime, uIntensity, uOpacity, uOffset };

    return material;
}
```

**Example: Snow Particle Node Material**:
```js
import {
    PointsNodeMaterial,
    uniform, attribute, time, sin, cos, pointUV, vec3, float
} from 'three/tsl';

export function createSnowNodeMaterial(texture) {
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    const uTime = uniform(0);
    const uWindForce = uniform(0);
    const uGustIntensity = uniform(0);
    const uFlashIntensity = uniform(0);

    const aDepth = attribute('depth');
    const aPhase = attribute('phase');

    // Color with flash
    const flash = float(1).add(uFlashIntensity.clamp(0, 1));
    material.colorNode = vec3(1).mul(flash);

    // Alpha with depth and twinkle
    const depthAlpha = float(0.2).add(aDepth.mul(0.6)).mul(0.8);
    const twinkle = float(0.85).add(sin(uTime.mul(3).add(aPhase.mul(10))).mul(0.15));

    // Use pointUV instead of gl_PointCoord
    const coord = pointUV.sub(0.5);
    const dist = coord.length();
    const alpha = float(1).sub(smoothstep(0.3, 0.5, dist));

    material.opacityNode = alpha.mul(depthAlpha).mul(twinkle);

    // Low emissive for subtle glow
    material.emissiveNode = vec3(0.1, 0.1, 0.15);

    material.userData = { uTime, uWindForce, uGustIntensity, uFlashIntensity };

    return material;
}
```

---

### Phase 5: Compute Shader Particle Physics (Priority: HIGH, WebGPU-only)
**Objective**: Move snow particle physics to GPU compute shaders for massive performance gains.

**Files to create**:
- `src/themes/winter/winter-compute.js`

**Benefits**:
- 20,000+ particles with no CPU overhead
- Complex physics (wind, turbulence, collision) entirely on GPU
- Enables higher particle counts on capable hardware

**Tasks**:
- [ ] Create compute shader for snow particle position updates.
- [ ] Implement wind force and gust turbulence in compute.
- [ ] Add particle wrapping (respawn at top when falling below bounds).
- [ ] Create storage buffers for positions, velocities, and per-particle attributes.
- [ ] Gate compute usage on `this.isWebGPU`.

**Example: Snow Compute Shader**:
```js
import { compute, storage, uniform, instanceIndex, float, vec3 } from 'three/tsl';

export function createSnowComputeShader(count, bounds) {
    const positionBuffer = storage(new THREE.StorageBufferAttribute(
        new Float32Array(count * 3), 3
    ), 'vec3', count);

    const velocityBuffer = storage(new THREE.StorageBufferAttribute(
        new Float32Array(count * 3), 3
    ), 'vec3', count);

    const uTime = uniform(0);
    const uDelta = uniform(0);
    const uWindForce = uniform(0);
    const uGustIntensity = uniform(0);

    const computeShader = compute(() => {
        const i = instanceIndex;
        const pos = positionBuffer.element(i);
        const vel = velocityBuffer.element(i);

        // Wind and turbulence
        const windX = uWindForce.mul(float(1).add(pos.y.mul(0.001)));
        const turbulence = sin(pos.y.mul(0.05).add(uTime.mul(4)))
            .sign()
            .mul(uGustIntensity)
            .mul(25);

        // Update position
        pos.x.addAssign(windX.add(turbulence).mul(uDelta));
        pos.y.addAssign(vel.y.mul(uDelta));
        pos.z.addAssign(vel.z.mul(uDelta));

        // Wrap bounds
        pos.x.assign(pos.x.mod(bounds.width).sub(bounds.width.mul(0.5)));
        pos.y.assign(
            pos.y.lessThan(-bounds.height.mul(0.5))
                .cond(bounds.height.mul(0.5), pos.y)
        );
        pos.z.assign(pos.z.mod(bounds.depth).sub(bounds.depth.mul(0.5)));

        positionBuffer.element(i).assign(pos);
    }, count);

    return {
        computeShader,
        positionBuffer,
        velocityBuffer,
        uniforms: { uTime, uDelta, uWindForce, uGustIntensity }
    };
}
```

---

### Phase 6: Visual Upgrades (Priority: MEDIUM)
**Objective**: Achieve a more cinematic, "world-class" winter wonderland look.

**WebGPU-first enhancements**:

#### 6.1 Enhanced Aurora Borealis
- [ ] **Volumetric aurora rays**: Add depth to aurora with multiple semi-transparent layers at varying Z depths.
- [ ] **Aurora color cycling**: Implement slow, subtle color palette shifts over time.
- [ ] **Aurora particle sparkles**: Add sparse glitter particles within aurora curtains.
- [ ] **Interaction with game events**: Aurora intensity pulses with combos.

#### 6.2 Improved Snow System
- [ ] **Depth-of-field blur**: Near/far snow particles have subtle blur (WebGPU post).
- [ ] **Snow accumulation shader**: Ground mesh with animated snow buildup.
- [ ] **Larger detailed snowflakes**: Mix of point sprites and small billboard quads for close-up snow.
- [ ] **Ice crystal sparkle**: Random bright flashes on individual snowflakes.

#### 6.3 Moon & Atmosphere
- [ ] **Realistic moon surface**: Subtle crater noise texture on moon sphere.
- [ ] **Animated moon halo**: Pulsing, breathing halo with aurora color tint.
- [ ] **Atmospheric scattering**: Subtle blue-shift on distant elements.
- [ ] **Star twinkle variety**: Different twinkle patterns and colors for stars.

#### 6.4 Ice & Frost Effects
- [ ] **Ice refraction shader**: Transparent ice shards with light refraction.
- [ ] **Frost creep animation**: Screen-edge frost that grows during intense moments.
- [ ] **Ice particle trails**: Persistent trails behind ice wisps.
- [ ] **Crystalline shard geometry**: Replace point sprites with actual crystal meshes for large debris.

#### 6.5 Fog & Atmosphere
- [ ] **Animated fog wisps**: Fog with internal swirling motion.
- [ ] **Height fog gradient**: Thicker fog at ground level, thinning upward.
- [ ] **Color-reactive fog**: Fog tints with aurora colors.
- [ ] **Volumetric light shafts**: Moon rays with proper volumetric scattering.

---

### Phase 7: Performance Optimization (Priority: HIGH)
**Objective**: Improve frame time on both WebGPU and WebGL fallback.

**Tasks**:

#### 7.1 Geometry & Batching
- [ ] **Batch aurora layers**: Single draw call for all aurora geometry.
- [ ] **Instance mountains**: Use InstancedMesh for mountain ranges.
- [ ] **Merge static geometry**: Combine starfield into single optimized Points object.

#### 7.2 Particle System Optimization
- [ ] **GPU compute for snow** (WebGPU only): Move all particle physics to compute shaders.
- [ ] **LOD for particles**: Reduce particle count at distance.
- [ ] **Frustum culling**: Disable particles behind camera.
- [ ] **Adaptive particle count**: Dynamically reduce particles if FPS drops.

#### 7.3 Shader Optimization
- [ ] **Simplify aurora noise**: Use fewer octaves on lower quality presets.
- [ ] **Precompute noise textures**: Bake FBM noise to texture for aurora (reduces ALU).
- [ ] **Reduce uniform updates**: Batch uniform changes, avoid per-particle CPU work.

#### 7.4 Post-Processing Optimization
- [ ] **Half-resolution bloom**: Render bloom at 50% resolution.
- [ ] **Temporal upscaling**: Optional TAA for smoother output at lower render scale.
- [ ] **Conditional post-processing**: Skip expensive passes on Low preset.

**Performance Targets**:
| Preset | Target FPS | Max Particles | Aurora Layers |
|--------|------------|---------------|---------------|
| Extreme | 60+ | 25,000 (compute) | 4 |
| Ultra | 60+ | 18,000 | 3 |
| High | 60+ | 12,000 | 2 |
| Medium | 60+ | 8,000 | 1 |
| Low | 60+ | 4,000 | 1 (simplified) |

---

### Phase 8: Quality Preset Tuning (Priority: MEDIUM)
**Objective**: Ensure each quality preset delivers optimal visuals for its performance budget.

**Tasks**:
- [ ] Define WebGPU-specific quality enhancements per preset.
- [ ] Add new `Extreme+` preset for high-end WebGPU systems.
- [ ] Tune particle counts, aurora complexity, and post-processing per preset.
- [ ] Create preset comparison screenshots and FPS benchmarks.

**Proposed WebGPU Quality Presets**:
```js
const WEBGPU_QUALITY_PRESETS = {
    'Extreme+': {
        snowCount: 30000, // Compute shader handles this easily
        iceBurstCount: 600,
        auroraLayers: 5,
        auroraSegments: 192,
        enableVolumetricAurora: true,
        enableSnowAccumulation: true,
        enableFrostCreep: true,
        bloomStrength: 0.3,
        bloomRadius: 0.6,
    },
    Extreme: {
        snowCount: 22000,
        iceBurstCount: 500,
        auroraLayers: 4,
        auroraSegments: 128,
        enableVolumetricAurora: true,
        enableSnowAccumulation: true,
        bloomStrength: 0.28,
        bloomRadius: 0.55,
    },
    // ... other presets
};
```

---

### Phase 9: Testing & Validation (Priority: HIGH)
**Objective**: Ensure visual parity between WebGPU and WebGL paths, and no regressions.

**Tasks**:
- [ ] Create automated screenshot comparison tests.
- [ ] Test all quality presets on WebGPU and WebGL.
- [ ] Test fallback behavior when WebGPU fails to initialize.
- [ ] Profile memory usage and GPU utilization.
- [ ] Test on multiple browsers (Chrome, Edge, Firefox, Safari).
- [ ] Test on multiple GPU vendors (NVIDIA, AMD, Intel, Apple Silicon).

**Test Matrix** (use latest stable and record exact versions in the baseline template):
| Browser | WebGPU | WebGL Fallback | Notes |
|---------|--------|----------------|-------|
| Chrome (latest stable) | Test | Test | Primary target |
| Edge (latest stable) | Test | Test | Chromium-based |
| Firefox (latest stable) | Test | Test | WebGPU availability may vary; verify fallback |
| Safari (latest stable, macOS/iOS) | Test | Test | WebGPU availability may vary |

---

### Phase 10: Documentation & Cleanup (Priority: LOW)
**Objective**: Document the hybrid system and clean up legacy code paths.

**Tasks**:
- [ ] Add inline documentation for TSL material factory functions.
- [ ] Document compute shader architecture.
- [ ] Create developer guide for adding new effects.
- [ ] Remove dead code from WebGL-only paths (if WebGPU becomes stable default).
- [ ] Update theme README with WebGPU requirements.

---

## Best Practices for Winter Theme Hybrid Implementation

### Renderer & Backend Detection
- Always `await renderer.init()` before rendering; never use `renderAsync()` (deprecated).
- Detect backend via `renderer.backend?.isWebGPUBackend === true` and gate features accordingly.
- Keep fallback silent in UI; log only in dev builds.
- Provide a local `forceWebGL` toggle to validate fallback behavior.

### Materials & Shaders
- Use NodeMaterials (TSL) for WebGPU path; avoid `ShaderMaterial` in WebGPU.
- Keep WebGL ShaderMaterial versions in place until TSL parity is proven.
- Centralize node-graph creation in `winter-materials.js` factory to avoid drift.
- Use `pointUV` for particles (snow/stars/wisps) instead of `gl_PointCoord`.
- Make emissive output explicit for MRT bloom isolation.

### Color Management
- Set `renderer.outputColorSpace = THREE.SRGBColorSpace` for both backends.
- Keep tone mapping and exposure consistent across WebGL and WebGPU to preserve look.
- If you introduce emissive textures, validate sRGB vs linear expectations.

### Post-Processing
- WebGPU: use `THREE.PostProcessing` + MRT bloom nodes.
- WebGL: keep `EffectComposer` with the existing bloom + vignette.
- Ensure resize updates both renderer and post-processing passes.
- Apply cold blue color grading consistently across backends.

### Particle Systems
- WebGPU: prefer compute shaders for physics-heavy particles (snow, ice bursts).
- WebGL: keep CPU-side physics with optimized buffer updates.
- Use storage buffers for compute output, bind to Points geometry.
- Implement adaptive particle counts based on frame rate.

### Performance & Stability
- Batch geometry where possible (merged aurora layers, instanced mountains).
- Minimize per-frame CPU churn; prefer uniform updates over buffer rebuilds.
- Gate WebGPU-only features behind `this.isWebGPU` to keep fallback stable.
- Profile on Low/Extreme presets first to catch perf regressions early.

### Cleanup & Lifecycle
- Dispose post-processing, materials, geometries, and renderer on stop.
- Clear compute shader references and storage buffers.
- Use `renderer.setAnimationLoop(null)` if migrating off rAF later.

---

## File Structure After Upgrade

```
src/themes/winter/
├── winter-theme.js          # Main theme class (hybrid renderer)
├── winter-materials.js      # TSL node material factories (NEW)
├── winter-compute.js        # Compute shaders for particles (NEW)
├── winter-post.js           # WebGPU post-processing (NEW)
├── winter-shaders.js        # WebGL GLSL shaders (existing, kept for fallback)
├── winter-tetrominos.js     # Tetromino configurations (unchanged)
└── winter-theme-icon.png    # Theme icon (unchanged)
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| TSL noise not matching GLSL FBM | Medium | Medium | Use MaterialX noise nodes, tune parameters |
| Compute shader incompatibility | Low | High | Gate behind `isWebGPU`, fallback to CPU |
| MRT emissive validation errors | High | High | Audit all materials, add emissive to all |
| Performance regression on WebGL | Medium | Medium | Profile extensively, keep WebGL path optimized |
| Visual differences between backends | Medium | Low | Accept minor differences, document them |

---

## Success Criteria

- [ ] WebGPU path renders correctly with no console errors.
- [ ] WebGL fallback maintains visual parity with current implementation.
- [ ] 60 FPS on High preset (RTX 3060 equivalent) at 1080p.
- [ ] 60 FPS on Extreme preset (RTX 4070 equivalent) at 1440p.
- [ ] All game events (line clear, combo, etc.) trigger effects correctly.
- [ ] Memory usage stable over extended play sessions.
- [ ] No visual artifacts or flickering on either backend.

---

## Timeline Estimate

| Phase | Estimated Effort | Dependencies |
|-------|------------------|--------------|
| Phase 0: Audit | 1 day | None |
| Phase 1: Renderer Bootstrap | 1 day | Phase 0 |
| Phase 2: Render Loop | 0.5 days | Phase 1 |
| Phase 3: Post-Processing | 1.5 days | Phase 1 |
| Phase 3.5: MRT Compatibility | 1 day | Phase 3 |
| Phase 4: Material Migration | 4-5 days | Phase 1 |
| Phase 5: Compute Shaders | 2-3 days | Phase 4 |
| Phase 6: Visual Upgrades | 3-4 days | Phase 4, 5 |
| Phase 7: Performance | 2 days | Phase 4, 5 |
| Phase 8: Quality Tuning | 1 day | Phase 7 |
| Phase 9: Testing | 2 days | All |
| Phase 10: Documentation | 1 day | All |

**Total: ~20-24 days**

---

## References

- [Three.js WebGPU Examples](https://threejs.org/examples/?q=webgpu)
- [TSL (Three Shading Language) Documentation](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [MaterialX Noise Functions](https://github.com/mrdoob/three.js/tree/dev/examples/jsm/nodes/materialx)
- [Neon District WebGPU Upgrade Plan](./NEON_DISTRICT_WEBGPU_UPGRADE_PLAN.md)
- [Shifting Sands WebGPU Upgrade Plan](./SHIFTING_SANDS_WEBGPU_UPGRADE_PLAN.md)
