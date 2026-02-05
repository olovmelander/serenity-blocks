# Shifting Sands Theme - WebGPU Upgrade Plan

## Executive Summary

This document outlines the implementation plan for upgrading the Shifting Sands (Arrakis/Dune-inspired) theme from WebGL to WebGPU using Three.js's built-in hybrid fallback. The renderer will always be `WebGPURenderer` from `three/webgpu`: it attempts WebGPU first and automatically falls back to a WebGL 2.0 backend when WebGPU is unavailable, without any manual renderer swap or user-facing errors. All theme shaders will be migrated to TSL (Three Shading Language) node materials so the same material graph runs on both backends; compute-driven features will run only on the WebGPU backend, with CPU fallbacks on WebGL.

---

## Current State Analysis

### Existing Architecture
- **Renderer**: `THREE.WebGLRenderer` with post-processing via EffectComposer
- **Materials**: Multiple `ShaderMaterial` instances with custom GLSL shaders
- **Post-Processing**: Heat shimmer shader pass
- **Key Files**:
  - `shifting-sands-theme.js` - Main theme logic (~900 lines)
  - `shifting-sands-shaders.js` - All GLSL shaders (~750 lines)
  - `shifting-sands-tetrominos.js` - Tetromino color configuration

**Compatibility Note (WebGPURenderer)**:
- `WebGPURenderer` does **not** run `ShaderMaterial`/GLSL or `EffectComposer`. To satisfy the hybrid fallback requirement, all visual shaders must be ported to TSL node materials and the post chain must move to `PostProcessing` (which works with `WebGPURenderer` on both WebGPU and WebGL2 backends).

### Current Visual Features
| Feature | Implementation | Complexity |
|---------|---------------|------------|
| Procedural Dunes | Perlin noise + ShaderMaterial | High |
| Sandworm Trail | Animated vertex displacement | High |
| Twin Moons | Sprite layers with glow | Medium |
| Spice Particles | Points + sine-based swirl | Medium |
| Sand Smoke | Points + FBM noise | High |
| Stars | Points + twinkle shader | Low |
| Heat Shimmer | Post-process distortion | Medium |
| Dust Haze | Transparent points | Low |

### Current GLSL Shaders (6 shader pairs)
1. **Sky Shader** - Gradient with moon glow
2. **Stars Shader** - Twinkle animation
3. **Dune Shader** - Wind ripples, worm trail, rim lighting, spice sparkle
4. **Spice Particle Shader** - Swirling motion with glow
5. **Sand Smoke Shader** - Volumetric FBM with worm trail following
6. **Heat Shimmer Shader** - Screen-space distortion

### Performance Bottlenecks Identified
1. **Dune shader complexity** - Multiple noise functions per fragment
2. **Sand smoke particles** - FBM noise in both vertex and fragment shaders
3. **Worm trail calculation** - Duplicated in dunes and smoke shaders
4. **Heat shimmer** - Full-screen pass with texture sampling

---

## WebGPU Benefits for Shifting Sands

### Performance Improvements
| Feature | WebGL | WebGPU Expected |
|---------|-------|-----------------|
| Particle updates | CPU-bound | GPU compute shaders |
| Noise calculations | Per-fragment | Pre-computed textures |
| Worm position | Calculated twice | Shared buffer |
| Draw calls | ~8-10 per frame | ~3-4 batched |

### Visual Enhancements Possible with WebGPU
1. **GPU-Driven Sand Simulation** - Compute shader for realistic sand flow
2. **Volumetric God Rays** - Compute-based light shafts from moons
3. **Enhanced Sandworm Wake** - Particle compute for dust plume
4. **Subsurface Scattering Dunes** - Accurate light through sand ridges
5. **Real-time Spice Bloom** - MRT-based emissive glow
6. **Improved Heat Shimmer** - Ray-marched atmospheric distortion

---

## Hybrid Approach Guardrails (Must-Haves)
1. **Single renderer**: Always instantiate `WebGPURenderer` from `three/webgpu`. Do not create a separate `WebGLRenderer`.
2. **TSL everywhere**: Replace all `ShaderMaterial` GLSL shaders with TSL node materials so they can run on both WebGPU and WebGL2 backends.
3. **Backend gating**: Only run compute/MRT-heavy features when `renderer.backend.isWebGPUBackend === true`. Provide CPU fallbacks for WebGL backend.
4. **Silent fallback**: No UI errors or prompts on fallback. Optional debug logs are acceptable in development only.

---

## Implementation Phases

### Phase 1: Renderer Initialization with Fallback (Priority: CRITICAL)

**Objective**: Implement the hybrid WebGPU/WebGL renderer system

**Files to Modify**:
- `src/themes/shifting-sands/shifting-sands-theme.js`

**Implementation**:

