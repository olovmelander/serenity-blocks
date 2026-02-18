# Stellar Velocity Theme - WebGPU Hybrid Upgrade Plan (World-Class Revision)

## Executive Summary

This plan converts the Stellar Velocity theme from a WebGL-only, single-file implementation into a production-grade hybrid WebGPU/WebGL2 renderer with world-class warp-drive visuals, strict fallback behavior, deterministic validation, and staged risk control.

Key outcomes:
- WebGPU-first startup with silent WebGL2 fallback.
- Dual render paths: WebGPU (`TSL` + `THREE.PostProcessing`) and WebGL (`ShaderMaterial` + `EffectComposer`).
- GPU compute for starfield warp simulation, burst particles, and asteroid orbital motion.
- Instanced rendering for asteroids (hundreds of draw calls collapsed to one).
- Emissive-only bloom (MRT) for cinematic warp glow without false bloom artifacts.
- Signature Stellar Velocity identity preserved and elevated: immersive warp tunnel, kinetic energy core, deep-space spectacle, gameplay-reactive momentum.
- Measurable performance, reliability, and visual acceptance gates per phase.

Scope:
- `src/themes/stellar-velocity/`
- `docs/STELLAR_VELOCITY_WEBGPU_UPGRADE_PLAN.md`

---

## Current Baseline (Verified)

### Renderer and Pipeline
- `THREE.WebGLRenderer` only in `src/themes/stellar-velocity/stellar-velocity-theme.js`.
- WebGL post chain via `EffectComposer` + `RenderPass` + `UnrealBloomPass` + custom `ShaderPass` (vignette + chromatic aberration).
- No WebGPU bootstrap, capability matrix, or runtime feature negotiation.
- `renderer.autoClear = false` with manual `renderer.clear()` before render.

### Active Scene and FX Systems
- Custom `ShaderMaterial` starfield (5000 max stars) with per-vertex twinkle, warp-speed elongation, and CPU-driven Z-position updates per frame.
- Procedural FBM nebula planes (up to 9) with `ShaderMaterial` and additive blending.
- Warp core sphere with fresnel rim glow + swirl pattern (`ShaderMaterial`).
- Canvas-gradient glow planes (billboard sprites for core glow).
- 3 energy torus rings with `MeshBasicMaterial` (additive).
- Asteroid field: up to 500 individual `Mesh` instances (no instancing), `MeshStandardMaterial`, 30 randomized `IcosahedronGeometry` variants.
- Event-driven burst particles: dynamic `Points` creation per event (CPU velocity arrays, disposed on timeout).
- Shockwave rings: dynamic `RingGeometry` meshes, scale-and-fade lifecycle.
- 5 color scheme cycling with `setTimeout` (30-45s interval).

### Architecture Constraints
- Theme logic is monolithic (`stellar-velocity-theme.js` only, ~1430 lines; no materials/compute/post modules).
- Multiple CPU-per-frame loops: starfield position updates, asteroid tumble/orbit, burst particle physics, shockwave scaling.
- Asteroid field uses 500 separate `Mesh` objects sharing 30 geometry variants and a single material — ideal instancing candidate but currently not instanced.
- Effect lifecycle relies on raw `setTimeout` for warp decay/resets — not centrally tracked or cleared on theme switch.
- Canvas textures for star sprite and glow planes (CPU-allocated, not procedural GPU).
- No deterministic replay hooks (`seed`, fixed delta, canned event sequence).
- No backend-specific render abstraction (`renderFrame`) yet.

### Immediate Risks to Close Before Expanding Scope
- `setTimeout` calls in `onLineClear()`, `onCombo()`, and `startColorCycle()` are not tracked in a disposable set — potential leak on repeated theme switches.
- No explicit disposal of `bloomPass`, `vignettePass`, `chromaticPass`, `coreLight`, glow plane textures, or `_starTexture` in `cleanup()`.
- Asteroid geometry variants are not disposed individually (all share references but geometry pool is never cleaned).
- Expensive visual ambitions should not ship before objective baseline captures and frame-time budgets are established.
- Current file size and responsibility concentration increase regression risk for large migrations.

---

## Platform Constraints

- Three.js: `^0.181.2`
- Electron: `^38.3.0`
- Startup must never fail due to WebGPU availability.
- WebGL fallback is a first-class runtime, not a temporary compatibility shim.

## Compatibility Constraints (Critical)

- WebGPU point primitives are not reliable for large glow sprites; any element requiring star-disc footprint or trail shaping must use billboard quads/sprites, not oversized GPU points.
- Compute buffer layouts must be explicit and 16-byte aligned (`vec4`-packed) to avoid WGSL alignment bugs across drivers.
- No per-frame GPU-to-CPU readback in hot paths (starfield/burst/asteroid simulation).
- Tone-mapping ownership must be single-path (post graph OR renderer), never both.

