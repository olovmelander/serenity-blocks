# Intro Animation WebGPU Upgrade Plan

## Overview

Migrate the intro animation from Three.js WebGL (`THREE.WebGLRenderer` + GLSL shaders) to Three.js WebGPU (`three/webgpu` + TSL compute shaders) for a world-class, high-performance game intro. The project already has 9 themes using WebGPU compute (e.g., black-hole, stellar-drift, shifting-sands), so the patterns and infrastructure are proven.

## Implementation Status (Updated February 16, 2026)

- Phase 1 (WebGPU migration): Implemented with async init + WebGL fallback.
- Phase 2 (GPU particle compute): Implemented with unified storage-buffer particle simulation.
- Phase 3 (GPU tetromino compute): Implemented with GPU-side physics/collision, delta-correct integration, true GPU-driven per-instance transforms (no per-frame CPU matrix sync path), and GPU-driven tetromino trail/collision-burst triggering.
- Phase 4 (visual enhancements): Largely implemented (strict volumetric-nebula path, god-ray style post pass, attraction field, tetromino trail particles, enhanced bloom dynamics, instanced glow outlines, constellation lines, film grain/color-grade polish, quality-aware DoF proxy + selective chromatic fringe).
- Phase 5 (performance optimization): Implemented with adaptive quality tiers, CSS particle/orb removal, background-mode throttling, visibility culling for tetromino instances, and improved destroy/disposal.
- Phase 6 (code cleanup): Implemented (dead code removal + obsolete files removed).
- Phase 7 (transition/polish): Largely implemented (warp-dismiss trigger path, WebAudio analyser-based music reactivity, background-only WebGPU budget mode, loading-mask integration with real init promise, CSS warp overlay transition).

---

## Current Architecture

### Files
| File | Lines | Role |
|------|-------|------|
| `src/ui/intro-animation.js` | 735 | State machine, DOM, event handling, CSS layers |
| `src/ui/threejs-intro-renderer.js` | 1,350 | Three.js WebGL scene, all 3D visuals |
| `public/styles/intro-animation.css` | 841 | CSS animations, title, overlays |

### Current Visual Elements
- **Star Field** - 3,000 `PointsMaterial` particles, CPU-positioned, additive blending
- **Nebula Particles** - 80 particles with GLSL `ShaderMaterial` (pulsing glow)
- **Sparkle Layer** - 100 twinkling particles with GLSL shader
- **Nebula Clouds** - 5 `PlaneGeometry` meshes with GLSL noise shader
- **Floating Tetrominos** - Up to 25 `ExtrudeGeometry` meshes, CPU physics (collision, bounce)
- **Shooting Stars** - 5 pooled trail particles with GLSL shader
- **Collision Effects** - 10 pooled burst particle systems
- **Lens Flare** - Disabled (code exists but never called)
- **Tetromino Trails** - Disabled (code exists but never called)
- **Post-Processing** - `EffectComposer` + `UnrealBloomPass` (half-res)

### Current Renderer
```
THREE.WebGLRenderer → EffectComposer → UnrealBloomPass → Screen
```

### CSS Overlay Layers (on top of WebGL canvas)
- 6 CSS background particles (float upward)
- 4 CSS orbs (screen blend mode, floating)
- Title with per-letter drop animation + glitch effect
- Shimmer sweep, chromatic aberration pulse, scanline overlay
- Vignette pseudo-element

---

## Phase 1: WebGPU Renderer Migration (Foundation)

### Goal
Replace `THREE.WebGLRenderer` with `THREE.WebGPURenderer` and convert all GLSL shaders to TSL.

### Tasks

#### 1.1 Swap Renderer
- Change `import * as THREE from 'three'` → `import * as THREE from 'three/webgpu'`
- Replace `new THREE.WebGLRenderer(...)` with `new THREE.WebGPURenderer(...)`
- Add `await renderer.init()` (WebGPU renderer requires async initialization)
- Update `intro-animation.js` to handle async renderer init
- Keep `antialias: true`, `powerPreference: 'high-performance'`
- Set pixel ratio cap at 1.5 (matches current behavior)

