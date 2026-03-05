# Wolfhour Theme — WebGPU Upgrade Plan

> **Goal:** Upgrade the Wolfhour theme from WebGLRenderer + GLSL ShaderMaterial to a hybrid WebGPU/WebGL architecture using Three.js's WebGPURenderer with TSL node materials, GPU compute for particle simulation, and node-based post-processing. All existing visual features and atmosphere must be preserved and elevated.

---

## Table of Contents

1. [Current Architecture Audit](#1-current-architecture-audit)
2. [Target Architecture](#2-target-architecture)
3. [File Structure](#3-file-structure)
4. [Phase 0 — Baseline Parity Harness](#phase-0--baseline-parity-harness)
5. [Phase 1 — Renderer Swap & Hybrid Branching](#phase-1--renderer-swap--hybrid-branching)
6. [Phase 2 — TSL Node Materials](#phase-2--tsl-node-materials)
7. [Phase 3 — GPU Compute Systems](#phase-3--gpu-compute-systems)
8. [Phase 4 — Node-Based Post-Processing](#phase-4--node-based-post-processing)
9. [Phase 5 — Visual Enhancements](#phase-5--visual-enhancements)
10. [Phase 6 — Quality, Polish & Performance](#phase-6--quality-polish--performance)
11. [Implementation Notes](#implementation-notes)

---

## 1. Current Architecture Audit

### Renderer
- `THREE.WebGLRenderer` with orthographic camera
- `EffectComposer` → `RenderPass` + `UnrealBloomPass` + `ShaderPass` (SilverTint, Vignette)

### Scene Elements (all GLSL ShaderMaterial)
| Element | Type | Shader Pairs | Notes |
|---------|------|-------------|-------|
| **Starfield** | `Points` (up to 150K) | starfield V/F | 3 depth layers, twinkle, event boost |
| **Nebula Backdrop** | 3x `PlaneGeometry` Meshes | nebula V/F | Texture-based, parallax drift, pulse |
| **Mountains** | 8x `PlaneGeometry` (FBM-displaced) | mountain V/F | CPU-side FBM, shockwave displacement, rim light, fog |
| **Spirits** | `Points` (up to 40) | spirit V/F | Floating sine wave, surge intensity |
| **Star Bursts** | `Points` (30 particles each) | burst V/F | Piece-lock effect, gravity, fade |
| **Celestial Beams** | `PlaneGeometry` Meshes | beam V/F | Line-clear pillars of light |
| **Cosmic Rifts** | `PlaneGeometry` Meshes | rift V/F | Combo 3+ horizontal cracks |
| **Cosmic Waves** | `PlaneGeometry` Meshes | wave V/F | Line-clear horizontal ripple |
| **Meteors** | `Line` + `Points` (trail + head) | meteorTrail V/F, meteorHead V/F | Auto-spawn + combo-triggered |
| **Meteor Crashes** | `Line` + `Points` + explosion suite | 5 shader pairs (crash trail/head, debris, shockwave, dust cloud) | Combo 5+ mountain impact |

### Effect State System
- Smooth exponential decay on all effect channels (`mountainPulse`, `mountainShockwave`, `spiritSurge`, `bloomBoost`, `nebulaBoost`, `starBurstIntensity`, `cosmicRiftIntensity`)
- Events: `PIECE_LOCK`, `LINE_CLEAR`, `COMBO`, `LEVEL_UP`

### Quality Presets
- 6 tiers: Minimal → Extreme
- Controls star count, mountain segments, nebula resolution, spirit count, bloom, effect limits

---

## 2. Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    WebGPU Path (preferred)                   │
│                                                             │
│  WebGPURenderer ─→ TSL Node Materials (all scene elements)  │
│                 ─→ GPU Compute (spirit simulation,          │
│                    meteor trails, debris physics,            │
│                    ambient particles)                        │
│                 ─→ THREE.PostProcessing (MRT bloom +        │
│                    vignette + silver tint + film grain)      │
├─────────────────────────────────────────────────────────────┤
│                    WebGL 2.0 Fallback                        │
│                                                             │
│  WebGLRenderer (primary fallback for strict parity)         │
│  ─→ Original GLSL ShaderMaterial (preserved as-is)          │
│  ─→ CPU particle updates (existing logic unchanged)         │
│  ─→ EffectComposer (UnrealBloomPass + ShaderPass)           │
└─────────────────────────────────────────────────────────────┘
```

**Key Principle:** The WebGL fallback must remain identical to the current theme. All TSL/compute/post code lives in separate files and is imported only after WebGPU capability is confirmed at runtime.

---

## 3. File Structure

```
src/themes/wolfhour/
├── wolfhour-theme.js          # Main theme (modified: hybrid renderer init + branching)
├── wolfhour-shaders.js        # EXISTING GLSL shaders (untouched — WebGL fallback)
├── wolfhour-tetrominos.js     # Tetromino config (untouched)
├── wolfhour-materials.js      # NEW: TSL node material factories (WebGPU path)
├── wolfhour-compute.js        # NEW: GPU compute kernels (WebGPU path)
├── wolfhour-post.js           # NEW: Node-based post-processing (WebGPU path)
└── wolfhour-theme-icon.png    # Theme icon (untouched)
```

---

## Phase 0 — Baseline Parity Harness

**Goal:** Establish deterministic visual regression tooling before renderer migration.

### 0.1 Deterministic Runtime Flags
- `?wolfhourBaseline=1` — enable deterministic mode
- `?wolfhourSeed=1234` — deterministic random source
- `?wolfhourFixedDt=16.666` — fixed simulation timestep
- `?wolfhourPlayback=default|stress` — scripted event playback sequence

### 0.2 Capture + Diff Pipeline
- Capture reference frames from current Wolfhour WebGL implementation at fixed checkpoints
- Capture candidate frames from upgraded implementation under identical deterministic inputs
- Compare with SSIM + pixel delta thresholds (no manual-only approval path)

### 0.3 Acceptance Criteria
- WebGL fallback: no behavioral regressions + SSIM >= 0.995 at all checkpoints
- WebGPU path: no gameplay-event timing regressions + visual intent approved by art direction

### Tasks
- [ ] Add deterministic flags parser (`parseWolfhourFlags`) with namespaced keys
- [ ] Add scripted playback sequence for `PIECE_LOCK`, `LINE_CLEAR`, `COMBO`, `LEVEL_UP`
- [ ] Add screenshot capture checkpoints and diff report output
- [ ] Save baseline evidence artifacts in `docs/validation/wolfhour/`

---

## Phase 1 — Renderer Swap & Hybrid Branching

**Goal:** Introduce a resilient hybrid renderer path while preserving existing WebGL behavior.

### 1.1 Imports
```js
import * as THREE from 'three';
let THREE_WEBGPU = null; // lazy-loaded only when WebGPU path is attempted
```

### 1.2 Renderer Initialization (`initRenderer`)
- Parse flags once at scene start
- If not `forceWebGL`: `THREE_WEBGPU = await import('three/webgpu')`, then attempt `new THREE_WEBGPU.WebGPURenderer(...)` + `await renderer.init()`
- Confirm backend with `renderer.backend?.isWebGPUBackend`
- On failure, force fallback to `new THREE.WebGLRenderer(...)` without throwing
- Set `this.isWebGPU` and `this.isWebGL` explicitly
- Register resilience hooks (`renderer.onDeviceLost`, `renderer.backend?.device?.lost`, and `webglcontextlost` / `webglcontextrestored` handlers on fallback path)

### 1.3 Capability Detection
```js
this.capabilities = {
    webgpu: boolean,
    webgl: boolean,
    maxColorAttachments: number,
    supportsPost: boolean,      // API/backend capability only
    supportsMRT: boolean,       // webgpu && maxColorAttachments > 1
    supportsCompute: boolean,   // webgpu && typeof renderer.compute === 'function'
};

this.flags = {
    forceWebGL: boolean,
    noPost: boolean,
    noMRT: boolean,
    noCompute: boolean,
    usePost: boolean,           // capability + quality + debug policy
    useMRT: boolean,            // capability + quality + debug policy
    useCompute: boolean,        // capability + quality + debug policy
};
```

### 1.4 Runtime Branching Surface
- Make `createScene()` async
- Branch creation, update, render, resize, and cleanup paths
- Creation: `createXNode()` vs `createXLegacy()`
- Update: uniforms/compute dispatch and event-state wiring by backend
- Render: WebGPU `postProcessing.render()` vs WebGL `composer.render()`
- Cleanup: dispose path-specific resources without leaking shared state
- Legacy methods contain current GLSL code (moved, not modified)

### 1.5 Debug Flags
- `?forceWebGL` — force WebGL backend
- `?wolfhourNoCompute` — disable GPU compute (`?noCompute` accepted as alias)
- `?wolfhourNoPost` — disable node post-processing (`?noPost` alias)
- `?wolfhourNoMRT` — disable MRT bloom (`?noMRT` alias)

### 1.6 Device-Loss Recovery State Machine
- Detect: `onDeviceLost` or `device.lost` callback
- Freeze: cancel animation loop, suspend updates
- Tear down: dispose WebGPU-only post/compute/material stacks safely
- Fallback: set `flags.forceWebGL = true`, `flags.noMRT = true`, `flags.noCompute = true`
- Rebuild: recreate scene idempotently on WebGL path
- Resume: restart animation loop and emit recovery diagnostics

### Tasks
- [ ] Switch to lazy `import('three/webgpu')` in renderer init
- [ ] Rewrite `initRenderer()` to async with graceful WebGPU fallback
- [ ] Add `isWebGPU`, `isWebGL`, `capabilities`, and `flags.use*` state
- [ ] Add `parseWolfhourFlags()` utility
- [ ] Make `createScene()` async
- [ ] Add backend branching to create/update/render/resize/cleanup paths
- [ ] Verify WebGL fallback parity using Phase 0 deterministic harness
- [ ] Implement device-loss recovery state machine

---

## Phase 2 — TSL Node Materials

**Goal:** Rewrite every GLSL shader as a TSL node material factory. Each factory returns `{ material, uniforms, meta }`.

### File: `wolfhour-materials.js`

All factories follow this pattern:
```js
import { PointsNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, uniform, attribute, vec2, vec3, ... } from 'three/tsl';

export function createStarfieldNodeMaterial(params) {
    const mat = new PointsNodeMaterial({ ... });
    const uTime = uniform(0);
    // TSL shader graph...
    mat.colorNode = ...;
    mat.opacityNode = ...;
    mat.emissiveNode = ...;  // Required for MRT bloom
    return { material: mat, uniforms: { uTime, ... }, meta: { emitsBloom: true } };
}
```

### 2.1 Starfield Material
- `PointsNodeMaterial` with `sizeNode` for attenuation
- TSL twinkle: `sin(uTime * aTwinkle.y + aTwinkle.x)` via `attribute('aTwinkle')`
- `pointUV` replaces `gl_PointCoord` for soft-circle falloff
- `emissiveNode` for per-star bloom contribution (brighter stars bloom more)
- Event boost uniform modulates brightness

### 2.2 Mountain Material
- `MeshStandardNodeMaterial` or `MeshBasicNodeMaterial`
- TSL FBM noise for rock texture (port existing GLSL `hash → noise → fbm` chain)
- `positionWorld` for world-space sampling
- `normalWorld` for rim lighting: `pow(1.0 - max(dot(normalWorld, viewDir), 0.0), 3.0)`
- Shockwave vertex displacement via `positionLocal` offset node
- Atmospheric fog via `mix(color, fogColor, pow(uMountainLayer, 1.8) * 0.35)`
- `emissiveNode` for peak glow (pulse effect contributes to bloom)

### 2.3 Spirit Material
- `PointsNodeMaterial`
- Floating sine-wave position offset via `positionLocal.add(...)`
- Soft ethereal glow via `pointUV` distance
- Surge intensity modulates size and alpha
- `emissiveNode` = spirit glow color * alpha (spirits bloom softly)

### 2.4 Nebula Material
- `MeshBasicNodeMaterial` with `texture()` node
- Edge fade via UV-based smoothstep
- Pulse uniform for gameplay reactivity
- `emissiveNode` = nebula color (subtle bloom contribution)

### 2.5 Effect Materials (Bursts, Beams, Rifts, Waves)
- **Star Burst:** `PointsNodeMaterial` — velocity + gravity displacement, time-based fade
- **Celestial Beam:** `MeshBasicNodeMaterial` — gaussian beam shape, shimmer, vertical fade
- **Cosmic Rift:** `MeshBasicNodeMaterial` — edge fade, electric crackle, silver core
- **Cosmic Wave:** `MeshBasicNodeMaterial` — horizontal ripple propagation

### 2.6 Meteor Materials
- **Meteor Trail:** `LineNodeMaterial` (or `LineBasicNodeMaterial`) — head-to-tail fade, shimmer, color gradient
- **Meteor Head:** `PointsNodeMaterial` — soft glow core with halo
- **Crash variants:** Larger/more intense versions of above

### 2.7 Crash Explosion Materials
- **Debris:** `PointsNodeMaterial` — velocity + gravity, twinkle, silver sparks
- **Shockwave:** `MeshBasicNodeMaterial` — expanding ring with soft edges
- **Dust Cloud:** `PointsNodeMaterial` — billowing motion, turbulence, slow fade

### 2.8 MRT Compliance
- **Every material must set `emissiveNode`** — even if `vec3(0)` for non-glowing elements
- Bloom-emitting elements (stars, spirits, beams, bursts) set meaningful emissive values
- Mountains: only emit on pulse peaks

### Tasks
- [ ] Create `wolfhour-materials.js` with helper utilities (`tslHash`, `tslNoise`, `tslFbm`)
- [ ] Implement `createStarfieldNodeMaterial()`
- [ ] Implement `createMountainNodeMaterial()`
- [ ] Implement `createSpiritNodeMaterial()`
- [ ] Implement `createNebulaNodeMaterial()`
- [ ] Implement `createStarBurstNodeMaterial()`
- [ ] Implement `createCelestialBeamNodeMaterial()`
- [ ] Implement `createCosmicRiftNodeMaterial()`
- [ ] Implement `createCosmicWaveNodeMaterial()`
- [ ] Implement `createMeteorTrailNodeMaterial()`
- [ ] Implement `createMeteorHeadNodeMaterial()`
- [ ] Implement `createCrashMeteorTrailNodeMaterial()`
- [ ] Implement `createCrashMeteorHeadNodeMaterial()`
- [ ] Implement `createDebrisNodeMaterial()`
- [ ] Implement `createShockwaveNodeMaterial()`
- [ ] Implement `createDustCloudNodeMaterial()`
- [ ] Verify all materials set `emissiveNode` for MRT
- [ ] Wire material factories into theme's WebGPU creation path

---

## Phase 3 — GPU Compute Systems

**Goal:** Offload high-cost particle simulation loops to GPU compute where profiling shows clear wins.

### File: `wolfhour-compute.js`

### 3.1 Star Twinkle Compute
- **Optional and benchmark-gated**
- Default path keeps material-based twinkle (already GPU-evaluated in vertex/fragment shaders)
- Enable only if a measured gain is shown at Extreme preset (target: >0.5 ms/frame reduction)
- If enabled: `StorageBufferAttribute` drives richer behavior (twinkle + color temperature + diffraction mask)

### 3.2 Spirit Simulation Compute
- Full GPU-side spirit particle simulation
- Position update: floating sine-wave with per-particle phase/speed
- Allows scaling to 100+ spirits at Extreme quality (up from 40)
- Output: position buffer read by `PointsNodeMaterial`

### 3.3 Meteor Trail Compute
- GPU-side trail position interpolation
- Each frame: compute head position, cascade trail segment positions
- Eliminates CPU loop over `trailSegments * 3` floats per meteor
- Enables longer, smoother trails (80+ segments instead of 40)

### 3.4 Debris Physics Compute
- GPU-driven velocity + gravity integration for debris particles
- Allows 200+ debris particles per crash (up from 40)
- Twinkle oscillation computed on GPU

### 3.5 Ambient Particle Field Compute (NEW)
- New floating particle field across the entire scene
- Thousands of tiny silver motes drifting slowly
- Reacts to gameplay: accelerates on combos, scatters on piece lock
- Only feasible at scale with GPU compute

### Quality Gating
- Compute only enabled when `this.flags.useCompute && qualityPreset.enableCompute`
- Low/Minimal presets: CPU fallback (existing logic)
- Medium+: GPU compute enabled

### Tasks
- [ ] Create `wolfhour-compute.js`
- [ ] Keep star twinkle on material path by default
- [ ] Implement optional `WolfhourStarTwinkleCompute` only behind benchmark gate
- [ ] Implement `WolfhourSpiritCompute` class
- [ ] Implement `WolfhourMeteorTrailCompute` class
- [ ] Implement `WolfhourDebrisCompute` class
- [ ] Implement `WolfhourAmbientParticleCompute` class (new feature)
- [ ] Wire compute dispatches into animation loop (`renderer.compute()` per frame, `computeAsync()` only for async setup/warmup)
- [ ] Add compute particle counts to quality presets
- [ ] Verify CPU fallback path still works identically

---

## Phase 4 — Node-Based Post-Processing

**Goal:** Replace EffectComposer with `THREE.PostProcessing` for emissive-aware MRT bloom and cinematic grading.

### File: `wolfhour-post.js`

### 4.1 Class: `WolfhourPost`

```js
import * as THREE from 'three/webgpu';
import { pass, mrt, output, emissive } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
```

### 4.2 MRT Setup
- Scene pass with `mrt({ output, emissive })`
- Bloom sourced from **emissive channel only** → stars, spirits, beams bloom without bleeding into mountains
- This is a massive visual upgrade: selective bloom instead of full-scene threshold bloom

### 4.3 Post-Processing Chain
1. **Scene Pass** (MRT: output + emissive)
2. **Emissive Bloom** — `bloom(emissiveTexture, strength, radius, threshold)`
   - Strength scales with `bloomBoost` effect state
   - Bloom downsample factor from quality preset
3. **Silver Tint** — TSL node: desaturate → multiply by `vec3(1.1, 1.1, 1.2)` → mix with original
4. **Vignette** — TSL node: UV-distance darkening
5. **Film Grain** (NEW) — subtle animated noise for cinematic texture
6. **Tone Mapping (single owner)** — ACES in TSL *or* renderer tone mapping, never both
7. **Dither** — banding prevention

### 4.4 Quality Gating
- Extreme/Ultra/High: Full MRT + bloom + all grading
- Medium: MRT + bloom (reduced downsample) + vignette
- Low/Minimal: Fall back to EffectComposer (existing)

### Tasks
- [ ] Create `wolfhour-post.js` with `WolfhourPost` class
- [ ] Implement MRT scene pass setup
- [ ] Implement emissive-aware bloom
- [ ] Port Silver Tint shader to TSL node
- [ ] Port Vignette shader to TSL node
- [ ] Add film grain node (new)
- [ ] Add ACES tone mapping node
- [ ] Add dither node
- [ ] Wire `WolfhourPost` into theme's animation loop (WebGPU path)
- [ ] Add `setSize()`, `update()`, `dispose()` methods
- [ ] Enforce tone-mapping ownership (`renderer.toneMapping = NoToneMapping` if ACES is in post node graph)
- [ ] Verify bloom only affects emissive elements (not mountains)

---

## Phase 5 — Visual Enhancements

**Goal:** Leverage WebGPU's power budget to add new visual features that elevate Wolfhour to world-class.

### 5.1 Enhanced Starfield
- **Star Diffraction Spikes:** TSL shader adds 4-point or 6-point diffraction cross pattern on brightest stars
- **Star Color Temperature Variation:** Subtle blue-white to warm-white gradient based on star brightness
- **Depth-of-Field Glow:** Stars at different Z-depths have different glow softness
- **Higher star counts:** Extreme preset → 200K+ stars (WebGPU + material twinkle; optional compute only if benchmark win is proven)

### 5.2 Volumetric Light Shafts
- Celestial beams upgraded with volumetric scattering simulation
- Beams interact with mountain silhouettes (god-rays through peaks)
- TSL noise-based shaft density variation
- Subtle silver light leaking over mountain ridgelines

### 5.3 Enhanced Mountain Rendering
- **Parallax Occlusion** on mountain surface detail (TSL `positionWorld` sampling)
- **Subsurface Scattering Approximation** — moonlit silver glow through thin rock edges
- **Animated Ridge Highlight** — subtle silver crawling light along ridgelines during events
- **Snow Dusting** on highest peaks — procedural, only appears on steep normals above threshold height

### 5.4 Atmospheric Effects
- **God Rays from behind mountains** — screen-space radial blur from occluded nebula light
- **Ground Fog Layer** — volumetric fog at mountain base with FBM turbulence (TSL noise)
- **Aurora-like Spirit Trails** — spirits leave fading luminous trails (computed on GPU)

### 5.5 Enhanced Meteor Effects
- **Longer, denser trails** — 80+ segments with GPU compute interpolation
- **Atmospheric entry glow** — surrounding air ionization effect (expanding soft sphere around head)
- **Spark shower on crash** — 200+ tiny sparks (GPU compute) instead of 40 debris particles
- **Screen shake integration** — subtle camera offset on crash impact

### 5.6 Ambient Particle Field (NEW)
- Thousands of tiny silver motes floating in parallax layers
- Slowly drifting upward like dust in moonlight
- Reacts to gameplay events: scatter on piece lock, swirl on combo
- Only enabled at Medium+ quality with GPU compute

### 5.7 Reactive Nebula Intensification
- Nebula layers subtly pulse and shift color temperature on gameplay events
- Higher combos = brighter, more defined nebula structure
- Uses TSL uniform animation for smooth transitions

### Tasks
- [x] Add star diffraction spikes to starfield TSL material
- [x] Implement depth-of-field star glow variation
- [x] Upgrade celestial beams with volumetric noise
- [x] Add ridge highlight animation to mountain material
- [x] Implement ground fog layer (TSL FBM volumetric)
- [x] Create ambient particle field system
- [x] Enhance meteor trail density and atmospheric glow
- [x] Increase debris count with GPU compute
- [x] Add screen-shake camera effect on meteor crash
- [x] Implement reactive nebula color temperature shifts

---

## Phase 6 — Quality, Polish & Performance

### 6.1 Quality Preset Updates
Extend presets with new WebGPU-specific parameters:

```js
// Example: Extreme preset additions
{
    // Existing...
    starCount: 200000,        // Up from 150K
    spiritCount: 80,          // Up from 40
    enableCompute: true,
    enableNodePost: true,
    enableMRT: true,
    // New
    computeStarTwinkle: false,   // Optional: enable only if benchmark gate passes
    computeSpirits: true,
    computeMeteorTrails: true,
    computeDebris: true,
    ambientParticles: 3000,
    debrisPerCrash: 200,
    meteorTrailSegments: 80,
    bloomDownsample: 0.9,
    enableFilmGrain: true,
    enableDiffraction: true,
    enableGroundFog: true,
    enableVolumetricBeams: true,
}
```

### 6.2 Performance Budgets
| Quality | Target FPS | Max Draw Calls | Max Triangles | Max Points |
|---------|-----------|---------------|--------------|-----------|
| Extreme | 60 | 40 | 2M | 250K |
| Ultra | 60 | 35 | 1.5M | 150K |
| High | 60 | 30 | 1M | 100K |
| Medium | 60 | 25 | 500K | 60K |
| Low | 60 | 20 | 250K | 30K |
| Minimal | 30 | 15 | 100K | 15K |

### 6.3 Polish Items
- [ ] Verify all materials properly dispose on cleanup
- [x] Ensure `handleResize()` updates PostProcessing + compute buffers
- [ ] Test WebGL fallback on browsers without WebGPU
- [x] Add `?forceWebGL` debug flag for testing
- [x] Profile GPU memory usage at each quality level
- [ ] Verify no visual regression from current theme at any quality using deterministic baseline diffs
- [ ] Test device-loss recovery (WebGPU)
- [ ] Ensure smooth transition when switching to/from this theme

### 6.4 Testing Matrix
- Chrome 120+ (WebGPU native)
- Firefox Nightly (WebGPU experimental)
- Safari 18+ (WebGPU)
- Chrome with `--disable-webgpu` (WebGL fallback)
- Mobile Chrome (WebGL fallback expected)

### 6.5 Regression Automation
- Deterministic runs: `wolfhourBaseline + seed + fixedDt + playback`
- Artifacts: checkpoint screenshots + metrics JSON (SSIM, delta pixels, timing stats)
- WebGL fallback parity gate must pass before enabling new WebGPU enhancements by default
- WebGPU enhancement gate must pass performance budgets and no event-timing regressions

---

## Implementation Notes

### TSL Key Patterns
```js
// Replacing gl_PointCoord → pointUV
import { pointUV } from 'three/tsl';
const dist = length(pointUV.sub(0.5)).mul(2.0);

// Replacing position attribute → positionLocal
import { positionLocal } from 'three/tsl';

// Fn pattern for complex shader functions
const myShaderFn = Fn(([param1, param2]) => {
    // TSL operations...
    return result;
})();  // Note: trailing () is required

// MaterialX noise (alternative to custom noise)
import { mx_noise_float } from 'three/tsl';

// Storing uniforms for runtime updates
material.userData.uniforms = { uTime, uPulse, ... };
```

### MRT Compliance Rule
**Every single material in the scene must have `emissiveNode` set.** Even non-glowing elements like mountains should set `emissiveNode = vec3(0)`. Without this, the MRT framebuffer will produce undefined values for those fragments.

### Uniform Update Pattern
```js
// WebGPU path: uniforms stored in material.userData
if (this.isWebGPU) {
    material.userData.uniforms.uTime.value = this.time;
} else {
    material.uniforms.uTime.value = this.time;
}
```

### Compute Dispatch Pattern
```js
// In animation loop:
if (this.flags.useCompute) {
    if (this.spiritCompute) this.renderer.compute(this.spiritCompute.computeNode);
    if (this.meteorTrailCompute) this.renderer.compute(this.meteorTrailCompute.computeNode);
    if (this.debrisCompute) this.renderer.compute(this.debrisCompute.computeNode);
}
```

### Import Strategy
- Main theme statically imports `three` only
- Renderer init lazily imports `three/webgpu` when WebGPU path is attempted
- Main theme dynamically imports `wolfhour-materials.js`, `wolfhour-compute.js`, and `wolfhour-post.js` only on confirmed WebGPU path
- TSL/compute/post modules can statically import `three/webgpu` and `three/tsl` internally

### Tone Mapping Ownership Rule
- If ACES is implemented in `wolfhour-post.js`, set `renderer.toneMapping = THREE.NoToneMapping`
- If renderer tone mapping is used, remove ACES tone map node from post graph
- Never apply both in the same render path

### Preservation Guarantee
The following must remain visually equivalent on the WebGL fallback path (validated by deterministic diffs and checkpoint playback):
- Starfield appearance and twinkle behavior
- Mountain FBM geometry and shading
- Spirit floating animation
- All gameplay effects (bursts, beams, rifts, waves)
- Meteor and crash systems
- Post-processing bloom + silver tint + vignette
- Camera breathing animation
- Color palette and overall silver/noir atmosphere

---

## Summary

| Phase | Files Modified/Created | Scope |
|-------|----------------------|-------|
| **Phase 0** | `wolfhour-theme.js`, validation scripts/docs | Deterministic baseline harness + diff gates |
| **Phase 1** | `wolfhour-theme.js` | Renderer swap, async init, capability detection, branching |
| **Phase 2** | `wolfhour-materials.js` (new) | 15+ TSL node material factories |
| **Phase 3** | `wolfhour-compute.js` (new) | 5 GPU compute classes |
| **Phase 4** | `wolfhour-post.js` (new) | MRT post-processing pipeline |
| **Phase 5** | `wolfhour-materials.js`, `wolfhour-theme.js` | Visual enhancements |
| **Phase 6** | All files | Quality presets, polish, testing |

**Estimated complexity:** ~2800-4000 lines of new code across 3 new files + validation tooling + ~400 lines of modifications to `wolfhour-theme.js`.