---

## Target End State

### Rendering Contract
- Startup selects the best supported path without UI disruption.
- Runtime supports these valid modes:
  - WebGPU + MRT + compute (full feature set)
  - WebGPU + MRT without compute
  - WebGPU without MRT
  - WebGPU without post
  - WebGL2 fallback with `EffectComposer`
- Optional systems activate only when both capability checks and flags allow them.

### Visual Contract (Masterpiece Bar)
- Preserve and elevate Stellar Velocity identity:
  - Immersive warp tunnel with true depth streaking and speed-reactive star elongation.
  - Hero warp core as dominant energy focal point with layered glow, plasma swirls, and event-driven energy bursts.
  - Multi-layer nebula depth with volumetric fog-like presence and controlled color rhythm.
  - Warp-speed momentum language tied to gameplay intensity (FOV, tunnel compression, chromatic, bloom surge).
  - Asteroid field providing parallax depth and scale reference.
- WebGPU path looks dramatically richer; WebGL path remains visually coherent and shippable.
- Gameplay board readability is non-negotiable on all tiers.

### Visual Pillars
- **Warp tunnel** is the primary spatial anchor — stars streak past the camera with convincing depth and motion parallax.
- **Warp core** is the dominant energy focal point — layered glow, animated plasma, reactive energy rings.
- **Nebula field** creates depth layers and color atmosphere, not uniform full-frame noise.
- **Asteroid belt** provides scale, parallax, and environmental grounding.
- **Reactive FX** communicate gameplay momentum without overwhelming the board.

### Current-Look Anchor (From Existing Theme)
- Preserve the signature cyan-white central energy burst as the dominant focal point.
- Preserve dense radial star clustering near center with sparse large bokeh stars in the periphery.
- Preserve high-contrast dark debris/asteroid silhouettes that provide scale against bright nebula light.
- Preserve red/blue/teal nebula sweeps as secondary structure behind the warp core.
- Upgrades can increase depth and fidelity, but these compositional anchors are non-negotiable for identity continuity.

### Color Script
- Deep-space base with cycling accent palettes (classic/nebula/solar/aurora/crimson).
- Peak saturation reserved for gameplay moments (combo bursts, warp surges).
- Avoid persistent bloom washout and full-frame clipping.
- Color transitions are smooth cross-fades (not hard cuts).

### Readability Rules
- Board edge contrast remains intact during high-combo warp effects.
- Chromatic aberration and radial effects are capped and event-scaled.
- Bloom is emissive-isolated once MRT is enabled.
- Vignette tunnel-vision effect has a hard cap to preserve peripheral board visibility.

### Reliability Contract
- Theme switches are leak-free across long sessions.
- No leaked listeners, RAF loops, timers, render targets, textures, storage buffers, or compute pipelines.
- Device-loss and post-pipeline failures recover to a valid render path.
- All `setTimeout` calls are tracked in a disposable set and cleared on `stop()`.

### Performance Contract
- High tier target: sustained 60 FPS at 1080p on mid-range discrete GPU class.
- Low/Minimal tiers remain stable with conservative post and simulation budgets.
- Adaptive scaling is smooth, bounded, and testable.

---

## New File Structure

```
src/themes/stellar-velocity/
├── stellar-velocity-theme.js        # Main class — hybrid renderer, scene setup, animation loop
├── stellar-velocity-materials.js    # TSL node material factories (starfield, nebula, warp core, asteroid, burst, shockwave)
├── stellar-velocity-compute.js      # GPU compute classes (starfield warp, burst particles, asteroid orbit)
├── stellar-velocity-post.js         # WebGPU PostProcessing class (MRT bloom, vignette, chromatic, grading)
├── stellar-velocity-shaders.js      # GLSL shaders extracted from theme.js (WebGL fallback — preserved)
└── stellar-velocity-tetrominos.js   # Tetromino config (unchanged)
```

---

## Capability Matrix and Kill Switches

| Runtime | Post | MRT | Compute | Expected Path |
|--------|------|-----|---------|---------------|
| WebGPU + MRT + Compute | Yes | Yes | Yes | Full Stellar Velocity feature set |
| WebGPU + MRT, no Compute | Yes | Yes | No | Node materials + CPU particle fallback |
| WebGPU, no MRT | Yes | No | Optional | Standard bloom path |
| WebGPU, no Post | No | No | Optional | Direct scene render |
| WebGL2 fallback | `EffectComposer` | No | No | Stable fallback-quality experience |

