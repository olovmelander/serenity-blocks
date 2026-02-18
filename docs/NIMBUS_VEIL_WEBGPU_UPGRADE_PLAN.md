# Nimbus Veil Theme - WebGPU Hybrid Upgrade Plan (World-Class v3)

## Executive Summary

This plan upgrades Nimbus Veil from a WebGL-only atmospheric background into a release-grade hybrid WebGPU/WebGL2 renderer with:

- Sky-inspired art direction locked by measurable acceptance rules.
- WebGPU-first startup with silent, safe WebGL fallback.
- Volumetric cloud depth, compute-driven spirit swarms, and divine post-lighting.
- Deterministic validation, strict lifecycle hygiene, and rollback-safe release gates.

This is an implementation plan, not a concept note. Each phase has concrete scope, risk boundaries, and pass/fail criteria.

Scope:
- `src/themes/nimbus-veil/`
- `docs/NIMBUS_VEIL_WEBGPU_UPGRADE_PLAN.md`
- New docs produced in Phase 0:
  - `docs/NIMBUS_VEIL_ART_DIRECTION.md`
  - `docs/NIMBUS_VEIL_BASELINE_CAPTURE_PROTOCOL.md`

---

## Table of Contents

1. Art Direction Lock
2. Current Baseline (Verified)
3. Platform and Compatibility Constraints
4. Target Runtime Architecture
5. Render Graph Specification
6. Quality Tier Contract
7. Technical Implementation Specs
8. Non-Negotiable Engineering Gates
9. Phase Plan
10. Testing and Validation Matrix
11. Risk Register and Rollback Playbook
12. Implementation Priority Order
13. Ownership and Estimates
14. Release and Rollout Strategy
15. Definition of Done
16. References

---

## 1) Art Direction Lock

### 1.1 North Star

"A sacred upper-atmosphere world where clouds feel traversable, light feels benevolent, and gameplay events read as spiritual weather."

### 1.2 Visual Pillars (All Must Hold)

- Volumetric softness: clouds read as depth volumes, not layered cards.
- Luminous guidance: moonlight and god rays establish direction and emotional focus.
- Fluid spirits: motes move as living currents, never jittery random noise.
- Emotional restraint: effects escalate with gameplay but remain calm and legible.
- Atmospheric continuity: palette, contrast, and motion stay meditative.

### 1.3 Anti-Goals (Automatic Reject)

- Persistent full-screen bloom haze.
- Neon/cyberpunk clipping or hard-edged glows.
- Aggressive camera motion or strobing transitions.
- Straight-line robotic particle drift.
- Any effect that degrades board readability under combo stress.

### 1.4 Nimbus Palette Lock

| Layer | Hex | Use |
|------|-----|-----|
| Abyss Shadow | `#0B1020` | Scene base, far negative space |
| Deep Veil | `#15233A` | Distant volume anchor |
| Far Vapor | `#1D2A46` | Background cloud mass |
| Mid Cloud | `#4E6F97` | Primary cloud body |
| Moonlit Cyan | `#88BFD0` | Guided mid-highlight |
| Silver Rim | `#DCEAF4` | Cloud silver-lining edges |
| Divine White | `#F7F5EE` | Rare peak highlights |
| Sacred Gold | `#F3D8A2` | Event accent only |
| Veil Haze | `#A7B9CF` | Fog unifier |

Color rules:
- Near layers stay darker/cooler for readability.
- Mid/far layers brighten softly toward cyan/silver.
- Divine white and sacred gold are short-lived event states, never baseline.

### 1.5 Motion Grammar

- Cloud drift period: 30-90 seconds per macro loop.
- Spirit swarm flow: curl-noise advection with low-frequency direction changes.
- Camera drift: subtle and continuous, no sudden accelerations.
- Event response:
  - Line clear: internal cloud charge + gentle pulse ring.
  - Combo: wider turbulence and shaft intensity lift.
  - Piece lock: vertical light pillar with soft fade.

### 1.6 Hero Frames and Acceptance Shots

The art packet must define fixed camera seeds and event windows:
- Shot A: idle serenity (no events, 8 seconds).
- Shot B: 4-line clear event burst.
- Shot C: sustained combo chain (10+).
- Shot D: low-tier fallback scene parity.
- Shot E: forced WebGL fallback parity.

Each shot is captured for all enabled tiers and both backends.

### 1.7 Visual Acceptance Checklist

- [ ] Cloud volume depth is obvious in static stills.
- [ ] God rays align with moon vector and cloud density.
- [ ] Spirits read as fluid and coherent.
- [ ] Board boundary remains clearly readable at max combo intensity.
- [ ] No persistent clipping in highlights.

### 1.8 Sky Fidelity Rubric (Signoff Required)

Score each item from 1-5 on every hero shot and each active tier (`High`, `Ultra`, `WebGL fallback`):

| Category | What "5" Means |
|---------|-----------------|
| Sacred Atmosphere | Scene feels calm, expansive, and contemplative, never busy |
| Cloud Presence | Clouds feel volumetric and traversable, not card-like |
| Light Spirituality | Light shafts and rim glow feel guiding/benevolent, not harsh |
| Motion Grace | All movement feels smooth and wind-driven, no jitter/strobe |
| Event Poetry | Gameplay reactions feel like weather, not UI explosions |
| Readability Safety | Board remains readable even at combo peaks |

Rubric gate:
- Minimum per-category score: `4`.
- Average score across categories: `>= 4.4`.
- If any category is `< 4`, phase is blocked.

### 1.9 Sky-Inspired Style Guardrails

To stay faithful to Sky-like feel while preserving original work:

- Emulate mood principles (soft volumetrics, guiding light, serene flow), not specific assets or scene compositions.
- No direct copying of characters, symbols, iconography, audio motifs, or signature set pieces.
- Maintain Nimbus identity through palette lock and gameplay-reactive weather language.

### 1.10 Visual Drift Reject Conditions

Reject as art-direction failure if any of the following are observed:

- Cloud noise reads as static texture instead of atmospheric volume.
- Highlights clip for more than 0.5 seconds during normal gameplay events.
- Combo sequences create aggressive strobing or rapid contrast pumping.
- Spirit motion shows noticeable linear trajectories for sustained periods.
- WebGL fallback loses the serene mood and reads as a different theme.

