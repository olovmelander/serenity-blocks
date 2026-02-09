# Bioluminescence Theme - WebGPU Hybrid Upgrade Plan

## Overview

Transform the Bioluminescence theme from a WebGL-only implementation into a world-class WebGPU hybrid masterpiece featuring TSL (Three Shading Language) node materials, GPU compute-driven particle systems, advanced post-processing with MRT emissive bloom, and a dramatically enhanced cave environment - while silently falling back to WebGL 2.0 on unsupported hardware.

**Gold Standard Reference:** Black Hole theme hybrid pattern
**Target:** Desktop-first, visually stunning bioluminescent cave environment

---

## Art Direction & Visual Identity

### Mood & Inspiration
- **Primary references:** *Avatar* (Pandora bioluminescence), *Subnautica* (alien ocean caves), *Deep Rock Galactic* (crystal caves), real deep-sea bioluminescence footage
- **Emotional tone:** Awe, mystery, tranquility with moments of spectacle (game events)
- **Atmosphere:** Dense, humid cave air; the sense that the cave is *alive*; every surface subtly breathes
- **Key principle:** Darkness is as important as light - bioluminescence only works when surrounded by deep, rich blackness

### Color Palette (Strict)
| Role | Color | Hex | Usage |
|------|-------|-----|-------|
| **Primary Glow** | Vivid Cyan | `#00FFD4` | Mushroom caps, spore cores, primary emissive |
| **Secondary Glow** | Bioluminescent Teal | `#00C9A7` | Crystal interiors, vine orbs, gill glow |
| **Accent Warm** | Phosphor Green | `#66FFAA` | Moss patches, algae, firefly trails |
| **Accent Cool** | Deep Aqua | `#0088AA` | Water subsurface, deep crystal, cave veins |
| **Highlight** | White-Cyan | `#CCFFFF` | Brightest bloom peaks, crystal tips, combo flash |
| **Shadow Base** | Abyss Navy | `#020810` | Background void, deep shadows, fog base |
| **Rock Base** | Wet Slate | `#0A1518` | Cave floor, walls, stalactites (non-emissive) |
| **Water Deep** | Midnight Teal | `#001A1A` | Deep water areas, pool center |

### Visual Hierarchy (Brightness Order)
1. Crystal tips & mushroom cap centers (brightest - drives bloom)
2. Mushroom cap edges (SSS transmission glow)
3. Fireflies & large spores (moving bright accents)
4. Vine orbs, moss patches (mid-level ambient glow)
5. Mycelium network veins (subtle connecting glow)
6. Cave wall veins, water subsurface (atmospheric base glow)
7. Rock surfaces, stalactites (non-emissive, lit only by scene glow)
8. Background void, deep shadows (near-black anchor)

---

## Current State Analysis

### What Exists (WebGL Only)
- `bioluminescence-theme.js` (~2000 lines, monolithic)
- `bioluminescence-tetrominos.js` (color/effects config)
- `WebGLRenderer` with `EffectComposer` + `UnrealBloomPass`
- 6 GLSL shaders inline (Mushroom, Crystal, Terrain, Spore, ContactRipple, Shore)
- CPU-generated PBR textures via Canvas2D (cave rock, vine, mushroom cap)
- `Water.js` from Three.js examples for cave pool
- Static `MeshStandardMaterial` for terrain, stems, vines
- Spore particles via `THREE.Points` with GLSL shader
- ~20 mushrooms, ~6 crystal clusters, ~300 spores (High preset)
- Single bloom pass, basic fog, minimal volumetric effects

### Current Weaknesses
1. **Monolithic file** - all 2000 lines in one file, hard to maintain
2. **No WebGPU support** - uses only `WebGLRenderer`
3. **CPU-bound particles** - spores and effects limited by JS
4. **Basic post-processing** - single UnrealBloomPass, no emissive isolation
5. **Static lighting** - no dynamic light interaction with bioluminescence
6. **Fake SSS** - GLSL rim glow approximation instead of true transmission/thickness
7. **No GPU compute** - all animation driven by CPU uniform updates
8. **Water is placeholder** - `Water.js` with wrong normal map, looks generic
9. **Missing atmosphere** - no volumetric fog, no light scattering, no god rays
10. **Crystals too bright** - additive blending causes whiteout
11. **Cave feels empty** - limited environment depth, sparse decoration
12. **No mycelium network** - missing the signature bioluminescent neural web connecting organisms
13. **No instancing** - every small element is a unique mesh (performance waste)

---

## Target Architecture

### New File Structure
```
src/themes/bioluminescence/
  bioluminescence-theme.js          # Main class (hybrid renderer, scene, animation)
  bioluminescence-materials.js      # TSL node material factories + noise library
  bioluminescence-compute.js        # GPU compute: spores, fireflies, mycelium
  bioluminescence-post.js           # WebGPU PostProcessing (MRT bloom, grading)
  bioluminescence-tetrominos.js     # Tetromino config (keep existing)
  bioluminescence-theme-icon.png    # Theme icon (keep existing)
```

### Hybrid Renderer Pattern
```javascript
// Dual imports
import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';

// In initRenderer():
// 1. Try WebGPURenderer first
// 2. Check backend?.isWebGPUBackend === true
// 3. Fall back to WebGLRenderer silently
// 4. Set this.isWebGPU flag for downstream branching
// 5. URL param ?forceWebGL=1 for testing
```

---

## Implementation Phases

---

### Phase 1: Architecture & Hybrid Renderer Foundation
**Priority: CRITICAL | Estimated Complexity: Medium**

#### 1.1 - TSL Procedural Noise Library (top of `bioluminescence-materials.js`)

Build a reusable set of `Fn()` noise functions at the top of the materials file. These are the building blocks for every organic material in the theme. Pattern proven in Neon District and Shifting Sands themes:

```javascript
import { Fn, vec2, vec3, float, fract, sin, cos, dot, floor, mix, abs, smoothstep } from 'three/tsl';

// Hash functions (basis for all noise)
const hash21 = /* @__PURE__ */ Fn(([p]) => {
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

const hash22 = /* @__PURE__ */ Fn(([p]) => {
    const q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(q).mul(43758.5453));
});

const hash3 = /* @__PURE__ */ Fn(([p]) => {
    const q = fract(p.mul(vec3(0.1031, 0.1030, 0.0973)));
    // ... trilinear hash
    return fract(q.mul(q.yzx.add(33.33)));
});

// 2D value noise
const noise2D = /* @__PURE__ */ Fn(([p]) => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))); // smoothstep
    return mix(
        mix(hash21(i), hash21(i.add(vec2(1, 0))), u.x),
        mix(hash21(i.add(vec2(0, 1))), hash21(i.add(vec2(1, 1))), u.x),
        u.y
    );
});

// 3D gradient noise (Perlin-style) - from Shifting Sands pattern
const noise3D = /* @__PURE__ */ Fn(([p]) => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    // Trilinear interpolation of 8 corner gradients
    // ... (full implementation as in shifting-sands-materials.js)
});

// 4-octave FBM - from Neon District pattern
const fbm4 = /* @__PURE__ */ Fn(([p]) => {
    let noise = noise2D(p);
    noise = noise.add(noise2D(p.mul(2.0).add(vec2(17.0))).mul(0.5));
    noise = noise.add(noise2D(p.mul(4.0).add(vec2(31.0))).mul(0.25));
    noise = noise.add(noise2D(p.mul(8.0).add(vec2(53.0))).mul(0.125));
    return noise.div(1.875);
});

// Voronoi (for organic cell patterns on mushroom caps, crystal facets)
const voronoi = /* @__PURE__ */ Fn(([p]) => {
    const i = floor(p);
    const f = fract(p);
    let minDist = float(8.0);
    // 3x3 grid search
    // ... returns { distance, cellCenter }
});
```