Required debug flags:
- `?forceWebGL=1`
- `?stellarVelNoPost=1`
- `?stellarVelNoMRT=1`
- `?stellarVelNoCompute=1`
- `?stellarVelNoDrs=1`
- `?stellarVelMrtAudit=1`
- `?stellarVelNoEnhancements=1`
- `?stellarVelBaseline=1`
- `?stellarVelSeed=1234`
- `?stellarVelFixedDt=16.666`

Rule:
- Every optional rendering feature is gated by capabilities and flags.

---

## Migration Policy

- Stability and observability before visual expansion.
- Introduce one major rendering risk at a time.
- Preserve WebGL visual parity unless a deliberate difference is approved.
- Do not remove fallback code until parity + performance + reliability gates pass.
- Define objective exit criteria per phase; avoid subjective "looks good" completion.

Non-goals until Phase 6+:
- Large new simulation systems without measured bottleneck evidence.
- Full volumetric raymarching on all tiers.
- Feature additions that reduce board readability under combo stress.

## Non-Negotiable Engineering Gates

1. **Deterministic baseline required before feature work**
   - Seeded runs (`stellarVelSeed`) + fixed delta (`stellarVelFixedDt`) + canned event script.
   - Hero-frame captures for WebGPU and WebGL fallback on each quality tier.

2. **Fallback parity blocks merges**
   - Any WebGPU upgrade that regresses WebGL stability/readability blocks phase signoff.

3. **Single owner per render responsibility**
   - Exactly one owner for tone mapping, bloom-source selection, and reactive envelope writes per frame.

4. **Measured budgets, not visual intuition**
   - Phase signoff requires p50/p95 frame-time, 1% low FPS, draw calls, and memory proxies in notes.

5. **Immediate runtime rollback path**
   - Every major feature has kill-switch coverage and can downgrade without reload loops.

6. **No reliance on oversized GPU points for signature visuals**
   - Star discs, burst sprites, and bloom-driving glows on WebGPU must render via billboard quads/sprites.

---

## Phase Plan

### Phase 0: Baseline Lock and Instrumentation (Critical)

Objective:
- Establish deterministic visual/performance baselines before migration.
- Extract GLSL shaders into a dedicated module for long-term WebGL fallback stability.

Files:
- Modify: `src/themes/stellar-velocity/stellar-velocity-theme.js`
- Create: `src/themes/stellar-velocity/stellar-velocity-shaders.js`
- Create/Modify: Stellar Velocity capture helpers under `tests/`
- Create: `docs/STELLAR_VELOCITY_ART_DIRECTION.md`
- Create: `docs/STELLAR_VELOCITY_BASELINE_CAPTURE_PROTOCOL.md`

Tasks:
- [x] Extract all inline GLSL shaders (starfield, nebula, warp core, vignette, chromatic aberration) into `stellar-velocity-shaders.js`.
- [x] Add deterministic controls (`stellarVelSeed`, `stellarVelFixedDt`, canned event playback).
- [x] Define hero-frame captures by backend/preset using the current-look anchor as reference.
- [x] Centralize all `setTimeout` calls into a tracked timer set (`this.activeTimers`) cleared on `stop()`.
- [x] Record baseline metrics: FPS, 1% low, frame-time variance, draw calls, memory.
- [x] Capture readability anchors during lock/combo heavy sequences.
- [x] Fix disposal gaps: dispose `bloomPass`, `vignettePass`, `chromaticPass`, `coreLight`, glow textures, `_starTexture`.

Exit criteria:
- Baseline pack committed and reproducible.
- Art-direction packet approved and frozen.
- All timers are tracked and cleared on theme switch (no leaks after 100+ cycles).
- GLSL shaders live in their own module and are imported cleanly.

---

### Phase 1: Renderer Bootstrap and Lifecycle Hardening (Critical)

Objective:
- Introduce robust hybrid boot and cleanup behavior.

Files:
- Modify: `src/themes/stellar-velocity/stellar-velocity-theme.js`

Tasks:
- [x] Add dual imports: `import * as THREE from 'three'` + `import * as THREE_WEBGPU from 'three/webgpu'`.
- [x] Implement explicit WebGPU-first async init with WebGL fallback (`initRenderer` becomes async).
- [x] Verify backend with `backend?.isWebGPUBackend === true` (not just truthy check).
- [x] Add consolidated capability object (`this.capabilities`: `webgpu`, `post`, `mrt`, `compute`).
- [x] Parse/store debug flags in `this.flags`.
- [x] Add device-loss handling (`renderer.onDeviceLost`) with safe fallback/reinit flow (force WebGL on recovery).
- [x] Store resize callback with stable reference (`this.boundResizeHandler`).
- [x] Ensure post/renderer/material/texture cleanup is complete and idempotent.
- [x] Make `createScene()` fully async.
- [x] Add timeout-guarded `compileAsync` (3s max) before first frame.
- [x] Color pipeline ownership: post graph owns tonemapping on WebGPU post path; renderer owns on WebGL/no-post.

