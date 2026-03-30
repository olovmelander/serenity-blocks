# Stellar Drift Theme - WebGPU Hybrid Upgrade Plan (World-Class Revision)

## Executive Summary

This revision converts Stellar Drift from a WebGL-only, single-file implementation into a production-grade hybrid renderer with strict fallback behavior, deterministic validation, and staged risk control.

Key outcomes:
- WebGPU-first startup with silent WebGL2 fallback.
- Dual render paths: WebGPU (`TSL` + `THREE.PostProcessing`) and WebGL (`ShaderMaterial` + `EffectComposer`).
- Compute and instancing introduced only after lifecycle and parity gates pass.
- Signature Stellar Drift identity preserved: heroic gas giant, rich nebula depth, warp-speed responsiveness.
- Measurable performance, reliability, and visual acceptance gates per phase.

Scope:
- `src/themes/stellar-drift/`
- `public/textures/stellar-drift/`
- `docs/STELLAR_DRIFT_WEBGPU_UPGRADE_PLAN.md`

---

## Current Baseline (Verified)

### Renderer and Pipeline
- `THREE.WebGLRenderer` only in `src/themes/stellar-drift/stellar-drift-theme.js`.
- WebGL post chain via `EffectComposer` + `RenderPass` + `UnrealBloomPass` + custom shader passes.
- No WebGPU bootstrap, capability matrix, or runtime feature negotiation.

### Active Scene and FX Systems
- Custom `ShaderMaterial` starfield with warp-driven elongation.
- Shader-based Jupiter-like planet and textured nebula backdrop.
- Dust ring and ambient particles using `PointsMaterial`.
- Meteor field built as many individual `Mesh` instances (no instancing).
- Event-reactive gameplay effects:
  - Shockwave rings
  - Shooting stars
  - Nebula burst particles
  - Warp-speed post controls (vignette/chromatic/radial)

### Architecture Constraints
- Theme logic is monolithic (`stellar-drift-theme.js` only; no materials/compute/post modules).
- Multiple CPU-per-frame particle/object update loops.
- No deterministic replay hooks (`seed`, fixed delta, canned event sequence).
- No backend-specific render abstraction (`renderFrame`) yet.

### Immediate Risks to Close Before Expanding Scope
- Lifecycle hardening is incomplete for a hybrid renderer migration (device loss, controlled fallback, full resource teardown).
- Timed gameplay effects rely on raw `setTimeout` usage and are not centrally tracked/cleared.
- Expensive visual ambitions are specified before objective baseline captures and budgets.
- Current file size and responsibility concentration increase regression risk for large migrations.

---

## Platform Constraints

- Three.js: `^0.181.2`
- Electron: `^38.3.0`
- Startup must never fail due to WebGPU availability.
- WebGL fallback is a first-class runtime, not a temporary compatibility shim.

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

### Visual Contract
- Preserve Stellar Drift identity:
  - Hero gas giant and rings as primary focal anchor
  - Multi-layer nebula depth and controlled color rhythm
  - Warp-speed momentum language tied to gameplay intensity
- WebGPU path may look richer, but gameplay readability remains non-negotiable on all tiers.

### Reliability Contract
- Theme switches are leak-free across long sessions.
- No leaked listeners, RAF loops, timers, render targets, textures, storage buffers, or compute pipelines.
- Device-loss and post-pipeline failures recover to a valid render path.

### Performance Contract
- High tier target: sustained 60 FPS at 1080p on mid-range discrete GPU class.
- Low/Minimal tiers remain stable with conservative post and simulation budgets.
- Adaptive scaling is smooth, bounded, and testable.

---

## Capability Matrix and Kill Switches

| Runtime | Post | MRT | Compute | Expected Path |
|--------|------|-----|---------|---------------|
| WebGPU + MRT + Compute | Yes | Yes | Yes | Full Stellar feature set |
| WebGPU + MRT, no Compute | Yes | Yes | No | Node materials + CPU particle fallback |
| WebGPU, no MRT | Yes | No | Optional | Standard bloom path |
| WebGPU, no Post | No | No | Optional | Direct scene render |
| WebGL2 fallback | `EffectComposer` | No | No | Stable fallback-quality experience |

Required debug flags:
- `?forceWebGL=1`
- `?stellarNoPost=1`
- `?stellarNoMRT=1`
- `?stellarNoCompute=1`
- `?stellarMrtAudit=1`
- `?stellarNoDrs=1`
- `?stellarNoVolume=1`
- `?stellarBaseline=1`
- `?stellarSeed=1234`
- `?stellarFixedDt=16.666`

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

---

## World-Class Art Direction Lock

### Visual Pillars
- Hero planet remains the dominant compositional anchor.
- Nebula field creates depth layers, not uniform full-frame noise.
- Warp effects communicate acceleration and event intensity without overwhelming the board.
- Secondary celestial bodies support composition and scale, not clutter.

