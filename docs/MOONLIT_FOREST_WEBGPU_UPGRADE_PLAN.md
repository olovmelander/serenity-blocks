# Moonlit Forest Theme - WebGPU Hybrid Upgrade Plan (World-Class Revision)

## Executive Summary

This revision upgrades Moonlit Forest from a mixed implementation (partial Three.js + heavy DOM/Canvas effects) to a fully GPU-driven theme with strict fallback behavior and production-grade lifecycle stability.

Key outcomes:
- WebGPU-first startup with silent fallback to WebGL2.
- Full migration of Moonlit Forest visuals and gameplay-reactive effects to Three.js GPU systems.
- Mandatory decommission of legacy DOM/Canvas rendering paths before final release.
- Measurable performance and memory improvements at every quality tier.

Scope: `src/themes/moonlit-forest/` and supporting Moonlit Forest markup/styles only.

---

## Current Baseline (Verified)

### Already Implemented
- Hybrid renderer bootstrap in `src/themes/moonlit-forest/moonlit-forest-theme.js`:
  - `WebGPURenderer` attempted first.
  - Emergency `THREE.WebGLRenderer` fallback if init fails.
  - Backend flags (`isWebGPU`, `isWebGL`) present.
- WebGPU/TSL + WebGL shader fallback for:
  - Sky backdrop
  - Moon disc
  - Moon halo
  - Starfield
- Core scene/camera loop and resize flow exist.

### Still Legacy (Must Be Migrated)
- Canvas-generated forest layers + cached `toDataURL` backgrounds.
- DOM/CSS-driven mushrooms, moonbeams, wildlife, and leaves.
- DOM burst effects for combo/line-clear/piece-lock reactions:
  - Fireflies, spores, wisps, sparkles, runes, mist, shooting stars, aurora, etc.
- Legacy sky/moon DOM toggling logic (`toggleLegacySkyElements`).
- Moonlit-specific DOM containers in `index.html` and style blocks in `public/styles/main.css`.

### Current Risks
- High DOM churn and repeated `createElement`/`setTimeout` patterns under gameplay load.
- Main-thread spikes from canvas generation and DOM effect bursts.
- Cleanup complexity from many short-lived nodes/timers.

---

## Target End State

### Rendering Contract
- Primary renderer: `WebGPURenderer` from `three/webgpu`.
- Fallback: WebGL2 path without user-visible errors.
- Feature gating by capabilities and debug flags (not assumptions).

### Visual Contract
- Moonlit Forest look identity preserved:
  - Layered forest depth
  - Bioluminescent mushrooms
  - Moonbeams
  - Mystical reactive combo energy
- WebGPU path may be visually superior; WebGL path must remain stable and coherent.

### Architecture Contract
- No Moonlit gameplay visuals implemented via DOM/canvas generation in production path.
- All gameplay-reactive effects routed through GPU emitters/material uniforms.
- One source of truth for quality presets and effect budgets.

---

## Reference-Informed Visual Direction (Locked)

The implementation must follow the visual intent from the provided moonlit forest references, not generic fantasy defaults.

### Image-Driven Pillars
- Moon as dominant key light source with cool blue spectral bias.
- Deep foreground tree silhouettes framing the composition left/right.
- Dense mid-ground atmospheric fog pool with visible light shafts and depth layering.
- Rich undergrowth readability (ferns, grasses, rocks) without noisy over-detail.
- High micro-contrast in focal zones, low contrast in distant canopy for scale.

### Color Script
- Primary palette: cool cyan-blue moonlight + desaturated blue-green vegetation.
- Secondary accent palette: controlled bioluminescent cyan/violet for gameplay-reactive moments only.
- Avoid neon-green daytime look and avoid flat monochrome blue wash.
- Maintain a measurable dark-value range so gameplay readability stays intact.

### Material and Lighting Rules
- Foliage must use layered roughness/specular response (wet moonlit glints, not plastic highlights).
- Tree trunks and rocks must carry readable normal variation at mid/near depth tiers.
- Fog must be volumetric-feeling and stratified by depth; avoid uniform alpha sheets.
- Moon halo and starfield must support cinematic framing but never overpower board readability.