Exit criteria:
- 100+ activate/deactivate cycles with no listener/timer/resource leaks.
- WebGPU init failure and device-loss scenarios recover without black screen.
- `?forceWebGL=1` forces WebGL path; all `?stellarVelNo*` flags work.
- Tone mapping is applied exactly once per path.

---

### Phase 2: Render Path Abstraction and Backend Parity (High)

Objective:
- Centralize frame rendering and backend-specific behavior.

Files:
- Modify: `src/themes/stellar-velocity/stellar-velocity-theme.js`
- Create: `src/themes/stellar-velocity/stellar-velocity-post.js`

Tasks:
- [x] Introduce single `renderFrame()` abstraction:
  - WebGPU post path: `this.postProcessing.render()`
  - WebGL composer path: `this.composer.render()`
  - Direct render fallback: `this.renderer.render(this.scene, this.camera)`
- [x] Create `StellarVelocityPost` class for WebGPU post-processing with conservative defaults (no MRT yet).
- [x] Normalize resize behavior across renderer/composer/post targets.
- [x] Ensure post failure auto-falls back to direct rendering.
- [x] Keep tone mapping and output color-space behavior aligned across backends.
- [x] Remove `renderer.autoClear = false` / manual `renderer.clear()` pattern — let the unified render path handle clearing.

Exit criteria:
- All flag/capability permutations run without runtime errors.
- WebGL path remains visually coherent versus baseline captures.

---

### Phase 3: Material Modularization and TSL Migration (Critical)

Objective:
- Split material responsibilities and migrate core shaders to node materials on WebGPU.

Files:
- Create: `src/themes/stellar-velocity/stellar-velocity-materials.js`
- Modify: `src/themes/stellar-velocity/stellar-velocity-theme.js`

Tasks:
- [x] Build dual-path material factories (WebGPU node + WebGL fallback shader):
  1. [x] Starfield (`MeshBasicNodeMaterial` on instanced billboard quads + fallback shader points) — warp-speed modulation, twinkle, color variation
  2. [x] Warp core sphere (`MeshBasicNodeMaterial`) — fresnel rim, swirl pattern, pulse glow
  3. [x] Nebula planes (`MeshBasicNodeMaterial`) — FBM-style noise, edge fade, pulse reactivity
  4. [x] Asteroid (`MeshStandardNodeMaterial`) — roughness/metalness, flat shading, emissive tint
  5. [x] Energy ring (`MeshBasicNodeMaterial`) — additive blending, opacity
  6. [x] Burst particles (`MeshBasicNodeMaterial` on instanced billboard quads + fallback points) — radial falloff, lifetime fade
  7. [x] Shockwave ring (`MeshBasicNodeMaterial`) — additive, opacity decay
  8. [x] Warp core glow (`SpriteNodeMaterial`) — procedural radial gradient on WebGPU, texture fallback on WebGL
- [x] Each factory returns `{ material, uniforms, meta }` tuple (pattern from chromadelic-highway).
- [x] Explicitly ban >1px-point dependency on WebGPU path for star/burst visuals (`pointSizePxCap=1` + audit enforcement).
- [x] Add bloom class weights per material to prevent emissive washout:
  ```
  warpCore:     0.85  — Hot plasma glow (dominant bloom source)
  energyRing:   0.65  — Bright ring accent
  starfield:    0.20  — Subtle star halos
  burstParticle:0.90  — Explosive event bloom
  shockwave:    0.50  — Expanding ring glow
  nebula:       0.00  — Pure background, no bloom
  asteroid:     0.00  — No bloom (solid objects)
  coreGlow:     0.40  — Soft background glow
  ```
- [x] Add material audit checks for emissive readiness before MRT enablement.

Exit criteria:
- WebGPU path compiles cleanly with no material warnings.
- WebGL visuals remain parity-safe.
- All material factories return clean `{ material, uniforms, meta }` tuples.

---

### Phase 4: WebGPU Post Pipeline and MRT Bloom Isolation (High)

Objective:
- Move WebGPU path to native post-processing and isolate bloom via emissive MRT.

