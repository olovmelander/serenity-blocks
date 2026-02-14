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
- [ ] Publish acceptance rubric and lock art packet.
- [ ] Run Sky Fidelity Rubric scoring session and record scores in the baseline packet.

Exit criteria:
- Baseline pack reproducible.
- Art packet approved.
- Sky Fidelity Rubric gate passes (`min 4`, average `>= 4.4`).

## Phase 1: Renderer Bootstrap and Lifecycle Hardening (Critical)

Objective:
- Introduce robust backend boot and cleanup.

Files:
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`

Tasks:
- [ ] Async WebGPU-first `initRenderer()` with explicit fallback.
- [ ] Capability object: `webgpu`, `post`, `mrt`, `compute`, limits.
- [ ] Parse/store runtime flags in `this.flags`.
- [ ] Fix resize listener by stable `boundResizeHandler`.
- [ ] Track all `setTimeout` calls in `activeTimers`.
- [ ] Device-loss handling with controlled downgrade.
- [ ] Timeout-guarded compile warmup before first interactive frame.

Exit criteria:
- 100+ activate/deactivate cycles leak-free.
- Forced WebGPU failure and device loss recover correctly.

## Phase 2: Render Path Abstraction and Module Split (Critical)

Objective:
- Centralize render behavior and reduce monolith risk.

Files:
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`
- Create: `src/themes/nimbus-veil/nimbus-veil-materials.js`
- Create: `src/themes/nimbus-veil/nimbus-veil-post.js`

Tasks:
- [ ] Implement `renderFrame()` abstraction for all runtime modes.
- [ ] Move material creation to dual-path factories.
- [ ] Keep `nimbus-veil-shaders.js` as fallback source of truth.
- [ ] Normalize resize across renderer/composer/post.
- [ ] Enforce tone-mapping ownership rules.

Exit criteria:
- All capability + flag combinations run without runtime errors.

## Phase 3: TSL Material Migration (High)

Objective:
- Migrate active visual systems to dual-path material factories.

Files:
- Modify/Create: `src/themes/nimbus-veil/nimbus-veil-materials.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`

Tasks:
- [ ] Migrate stars, dust, mist, pulse, light burst materials.
- [ ] Convert hero glow elements to instanced quads where needed.
- [ ] Implement bloom-class metadata and MRT audit hooks.
- [ ] Validate WebGL parity using baseline hero frames.

Exit criteria:
- WebGPU compiles without material warnings.
- WebGL parity remains coherent.

## Phase 4: Volumetric Cloud Core (Critical)

Objective:
- Deliver Nimbus-defining cloud depth and light interaction.

Files:
- Create: `src/themes/nimbus-veil/nimbus-veil-clouds.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-materials.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`

Tasks:
- [ ] Implement tiered cloud paths (raymarch/sliced/billboard).
- [ ] Add scattering, self-shadow approximation, and rim response.
- [ ] Integrate blue-noise jitter and optional reprojection.
- [ ] Add gameplay-driven density/emissive responses.

Exit criteria:
- Cloud volume depth passes hero-frame checks.
- High tier meets frame budget on reference hardware.

## Phase 5: Compute-Driven Spirit Swarms (Critical)

Objective:
- Replace CPU dust loop with scalable fluid spirit simulation.

Files:
- Create: `src/themes/nimbus-veil/nimbus-veil-compute.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-materials.js`

Tasks:
- [ ] Implement aligned storage buffers and ping-pong update flow.
- [ ] Add advection/cohesion/gameplay influence kernels.
- [ ] Render spirits via instanced billboards from GPU data.
- [ ] Add robust fallback path when compute init fails.

Exit criteria:
- High: 60000 spirits at target frame budget.
- Ultra: 90000 spirits at target frame budget.

## Phase 6: Divine Lighting and Post Pipeline (High)

Objective:
- Achieve cinematic atmospheric finish with controlled softness.

Files:
- Modify/Create: `src/themes/nimbus-veil/nimbus-veil-post.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`

Tasks:
- [ ] 6A base post: bloom, grade, vignette, board-safe masks.
- [ ] 6B MRT hardening: emissive isolation and audit enforcement.
- [ ] Add god rays with depth-aware attenuation.
- [ ] Add fallback post routes for no-MRT/no-post modes.

Exit criteria:
- God rays align with moon direction and cloud density.
- No clipping or readability loss at combo peaks.

## Phase 7: Reactive Feel and Readability Polish (High)

Objective:
- Connect gameplay signals to world response without overstimulation.

Files:
- Modify: `src/themes/nimbus-veil/nimbus-veil-theme.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-clouds.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-compute.js`
- Modify: `src/themes/nimbus-veil/nimbus-veil-post.js`

Tasks:
- [ ] Replace scattered state with unified envelope model.
- [ ] Tune event curves and decay constants by tier.
- [ ] Add accessibility caps and board-safe intensity clamps.
- [ ] Validate sustained combo readability sequence.

Exit criteria:
- Effects feel alive but controlled.
- Readability gates pass.

## Phase 8: Performance and Thermal Hardening (Critical)

Objective:
- Stabilize all tiers for long sessions and mixed hardware.

Files:
- Modify: `src/themes/nimbus-veil/*`
- Modify: `tests/performance/*`

Tasks:
- [ ] Implement and tune DRS policy.
- [ ] Prewarm key materials/pipelines.
- [ ] Add 30-minute and 2-hour soak scenarios.
- [ ] Tune per-tier defaults using measured data.

Exit criteria:
- Performance budgets pass by target tier.
- No memory drift beyond threshold.

## Phase 9: Final Validation and Release Gate (Critical)

Objective:
- Complete release evidence, rollback checks, and default rollout settings.

Tasks:
- [ ] Validate backend/flag matrix end-to-end.
- [ ] Validate 100+ theme switch cycles.
- [ ] Validate no leak trends on soak.
- [ ] Validate artifact-free rendering and event reactivity.
- [ ] Freeze release defaults and update docs.

Exit criteria:
- All gate checklists pass with evidence attached.

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