### Cinematic Composition Rules
- Anchor camera framing with a visible moon corridor and parallax-separated depth bands.
- Keep one intentional focal basin in the mid-ground (mist clearing / light pocket).
- Ensure every quality preset preserves silhouette readability and depth rhythm.

---

## Platform Constraints

- Three.js: `^0.181.2`
- Electron: `^38.3.0`
- Startup must not fail if WebGPU is unavailable.
- Theme switching must remain leak-free across long sessions.

---

## Capability Matrix and Kill Switches

| Runtime | Post | MRT Bloom Isolation | Compute | Path |
|--------|------|---------------------|---------|------|
| WebGPU + MRT + Compute | Yes | Yes | Yes | Full Moonlit feature set |
| WebGPU + MRT, no Compute | Yes | Yes | No | CPU particle simulation fallback |
| WebGPU, no MRT | Yes | No | Optional | Standard bloom path |
| WebGPU, no Post | No | No | Optional | Direct scene render |
| WebGL2 fallback | `EffectComposer` | No | No | Fallback-quality feature set |

Required debug flags:
- `?forceWebGL=1`
- `?moonlitNoPost=1`
- `?moonlitNoMRT=1`
- `?moonlitNoCompute=1`
- `?moonlitBaseline=1`
- `?moonlitSeed=1234`
- `?moonlitFixedDt=16.666`

Rule: every optional feature requires both capability support and explicit enablement.

---

## Migration Policy

- Migrate one major risk at a time: renderer/lifecycle -> scene systems -> particles -> post -> decommission.
- Keep fallback stable while WebGPU evolves.
- Do not delete legacy code until parity criteria are met and validated.
- Before each deletion step, capture baseline screenshots/perf metrics and compare.
- Every phase must have hard exit criteria before progressing.

### World-Class Quality Gates (Non-Negotiable)
- Art direction lock before large-scale implementation work.
- Technical completion does not pass without visual direction compliance.
- Visual reviews must include side-by-side comparison against reference intent.
- If a phase regresses atmosphere/depth mood, it is not considered complete even if FPS improves.

---

## Phase Plan

### Phase 0: Baseline Lock and Instrumentation (Critical)

Objective: lock visual direction and establish measurable quality/perf anchors before further migration.

Files:
- Modify: `src/themes/moonlit-forest/moonlit-forest-theme.js`
- Create/Modify: Moonlit QA capture scripts under `tests/`
- Create: `docs/MOONLIT_FOREST_ART_DIRECTION.md` (look-dev packet)
- Create: `docs/MOONLIT_FOREST_BASELINE_CAPTURE_PROTOCOL.md` (capture/review runbook)

Tasks:
- [x] Produce a Moonlit art-direction packet from reference images (palette, lighting ratios, fog density bands, composition targets).
- [x] Define "hero frame" camera specs (moon placement, horizon band, depth tiers, fog pocket target).
- [ ] Capture baseline screenshots for all presets (`Minimal`..`Extreme`) on both backends.
- [x] Record FPS, 1% low, frame-time variance, draw calls, and memory.
- [x] Add deterministic replay hooks (`seed`, `fixedDt`, event playback sequence).
- [x] Add automation for hero-frame checklist, event-anchor capture, and full preset sweep reporting.
- [ ] Capture event visual anchors for `LINE_CLEAR`, `COMBO`, `PIECE_LOCK`.

Exit criteria:
- Art-direction packet approved and frozen.
- Baseline pack committed and reproducible.
- Visual anchors documented and signed off.

---

### Phase 1: Renderer and Lifecycle Hardening (Critical)

Objective: make startup/shutdown/resume robust before feature migration.

Files:
- Modify: `src/themes/moonlit-forest/moonlit-forest-theme.js`

Tasks:
- [x] Normalize renderer init flow and backend/capability flags.
- [x] Add device-loss and re-init handling for WebGPU path.
- [x] Consolidate resize/listener registration with stable function references.
- [x] Track and clear all timeouts/intervals used by Moonlit effects.
- [x] Ensure `stop()` and theme switch fully dispose renderer/post/material resources.

