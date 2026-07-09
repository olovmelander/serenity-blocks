# Chromadelic Highway Theme - WebGPU Hybrid Upgrade Plan (World-Class Revision)

## Executive Summary

This revision converts the previous aspirational plan into a production-grade migration and quality plan aligned with the current codebase.

Key outcomes:
- Keep WebGPU-first startup with silent WebGL2 fallback.
- Preserve stable gameplay readability while pushing the Chromadelic look to "masterpiece" quality.
- Close lifecycle, capability-gating, and observability gaps before adding new high-cost effects.
- Ship enhancements in phases with measurable exit criteria, rollback safety, and deterministic validation.

Scope:
- `src/themes/chromadelic-highway/`
- `docs/CHROMADELIC_HIGHWAY_WEBGPU_UPGRADE_PLAN.md`

---

## Current Baseline (Verified)

### Already Implemented

- Hybrid renderer bootstrap exists in `src/themes/chromadelic-highway/chromadelic-highway-theme.js`:
  - Attempts `THREE_WEBGPU.WebGPURenderer` first.
  - Falls back to `THREE.WebGLRenderer`.
  - Tracks `isWebGPU` / `isWebGL`.
- WebGPU post pipeline exists in `src/themes/chromadelic-highway/chromadelic-highway-post.js`:
  - Optional MRT (`output + emissive`).
  - Bloom + chromatic aberration + vignette + tonemap-like grading.
- Node material factories exist in `src/themes/chromadelic-highway/chromadelic-highway-materials.js`.
- Compute scaffolding exists in `src/themes/chromadelic-highway/chromadelic-highway-compute.js`.
- Quality preset framework exists with tiered budgets.
- Event-driven reactivity exists for `PIECE_LOCK`, `COMBO`, `LINE_CLEAR`.

### Remaining Work (Current)

- Long-session thermal/memory hardware campaign is pending (soak tooling is implemented).
- Release signoff capture pack is pending for all required hardware targets.
- Functional release-gate tooling is in place; required hardware executions remain pending.

### Immediate Quality Risks

- Thermal stability can vary by driver/platform and still requires on-device soak evidence.
- Release readiness depends on complete hardware signoff captures, not tooling alone.

---

## Target End State

### Rendering Contract

- Startup never hard-fails due to WebGPU availability.
- Runtime selects one of these supported paths:
  - WebGPU + MRT + compute (full feature set)
  - WebGPU + MRT + CPU particle fallback
  - WebGPU without MRT
  - WebGPU without post
  - WebGL2 fallback (`EffectComposer`)
- Every optional feature is gated by both capability checks and debug flags.

### Visual Contract (Masterpiece Bar)

- Signature identity: high-speed psychedelic tunnel with disciplined color separation and cinematic depth.
- Player-reactive effects enhance gameplay moments without obscuring board readability.
- Visual hierarchy remains intentional at all quality levels:
  - Tier 1: road readability and motion direction
  - Tier 2: tunnel rhythm and ring cadence
  - Tier 3: celestial and atmospheric spectacle

### Reliability Contract

- Clean theme switches with no leaked listeners, RAF loops, timers, render targets, or GPU buffers.
- Deterministic replay for visual regression checks.
- Cross-backend parity defined by concrete acceptance captures, not subjective memory.

---

## Platform Constraints

- Three.js: `^0.181.2`
- Electron: `^38.3.0`
- WebGPU availability is optional and must not gate startup.
- WebGL fallback remains first-class and shippable.

---

## Capability Matrix and Kill Switches

| Runtime | Post | MRT | Compute | Expected Path |
|--------|------|-----|---------|---------------|
| WebGPU + MRT + Compute | Yes | Yes | Yes | Full Chromadelic feature set |
| WebGPU + MRT, no Compute | Yes | Yes | No | Node materials + CPU particle fallback |
| WebGPU, no MRT | Yes | No | Optional | Standard bloom path |
| WebGPU, no Post | No | No | Optional | Direct scene render |
| WebGL2 fallback | `EffectComposer` | No | No | Stable fallback-quality experience |

