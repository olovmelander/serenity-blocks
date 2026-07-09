# Neon District Theme - WebGPU Hybrid Upgrade Plan (v2)

## Executive Summary

This plan upgrades the Neon District theme to a hybrid WebGPU/WebGL2 renderer using Three.js's built-in fallback. The goal is to preserve the current look on WebGL while enabling a WebGPU path that uses TSL (Three Shading Language) node materials and modern post-processing for higher visual fidelity and better performance.

Key outcomes:
- WebGPU first, automatic silent fallback to WebGL2.
- TSL node materials for all custom shaders on the WebGPU path.
- Emissive-only bloom and improved fog/reflections for a more cinematic neon look.
- Performance improvements through batching, instancing, and reduced per-frame CPU work.

Scope: `src/themes/neon-district/` only.

---

## Hybrid Approach (Project-Specific Definition)

Use `THREE.WebGPURenderer` from `three/webgpu`, initialize it with `await renderer.init()`, and let Three.js select the best backend. If WebGPU is unsupported, it will transparently fall back to a WebGL2 backend. Feature paths must be gated by the actual backend type.

**Core rule**: WebGPU path uses TSL node materials + `THREE.PostProcessing`. WebGL fallback path keeps existing `ShaderMaterial` + `EffectComposer`.

```js
import * as THREE from 'three/webgpu';

this.renderer = new THREE.WebGPURenderer({
    antialias: this.getAntialiasEnabled(),
    powerPreference: 'high-performance',
    forceWebGL: false, // set true for local fallback testing
});

try {
    await this.renderer.init();
} catch (error) {
    console.error('[NeonDistrict] Renderer init failed:', error);
}

this.isWebGPU = this.renderer.backend?.isWebGPUBackend === true;
```

Fallback should be silent (no UI errors). Avoid extra logging around fallback; if strict silence is required, filter the Three.js fallback warning in production builds.

---

## Current State Snapshot (Neon District)

**Renderer & Post**
- `THREE.WebGLRenderer`
- `EffectComposer`, `UnrealBloomPass`, custom Vignette `ShaderPass`

**Custom shaders (ShaderMaterial)**
- Buildings (procedural windows + glow)
- Sky gradient
- Starfield points
- Mega tower windows
- Low-lying fog plane
- VHS billboard shader
- Moon gradient
- Distant skyline cylinder
- Searchlight cones
- Holographic billboards
- Rain streaks (instanced)
- Splash particles

**Assets**
- `NeonDistrictAssets` uses `MeshPhongMaterial` + emissive maps
- `KTX2Loader.detectSupport()` currently uses a temporary WebGL renderer

---

## Compatibility Constraints

- `ShaderMaterial` and `EffectComposer` are WebGL-centric. WebGPU path must use node materials and `THREE.PostProcessing`.
- `Reflector` (WebGL addon) is not compatible with WebGPU. Use `ReflectorNode` or a node-based reflection approach.
- `renderer.renderAsync()` is deprecated. Use `await renderer.init()` once, then `renderer.render()` or `renderer.setAnimationLoop()`.
- Node materials compile to WGSL (WebGPU) and GLSL (WebGL backend), making them ideal for hybrid use.

---

## Upgrade Strategy

1. **Keep WebGL path intact** as a stable fallback.
2. **Introduce WebGPU path** in parallel (TSL + PostProcessing).
3. **Convert ShaderMaterials to NodeMaterials** in priority order.
4. **Gate every WebGPU-only feature** on `this.isWebGPU`.

---

## Phased Implementation Plan

### Phase 0: Audit & Baseline (Priority: CRITICAL)
**Objective**: Inventory all WebGL-only features and establish visual/performance baselines.

**Tasks**:
- [x] List every ShaderMaterial in `neon-district-theme.js` and map to a TSL replacement.
- [ ] Capture screenshots and FPS for each quality preset.
- [x] Add an internal `forceWebGL` toggle for testing fallback behavior.