```javascript
// Update import at top of file
import * as THREE from 'three/webgpu';

// In createScene() method (already async in this theme):
async createScene() {
    const container = document.getElementById('shifting-sands-theme');
    if (!container) return;
    container.innerHTML = '';

    this.applyQualityPreset(this.getGraphicsQuality());
    this.setupQualityListener();

    // Create WebGPU renderer with automatic WebGL fallback
    this.renderer = new THREE.WebGPURenderer({
        antialias: this.getAntialiasEnabled(),
        powerPreference: 'high-performance',
        // forceWebGL: true, // QA: force WebGL 2 backend to test fallback
    });

    try {
        // WebGPURenderer handles WebGPU -> WebGL2 fallback internally
        await this.renderer.init();
    } catch (error) {
        console.error('[ShiftingSands] Renderer init failed (no fallback available):', error);
        return;
    }

    this.isWebGPU = this.renderer.backend.isWebGPUBackend === true;
    this.isWebGL = this.renderer.backend.isWebGLBackend === true;
    // Optional debug: console.log(`[ShiftingSands] Backend: ${this.isWebGPU ? 'webgpu' : 'webgl2'}`);

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(this.getEffectivePixelRatio());
    this.renderer.setClearColor(this.palette.skyTop);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // Scene setup...
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(this.palette.fog.getHex(), 0.0012);

    // Camera...
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 65, 180);
    this.camera.lookAt(0, 0, 0);

    // Continue with scene creation...
}
```

**Tasks**:
- [ ] Replace `WebGLRenderer` with `WebGPURenderer` from `three/webgpu`
- [ ] Keep `createScene()` async; `await renderer.init()` before any render/compute
- [ ] Track backend via `renderer.backend.isWebGPUBackend` / `renderer.backend.isWebGLBackend`
- [ ] Use `three/webgpu` as the `THREE` import across Shifting Sands modules to avoid mixed class instances
- [ ] Remove `EffectComposer` usage in this theme (Phase 6 replaces it with `PostProcessing`)
- [ ] Update animation loop to use `setAnimationLoop()` (Phase 8)

**Testing Checklist**:
- [ ] Chrome / Edge (latest stable) WebGPU path
- [ ] Firefox (verify WebGPU availability/flags; fallback path)
- [ ] Safari (Apple Silicon likely WebGPU; Intel fallback)
- [ ] Mobile browsers (fallback path)

---

### Phase 2: Worm Trail Compute Shader (Priority: HIGH)

**Objective**: Centralize sandworm position calculation in a compute shader, shared between dunes and smoke

**Files to Create**:
- `src/themes/shifting-sands/shifting-sands-compute.js`

**Implementation**:

```javascript
// shifting-sands-compute.js
import * as THREE from 'three/webgpu';
import {
    compute, storage, uniform, instanceIndex,
    float, vec2, vec3, vec4,
    sin, cos, fract, floor, mod, abs, exp, step, smoothstep, max, pow,
    Fn
} from 'three/tsl';

/**
 * Compute shader for sandworm trail calculation
 * Outputs worm head position and path parameters to a storage buffer
 */
export class WormTrailCompute {
    constructor() {
        // Worm state buffer - stores current worm position and path
        this.wormStateBuffer = new THREE.StorageBufferAttribute(
            new Float32Array(8), 4 // 2x vec4: [headX, headZ, pathBaseX, pathSlope] + [cycleHash, horizonFade, 0, 0]
        );

        this.uTime = uniform(0);
        this.wormSpeed = 30.0;
        this.wormCycleLength = 2000.0;
    }

    createComputeNode() {
        const wormState = storage(this.wormStateBuffer, 'vec4', 2);

        const computeWormPosition = Fn(() => {
            const time = this.uTime;

            // Worm cycle calculation
            const wormCycleTime = float(this.wormCycleLength / this.wormSpeed);
            const currentCycle = floor(time.div(wormCycleTime));
            const wormHeadZ = mod(time.mul(this.wormSpeed), this.wormCycleLength).sub(1000.0);

            // Pseudo-random path variation per cycle
            const cycleHash = fract(sin(currentCycle.mul(12.9898)).mul(43758.5453));
            const cycleHash2 = fract(sin(currentCycle.mul(78.233).add(1.0)).mul(43758.5453));

            const wormPathBaseX = cycleHash.sub(0.5).mul(200.0);
            const wormPathSlope = cycleHash2.sub(0.5).mul(0.6);
            const wormHeadX = wormPathBaseX.add(wormHeadZ.mul(wormPathSlope));

            // Horizon fade-in to prevent pop-in
            const distFromStart = wormHeadZ.add(1000.0);
            const horizonFade = pow(smoothstep(0.0, 1200.0, distFromStart), 5.0);

            // Write to storage buffer
            wormState.element(0).assign(vec4(wormHeadX, wormHeadZ, wormPathBaseX, wormPathSlope));
            wormState.element(1).assign(vec4(cycleHash, horizonFade, 0.0, 0.0));
        });

        this.computeNode = computeWormPosition().compute(1);
        return this.computeNode;
    }

    update(time) {
        this.uTime.value = time;
    }

    getWormStateBuffer() {
        return this.wormStateBuffer;
    }
}
```

**Tasks**:
- [ ] Create `WormTrailCompute` class
- [ ] Implement storage buffer for worm state
- [ ] Create compute node for position calculation
- [ ] Export worm state buffer for dune and smoke shaders to sample
- [ ] Add WebGL fallback (calculate on CPU + feed uniforms)