Required debug flags:
- `?forceWebGL=1`
- `?chromadelicNoPost=1`
- `?chromadelicNoMRT=1`
- `?chromadelicNoCompute=1`
- `?chromadelicBaseline=1`
- `?chromadelicSeed=1234`
- `?chromadelicFixedDt=16.666`

Rule:
- Optional systems are active only when both capability and flag checks pass.

### Final Capability Matrix (Shipped Runtime)

| Runtime | Post | MRT | Compute | Path Status |
|--------|------|-----|---------|-------------|
| WebGPU + MRT + Compute | Yes | Yes | Yes | Shipped |
| WebGPU + MRT, no Compute | Yes | Yes | No | Shipped |
| WebGPU, no MRT | Yes | No | Optional | Shipped |
| WebGPU, no Post | No | No | Optional | Shipped |
| WebGL2 fallback | `EffectComposer` | No | No | Shipped |

### Final Quality Budgets (Shipped Defaults)

| Tier | Max Draw Calls | Max Post Cost (ms) | Max Speed Particles | Max Ambient Particles | Max Shooting Stars | Under-Road Glow | Adaptive Resolution Scale |
|------|----------------|--------------------|---------------------|-----------------------|-------------------|-----------------|---------------------------|
| Minimal | 200 | 2.2 | 60 | 90 | 1 | No | 0.50 - 0.78 |
| Low | 260 | 2.6 | 120 | 160 | 2 | No | 0.56 - 0.84 |
| Medium | 350 | 3.2 | 340 | 420 | 3 | No | 0.62 - 0.94 |
| High | 430 | 4.0 | 900 | 820 | 4 | Yes | 0.68 - 1.00 |
| Ultra | 500 | 4.5 | 2200 | 1500 | 5 | Yes | 0.72 - 1.00 |
| Extreme | 560 | 4.8 | 3000 | 2000 | 6 | Yes | 0.74 - 1.00 |

---

## Migration Policy

- Stability first: lifecycle hardening before new expensive visuals.
- Introduce one major rendering risk at a time.
- Keep WebGL visual parity unless explicitly accepted as a deliberate difference.
- Do not remove fallback code until parity and perf gates pass.
- Each phase has objective, file scope, tasks, and hard exit criteria.

Non-goals until Phase 6+:
- Large new simulation systems without measured bottleneck evidence.
- Effect additions that reduce board legibility under gameplay stress.

---

## World-Class Art Direction Lock

### Visual Pillars

- Infinite neon road with clear forward motion vector at all times.
- Tunnel ring cadence synced to perceived speed and rhythm.
- Celestial composition that supports depth, not clutter.
- Reactive pulses that feel musical, not noisy.

### Color Script

- Controlled rainbow gradients with protected dark-value floor.
- Highlight peaks are concentrated around gameplay events, not constant.
- Avoid full-frame saturation clipping and persistent white bloom washout.

### Camera and Composition

- Maintain stable horizon and road-center anchoring.
- Keep one dominant focal target (planet corridor) with secondary accents.
- Preserve silhouette contrast in distant layers.

### Readability Rules

- Combo effects must not hide board edges or piece contrast.
- Bloom budget is capped per quality tier.
- Chromatic aberration remains subtle and event-scaled.

---

## Phase Plan

### Phase 0: Baseline Lock and Instrumentation (Critical)

Objective:
- Establish objective visual/performance baselines and deterministic replay.

Files:
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-theme.js`
- Create/Modify: Chromadelic capture scripts under `tests/`
- Create: `docs/CHROMADELIC_HIGHWAY_ART_DIRECTION.md`
- Create: `docs/CHROMADELIC_HIGHWAY_BASELINE_CAPTURE_PROTOCOL.md`

Tasks:
- [x] Define hero-frame captures for each quality tier and backend.
- [x] Add deterministic controls (`chromadelicSeed`, `chromadelicFixedDt`, canned event playback).
- [x] Capture baseline metrics: FPS, 1% low, frame-time variance, draw calls, GPU memory estimate.
- [x] Record readability anchors during `LINE_CLEAR` and high-combo events.

Exit criteria:
- Baseline pack committed and reproducible.
- Art-direction packet approved and frozen.

---

### Phase 1: Renderer and Lifecycle Hardening (Critical)

Objective:
- Make startup/shutdown and fallback transitions robust.

Files:
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-theme.js`