#### 1.2 Replace Post-Processing
- Remove `EffectComposer`, `RenderPass`, `UnrealBloomPass` (WebGL-only addons)
- Use `three/webgpu` built-in post-processing: `PostProcessing` class with `bloom()` from `three/tsl`
- This is simpler and faster than the WebGL addon pipeline

#### 1.3 Convert GLSL Shaders to TSL
All 4 custom `ShaderMaterial` instances must be converted to TSL `NodeMaterial`:

| Current (GLSL) | Convert To (TSL) |
|----------------|------------------|
| Nebula particle vertex/fragment | `SpriteNodeMaterial` with TSL size/color nodes |
| Sparkle layer vertex/fragment | `SpriteNodeMaterial` with TSL twinkle nodes |
| Nebula cloud vertex/fragment | `MeshBasicNodeMaterial` with TSL noise nodes |
| Shooting star trail vertex/fragment | `PointsNodeMaterial` with TSL alpha nodes |

#### 1.4 Material Upgrades
- Convert `MeshStandardMaterial` (tetrominos) to `MeshStandardNodeMaterial`
- Convert `PointsMaterial` (stars) to `PointsNodeMaterial`
- Convert `LineBasicMaterial` (tetromino edges) to `LineBasicNodeMaterial`
- Convert `MeshBasicMaterial` (trail particles) to `MeshBasicNodeMaterial`

#### 1.5 WebGL Fallback
- Add feature detection: `if (!navigator.gpu)` → fall back to current WebGL renderer
- Keep the existing `threejs-intro-renderer.js` as-is for fallback
- Create `threejs-intro-renderer-webgpu.js` as the new WebGPU version
- `intro-animation.js` chooses which renderer to instantiate

### Validation
- Visual parity with current intro on WebGPU-capable browsers
- Graceful WebGL fallback on older hardware
- No regressions in animation timing or interaction

---

## Phase 2: GPU Compute Particle Systems (Performance Revolution)

### Goal
Move all particle simulation to the GPU using TSL compute shaders, following the established pattern from `black-hole-compute.js`.

### Tasks

#### 2.1 Create `intro-particle-compute.js`
New file: `src/ui/intro-particle-compute.js`

Following the project's established compute pattern:
```javascript
import * as THREE from 'three/webgpu';
import { Fn, storage, uniform, instanceIndex, ... } from 'three/tsl';
```

**Unified Particle Buffer** (all particles in one compute dispatch):
- `positionBuffer` - `StorageBufferAttribute(Float32Array, 4)` - xyz + type
- `velocityBuffer` - `StorageBufferAttribute(Float32Array, 4)` - xyz + speed
- `lifeBuffer` - `StorageBufferAttribute(Float32Array, 4)` - life + rgb
- `miscBuffer` - `StorageBufferAttribute(Float32Array, 4)` - size + phase + random + active

**Particle Types** (encoded in position.w):
- `0` = Star (3,000 → increase to 10,000+)
- `1` = Nebula particle (80 → increase to 500+)
- `2` = Sparkle (100 → increase to 500+)
- `3` = Shooting star trail point
- `4` = Collision burst particle

Total budget: ~12,000 particles in single compute dispatch.

#### 2.2 GPU Star Field
- Move star positions/colors to `StorageBufferAttribute`
- Compute shader: gentle rotation + parallax depth movement
- Add subtle color shifting over time (aurora effect)
- Increase count from 3,000 → 10,000+ (GPU handles this trivially)

#### 2.3 GPU Nebula Particles
- Spiral galaxy distribution computed on GPU
- Pulsing size + color variation in compute shader
- Increase from 80 → 500+ particles
- Add attraction/repulsion forces for organic flow

#### 2.4 GPU Sparkle Layer
- Twinkle phase computed on GPU
- Random sparkle bursts (grouped flickering)
- Increase from 100 → 500+ sparkles

#### 2.5 GPU Shooting Stars
- Trail simulation entirely on GPU (no CPU position shifting)
- Increase trail length from 15 → 30+ points
- Add color gradient along trail (white → cyan → fade)
- Remove pool limit - GPU can handle many simultaneously

#### 2.6 GPU Collision Bursts
- Explosion particles simulated on GPU
- Add gravity pull back toward collision point (implode effect)
- More particles per burst (8 → 32+)
- Remove pool limit