### 1.11 Sky-Inspired Composition Locks (Nimbus-Specific)

To keep the Sky-like emotional language while preserving Nimbus originality:

- Maintain three readable depth bands in all hero shots:
  - near veil: 20-35% frame occupancy
  - mid cloud body: 35-55%
  - far atmosphere/void: 20-35%
- Keep guiding moon-light anchor in upper third (left or right), never centered over board.
- Preserve negative-space window around active board region; cloud opacity in that region must stay capped by readability rules.
- Motion cadence must remain meditative:
  - no camera acceleration spikes
  - no abrupt cloud direction reversals
  - no rhythmic pulses that feel UI-like rather than weather-like
- Use original procedural shapes/noise fields and internal palette lock only; no direct scene reconstruction of third-party art layouts.

---

## 2) Current Baseline (Verified)

### 2.1 Runtime and Pipeline

- `THREE.WebGLRenderer` only (`src/themes/nimbus-veil/nimbus-veil-theme.js`).
- Post: `EffectComposer` + `RenderPass` + `UnrealBloomPass`.
- Existing shader module already extracted:
  - `src/themes/nimbus-veil/nimbus-veil-shaders.js`.

### 2.2 Scene Inventory

| System | Current State |
|-------|---------------|
| Clouds | `ShaderMaterial` billboards, count 4-15 by quality |
| Dust | Single CPU-updated `THREE.Points`, count 200-1500 |
| Stars | `THREE.Points`, count 300-2500 |
| Mist | Billboards, count 2-8 |
| FX | Pulse waves, bloom boosts, light burst |
| Presets | Minimal/Low/Medium/High/Ultra/Extreme |

### 2.3 Known Risk Gaps

- Resize listener removal bug (`bind` mismatch add/remove).
- Untracked `setTimeout` usage in event handlers.
- No WebGPU bootstrap or capability negotiation.
- CPU-bound particle updates.
- No device-loss recovery path.
- No deterministic seed/fixed-step capture mode.

---

## 3) Platform and Compatibility Constraints

### 3.1 Platform Pins

- Three.js: `^0.181.2`
- Electron: `^38.3.0`
- Startup must never fail on missing/failed WebGPU.
- WebGL fallback is a first-class runtime, not a debug-only mode.

### 3.2 Compatibility Constraints (Critical)

1. No reliance on oversized WebGPU point sprites for hero glow visuals.
2. WGSL structs must be 16-byte aligned (`vec4` packing).
3. No per-frame GPU readbacks in hot loops.
4. Tone-mapping ownership must be single-path per frame.
5. Optional systems must be capability-gated and flag-gated.

### 3.3 WebGPU Capability Negotiation Contract (Mandatory)

Renderer bootstrap must follow this contract:

1. Attempt WebGPU first via async init and explicitly verify backend identity.
2. Populate `this.capabilities` only after renderer init completes.
3. Treat advanced systems as optional:
   - compute spirits
   - MRT emissive isolation
   - timestamp query profiling
4. Do not make optional visual features required for startup success.
5. On any init/compile/device-loss failure, downgrade once per ladder step and set sticky flags for the session.

Feature detection rules:
- Call `renderer.hasFeature(...)` only after `await renderer.init()`.
- Cache capability checks once per session; do not re-query hot paths.
- Record a capability snapshot in baseline and release evidence.

### 3.4 Accessibility and Comfort Constraints (Release-Blocking)

- Respect reduced-motion user preference and explicit calm-mode flag.
- Avoid strobe-like luminance pumping during combo chains.
- Clamp post intensity so gameplay-critical board edges remain readable.
- Any comfort regression in stress scenarios blocks release signoff.

---

## 4) Target Runtime Architecture

### 4.1 Runtime Contract

Supported runtime states:

1. WebGPU + MRT + Compute (full Nimbus feature set).
2. WebGPU + MRT, no Compute (instanced CPU fallback spirits).
3. WebGPU, no MRT (standard bloom path).
4. WebGPU, no Post (safe direct render).
5. WebGL2 fallback (`EffectComposer` path).

### 4.2 Module Layout

```
src/themes/nimbus-veil/
├── nimbus-veil-theme.js          # main class: lifecycle, backend selection, render loop
├── nimbus-veil-materials.js      # dual-path material factories
├── nimbus-veil-clouds.js         # volumetric and sliced cloud system
├── nimbus-veil-compute.js        # spirit simulation kernels and buffers
├── nimbus-veil-post.js           # WebGPU post graph and WebGL parity controls
├── nimbus-veil-shaders.js        # GLSL fallback shader source (existing)
└── nimbus-veil-tetrominos.js     # unchanged gameplay palette config
```

### 4.3 Capability Matrix

| Runtime | Post | MRT | Compute | Volumetrics | Expected Path |
|--------|------|-----|---------|-------------|---------------|
| WebGPU + MRT + Compute | Yes | Yes | Yes | Full | Masterpiece |
| WebGPU + MRT, no Compute | Yes | Yes | No | Full/Sliced | High |
| WebGPU, no MRT | Yes | No | Optional | Sliced | Medium |
| WebGPU, no Post | No | No | Optional | Optional | Safe Mode |
| WebGL2 fallback | Composer | No | No | No | Stable Fallback |

### 4.4 Required Runtime Flags

- `?forceWebGL=1`
- `?nimbusNoPost=1`
- `?nimbusNoMRT=1`
- `?nimbusNoCompute=1`
- `?nimbusNoVolumetrics=1`
- `?nimbusNoDRS=1`
- `?nimbusNoReprojection=1`
- `?nimbusMrtAudit=1`
- `?nimbusPerfHUD=1`
- `?nimbusBaseline=1`
- `?nimbusSeed=1234`
- `?nimbusFixedDt=16.666`
- `?nimbusCalmMode=1`
- `?nimbusStrictFallback=1`

---

## 5) Render Graph Specification

### 5.1 WebGPU Graph (Target)

1. Scene setup pass (opaque + transparent base layers).
2. Cloud volume pass:
   - Raymarch or sliced path by tier/capability.
   - Half-res where required.
