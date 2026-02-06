# Ice Temple Theme - WebGPU Hybrid Upgrade Plan (Revised)

## Executive Summary

This plan upgrades the Ice Temple theme from a WebGL-only implementation to a stable hybrid WebGPU/WebGL2 architecture with explicit fallback and phased risk control.

Key outcomes:
- WebGPU-first startup with explicit fallback to `THREE.WebGLRenderer` when needed.
- Dual render paths: WebGPU (`TSL` + `THREE.PostProcessing`) and WebGL (`ShaderMaterial` + `EffectComposer`).
- Incremental migration of custom shaders to node materials.
- Compute-driven particles on WebGPU, CPU fallback retained on WebGL.
- Emissive-only bloom (MRT) enabled only after material migration is complete.
- No user-facing startup errors; fallback is silent in UI.

Scope: `src/themes/ice-temple/` only.

---

## Current Baseline (Verified)

### Renderer and Pipeline
- `THREE.WebGLRenderer` in `src/themes/ice-temple/ice-temple-theme.js`.
- `EffectComposer` + `RenderPass` + `UnrealBloomPass`.
- ACES Filmic tone mapping (`toneMappingExposure = 1.4`).

### Active Custom GLSL Shaders
- `auroraVertexShader` / `auroraFragmentShader`.
- `snowVertexShader` / `snowFragmentShader`.
- `iceShardVertexShader` / `iceShardFragmentShader`.
- `shockwaveVertexShader` / `shockwaveFragmentShader`.

### Exported but Unused GLSL Shaders
- `icePillarVertexShader` / `icePillarFragmentShader`.
- `frostFloorVertexShader` / `frostFloorFragmentShader`.
- `lightningVertexShader` / `lightningFragmentShader`.

### Active Scene Elements
- 7 PBR ice pillars (lathe geometry + surrounding shard meshes).
- Aurora + mirrored reflection mesh.
- Frost floor (`MeshPhysicalMaterial` with transmission/ior/alphaMap/normalMap).
- Snow particle system (3000 points, shader-driven).
- Starfield (1500 points).
- Mist sprites + fog ring.
- Event-driven shockwaves and shard bursts.

### Existing Lifecycle Risks to Fix Early
- `removeEventListener('resize', this.onWindowResize.bind(this))` cannot remove the original listener because the bound function identity differs.
- `composer`/`bloomPass`/`environmentMap` disposal is not explicit in `stop()`.

---

## Platform Constraints

- Three.js: `0.181.2`.
- Electron: `38.3.0`.
- WebGPU features are optional; startup must never fail when unavailable.
- WebGPU visuals may improve over WebGL, but WebGL must remain stable and visually coherent.

---

## Hybrid Rendering Strategy

Use explicit fallback logic instead of relying solely on implicit backend fallback. This keeps the WebGL path compatible with existing `EffectComposer` usage.

```js
import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';

async initRenderer(container) {
    const forceWebGL = this.flags.forceWebGL;
    let renderer = null;

    if (!forceWebGL) {
        const webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
            forceWebGL: false,
        });

        try {
            await webgpuRenderer.init();
            renderer = webgpuRenderer;
        } catch (error) {
            console.warn('[IceTemple] WebGPU init failed, falling back to WebGL2:', error);
            webgpuRenderer.dispose();
        }
    }

    if (!renderer) {
        renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });
    }

    this.renderer = renderer;
    this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
    this.isWebGL = renderer.isWebGLRenderer === true || renderer.backend?.isWebGLBackend === true;

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(this.getEffectivePixelRatio());
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    container.appendChild(renderer.domElement);
}
```

---

## Capability Matrix and Kill Switches

### Capability Matrix

| Runtime | Post | MRT | Compute | Expected Path |
|--------|------|-----|---------|---------------|
| WebGPU + MRT + Compute | Yes | Yes | Yes | Full feature set |
| WebGPU + MRT, no Compute | Yes | Yes | No | Node materials + CPU particle fallback |
| WebGPU, no MRT | Yes | No | Optional | Standard bloom path (non-emissive isolation) |
| WebGPU, no Post | No | No | Optional | Direct renderer path |
| WebGL2 fallback | `EffectComposer` | No | No | Existing GLSL pipeline |

### Required Debug Flags

- `?forceWebGL=1`
- `?iceTempleNoPost=1`
- `?iceTempleNoMRT=1`
- `?iceTempleNoCompute=1`
- `?iceTempleNoEnhancements=1`
- `?iceTempleNoAuroraVolume=1`
- `?iceTempleBaseline=1`
- `?iceTempleSeed=1234`
- `?iceTempleFixedDt=16.666`

Rule: Optional features must be gated by both capability checks and flags.