---

### Phase 3: Dune Shader Migration to TSL (Priority: HIGH)

**Objective**: Convert the complex dune shader to TSL with worm trail integration

**Files to Create**:
- `src/themes/shifting-sands/shifting-sands-materials.js`

**Implementation**:

```javascript
// shifting-sands-materials.js
import * as THREE from 'three/webgpu';
import {
    attribute, uniform, varying, varyingProperty,
    positionLocal, positionWorld, normalLocal, normalWorld, cameraPosition,
    float, vec2, vec3, vec4,
    sin, cos, fract, floor, abs, dot, length, normalize, reflect, mix, smoothstep, pow, max, clamp, exp, step,
    texture,
    Fn, If
} from 'three/tsl';

/**
 * TSL-based Arrakis dune material with:
 * - Procedural wind ripples
 * - Worm trail displacement
 * - Journey-style rim lighting
 * - Spice sparkle
 */
export function createDuneMaterial(params) {
    const {
        colorA, colorB, colorC, fogColor, fogNear, fogFar,
        moonDirection, wormStateBuffer
    } = params;

    // Uniforms
    const uTime = uniform(0);
    const uColorA = uniform(colorA);
    const uColorB = uniform(colorB);
    const uColorC = uniform(colorC);
    const uMoonDirection = uniform(moonDirection);
    const uFogColor = uniform(fogColor);
    const uFogNear = uniform(fogNear);
    const uFogFar = uniform(fogFar);

    // TSL Noise Functions
    const hash3 = Fn(([p_immutable]) => {
        const p = vec3(p_immutable).toVar();
        p.assign(vec3(
            dot(p, vec3(127.1, 311.7, 74.7)),
            dot(p, vec3(269.5, 183.3, 246.1)),
            dot(p, vec3(113.5, 271.9, 124.6))
        ));
        return fract(sin(p).mul(43758.5453123)).mul(2.0).sub(1.0);
    });

    const noise3D = Fn(([p_immutable]) => {
        const p = vec3(p_immutable).toVar();
        const i = floor(p);
        const f = fract(p);
        const u = f.mul(f).mul(vec3(3.0).sub(f.mul(2.0)));

        // Trilinear interpolation of gradients
        return mix(
            mix(
                mix(dot(hash3(i.add(vec3(0, 0, 0))), f.sub(vec3(0, 0, 0))),
                    dot(hash3(i.add(vec3(1, 0, 0))), f.sub(vec3(1, 0, 0))), u.x),
                mix(dot(hash3(i.add(vec3(0, 1, 0))), f.sub(vec3(0, 1, 0))),
                    dot(hash3(i.add(vec3(1, 1, 0))), f.sub(vec3(1, 1, 0))), u.x),
                u.y
            ),
            mix(
                mix(dot(hash3(i.add(vec3(0, 0, 1))), f.sub(vec3(0, 0, 1))),
                    dot(hash3(i.add(vec3(1, 0, 1))), f.sub(vec3(1, 0, 1))), u.x),
                mix(dot(hash3(i.add(vec3(0, 1, 1))), f.sub(vec3(0, 1, 1))),
                    dot(hash3(i.add(vec3(1, 1, 1))), f.sub(vec3(1, 1, 1))), u.x),
                u.y
            ),
            u.z
        );
    });

    // Vertex position modifier for worm trail
    const positionNode = Fn(() => {
        const pos = positionLocal.toVar();

        // Read worm state from compute buffer (or uniform fallback)
        // ... worm trail displacement logic ...

        return pos;
    });

    // Fragment color calculation
    const colorNode = Fn(() => {
        const worldPos = positionWorld;
        const normal = normalWorld;
        const viewDir = normalize(cameraPosition.sub(worldPos));

        // 1. Wind-carved ripple normal perturbation
        const rippleScale = float(0.4);
        const ripplePos = worldPos.mul(rippleScale);
        const windAngle = float(0.628);
        const windDir = vec2(cos(windAngle), sin(windAngle));

        const windRipple = noise3D(vec3(
            dot(worldPos.xz, windDir).mul(0.8),
            worldPos.y.mul(0.1),
            uTime.mul(0.01)
        ));

        const n1 = noise3D(ripplePos.add(vec3(0, 0, uTime.mul(0.015))));
        const n2 = noise3D(ripplePos.mul(2.5).add(vec3(5.2, 1.3, uTime.mul(-0.01))));

        const disturbedNormal = normalize(normal.add(vec3(n1.add(windRipple.mul(0.5)), 0, n2).mul(0.2)));

        // 2. Diffuse lighting (Arrakis harsh sunlight)
        const NdotL = dot(disturbedNormal, uMoonDirection);
        const lightIntensity = smoothstep(0.2, 0.8, NdotL.mul(0.5).add(0.5));

        // Color mixing: shadow -> golden -> highlight
        const finalColor = mix(uColorA, uColorB, smoothstep(0.2, 0.5, lightIntensity)).toVar();
        finalColor.assign(mix(finalColor, uColorC, smoothstep(0.7, 1.0, lightIntensity)));

        // 3. Rim lighting
        const NdotV = dot(disturbedNormal, viewDir);
        const rim = pow(float(1.0).sub(max(0.0, NdotV)), 2.5);
        const rimIntensity = rim.mul(NdotL.mul(0.4).add(0.6));
        finalColor.addAssign(uColorC.mul(rimIntensity).mul(0.6));

        // 4. Spice sparkle
        // ... sparkle calculation ...

        // 5. Fog
        const dist = length(worldPos.sub(cameraPosition));
        const fogFactor = smoothstep(uFogNear, uFogFar, dist);
        finalColor.assign(mix(finalColor, uFogColor, fogFactor));

        return vec4(finalColor, 1.0);
    });

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode();
    material.colorNode = colorNode();

    return {
        material,
        uniforms: { uTime, uColorA, uColorB, uColorC, uMoonDirection, uFogColor, uFogNear, uFogFar }
    };
}
```