3. Spirit pass:
   - Instanced billboards reading storage buffers.
4. Scene pass with MRT (`output`, `emissive`) when available.
5. Post combine:
   - Bloom (emissive-driven on MRT path).
   - God rays (depth-aware).
   - Color grade + vignette + optional grain.
6. Final composite and presentation.

### 5.2 WebGL Graph (Fallback)

1. Scene render with GLSL materials.
2. Composer pass chain:
   - RenderPass
   - UnrealBloomPass
   - grade/vignette pass (if enabled)
3. Present.

### 5.3 Ownership Rules

- If post owns tone mapping, renderer tone mapping is neutral.
- If renderer owns tone mapping, post grade must not re-apply filmic curve.
- Exactly one owner per frame for:
  - tone mapping
  - bloom source selection
  - reactive envelope writes

### 5.4 Downgrade Ladder

When a path fails at runtime, downgrade immediately in this order:
1. Disable compute.
2. Disable MRT.
3. Disable post.
4. Force WebGL.

No restart loops. One downgrade per failure boundary, with sticky flags for session stability.

---

## 6) Quality Tier Contract

| Tier | Cloud Method | Spirit Count | God Rays | Internal Resolution | Target |
|------|--------------|--------------|----------|---------------------|--------|
| Extreme | Raymarch 64 + reprojection | 120000 | Volumetric | 1.00 | 60 FPS |
| Ultra | Raymarch 48 + reprojection | 90000 | Volumetric | 1.00 | 60 FPS |
| High | Raymarch 32 or Sliced 32 | 60000 | Depth-aware screen | 1.00 | 60 FPS |
| Medium | Sliced 16-24 | 20000 | Screen-space | 0.85-1.00 | 60 FPS |
| Low | Billboard clouds | 3000 | Minimal | 0.75-0.85 | 60 FPS |
| WebGL fallback | Legacy billboards | 1000-1500 | None | 0.75-1.00 | 60 FPS |

Budget gates:
- p95 frame time <= 16.6 ms on target tiers.
- 1% low >= 55 FPS on High and Medium.
- Draw calls <= 450 on High.
- 30-minute soak memory drift <= 5%.

### 6.1 Dynamic Resolution Scaling Policy

Use smoothed frame-time control:

```text
if smoothedFrameMs > 17.2 for 120 frames:
    scale = max(scale - 0.04, minScaleByTier)
if smoothedFrameMs < 14.8 for 240 frames:
    scale = min(scale + 0.02, 1.0)
```

DRS requirements:
- Hysteresis required (no oscillation/pumping).
- Changes clamped and tier-bounded.
- Disabled entirely by `?nimbusNoDRS=1`.

### 6.2 Comfort and Accessibility Caps

Default comfort policy:
- Calm mode (`nimbusCalmMode`) reduces camera drift amplitude, god-ray pulse gain, and bloom boost ceilings.
- Combo-driven turbulence must be frequency-limited to avoid flicker-like feel.
- Piece-lock pillar and pulse-wave peaks must decay smoothly (no hard pops).
- Board ROI contrast checks are mandatory at max-combo stress for every tier.

---

## 7) Technical Implementation Specs

### 7.1 Material Factory Contract

Every factory returns:

```js
{
  material,    // NodeMaterial (WebGPU) or ShaderMaterial (WebGL)
  uniforms,    // mutable handles for runtime updates
  meta: {
    bloomClass,    // category for emissive audit
    backend,       // 'webgpu' | 'webgl'
    supportsMrt,   // boolean
  },
}
```

Factory signatures:
- `createNimbusStarMaterial(params, isWebGPU)`
- `createNimbusDustMaterial(params, isWebGPU)`
- `createNimbusCloudMaterial(params, isWebGPU)`
- `createNimbusMistMaterial(params, isWebGPU)`
- `createNimbusPulseMaterial(params, isWebGPU)`
- `createNimbusLightBurstMaterial(params, isWebGPU)`

### 7.2 Bloom Class Weights

| Class | Intended Source | Weight |
|------|------------------|--------|
| `divineCore` | moon shaft core / lock pillar | 0.90 |
| `cloudRim` | silver lining edges | 0.55 |
| `spirits` | spirit motes | 0.40 |
| `pulse` | gameplay shockwave pulse | 0.50 |
| `mist` | background haze | 0.08 |
| `base` | non-emissive surfaces | 0.00 |

### 7.3 Volumetric Cloud System Spec

#### 7.3.1 Raymarch Path (High+)

Per-sample model:
- Density from layered 3D noise.
- Transmittance accumulation with Beer-Lambert attenuation.
- Directional light sampling for self-shadow approximation.
- Phase function bias toward forward scattering for silver-lining feel.

Pseudo flow:

```text
for step in N:
  samplePos = rayOrigin + rayDir * t
  density = noise3D(samplePos, time, wind)
  shadow = sampleLight(samplePos, lightDir)
  scatter = phase(dot(rayDir, lightDir)) * shadow
  accumColor += transmittance * density * scatter
  transmittance *= exp(-density * extinction)
  if transmittance < cutoff: break
```

#### 7.3.2 Reprojection and Upsample

- Use blue-noise jittered ray origins.
- Reproject previous frame using motion vectors when possible.
- Bilateral upsample for half-res cloud pass.
- Disable reprojection by flag (`nimbusNoReprojection`) for debugging.

#### 7.3.3 Sliced Path (Medium)

- 16-24 depth layers, jittered per frame.
- Per-layer noise offsets and depth-aware alpha blend.
- Lower-cost directional rim approximation.

#### 7.3.4 Billboard Path (Low/WebGL)

- Existing billboard clouds retained with quality polish:
  - improved edge fade
  - softer rim response
  - event-driven opacity envelope caps

### 7.4 Spirit Compute System Spec

#### 7.4.1 Buffer Layout (WGSL-Safe)

```wgsl
struct SpiritState {
  position : vec4<f32>;   // xyz = world pos, w = life
  velocity : vec4<f32>;   // xyz = vel, w = seed
  misc     : vec4<f32>;   // x = age, y = size, z = bloom, w = flags
};
```

Rules:
- 16-byte alignment guaranteed.
- Ping-pong buffers for read/write hazard avoidance.
- No mapping/readback in frame loop.