Exit criteria:
- 100+ theme switches without leaked listeners/timers.
- No black-screen or stuck state on fallback transitions.

---

### Phase 2: Render Path Abstraction and Event Pipeline (High)

Objective: centralize frame rendering and gameplay-reactive state updates.

Files:
- Modify: `src/themes/moonlit-forest/moonlit-forest-theme.js`
- Create: `src/themes/moonlit-forest/moonlit-forest-post.js`
- Create: `src/themes/moonlit-forest/moonlit-forest-fx-controller.js`

Tasks:
- [x] Implement a single `renderFrame()` abstraction (WebGPU post / WebGL composer / direct render).
- [x] Replace direct DOM mutation-driven reactions with a GPU event signal pipeline.
- [x] Add event decay curves and per-effect envelopes for combo/line-clear reactions.
- [x] Route gameplay visuals through GPU signal/effect systems with no direct DOM mutation path.

Exit criteria:
- Gameplay events produce deterministic state updates without direct DOM writes.
- Renderer path switching is centralized and testable.

---

### Phase 3: Forest World Migration (Critical)

Objective: replace canvas-generated forest layers with GPU geometry.

Files:
- Modify: `src/themes/moonlit-forest/moonlit-forest-theme.js`
- Modify/Create: `src/themes/moonlit-forest/moonlit-forest-materials.js`

Tasks:
- [x] Replace `#moonlit-forest-back/mid/front` canvas backgrounds with instanced forest layers.
- [x] Implement depth-tiered tree silhouettes/meshes with wind sway and haze.
- [x] Add GPU ground undergrowth and low-cost volumetric fog.
- [x] Match reference-like moonlit composition with foreground framing and mid-ground fog basin.
- [x] Preserve depth/parallax identity across all quality presets.

Exit criteria:
- Canvas tree generation path disabled by default.
- Visual parity achieved for forest silhouette/depth identity.
- Visual intent pass: moon corridor + depth fog + framing silhouettes verified in review captures.
- High preset frame time equal or better than baseline.

---

### Phase 4: Hero Prop Migration (High)

Objective: move mushrooms, moonbeams, and wildlife to GPU scene primitives.

Files:
- Modify: `src/themes/moonlit-forest/moonlit-forest-theme.js`
- Modify: `src/themes/moonlit-forest/moonlit-forest-materials.js`

Tasks:
- [x] Replace DOM mushrooms with instanced emissive mushroom meshes/sprites.
- [x] Replace DOM moonbeams with volumetric beam meshes and noise modulation.
- [x] Replace DOM wildlife eyes/owl with GPU equivalents.
- [x] Re-map line-clear/combos to GPU uniform/instance-driven intensification.

Exit criteria:
- No Moonlit hero props rely on DOM nodes.
- Event-driven intensification parity validated.

---

### Phase 5: Particle and Reactive FX Migration (Critical)

Objective: migrate all burst/reactive DOM effects to pooled GPU systems.

Files:
- Create: `src/themes/moonlit-forest/moonlit-forest-particles.js`
- Create (optional): `src/themes/moonlit-forest/moonlit-forest-compute.js`
- Modify: `src/themes/moonlit-forest/moonlit-forest-theme.js`

Tasks:
- [x] GPU systems for fireflies, spores, wisps, leaves, mist.
- [x] GPU systems for sparkles, runes, aurora sweeps, shooting stars.
- [x] Pool emitter instances and avoid per-event allocations.
- [x] WebGPU compute path for high-density simulation; CPU fallback for WebGL.
- [x] Remove per-event `document.createElement` usage from reactive paths.

Exit criteria:
- Event-heavy gameplay no longer causes DOM churn spikes.
- Behavioral parity for all gameplay-reactive effects.

---

### Phase 6: Post-Processing and Color Pipeline (High)

Objective: deliver cinematic final image with stable performance.

Files:
- Modify: `src/themes/moonlit-forest/moonlit-forest-post.js`
- Modify: `src/themes/moonlit-forest/moonlit-forest-materials.js`

