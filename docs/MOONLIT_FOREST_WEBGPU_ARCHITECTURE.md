# Moonlit Forest WebGPU Architecture Notes

This document records the implemented runtime architecture for Moonlit Forest after WebGPU migration.

## Renderer Decision Flow

File: `src/themes/moonlit-forest/moonlit-forest-theme.js`

1. Parse runtime flags via `parseMoonlitFlags()`:
- `forceWebGL`
- `moonlitNoPost`
- `moonlitNoMRT`
- `moonlitNoCompute`
- `moonlitMrtAudit`
- `moonlitDebug`
- `moonlitBaseline`
- `moonlitSeed`
- `moonlitFixedDt`
- `moonlitPlayback`
- `moonlitPlaybackLoops`

2. Attempt `WEBGPU.WebGPURenderer` first unless forced WebGL.

3. If WebGPU init fails, fallback to `THREE.WebGLRenderer`.

4. Probe capabilities in `setupRendererCapabilities()` and derive effective gates:
- `supportsPost`
- `supportsMRT`
- `supportsCompute`
- `flags.usePost`
- `flags.useMRT`
- `flags.useCompute`

5. Route rendering through `renderFrame()`:
- post path (`MoonlitForestPost.render()`)
- direct `renderer.render(scene, camera)` fallback

6. Runtime resilience:
- WebGPU: `renderer.onDeviceLost` and `backend.device.lost`
- WebGL: `webglcontextlost` / `webglcontextrestored`
- render/post failures route to `requestWebGLFallback(...)`

## Runtime Recovery Flow

File: `src/themes/moonlit-forest/moonlit-forest-theme.js`

1. `renderFrame()` catches failures.
2. On WebGPU failure, call `requestWebGLFallback('webgpu-render-failure', error)`.
3. `requestWebGLFallback` performs controlled teardown (`cancelAnimationLoop`, subscriptions/timers/listeners cleanup, renderer disposal), enables sticky fallback flags (`forceWebGL`, `noMRT`, `noCompute`), then calls `createScene()`.
4. `refreshRuntimeFlags()` keeps fallback overrides sticky for this theme instance.

## Material Factory Layout

File: `src/themes/moonlit-forest/moonlit-forest-materials.js`

Node material factories:
- `createMoonlitSkyNodeMaterial`
- `createMoonlitMoonNodeMaterial`
- `createMoonlitMoonHaloNodeMaterial`
- `createMoonlitStarfieldNodeMaterial`
- `createMoonlitAmbientFireflyNodeMaterial`

Conventions:
- Returns `{ material, uniforms }` to keep stable uniform handles.
- Ambient fireflies support two paths:
  - attribute-driven fallback
  - compute-storage-driven path via storage buffers (`fireflyCompute`)

## Post Pipeline

File: `src/themes/moonlit-forest/moonlit-forest-post.js`

`MoonlitForestPost` supports dual pipelines:

- WebGPU:
  - `WEBGPU.PostProcessing`
  - scene pass via `pass(scene, camera)`
  - optional MRT via `scenePass.setMRT(mrt({ output, emissive }))`
  - bloom source:
    - MRT: emissive attachment
    - non-MRT: scene output
  - grading + vignette + grain via TSL uniforms

- WebGL fallback:
  - `EffectComposer`
  - `RenderPass`
  - `UnrealBloomPass`
  - `ShaderPass` (`MOONLIT_GRADE_SHADER`)

## Particle Architecture

File: `src/themes/moonlit-forest/moonlit-forest-particles.js`

`MoonlitForestParticles` uses pooled GPU sprite emitters with no per-event DOM nodes.

Pools:
- `fireflies`
- `spores`
- `sparkles`
- `wisps`
- `mist`
- `enchantedLeaves`
- `runes`
- `shootingStars`

Additional systems:
- persistent aurora mesh (`createAurora`)
- optional compute-driven ambient firefly field (`createAmbientFireflyField`)

Emitter strategy:
- ring-buffer style acquire/recycle (`acquire`, `deactivate`)
- deterministic per-entry update (`updateEntry`)
- no runtime allocations in hot-path burst handling

## Compute Buffer Layout

File: `src/themes/moonlit-forest/moonlit-forest-compute.js`

Class: `MoonlitAmbientFireflyCompute`

Storage buffers (`vec4` packing):
- `positionBuffer`: `x,y,z,w`
- `miscBuffer`: `phaseSeed,speedSeed,sizeSeed,extraSeed`

Uniforms:
- `uDelta`
- `uTime`
- `uFlowStrength`
- `uPulse`

Behavior:
- drift + hover + rise
- wrap/recycle in configured world bounds
- pulse-modulated flow for gameplay-reactive ambience

## Quality Presets and GPU Budget Table

File: `src/themes/moonlit-forest/moonlit-forest-theme.js`

Quality content budgets (selected):

| Preset | Trees (back/mid/front) | Leaves | Mushrooms | Moonbeams | Fireflies |
|---|---:|---:|---:|---:|---:|
| Minimal | 5 / 4 / 3 | 5 | 5 | 2 | 3 |
| Low | 10 / 8 / 6 | 12 | 10 | 3 | 8 |
| Medium | 15 / 12 / 8 | 25 | 15 | 5 | 15 |
| High | 20 / 16 / 11 | 40 | 22 | 7 | 22 |
| Ultra | 26 / 20 / 14 | 60 | 30 | 9 | 30 |
| Extreme | 35 / 28 / 18 | 85 | 45 | 12 | 45 |

Adaptive GPU budget controls include:
- `targetFrameMs`
- `adaptiveMinScale` / `adaptiveMaxScale`
- `adaptiveDownRate` / `adaptiveUpRate`
- `minResolutionScale` / `maxResolutionScale`
- `postDisableScale`
- `minEmissionScale`

## Baseline / Validation Helper Surface

When `moonlitBaseline=1`, `window.moonlitBaseline` is exposed.

Key methods:
- `report()`
- `capture(label)`
- `reset()`
- `play(sequence, options)`
- `validateEvents(options)`
- `validateHeroFrame(options)`
- `getPresetOrder()`
- `setQuality(level, options)`
- `waitForQuality(level, options)`
- `runResizeStress(options)`
- `runSoak(options)`
- `runSoakCampaign(options)`
- `captureEventAnchors(options)`
- `runPresetSweep(options)`
- `getTetrominoSnapshot()`
- `validateTetrominoStyling(options)`
- `collectEvidence(options)`
- `getHeroFrameReport()`
- `getAnchorReport()`
- `getPresetSweep()`
- `getEvidence()`
- `getResizeReport()`
- `getSoakReport()`
- `getSoakCampaign()`
- `stop()`

Harness:
- `tests/performance/benchmark-moonlit-phase8.html`

## Logging Policy

File: `src/themes/moonlit-forest/moonlit-forest-theme.js`

Informational logs are gated through `debugLog(...)`, enabled only when:
- `moonlitDebug=1`, or
- baseline mode (`moonlitBaseline=1`), or
- MRT audit mode (`moonlitMrtAudit=1`)

Warnings/errors remain unconditional for runtime fault visibility.