Files:
- Modify: `src/themes/stellar-velocity/stellar-velocity-post.js`
- Modify: `src/themes/stellar-velocity/stellar-velocity-materials.js`
- Modify: `src/themes/stellar-velocity/stellar-velocity-theme.js`

Tasks:
- [x] Implement `StellarVelocityPost` class with `THREE.PostProcessing` chain:
  - [x] Scene pass with MRT (`output` + `emissive`)
  - [x] Bloom on emissive channel only (threshold 0.0 with MRT)
  - [x] TSL vignette (tunnel-vision scaled by warp speed)
  - [x] TSL chromatic aberration (event-scaled, edge-weighted)
  - [x] ACES tone mapping in post graph
  - [x] Deep-space cinematic color grading (exposure, contrast, saturation)
  - [x] Dithering (prevent banding in deep blacks)
- [x] Gate MRT by capability and flag (`!stellarVelNoMRT`).
- [x] Ensure non-bloom surfaces output zero emissive in MRT mode.
- [x] Keep fallback to non-MRT post and then direct render when needed.
- [x] Add `update()` method for per-frame reactive params (bloom strength, vignette darkness, chromatic intensity).
- [x] Add dev-only post/material diagnostics for MRT mismatches (`?stellarVelMrtAudit=1`).
- [x] Add `ensureMrtMaterials()` fail-safe: if any non-node material detected in scene, disable MRT entirely.

Bloom Configuration:

| Quality | Strength | Radius | Threshold | Downsample |
|---------|----------|--------|-----------|------------|
| Extreme | 0.55 | 0.50 | 0.0 (MRT) | 0.9 |
| Ultra | 0.50 | 0.45 | 0.0 (MRT) | 0.85 |
| High | 0.45 | 0.40 | 0.0 (MRT) | 0.8 |
| Medium | 0.38 | 0.35 | 0.0 (MRT) | 0.7 |
| Low | 0.28 | 0.30 | 0.7 | 0.6 |
| Minimal | 0.18 | 0.25 | 0.7 | 0.5 |

Exit criteria:
- Bloom affects intended emissive elements only.
- No MRT validation errors; fallback path always available.
- Vignette tunnel-vision effect scales correctly with warp speed.
- Chromatic aberration is event-driven and capped.

---

### Phase 5: Compute and Instancing Migration (High)

Objective:
- Reduce CPU simulation load and draw-call overhead with safe fallbacks.

Files:
- Create: `src/themes/stellar-velocity/stellar-velocity-compute.js`
- Modify: `src/themes/stellar-velocity/stellar-velocity-theme.js`

### 5.1 Asteroid Instancing (Both Paths)
- [x] Convert asteroid field from 500 individual `Mesh` objects to `InstancedMesh`.
- [x] Pre-merge the 30 geometry variants into a small set of LOD groups (or use a single merged geometry).
- [x] Store per-instance transform matrix in instance attribute buffer.
- [x] Store per-instance rotation speed and orbit data in custom attributes.
- [x] Collapse ~500 draw calls to 1-3 instanced draw calls.

### 5.2 Starfield Warp Compute (WebGPU Only)
- [x] Move starfield Z-position warp simulation to GPU compute.
- [x] `StorageBufferAttribute` for positions — zero CPU readback.
- [x] Compute kernel handles: Z advancement by warp speed, respawn when past camera, cylindrical re-distribution on respawn.
- [x] Twinkle brightness and streak factor computed in storage buffer; renderer consumes as instanced-star attributes.
- [x] Keep deterministic CPU fallback for WebGL and `stellarVelNoCompute` mode.

### 5.3 Burst Particle Compute (WebGPU Only)
- [x] Replace dynamic `Points` object creation per event with a single unified instanced-billboard particle pool.
- [x] `StorageBufferAttribute` for positions, velocities, lifetimes.
- [x] Compute kernel: radial burst velocity, deceleration curve, lifetime countdown, alpha fade, respawn on trigger.
- [x] Burst triggering via uniform (`uBurstTrigger` set to current time + burst center).
- [x] Up to 50,000 particles in a single instanced draw call (vs. multiple separate `Points` objects).
- [x] WebGL fallback: retain current dynamic `Points` creation pattern.

### 5.4 Compute Buffer Layout Contract (WebGPU Only)
- [x] Use explicit 16-byte aligned struct layout for all compute buffers (position/velocity/life/misc as `vec4` blocks).
- [x] Document byte stride/offsets in `stellar-velocity-compute.js` next to WGSL structs.
- [x] Use ping-pong buffers where write/read hazards exist.
- [x] Prohibit per-frame buffer readbacks from WebGPU compute paths.

### 5.5 Compute Budgets by Quality Tier