#### 1.2 - Extract Materials Module (`bioluminescence-materials.js`)

Create TSL node material factories for WebGPU path. **Critical: Use `MeshPhysicalNodeMaterial` for translucent organic objects** (mushrooms, crystals) to leverage built-in transmission, thickness, and attenuation for real SSS:

- `createMushroomCapNodeMaterial()` - **MeshPhysicalNodeMaterial** with:
  - `transmissionNode` - light passes through thin cap edges (0.3-0.6)
  - `thicknessNode` - varies across cap surface (thin at edges, thick at center)
  - `attenuationColor` - deep teal-cyan (`#006655`) for subsurface color
  - `attenuationDistance` - 0.8 for medium absorption
  - `iorNode` - 1.4 (organic refractive index)
  - `emissiveNode` - animated pulse glow using `uTime` + `positionLocal`
  - `normalNode` - voronoi-based cell pattern for organic gill structure
  - Iridescence via view-angle-dependent color shift in emissive
- `createMushroomStemNodeMaterial()` - MeshStandardNodeMaterial with wet look
- `createCrystalNodeMaterial()` - **MeshPhysicalNodeMaterial** with:
  - `transmissionNode` - 0.7-0.9 for glass-like transparency
  - `thicknessNode` - height-gradient (brighter at tips)
  - `attenuationColor` - `#004488` for deep blue internal tint
  - `iorNode` - 1.8 (crystal-like refraction)
  - `emissiveNode` - animated internal energy flow
  - Fresnel rim with clamped intensity (no whiteout)
  - Dispersion hint via slight RGB offset in transmission
- `createCaveRockNodeMaterial()` - MeshStandardNodeMaterial with:
  - Procedural color from `fbm4` (no canvas textures needed)
  - `normalNode` from noise-based detail
  - `roughnessNode` - wet in low areas, dry on ridges
  - `emissiveNode` - faint bioluminescent crack lines via `voronoi` edges
- `createVineNodeMaterial()` - MeshStandardNodeMaterial with animated emissive veins
- `createSporeNodeMaterial(isWebGPU, sporeCompute)` - PointsNodeMaterial with:
  - `positionNode` from `storage()` buffer (GPU) or `attribute()` (CPU fallback)
  - `colorNode` with lifecycle-based alpha
  - `sizeNode` with distance attenuation
- `createFireflyNodeMaterial(isWebGPU, fireflyCompute)` - PointsNodeMaterial with glow + trails
- `createCaveWallNodeMaterial()` - MeshStandardNodeMaterial with:
  - Animated bioluminescent vein network (multi-frequency sine pattern)
  - Pulsing glow spots (fbm-driven)
- `createWaterSurfaceNodeMaterial()` - MeshPhysicalNodeMaterial with:
  - `transmissionNode` for see-through water
  - Animated `normalNode` from multi-layer sine ripples
  - Subsurface `emissiveNode` for plankton glow
  - Fresnel-based reflection blend
- `createBackgroundNodeMaterial()` - MeshBasicNodeMaterial with cave void
- `createMyceliumNodeMaterial()` - MeshBasicNodeMaterial with:
  - Additive blending for pure glow
  - Animated brightness wave (for event propagation)
  - Line-based rendering or tube geometry with emissive pulse

Each factory returns `{ material, uniforms }`. Uniforms use TSL `uniform()` nodes.

#### 1.3 - WebGL Fallback Materials

For the `!this.isWebGPU` path, keep existing GLSL `ShaderMaterial` definitions (Mushroom, Crystal, Terrain, Spore, ContactRipple, Shore shaders). Migrate them to a `createWebGLFallbackMaterials()` function within the materials file. Key differences:
- No MeshPhysicalNodeMaterial features (no real SSS, no transmission)
- Approximate SSS with rim glow GLSL (existing shader works)
- Standard `THREE.Points` with GLSL vertex/fragment (existing spore shader)
- No compute-driven particles (CPU animation loop)
- Standard bloom (no MRT isolation)

#### 1.4 - Implement Hybrid Renderer in Main Theme
- Add dual imports (`three` + `three/webgpu`)
- Implement `async initRenderer(container)`:
  - Try `new THREE_WEBGPU.WebGPURenderer({ antialias, alpha: false })`
  - `await renderer.init()` in try/catch
  - Verify `backend?.isWebGPUBackend === true`
  - Fallback: `new THREE.WebGLRenderer({ antialias, alpha: false })`
  - Set `this.isWebGPU` boolean flag
  - Handle device loss: `renderer.onDeviceLost`
  - Parse debug flags from URL params (`?forceWebGL=1`, `?noPost=1`, etc.)
- Make `createScene()` async (awaits `initRenderer`)
- Gate material creation: TSL materials when `this.isWebGPU`, GLSL when not
- Progressive scene build: render basic scene immediately, add details over frames