### Color Script
- Deep-space base with controlled magenta/cyan/indigo accents.
- Peak saturation reserved for gameplay moments (lock/combo bursts).
- Avoid persistent bloom washout and full-frame clipping.

### Readability Rules
- Board edge contrast remains intact during high-combo effects.
- Chromatic aberration and radial effects are capped and event-scaled.
- Bloom is emissive-isolated once MRT is enabled.

---

## Phase Plan

### Phase 0: Baseline Lock and Instrumentation (Critical)

Objective:
- Establish deterministic visual/performance baselines before migration.

Files:
- Modify: `src/themes/stellar-drift/stellar-drift-theme.js`
- Create/Modify: Stellar capture helpers under `tests/`
- Create: `docs/STELLAR_DRIFT_ART_DIRECTION.md`
- Create: `docs/STELLAR_DRIFT_BASELINE_CAPTURE_PROTOCOL.md`

Tasks:
- [x] Define hero-frame captures for each quality tier.
- [x] Add deterministic controls (`stellarSeed`, `stellarFixedDt`, canned event playback).
- [x] Record baseline metrics: FPS, 1% low, frame-time variance, draw calls, memory.
- [x] Capture readability anchors during lock/combo heavy sequences.

Exit criteria:
- Baseline pack committed and reproducible.
- Art-direction packet approved and frozen.

---

### Phase 1: Renderer Bootstrap and Lifecycle Hardening (Critical)

Objective:
- Introduce robust hybrid boot and cleanup behavior.

Files:
- Modify: `src/themes/stellar-drift/stellar-drift-theme.js`

Tasks:
- [x] Implement explicit WebGPU-first async init with WebGL fallback.
- [x] Add consolidated capability object (`webgpu`, `post`, `mrt`, `compute`).
- [x] Parse/store debug flags in `this.flags`.
- [x] Add device-loss handling and safe fallback/reinit flow.
- [x] Track/clear all timers (`setTimeout`) and RAF handles on `stop()`.
- [x] Ensure post/renderer/material/texture cleanup is complete and idempotent.

Exit criteria:
- 100+ activate/deactivate cycles with no listener/timer/resource leaks.
- WebGPU init failure and device-loss scenarios recover without black screen.

---

### Phase 2: Render Path Abstraction and Backend Parity (High)

Objective:
- Centralize frame rendering and backend-specific behavior.

Files:
- Modify: `src/themes/stellar-drift/stellar-drift-theme.js`
- Create: `src/themes/stellar-drift/stellar-drift-post.js`

Tasks:
- [x] Introduce single `renderFrame()` abstraction:
  - WebGPU post path
  - WebGL composer path
  - direct render fallback
- [x] Normalize resize behavior across renderer/composer/post targets.
- [x] Ensure post failure auto-falls back to direct rendering.
- [x] Keep tone mapping and output color-space behavior aligned across backends.

Exit criteria:
- All flag/capability permutations run without runtime errors.
- WebGL path remains visually coherent versus baseline captures.

---

### Phase 3: Material Modularization and TSL Migration (Critical)

Objective:
- Split material responsibilities and migrate core shaders to node materials on WebGPU.

Files:
- Create: `src/themes/stellar-drift/stellar-drift-materials.js`
- Modify: `src/themes/stellar-drift/stellar-drift-theme.js`

Tasks:
- [x] Build dual-path material factories (WebGPU node + WebGL fallback material/shader).
- [x] Migrate in this order:
  1. [x] Starfield
  2. [x] Planet + glow
  3. [x] Nebula backdrop
  4. [x] Dust ring and ambient particles
  5. [x] Shockwave ring and shooting star materials
- [x] Store uniform/update handles in stable per-material structures (`userData`).
- [x] Add material audit checks for emissive readiness before MRT enablement.

Exit criteria:
- WebGPU path compiles cleanly with no material warnings.
- WebGL visuals remain parity-safe.

---

### Phase 4: WebGPU Post Pipeline and MRT Bloom Isolation (High)

Objective:
- Move WebGPU path to native post-processing and isolate bloom via emissive MRT.

Files:
- Create/Modify: `src/themes/stellar-drift/stellar-drift-post.js`
- Modify: `src/themes/stellar-drift/stellar-drift-materials.js`
- Modify: `src/themes/stellar-drift/stellar-drift-theme.js`

Tasks:
- [x] Implement `THREE.PostProcessing` chain for WebGPU path.
- [x] Gate MRT by capability and flag (`!stellarNoMRT`).
- [x] Ensure non-bloom surfaces output zero emissive in MRT mode.
- [x] Keep fallback to non-MRT post and then direct render when needed.
- [x] Add dev-only post/material diagnostics for MRT mismatches.

Exit criteria:
- Bloom affects intended emissive elements only.
- No MRT validation errors; fallback path always available.

---

### Phase 5: Compute and Instancing Migration (High)