| Tier | Max Stars | Max Burst Particles | Max Asteroids | Compute Enabled |
|------|-----------|---------------------|---------------|-----------------|
| Extreme | 8000 | 50000 | 600 | Yes |
| Ultra | 6000 | 40000 | 500 | Yes |
| High | 5000 | 30000 | 400 | Yes |
| Medium | 3000 | 15000 | 250 | Optional |
| Low | 1500 | 5000 | 120 | No |
| Minimal | 800 | 2000 | 60 | No |

Exit criteria:
- Asteroid draw calls collapse to instanced targets (1-3 calls vs. 500).
- Starfield warp simulation runs entirely on GPU with no CPU position writes.
- Compute and CPU paths are runtime-switch safe and visually close.
- No GPU validation errors or CPU readbacks in hot path.

---

### Phase 6: Masterpiece Visual Expansion (Critical)

Objective:
- Raise visual ceiling to world-class masterpiece level while preserving hierarchy and readability.

Files:
- Modify: `src/themes/stellar-velocity/stellar-velocity-theme.js`
- Modify: `src/themes/stellar-velocity/stellar-velocity-materials.js`
- Modify: `src/themes/stellar-velocity/stellar-velocity-post.js`

Tracks:

#### 6A. Warp Tunnel Overhaul
- [x] Replace simple Z-translation stars with proper warp streak geometry (elongated quads or line segments) for high-speed visual.
- [x] Add radial speed lines (thin additive streaks emanating from center) that appear during warp acceleration.
- [x] Add tunnel wall suggestion: faint cylindrical grid or energy lattice visible at high warp, providing spatial reference.
- [x] Implement parallax depth bands: near stars (bright, fast), mid stars (medium), far stars (dim, slow) for stronger depth perception.
- [x] Add subtle tunnel color tinting that shifts with current color scheme.

#### 6B. Warp Core Upgrade
- [x] Upgrade core material with animated plasma banding and swirl noise (TSL FBM domain warping).
- [x] Add energy discharge arcs: random lightning-like tendrils from core to ring edges on combo events.
- [x] Add event-driven core expansion/contraction (breathe with gameplay intensity).
- [x] Upgrade ring system with thickness variation, holographic shimmer, and rotation-speed reactivity.
- [x] Add inner accretion disc: flat glowing ring of spiraling energy particles close to core surface.
- [x] Replace canvas-texture glow planes with TSL procedural gradient sprites (no canvas allocation).

#### 6C. Nebula and Environment Depth
- [x] Add depth-haze layers to avoid flat object stacking.
- [x] Add distant galaxy/star cluster sprites at extreme depth for environmental richness.
- [x] Improve nebula noise with domain warping for more organic, swirling formations.
- [x] Add subtle dust lane silhouettes (dark nebula patches) for contrast and depth.
- [x] Color scheme transitions use smooth cross-fade (LERP over 2-3 seconds) instead of instant switch.

#### 6D. Reactive FX Language
- [x] Implement unified reactive envelope system (multi-channel: pulse, bloom, warp, chromatic, shake):
  ```javascript
  this.reactiveEnvelope = {
      pulse: 0,       // Warp core pulse intensity
      bloom: 0,       // Dynamic bloom strength boost
      warp: 0,        // Warp speed boost
      chromatic: 0,   // Chromatic aberration
      shake: 0,       // Camera shake intensity
      star: 0,        // Starfield flash boost
      nebula: 0,      // Nebula brightness pulse
  };
  ```
- [x] Map gameplay events to unified intensity envelope:
  - `PIECE_LOCK`: `{ star: 0.1, pulse: 0.05 }`
  - `LINE_CLEAR(n)`: `{ pulse: 0.1+n*0.08, warp: 0.05+n*0.03, bloom: 0.05+n*0.06 }`
  - `COMBO(n)`: `{ pulse: 0.2+n*0.1, bloom: 0.1+n*0.08, warp: 0.1+n*0.12, chromatic: 0.05+n*0.1, shake: 0.02+n*0.04, star: 0.1+n*0.1, nebula: 0.1+n*0.05 }`
- [x] Cap cumulative effect intensity to prevent overexposure at high combo rates.
- [x] Ensure all reactive boosts decay predictably and deterministically.
- [x] Add comet/shooting star events: rare, brief streaks across the viewport during idle periods for visual interest.

#### 6E. Asteroid Belt Enhancement
- [x] Add subtle emissive edge highlights on asteroids closest to warp core glow.
- [x] Add micro-debris particles trailing from asteroids (quality-gated: High+ only).
- [x] Asteroid tumble rate increases slightly during warp surges for kinetic energy feel.