### Validation
- FPS should be 60+ at all times (measure with `renderer.info`)
- Particle counts significantly higher with lower CPU usage
- GPU memory usage stays reasonable (~50MB max for intro)

---

## Phase 3: GPU Tetromino Physics (CPU Offload)

### Goal
Move tetromino physics simulation to GPU compute, allowing more tetrominos with zero CPU cost.

### Tasks

#### 3.1 Create `intro-tetromino-compute.js`
New file: `src/ui/intro-tetromino-compute.js`

**Buffers** (per tetromino, max 64):
- `tetrominoPosition` - `StorageBufferAttribute(Float32Array, 4)` - xyz + active
- `tetrominoVelocity` - `StorageBufferAttribute(Float32Array, 4)` - xyz + type
- `tetrominoRotation` - `StorageBufferAttribute(Float32Array, 4)` - xyz + rotSpeed
- `tetrominoMisc` - `StorageBufferAttribute(Float32Array, 4)` - scale + radius + spawnTime + 0

#### 3.2 Compute Shader: Physics Step
- Position integration: `pos += vel * delta`
- Rotation integration: `rot += rotSpeed * delta`
- Boundary check: remove when out of bounds
- N-body collision detection (O(n^2) is fine for 64 objects on GPU)
- Elastic collision response with restitution
- Speed clamping

#### 3.3 Instanced Rendering
- Use `THREE.InstancedMesh` with 64 instances (one per max tetromino)
- Read position/rotation from compute buffers directly (zero CPU readback)
- Instance color from type buffer
- Visibility controlled by `active` flag in compute buffer

#### 3.4 Spawning Strategy
- CPU sets initial position/velocity in buffer for new tetrominos (simple uniform update)
- GPU handles all simulation after spawn
- Increase max from 25 → 50+ tetrominos

### Validation
- Zero CPU cost for tetromino physics
- Collisions look natural and responsive
- No visual difference from current behavior (just more tetrominos)

---

## Phase 4: Visual Enhancements (World-Class Quality)

### Goal
Add new visual effects that leverage WebGPU's power to create a stunning, cinematic intro.

### Tasks

#### 4.1 Volumetric Nebula / Aurora
- Replace the 5 flat `PlaneGeometry` nebula clouds with a single volumetric raymarched nebula
- TSL fragment shader: multi-octave 3D noise (FBM) with animated flow
- Color palette: chromadelic gradient mapped to noise octaves
- Depth fog integration for atmospheric perspective
- Render as a full-screen quad behind the particle systems

#### 4.2 God Rays / Light Shafts
- TSL post-processing pass: radial blur from a bright center point
- Animate ray intensity with time (breathing pulse)
- Color: warm cyan/white gradients
- Subtle enough to not overpower title text

#### 4.3 Tetromino Glow Trails (Re-enable, GPU-powered)
- Re-enable the disabled tetromino trails, but on GPU
- Each tetromino emits trail particles from its compute buffer
- Trail fades with distance using GPU-computed alpha
- Color matches the tetromino type
- Gives motion a premium "comet tail" feel

#### 4.4 Particle Attraction Field
- Add a subtle gravity well at screen center
- Particles gently curve toward/around center (not directly into it)
- Creates an organic swirling motion instead of random drift
- Configurable strength via uniform

#### 4.5 Enhanced Bloom
- Use WebGPU's native bloom with better quality settings
- Add selective bloom (only emissive objects bloom, not everything)
- Add subtle chromatic fringing on bloom edges (TSL color split)

#### 4.6 Depth of Field
- TSL post-processing: bokeh DoF focused on the title plane
- Tetrominos in front/behind title get gentle blur
- Enhances sense of 3D depth
- Keep subtle - intro should feel sharp overall

#### 4.7 Film Grain / Cinematic Polish
- Very subtle noise overlay (TSL compute, ~1-2% intensity)
- Slight color grading (lift/gamma/gain in TSL post-processing)
- Optional subtle vignette in 3D space (not CSS)

#### 4.8 Star Constellation Lines
- Occasionally draw faint lines between nearby stars
- Animated appearance/disappearance (constellation "forming")
- Very subtle - adds detail without clutter

