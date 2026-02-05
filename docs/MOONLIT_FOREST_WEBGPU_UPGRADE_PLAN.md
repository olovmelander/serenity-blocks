# Moonlit Forest WebGPU Hybrid Upgrade Plan

## Objective
Upgrade `src/themes/moonlit-forest/` from DOM/Canvas-only visuals to a WebGPU-first Three.js pipeline while preserving all current Moonlit Forest gameplay-reactive features.

The renderer must:
- Attempt `WebGPURenderer` first.
- Use Three.js backend fallback to WebGL2 automatically when WebGPU is unavailable.
- Degrade silently (no user-facing error).
- Preserve existing Moonlit Forest effects during migration.

## Scope
- Primary theme: `src/themes/moonlit-forest/moonlit-forest-theme.js`
- New WebGPU/TSL materials: `src/themes/moonlit-forest/moonlit-forest-materials.js`
- Plan document: `docs/MOONLIT_FOREST_WEBGPU_UPGRADE_PLAN.md`

## Hybrid Architecture Standard

### Renderer contract
Use `WebGPURenderer` as the main entry point:

```js
const renderer = new WEBGPU.WebGPURenderer({
  antialias: this.getAntialiasEnabled(),
  powerPreference: 'high-performance',
  alpha: false,
  forceWebGL: this.shouldForceWebGL(),
});
await renderer.init();

this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
this.isWebGL = renderer.backend?.isWebGLBackend === true || !this.isWebGPU;
```

### Material strategy
- WebGPU backend: TSL NodeMaterials (`MeshBasicNodeMaterial`, `PointsNodeMaterial`).
- WebGL2 backend: GLSL `ShaderMaterial` fallback with visual parity targets.

### Feature strategy
- Keep existing Moonlit Forest DOM/canvas effects active while introducing WebGPU visuals in layers.
- Replace legacy systems incrementally (never big-bang remove everything at once).

## Current Baseline (As-Is)
- Trees, mushrooms, moonbeams, leaves, wildlife, spores, wisps, sparkles, runes: DOM/Canvas driven.
- Quality presets: Minimal, Low, Medium, High, Ultra, Extreme.
- Reactive hooks: `LINE_CLEAR`, `COMBO`, `PIECE_LOCK`.

## Migration Phases

## Phase 1 - Hybrid Renderer Foundation
Goal: Establish reliable WebGPU-first renderer in Moonlit Forest with silent fallback.

Deliverables:
- `initRenderer(container)` uses `WebGPURenderer` + fallback behavior.
- Backend detection flags (`isWebGPU`, `isWebGL`).
- Proper resize, animation loop, and disposal lifecycle.
- Legacy sky/moon can be hidden when 3D path is active.

Acceptance:
- Theme renders on WebGPU-capable browser.
- Theme still renders when WebGPU is unavailable.
- No theme-breaking errors on switch/start/stop.

## Phase 2 - 3D Atmosphere Layer (TSL + WebGL fallback)
Goal: Introduce world-class atmospheric backdrop while preserving existing foreground effects.

Deliverables:
- WebGPU TSL materials for:
  - Sky gradient
  - Moon disc
  - Moon halo
  - Starfield
- WebGL shader fallback equivalents.
- Subtle camera breathing and starfield drift.

Acceptance:
- Atmosphere remains visually coherent across backends.
- Existing DOM forest layers still function above the 3D backdrop.

## Phase 3 - Forest Geometry Replacement (Incremental)
Goal: Replace canvas tree layers with instanced 3D layers without visual regression.

Deliverables:
- Instanced back/mid/front tree groups.
- Wind sway animation with depth-aware intensity.
- Ground plane and low-cost fog layers.

Acceptance:
- Existing visual identity preserved.
- Performance equal or better than current on High quality.

## Phase 4 - Mushroom + Moonbeam Upgrade
Goal: Move signature Moonlit assets into GPU-driven rendering.

Deliverables:
- Instanced bioluminescent mushrooms (TSL + fallback shader).
- Volumetric moonbeams/god-ray style meshes.
- Event-driven intensification on line clears.

Acceptance:
- Mushrooms and beams react to game events as today.
- Bloom/lighting style remains stable under quality changes.

## Phase 5 - Particle System Migration
Goal: Replace high-churn DOM particles with GPU/CPU hybrid particle systems.

Deliverables:
- Fireflies, spores, wisps, enchanted leaves, mist particles on Three.js path.
- WebGPU compute where available.
- CPU simulation fallback on WebGL2.

Acceptance:
- DOM churn reduced significantly.
- No event-effect loss (line clear/combo/piece lock still mapped).

## Phase 6 - Post-Processing and Color Pipeline
Goal: Introduce cinematic finishing without sacrificing stability.

Deliverables:
- WebGPU path: `THREE.PostProcessing` pipeline (bloom + grading + vignette).
- WebGL2 path: `EffectComposer` equivalent.
- Quality-gated post settings.

Acceptance:
- Minimal/Low remain lightweight.
- High+ gain clear visual uplift.

## Phase 7 - Wildlife and Combo FX Migration
Goal: Move remaining DOM reactive effects into 3D equivalents.

Deliverables:
- Wildlife eyes/owl equivalents.
- Aurora, shooting stars, rune and sparkle systems.
- Preserve thresholds and combo scaling semantics.

Acceptance:
- Behavioral parity with current theme logic.

## Phase 8 - Optimization, QA, and Cleanup
Goal: Ship-ready performance and maintainability.

Deliverables:
- Remove obsolete legacy paths only after parity validation.
- Add backend/quality test matrix and perf baselines.
- Add fallback-specific smoke checks (`forceWebGL=1`).

Acceptance:
- No memory leak on repeated theme switching.
- Stable 60fps target on target hardware for Medium/High.
- No regressions in tetromino styling and combo VFX logic.

## Quality and Performance Guardrails
- Keep quality presets backward-compatible.
- Budget by preset:
  - Minimal/Low: prioritize stability and low GPU load.
  - Medium/High: balanced fidelity and smoothness.
  - Ultra/Extreme: advanced effects with fallback-safe toggles.
- Use dynamic pixel ratio where necessary.
- Favor `InstancedMesh`, pooled particles, and minimal allocations per frame.

## Testing Matrix
- WebGPU expected: latest Chrome/Edge/Safari with WebGPU enabled.
- WebGL fallback expected: Firefox stable, older Chromium, forced fallback mode.

Core checks:
- Theme switch reliability (start/stop/resume).
- Resize behavior.
- Event reactions (`LINE_CLEAR`, `COMBO`, `PIECE_LOCK`).
- Performance at all quality tiers.
- Resource disposal after repeated switches.

## Implementation Notes
- Preserve existing Moonlit Forest aesthetics first, then enhance.
- Avoid replacing all systems in one release.
- Ship each phase behind stable feature gates where possible.

## Definition of Done
- Moonlit Forest runs through hybrid renderer path in production.
- WebGPU path uses TSL materials for core atmospheric components.
- WebGL2 fallback is automatic and silent.
- Existing gameplay-reactive theme behavior is preserved.
- Performance and memory are improved versus baseline in Medium+ quality tiers.