Tasks:
- [x] WebGPU path: `THREE.PostProcessing` chain (bloom, grading, vignette, optional fog composite).
- [x] WebGL path: `EffectComposer` fallback chain.
- [x] Optional MRT emissive isolation with strict material audit.
- [x] Preset-gated post quality and dynamic resolution scale controls.
- [x] Tune grading to preserve natural moonlit cinematic tone (no over-neon cast).

Exit criteria:
- High+ presets show clear visual uplift.
- Minimal/Low remain stable and lightweight.
- Color script compliance validated against art-direction packet.

---

### Phase 7: Quality Presets and Adaptive Budgets (High)

Objective: make quality behavior predictable and hardware-aware.

Tasks:
- [x] Convert quality presets into explicit GPU budgets (instances, particles, post scale).
- [x] Add adaptive throttling when frame budget is exceeded.
- [x] Validate live preset switching during gameplay.
- [x] Document preset table with target hardware classes.

Preset target matrix:

| Preset | Target hardware class | Post profile | GPU budget behavior |
|--------|------------------------|--------------|---------------------|
| Minimal | iGPU / low-power laptop | Post disabled by default | Aggressive adaptive downscale, reduced emissive burst density |
| Low | Older iGPU / entry dGPU | Post disabled by default | Strong adaptive scaling, conservative burst and resolution floor |
| Medium | Mainstream laptop dGPU / modern iGPU | Post enabled, non-MRT bloom chain | Balanced adaptive response, moderate resolution range |
| High | Gaming laptop / mid desktop dGPU | Post enabled with MRT when available | 60 FPS target, moderate adaptive down/up rates |
| Ultra | Upper-mid desktop dGPU | Full post with MRT | Tight adaptive range near native resolution |
| Extreme | High-end desktop dGPU | Full post with MRT at near-native scale | Quality-biased adaptive guardrails with smaller down-rate |

Exit criteria:
- No severe frame spikes during heavy combo sequences.
- Preset transitions are stable and deterministic.

---

### Phase 8: Validation Matrix and Soak Testing (Critical)

Objective: verify correctness, fallback behavior, and long-session stability.

Validation tooling:
- `tests/performance/benchmark-moonlit-phase8.html` (manual Phase 8 harness for backend validation, soak, stress, hero-frame checklist, anchor capture, preset sweep, evidence bundle export, and dual-backend comparison campaign)

Test matrix:
- Chrome stable: WebGPU + forced fallback
- Edge stable: WebGPU + forced fallback
- Firefox stable: fallback path
- Safari stable / Technology Preview: validate actual capability and fallback behavior
- Electron runtime used by the app

Tasks:
- [x] Validate all gameplay event hooks and thresholds.
- [x] Add hero-frame checklist and preset/anchor capture automation in harness + helper API.
- [ ] 30+ minute soak tests at Medium/High/Ultra.
- [ ] Repeated theme switching and window resize stress tests.
- [ ] Validate no visual regressions in tetromino styling.
- [ ] Run visual acceptance review against hero frame checklist and reference intent.

Exit criteria:
- No memory growth trend across soak tests.
- No functional regressions in gameplay-reactive visuals.
- Visual quality gates pass on both WebGPU and fallback paths.

---

### Phase 9: Legacy DOM/Canvas Decommission (Critical, Mandatory Release Gate)

Objective: remove all obsolete Moonlit DOM/Canvas rendering paths after parity is proven.

Files:
- Modify: `src/themes/moonlit-forest/moonlit-forest-theme.js`
- Modify: `index.html`
- Modify: `public/styles/main.css`
- Modify/remove legacy tests referencing old canvas pipeline

Mandatory deletion checklist:
- [x] Remove canvas tree generation, `toDataURL` background path, and Moonlit tree cache dependency.
- [x] Remove `toggleLegacySkyElements` and all legacy sky/moon DOM fallback toggles.
- [x] Remove legacy Moonlit DOM containers and selectors:
  - `#moonlit-forest-back`, `#moonlit-forest-mid`, `#moonlit-forest-front`
  - `#glowing-mushrooms`, `.moonbeam-container`, `#moonlit-wildlife`
  - `.moonlit-leaf`, `.forest-firefly`, `.forest-spore`, `.mystical-wisp`, `.ancient-rune`, `.aurora-shimmer`, `.shooting-star`, `.forest-mist`, and related keyframes