Exit criteria:
- Hero-frame visual review passes art-direction checks.
- High-combo gameplay remains readable.
- Warp tunnel feels immersive and cinematic at all speed levels.
- Color scheme transitions are smooth, not jarring.

---

### Phase 7: Performance Scaling and Thermal Safety (Critical)

Objective:
- Hit stable frame budgets across quality tiers and long sessions.

Files:
- Modify: `src/themes/stellar-velocity/stellar-velocity-theme.js`
- Modify: `src/themes/stellar-velocity/stellar-velocity-post.js`

Tasks:
- [x] Add adaptive scaler (resolution + effect budget) with quality floor based on smoothed frame time.
- [x] Add optional pipeline/material warmup (`compileAsync`) where useful.
- [x] Add optional GPU pass timing (timestamp-query when available) for compute/post pass cost attribution.
- [x] Validate preset switching during gameplay under stress.
- [x] Tune quality tables by hardware class and backend path.
- [x] Set hard budgets for draw calls, particle counts, and post cost per tier.
- [x] Profile and optimize hot paths: starfield update, burst particle lifecycle, asteroid orbit.

### Quality Budget Targets

| Tier | Max Draw Calls | Max Post Cost (ms) | Max Stars | Max Burst Particles | Max Asteroids | Adaptive Resolution Scale |
|------|----------------|--------------------|-----------|---------------------|---------------|---------------------------|
| Minimal | 150 | 2.0 | 800 | 2000 | 60 | 0.50 - 0.78 |
| Low | 200 | 2.5 | 1500 | 5000 | 120 | 0.56 - 0.84 |
| Medium | 280 | 3.0 | 3000 | 15000 | 250 | 0.62 - 0.94 |
| High | 380 | 3.8 | 5000 | 30000 | 400 | 0.68 - 1.00 |
| Ultra | 450 | 4.2 | 6000 | 40000 | 500 | 0.72 - 1.00 |
| Extreme | 520 | 4.5 | 8000 | 50000 | 600 | 0.74 - 1.00 |

Initial target budgets:
- High @ 1080p: `>= 60 FPS`, `1% low >= 50 FPS`.
- Medium fallback path: stable `>= 60 FPS` on WebGL-equivalent mode.
- 20-minute soak: no sustained memory growth.

Exit criteria:
- Budgets met on required hardware matrix.
- No thermal runaway or severe frame pacing spikes.

---

### Phase 8: Validation Matrix and Release Gate (Critical)

Objective:
- Final correctness, fallback, and stability validation before release.

Tasks:
- [x] Validate all capability/flag permutations (WebGPU, forced WebGL, noPost, noMRT, noCompute, noEnhancements).
- [x] Run repeated theme-switch and long-session soak tests (100+ activate/deactivate cycles).
- [x] Verify no GPU/renderer/resource leaks in dev diagnostics.
- [x] Validate all gameplay events: `LINE_CLEAR`, `COMBO`, `PIECE_LOCK`.
- [ ] Verify no rendering artifacts (flicker, z-fighting, exploding bloom).
- [ ] Run 30+ minute soak tests for memory stability.
- [x] Freeze final quality budgets and update documentation.
- [ ] Remove proven-dead legacy branches only after signoff.

Implementation note:
- Runtime validation helpers now ship on `window.stellarVelocityBaseline`:
  - `validationRows()`
  - `validationMatrix(options)`
  - `soakValidation(options)`
  - `validationSnapshot(label)`
- Harness controls in `tests/performance/benchmark-stellar-velocity-baseline.html` now expose matrix + soak runs.

Exit criteria:
- Validation checklist passes on required platforms.
- Release candidate approved with reproducible capture package.
- No regressions in gameplay-triggered visuals.
- No growing memory trend during soak tests.

---

## Testing and Validation Matrix

### Functional
- Backend startup scenarios:
  - WebGPU available
  - WebGPU unavailable
  - forced WebGL
  - post disabled
  - MRT disabled
  - compute disabled
  - enhancements disabled
- Theme switch stress: repeated activate/deactivate cycles.
- Event stress: deterministic lock/combo spam sequences.
- Color scheme cycling during all of the above.

### Visual
- Side-by-side captures by preset/backend against baseline pack.
- Hero-frame checks:
  - warp tunnel depth and streak quality
  - warp core energy glow and ring clarity
  - nebula depth layering
  - bloom containment
  - board readability under high combo