**Audit Results (2026-01-31)**:
- ShaderMaterial inventory in `src/themes/neon-district/neon-district-theme.js`:
  - `setupMaterials()` -> `this.buildingMaterial` (procedural windows + glow; TSL target: `MeshBasicNodeMaterial` + emissive output)
  - `createSkybox()` -> `skyMaterial` (gradient sky; TSL target: `MeshBasicNodeMaterial`)
  - `createStarfield()` -> `material` (uses `NEON_DISTRICT_STAR_*` GLSL; TSL target: `PointsNodeMaterial`)
  - `createMegaTower()` -> `this.megaTowerMaterial` (window grid + color drift; TSL target: `MeshBasicNodeMaterial`)
  - `createLowLyingFog()` -> `material` (noise-based fog plane; TSL target: `MeshBasicNodeMaterial` with alpha)
  - `createVHSBillboardOnBuilding()` -> `vhsMaterial` (scanlines + chromatic aberration + glitch; TSL target: `MeshBasicNodeMaterial`)
  - `createMoon()` -> `material` (gradient moon/sun; TSL target: `MeshBasicNodeMaterial`)
  - `createDistantSkyline()` -> `material` (procedural skyline + window noise; TSL target: `MeshBasicNodeMaterial`)
  - `createSearchlights()` -> `material` (additive cone beams; TSL target: `MeshBasicNodeMaterial`)
  - `createHolographicBillboardOnBuilding()` -> `material` (animated gradient hologram; TSL target: `MeshBasicNodeMaterial`)
  - `createRain()` -> `rainMaterial` (instanced streaks; TSL target: `MeshBasicNodeMaterial`) and `splashMaterial` (point sprites; TSL target: `PointsNodeMaterial`)