Tasks:
- [x] Consolidate capability detection into `this.capabilities` (WebGPU, MRT, compute, post).
- [x] Implement safe device-loss recovery flow (dispose + controlled re-init or fallback).
- [x] Ensure all listeners/RAF handles are tracked and removed once.
- [x] Guarantee disposal of post/composer/render targets/textures across all exits.
- [x] Keep color management and tone mapping behavior consistent between backends.

Exit criteria:
- 100+ theme switches with no listener/timer/resource leaks.
- WebGPU init failure and device-loss scenarios recover without black screen.

---

### Phase 2: Render Path Abstraction and Parity (High)

Objective:
- Centralize render flow and stabilize backend-specific behavior.

Files:
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-theme.js`
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-post.js`

Tasks:
- [x] Introduce single `renderFrame()` abstraction:
  - WebGPU post path
  - WebGL composer path
  - direct render path
- [x] Gate MRT with `capabilities.mrt && !flags.noMRT`.
- [x] Add fallback from post failure to direct rendering without theme crash.
- [x] Normalize resize behavior for renderer/composer/post targets.

Exit criteria:
- All capability/flag permutations run without runtime errors.
- WebGL path remains visually coherent versus baseline captures.

---

### Phase 3: Material and Emissive Audit (Critical)

Objective:
- Ensure node materials and emissive behavior are correct before heavier effects.

Files:
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-materials.js`
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-theme.js`

Tasks:
- [x] Audit all WebGPU materials for explicit emissive intent under MRT.
- [x] Ensure non-bloom surfaces output zero emissive in MRT path.
- [x] Keep uniform update handles in stable per-material data structures.
- [x] Add dev-only material audit logs for missing emissive declarations.

Exit criteria:
- Bloom isolation affects intended elements only.
- No material compile/runtime warnings on WebGPU path.

---

### Phase 4: Compute Completion and Fallback Guarantees (High)

Objective:
- Complete compute integration where it provides clear value, with safe CPU fallback.

Files:
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-compute.js`
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-materials.js`
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-theme.js`

Tasks:
- [x] Wire ambient compute path end-to-end (init, buffer binding, per-frame dispatch, disposal).
- [x] Keep speed particle compute path deterministic under fixed-delta mode.
- [x] Add feature budget guardrails by quality tier (no compute on low tiers).
- [x] Defer road deformation compute until profiling proves CPU road update is a bottleneck.
- [x] Treat shooting star compute as optional milestone after core particle stability.

Exit criteria:
- Compute and CPU paths are visually close and runtime-switch safe.
- No GPU validation errors or CPU readbacks in hot path.

---

### Phase 5: Masterpiece Visual Expansion (Critical)

Objective:
- Raise visual ceiling while preserving hierarchy and readability.

Files:
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-theme.js`
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-materials.js`
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-post.js`

Tracks:

#### 5A. Celestial Composition
- [x] Refine multi-planet staging into one primary focal corridor plus restrained secondary bodies.
- [x] Add depth-separated haze layers to prevent flat background stacking.
- [x] Keep motion arcs slow and intentional relative to road speed.

#### 5B. Road and Tunnel Drama
- [x] Add controlled holographic lane modulation tied to pace multiplier.
- [x] Introduce ring-shape variation with strict cadence limits (avoid visual noise).
- [x] Add under-road glow only when budget allows and readability remains intact.

#### 5C. Reactive FX Language
- [x] Map gameplay events to unified intensity envelope system.
- [x] Cap cumulative effect intensity to prevent overexposure at high combo rates.
- [x] Ensure all reactive boosts decay predictably and deterministically.