#### 7.4.2 Compute Passes

1. Advection pass:
   - curl noise + wind field integration.
2. Cohesion pass:
   - soft flock behavior with neighbor field approximation.
3. Gameplay influence pass:
   - attract/repel near line clear, combo, lock loci.
4. Lifecycle pass:
   - respawn aged particles and maintain density distribution.

#### 7.4.3 Render Path

- Spirits rendered as instanced camera-facing quads.
- Position/size/intensity read directly from storage buffers.
- WebGL fallback uses CPU-updated instanced buffer or legacy points.

### 7.5 Divine Post Spec

### 7.5.1 Phase Split

- 6A: base post stack (bloom + grade + vignette).
- 6B: MRT emissive isolation hardening.

### 7.5.2 Guardrails

- If any active material is non-node on WebGPU path, auto-disable MRT.
- If post performs ACES/filmic mapping, renderer tone mapping must be neutral.
- All post effects have hard caps and board-safe masks.

### 7.5.3 Post Defaults (Initial)

| Param | Extreme/Ultra | High | Medium | Low/Fallback |
|------|----------------|------|--------|--------------|
| Bloom strength | 0.48 | 0.42 | 0.34 | 0.22 |
| Bloom radius | 0.45 | 0.40 | 0.34 | 0.25 |
| Bloom threshold | 0.0 MRT | 0.0 MRT | 0.65 | 0.75 |
| Exposure | 1.03 | 1.02 | 1.00 | 1.00 |
| Contrast | 1.04 | 1.03 | 1.02 | 1.00 |
| Saturation | 1.06 | 1.05 | 1.03 | 1.00 |
| Vignette darkness | 0.34 | 0.30 | 0.24 | 0.12 |

### 7.6 Reactive Envelope Contract

Single source of truth:

```js
reactiveEnvelope = {
  pulse: 0,
  charge: 0,
  divinity: 0,
  turbulence: 0,
  bloomBoost: 0,
};
```

Event mapping:

| Event | Envelope Change |
|------|------------------|
| `PIECE_LOCK` | `divinity += 0.15`, `charge += 0.05` |
| `LINE_CLEAR(n)` | `pulse += 0.08 + n*0.06`, `charge += 0.06 + n*0.04` |
| `COMBO(n)` | `turbulence += 0.10 + n*0.08`, `bloomBoost += 0.05 + n*0.05` |

Envelope rules:
- exponential decay with clamped ceilings.
- deterministic updates under fixed timestep.
- quality-tier multiplier caps to preserve readability.

### 7.7 Lifecycle and Disposal Contract

Must track and clear:
- RAF handle
- timer set (`activeTimers`)
- event bus unsubscribers
- resize/display listeners (stable function refs)
- post passes and render targets
- textures, geometries, materials
- storage buffers and compute pipelines

`stop()` must be idempotent and safe to call multiple times.

### 7.8 WebGPU Reliability and Observability Contract

Mandatory runtime safety behavior:

- Use timeout-guarded `compileAsync` warmup for critical materials/pipelines.
- Add device-loss handler that triggers downgrade ladder without restart loop.
- Capture uncaught renderer init/post/compute failures into structured logs.
- Run MRT material audits whenever MRT is enabled; auto-disable on mismatch.
- Keep per-pass cost telemetry:
  - GPU timestamps when supported (`timestamp-query`)
  - CPU-side frame/pass timings when timestamps are unavailable

Operational telemetry requirements:
- Capture startup backend selection, fallback reason, and active kill-switches.
- Capture downgrade events with phase, feature, and error class.
- Include telemetry summary in release gate evidence packet.

---

## 8) Non-Negotiable Engineering Gates

1. Deterministic baseline (`seed` + `fixedDt`) before feature migration.
2. WebGL fallback parity blocks phase signoff on regressions.
3. No hot-loop GPU readbacks.
4. 16-byte aligned compute layout only.
5. No oversized point primitive dependency on WebGPU for hero visuals.
6. Single ownership of tone mapping and bloom-source selection.
7. Every major feature requires kill-switch coverage.
8. Device-loss recovery must downgrade without restart loop.
9. `compileAsync` warmup must be timeout-guarded.
10. Phase signoff requires measurable metrics, not subjective look-only approval.
11. Timestamp-query pass timing is required when supported; CPU fallback metrics when unsupported.
12. Reduced-motion/calm-mode behavior must pass readability and comfort checks.
13. Capability snapshot and downgrade telemetry must be attached to release evidence.

---

## 9) Phase Plan

## Phase 0: Baseline Lock and Art Packet (Critical)

Objective:
- Freeze current baseline and author acceptance packet.

Files:
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`
- Create: `docs/NIMBUS_VEIL_ART_DIRECTION.md`
- Create: `docs/NIMBUS_VEIL_BASELINE_CAPTURE_PROTOCOL.md`
- Create/Modify: Nimbus capture helpers under `tests/`

Tasks:
- [ ] Add deterministic flags: `nimbusSeed`, `nimbusFixedDt`.
- [ ] Add canned event playback script for captures.
- [ ] Capture hero shots for all presets and both backends.
- [ ] Record baseline metrics (FPS, frame-time p50/p95, draw calls, memory proxies).
- [ ] Define board readability ROIs and brightness histogram targets in capture protocol.
- [ ] Define composition lock checks for each hero shot (depth occupancy + light-anchor placement).
- [ ] Publish acceptance rubric and lock art packet.
- [ ] Run Sky Fidelity Rubric scoring session and record scores in the baseline packet.

Exit criteria:
- Baseline pack reproducible.
- Art packet approved.
- Sky Fidelity Rubric gate passes (`min 4`, average `>= 4.4`).
- Composition lock checks pass for all hero shots.

## Phase 1: Renderer Bootstrap and Lifecycle Hardening (Critical)

Objective:
- Introduce robust backend boot and cleanup.

Files:
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`