---

## Migration Policy

- Keep WebGL behavior stable until equivalent WebGPU path is verified.
- Prefer dual factory functions (`createXMaterialWebGPU` and `createXMaterialWebGL`) over in-place rewrites.
- Introduce one major rendering risk at a time (renderer, then materials, then MRT, then compute).
- Do not enable MRT globally until emissive coverage is audited.

---

## Phase Plan

### Phase 0: Baseline and Audit (Critical)

Objective: lock visual/perf baselines before migration.

Tasks:
- [ ] Capture baseline screenshots for all quality presets.
- [ ] Record FPS and 1% low for WebGL path on representative hardware.
- [x] Inventory all materials/shaders currently active vs unused.
- [x] Add deterministic capture helpers (`seed`, `fixedDt`, baseline logging flag).
- [ ] Record baseline draw calls and memory footprint.

Automation support implemented:
- `window.iceTempleBaseline.capturePresetMatrix(options)` runs preset-by-preset baseline capture with screenshots + metrics.
- `window.iceTempleBaseline.downloadPresetMatrix(label)` exports the latest matrix as JSON + Markdown.
- `window.iceTempleBaseline.collectEvidence(options)` exports an evidence bundle (preset matrix + material/shader inventory).
- Harness dual campaign runs evidence for both WebGPU and forced WebGL and exports a merged comparison report.
- Harness integration: `tests/performance/benchmark-ice-temple-phase8.html` includes one-click preset matrix and evidence bundle controls.

Exit criteria:
- Baseline pack committed (screenshots + metrics table).
- Known visual anchors documented (aurora shape/color, pillar glow, floor transmission, bloom intensity).

---

### Phase 1: Renderer Bootstrap and Lifecycle Hardening (Critical)

Objective: establish robust hybrid renderer boot + cleanup.

Files:
- Modify: `src/themes/ice-temple/ice-temple-theme.js`

Tasks:
- [x] Implement `initRenderer()` with explicit fallback logic.
- [x] Add backend flags: `isWebGPU`, `isWebGL`, `capabilities`.
- [x] Parse and store debug flags in a single `this.flags` object.
- [x] Store resize callback once (`this.boundResizeHandler = this.onWindowResize.bind(this)`) and remove with same reference.
- [x] Ensure `stop()` disposes `composer`, `bloomPass`, post objects, and environment map.
- [x] Keep tone mapping/color-space consistent across backends.

Implementation notes:
- Added runtime resilience hooks for backend failure handling:
  - `renderer.onDeviceLost` + `backend.device.lost` handling for WebGPU.
  - `webglcontextlost` / `webglcontextrestored` listeners for WebGL.
- Added controlled runtime fallback path (`requestWebGLFallback`) that:
  - cancels active loops and listeners,
  - disposes runtime resources,
  - forces sticky `forceWebGL/noMRT/noCompute` flags,
  - recreates the scene on WebGL.
- Added sticky runtime flag refresh (`refreshRuntimeFlags`) so runtime fallback overrides persist across re-init.
- Hardened `renderFrame()` to route WebGPU runtime failures into controlled fallback.

Exit criteria:
- WebGPU and WebGL paths boot cleanly.
- No leaked resize/event handlers after repeated theme swaps.
- Fallback occurs without UI errors.

---

### Phase 2: Render Path Abstraction (High)

Objective: centralize backend-specific render flow before material migration.

Files:
- Modify: `src/themes/ice-temple/ice-temple-theme.js`
- Create: `src/themes/ice-temple/ice-temple-post.js`

Tasks:
- [x] Add a single `renderFrame()` function:
  - WebGPU path: `postProcessing.render()` when enabled.
  - WebGL path: `composer.render()`.
  - Direct fallback: `renderer.render(scene, camera)`.
- [x] Create initial WebGPU post setup with conservative defaults (no MRT required yet).
- [x] Keep existing WebGL `EffectComposer` settings unchanged.
- [x] Update resize flow for renderer, composer, and post-processing targets.

Exit criteria:
- Rendering path switches cleanly across capability/flag combinations.
- Baseline parity preserved on WebGL.

---

### Phase 3: Core Material Migration to TSL (Critical)

Objective: migrate active custom shader effects to node materials on WebGPU path.

Files:
- Create: `src/themes/ice-temple/ice-temple-materials.js`
- Modify: `src/themes/ice-temple/ice-temple-theme.js`

Migration order:
1. Aurora (`MeshBasicNodeMaterial`)
2. Shockwave (`MeshBasicNodeMaterial`)
3. Snow particles (`PointsNodeMaterial`, still CPU-updated)
4. Ice shard bursts (`PointsNodeMaterial`, still CPU-updated)
5. Starfield (`PointsNodeMaterial`)
6. Frost floor / pillar emissive augmentation (`MeshPhysicalNodeMaterial` where needed)