- [x] Remove Moonlit DOM effect factory methods that create transient nodes.
- [x] Remove temporary `moonlitLegacy` flag and migration-only branches.
- [x] Audit `src/rendering/renderer.js` Moonlit branch and remove overlapping legacy particle path if superseded.

Verification gates:
- [x] `rg -n "document\.createElement|canvas\.getContext\('2d'\)|toDataURL" src/themes/moonlit-forest` returns no production matches.
- [x] `rg -n "moonlit-forest-back|glowing-mushrooms|moonbeam-container|moonlit-wildlife" index.html public/styles/main.css src/themes/moonlit-forest` returns no production matches.
- [ ] Moonlit theme renders fully with GPU-only scene/effects in both WebGPU and fallback paths.

Exit criteria:
- Legacy DOM/Canvas implementation is fully removed from Moonlit production code.
- Feature parity and performance targets remain satisfied post-removal.

---

### Phase 10: Documentation and Release Hardening (Low)

Tasks:
- [x] Update architecture docs with renderer/capability decision flow.
- [x] Document material factories, particle buffer layout, and quality budget table.
- [x] Remove temporary logging not tied to debug flags.
- [ ] Record final metrics against Phase 0 baseline.

---

## Suggested File Layout After Upgrade

```text
src/themes/moonlit-forest/
├── moonlit-forest-theme.js          # Orchestration and lifecycle
├── moonlit-forest-materials.js      # Node/shader material factories
├── moonlit-forest-post.js           # Post-processing graph
├── moonlit-forest-particles.js      # Particle systems and emitters
├── moonlit-forest-compute.js        # Optional WebGPU compute kernels
└── moonlit-forest-tetrominos.js     # Existing tetromino styling
```

---

## Success Criteria

- [ ] Startup resilience: WebGPU failure always falls back cleanly.
- [ ] WebGPU path has no shader/pipeline validation errors on supported hardware.
- [ ] WebGL fallback path remains stable and visually coherent.
- [x] DOM/Canvas Moonlit rendering paths fully removed (Phase 9 complete).
- [ ] Medium/High presets hold stable 60 FPS on target hardware at 1080p.
- [ ] 30+ minute sessions show stable memory and no leak trend.
- [ ] Event-driven visuals (`LINE_CLEAR`, `COMBO`, `PIECE_LOCK`) preserve gameplay semantics.
- [ ] Visual output meets art-direction gates: moonlit atmosphere, layered depth, cinematic framing, and controlled bioluminescent accents.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| WebGPU init/device-loss instability | Medium | High | Explicit fallback + device-loss re-init |
| Visual mismatch during staged migration | High | Medium | Baseline captures + phase gates |
| Loss of reference mood despite technical success | Medium | High | Art-direction packet + hero frame quality gates |
| Post/MRT integration regressions | Medium | High | Feature flags + delayed MRT enable |
| Compute instability on some devices | Medium | Medium | Optional compute + CPU fallback |
| Regressions after legacy deletion | Medium | High | Mandatory verification gates in Phase 9 |

---

## References

- [Three.js WebGPURenderer docs](https://threejs.org/docs/pages/WebGPURenderer.html)
- [Three.js TSL docs](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [Three.js WebGPU examples](https://threejs.org/examples/?q=webgpu)
- [Moonlit Forest Art Direction Packet](./MOONLIT_FOREST_ART_DIRECTION.md)
- [Moonlit Forest Baseline Capture Protocol](./MOONLIT_FOREST_BASELINE_CAPTURE_PROTOCOL.md)
- [Ice Temple WebGPU Upgrade Plan](./ICE_TEMPLE_WEBGPU_UPGRADE_PLAN.md)
- [Black Hole WebGPU Upgrade Plan](./BLACK_HOLE_WEBGPU_UPGRADE_PLAN.md)
- Moonlit Forest reference set from product direction (provided in this planning thread)