Objective:
- Reduce CPU simulation load and draw-call overhead with safe fallbacks.

Files:
- Create: `src/themes/stellar-drift/stellar-drift-compute.js`
- Modify: `src/themes/stellar-drift/stellar-drift-theme.js`

Tasks:
- [x] Convert meteor field to `InstancedMesh` before compute adoption.
- [x] Add compute-backed ambient/dust/burst simulation on WebGPU.
- [x] Keep deterministic CPU fallback for WebGL and `stellarNoCompute` mode.
- [x] Avoid CPU readbacks in hot path.
- [x] Enforce per-tier simulation budgets.

Exit criteria:
- Meteor belt draw calls collapse to instanced targets.
- Compute and CPU paths are runtime-switch safe and visually close.

---

### Phase 6: Masterpiece Visual Expansion (Critical)

Objective:
- Raise visual ceiling while preserving hierarchy and readability.

Files:
- Modify: `src/themes/stellar-drift/stellar-drift-theme.js`
- Modify: `src/themes/stellar-drift/stellar-drift-materials.js`
- Modify: `src/themes/stellar-drift/stellar-drift-post.js`

Tracks:

#### 6A. Celestial Composition
- [x] Add restrained secondary bodies (ringed planet, ice moon, rocky distant body).
- [x] Keep one dominant focal corridor centered on hero Jupiter.
- [x] Add depth-haze layers to avoid flat object stacking.

#### 6B. Hero Planet Quality
- [x] Upgrade Jupiter material with animated banding and atmospheric scattering.
- [x] Add event-driven lightning flashes with hard intensity caps.
- [x] Upgrade ring system with gap structure and controlled glitter response.

#### 6C. Reactive FX Language
- [x] Unify lock/combo effects under shared envelope curves.
- [x] Add comet/aurora events only where budget and readability allow.
- [x] Ensure deterministic decay and capped cumulative intensity.

Exit criteria:
- Hero-frame visual review passes art-direction packet checks.
- High-combo gameplay remains readable.

---

### Phase 7: Performance Scaling and Thermal Safety (Critical) ✅

Objective:
- Hit stable frame budgets across quality tiers and long sessions.

Files:
- Modify: `src/themes/stellar-drift/stellar-drift-theme.js`
- Modify: `src/themes/stellar-drift/stellar-drift-post.js`

Tasks:
- [x] Add adaptive scaler (resolution + effect budget) with quality floor.
- [x] Add optional pipeline/material warmup (`compileAsync`) where useful.
- [x] Validate preset switching during gameplay under stress (`runQualitySwitchStress`).
- [x] Tune quality tables by hardware class and backend path (`detectHardwareClass`).

Initial target budgets:
- High @ 1080p: `>= 60 FPS`, `1% low >= 50 FPS`.
- Medium fallback path: stable `>= 60 FPS` on WebGL-equivalent mode.
- 20-minute soak: no sustained memory growth.

Exit criteria:
- Budgets met on required hardware matrix.
- No thermal runaway or severe frame pacing spikes.

---

### Phase 8: Validation Matrix and Release Gate (Critical) ✅

Objective:
- Final correctness, fallback, and stability validation before release.

Tasks:
- [x] Validate all capability/flag permutations (`runValidationMatrix`).
- [x] Run repeated theme-switch and long-session soak tests (`runThemeSwitchSoak`).
- [x] Verify no GPU/renderer/resource leaks in dev diagnostics.
- [x] Freeze final quality budgets and update documentation.
- [ ] Remove proven-dead legacy branches only after signoff.

Exit criteria:
- Validation checklist passes on required platforms.
- Release candidate approved with reproducible capture package.

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
- Theme switch stress: repeated activate/deactivate cycles.
- Event stress: deterministic lock/combo spam sequences.

### Visual
- Side-by-side captures by preset/backend against baseline pack.
- Hero-frame checks:
  - focal planet clarity
  - depth layering of nebulas
  - warp readability under high combo
  - bloom containment

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

---

## Risk Register and Mitigations

1. Scope inflation from visual ambition.
Mitigation: strict phase gates and measurable exits before adding new systems.

2. Compute instability on driver/browser combinations.
Mitigation: capability gating, immediate CPU fallback, and diagnostic logging.

3. MRT incompatibility or material misconfiguration.
Mitigation: explicit emissive audits and automatic non-MRT fallback path.

4. Readability regression from stacked post effects.
Mitigation: hard intensity caps and visual acceptance checks during combo stress tests.

5. Lifecycle leaks during frequent theme switching.
Mitigation: centralized disposable tracking and automated soak validation.

---

## Definition of Done

- Stable hybrid rendering with silent WebGL fallback.
- Deterministic baseline and replay tooling in place.
- WebGPU visual uplift validated without gameplay readability loss.
- Performance/reliability targets met across required matrix.
- Documentation reflects shipped architecture, flags, and quality budgets.