**Tasks**:
- [ ] Implement TSL noise functions (hash3, noise3D)
- [ ] Port wind ripple normal perturbation
- [ ] Port diffuse lighting with harsh contrast
- [ ] Port rim lighting calculation
- [ ] Port spice sparkle effect
- [ ] Port worm trail vertex displacement
- [ ] Port fog calculation
- [ ] Add emissive output for MRT bloom
- [ ] Optional: upgrade to `MeshStandardNodeMaterial` for PBR lighting once visual parity is reached

---

### Phase 4: Spice Particle Compute Shader (Priority: HIGH)

**Objective**: Move spice particle simulation to GPU compute for better performance

**Implementation**:

```javascript
// In shifting-sands-compute.js

/**
 * GPU-driven spice particle simulation
 * Replaces CPU-bound particle updates with compute shader
 */
export class SpiceParticleCompute {
    constructor(particleCount) {
        this.count = particleCount;

        // Position buffer (vec4: x, y, z, life)
        this.positionBuffer = new THREE.StorageBufferAttribute(
            new Float32Array(particleCount * 4), 4
        );

        // Velocity buffer (vec4: vx, vy, vz, phase)
        this.velocityBuffer = new THREE.StorageBufferAttribute(
            new Float32Array(particleCount * 4), 4
        );

        this.uTime = uniform(0);
        this.uWindStrength = uniform(0.5);
        this.uSpiceIntensity = uniform(1.0);

        this.initializeParticles();
    }

    initializeParticles() {
        const positions = this.positionBuffer.array;
        const velocities = this.velocityBuffer.array;

        for (let i = 0; i < this.count; i++) {
            const i4 = i * 4;

            // Random position in desert area
            positions[i4] = (Math.random() - 0.5) * 600;      // x
            positions[i4 + 1] = Math.random() * 80 - 10;      // y
            positions[i4 + 2] = (Math.random() - 0.5) * 600;  // z
            positions[i4 + 3] = Math.random();                 // life (0-1)

            // Random phase for variation
            velocities[i4] = 0;
            velocities[i4 + 1] = 0;
            velocities[i4 + 2] = 0;
            velocities[i4 + 3] = Math.random() * Math.PI * 2; // phase
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);

        const computeSpice = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();

            const time = this.uTime;
            const wind = this.uWindStrength;
            const phase = vel.w;

            // Swirling motion using sine waves (optimized)
            const t = time.mul(0.15).add(phase.mul(10.0));

            const swirl1 = sin(t.mul(1.2).add(pos.y.mul(0.05))).mul(20.0).mul(wind);
            const swirl2 = cos(t.mul(0.9).add(pos.x.mul(0.03))).mul(15.0).mul(wind);
            const swirl3 = sin(t.mul(0.7).add(pos.z.mul(0.04))).mul(10.0).mul(wind);

            // Update position
            pos.x.addAssign(swirl1.mul(0.016));
            pos.z.addAssign(swirl2.mul(0.016));
            pos.y.addAssign(swirl3.mul(0.016));

            // General wind drift
            pos.x.addAssign(sin(time.mul(0.3)).mul(0.16));
            pos.z.addAssign(cos(time.mul(0.2)).mul(0.08));

            // Vertical rise
            pos.y.addAssign(sin(t.mul(2.0).add(phase.mul(6.28))).mul(0.08));

            // Respawn if out of bounds
            const outOfBounds = pos.y.greaterThan(80.0)
                .or(pos.y.lessThan(-20.0))
                .or(abs(pos.x).greaterThan(350.0))
                .or(abs(pos.z).greaterThan(350.0));

            If(outOfBounds, () => {
                pos.x.assign(fract(sin(float(index).mul(12.9898)).mul(43758.5453)).sub(0.5).mul(600.0));
                pos.y.assign(fract(sin(float(index).mul(78.233)).mul(43758.5453)).mul(60.0).sub(10.0));
                pos.z.assign(fract(sin(float(index).mul(45.164)).mul(43758.5453)).sub(0.5).mul(600.0));
            });

            // Write back
            positions.element(index).assign(pos);
        });

        this.computeNode = computeSpice().compute(this.count);
        return this.computeNode;
    }

    update(time, windStrength, spiceIntensity) {
        this.uTime.value = time;
        this.uWindStrength.value = windStrength;
        this.uSpiceIntensity.value = spiceIntensity;
    }

    getPositionAttribute() {
        return this.positionBuffer;
    }
}
```