### Validation
- Every effect has a performance budget (must maintain 60 FPS)
- Effects layer harmoniously without visual noise
- Title remains clearly readable at all times

---

## Phase 5: Performance Optimization

### Goal
Ensure silky smooth 60 FPS+ on mid-range hardware, 120 FPS+ on high-end.

### Tasks

#### 5.1 Single Draw Call Particles
- All particle types in one `StorageBufferAttribute` → one draw call
- Type-based branching in TSL shader for different visual styles
- Eliminates per-type draw call overhead

#### 5.2 Adaptive Quality
- Detect GPU tier on init (use `renderer.info` or benchmark frame time)
- **High**: Full particle counts, all effects, full-res bloom
- **Medium**: Reduced particles (50%), simplified bloom, no DoF
- **Low**: Minimal particles, no post-processing, basic materials
- Dynamic adjustment: if frame time > 16ms for 10 frames, reduce quality

#### 5.3 Frustum Culling Optimization
- Tetrominos already use mesh-level culling (Three.js default)
- Particles: skip compute for particles far outside view
- Use bounding sphere check in compute shader

#### 5.4 Memory Management
- Pre-allocate all buffers at init (no runtime allocation)
- Reuse buffers between particle types
- Clean dispose on destroy (prevent GPU memory leaks)
- Track GPU memory with `renderer.info.memory`

#### 5.5 Remove Redundant CSS Layers
- CSS particles (6 div elements) → remove, GPU handles particles better
- CSS orbs (4 div elements) → remove, replace with GPU volumetric glow
- Keep CSS for: title text, prompt text, shimmer (these are text/UI elements)
- Reduces DOM complexity and eliminates CSS animation overhead

#### 5.6 Reduce Overdraw
- Sort particles back-to-front where needed
- Use early depth test for opaque tetrominos
- Minimize full-screen passes (combine post-processing where possible)

### Validation
- Profile with Chrome DevTools GPU timeline
- Test on integrated GPU (Intel UHD 630 equivalent)
- Memory usage < 100MB total for intro
- No frame drops during any animation phase

---

## Phase 6: Code Cleanup

### Goal
Remove dead code, consolidate files, and clean up the codebase.

### Tasks

#### 6.1 Remove Dead Code in `threejs-intro-renderer.js`
- **Delete** `createLensFlare()` method (lines 419-462) - disabled, never called
- **Delete** `updateTetrominoTrails()` method (lines 1258-1289) - disabled, never called
- **Delete** `spawnTrailParticle()` method (lines 1294-1310) - only called by disabled trails
- **Delete** `createGlowTexture()` method (line 500-503) - returns null, deprecated comment
- **Delete** `tetrominoTrails` array and initialization
- Remove commented-out call on line 1013

#### 6.2 Remove Dead Code in `intro-animation.js`
- **Delete** `createForegroundParticles()` method (lines 300-353) - never called, marked as removed

#### 6.3 Remove Dead CSS
- **Delete** `#intro-phaser-canvas` rules (lines 77-93) - references old Phaser canvas, no longer used
- **Delete** `.intro-light-rays` and `.intro-ray` rules (lines 409-449) - never created in JS
- **Delete** `.intro-energy-field` rules (lines 607-635) - never created in JS
- **Delete** `@keyframes reflectionReveal` (lines 175-187) - title reflection is disabled
- **Delete** `.intro-title-container::after` with `display: none` (lines 171-173) - dead override

#### 6.4 Remove Backup/Old Files
- **Delete** `src/themes/swedish-forest/swedish-forest-theme.js.bak` - backup file
- **Delete** `src/themes/bioluminescence/bioluminescence-theme-old.js` - old version

#### 6.5 Remove Redundant CSS Layers (after Phase 5.5)
- Remove CSS particle creation code from `createParticles()` in `intro-animation.js`
- Remove CSS orb creation code from `createOrbs()` in `intro-animation.js`
- Remove `.intro-particles`, `.intro-particle`, `.intro-orb`, `.intro-orbs` CSS rules
- Remove `@keyframes floatParticle`, `@keyframes fadeInParticles`, `@keyframes orbFloat`

### Validation
- No unused imports remain
- No dead methods or unreachable code
- CSS file reduced by ~100+ lines
- All existing functionality unchanged

---