#### 1.5 - Dual Post-Processing Setup
- **WebGPU path:** Create `BioluminescencePost` class in `bioluminescence-post.js`
  - `PostProcessing` from `three/webgpu`
  - `pass()`, `mrt()`, `bloom()` from `three/tsl`
  - MRT with `output` + `emissive` channels for isolated bloom
  - Bloom only on emissive channel (mushrooms/crystals glow; rock doesn't)
  - Chromatic aberration, vignette, color grading via TSL nodes
  - Tone mapping: ACES Filmic via TSL
  - Exposed uniforms for dynamic adjustment (combo intensity → bloom strength)
- **WebGL path:** Keep existing `EffectComposer` + `UnrealBloomPass` + add vignette/color grade `ShaderPass`
- Branch in `setupPostProcessing()` based on `this.isWebGPU`

**Acceptance Criteria:**
- Theme loads with WebGPU on supported browsers, WebGL on others
- No console errors on either path
- Visual parity between WebGPU and WebGL at baseline
- `?forceWebGL=1` works for testing
- Mushroom caps show visible light transmission through thin edges (WebGPU)
- Crystals are transparent with internal color tint (WebGPU)

---

### Phase 2: GPU Compute Particle Systems & Mycelium
**Priority: HIGH | Estimated Complexity: High**

#### 2.1 - Create `bioluminescence-compute.js`

**SporeCompute class** - GPU-driven floating spore particles
- `StorageBufferAttribute` for interleaved buffers:
  - State buffer: `[x, y, z, life]` + `[vx, vy, vz, seed]` per particle (vec4 pairs, as in Shifting Sands sand smoke pattern)
- Compute shader via `Fn()`:
  - Upward float with 3D noise turbulence (reuse `noise3D` from noise library)
  - Lifecycle: spawn at terrain surface near mushrooms, float upward, fade at ceiling, respawn
  - Soft attraction toward nearest light source (mushroom/crystal positions passed as uniforms)
  - Wind gusts: periodic directional force (sine-based wind vector)
  - Interaction: avoid water surface (bounce off y=-52)
  - Quality scaling: 1000 (High) → 3000 (Extreme)
- Expose getters: `getStateBuffer()`, `count`
- Material uses vertex pulling pattern (as in Shifting Sands):
  ```javascript
  const stateBuffer = storage(sporeCompute.getStateBuffer(), 'vec4', sporeCompute.count * 2);
  const posLife = stateBuffer.element(vertexIndex.mul(2));
  const velSeed = stateBuffer.element(vertexIndex.mul(2).add(1));
  material.positionNode = posLife.xyz;
  ```

**FireflyCompute class** - Larger bioluminescent fireflies with emergent behavior
- 50-200 particles (quality-scaled)
- Buffer: `[x, y, z, glowPhase]` + `[vx, vy, vz, state]` per firefly
- State machine encoded in `state` float:
  - 0.0-0.3 = idle hover (slow sine orbit)
  - 0.3-0.5 = dart (fast linear movement to random target)
  - 0.5-0.8 = idle hover at new position
  - 0.8-1.0 = glow intensify + slow sink → reset to 0.0
- `glowPhase` increments based on state (brighter during dart transitions)
- Color variation per firefly: mix between Primary Glow and Phosphor Green based on seed
- Optional trail effect: ring buffer of last 4 positions, rendered as fading line segments

**MyceliumPulseCompute class** (WebGPU only, Extreme/Ultra quality)
- Simulates glow propagation through underground network
- Buffer: `[brightness, targetBrightness, propagationSpeed, connectionCount]` per node
- Network nodes placed at mushroom/crystal base positions
- When game event fires, set source node brightness → propagates to connected nodes over frames
- Material reads brightness per node to animate mycelium line/tube glow

#### 2.2 - Integrate Compute with Materials
- Spore `PointsNodeMaterial` reads from `SporeCompute.getStateBuffer()` via `storage()` node
- Firefly `PointsNodeMaterial` uses compute position + glow phase for dynamic size + color
- Mycelium material reads brightness buffer for animated glow intensity
- **CPU fallback (WebGL):** Keep existing `THREE.Points` with GLSL vertex shader for spores. Fireflies and mycelium pulse are WebGPU-only features (graceful absence on WebGL).

**Acceptance Criteria:**
- Spores computed entirely on GPU (WebGPU) or CPU (WebGL)
- Fireflies add magical atmosphere with emergent behavior patterns
- Mycelium pulse creates visible glow waves between organisms on game events
- Minimum 1000 spores at 60fps on mid-range GPU
- No performance regression vs current implementation on WebGL path

---

### Phase 3: Enhanced Environment & World Building
**Priority: HIGH | Estimated Complexity: High**

#### 3.1 - Dramatic Cave Architecture

**Cave ceiling:**
- Large dome-shaped displaced PlaneGeometry at y=450-500
- Procedural stalactite clusters: groups of 3-7 ConeGeometry hanging down
- Place stalactites using noise-based distribution (avoid center play area)
- Bioluminescent moss patches on stalactite surfaces (emissive spots in material)
- Dripping water: occasional small sphere geometry dropping from stalactite tips (simple animation, respawn at top)

**Side walls (left/right):**
- Two curved PlaneGeometry walls (concave toward center) at x=±500
- Displacement from multi-octave noise for rocky surface
- TSL cave wall material with animated bioluminescent vein network
- Shelf mushrooms growing from wall surfaces (placed at wall vertices)

**Cave floor enhancement:**
- Keep terrain PlaneGeometry but increase displacement amplitude
- Deeper cracks with emissive bioluminescent moss in crevices
- Small rock formations: scattered low-poly IcosahedronGeometry clusters near walls
- Rubble/debris scatter (InstancedMesh with per-instance random transform)

**Cave depth (background layers):**
- Layer 1 (z=-400): Silhouette mushroom/crystal shapes (dark with subtle edge glow)
- Layer 2 (z=-600): Faint glowing spots suggesting distant cave continuation
- Layer 3 (z=-800): Pure darkness with occasional dim pulse
- Atmospheric depth fog: `FogExp2` with teal-tinted color gradient

#### 3.2 - Bioluminescent Water Pool Overhaul

Replace `Water.js` entirely with custom implementation:

**TSL Water Material (WebGPU):**
- `MeshPhysicalNodeMaterial` with:
  - `transmissionNode` - 0.6 for semi-transparent water
  - `normalNode` - multi-layer animated sine waves for ripple surface:
    ```
    wave1 = sin(uv.x * 15 + time * 0.8) * cos(uv.y * 12 - time * 0.5)
    wave2 = sin(uv.x * 25 - time * 1.2) * cos(uv.y * 20 + time * 0.7)
    normal = perturbNormal(wave1 * 0.6 + wave2 * 0.4)
    ```
  - `emissiveNode` - subsurface plankton glow: faint animated `noise2D` pattern in cyan
  - `roughnessNode` - 0.05 (very smooth/reflective)
  - `attenuationColor` - `#001A1A` (Midnight Teal)
  - Depth-based color: blend from teal (edges) to dark navy (center) using radial UV distance
- Vertex displacement for gentle wave motion (small amplitude sine)

**GLSL Water Material (WebGL fallback):**
- `ShaderMaterial` with animated sine-wave normals
- Fresnel-based reflection approximation
- Emissive subsurface hint

**Shore interaction:**
- Animated foam ring (keep existing shore shader, improve with noise-based foam pattern)
- Wet rock: terrain material `roughnessNode` is lower within 20 units of water edge
- Contact ripples at mushroom/crystal bases in water (keep existing, enhance with TSL)

#### 3.3 - Enhanced Mushroom Ecosystem

**4 distinct mushroom species** (all share `createMushroomCapNodeMaterial` with per-instance parameter variation):

| Species | Geometry | Size | Placement | Count (High) |
|---------|----------|------|-----------|---------------|
| **Tall Spire** | Thin cylinder stem + half-sphere cap (flat) | H: 30-60 | Floor, scattered | 8-12 |
| **Shelf/Bracket** | Flat disc + quarter-sphere cap | W: 15-30 | Wall surfaces | 6-10 |
| **Cluster Mini** | InstancedMesh, 5-8 per cluster | H: 3-8 | Rock surfaces, near large mushrooms | 4-6 clusters (20-48 instances) |
| **Giant Ancient** | Large cylinder + dome cap + root tendrils | H: 80-120 | 1-2 as focal points, back of scene | 1-2 |

**Per-species material tweaks** (passed as params to material factory):
- `transmissionStrength` - Tall Spire: 0.4, Giant: 0.6 (more dramatic SSS)
- `emissiveColor` - Primary Glow for most, shifted toward Phosphor Green for Cluster Mini
- `pulseSpeed` - faster for small species, slower majestic pulse for Giant
- `capPattern` - voronoi scale varies (large cells for Giant, small for Cluster)

**Cluster Mini mushrooms via InstancedMesh:**
```javascript
const instanceCount = 40; // Per cluster
const mesh = new THREE.InstancedMesh(capGeo, capMaterial, instanceCount);
// Per-instance: position, scale, rotation via InstancedBufferAttribute
// Material uses instanceIndex for per-instance seed → unique pulse phase
```

**Mushroom interactions:**
- Proximity glow: mushrooms within 50 units of each other have +20% emissive (via proximity uniform array or compute)
- Chain reaction: game events cause cascading glow waves through mycelium (Phase 2 compute)
- Spore emission: small spore burst from cap area on PIECE_LOCK (spawn point near cap position)

#### 3.4 - Crystal Formation Upgrade

**3 crystal types:**

| Type | Geometry | Size | Placement | Count (High) |
|------|----------|------|-----------|---------------|
| **Pillar Crystal** | Hexagonal CylinderGeometry, pointed top | H: 40-100 | Floor, clusters of 4-8 | 5 clusters |
| **Ceiling Crystal** | Inverted pointed hex cylinder | H: 20-60 | Hanging from ceiling | 8-12 |
| **Micro-Crystal** | InstancedMesh, tiny hex prisms | H: 2-5 | Embedded in rock surfaces | 200-500 instances |

**Crystal material (MeshPhysicalNodeMaterial):**
- High transmission (0.7-0.9) for glass-like transparency
- Internal energy: animated emissive gradient that flows upward through crystal body
  ```
  energyFlow = sin(positionLocal.y * 0.05 - uTime * 2.0) * 0.5 + 0.5
  emissive = mix(deepAqua, primaryGlow, energyFlow) * intensity
  ```
- Fresnel rim: `pow(1.0 - abs(dot(normal, viewDir)), 4.0)` with clamped max (0.6) to prevent whiteout
- IOR 1.8 for crystal-appropriate refraction
- Thickness gradient: thin at edges (bright transmission), thick at center (deep color)

**Micro-crystals via InstancedMesh:**
- 200-500 tiny hex prisms (quality-scaled)
- Random position/rotation/scale via InstancedBufferAttribute
- Material uses `instanceIndex` for per-crystal phase offset → twinkling effect
- Placed on terrain surface vertices and wall surfaces

#### 3.5 - Mycelium Network (Signature Visual)

**The defining feature** that separates this from a generic glowing cave:

- Underground network of glowing thread-like connections between mushrooms
- Implemented as thin `TubeGeometry` (radius 0.3-0.8) paths between nearby mushroom bases
- Network topology: connect each mushroom to its 2-3 nearest neighbors (Delaunay-like, but simpler)
- Paths follow terrain surface (sample `getTerrainHeight` along path)
- Slight random offset to avoid perfectly straight lines (CatmullRomCurve3 with jittered midpoints)
- Material: `MeshBasicNodeMaterial` with additive blending
  - Base glow: faint Accent Cool (`#0088AA`) at 20% brightness
  - Pulse wave: when game event fires, bright Primary Glow wave travels along tube from source
  - Animated brightness from `MyceliumPulseCompute` buffer (WebGPU) or CPU sine animation (WebGL)
  - Animated UV scroll for "energy flowing through veins" effect
- Partially visible through slightly transparent terrain (emissive cracks in terrain material align with mycelium paths)

**WebGL fallback:** Static glowing tubes with sine-animated brightness (no compute propagation, simpler but still visible)

#### 3.6 - Flora & Organic Details

**Glowing vines overhaul:**
- Thicker, more organic vine shapes with CatmullRomCurve3 branching
- Animated bioluminescent veins: UV-scrolling emissive pattern along vine surface
- Glowing seed pods at vine tips: small SphereGeometry with strong emissive pulse
- Some vines partially submerged in water (glow visible through water transmission)

**Moss patches (InstancedMesh):**
- Flat disc geometry scattered on floor/walls (50-100 instances, quality-scaled)
- Emissive Phosphor Green with breathing animation (sine-based emissive intensity cycle, per-instance phase offset)
- Placed at terrain vertices where height is near water level (damp areas)

**Hanging tendrils from ceiling:**
- Thin TubeGeometry strands (4-8) hanging from ceiling
- Gentle pendulum sway animation
- Bright glow orb at tip (SphereGeometry, strong emissive)

**Floating jellyfish (WebGPU Extreme/Ultra only):**
- 2-4 ethereal translucent creatures drifting slowly through cave air
- SphereGeometry (bell) + trailing TubeGeometry tentacles
- MeshPhysicalNodeMaterial with high transmission for ghostly look
- Slow sine-based bob + drift movement
- Pulsing glow cycle (brighter on contraction, dimmer on expansion)

**Acceptance Criteria:**
- Cave feels like a vast, deep, alive bioluminescent world
- Multiple layers of depth (foreground, midground, background)
- Water is a stunning centerpiece with visible subsurface glow
- At least 4 mushroom species and 3 crystal types
- Mycelium network visibly connects organisms with animated glow
- Micro-crystals and moss patches use InstancedMesh efficiently
- All new elements use TSL materials on WebGPU, fallback GLSL on WebGL

---

### Phase 4: Advanced Lighting & Atmosphere
**Priority: HIGH | Estimated Complexity: Medium**

#### 4.1 - Volumetric Atmosphere

**Volumetric fog (TSL material on large sphere/box):**
- Height-based density: denser near water (y < -30), thinner above (y > 100)
- Color-graded: teal near emissive sources, deep navy in dark areas
- Animated wisps: slow 3D noise displacement (`noise3D` from library)
- Render as large semi-transparent sphere with ray-march approximation in fragment:
  ```
  // Simple fog volume (not true ray march, just height-based density)
  fogDensity = exp(-positionWorld.y * 0.005) * 0.3
  fogColor = mix(abyssNavy, deepAqua, fogDensity)
  ```

**God rays / light shafts (enhanced from current light cones):**
- Keep cone geometry approach but use TSL material:
  - Animated intensity: slow sine pulse with per-cone phase offset
  - Dust motes within shaft: small PointsNodeMaterial particles constrained to cone volume
  - Color tinted by nearest bioluminescent source
  - Opacity varies with height (brighter at ceiling opening, fading toward floor)
- 4-8 cones (quality-scaled), placed at ceiling openings

#### 4.2 - Dynamic Light Interaction

**Emissive-driven point lights (quality-gated):**
- Only on High+ quality presets
- 1 PointLight per Giant Ancient Mushroom (colored, radius 200, intensity 0.5)
- 1 PointLight per Pillar Crystal cluster (colored, radius 150, intensity 0.3)
- Dynamic count from `qualityPreset.pointLightCount`
- Animate light intensity in sync with object emissive pulse
- **Medium and below:** No dynamic point lights, rely entirely on hemisphere + directional + emissive materials

**Enhanced ambient lighting:**
- HemisphereLight: sky=`#206060` (cool), ground=`#0A2020` (very dark), intensity 0.3
- Single directional light from front-above as fill (intensity 0.2)
- No rim/back lights (cave shouldn't have light from behind)

#### 4.3 - Atmospheric Particles

**Dust motes** (GPU compute on WebGPU, simplified CPU on WebGL):
- 500-2000 tiny particles (quality-scaled)
- Very slow drift, barely visible
- Catch light from nearby emissive sources (brightness based on proximity to mushrooms)
- Nearly invisible in dark areas, become visible when near glow sources

**Water vapor** (WebGPU Extreme/Ultra only):
- Subtle mist rising from water surface
- 200-500 particles constrained to y: -52 to -20, within water radius
- Very low opacity (0.05-0.1), additive blending
- Slow upward drift with slight horizontal wander

**Acceptance Criteria:**
- Atmosphere feels thick and mysterious
- Light interacts believably with bioluminescent sources
- God rays add drama without overwhelming the scene
- Performance remains smooth at target quality levels
- Dynamic point lights only on quality presets that can afford them

---

### Phase 5: Post-Processing & Visual Polish
**Priority: HIGH | Estimated Complexity: Medium**

> **Note:** Elevated from MEDIUM to HIGH priority. MRT emissive bloom is the single biggest visual upgrade - it prevents rock/non-glowing surfaces from blooming while making bioluminescent objects glow beautifully. This alone transforms the scene.

#### 5.1 - WebGPU Post-Processing Chain (`bioluminescence-post.js`)

```
Scene Pass (MRT: output + emissive)
  → Emissive Bloom (isolated bloom from emissive channel only)
      strength: 0.35-0.5 (quality-scaled)
      radius: 0.3
      threshold: 0.1 (low threshold since emissive channel is already isolated)
  → Combine: sceneColor + bloomResult
  → Chromatic Aberration (very subtle: 0.0003, increases during combos)
  → Vignette (strong: 0.7 intensity, cave-appropriate dark edges)
  → Color Grading:
      shadows: push toward Abyss Navy (#020810)
      midtones: slight teal shift
      highlights: pull toward White-Cyan (#CCFFFF)
      contrast: 1.15
      saturation: 1.1 (slightly enhanced for bioluminescent vibrancy)
  → Depth of Field (Extreme/Ultra only):
      focus distance: 200 (mid-ground)
      bokeh intensity: subtle
  → Film Grain (Extreme/Ultra only):
      intensity: 0.02 (barely perceptible, adds organic texture)
  → Tone Mapping: ACES Filmic, exposure 1.1-1.3
  → Dithering (always: prevents banding in dark areas)
```

**Dynamic post-processing uniforms exposed for game events:**
- `uBloomBoost` - increases during combos (0 → 0.3)
- `uChromaticBoost` - increases during Tetris events (0 → 0.001)
- `uExposure` - subtle flash on line clear (1.2 → 1.5 → 1.2 decay)
- `uVignetteIntensity` - relaxes during high combos (0.7 → 0.4)

#### 5.2 - WebGL Post-Processing Fallback
- `EffectComposer` with:
  - `RenderPass`
  - `UnrealBloomPass` (strength: 0.3, radius: 0.2, threshold: 0.85 - higher threshold since no MRT isolation)
  - `ShaderPass(VignetteShader)` - dark cave edges
  - `ShaderPass(ColorGradeShader)` - teal shadow push, cyan highlight pull
- 4 passes total (lean for performance)
- Still looks good - bloom catches bright emissive objects, vignette sells the cave

#### 5.3 - Color Grading & Tone (Art Direction)
- **Shadows:** Deep navy-black (#020810) - never pure black, always hint of blue
- **Midtones:** Teal-shifted, organic warmth in greens
- **Highlights:** White-cyan (#CCFFFF) - bioluminescent peaks feel ethereal
- **Contrast:** 1.15 - dramatic light/dark separation essential for cave mood
- **Saturation:** 1.1 - slightly enhanced, bioluminescence should feel vivid
- **Dithering:** Always enabled to eliminate dark-area banding (critical for this theme)

**Acceptance Criteria:**
- MRT bloom isolates only emissive objects (mushrooms/crystals glow, rock doesn't bloom)
- Post-processing chain is quality-gated (fewer passes on lower presets)
- Color grading creates cohesive, cinematic bioluminescent mood
- No banding artifacts in dark areas
- Dynamic bloom/exposure changes are smooth and satisfying during game events

---

### Phase 6: Game Event Reactions & Polish
**Priority: MEDIUM | Estimated Complexity: Low-Medium**

#### 6.1 - Event Response System

| Event | Visual Response | Duration |
|-------|----------------|----------|
| **PIECE_LOCK** | Nearest 3 mushrooms pulse +30% emissive; small spore burst (10 particles) from nearest mushroom | 0.3s decay |
| **LINE_CLEAR** | Water surface ripple wave (expanding ring); all mushrooms pulse +50%; mycelium glow wave from center outward | 0.8s decay |
| **COMBO (1-3)** | All bioluminescence +20% per combo; spore emission rate 2x; crystal flare pulse; post-processing bloom boost | Sustained while combo active, 1s decay |
| **COMBO (4+)** | Above + god ray intensity 2x; fireflies swarm toward center; water glow intensifies; dust motes become visible | Sustained, 1.5s decay |
| **TETRIS (4-line)** | Major shockwave: all mushrooms flash to 100% simultaneously; massive spore burst (100 particles) from every mushroom cap; crystal resonance ring (expanding emissive ring geometry); water splash ripple; exposure flash (1.5 → 1.2); camera micro-shake (±2px, 0.3s) | 2s decay |

**Implementation:** Each event handler sets target intensity values. Animation loop decays them smoothly (`pulseIntensity *= 0.96`). Uniform updates propagate to all materials.

#### 6.2 - Ambient Animation Polish (Idle State)

Even when no game events are firing, the cave should feel alive:

- **Organic breathing:** All emissive intensities have base sine cycle (period 4-8s, amplitude ±10%)
- **Mushroom sway:** Gentle rotation (existing, keep but sync phases for "cave breeze" feel)
- **Water shimmer:** Continuous ripple animation (existing shore shader, keep)
- **Firefly wandering:** Constant background movement (from compute)
- **Periodic cave life events** (random, every 10-30s):
  - Distant mushroom flash: background layer briefly brightens at random point
  - Water disturbance: single large ripple as if something moved beneath surface
  - Firefly congregation: 3-5 fireflies briefly cluster then disperse
  - Spore gust: wind briefly increases, spores drift sideways

#### 6.3 - Performance Optimization

- **Frustum culling:** Automatic via Three.js, ensure no `frustumCulled = false` on standard meshes
- **LOD for mushrooms:** Giant mushrooms get 2 LOD levels (full detail < 300 units, simplified > 300)
- **InstancedMesh everywhere possible:** Micro-crystals, moss patches, cluster mushrooms, rubble, dust motes
- **Compute workgroup sizing:** 64 invocations per workgroup (standard for most GPUs)
- **Texture reuse:** Share PBR textures across similar materials (all mushroom caps share textures)
- **Shader compilation caching:** Materials created once, uniforms updated per frame
- **Frame budget monitoring:** Track render time, auto-reduce spore count if frame time > 18ms

**Acceptance Criteria:**
- Game events create satisfying, visible, layered reactions in the environment
- Combo intensity scaling is clearly visible and rewarding
- TETRIS event is spectacular and memorable
- Animation feels alive and organic even during idle
- Stable 60fps at High quality on mid-range desktop GPU (GTX 1060 / RX 580)

---

### Phase 7: Quality Presets & Final Tuning
**Priority: LOW | Estimated Complexity: Low**

#### 7.1 - Quality Preset Scaling
```javascript
const QUALITY_PRESETS = {
    Extreme: {
        // Scene objects
        mushroomCount: 25, crystalClusterCount: 8, ceilingCrystalCount: 12,
        stalactiteCount: 15, vineCount: 12, tendrilCount: 8,
        // Instanced elements
        microCrystalCount: 500, mossPatchCount: 100, rubbleCount: 60,
        // Particles (GPU compute on WebGPU, CPU on WebGL)
        sporeCount: 3000, fireflyCount: 200, dustMoteCount: 2000, vaporCount: 500,
        // WebGPU-exclusive features
        enableCompute: true, enableCaustics: true, enableMyceliumPulse: true,
        enableJellyfish: true, jellyfishCount: 4,
        // Post-processing
        enableMRT: true, bloomStrength: 0.5, enableSSAO: false,
        enableDoF: true, enableFilmGrain: true,
        // Lighting
        pointLightCount: 8,
        // Background layers
        backgroundLayers: 3,
    },
    Ultra: {
        mushroomCount: 20, crystalClusterCount: 6, ceilingCrystalCount: 10,
        stalactiteCount: 12, vineCount: 10, tendrilCount: 6,
        microCrystalCount: 300, mossPatchCount: 80, rubbleCount: 40,
        sporeCount: 2000, fireflyCount: 150, dustMoteCount: 1500, vaporCount: 300,
        enableCompute: true, enableCaustics: true, enableMyceliumPulse: true,
        enableJellyfish: true, jellyfishCount: 2,
        enableMRT: true, bloomStrength: 0.45, enableSSAO: false,
        enableDoF: false, enableFilmGrain: true,
        pointLightCount: 6,
        backgroundLayers: 3,
    },
    High: {
        mushroomCount: 15, crystalClusterCount: 5, ceilingCrystalCount: 8,
        stalactiteCount: 8, vineCount: 8, tendrilCount: 4,
        microCrystalCount: 200, mossPatchCount: 50, rubbleCount: 25,
        sporeCount: 1000, fireflyCount: 100, dustMoteCount: 1000, vaporCount: 0,
        enableCompute: true, enableCaustics: false, enableMyceliumPulse: false,
        enableJellyfish: false, jellyfishCount: 0,
        enableMRT: true, bloomStrength: 0.4, enableSSAO: false,
        enableDoF: false, enableFilmGrain: false,
        pointLightCount: 5,
        backgroundLayers: 2,
    },
    Medium: {
        mushroomCount: 10, crystalClusterCount: 3, ceilingCrystalCount: 4,
        stalactiteCount: 5, vineCount: 6, tendrilCount: 2,
        microCrystalCount: 100, mossPatchCount: 30, rubbleCount: 15,
        sporeCount: 500, fireflyCount: 50, dustMoteCount: 500, vaporCount: 0,
        enableCompute: false, enableCaustics: false, enableMyceliumPulse: false,
        enableJellyfish: false, jellyfishCount: 0,
        enableMRT: false, bloomStrength: 0.3, enableSSAO: false,
        enableDoF: false, enableFilmGrain: false,
        pointLightCount: 3,
        backgroundLayers: 1,
    },
    Low: {
        mushroomCount: 6, crystalClusterCount: 2, ceilingCrystalCount: 2,
        stalactiteCount: 3, vineCount: 4, tendrilCount: 0,
        microCrystalCount: 0, mossPatchCount: 0, rubbleCount: 0,
        sporeCount: 200, fireflyCount: 0, dustMoteCount: 0, vaporCount: 0,
        enableCompute: false, enableCaustics: false, enableMyceliumPulse: false,
        enableJellyfish: false, jellyfishCount: 0,
        enableMRT: false, bloomStrength: 0.2, enableSSAO: false,
        enableDoF: false, enableFilmGrain: false,
        pointLightCount: 2,
        backgroundLayers: 1,
    },
    Minimal: {
        mushroomCount: 3, crystalClusterCount: 1, ceilingCrystalCount: 0,
        stalactiteCount: 0, vineCount: 2, tendrilCount: 0,
        microCrystalCount: 0, mossPatchCount: 0, rubbleCount: 0,
        sporeCount: 80, fireflyCount: 0, dustMoteCount: 0, vaporCount: 0,
        enableCompute: false, enableCaustics: false, enableMyceliumPulse: false,
        enableJellyfish: false, jellyfishCount: 0,
        enableMRT: false, bloomStrength: 0.15, enableSSAO: false,
        enableDoF: false, enableFilmGrain: false,
        pointLightCount: 1,
        backgroundLayers: 0,
    },
};
```

#### 7.2 - Debug URL Parameters
| Parameter | Effect |
|-----------|--------|
| `?forceWebGL=1` | Force WebGL renderer (skip WebGPU) |
| `?quality=extreme` | Override quality preset |
| `?debugGPU=1` | Show GPU compute stats overlay (particle count, frame time) |
| `?noPost=1` | Disable all post-processing |
| `?noCompute=1` | Disable GPU compute (CPU fallback for particles) |
| `?noBloom=1` | Disable bloom specifically |
| `?wireframe=1` | Wireframe mode for geometry debugging |

#### 7.3 - Final Art Direction Tuning Checklist
- [ ] Balance all glow intensities: no single element overwhelms others
- [ ] Verify color harmony: all sources within the defined palette
- [ ] Check brightness hierarchy matches Visual Hierarchy section
- [ ] Darkness is preserved: at least 40% of visible area should be very dark
- [ ] Bloom halos don't bleed excessively into dark areas
- [ ] Water reflections show nearby glow sources convincingly
- [ ] Mycelium network is visible but subtle (not competing with mushrooms)
- [ ] Crystal transmission shows internal color tint without whiteout
- [ ] Mushroom SSS visible from multiple camera angles
- [ ] Spores and fireflies have distinct movement patterns (not all the same)
- [ ] Game events are satisfying at all combo levels
- [ ] TETRIS event is the most spectacular moment in the scene
- [ ] WebGL fallback is still visually impressive (not just functional)
- [ ] Test on sRGB and wide-gamut monitors (P3)
- [ ] Test at 1080p, 1440p, and 4K resolutions
- [ ] No z-fighting between water surface and terrain
- [ ] No visible seams between cave wall sections

**Acceptance Criteria:**
- All quality presets work correctly and scale smoothly
- Debug parameters work for development and QA
- Visual quality on WebGL fallback is impressive
- Art direction checklist fully satisfied
- Theme is a stunning, world-class bioluminescent cave masterpiece

---

## Technical Reference

### TSL Mushroom Cap Material (Real SSS via MeshPhysicalNodeMaterial)
```javascript
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { Fn, uniform, uv, vec3, float, sin, cos, mix, smoothstep, pow,
         positionLocal, positionWorld, normalLocal, cameraPosition } from 'three/tsl';

export function createMushroomCapNodeMaterial(params = {}) {
    const material = new MeshPhysicalNodeMaterial({
        side: THREE.DoubleSide,
    });

    const uTime = uniform(0);
    const uPulseIntensity = uniform(0);

    // ── Subsurface Scattering via Physical Material ──
    // Transmission: light passes through thin organic material
    const edgeThinness = float(1.0).sub(uv().sub(0.5).length().mul(2.0).clamp(0, 1));
    material.transmissionNode = float(params.transmission ?? 0.4).mul(edgeThinness);
    material.thicknessNode = mix(float(0.5), float(3.0), edgeThinness); // Thin at edges, thick at center
    material.attenuationColor = new THREE.Color(params.attenuationColor ?? '#006655');
    material.attenuationDistance = params.attenuationDistance ?? 0.8;
    material.ior = params.ior ?? 1.4;

    // ── Organic Surface Pattern (Voronoi cells for gill structure) ──
    const uvScaled = uv().mul(float(params.voronoiScale ?? 8.0));
    const cellPattern = voronoi(uvScaled); // From noise library
    const normalPerturbation = cellPattern.distance.mul(0.3);
    // Apply as subtle normal variation
    material.normalNode = normalLocal.add(vec3(normalPerturbation, normalPerturbation, 0.0)).normalize();

    // ── Animated Emissive Glow ──
    const pulse = sin(uTime.mul(params.pulseSpeed ?? 2.0).add(positionWorld.x.mul(0.1))).mul(0.3).add(0.7);
    const comboBoost = uPulseIntensity.mul(1.5);
    const finalPulse = pulse.mul(float(1.0).add(comboBoost));

    const glowColor = vec3(...(params.emissiveRGB ?? [0.0, 1.0, 0.83])); // #00FFD4
    material.emissiveNode = glowColor.mul(float(params.baseEmissive ?? 0.4).mul(finalPulse));

    // ── Iridescence (view-angle color shift) ──
    const viewDir = cameraPosition.sub(positionWorld).normalize();
    const fresnel = float(1.0).sub(normalLocal.dot(viewDir).abs()).pow(3.0);
    const iridescentShift = vec3(fresnel.mul(0.1), 0.0, fresnel.mul(-0.05));
    material.emissiveNode = material.emissiveNode.add(iridescentShift.mul(finalPulse));

    // ── PBR Properties ──
    material.roughnessNode = float(params.roughness ?? 0.3);
    material.metalnessNode = float(0.0);

    return { material, uniforms: { uTime, uPulseIntensity } };
}
```

### GPU Compute Pattern (Interleaved State Buffer)
```javascript
import { StorageBufferAttribute } from 'three';
import { Fn, storage, instanceIndex, vertexIndex, uniform, vec4, float, sin, cos, fract } from 'three/tsl';

export class SporeCompute {
    constructor(count) {
        this.count = count;
        // Interleaved: [pos.xyz + life, vel.xyz + seed] per particle
        this.stateData = new Float32Array(count * 2 * 4); // 2 vec4s per particle

        // Initialize particle data
        for (let i = 0; i < count; i++) {
            const base = i * 8;
            this.stateData[base + 0] = (Math.random() - 0.5) * 800;  // x
            this.stateData[base + 1] = Math.random() * 300 - 100;     // y
            this.stateData[base + 2] = (Math.random() - 0.5) * 600;   // z
            this.stateData[base + 3] = Math.random();                  // life (0-1)
            this.stateData[base + 4] = (Math.random() - 0.5) * 0.5;   // vx
            this.stateData[base + 5] = 0.5 + Math.random() * 1.0;     // vy (upward)
            this.stateData[base + 6] = (Math.random() - 0.5) * 0.5;   // vz
            this.stateData[base + 7] = Math.random();                  // seed
        }

        this.stateBuffer = new StorageBufferAttribute(this.stateData, 4);
        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uWindDir = uniform(new THREE.Vector2(0, 0));
    }

    createComputeNode() {
        const state = storage(this.stateBuffer, 'vec4', this.count * 2);

        const computeFn = Fn(() => {
            const posLife = state.element(instanceIndex.mul(2));
            const velSeed = state.element(instanceIndex.mul(2).add(1));

            // Read current state
            const pos = posLife.xyz;
            const life = posLife.w;
            const vel = velSeed.xyz;
            const seed = velSeed.w;

            // Decay life
            const newLife = life.sub(this.uDelta.mul(0.05));

            // Apply forces: upward drift + noise turbulence + wind
            const turbulence = vec3(
                sin(pos.y.mul(0.01).add(this.uTime).add(seed.mul(100.0))).mul(0.3),
                float(0.0),
                cos(pos.x.mul(0.01).add(this.uTime.mul(0.7)).add(seed.mul(50.0))).mul(0.2)
            );
            const wind = vec3(this.uWindDir.x, 0.0, this.uWindDir.y).mul(0.1);
            const newVel = vel.add(turbulence.add(wind).mul(this.uDelta));

            // Update position
            const newPos = pos.add(newVel.mul(this.uDelta));

            // Respawn dead particles at random terrain position
            // (life <= 0 or above ceiling)
            const shouldRespawn = newLife.lessThan(0.0).or(newPos.y.greaterThan(400.0));
            const respawnPos = vec3(
                fract(seed.mul(127.1)).mul(800.0).sub(400.0),
                float(-50.0), // Terrain level
                fract(seed.mul(311.7)).mul(600.0).sub(300.0)
            );

            posLife.assign(vec4(
                mix(newPos, respawnPos, float(shouldRespawn)),
                mix(newLife, float(1.0), float(shouldRespawn))
            ));
        })().compute(this.count);

        return computeFn;
    }

    getStateBuffer() { return this.stateBuffer; }
}
```

### Post-Processing Pattern (WebGPU with MRT)
```javascript
import { PostProcessing } from 'three/webgpu';
import { pass, mrt, bloom, uniform, Fn, vec3, vec4, float, mix, pow, clamp, dot } from 'three/tsl';
import { output, emissive } from 'three/tsl';

export class BioluminescencePost {
    constructor(renderer, scene, camera, params = {}) {
        this.postProcessing = new PostProcessing(renderer);

        // ── Scene pass with MRT ──
        this.scenePass = pass(scene, camera);
        if (params.useMRT !== false) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = params.useMRT !== false
            ? this.scenePass.getTextureNode('emissive')
            : sceneColor;

        // ── Emissive Bloom (isolated) ──
        this.uBloomStrength = uniform(params.bloomStrength ?? 0.4);
        this.uBloomBoost = uniform(0); // Game event boost
        const totalBloom = this.uBloomStrength.add(this.uBloomBoost);
        this.bloomNode = bloom(bloomSource, totalBloom, params.bloomRadius ?? 0.3, params.bloomThreshold ?? 0.1);

        let combined = sceneColor.add(this.bloomNode);

        // ── Chromatic Aberration ──
        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.0003);
        // Simple chromatic: offset R and B channels slightly
        // (Implemented as UV offset sampling - simplified here)

        // ── Vignette ──
        this.uVignetteIntensity = uniform(params.vignetteIntensity ?? 0.7);
        const vignetteUV = this.scenePass.getTextureNode('output'); // UV from pass
        // Vignette: darken edges based on distance from center
        // combined = combined.mul(vignetteFactor);

        // ── Color Grading ──
        this.uExposure = uniform(params.exposure ?? 1.2);
        const exposed = combined.mul(this.uExposure);

        // Shadow push toward navy, highlight pull toward cyan
        const shadowColor = vec3(0.008, 0.03, 0.06); // Abyss Navy
        const highlightColor = vec3(0.8, 1.0, 1.0);  // White-Cyan
        const luminance = dot(exposed.rgb, vec3(0.299, 0.587, 0.114));
        const graded = mix(
            mix(shadowColor, exposed.rgb, pow(luminance, 0.8)),
            mix(exposed.rgb, highlightColor, pow(luminance, 2.0)),
            luminance
        );

        // ── Tone Mapping (ACES Filmic) ──
        const toned = acesToneMapping(vec4(graded, 1.0));

        // ── Dithering ──
        // Add subtle noise to prevent banding in dark areas
        const dithered = toned; // + tiny noise offset

        this.postProcessing.outputNode = dithered;
    }

    setBloomBoost(value) { this.uBloomBoost.value = value; }
    setExposure(value) { this.uExposure.value = value; }
    setVignetteIntensity(value) { this.uVignetteIntensity.value = value; }

    render() { this.postProcessing.render(); }

    dispose() {
        this.postProcessing.dispose();
    }
}
```

---

## Resource Disposal Order (Critical for WebGPU)

Proper cleanup prevents GPU memory leaks and device-lost errors:

```javascript
cleanup() {
    this.stop(); // Stop animation loop

    // 1. Dispose compute nodes first (release GPU compute pipelines)
    if (this.sporeCompute) this.sporeCompute.dispose();
    if (this.fireflyCompute) this.fireflyCompute.dispose();
    if (this.myceliumCompute) this.myceliumCompute.dispose();

    // 2. Dispose post-processing (release render targets)
    if (this.postProcessing) this.postProcessing.dispose();
    if (this.composer) this.composer.dispose();

    // 3. Dispose scene objects (geometry + materials + textures)
    this.scene.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (child.material.map) child.material.map.dispose();
            // ... dispose all texture maps
            child.material.dispose();
        }
    });

    // 4. Dispose renderer last
    if (this.renderer) this.renderer.dispose();

    // 5. Null references
    this.scene = null;
    this.camera = null;
    this.renderer = null;

    super.cleanup();
}
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| WebGPU not available | Silent WebGL fallback with `this.isWebGPU` gate; WebGL path is still visually impressive |
| MeshPhysicalNodeMaterial too expensive | Quality-gate transmission features (High+ only); Medium/Low use MeshStandardNodeMaterial |
| GPU compute too slow | Quality presets scale particle counts; CPU fallback path for WebGL |
| Too many draw calls | InstancedMesh for micro-crystals, moss, cluster mushrooms, rubble |
| Memory pressure | Proper disposal order (compute → post → scene → renderer); share textures |
| Visual regression | Side-by-side comparison at each phase; WebGL path preserved and tested |
| Device loss | `renderer.onDeviceLost` handler with graceful recovery |
| Browser compatibility | Test Chrome 113+, Firefox 120+, Edge 113+ (WebGPU); all browsers (WebGL) |
| Mycelium network too complex | Simplify to static tubes with animated emissive on Medium/Low; full compute on High+ |
| Shader compilation stutter | Create all materials during `createScene()` before first frame; progressive scene build |

---

## Phase Dependency Graph

```
Phase 1 (Foundation) ──┬──> Phase 2 (GPU Compute + Mycelium)
                       │
                       ├──> Phase 3 (Environment + World Building)
                       │
                       └──> Phase 5 (Post-Processing) ◄── HIGH PRIORITY
                                                          (do alongside Phase 3)

Phase 2 + 3 ──> Phase 4 (Lighting & Atmosphere)

Phase 2 + 3 + 4 + 5 ──> Phase 6 (Events & Polish)

Phase 6 ──> Phase 7 (Quality & Tuning)
```

**Parallel tracks after Phase 1:**
- Track A: Phase 2 (compute) + Phase 4 (lighting) - systems work
- Track B: Phase 3 (environment) - art/geometry work
- Track C: Phase 5 (post-processing) - render pipeline work

---

## Success Metrics

| Metric | Target |
|--------|--------|
| **Visual Impact** | First reaction should be "wow" - cave feels like a living, breathing bioluminescent world |
| **Signature Moment** | Mycelium glow wave on TETRIS event is memorable and shareable |
| **Performance (WebGPU)** | 60fps at High quality on GTX 1060 / RX 580 equivalent |
| **Performance (WebGL)** | 60fps at Medium quality on GTX 1060 / RX 580 equivalent |
| **Fallback Quality** | WebGL path is visually impressive, not just functional |
| **Code Quality** | Clean modular architecture matching Black Hole theme pattern (4 files) |
| **Correctness** | No console errors, clean init/cleanup, no memory leaks, no z-fighting |
| **Darkness Ratio** | At least 40% of visible screen area is very dark (bioluminescence needs darkness) |
| **Color Accuracy** | All emissive sources within the defined 8-color palette |