**Tasks**:
- [ ] Create `SpiceParticleCompute` class
- [ ] Implement position/velocity storage buffers
- [ ] Port swirling motion to compute shader
- [ ] Add respawn logic for out-of-bounds particles
- [ ] Create `PointsNodeMaterial` (from `three/webgpu`) for rendering
- [ ] WebGPU path: drive positions from storage buffer via `positionNode`
- [ ] WebGL fallback: keep CPU-based updates + `BufferAttribute` positions

---

### Phase 5: Sand Smoke Volumetric Enhancement (Priority: MEDIUM)

**Objective**: Upgrade sand smoke to GPU-compute with improved volumetric rendering

**Implementation**:

```javascript
/**
 * Enhanced sand smoke with GPU compute simulation
 * Features: FBM turbulence, worm trail following, volumetric scattering
 */
export class SandSmokeCompute {
    constructor(particleCount, wormTrailCompute) {
        this.count = particleCount;
        this.wormTrail = wormTrailCompute;

        // Particle state buffer
        this.stateBuffer = new THREE.StorageBufferAttribute(
            new Float32Array(particleCount * 8), 4
            // [x, y, z, opacity, rand, wormIntensity, depth, size]
        );

        this.uTime = uniform(0);
        this.uWindStrength = uniform(0.5);
    }

    createComputeNode() {
        const state = storage(this.stateBuffer, 'vec4', this.count * 2);
        const wormState = this.wormTrail.getWormStateBuffer();

        const computeSmoke = Fn(() => {
            const index = instanceIndex;
            const pos = state.element(index.mul(2)).toVar();
            const props = state.element(index.mul(2).add(1)).toVar();

            const time = this.uTime;
            const wind = this.uWindStrength;
            const rand = props.x;

            // Read worm position from shared buffer
            const wormHead = storage(wormState, 'vec4', 2).element(0);
            const wormHeadX = wormHead.x;
            const wormHeadZ = wormHead.y;
            const wormPathBaseX = wormHead.z;
            const wormPathSlope = wormHead.w;

            // Flow motion toward camera
            const moveSpeed = float(12.0).add(wind.mul(25.0));
            const zOffset = time.mul(moveSpeed);
            const range = float(4000.0);
            const startZ = float(1000.0);
            pos.z.assign(startZ.sub(mod(startZ.sub(pos.z.sub(zOffset)), range)));

            // Worm path following (30% of particles)
            const isWormSmoke = step(0.7, rand);

            If(isWormSmoke.greaterThan(0.5), () => {
                // Attract to worm head with turbulent spread
                const spreadX = fract(sin(rand.mul(17.3)).mul(43758.5453)).sub(0.5).mul(80.0);
                const spreadZ = fract(sin(rand.mul(31.7)).mul(43758.5453)).sub(0.5).mul(150.0).add(50.0);
                const turb = sin(time.mul(3.0).add(rand.mul(100.0))).mul(15.0);

                pos.x.assign(wormHeadX.add(spreadX).add(turb));
                pos.z.assign(wormHeadZ.add(spreadZ));
            });

            // Calculate worm visibility (how close to worm trail)
            const wormPathX = wormPathBaseX.add(pos.z.mul(wormPathSlope));
            const distFromPath = abs(pos.x.sub(wormPathX));
            const trailWidth = float(60.0);
            const pathMask = exp(distFromPath.mul(distFromPath).mul(-1.0).div(trailWidth.mul(trailWidth)));

            const distFromHead = pos.z.sub(wormHeadZ);
            const smokeZone = smoothstep(-500.0, 0.0, distFromHead).mul(smoothstep(120.0, 0.0, distFromHead));

            const wormVisibility = smokeZone.mul(pathMask);
            props.y.assign(wormVisibility); // Store for fragment shader

            // Write back
            state.element(index.mul(2)).assign(pos);
            state.element(index.mul(2).add(1)).assign(props);
        });

        this.computeNode = computeSmoke().compute(this.count);
        return this.computeNode;
    }
}
```

**Tasks**:
- [ ] Create `SandSmokeCompute` class
- [ ] Integrate with worm trail compute buffer
- [ ] Implement flow motion and worm attraction
- [ ] Port FBM turbulence to TSL
- [ ] Create volumetric rendering material
- [ ] Add god ray scattering from moons
- [ ] WebGL fallback: CPU update path + standard buffer attributes

---

### Phase 6: Post-Processing Migration to TSL (Priority: MEDIUM)

**Objective**: Replace EffectComposer heat shimmer with TSL-based post-processing

**Files to Create**:
- `src/themes/shifting-sands/shifting-sands-post.js`

**Implementation**:

