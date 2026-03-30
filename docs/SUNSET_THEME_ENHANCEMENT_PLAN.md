# Sunset Theme Cinematic Enhancement Plan

> Transform the sunset theme into a high-fidelity, magical-realist cinematic experience.

---

## Phase 1: Atmospheric Physics — Physically Based Sky

### Current State
- Simple gradient-based sky shader with day/night color blending

### Enhancements

#### 1.1 Rayleigh & Mie Scattering
Implement procedural atmospheric scattering for realistic horizon gradients:

```glsl
// Rayleigh scattering (blue sky) + Mie scattering (sun haze)
vec3 rayleigh = betaR * exp(-altitude * scaleHeight_R) * phase_R;
vec3 mie = betaM * exp(-altitude * scaleHeight_M) * phase_M;
vec3 skyColor = (rayleigh + mie) * sunIntensity;
```

**Files to modify:** `sunset-shaders.js` → `skyFragmentShader`

#### 1.2 HSL Color Lerping for Time Transitions
Replace RGB lerping with HSL interpolation for smoother color transitions:
- **Golden Hour**: Warm oranges/pinks (H: 20-40°)
- **Blue Hour**: Deep indigos/purples (H: 220-260°)

**Implementation:** Create `lerpHSL()` helper in shaders

---

## Phase 2: Celestial Visuals

### 2.1 Stunning Moon Transformation 🌙

**Goal:** Create a breathtaking, photorealistic moon that captivates viewers.

#### Surface Detail
| Feature | Technique | Implementation |
|---------|-----------|----------------|
| **Mare Texture** | High-res moon albedo map | Load `moon-albedo.jpg`, UV-map to sphere |
| **Crater Normal Map** | Bump mapping for 3D depth | Normal map for crater shadows/highlights |
| **Surface Variation** | Subtle color variation | Mix gray tones with slight warm/cool patches |

#### Atmospheric & Glow Effects
| Feature | Technique | Implementation |
|---------|-----------|----------------|
| **Soft Corona Glow** | Multi-layer Fresnel rim | 3 glow layers at different radii, additive blend |
| **Atmospheric Haze** | Gradient edge softening | Fade moon edge into sky for realism |
| **Bloom Interaction** | UnrealBloomPass pickup | Moon brightness tuned to bloom threshold |

#### Lighting Effects
| Feature | Technique | Description |
|---------|-----------|-------------|
| **Earthshine** | Reflected Earth light | Subtle blue-gray illumination on dark limb (5-10%) |
| **Terminator Line** | Day/night boundary | Soft shadow gradient across moon face |
| **Specular Highlights** | Glint on bright regions | Subtle bright spots on Mare edges |

#### Magical Enhancements
| Feature | Technique | Description |
|---------|-----------|-------------|
| **Shimmer Animation** | Noise-based brightness variation | Gentle twinkling effect |
| **Color Temperature** | Time-based tint | Warmer near horizon, cooler high in sky |
| **Halo Rings** | Concentric gradient rings | Subtle atmospheric refraction effect |
| **Star Occlusion** | Fade nearby stars | Stars dim within moon's glow radius |

#### Shader Snippet
```glsl
// Fresnel corona with multiple layers
float fresnel = pow(1.0 - dot(viewDir, normal), 3.0);
vec3 corona = moonGlowColor * fresnel * 0.8;

// Earthshine on dark side
float darkSide = 1.0 - max(dot(sunDir, normal), 0.0);
vec3 earthshine = skyAmbientColor * darkSide * 0.08;

// Final moon color
vec3 moonColor = albedo * sunLight + earthshine + corona;
```

**Files:** `moonVertexShader`, `moonFragmentShader` in `sunset-shaders.js`

### 2.2 Volumetric God Rays (Crepuscular Rays)
Replace current plane-based god rays with ray-marched volumetric scattering:

```javascript
// Render pipeline:
1. Render scene to occlusionTarget (sun = white, rest = black)
2. Ray-march from each fragment toward sun screen position
3. Accumulate light samples where not occluded
4. Blend as additive post-process pass
```

**New files needed:**
- `VolumetricGodRays.js` - Ray-march shader & pass
- Update `EffectComposer` pipeline

---

## Phase 3: Magic Water Upgrade

### Current State (SunsetOceanWater)
- Mirror camera reflections ✅
- Multi-layer wave displacement ✅
- Sun/moon reflection paths ✅

