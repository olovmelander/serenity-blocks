# Ice Temple WebGPU Architecture Notes

This document captures the implemented runtime architecture after the Ice Temple WebGPU migration.

## Renderer Decision Flow

File: `src/themes/ice-temple/ice-temple-theme.js`

1. Parse runtime flags via `parseIceTempleFlags()`:
- `forceWebGL`
- `iceTempleNoPost`
- `iceTempleNoMRT`
- `iceTempleNoCompute`
- `iceTempleNoEnhancements`
- `iceTempleNoAuroraVolume`
- `iceTempleBaseline`
- `iceTempleMrtAudit`

2. Attempt WebGPU renderer first (`WebGPURenderer.init()`), unless `forceWebGL` is set.

3. If WebGPU init fails, create `THREE.WebGLRenderer` fallback.

4. Probe capabilities and derive runtime gates:
- `supportsPost`
- `supportsMRT`
- `supportsCompute`
- `flags.usePost`
- `flags.useMRT`
- `flags.useCompute`

5. Route rendering through `renderFrame()`:
- WebGPU + post: `postProcessing.render()`
- WebGL + composer: `composer.render()`
- Direct fallback: `renderer.render(scene, camera)`

6. Lifecycle hardening:
- Stable resize binding via `this.boundResizeHandler`
- Explicit cleanup in `stop()` for post stack, compute systems, environment map, and event listeners
- Runtime resilience handlers:
  - WebGPU: `renderer.onDeviceLost` and `backend.device.lost`
  - WebGL: `webglcontextlost` / `webglcontextrestored`

## Runtime Recovery Flow

File: `src/themes/ice-temple/ice-temple-theme.js`

1. `renderFrame()` catches WebGPU render/post failures and triggers `requestWebGLFallback('webgpu-render-failure', error)`.
2. `handleDeviceLoss(info)` routes WebGPU device-loss events to `requestWebGLFallback('device-loss', info)`.
3. `requestWebGLFallback` performs controlled teardown (`cancelAnimationLoop`, listener cleanup, resource disposal), sets sticky fallback flags (`forceWebGL`, `noMRT`, `noCompute`), and recreates scene state via `createScene()`.
4. `refreshRuntimeFlags()` merges URL flags with runtime fallback overrides so recovery remains stable after re-init.

## Capability Gates

Computed in `probeCapabilities()`:

- `supportsPost`: WebGPU post API availability (WebGL defaults to true via `EffectComposer` path)
- `supportsMRT`: requires WebGPU and `maxColorAttachments > 1`
- `supportsCompute`: requires WebGPU and `renderer.compute`

Final behavior is always `capability AND !flagDisable`.

## Material Factory Layout

File: `src/themes/ice-temple/ice-temple-materials.js`

Dual-path factories are provided for each migrated effect:

- Aurora: `createAuroraMaterialWebGPU` / `createAuroraMaterialWebGL`
- Shockwave: `createShockwaveMaterialWebGPU` / `createShockwaveMaterialWebGL`
- Snow: `createSnowMaterialWebGPU` / `createSnowMaterialWebGL`
- Ice shards: `createIceShardMaterialWebGPU` / `createIceShardMaterialWebGL`
- Starfield: `createStarfieldMaterialWebGPU` / `createStarfieldMaterialWebGL`

Common conventions:

- Uniform handles are stored under `material.userData.uniforms`.
- MRT audit metadata is attached with:
  - `material.userData.emitsBloom`
  - `material.userData.mrtRole`
- WebGPU runtime modules are loaded once through `initIceTempleMaterialRuntime()`.

Scene-owned non-node materials are also explicitly tagged in `ice-temple-theme.js` with:
- `frost-floor` (`emitsBloom: false`)
- `floor-crack` (`emitsBloom: true`)
- `pillar-core` (`emitsBloom: true`)
- `pillar-shard` (`emitsBloom: true`)
- `pillar-glow` (`emitsBloom: true`)
- Mist/fog overlays (`emitsBloom: false`)

## Enhancement Gates (Phase 7)

File: `src/themes/ice-temple/ice-temple-theme.js`

- Volumetric aurora layering is WebGPU-only and preset-driven:
  - `qualityPreset.auroraLayers` controls layer count (`1/2/3` by preset).
- Runtime gate:
  - `isWebGPU && useWebGPUMaterials && !flags.noEnhancements && !flags.noAuroraVolume`
- Kill switches:
  - `?iceTempleNoEnhancements=1`
  - `?iceTempleNoAuroraVolume=1`
- Per-layer runtime metadata:
  - `auroraTimeOffset`
  - `auroraIntensityScale`

## Post Processing Graph

File: `src/themes/ice-temple/ice-temple-post.js`

- Uses `pass(scene, camera)` and optional `setMRT(mrt({ output, emissive }))`
- Uses bloom source selection:
  - MRT: emissive attachment
  - non-MRT: scene color
- Supports `bloomDownsample` and `postScale`
- `auditMRT` flag prints diagnostics when enabled

## Compute Buffer Layout

File: `src/themes/ice-temple/ice-temple-compute.js`

### Snow Compute (`IceTempleSnowCompute`)

Storage buffers (vec4 packing):

- `positionBuffer` (`x,y,z,w`)
- `velocityBuffer` (`x,y,z,w`)
- `randomBuffer` (`baseRandom,speed,seed,w`)

Uniforms:

- `uDelta`
- `uTime`
- `uDrift`

Behavior:

- Per-frame drift + gravity-like descent
- Recycle out-of-bounds particles to top volume
- Optional CPU fallback path updates the same typed arrays

### Shard Compute (`IceTempleShardBurstCompute`)

Storage buffers (vec4 packing):

- `positionBuffer`
- `velocityBuffer`
- `lifeBuffer` (`life,...`)
- `miscBuffer` (`size,active,seed,decay`)

Uniforms:

- `uDelta`
- `uGravity`
- `uDrag`

Behavior:

- `spawnBurst()` writes into ring-buffer cursor (`spawnCursor`)
- Compute pass updates movement/lifetime and deactivates dead particles
- Inactive shards are moved offscreen (`z = -9999`)

## Baseline/Validation Helper Surface

`window.iceTempleBaseline` (when `iceTempleBaseline=1`):

- `capture(label)`
- `report()`
- `downloadReport(label)`
- `reset()`
- `play(sequence, options)`
- `validateEvents(options)`
- `validatePipeline(options)`
- `validateMRT(options)`
- `validateSnowCompute(options)`
- `getSequenceDuration(sequence, loops, stepMs)`
- `getPresetOrder()`
- `setQuality(level, options)`
- `capturePresetMatrix(options)`
- `downloadPresetMatrix(label)`
- `collectEvidence(options)`
- `downloadEvidence(label)`
- `evaluateCriteria(options)`
- `getEvidence()`
- `stop()`

`collectEvidence(options)` now includes a `validation` block in exported JSON/Markdown:
- `pipeline`
- `mrt`
- `events`
- `snowCompute`
- aggregate `passed`

`collectEvidence(options)` also includes a `successCriteria` snapshot with per-criterion
`pass/fail/inconclusive` status and aggregate counts.

Harness: `tests/performance/benchmark-ice-temple-phase8.html`