```javascript
// shifting-sands-post.js
import * as THREE from 'three/webgpu';
import { pass, mrt, output, emissive, viewportUV, uniform, vec2, sin, cos, smoothstep } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export class ShiftingSandsPost {
    constructor(renderer, scene, camera, params) {
        this.renderer = renderer;
        this.postProcessing = new THREE.PostProcessing(renderer);

        // Scene pass with MRT for selective bloom
        this.scenePass = pass(scene, camera);
        this.scenePass.setMRT(mrt({ output, emissive }));

        const sceneColor = this.scenePass.getTextureNode('output');
        const emissivePass = this.scenePass.getTextureNode('emissive');

        // Heat shimmer distortion using TSL
        const uTime = this.uTime = uniform(0);
        const uStrength = this.uStrength = uniform(params.heatShimmerStrength);

        const uv = viewportUV.toVar();

        // Vertical gradient - stronger at bottom (ground heat)
        const heatMask = smoothstep(0.8, 0.2, uv.y);

        // Heat wave distortion
        const xOffset = sin(uv.y.mul(50.0).add(uTime.mul(2.0))).mul(0.001)
            .add(sin(uv.y.mul(20.0).add(uTime.mul(3.0))).mul(0.002))
            .mul(heatMask).mul(uStrength).mul(100.0);

        const yOffset = cos(uv.x.mul(40.0).add(uTime.mul(2.0))).mul(0.001)
            .mul(heatMask).mul(uStrength).mul(100.0);

        const distortedUV = uv.add(vec2(xOffset, yOffset));
        const distortedColor = sceneColor.sample(distortedUV);

        // Spice bloom on emissive (orange glow)
        const spiceBloom = bloom(emissivePass, 0.4, 0.3, 0.2);

        // Final composition
        this.postProcessing.outputNode = distortedColor.add(spiceBloom);
        this.postProcessing.needsUpdate = true;
    }

    update(time, strength) {
        this.uTime.value = time;
        this.uStrength.value = strength;
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        this.scenePass.setSize(width, height);
    }

    dispose() {
        this.scenePass.dispose();
        this.postProcessing.dispose();
    }
}
```

**Tasks**:
- [ ] Create `ShiftingSandsPost` class
- [ ] Port heat shimmer distortion to TSL
- [ ] Add MRT-based spice bloom (emissive only)
- [ ] Add optional color grading node
- [ ] Ensure post chain works on WebGL backend via `WebGPURenderer` fallback

---

### Phase 7: Sky and Stars Migration (Priority: LOW)

**Objective**: Convert sky gradient and star shaders to TSL

**Implementation**:

```javascript
// Sky material using TSL
export function createSkyMaterial(params) {
    const {
        topColor, midColor, bottomColor, horizonColor,
        moonPosition, moonColor, moonGlowIntensity
    } = params;

    const uTopColor = uniform(topColor);
    const uMidColor = uniform(midColor);
    const uBottomColor = uniform(bottomColor);
    const uHorizonColor = uniform(horizonColor);
    const uMoonPosition = uniform(moonPosition);
    const uMoonColor = uniform(moonColor);
    const uMoonGlowIntensity = uniform(moonGlowIntensity);

    const colorNode = Fn(() => {
        const worldPos = positionWorld;
        const height = normalize(worldPos).y;

        // Multi-stop gradient for Arrakis sky
        const color = vec3(0, 0, 0).toVar();

        If(height.greaterThan(0.3), () => {
            const t = height.sub(0.3).div(0.7);
            color.assign(mix(uMidColor, uTopColor, pow(t, 0.5)));
        }).ElseIf(height.greaterThan(0.0), () => {
            const t = height.div(0.3);
            color.assign(mix(uBottomColor, uMidColor, t));
        }).Else(() => {
            const t = clamp(height.mul(-2.0), 0.0, 1.0);
            color.assign(mix(uBottomColor, uHorizonColor, t.mul(0.7)));
        });

        // Primary moon glow
        const moonDir = normalize(uMoonPosition);
        const viewDir = normalize(worldPos);
        const moonFactor = max(0.0, dot(viewDir, moonDir));
        const moonGlow = pow(moonFactor, 6.0).mul(0.5).add(pow(moonFactor, 24.0).mul(0.4));

        // Secondary moon glow
        const moon2Dir = normalize(vec3(100.0, 55.0, -180.0));
        const moon2Factor = max(0.0, dot(viewDir, moon2Dir));
        const moon2Glow = pow(moon2Factor, 8.0).mul(0.3).add(pow(moon2Factor, 32.0).mul(0.2));

        color.assign(mix(color, uMoonColor, moonGlow.add(moon2Glow.mul(0.6)).mul(uMoonGlowIntensity)));

        return vec4(color, 1.0);
    });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = colorNode();
    material.side = THREE.BackSide;
    material.depthWrite = false;

    return { material, uniforms: { uTopColor, uMidColor, uBottomColor, uHorizonColor, uMoonPosition, uMoonColor, uMoonGlowIntensity } };
}

// Stars material using TSL PointsNodeMaterial
export function createStarMaterial(params) {
    const uTime = uniform(0);

    const aSize = attribute('aSize');
    const aPhase = attribute('aPhase');
    const aColor = attribute('aColor');

    // Twinkle calculation
    const twinkle = sin(uTime.mul(2.0).add(aPhase.mul(10.0))).mul(0.5).add(0.5);

    const material = new THREE.PointsNodeMaterial();
    material.colorNode = aColor.mul(twinkle);
    material.opacityNode = twinkle;
    material.sizeNode = aSize.mul(twinkle.mul(0.5).add(0.5));
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    return { material, uniforms: { uTime } };
}
```