Tasks:
- [x] Async WebGPU-first `initRenderer()` with explicit fallback.
- [x] Capability object: `webgpu`, `post`, `mrt`, `compute`, limits.
- [x] Parse/store runtime flags in `this.flags`.
- [x] Add capability negotiation snapshot logging (startup path + features + disabled reasons).
- [x] Fix resize listener by stable `boundResizeHandler`.
- [x] Track all `setTimeout` calls in `activeTimers`.
- [x] Device-loss handling with controlled downgrade.
- [x] Add structured error capture for renderer/post/compute init failures.
- [x] Timeout-guarded compile warmup before first interactive frame.

Exit criteria:
- [x] 100+ activate/deactivate cycles leak-free.
- [x] Forced WebGPU failure and device loss recover correctly.
- [x] Startup logs provide deterministic backend + capability evidence.

Implementation evidence:
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: lifecycle hardening, structured runtime telemetry, downgrade ladder, capability disabled-reason snapshots.
- `tests/unit/test-nimbus-veil-phase1.js`: Phase 1 assertions including validation helper and harness coverage.
- `tests/performance/benchmark-nimbus-veil-phase1.html`: runtime harness for 120-cycle lifecycle validation plus downgrade/device-loss matrix.
- `window.nimbusBaseline` Phase 1 APIs:
  - `phase1Lifecycle(options)`
  - `phase1Failures(options)`
  - `phase1Suite(options)`
  - `phase1Snapshot(label)`
  - `phase1Report()`
  - `phase1Download(label)`

## Phase 2: Render Path Abstraction and Module Split (Critical)

Objective:
- Centralize render behavior and reduce monolith risk.

Files:
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`
- Create: `src/themes/nimbus-veil/nimbus-veil-materials.js`
- Create: `src/themes/nimbus-veil/nimbus-veil-post.js`

Tasks:
- [x] Implement `renderFrame()` abstraction for all runtime modes.
- [x] Move material creation to dual-path factories.
- [x] Keep `nimbus-veil-shaders.js` as fallback source of truth.
- [x] Normalize resize across renderer/composer/post.
- [x] Enforce tone-mapping ownership rules.

Exit criteria:
- [x] All capability + flag combinations run without runtime errors.

Implementation evidence:
- `src/themes/nimbus-veil/nimbus-veil-materials.js`: dual-path material factories for stars/clouds/dust/mist/pulse/light-burst, with GLSL shader fallback provenance.
- `src/themes/nimbus-veil/nimbus-veil-post.js`: centralized WebGL post/direct render abstraction with unified `render`, `setSize`, `dispose`.
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: render-path integration (`nimbusPost`, `renderPath`, `applyColorPipeline`, normalized resize + post lifecycle).
- `tests/unit/test-nimbus-veil-phase2.js`: module-split and render-path assertions.

## Phase 3: TSL Material Migration (High)

Objective:
- Migrate active visual systems to dual-path material factories.

Files:
- Modify/Create: `src/themes/nimbus-veil/nimbus-veil-materials.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`

Tasks:
- [x] Migrate stars, dust, mist, pulse, light burst materials.
- [x] Convert hero glow elements to instanced quads where needed.
- [x] Implement bloom-class metadata and MRT audit hooks.
- [x] Validate WebGL parity using baseline hero frames.

Exit criteria:
- WebGPU compiles without material warnings.
- WebGL parity remains coherent.

Implementation evidence:
- `src/themes/nimbus-veil/nimbus-veil-materials.js`: WebGPU TSL NodeMaterial path for stars/dust/mist/pulse/light-burst; GLSL fallback retained for parity and cloud path safety.
- `src/themes/nimbus-veil/nimbus-veil-materials.js`: bloom-class metadata contract (`bloomClass`, `bloomWeight`, `backend`, `supportsMrt`, `mrtRole`, `primitive`) and `auditNimbusMaterialMetadata(...)`.
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: WebGPU pulse-wave system upgraded to instanced quads (`setupPulseWaveSystem`, instanced `aProgress`/`aOpacity` lifecycle) and integrated into scene/reset/dispose paths.
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: Phase 3 runtime hooks include `runPhase3MaterialAudit(...)` and `runPhase3ParityValidation(...)`, exposed via `window.nimbusBaseline`.
- `tests/performance/benchmark-nimbus-veil-phase3.html`: parity + audit harness for deterministic hero-frame capture and reference comparisons.
- `tests/unit/test-nimbus-veil-phase3.js`: static coverage for TSL routing, metadata/audit contract, instanced pulse wiring, and parity helper API.

## Phase 4: Volumetric Cloud Core (Critical)

Objective:
- Deliver Nimbus-defining cloud depth and light interaction.

Files:
- Create: `src/themes/nimbus-veil/nimbus-veil-clouds.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-materials.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`

Tasks:
- [x] Implement tiered cloud paths (raymarch/sliced/billboard).
- [x] Add scattering, self-shadow approximation, and rim response.
- [x] Integrate blue-noise jitter and optional reprojection.
- [x] Add gameplay-driven density/emissive responses.

Exit criteria:
- Cloud volume depth passes hero-frame checks.
- High tier meets frame budget on reference hardware.

Implementation evidence (in progress):
- `src/themes/nimbus-veil/nimbus-veil-clouds.js`: quality-tier cloud profile resolver (`billboard`/`sliced`/`raymarch`) with reprojection/jitter gating and reactive envelope helpers.
- `src/themes/nimbus-veil/nimbus-veil-shaders.js`: upgraded cloud fragment path with phase scattering, directional self-shadow approximation, rim response, blue-noise jitter, temporal reprojection sampling (`uPrevTime`, `uDeltaTime`, `uWindVelocity`), and tiered sliced/raymarch integration.
- `src/themes/nimbus-veil/nimbus-veil-materials.js`: cloud factory now binds volumetric uniforms (`uVolumetricMode`, `uMarchSteps`, `uLayerCount`, `uDensityBoost`, `uEmissiveBoost`) plus temporal reprojection uniforms and metadata (`cloudPath`, reprojection state).
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: cloud profile selection wired to flags/capabilities, moon-light direction synchronization, gameplay-driven density/emissive updates, and validation helper exposure (`phase4CloudBehavior`, `phase4CloudPerf`, `phase4CloudProfile`).
- `tests/unit/test-nimbus-veil-phase4.js`: static coverage for Phase 4 module split and integration contract.
- `tests/performance/benchmark-nimbus-veil-phase4.html`: behavioral/perf harness for path/flag matrix checks and deterministic p95 budget sweeps.

## Phase 5: Compute-Driven Spirit Swarms (Critical)

Objective:
- Replace CPU dust loop with scalable fluid spirit simulation.

Files:
- Create: `src/themes/nimbus-veil/nimbus-veil-compute.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-materials.js`

Tasks:
- [x] Implement aligned storage buffers and ping-pong update flow.
- [x] Add advection/cohesion/gameplay influence kernels.
- [x] Render spirits via instanced billboards from GPU data.
- [x] Add robust fallback path when compute init fails.

Exit criteria:
- High: 60000 spirits at target frame budget.
- Ultra: 90000 spirits at target frame budget.

Implementation evidence (in progress):
- `src/themes/nimbus-veil/nimbus-veil-compute.js`: Phase 5 spirit compute budgets (`High=60000`, `Ultra=90000`), 16-byte aligned storage contracts, ping-pong buffers, and advection/cohesion/gameplay influence kernel controls.
- `src/themes/nimbus-veil/nimbus-veil-materials.js`: `createNimbusSpiritSwarmMaterial` NodeMaterial path reading active compute storage buffers for instanced billboard spirit rendering with explicit bloom/MRT metadata (`mrtRole: spirit-swarm`), low-flicker twinkle/alpha tuning, and deterministic full-screen anchor hashing from `instanceIndex` to prevent center-clump failures on fragile driver paths.
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: compute-first spirit bootstrap (`createSpiritSwarm`), runtime dispatch (`updateSpiritSwarm`), event-driven influences (`LINE_CLEAR`, `COMBO`, `PIECE_LOCK`), full-screen instanced anchor placement to avoid center-clump artifacts, and automatic CPU dust fallback on init/runtime compute failure.
- `tests/unit/test-nimbus-veil-phase5.js`: static contract coverage for compute module, material integration, theme fallback ladder, and plan/art synchronization.

## Phase 6: Divine Lighting and Post Pipeline (High)

Objective:
- Achieve cinematic atmospheric finish with controlled softness.

Files:
- Modify/Create: `src/themes/nimbus-veil/nimbus-veil-post.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`

Tasks:
- [x] 6A base post: bloom, grade, vignette, board-safe masks.
- [x] 6B MRT hardening: emissive isolation and audit enforcement.
- [x] Add god rays with depth-aware attenuation.
- [x] Add fallback post routes for no-MRT/no-post modes.

Exit criteria:
- God rays align with moon direction and cloud density.
- No clipping or readability loss at combo peaks.

Implementation evidence:
- `src/themes/nimbus-veil/nimbus-veil-post.js`: hybrid post abstraction with WebGPU `PostProcessing` + WebGL `EffectComposer` fallback, base bloom/grade/vignette stack, board-safe masking controls, and depth-aware god-ray attenuation in WebGPU path.
- `src/themes/nimbus-veil/nimbus-veil-post.js`: MRT emissive isolation routing (`scenePass.setMRT(mrt({ output, emissive }))`) with auto-downgrade to non-MRT post path when MRT init fails.
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: Phase 6 post preset ladder (`PHASE6_POST_PRESETS`), runtime post parameter updates (`updatePhase6PostPipeline`), bloom/readability clamps, and no-MRT/no-post fallback routing integration.
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: Phase 6 audit/validation helpers (`buildPhase6MrtAuditReport`, `getPhase6PostRuntimeState`, `runPhase6PostValidation`) with baseline API exposure via `window.nimbusBaseline`.
- `tests/unit/test-nimbus-veil-phase6.js`: static contract coverage for dual-path post stack, MRT hardening hooks, Phase 6 runtime validation APIs, and plan/art synchronization.
- `tests/performance/benchmark-nimbus-veil-phase6.html`: manual harness for phase6 state/audit/validation runs across default/no-MRT/no-post/force-WebGL runtime modes.

## Phase 7: Reactive Feel and Readability Polish (High)

Objective:
- Connect gameplay signals to world response without overstimulation.

Files:
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-clouds.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-compute.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-post.js`