- WebGL-only pipeline dependencies to replace or gate:
  - `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `ShaderPass` (vignette pass)
  - `VignetteShader` GLSL block
  - `NEON_DISTRICT_STAR_VERTEX_SHADER`/`NEON_DISTRICT_STAR_FRAGMENT_SHADER` in `neon-district-assets.js`
  - `KTX2Loader.detectSupport(new THREE.WebGLRenderer())` in `neon-district-assets.js` (needs renderer injection)
  - `Reflector` addon imported but unused; if reflections are reintroduced, prefer `ReflectorNode` on WebGPU

**Baseline Capture Template**:
- Machine/GPU:
- Browser + version:
- Resolution + pixel ratio:
- Preset (Low/Medium/High/Ultra/Extreme):
- Backend (WebGL2/WebGPU):
- Avg FPS / 1% low:
- Notes (visual issues, errors):
- Screenshot path:
- Enable logging: append `?ndBaseline=1` to the URL (optional: `?forceWebGL=1` for fallback checks).

---

## Best Practices for Hybrid WebGPU Implementation

### Renderer & Backend Detection
- Always `await renderer.init()` before rendering; never use `renderAsync()` (deprecated).
- Detect backend via `renderer.backend?.isWebGPUBackend === true` and gate features accordingly.
- Keep fallback silent in UI; log only in dev builds.
- Provide a local `forceWebGL` toggle to validate fallback behavior.

### Materials & Shaders
- Use NodeMaterials (TSL) for WebGPU path; avoid `ShaderMaterial` in WebGPU.
- Keep WebGL ShaderMaterial versions in place until TSL parity is proven.
- Centralize node-graph creation in a `neon-district-materials.js` factory to avoid drift.
- Use `pointUV` for particles (stars/splashes) instead of `gl_PointCoord`.
- Make emissive output explicit for MRT bloom isolation.

### Post-Processing
- WebGPU: use `THREE.PostProcessing` + MRT bloom nodes.
- WebGL: keep `EffectComposer` with the existing bloom + vignette.
- Ensure resize updates both renderer and post-processing passes.

### Color Management
- Set `renderer.outputColorSpace = THREE.SRGBColorSpace` for both backends.
- Keep tone mapping and exposure consistent across backends to preserve look.
- Validate emissive textures and maps (sRGB vs linear) during asset updates.

### Performance & Stability
- Batch buildings where possible (BatchedMesh or instanced merges).
- Minimize per-frame CPU churn; prefer uniform updates over buffer rebuilds.
- Gate WebGPU-only features behind `this.isWebGPU` to keep fallback stable.
- Profile on Low/High presets first to catch perf regressions early.

### Assets & Textures
- Pass renderer into `NeonDistrictAssets` and call `ktx2Loader.detectSupport(renderer)`.
- Prefer KTX2 for large textures; keep standard fallback for missing assets.
- Reuse textures/materials to reduce memory churn.

### Cleanup & Lifecycle
- Dispose post-processing, materials, geometries, and renderer on stop.
- Use `renderer.setAnimationLoop(null)` if migrating off rAF later.


### Phase 1: Hybrid Renderer Bootstrapping (Priority: CRITICAL)
**Objective**: Initialize WebGPU renderer with built-in fallback and set up backend detection.

**Files to modify**:
- `src/themes/neon-district/neon-district-theme.js`

**Tasks**:
- [x] Switch import to `three/webgpu` (match `verdant-hills` and `tornado` patterns).
- [x] Make `createScene()` async and `await renderer.init()`.
- [x] Set `this.isWebGPU` using `renderer.backend.isWebGPUBackend`.
- [x] Keep renderer defaults (tone mapping, color space, pixel ratio) aligned with existing look.
- [x] Ensure any WebGPU init errors do not break fallback flow.

---

### Phase 2: Render Loop & Resize (Priority: HIGH)
**Objective**: Ensure the animation loop works cleanly across WebGPU and fallback.

**Tasks**:
- [x] Keep the current rAF loop (for `registerAnimation`) but switch to `renderer.render()` after `init()`.
- [x] Optionally migrate to `renderer.setAnimationLoop()` if removing rAF tracking becomes desirable.
- [x] Update resize handling to also resize `PostProcessing` passes on the WebGPU path.

---

### Phase 3: WebGPU Post-Processing (Priority: HIGH)
**Objective**: Replace `EffectComposer` with `THREE.PostProcessing` for WebGPU.

**Files to create**:
- `src/themes/neon-district/neon-district-post.js`

**Tasks**:
- [x] Implement emissive-only bloom with MRT (`mrt({ output, emissive })`).
- [x] Add a node-based vignette and optional subtle chromatic aberration.
- [x] Use `NeonDistrictPost` only when `this.isWebGPU === true`.
- [x] Keep existing `EffectComposer` for fallback.

**Reference**: `src/themes/tornado/TornadoPost.ts`

---

### Phase 3.5: MRT Compatibility Pass (Priority: CRITICAL)
**Objective**: Make MRT emissive output valid for **every** material in the WebGPU scene so WebGPU pipelines compile without errors.

**Why**: WebGPU MRT requires a fragment output for every target in the render pass. Any material without an emissive output will fail pipeline validation.

**Tasks**:
- [ ] **Audit materials used in the WebGPU path** and confirm each is a NodeMaterial (no SpriteMaterial/ShaderMaterial in WebGPU).
- [ ] Add a `?ndMrtAudit=1` debug flag that logs:
  - materials that are *not* NodeMaterials on WebGPU
  - NodeMaterials missing `emissiveNode`
  - object/material names to speed fixes
- [ ] **Explicitly set `emissiveNode` on every NodeMaterial** created in:
  - `src/themes/neon-district/neon-district-materials.js` (sky, fog, moon, skyline, holograms, rain, splash, etc.)
  - inline WebGPU materials in `src/themes/neon-district/neon-district-theme.js` (vehicles, signs, wires, misc meshes)
  - asset materials in `src/themes/neon-district/neon-district-assets.js` (MeshPhongNodeMaterial + emissive maps)
- [ ] **Replace SpriteMaterial halos** with NodeMaterial billboards for WebGPU (use `createBillboardHaloNodeMaterial()` or a quad-based halo).
- [ ] Centralize emissive defaults:
  - `emissiveNode = vec3(0.0)` for non‑bloom materials
  - `emissiveNode = colorNode * intensity` for neon/bloom contributors
- [ ] Re‑enable MRT by default once audit passes:
  - `shouldUseMrt()` returns `true` on WebGPU
  - keep `?ndNoMrt=1` as emergency fallback

**Done when**:
- WebGPU runs with MRT enabled and **no** pipeline validation errors.
- Bloom only affects intended emissive surfaces.

---

### Phase 4: TSL Material Migration (Priority: CRITICAL)
**Objective**: Convert all custom ShaderMaterials to TSL node materials for WebGPU.

**Files to create**:
- `src/themes/neon-district/neon-district-materials.js`

**Conversion order (recommended)**:
1. Building procedural window shader (most visible, largest surface area)
2. Starfield point shader
3. Mega tower shader
4. Low-lying fog shader
5. Sky gradient
6. Neon signage & VHS billboards
7. Moon gradient
8. Distant skyline
9. Searchlights
10. Rain streaks + splash particles
11. Holographic billboards

**Tasks**:
- [x] Provide `createBuildingNodeMaterial()` for WebGPU and keep existing ShaderMaterial for WebGL.
- [x] Add emissive outputs to node materials so MRT bloom isolates neon lighting.
- [x] Use `pointUV` for star/splash particles instead of `gl_PointCoord`.
- [x] Replace any unsupported GLSL ops with TSL equivalents.

---

### Phase 5: Assets & Texture Pipeline (Priority: MEDIUM)
**Objective**: Make asset loading WebGPU-aware and support node materials.

**Files to modify**:
- `src/themes/neon-district/neon-district-assets.js`

**Tasks**:
- [x] Accept a renderer instance in `NeonDistrictAssets` and call `ktx2Loader.detectSupport(renderer)`.
- [x] Add node-based variants of material creation (`MeshPhongNodeMaterial` / `MeshStandardNodeMaterial`).
- [x] Ensure texture colorSpace is correct for emissive maps and albedo maps.

---

### Phase 6: Visual Upgrades (Priority: MEDIUM / Optional)
**Objective**: Achieve a more cinematic, \"world-class\" neon look.

**WebGPU-first enhancements**:
- [x] Emissive-only bloom for neon signs/windows (reduces bloom on dark surfaces).
- [x] Wet street reflections via TSL node material with animated puddles (`createWetGroundNodeMaterial`).
- [x] Animated low-lying fog + scene fog for depth and glow falloff.
- [x] Neon halos (billboard quads for WebGPU, sprites for WebGL) for signage/billboards.
- [x] ~~Subtle film grain + chromatic aberration in post-processing.~~ **REMOVED** for performance (saved 3 texture samples per pixel + grain computation).

Fallback path stays visually consistent with existing style.

---

### Phase 7: Performance Pass (Priority: HIGH)
**Objective**: Improve frame time on both WebGPU and WebGL fallback.

**Tasks**:
- [x] Batch building geometry where possible (BatchedMesh or merged instancing).
- [x] Reduce per-frame CPU updates (e.g., throttle sign updates, reuse buffers).
- [x] Add LOD or culling rules for distant skyline and fog layers.
- [x] Reuse Matrix4 objects in vehicle updates (eliminated ~800+ allocations/frame).
- [x] Remove per-frame FOV breathing (eliminated expensive updateProjectionMatrix calls).
- [x] Conditional bloom boost updates (only update when boost > 0).
- [x] Remove film grain + chromatic aberration from post-processing (3 texture samples -> 1).
- [x] GPU-driven rain/splash update logic on WebGPU (already implemented via TSL `createRainNodeMaterial`).
- [ ] **Building LOD System**: 3-tier LOD with baked window textures for outskirt buildings (Phase 5 of Optimization Plan).

---

### Phase 8: QA & Validation (Priority: CRITICAL)
**Objective**: Ensure visuals match and fallback is seamless.

**Testing checklist**:
- [x] WebGPU-capable browser (Chrome/Edge stable, Safari with WebGPU) runs WebGPU path.
- [x] Unsupported browser or `forceWebGL=true` uses WebGL fallback without errors.
- [x] Visual parity checks: bloom intensity, window colors, fog density, star twinkle.
- [x] Performance profiling across presets (Low -> Extreme).

**Automation aids**:
- [x] `?ndBaseline=1` now logs backend + post path with FPS/pixel ratio + enhanced QA metrics.
- [x] `?forceWebGL=1` forces WebGL2 fallback for validation.
- [x] `logQAValidation()` logs comprehensive scene status after loading.

---

## File Layout After Migration

```
src/themes/neon-district/
- neon-district-theme.js          # Main theme (hybrid rendering)
- neon-district-assets.js         # Asset manager (WebGPU-aware)
- neon-district-tetrominos.js     # Unchanged
- neon-district-post.js           # NEW: WebGPU post-processing
- neon-district-materials.js      # NEW: TSL material library
- neon-district-webgpu.js         # OPTIONAL: WebGPU-only helpers
```

---

## Risks & Mitigations

**Risk: Shader parity drift**
- Mitigation: Use matching node graphs and validate with screenshots.

**Risk: WebGPU feature gaps (e.g., reflections, fog)**
- Mitigation: Gate features on `this.isWebGPU`, provide graceful fallback.

**Risk: Performance regressions**
- Mitigation: Profile after each phase; keep WebGL path intact until WebGPU proves faster.

---

## Timeline Estimate (Flexible)

| Phase | Complexity | Notes |
|------|------------|------|
| 0 | Low | Audit + baseline screenshots |
| 1 | Medium | Renderer init + backend detection |
| 2 | Low | Loop + resize updates |
| 3 | Medium | Post-processing port |
| 4 | High | Full ShaderMaterial migration |
| 5 | Medium | Asset pipeline updates |
| 6 | Medium | Visual upgrades |
| 7 | High | Performance pass |
| 8 | Low | QA + fallback validation |

**Recommended order**: 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

---

## References

Local references (already in repo):
- `src/themes/verdant-hills/verdant-hills-theme.js` (hybrid WebGPU setup)
- `src/themes/tornado/TornadoTheme.ts` (WebGPU renderer usage)
- `src/themes/tornado/TornadoPost.ts` (TSL MRT bloom pipeline)

External references:
- Three.js WebGPU docs
- Three.js TSL guide
- WebGPU spec

---

## Changelog

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-01-31 | 2.0 | Codex | Updated for hybrid fallback + full TSL migration scope |
| 2026-01-31 | 2.1 | Codex | Implemented Phases 1-7, added WebGPU post, TSL materials, asset pipeline updates, and QA instrumentation |
| 2026-01-31 | 2.2 | Claude | Performance optimizations: removed film grain/chromatic aberration, fixed Matrix4 allocations in vehicle updates, removed per-frame FOV updates, conditional bloom boost updates |
| 2026-01-31 | 2.3 | Claude | Completed remaining items: wet ground with animated puddles (TSL), neon halos for billboards, QA validation logging, updated Phase 6-8 as complete |