**Tasks**:
- [ ] Port sky gradient shader to TSL
- [ ] Port twin moon glow calculation
- [ ] Port star twinkle shader to TSL
- [ ] Use `PointsNodeMaterial` (from `three/webgpu`) for stars
- [ ] Verify visual parity

---

### Phase 8: Animation Loop Migration (Priority: HIGH)

**Objective**: Update render loop for WebGPU async nature and compute dispatch

**Implementation**:

```javascript
// In shifting-sands-theme.js

animate() {
    // Use setAnimationLoop for WebGPU compatibility
    this.renderer.setAnimationLoop(() => {
        if (!this.isActive) return;

        const delta = this.clock.getDelta();
        const elapsed = this.clock.getElapsedTime();

        this.update(elapsed, delta);
        this.render();
    });
}

    update(time, delta) {
        // Update uniforms
        this.uniforms.time.value = time;

        // Dispatch compute shaders (WebGPU backend only)
        if (this.renderer.backend.isWebGPUBackend === true) {
            // Update worm trail compute
            if (this.wormTrailCompute) {
                this.wormTrailCompute.update(time);
                this.renderer.compute(this.wormTrailCompute.computeNode);
            }

        // Update spice particle compute
        if (this.spiceCompute) {
            this.spiceCompute.update(time, this.uniforms.windStrength.value, this.uniforms.spiceIntensity.value);
            this.renderer.compute(this.spiceCompute.computeNode);
        }

        // Update sand smoke compute
        if (this.sandSmokeCompute) {
            this.sandSmokeCompute.update(time, this.uniforms.windStrength.value);
            this.renderer.compute(this.sandSmokeCompute.computeNode);
        }
    } else {
        // WebGL fallback: CPU-based particle updates
        this.updateParticlesCPU(time, delta);
    }

    // Update TSL material uniforms
    if (this.duneMaterial?.uniforms) {
        this.duneMaterial.uniforms.uTime.value = time;
    }
    if (this.skyMaterial?.uniforms) {
        this.skyMaterial.uniforms.uMoonGlowIntensity.value = this.uniforms.moonGlowIntensity.value;
    }

    // Camera shake
    this.updateCameraShake(delta);

    // Wind interpolation
    this.uniforms.windStrength.value += (this.targetWindStrength - this.uniforms.windStrength.value) * delta * 2;
}

render() {
    if (this.post && this.activePreset.enableHeatShimmer) {
        this.post.update(this.uniforms.time.value, this.uniforms.heatShimmerStrength.value);
        this.post.render();
    } else {
        this.renderer.render(this.scene, this.camera);
    }
}

stop() {
    if (this.renderer) {
        this.renderer.setAnimationLoop(null);
    }

    // Dispose compute resources
    if (this.wormTrailCompute) this.wormTrailCompute.dispose?.();
    if (this.spiceCompute) this.spiceCompute.dispose?.();
    if (this.sandSmokeCompute) this.sandSmokeCompute.dispose?.();

    // ... existing cleanup
}
```

**Tasks**:
- [ ] Replace `requestAnimationFrame` with `setAnimationLoop()`
- [ ] Add compute shader dispatch in update loop
- [ ] Update TSL uniform values
- [ ] Add WebGL fallback for particle updates
- [ ] Clean up compute resources on stop

---

### Phase 9: Visual Enhancements (Priority: LOW - WebGPU Only)

**Objective**: Add world-class visual effects exclusive to WebGPU

#### 9.1 Moon God Rays

```javascript
// Volumetric light shafts from twin moons
createMoonGodRays() {
    if (!this.isWebGPU) return;

    // Ray-marched light scattering compute shader
    const godRayCompute = Fn(() => {
        const uv = viewportUV;
        const moonScreenPos1 = uniform(vec2(0.3, 0.8)); // Moon 1 screen position
        const moonScreenPos2 = uniform(vec2(0.7, 0.7)); // Moon 2 screen position

        const rayDir1 = normalize(uv.sub(moonScreenPos1));
        const rayDir2 = normalize(uv.sub(moonScreenPos2));

        // Accumulate light along rays
        let light = float(0.0).toVar();
        const steps = 32;

        Loop(steps, ({ i }) => {
            const samplePos1 = uv.sub(rayDir1.mul(float(i).div(steps)).mul(0.3));
            const samplePos2 = uv.sub(rayDir2.mul(float(i).div(steps)).mul(0.3));

            // Sample scene depth/brightness at positions
            // Add to light accumulation with falloff
        });

        return light;
    });
}
```

#### 9.2 Sand Flow Simulation

```javascript
// GPU compute for realistic sand grain flow
createSandFlowSimulation() {
    if (!this.isWebGPU) return;

    // Compute shader simulates sand grains flowing down dune faces
    // Based on angle of repose physics
}
```

#### 9.3 Subsurface Scattering Dunes