## Phase 7: Transition & Polish

### Goal
Ensure the intro-to-game transition is seamless and the overall experience is polished.

### Tasks

#### 7.1 Smooth Dismiss Transition
- When user presses key/clicks, trigger GPU-computed "warp speed" effect
- Stars stretch into lines (like hyperspace jump)
- Tetrominos fly outward from center
- Title shrinks to logo position (keep current CSS animation)
- Entire effect completes in ~1.2 seconds

#### 7.2 Background-Only Mode
- Ensure `showBackgroundOnly()` works with WebGPU renderer
- Reduce particle counts in background mode (save GPU for gameplay)
- Smooth transition when returning to menu from gameplay

#### 7.3 Sound Sync
- Sync particle bursts and visual beats with 'CosmicChimes' music
- Add subtle visual pulse on bass hits (bloom intensity bump)
- Optional: audio-reactive particle behavior

#### 7.4 Loading Integration
- Use intro animation to mask asset loading
- Show subtle loading indicator if assets aren't ready when user interacts
- Preload critical game assets during intro display time

### Validation
- Transition to gameplay is seamless (no blank frames)
- Background mode uses < 30% of full intro GPU budget
- Sound sync feels natural, not forced

---

## New File Structure

```
src/ui/
├── intro-animation.js                    (updated - state machine, DOM, events)
├── intro-animation.css                   (cleaned up - removed dead CSS)
├── threejs-intro-renderer.js             (kept as WebGL fallback, dead code removed)
├── threejs-intro-renderer-webgpu.js      (NEW - WebGPU renderer)
├── intro-particle-compute.js             (NEW - GPU particle compute shaders)
└── intro-tetromino-compute.js            (NEW - GPU tetromino physics)
```

---

## Implementation Order

| Order | Phase | Effort | Risk | Dependencies |
|-------|-------|--------|------|-------------|
| 1 | Phase 6: Code Cleanup | Low | Low | None |
| 2 | Phase 1: WebGPU Renderer Migration | Medium | Medium | None |
| 3 | Phase 2: GPU Compute Particles | High | Medium | Phase 1 |
| 4 | Phase 3: GPU Tetromino Physics | Medium | Low | Phase 1 |
| 5 | Phase 5: Performance Optimization | Medium | Low | Phases 2-3 |
| 6 | Phase 4: Visual Enhancements | High | Medium | Phases 2-3 |
| 7 | Phase 7: Transition & Polish | Medium | Low | Phases 4-5 |

**Rationale**: Start with cleanup (safe, immediate improvement), then build the WebGPU foundation, move computation to GPU, optimize, and finally add new visual effects on the proven foundation.

---

## Performance Targets

| Metric | Current | Target |
|--------|---------|--------|
| Star count | 3,000 | 10,000+ |
| Nebula particles | 80 | 500+ |
| Sparkles | 100 | 500+ |
| Max tetrominos | 25 | 50+ |
| Shooting stars | 5 (pooled) | Unlimited |
| Collision particles per burst | 8 | 32+ |
| CPU particle updates | All | Zero (GPU compute) |
| Draw calls (particles) | 5+ | 1-2 |
| Target FPS (mid-range GPU) | 60 | 60+ |
| Target FPS (high-end GPU) | 60 | 120+ |
| GPU memory | ~30MB | < 100MB |
| Post-processing | WebGL addon | Native WebGPU |

---

## Technical Notes

### WebGPU Detection
```javascript
const supportsWebGPU = !!navigator.gpu;
const Renderer = supportsWebGPU
    ? (await import('./threejs-intro-renderer-webgpu.js')).default
    : (await import('./threejs-intro-renderer.js')).default;
```

### TSL Compute Pattern (from existing codebase)
The project uses this established pattern across 9 themes:
```javascript
import * as THREE from 'three/webgpu';
import { Fn, storage, uniform, instanceIndex, ... } from 'three/tsl';

const computeFn = Fn(() => {
    const pos = storage(positionBuffer, 'vec4', count).element(instanceIndex);
    // ... compute logic
});

const computeNode = computeFn().compute(count);
renderer.computeAsync(computeNode);
```

### Three.js Version
Current: `three@0.181.2` - has full WebGPU + TSL support. No upgrade needed.
