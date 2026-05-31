# Pyrestorm — AAA WebGPU/TSL Rebuild Plan

> **Goal**: Rebuild Pyrestorm as a best-in-class **WebGPU/TSL** volcanic theme with AAA visual fidelity — a vast, atmospheric caldera with a structured eruption column, molten terrain with real form, cinematic composition, and stable 60–120 FPS. This supersedes the current WebGL `ShaderMaterial` implementation, which is fully unlit/emissive and reads "flat and huge."
>
> **Reference architecture**: [electric-dreams-v3](../src/themes/electric-dreams-v3/) (newest AAA WebGPU theme) and [synthwave-sunset](../src/themes/synthwave-sunset/) (dual-path WebGPU/WebGL fallback).
>
> **Status**: Planning → scaffolding. Current WebGL theme stays live until the rebuild reaches parity.

---

## 1. Why a rebuild (vs. the incremental WebGL plan)

The current theme ([pyrestorm-theme.js](../src/themes/pyrestorm/pyrestorm-theme.js), [pyrestorm-shaders.js](../src/themes/pyrestorm/pyrestorm-shaders.js)) has three structural ceilings that incremental WebGL work can't break through cleanly:

1. **Everything is unlit/emissive.** Every surface is a custom `ShaderMaterial`; the scene lights in [setupLighting()](../src/themes/pyrestorm/pyrestorm-theme.js#L437-L456) do nothing. There is no light/shadow/form anywhere → the root cause of "flat."
2. **CPU-bound particles.** Embers/ash/explosions are animated in JS loops ([updateEmbers](../src/themes/pyrestorm/pyrestorm-theme.js#L1144), [updateAsh](../src/themes/pyrestorm/pyrestorm-theme.js#L1211), [updateExplosions](../src/themes/pyrestorm/pyrestorm-theme.js#L1075)) — 15 000+ explosion particles updated per frame on the main thread.
3. **Non-selective bloom.** `UnrealBloomPass` blooms the whole frame ([setupPostProcessing](../src/themes/pyrestorm/pyrestorm-theme.js#L1521-L1552)), causing the white-out eruption blob.

WebGPU/TSL fixes all three at the architecture level: **TSL node materials** carry a proper lit + emissive model, **compute shaders** move particles off the CPU, and **MRT selective bloom** makes only genuinely hot surfaces glow.

---

## 2. Cinematic vision

A vast volcanic caldera at dusk. A towering central eruption column — a churning molten core wrapped in **dark smoke shoulders** (contrast, not a white sun) — anchors the frame, **off-center on a third**. Molten rivers radiate from the crater across a **relief-mapped basin** of cooled basalt, glowing hot near the vent and cooling to dark crust toward a hazy horizon. Foreground hero rocks frame the shot; mid-ground fissures glow; distant volcanoes erupt on the horizon, fading into **aerial-perspective haze**.

The molten cracks **light the rock around them** (thermal bleed). The camera breathes and, on big game events, dollies toward the eruption with a touch of depth-of-field. Color grade: deep cool shadows, saturated molten midtones, filmic contrast.

**Three intensity acts** (driven by the existing event bus):

| Act | Trigger | Visual response |
|---|---|---|
| **Smoulder** (idle/early) | low intensity | Slow lava flow, dim plume, cool ambient, gentle ember rise |
| **Surge** (line clears/combos) | rising intensity | Lava brightens & widens channels, plume churns harder, embers accelerate, rim lights snap warm |
| **Cataclysm** (Tetris/high combo) | spikes | Eruption detonates — shockwave rings, lava bombs arc out, lightning, camera dolly-push + screen shake |

---

## 3. What we keep / reuse

- **Event-bus contracts** — `LINE_CLEAR`, `COMBO`, `PIECE_LOCK`, `HARD_DROP`, `GAME_OVER` ([setupEventListeners](../src/themes/pyrestorm/pyrestorm-theme.js#L1557)). Handlers rewritten to drive fluid forces/intensity, not JS bursts.
- **6-tier quality preset model** ([QUALITY_PRESETS](../src/themes/pyrestorm/pyrestorm-theme.js#L62)) — keep the structure, redefine per-tier numbers for the WebGPU budget.
- **BaseTheme lifecycle** — `start/stop/cleanup`, `registerContainer`, `registerAnimation`, `getEffectivePixelRatio`, `getAntialiasEnabled` ([base-theme.js](../src/themes/base-theme.js)).
- **Tetromino config** ([pyrestorm-tetrominos.js](../src/themes/pyrestorm/pyrestorm-tetrominos.js)) — unchanged.
- **The welded LatheGeometry seam fix** — carry the `mergeVertices` lesson into the new cone mesh.

Everything else is rebuilt.

---

## 4. Architecture & file layout

Mirror the ED-v3 subsystem layout. Build alongside the existing theme under a new dir; swap the registry only at parity.

```
src/themes/pyrestorm-v2/
  pyrestorm-v2-theme.js          # BaseTheme orchestrator: renderer init, scene, lifecycle, events
  materials/
    tsl-fire-lib.js              # shared TSL: fbm3/2, domainWarp, worley/voronoi, curlNoise, heatRamp, hemisphericLight
    lava-ground-material.js      # molten plain: domain-warped FBM flow + Worley crust + radial cooling + emissive
    rock-material.js             # cone/peaks/spires: lit (hemispheric + warm key) + thermal bleed + cavity AO
    sky-material.js              # volcanic gradient + nebula + horizon heat glow + ember dust
  rendering/
    caldera-basin.js             # relief-mapped ground mesh (multi-octave FBM displacement, bowl falloff)
    volcano-mesh.js              # welded lathe cone + crater + instanced rim peaks
    basalt-field.js              # instanced spires, clustered + foreground hero rocks
    smoke-volume.js              # layered parallax smoke sheets (warm-underlit), optional raymarched plume
  sim/
    eruption-sim.js              # compute fountain: curl-noise advected particles + lava bombs w/ trails
    ember-sim.js                 # compute embers + ash (buoyancy, drift, fade)
  post/
    render-pipeline.js           # MRT selective bloom + masked heat-haze + ACES + grade + grain + vignette + DOF
  composition/
    camera-director.js           # cinematic camera: idle orbit, event dollies, off-center framing, DOF focal
  pyrestorm-v2-tetrominos.js     # re-export existing config
```

### Renderer strategy — WebGPU primary, WebGL fallback
Unlike ED-v3 (WebGPU-or-message), Pyrestorm already has a working WebGL implementation, so we **keep the current WebGL theme as the graceful fallback** for users without WebGPU (the [synthwave-sunset dual-path](../src/themes/synthwave-sunset/synthwave-sunset-theme.js#L570) pattern):

```
if (navigator.gpu) {
    try { WebGPURenderer + init() (4s timeout, ED-v3 pattern); assert backend.isWebGPUBackend; }
    catch { fall back }
}
// fallback: delegate to the existing WebGL Pyrestorm scene (retained module)
```

This guarantees no user loses the theme, while WebGPU users get the AAA build.

---

## 5. Phased build

Each phase ends **buildable and visually checkable**. Order maximizes early payoff.

### Phase 0 — Scaffold *(foundation)*
New dir, `pyrestorm-v2-theme.js` with WebGPU init (+ timeout guard + WebGL fallback), scene, `FogExp2`, perspective camera, registry entry, `registerContainer`/`registerAnimation`. Renders a clear color. **Verify**: theme loads, no console errors, fallback path works with `?noWebGPU`.

### Phase 1 — Sky & atmosphere *(kills the hard horizon)*
`sky-material.js` (TSL volcanic gradient + drifting nebula + horizon heat glow). Global **exponential height fog** tuned warm-dark so all later geometry fades into aerial-perspective haze. **Verify**: depth-graded sky, no hard edge.

### Phase 2 — Molten basin + lava material *(fixes "flat and huge")*
- `caldera-basin.js`: large ground mesh with **multi-octave FBM vertex displacement** (rolling flats, raised crust plateaus, fissures) and a radial bowl falloff toward the crater. Real silhouette + parallax.
- `lava-ground-material.js`: **domain-warped FBM** flow (replaces the contour-banding `atan` rivers) + **Worley/Voronoi cracked-crust cells** with glowing seams + **radial cooling gradient** (bright molten near vent → dark crust to horizon). HDR emissive only on the hot fraction (sets up selective bloom).

### Phase 3 — Volcano, rock & lighting *(fixes "flat / no form")*
- `volcano-mesh.js`: welded lathe cone + crater; instanced rim peaks.
- `basalt-field.js`: clustered instanced spires + a few large **foreground hero rocks** for framing/scale.
- `rock-material.js`: **hemispheric ambient** (cool sky / warm ground) + one **warm key** term + **thermal bleed** (rock near lava cracks gets lit by them) + **cavity AO**. This is what makes rock read as 3D.

### Phase 4 — Eruption & embers (compute) *(fixes the white blob)*
- `eruption-sim.js`: compute-advected fountain (**curl noise**) with a **dark-smoke shell** around the hot core, **lava bombs** arcing out with glowing trails, shockwave rings on Cataclysm.
- `ember-sim.js`: GPU embers + ash with buoyancy/drift/fade. Fixes the CPU cost and the square-sprite ash artifact (proper round, soft sprites).

### Phase 5 — Smoke volume & god rays *(depth + mood)*
`smoke-volume.js`: 3–4 layered, warm-underlit parallax smoke sheets between camera and vent; optional light-shaft god rays from the eruption through the ash.

### Phase 6 — Post pipeline *(the "AAA pop")*
`post/render-pipeline.js` (mirror [V3PostPipeline](../src/themes/electric-dreams-v3/post/render-pipeline.js)): **MRT selective bloom** (emissive channel only → no white-out), **depth/luminance-masked heat haze** (replaces the full-screen sine warp), **ACES** tonemap, **color grade** (deep cool shadows, saturated molten mids, filmic S-curve, teal/orange split), **film grain + dither** (anti-banding), vignette, subtle **DOF** to separate planes.

### Phase 7 — Camera & choreography *(composition)*
`camera-director.js`: idle breathing orbit with the eruption framed **off-center on a third**; event-driven **dolly-push** on Tetris/high combo; DOF focal pull; screen shake. Distant volcanoes placed at thirds.

### Phase 8 — Quality presets & perf *(ship)*
Redefine the 6 tiers for the WebGPU budget; gate FBM octaves, fog, smoke layers, eruption particle counts, DOF, grade. Adaptive resolution (synthwave pattern). Target 60 FPS mid-tier, 120 high-tier. Final in-browser verification + screenshot compare.

---

## 6. Key techniques (with references)

| Technique | Where | Reference |
|---|---|---|
| Domain-warped FBM (organic lava flow, no contour banding) | lava-ground, smoke | [IQ: domain warping](https://iquilezles.org/articles/warp/), [Book of Shaders: FBM](https://thebookofshaders.com/13/) |
| Worley/Voronoi cracked crust + glowing seams | lava-ground | [web-lava-demo](https://github.com/RobbyLawrence/web-lava-demo) |
| Emissive thermal bleed (cracks light nearby rock) | rock-material | [Lava/emissive practice](https://silphiumdesign.com/free-lava-flow-animation-assets-game-dev-vfx/) |
| Exponential height fog / aerial perspective | global + all surface materials | [Aerial perspective](https://grokipedia.com/page/Aerial_perspective) |
| Volumetric god rays + layered smoke | smoke-volume | [Volumetric lighting](https://languageoflighting.com/lighting-design-concepts/volumetric-lighting/), [Volumetric fog (Wronski)](https://bartwronski.com/wp-content/uploads/2014/08/bwronski_volumetric_fog_siggraph2014.pdf) |
| MRT selective bloom (emissive-only) | post | [V3PostPipeline](../src/themes/electric-dreams-v3/post/render-pipeline.js) |
| Compute-driven particles (curl-noise advection) | eruption/ember sim | [FluidParticleSim](../src/themes/electric-dreams-v3/sim/fluid-particles.js) |
| Shared TSL noise lib (`Fn`, fbm3, warpedFbm3) | tsl-fire-lib | [tsl-noise-lib.js](../src/themes/electric-dreams-v3/materials/tsl-noise-lib.js) |

---

## 7. TSL / WebGPU conventions to follow (from this repo)

- `import * as THREE from 'three/webgpu'`; shader fns from `three/tsl`.
- `Fn(([args]) => { ... })` for reusable shader functions; `.toVar()` for mutable locals; `.assign/.addAssign/.mulAssign`.
- Node materials carry `colorNode` + `emissiveNode`; **MRT requires every material to set `emissiveNode`** (even `vec3(0)`), per project memory.
- Store runtime uniforms via `uniform(...)` handles kept on the subsystem (not `material.userData` string lookups) — update in the frame loop.
- Compute: `sim.createComputeNode()` + `renderer.compute(node)` each frame; guard with `typeof renderer.compute === 'function'`.
- WebGPU init: `await Promise.race([renderer.init(), timeout(4000)])` then assert `renderer.backend?.isWebGPUBackend`.

---

## 8. Risks & mitigations

- **Scope** — large rebuild. Mitigation: phased, each phase shippable; old WebGL theme stays live as fallback the whole time.
- **WebGPU availability** — keep WebGL Pyrestorm as automatic fallback (no user loses the theme).
- **Perf regressions on combo spikes** — move particles to compute; gate counts per tier; adaptive resolution.
- **MRT material discipline** — audit that every material sets `emissiveNode` (synthwave has a [material audit helper](../src/themes/synthwave-sunset/synthwave-sunset-theme.js#L362) to copy).
- **Visual parity gate** — don't swap the registry `id: 'pyrestorm'` module until the rebuild matches/beats the current theme in a side-by-side.

---

## 9. Definition of done

- WebGPU users get the AAA build; non-WebGPU users get the existing WebGL theme automatically.
- No hard horizon (fog/aerial perspective); terrain has relief & parallax; rock has form; eruption is a structured column (no white-out); molten cracks light surrounding rock.
- Selective bloom, ACES, graded, grain; cinematic off-center framing with event dollies.
- 60 FPS mid-tier / 120 high-tier; clean build & lint; in-browser verified.