Tasks:
- [x] Replace scattered state with unified envelope model.
- [x] Tune event curves and decay constants by tier.
- [x] Add accessibility caps and board-safe intensity clamps.
- [x] Validate sustained combo readability sequence.

Exit criteria:
- Effects feel alive but controlled.
- Readability gates pass.

Implementation evidence:
- `src/themes/nimbus-veil/nimbus-veil-clouds.js`: unified reactive envelope matrix by quality tier (impulse/cap/decay/readability clamps) plus event-to-envelope impulse mapping and normalized cloud-reactive output.
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: gameplay events now write through `applyReactiveEnvelopeImpulse(...)` with derived cloud/bloom/particle mirrors, and `animateEffects` consumes envelope-driven boosts without legacy decay branches.
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: Phase 7 readability guardrails integrated into post dynamics (`updatePhase6PostPipeline`) with board-protection floors, bloom/god-ray caps, and cloud-density clamping.
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: Phase 7 runtime/validation APIs (`getPhase7ReactiveRuntimeState`, `runPhase7ReadabilityValidation`) wired into baseline report/snapshot capture and `window.nimbusBaseline` helper surface.
- `tests/unit/test-nimbus-veil-phase7.js`: static contract coverage for unified envelope wiring, readability validation APIs, and Phase 7 doc synchronization.
- `tests/performance/benchmark-nimbus-veil-phase7.html`: manual harness for reactive-state inspection and sustained-combo readability validation runs.

## Phase 8: Performance and Thermal Hardening (Critical)

Objective:
- Stabilize all tiers for long sessions and mixed hardware.

Files:
- Modify: `src/themes/nimbus-veil/*`
- Modify: `tests/performance/*`

Tasks:
- [x] Implement and tune DRS policy.
- [x] Prewarm key materials/pipelines.
- [x] Add timestamp-query instrumentation when supported and CPU pass-timing fallback when unsupported.
- [x] Add 30-minute and 2-hour soak scenarios.
- [ ] Run cross-vendor soak matrix (at least one NVIDIA, one AMD, one Intel class machine).
- [ ] Tune per-tier defaults using measured data.