```javascript
// Light transmission through thin sand ridges
// Creates warm backlit glow on dune edges
```

**Tasks**:
- [ ] Implement moon god rays (compute-based)
- [ ] Add sand flow simulation
- [ ] Add subsurface scattering for dune ridges
- [ ] Add atmospheric perspective enhancement
- [ ] Conditional loading (`if (this.isWebGPU)`)

---

### Phase 10: Testing & Quality Assurance (Priority: CRITICAL)

**Testing Matrix**:

| Browser | GPU | WebGPU | WebGL Fallback | Expected FPS |
|---------|-----|--------|----------------|--------------|
| Chrome / Edge (latest stable) | NVIDIA/AMD | Yes | - | 60+ |
| Chrome / Edge (latest stable) | Intel | Yes | - | 45-60 |
| Firefox (stable or Nightly) | All | Verify availability/flags | Yes | 40-55 |
| Safari (latest stable) | Apple Silicon | Likely | - | 50-60 |
| Safari (latest stable) | Intel Mac | Often No | Yes | 35-50 |
| Mobile Chrome / Safari | All | Usually No | Yes | 25-40 |

**QA Notes**:
- Use `forceWebGL: true` during testing to validate the WebGL2 fallback path.
- Verify WebGPU availability per platform at test time (support changes over time).

**Visual Regression Tests**:
- [ ] Dune color gradient matches original
- [ ] Worm trail displacement identical
- [ ] Spice particle swirl behavior
- [ ] Sand smoke density and flow
- [ ] Twin moon glow intensity
- [ ] Heat shimmer distortion strength
- [ ] Combo effects (blue glow, wind)

**Performance Benchmarks**:
- [ ] Measure particle update time (CPU vs GPU compute)
- [ ] Profile draw call reduction
- [ ] Compare memory usage WebGL vs WebGPU
- [ ] Test at all quality presets

---

## File Structure After Migration

```
src/themes/shifting-sands/
├── shifting-sands-theme.js          # Main theme (updated)
├── shifting-sands-shaders.js        # Legacy GLSL (kept temporarily for visual parity/reference)
├── shifting-sands-tetrominos.js     # Unchanged
├── shifting-sands-materials.js      # NEW: TSL material library
├── shifting-sands-compute.js        # NEW: Compute shaders
├── shifting-sands-post.js           # NEW: TSL post-processing
└── shifting-sands-cpu-fallback.js   # NEW: CPU fallback helpers for WebGL backend (optional)
```

---

## Risk Mitigation

### Risk 1: Worm Trail Visual Differences
**Mitigation**: The worm trail uses complex vertex displacement. Test extensively with side-by-side comparison. Keep GLSL version for A/B testing.

### Risk 2: Noise Function Precision
**Mitigation**: TSL noise functions may have slight precision differences. Use identical constants and validate output ranges.

### Risk 3: Particle System Performance
**Mitigation**: Profile compute vs CPU thoroughly. Fall back to CPU updates if compute overhead exceeds gains on low-end GPUs.

### Risk 4: Post-Processing Artifacts
**Mitigation**: Heat shimmer uses screen-space effects. Test on various resolutions and aspect ratios.

### Risk 5: WebGL Fallback Feature Gaps
**Mitigation**: Gate compute/MRT-heavy features behind `renderer.backend.isWebGPUBackend`. Maintain CPU update paths and simpler post effects for WebGL backend to preserve gameplay and visuals without errors.

---

## Dependencies

- Three.js r181 (repo uses `^0.181.2`) with `three/webgpu` + `three/tsl`
- `three/addons/tsl/display/BloomNode.js` for selective bloom (optional)
- Browser with WebGPU or WebGL 2.0
- No external shader libraries required

---

## Recommended Implementation Order

1. **Phase 1** - Renderer initialization (foundation)
2. **Phase 8** - Animation loop (required for testing)
3. **Phase 2** - Worm trail compute (shared dependency)
4. **Phase 3** - Dune shader (main visual element)
5. **Phase 4** - Spice particles (high visual impact)
6. **Phase 6** - Post-processing (bloom + heat shimmer)
7. **Phase 5** - Sand smoke (builds on Phase 2)
8. **Phase 7** - Sky/stars (low priority)
9. **Phase 9** - Visual enhancements (bonus)
10. **Phase 10** - Testing (throughout)

---

## References

- [Three.js WebGPU Documentation](https://threejs.org/docs/#manual/en/introduction/WebGPU)
- [TSL (Three Shading Language) Guide](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [WebGPU Compute Shaders](https://www.w3.org/TR/webgpu/#compute-pipeline)
- [Neon District WebGPU Plan](./NEON_DISTRICT_WEBGPU_UPGRADE_PLAN.md) - Sister theme implementation
- [Tornado Theme Implementation](../src/themes/tornado/) - Reference for TSL patterns

---

## Changelog

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-01-31 | 1.1 | Codex | Updated for built-in WebGPU/WebGL2 fallback, corrected TSL/WebGPU imports, compute buffer sizing, and post-processing pipeline |
| 2026-01-31 | 1.0 | Claude | Initial plan document |