### Hardware Matrix (Required)
- Windows desktop NVIDIA (WebGPU + WebGL).
- Windows desktop AMD/Intel (WebGPU + WebGL).
- Apple Silicon macOS (WebGPU + WebGL).
- Intel macOS (WebGL mandatory, WebGPU optional).
- Linux desktop target class (WebGL mandatory, WebGPU optional).

### Performance
- Track per backend/preset:
  - average FPS
  - 1% low
  - frame-time variance
  - draw calls
  - memory footprint
- 20-minute soak test for leak detection.

---

## Risk Register and Mitigations

1. **Scope inflation from visual ambition.**
   Mitigation: strict phase gates and measurable exits before adding new systems.

2. **Compute instability on driver/browser combinations.**
   Mitigation: capability gating, immediate CPU fallback, and diagnostic logging.

3. **MRT incompatibility or material misconfiguration.**
   Mitigation: explicit emissive audits and automatic non-MRT fallback path.

4. **Readability regression from stacked post effects (vignette + bloom + chromatic).**
   Mitigation: hard intensity caps and visual acceptance checks during combo stress tests.

5. **Lifecycle leaks during frequent theme switching.**
   Mitigation: centralized disposable tracking, timer set cleanup, and automated soak validation.

6. **Asteroid instancing regressions (culling, sorting).**
   Mitigation: staged rollout — instancing first, compute later. Keep individual mesh fallback path available during development.

7. **Color scheme cycling conflicts with material uniform updates.**
   Mitigation: smooth cross-fade logic with single owner per uniform update; no race conditions between timer and animation loop.

8. **Double tone mapping (washed highlights).**
   Mitigation: explicit color-pipeline ownership: post graph OR renderer, never both.

9. **Canvas texture leaks (star sprite, glow planes).**
   Mitigation: replace with TSL procedural materials on WebGPU; explicit texture disposal on WebGL path.

10. **WebGPU point-size constraints break star/burst look parity.**
   Mitigation: use instanced billboards/sprites for all large glow particles on WebGPU; keep `Points` fallback for WebGL.

11. **Compute buffer layout/alignment mistakes causing undefined behavior.**
   Mitigation: enforce `vec4`-packed, 16-byte aligned structs with documented offsets and ping-pong buffers where required.

12. **Device-loss recovery loop or repeated reinit thrash.**
   Mitigation: single in-flight recovery guard with forced WebGL downgrade after first loss event.

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rendering mode | Synchronous `render()` | Matches gold standard; avoids async frame timing complexity |
| Material return pattern | `{ material, uniforms, meta }` tuple | Clean separation; enables MRT audit logging (from chromadelic-highway) |
| Bloom control | Per-material class weights | Prevents bloom washout; fine-grained emissive tuning |
| Noise implementation | TSL `tslHash` + `tslNoise` + `tslFbm` | Compile-time graph construction; GPU-native (from black-hole) |
| Asteroid architecture | `InstancedMesh` + compute orbit | 500x draw-call reduction; GPU-native orbit |
| Starfield architecture | Compute warp + instanced billboard stars | Preserves large glow/star-disc look without WebGPU point-size dependence |
| Burst particles | Single compute pool + instanced billboards | Eliminates per-event allocation/disposal overhead and preserves burst readability |
| MRT fail-safe | Disable MRT if any non-node material | Prevents mixed-material rendering crashes |
| Device loss | Auto-restart with WebGL fallback | Graceful recovery without user intervention |
| Color pipeline | Post owns tonemapping on WebGPU post path | Prevents double tonemap and highlight washout |
| Shader compilation | Timeout-guarded `compileAsync` (3s max) | Prevents indefinite stall on slow devices |
| Compute buffer layout | 16-byte aligned `vec4` packing | Cross-driver WGSL safety and predictable buffer parsing |
| Timer management | Tracked timer set, cleared on `stop()` | Prevents setTimeout leaks across theme switches |
| Color cycling | Smooth LERP cross-fade (2-3s) | More cinematic than hard cuts; avoids visual jarring |
| Glow planes | TSL procedural sprites (WebGPU) / Canvas (WebGL) | Eliminates canvas allocation on modern path |

---

## Definition of Done

- Stable hybrid rendering with silent WebGL fallback.
- Deterministic baseline and replay tooling in place.
- WebGPU visual uplift validated as masterpiece-quality warp drive experience.
- Gameplay readability preserved under all combo stress scenarios.
- Performance/reliability targets met across required matrix.
- Documentation reflects shipped architecture, flags, and quality budgets.
- All `setTimeout` calls tracked and cleaned — zero leaks on theme switch.
- Asteroid field uses instanced rendering on both paths.
- Color scheme cycling uses smooth cross-fade transitions.
- No WebGPU feature path depends on oversized point primitives for hero visuals.