### Enhancements

#### 3.1 High-Resolution Normal Maps
- Add secondary normal map layer at 4x detail scale
- Blend based on camera distance for LOD

#### 3.2 Bioluminescent Foam Shader
Add Perlin noise-driven teal foam at wave crests:

```glsl
float foam = smoothstep(0.3, 0.8, vElevation);
float noise = perlin3D(worldPosition * 0.1 + time * 0.5);
foam *= noise;
vec3 bioFoam = vec3(0.2, 0.9, 0.8) * foam * 0.5; // Teal glow
```

**Files:** `SunsetOceanWater.js` fragment shader

---

## Phase 4: Post-Processing Stack (EffectComposer)

### Required Passes

| Pass | Purpose | Settings |
|------|---------|----------|
| **UnrealBloomPass** | Star/sun light bleed | threshold: 0.9, strength: 0.6, radius: 0.4 |
| **ToneMappingPass** | ACES Filmic HDR | THREE.ACESFilmicToneMapping |
| **ChromaticAberration** | Dreamlike lens effect | offset: 0.001 at edges |
| **BokehPass** | Horizon blur | focus: horizon distance, aperture: 0.025 |

### Implementation
```javascript
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';

// Custom passes needed:
- ChromaticAberrationShader (screen-space UV offset)
- ACES ToneMapping (if not using renderer.toneMapping)
```

---

## Phase 5: Particles & Dynamic Fog

### 5.1 Light Motes (InstancedMesh)
Replace Points with InstancedMesh for GPU efficiency:
- **Count:** 500-2000 particles
- **Motion:** Noise-driven turbulence field (simplex 3D)
- **Color:** Match time-of-day palette

```javascript
const dummy = new THREE.Object3D();
const mesh = new THREE.InstancedMesh(geometry, material, count);

// Update in animate():
noiseField.sample(particle.position, time);
dummy.position.add(velocity);
mesh.setMatrixAt(i, dummy.matrix);
```

### 5.2 Dynamic Fog (FogExp2)
- **Density:** Thicker at dawn/dusk, lighter at noon
- **Color:** Interpolate with sky horizon color

```javascript
scene.fog = new THREE.FogExp2(horizonColor, density);
// Update each frame:
scene.fog.color.copy(currentHorizonColor);
scene.fog.density = lerp(0.002, 0.008, fogIntensityByTime);
```

---

## Phase 6: WebGPU / TSL Preparation

### TSL (Three.js Shading Language) Compatibility
For future WebGPU renderer support:

- Convert GLSL shaders to TSL node-based syntax
- Use `MeshStandardNodeMaterial` where applicable
- Reference: `three/examples/jsm/nodes/`

> **Note:** TSL is still experimental. Implement GLSL first, add TSL as progressive enhancement.

---

## Implementation Priority

| Priority | Phase | Effort | Visual Impact |
|----------|-------|--------|---------------|
| 🟢 **1** | Post-Processing (Bloom + Tone) | Medium | High |
| 🟢 **2** | Magic Water (Foam) | Low | Medium |
| 🟡 **3** | Atmospheric Scattering | High | Very High |
| 🟡 **4** | Volumetric God Rays | High | High |
| 🟡 **5** | Particles (InstancedMesh) | Medium | Medium |
| 🔵 **6** | Moon Corona/Earthshine | Low | Medium |
| 🔵 **7** | Dynamic Fog | Low | Low-Medium |
| ⚪ **8** | TSL/WebGPU | High | Future-proofing |

---

## Performance Considerations

- **Quality Presets:** Add "Ultra" and "Cinematic" tiers
- **Bloom:** Disable on Low quality
- **God Rays:** Reduce ray-march steps on Medium/Low
- **Particles:** Scale count with quality level
- **Render Scale:** 0.75x on lower presets

---

## Dependencies

```bash
# Already available in three.js examples:
three/examples/jsm/postprocessing/EffectComposer
three/examples/jsm/postprocessing/RenderPass
three/examples/jsm/postprocessing/UnrealBloomPass
three/examples/jsm/postprocessing/ShaderPass
three/examples/jsm/postprocessing/BokehPass

# May need custom implementation:
- ChromaticAberrationShader
- VolumetricGodRaysPass
- Perlin noise functions (already have in misty-lake)
```