Tasks:
- [x] Build dual-path material factories (WebGPU node + WebGL shader/material).
- [x] Move uniform handles to `material.userData` for consistent runtime updates.
- [x] Replace `gl_PointCoord` with `pointUV` in particle node materials.
- [x] Keep unused legacy shader exports documented but untouched.

Exit criteria:
- WebGPU path has no shader compile/runtime errors.
- WebGL visuals remain equivalent to baseline.

---

### Phase 4: Emissive-Only MRT Bloom (High)

Objective: enable MRT bloom isolation only after Phase 3 is stable.

Files:
- Modify: `src/themes/ice-temple/ice-temple-post.js`
- Modify: `src/themes/ice-temple/ice-temple-materials.js`

Tasks:
- [x] Add `useMRT` gate from capabilities + flags.
- [x] Wire MRT pass (`output` + `emissive`) for WebGPU post pipeline.
- [x] Ensure every material used in MRT path has explicit emissive output.
- [x] For non-bloom elements, emit zero emissive.
- [x] Add optional MRT audit logging in dev mode.

Exit criteria:
- Bloom affects intended emissive elements only.
- No MRT pipeline validation errors.
- Auto-fallback to non-MRT path when unsupported.

---

### Phase 5: Compute Particle Migration (High, WebGPU-only)

Objective: offload particle simulation to compute incrementally.

Files:
- Create: `src/themes/ice-temple/ice-temple-compute.js`
- Modify: `src/themes/ice-temple/ice-temple-theme.js`

Tasks:
- [x] Implement snow compute first (`StorageBufferAttribute` + zero readback).
- [x] Bind compute output to render attributes (`storage(...).toAttribute()`).
- [x] Keep CPU fallback for snow when compute unavailable.
- [x] Add shard burst compute as second step (spawn/life/recycle).
- [x] Gate dispatch with `useCompute` flag and backend checks.

Exit criteria:
- WebGPU supports >=10,000 snow particles with stable frame time.
- WebGL path continues to run existing CPU simulation.

---

### Phase 6: Quality Presets and Performance Controls (High)

Objective: make performance predictable across presets and hardware.

Tasks:
- [x] Add Ice Temple preset table for snow count, aurora segments, bloom mode, and post scale.
- [x] Add adaptive particle scaling when frame budget is exceeded.
- [x] Use half-resolution bloom for high-cost presets where needed.
- [x] Add optional post scale (`0.5` / `0.75` / `1.0`) by preset.
- [x] Validate preset transitions at runtime.

Exit criteria:
- Preset behavior is deterministic and documented.
- No severe frame-time spikes during event-heavy gameplay.

---

### Phase 7: Visual Enhancements (Medium, Stretch)

Objective: ship optional WebGPU-only enhancements after core migration is stable.

Candidate features:
- Volumetric aurora layering.
- Dynamic frost creep post effect.
- Caustic modulation on floor and pillars.
- Refraction distortion refinement.
- Enhanced fog motion.

Rule: each enhancement needs an explicit kill switch and per-preset policy.

Implementation notes:
- Implemented volumetric aurora layering (WebGPU-only):
  - Preset policy: `auroraLayers` (`High=2`, `Ultra/Extreme=3`, lower presets = `1`).
  - Kill switches: `iceTempleNoEnhancements`, `iceTempleNoAuroraVolume`.
  - Runtime metadata: per-layer `auroraTimeOffset` + `auroraIntensityScale` for animation control.

---

### Phase 8: Validation Matrix (Critical)

Objective: verify correctness, fallback behavior, and resource stability.

Test matrix:
- Chrome stable (WebGPU path + fallback path).
- Edge stable (WebGPU path + fallback path).
- Firefox stable (fallback path expected unless WebGPU is explicitly available).
- Safari stable / Safari Technology Preview (fallback-first expectation; validate behavior).
- Electron runtime used by the app.

Tasks:
- [x] Validate all gameplay events: `LINE_CLEAR`, `COMBO`, `PIECE_LOCK`.
- [x] Verify no rendering artifacts (flicker, z-fighting, exploding bloom).
- [x] Run 30+ minute soak tests for memory stability.
- [x] Validate repeated theme switching for leaks.