Exit criteria:
- Performance budgets pass by target tier.
- No memory drift beyond threshold.
- No unresolved cross-vendor blockers for release tier defaults.

Implementation evidence (in progress):
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: Phase 8 performance profile ladder (`PHASE8_PERFORMANCE_PROFILES`) with adaptive resolution controller (`initializePhase8PerformanceState`, `updatePhase8AdaptiveResolution`, `applyPhase8ResolutionScale`) and `nimbusNoDRS` gating.
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: key pipeline prewarm pass (`prewarmPhase8Pipelines`) executed during scene bootstrap after compile warmup.
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: timestamp-query integration (`configurePhase8TimingInstrumentation`, `updatePhase8GpuTimings`) with explicit CPU pass-timing fallback and per-frame pass sample capture in animation/render loop.
- `src/themes/nimbus-veil/nimbus-veil-theme.js`: soak and validation APIs (`runPhase8PerformanceValidation`, `runPhase8SoakScenario`, `runPhase8Soak30m`, `runPhase8Soak2h`) exposed through `window.nimbusBaseline`.
- `tests/unit/test-nimbus-veil-phase8.js`: static contract coverage for Phase 8 DRS/timing/soak APIs and plan updates.
- `tests/performance/benchmark-nimbus-veil-phase8.html`: manual harness for performance-state inspection, DRS validation, and 30m/2h soak orchestration.

## Phase 9: Final Validation and Release Gate (Critical)

Objective:
- Complete release evidence, rollback checks, and default rollout settings.

Tasks:
- [ ] Validate backend/flag matrix end-to-end.
- [ ] Validate 100+ theme switch cycles.
- [ ] Validate no leak trends on soak.
- [ ] Validate artifact-free rendering and event reactivity.
- [ ] Validate calm-mode/reduced-motion behavior under combo stress.
- [ ] Validate fallback-first hotfix ladder (`compute -> MRT -> post -> WebGL`) in staging.
- [ ] Freeze release defaults and update docs.

Exit criteria:
- All gate checklists pass with evidence attached.
- Release evidence includes telemetry summary + capability snapshots.

---

## 10) Testing and Validation Matrix

## A. Deterministic Visual Regression

- [ ] Fixed-seed, fixed-dt run mode implemented.
- [ ] Golden captures for both backends and all tiers.
- [ ] Per-shot visual diff checks with tolerance thresholds.
- [ ] `nimbusNoPost=1` capture set to isolate scene regressions.

## B. Functional Smoke

- [ ] default startup
- [ ] `forceWebGL`
- [ ] `nimbusNoPost`
- [ ] `nimbusNoMRT`
- [ ] `nimbusNoCompute`
- [ ] `nimbusNoVolumetrics`
- [ ] repeated theme switching
- [ ] resize spam (including high-DPR)
- [ ] event bus effects (`LINE_CLEAR`, `COMBO`, `PIECE_LOCK`)

## C. Performance and Stability

- [ ] 5-minute benchmark per tier/backend.
- [ ] 30-minute soak per tier/backend.
- [ ] 2-hour mixed-event soak on release candidate.
- [ ] Track p50/p95 frame time, 1% low, draw calls, memory proxies.
- [ ] Verify DRS stability under forced stress.

## D. Release Gates

- [ ] No P0 visual regression on WebGL fallback.
- [ ] No startup failure across required runtime matrix.
- [ ] Performance budgets pass on target hardware class.
- [ ] MRT auto-disable behavior works when materials/caps mismatch.
- [ ] Sky Fidelity Rubric passes on release candidate captures.

## E. Objective Signoff Thresholds (Locked)

| Category | Gate | Threshold |
|----------|------|-----------|
| Fallback visual parity | Changed pixels outside approved glow ROIs | `<= 3.0%` |
| Board readability | Contrast ratio in board ROI under combo stress | `>= 4.5:1` |
| Highlight safety | Continuous clipping in hero highlight channels | `<= 0.5s` |
| Frame pacing | WebGPU High/Ultra p95 frame time | `<= 16.6ms` |
| Fallback pacing | WebGL fallback p95 frame time | `<= 20.0ms` |
| Stability | Theme-switch stress | `>= 100` cycles without leak trend |
| Soak reliability | Mixed-event soak | `2h` with no uncaught runtime errors |
| Art direction quality | Sky Fidelity Rubric average | `>= 4.4` with no category below `4` |

Notes:
- Glow ROIs are limited to emissive cloud rims, pillar cores, and pulse-wave fringes defined in the art packet.
- Thresholds apply to WebGPU and forced-WebGL runs unless marked WebGPU-only.

## F. Validation Artifacts (Repo Standard)

- Create: `docs/NIMBUS_VEIL_ART_DIRECTION.md` (palette lock, composition locks, ROI map, rubric sheet).
- Create: `docs/NIMBUS_VEIL_BASELINE_CAPTURE_PROTOCOL.md` (deterministic capture runbook and signoff checklist).
- Create: `tests/performance/benchmark-nimbus-veil-phase9.html` (tier/backend sweep + event anchors + soak harness).
- Create: `tests/unit/test-nimbus-veil-phase0.js` (deterministic flags, baseline helper exposure).
- Create: `tests/unit/test-nimbus-veil-phase1.js` (hybrid bootstrap, fallback, lifecycle cleanup, error logging).
- Create: `tests/unit/test-nimbus-veil-phase6.js` (post path, MRT audit, tone-mapping ownership).
- Create: `tests/performance/benchmark-nimbus-veil-phase8.html` (Phase 8 DRS/timing validation + soak scenario harness).
- Create: `tests/unit/test-nimbus-veil-phase8.js` (Phase 8 DRS/timestamp/soak helper contract coverage).
- Create: `tests/unit/test-nimbus-veil-phase9.js` (release-gate helpers, rollback ladder checks, telemetry summary assertions).

---

## 11) Risk Register and Rollback Playbook