Exit criteria:
- Hero-frame review passes art-direction checklist.
- High-combo readability remains within acceptance thresholds.

---

### Phase 6: Performance, Scaling, and Thermal Safety (Critical)

Objective:
- Hit stable frame budgets across quality tiers and hardware classes.

Files:
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-theme.js`
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-post.js`

Tasks:
- [x] Set hard budgets for draw calls, particle counts, and post cost per tier.
- [x] Add adaptive scaler (resolution/effect budgets) based on smoothed frame time.
- [x] Precompile materials/pipelines where supported (`compileAsync`) with timeout safeguards.
- [ ] Validate long-session thermal stability and memory behavior (soak tooling implemented; hardware campaign pending).

Target budgets (initial):
- 1080p desktop: >= 60 FPS, 1% low >= 50 FPS on `High`.
- 4K desktop: >= 60 FPS on `High` only if adaptive scaler remains within image-quality floor.
- Fallback WebGL: visually coherent at >= 60 FPS on `Medium` equivalent.

Exit criteria:
- Budgets met on representative hardware matrix.
- No sustained memory growth in 20+ minute soak runs.

---

### Phase 7: Decommission, Documentation, and Release Gate (High)

Objective:
- Remove dead branches safely and lock release quality.

Files:
- Modify: `src/themes/chromadelic-highway/chromadelic-highway-theme.js`
- Modify: `docs/CHROMADELIC_HIGHWAY_WEBGPU_UPGRADE_PLAN.md`
- Delete: `src/themes/chromadelic-highway/webgl-chromadelic-renderer.js` (unused legacy path)
- Create: `docs/CHROMADELIC_HIGHWAY_RELEASE_QA_CHECKLIST.md`

Tasks:
- [x] Remove stale/unused code paths proven unnecessary by telemetry and tests.
- [x] Update docs with final capability matrix and quality budgets.
- [ ] Produce release QA checklist and signoff captures (checklist + signoff/campaign + functional gate tooling added; hardware captures pending).

Exit criteria:
- No unused legacy path remains in active runtime route.
- Final QA checklist passes on all required platforms.

---

## Testing and Validation Matrix

### Functional

- Backend startup scenarios:
  - WebGPU available
  - WebGPU unavailable
  - force WebGL
  - post disabled
  - MRT disabled
  - compute disabled
- Theme switch stress: repeated activate/deactivate cycles.
- Event stress: sustained combo spam with deterministic playback.

### Visual

- Side-by-side baseline diffs per quality tier and backend.
- Hero-frame checks:
  - road readability
  - ring cadence
  - focal planet composition
  - bloom containment

### Hardware Matrix (Required)

- Desktop high-end NVIDIA (Windows): WebGPU + WebGL.
- Desktop mid-tier AMD/Intel (Windows): WebGPU + WebGL.
- Apple Silicon (macOS): WebGPU + WebGL.
- Intel macOS (if supported in release target): WebGL mandatory, WebGPU optional.
- Linux desktop (if release target): WebGPU optional, WebGL mandatory.

### Performance

- Metrics per preset and backend:
  - average FPS
  - 1% low
  - frame-time variance
  - draw calls
  - memory
- 20-minute soak test for leak detection.

---

## Risk Register and Mitigations

1. Over-saturated post pipeline reduces gameplay readability.
Mitigation: hard intensity caps, hero-frame checks, combo stress tests.

2. Compute integration instability on certain drivers.
Mitigation: strict capability gating, immediate CPU fallback, validation logging.

3. MRT incompatibilities across backends/devices.
Mitigation: runtime MRT detection, non-MRT post path, fallback to direct render.

4. Scope creep from "masterpiece" ambitions.
Mitigation: phase gates with measurable exit criteria and explicit deferrals.

---

## Definition of Done

- Stable hybrid rendering with silent fallback.
- Deterministic visual/perf baselines tracked and reproducible.
- Masterpiece-quality visual direction validated against art-direction checklist.
- Performance and reliability gates satisfied on target hardware.
- Documentation reflects the shipped architecture and operational guardrails.