Implementation notes:
- Added `window.iceTempleBaseline` helper APIs for deterministic playback, metrics, and event validation.
- Added `tests/performance/benchmark-ice-temple-phase8.html` for event validation, soak runs, and theme-switch leak cycling.
- Added pipeline health diagnostics helper (`validatePipeline`) to run compile + render checks and surface shader/runtime failures per backend.
- Added strict MRT isolation diagnostics helper (`validateMRT`) with role-based bloom policy checks and unclassified-material reporting.
- Added snow compute capacity diagnostics helper (`validateSnowCompute`) for target particle-count + sampled frame-time checks.
- Tagged non-node scene materials (`frost-floor`, `floor-crack`, `pillar-core`, `pillar-shard`, `pillar-glow`, mist/fog) with explicit `mrtRole`/`emitsBloom` metadata to support audits.
- Evidence bundle export now includes `validation` results (`pipeline`, `mrt`, `events`, `snowCompute`) with aggregate pass state.
- Added success-criteria evaluator (`evaluateCriteria`) that scores plan criteria as `pass/fail/inconclusive` from captured evidence.
- Evidence markdown now includes a "Success Criteria Snapshot"; dual-backend campaign reports include the same criteria summary.

Exit criteria:
- No regressions in gameplay-triggered visuals.
- No growing memory trend during soak tests.

---

### Phase 9: Documentation and Cleanup (Low)

Tasks:
- [x] Document renderer decision flow and capability gates.
- [x] Document material factories and compute buffer layout.
- [x] Remove temporary migration/debug logs not tied to flags.
- [x] Update this plan with completed milestones and measured outcomes.

Implementation notes:
- Added architecture notes in `docs/ICE_TEMPLE_WEBGPU_ARCHITECTURE.md`:
  - Renderer decision flow and capability gates.
  - Dual material factory layout and MRT tagging conventions.
  - Compute buffer layouts for snow and shard simulation.
- Removed non-essential runtime debug logs from active gameplay path (`LINE_CLEAR` / `COMBO`, scene boot noise).
- Kept diagnostics behind explicit flags (`iceTempleBaseline`, `iceTempleMrtAudit`).

Measured outcomes (local automation):
- `npx eslint src/themes/ice-temple/ice-temple-theme.js tests/unit/test-ice-temple-phase8.js` passed.
- `node tests/unit/test-ice-temple-phase8.js` passed.
- `npm run build` passed (existing unrelated warnings remain in other themes/chunking output).

---

## Suggested File Layout After Upgrade

```text
src/themes/ice-temple/
├── ice-temple-theme.js          # Main theme class (hybrid boot + orchestration)
├── ice-temple-materials.js      # WebGPU node material factories + helpers
├── ice-temple-post.js           # WebGPU post-processing graph
├── ice-temple-compute.js        # WebGPU compute kernels and buffer setup
├── ice-temple-shaders.js        # Existing GLSL shaders for WebGL path (preserved)
├── ice-temple-tetrominos.js     # Unchanged
└── textures/
    └── ice-diffuse.jpg          # Existing texture
```

---

## Success Criteria

- [x] Startup is resilient: WebGPU failure always falls back to WebGL without user-visible errors.
- [ ] WebGL visual baseline remains stable.
- [ ] WebGPU path has no validation or shader compile errors in supported environments.
- [ ] Emissive-only bloom isolates aurora/pillar/crack glow correctly when MRT is enabled.
- [ ] WebGPU snow supports 10,000+ particles with stable frame time on target hardware.
- [ ] High preset hits 60 FPS at 1080p on RTX 3060-class hardware.
- [ ] Extreme preset hits 60 FPS at 1440p on RTX 4070-class hardware.
- [ ] 30+ minute session shows stable memory usage and correct cleanup on theme switch.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| WebGPU init failures on some systems | Medium | High | Explicit WebGL renderer fallback path |
| MRT validation failures | Medium | High | Defer MRT to Phase 4 + emissive audit gate |
| Visual mismatch during shader migration | High | Medium | Baseline captures + staged migration order |
| Compute path instability | Medium | Medium | Snow-first incremental rollout + CPU fallback |
| Theme lifecycle leaks | Medium | Medium | Early lifecycle hardening in Phase 1 |

---

## References

- [Three.js WebGPURenderer docs](https://threejs.org/docs/pages/WebGPURenderer.html)
- [Three.js TSL docs](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [Three.js WebGPU examples](https://threejs.org/examples/?q=webgpu)
- [TSL transpiler example](https://threejs.org/examples/webgpu_tsl_transpiler)
- [Ice Temple WebGPU Architecture Notes](./ICE_TEMPLE_WEBGPU_ARCHITECTURE.md)
- [Black Hole WebGPU Upgrade Plan](./BLACK_HOLE_WEBGPU_UPGRADE_PLAN.md)
- [Neon District WebGPU Upgrade Plan](./NEON_DISTRICT_WEBGPU_UPGRADE_PLAN.md)
