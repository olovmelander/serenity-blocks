# three r187 in this repo: what changed and what the code does about it

The repo pins `three@0.187.0` (ADR-0018). This file is what that version changed for the code
here, found by auditing the package source and by running the game on real GPUs
(`docs/THREE_UPGRADE_R186_TO_R187_2026-10.md` is the full record, with measurements). Read it
before touching pipeline warm-up, `compileAsync`, shadow maps, shader-text tests or a renderer's
lifetime. The r186 and r185 notes at the end describe behaviour r187 kept.

At the next three bump, this file is rewritten in the bump commit and renamed for the new
version; `tests/unit/agent-skill-contract.test.js` fails until the skill's stamp matches
`package.json`.

## Contents

- [Where the builder writes a value: no more zero in the other branch](#where-the-builder-writes-a-value)
- [Compiling pipelines ahead of time](#compiling-pipelines-ahead-of-time)
- [Builds that span frames, and static shadow maps](#builds-that-span-frames-and-static-shadow-maps)
- [Looks that shifted](#looks-that-shifted)
- [Generated shader text](#generated-shader-text)
- [Kept from r186](#kept-from-r186)
- [Kept from r185](#kept-from-r185)
- [Checking an API against the installed package](#checking-an-api-against-the-installed-package)

## Where the builder writes a value

The change with the widest reach, and one no migration note mentions. Up to r186 a value shared
by several branches was assigned only where it was first built, so every other branch read the
zero it was declared with: the cause of six rows in `gotchas/tsl-emission.md` (#68, #171, #205,
#209, #212, #239) and of the `unassignedReads` gate in the themes' shader tests.

**r187 writes the value again in every scope that reads it.** Built with `WGSLNodeBuilder` on
0.187.0 (2026-11-12), none of those rows' shapes left a branch reading zero. What r187 kept:

- a value is still computed where it is first USED, so a read after an `.assign()` sees the new
  value (#200);
- an unpinned value is now PAID FOR in every branch, loop body and call site that reads it (#215,
  #228): the fault became a cost;
- a `Loop` built outside any `Fn` is still dropped silently (#230), and an `If` there throws.

So the rule did not change: pin shared values with `.toVar()` at the top of the `Fn` and read the
pinned variable. `tests/unit/agent-skill-emission-contract.test.js` builds each of these shapes
and fails when a three bump changes what the builder does with them.

## Compiling pipelines ahead of time

- **`compileAsync(objectToCompile, camera, targetScene)`** is the argument order. Passing
  `(scene, camera, group)` projects the whole scene and takes lights and background from a `Group`
  (gotcha #82).
- **One `compileAsync` at a time per renderer.** r187 keeps one `_precompilationState` per
  renderer while a call drains its queue, and the drain awaits with it set: a second call's drain
  finishes the first's items ("Cannot destructure property 'useFrameBufferTarget' of
  'this._precompilationState' as it is null") and leaves the renderer half switched (Odyssey's
  six-wide prewarm: every prewarm failed, the map stopped presenting). Compile a group in ONE call
  (r187 parallelises its pipelines, up to 16 at once) and queue calls per renderer:
  `takeCompileTurn` / `compileObjectsFannedOut` in
  `src/rendering/odyssey/warmup/post-target-compile.js`.
- **A target bound only for the launch gets bound again.** `compileAsync` drains its queue between
  your frames, and each queued object binds the target and MRT it was queued under, then the ones
  bound when `compileAsync` was CALLED. So `setRenderTarget(t); const p = renderer.compileAsync(...);
  setRenderTarget(previous)` gets `t` bound again after every drained object, and the next frame
  draws into it. Call `ensurePrecompileRestoresLiveState(renderer)` from
  `src/rendering/three-precompile-live-restore.js` first (Spring's impostors and Odyssey's warm-up
  helpers do), or hold the binding across the await as three's own `PassNode.compileAsync` does.
- `compileAsync` keeps the material side of each queued pass itself, and node builds are shared
  across call depths.
- **Mipmap pipelines are created synchronously.** three makes its `mipmap-<format>-2d-array`
  pipelines with `createRenderPipeline` the first time a texture of that format needs mips, once
  per `GPUDevice`: on the GPU process's main thread, a visible stall (up to ~80 ms at a theme
  switch). Renderers started through `BaseTheme` or the Odyssey board warm them with
  `warmMipmapPipelines` (`src/rendering/mipmap-pipeline-warm.js`); a new renderer elsewhere that
  uploads mipmapped textures calls it right after `init()`.
- **An ordinary theme does none of this itself.** The theme manager's async pipeline session
  covers it (ADR-0020): a theme must not define `buildsPipelinesAsync` and must not call
  `createRenderPipeline*` or `compileComputeAsync`. Its job is to have its whole world in the scene
  when `createScene` resolves.

## Builds that span frames, and static shadow maps

- r187 can build a render object's nodes asynchronously, a shader stage at a time
  (`renderer._nodes.getForRender(renderObject, yieldFn)`). The in-play theme switch's hidden build
  uses it (`sliceBuilds` in `src/rendering/async-render-pipelines.js`) so no large material builds
  inside a frame.
- Its first frames then draw nothing, and three draws a shadow map only in a frame that draws a
  receiver. A static map (`shadow.autoUpdate = false`) redrawn "on the first N frames" misses its
  casters. Count the first redraws as draws: `redrawStaticShadow` in
  `src/themes/shared/static-shadow-draws.js`.
- An override pass (`scene.overrideMaterial`, the shadow pass) files its render objects under
  five keys, the source material fifth (`renderer._currentSourceMaterial`). Code that looks render
  objects up must add it (`chainKeysOf` in `src/rendering/async-render-pipelines.js`).

## Looks that shifted

- PMREMs are cube render targets; `CubeUVReflectionMapping` is gone. Reflections and environment
  lighting look slightly different from r186. A theme that samples `scene.environment` warms the
  PMREM pipelines first (`src/themes/shared/pmrem-warm.js`).
- ACES Filmic's fit denominator was fixed: ACES-toned themes shift slightly.
- The PCF radius of non-square shadow maps was fixed. Themes whose look was set with the old
  filter keep it through `src/themes/shared/width-pcf-shadow-filter.js`; themes drawn without a
  temporal filter use the noise-free `src/themes/shared/grid-shadow-filter.js` (gotcha #201).
- TSL promotes mixed operand types in operators and math functions.

## Generated shader text

- Cached values are locals named `nodeConstN` (`let nodeConstN = …` in WGSL,
  `float nodeConstN = …` in GLSL), and a uniform array is read as `nodeUniformN.value[i]` (WGSL) /
  `nodeUniformN[i]` (GLSL), not `NodeBuffer_N`. A shader-text test must not pin one version's names.
- A device-less renderer used to build shaders in a test needs
  `renderer._bindings = { getSharedBindGroup: (group) => group }` (shared bind groups are read from
  the renderer's Bindings, which `init()` makes). The shared test helper
  `tests/unit/helpers/tsl-node-build.js` (`stubRenderer`, `build`, `unassignedReads`) is the
  harness to start from.
- `build/three.webgpu.js` imports the node system, `QuadMesh` and `CubeRenderTarget` from
  `build/three.tsl.js`; a source contract test reads both.
- A laid-out `Fn` given the short layout form (`Fn(fn, { p: 'vec2', return: 'float' })`) is
  emitted under a generated name, `fnNN`. three's own MaterialX noises are written that way, so
  **a test that searches the generated shader for `mx_` finds nothing on r187**, whatever the
  shader holds: 41 shader gates were blind this way until 2026-11-12. A gate now asks
  `hasMaterialXNoise(text)` or `materialXNoiseFunctions(text)` from
  `tests/unit/helpers/materialx-noise.js`, which is calibrated against the installed three each
  run (it builds every MaterialX noise and notes the functions only those shaders define), and
  `tests/unit/materialx-noise-gate.test.js` proves it fires on every family on both backends.
  The ban on the SOURCE text (`/\bmx_\w+\s*[(,]/` in a theme's own test) is separate and stands.
- A laid-out function's code is cached per backend and reused by every later material
  (`TSLCore.js`: "Layout functions are cached across shaders of the same backend. Their bodies
  must depend only on explicit inputs and constants"). That is the mechanism behind gotcha #93
  and #95.

## Kept from r186

- Use `compileComputeAsync` from `src/rendering/webgpu-compute-pipeline-async.js` on loading
  surfaces. It delegates to native compilation, checks actual GPU readiness, and blocks dispatch
  while nodes build or pipelines fail. A resolved native compile promise alone does not prove
  success.
- `await renderer.dispose()` before destroying or nulling a device or releasing a shared device
  owner. Canvas removal and reference clearing may remain immediate. Observe a disposal rejection
  even in fire-and-forget cleanup (`src/ui/boot-warp-transition.js`).
- `PCFSoftShadowMap` is gone from `WebGPURenderer`: asking for it warns ("has been removed.
  Using PCFShadowMap instead") and falls back. Ask for `PCFShadowMap`.
- `THREE.PostProcessing` is a deprecated alias of `RenderPipeline` that warns once per pipeline.
  The repo constructs `RenderPipeline` everywhere, so that warning means a stray site (gotcha #63).
- `THREE.Clock` is deprecated (since r183) and warns on construction. Take the frame delta from
  the rAF timestamp and the theme's own `lastFrameMs`.
- An interleaved attribute cannot be uploaded again after its geometry was disposed: geometry a
  theme keeps for the session is re-wrapped with `freshGeometry`
  (`src/themes/shared/fresh-geometry.js`).

## Kept from r185

- **`positionNode` order is inverted from r181**: instance, batch and skin matrices are applied
  FIRST, so inside a `positionNode` `positionLocal` is already post-instance and the node's output
  is final. Compute from `positionGeometry`, return `positionLocal.add(offset)` (gotcha #65).
- MRT secondary attachments default to `NoBlending`: selective bloom needs
  `withEmissiveMaterialBlending` from `src/themes/shared/mrt-blend.js` (gotcha #76).
- `BloomNode.dispose()` leaves references behind: dispose bloom with `disposeBloomNodeDeep`
  (`src/themes/shared/bloom-dispose.js`).
- TSL has no `atan2` and no `.equals`: `atan(y, x)` and `.equal()`.
- A `pass()` left without `samples` takes the RENDERER's count (4 on an `antialias: true`
  renderer). Themes build the renderer with `antialias: false` and give the scene pass its count
  through `sceneSamples()`.

## Checking an API against the installed package

```bash
# Is a name exported? (TSL functions, then renderer and material classes.) A post node such as
# godrays or bloom is an ADDON file, so it is false here: list the display folder for those.
node -e "import('three/tsl').then(m => console.log(['instancedArray', 'atan2', 'godrays'].map(n => n + ':' + (n in m)).join(' ')))"
node -e "import('three/webgpu').then(m => console.log(['RenderPipeline', 'PostProcessing', 'PCFSoftShadowMap'].map(n => n + ':' + (n in m)).join(' ')))"

# Which post nodes ship, and what a factory takes
ls node_modules/three/examples/jsm/tsl/display/
grep -n "^export const" node_modules/three/examples/jsm/tsl/display/BloomNode.js
```

To settle what a graph really emits (emission order, a helper inlined or not, a name), build it:
`build(THREE.WGSLNodeBuilder, mesh)` and `build(THREE.GLSLNodeBuilder, mesh)` from
`tests/unit/helpers/tsl-node-build.js` return the vertex and fragment text with no GPU. Reading
`setupPosition` or a wiki page has been wrong here before; the generated shader has not.