| Risk | Trigger | Mitigation | Rollback |
|------|---------|------------|----------|
| WebGPU startup/device-loss failure | init errors or lost loop | capability gates + single downgrade path | force WebGL |
| Volumetric pass too expensive | p95 budget miss | half-res + fewer steps + sliced fallback | disable volumetrics |
| Compute instability | WGSL errors/driver issues | aligned layout + simplified kernels + fallback | disable compute |
| MRT incompatibility | non-node material or validation error | `ensureMrtMaterials()` and auto-disable | non-MRT post |
| Overbloom/readability loss | failed visual stress tests | clamp caps + emissive class tuning | disable post then retune |
| Lifecycle leaks | growing timers/memory | strict disposal audits and soak checks | rollback phase feature |
| DRS pumping | oscillating resolution | hysteresis and bounded step changes | disable DRS |

Rollback order for live hotfixes:
1. compute off
2. MRT off
3. post off
4. full WebGL fallback

---

## 12) Implementation Priority Order

| Order | Phase | Impact | Effort | Notes |
|------|-------|--------|--------|-------|
| 1 | Phase 0 | Foundation | Medium | lock evidence and rubric |
| 2 | Phase 1 | Foundation | Medium | safe hybrid runtime |
| 3 | Phase 6A | Highest visual uplift | Medium | base post stack early |
| 4 | Phase 2 | High | Medium | de-risk architecture |
| 5 | Phase 4 | High | High | cloud identity core |
| 6 | Phase 3 | High | Medium | material parity and audits |
| 7 | Phase 5 | High | High | spirit scale and feel |
| 8 | Phase 6B | High | Medium | emissive isolation hardening |
| 9 | Phase 7 | Medium | Medium | polish and readability |
| 10 | Phase 8 | Critical | Medium | ship-grade stability |
| 11 | Phase 9 | Critical | Medium | final release gate |

---

## 13) Ownership and Estimates

Roles:
- `TL`: theme tech lead
- `RE`: rendering engineer
- `TA`: technical artist
- `TE`: theme engineer
- `PE`: performance engineer
- `QA`: QA engineer
- `RM`: release manager

| Phase | Primary | Support | Estimate (eng days) | Exit focus |
|------|---------|---------|---------------------|------------|
| 0 | TL | RE, TA, QA | 2-3 | baseline + art packet |
| 1 | RE | TE, QA | 3-4 | lifecycle and fallback |
| 2 | RE | TE | 2-3 | render abstraction |
| 3 | RE | TA, TE | 3-5 | materials parity |
| 4 | RE | TA, PE | 4-6 | volumetric cloud quality/perf |
| 5 | RE | PE, TE | 4-6 | spirit compute scale/stability |
| 6 | RE | TA, QA | 3-4 | post and MRT hardening |
| 7 | TE | TA, QA | 2-3 | reactivity/readability |
| 8 | PE | RE, QA | 3-5 | thermal/perf stability |
| 9 | QA | RM, TL, PE | 3-4 | release evidence |

Aggregate estimate:
- 29-43 engineering days.
- Typical calendar range with modest parallelism: 5-8 weeks.

Per-phase mandatory checklist:
- [ ] owner assigned
- [ ] scope-complete PR merged
- [ ] WebGPU + forced WebGL checks pass
- [ ] perf delta recorded
- [ ] rollback switch verified
- [ ] short phase report published

---

## 14) Release and Rollout Strategy

1. Internal canary:
   - enable upgraded Nimbus in dev/staging only.
   - capture fallback rate and errors.
2. Soft launch:
   - keep all kill switches enabled.
   - monitor startup stability and visual bug reports.
3. Ramp:
   - increase high-tier defaults after soak and budget gates pass.
4. Fallback-first incident response:
   - compute -> MRT -> post -> WebGL.
5. Post-release verification:
   - rerun deterministic captures after each hotfix.

---

## 15) Definition of Done

1. Hybrid renderer is stable and fallback-safe.
2. Nimbus art pillars pass approved hero-frame evidence.
3. Volumetric clouds and spirit swarms achieve target feel and scale.
4. WebGL fallback remains coherent and shippable.
5. Performance and soak budgets pass across required matrix.
6. Kill switches and rollback ladder are validated in practice.
7. Documentation reflects shipped behavior, flags, and defaults.

---

## 16) References

Art and direction references:
- thatgamecompany: Sky: Children of the Light
- thatgamecompany: Journey
- Giant Squid: ABZU

Project implementation references:
- `src/themes/black-hole/`
- `src/themes/chromadelic-highway/`
- `docs/SWEDISH_FOREST_WEBGPU_UPGRADE_PLAN.md`

Technical references:
- Three.js r181 WebGPU/TSL/PostProcessing docs
- WGSL alignment and layout requirements

WebGPU cloud rendering research snapshot (2026-02-15):
- Three.js WebGPU manual: custom `ShaderMaterial` is not supported on `WebGPURenderer`, so Nimbus cloud hero path should stay TSL/NodeMaterial-based for native WebGPU.
  - https://threejs.org/manual/en/webgpu.html
- Three.js `Storage3DTexture` and `Data3DTexture` are available for 3D volume data workflows, enabling proper volumetric density fields instead of only 2D card noise.
  - https://threejs.org/docs/pages/Storage3DTexture.html
  - https://threejs.org/docs/pages/Data3DTexture.html
  - https://threejs.org/docs/pages/RenderTarget3D.html
- Guerrilla’s Nubis talks/papers describe production cloud shaping with Perlin-Worley density, weather fields, vertical stratification, Beer-law extinction, and powder/forward-scatter terms.
  - https://www.guerrilla-games.com/read/the-real-time-volumetric-cloudscapes-of-horizon-zero-dawn
  - https://www.guerrilla-games.com/read/nubis-realtime-volumetric-cloudscapes-in-a-nutshell
  - https://d3d3g8mu99pzk9.cloudfront.net/AndrewSchneider/The-Real-time-Volumetric-Cloudscapes-of-Horizon-Zero-Dawn.pdf
- Unreal’s volumetric cloud docs reinforce a practical shipping pattern: conservative-density skipping, multiple scattering approximation, and Beer shadow map integration for scale/perf balance.
  - https://dev.epicgames.com/documentation/en-us/unreal-engine/volumetric-cloud-component-in-unreal-engine?application_version=5.6
- Hillaire’s physically based sky/atmosphere model is a strong baseline for directional aerial perspective and cloud/atmosphere coherence.
  - https://diglib.eg.org/items/8a3e5350-18b3-46bd-9274-3add5af88c75
