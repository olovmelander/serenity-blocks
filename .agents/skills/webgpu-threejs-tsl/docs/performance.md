# WebGPU performance playbook (this repo)

The recurring findings of this repo's theme performance work, in the order to apply them:
**measure → gate → fill → node graph → draw calls → start-up → tiers**. The traps with their
measurements are in `gotchas/performance-tiers.md`; read it with this file.

## The two rules that come before any change

**Keep the look** (the owner's standing instruction: "be smart with our optimizations so we
don't sacrifice the visual quality and effects of the themes"). Order the options for every
slow spot:

1. **No pixel changes**: cache or reuse work, faster code for the same output, skip what nobody
   sees, spread builds over frames, start work earlier.
2. **Visually equivalent**: lower resolution only for low-frequency effects with a good
   upsample, early-outs where a term provably vanishes, reuse slow-changing results, distance LOD.
3. **Only then trim** counts or steps, on non-High tiers, the least visible thing first.

Prove each with before/after shots at the same frame (`?t=`) and an interleaved A/B. High must
come out pixel-identical or the change is reverted.

**A claim needs a verified instrument** (ADR-0016): GPU timestamps on real hardware, old and
new served side by side and interleaved. A frame counter, a dev-server run and software
rendering are not instruments. Speed runs heat the machine: ask the owner before any uncapped
measurement, and keep ordinary captures at `maxFps=30`.

## 1. Measure first: GPU timestamps, not FPS guesses

FPS conflates CPU and GPU. three has real GPU timing (WebGPU `timestamp-query`):

```javascript
const renderer = new THREE.WebGPURenderer({ trackTimestamp: true });
await renderer.init();

// each frame (or when profiling):
await renderer.resolveTimestampsAsync('render');
await renderer.resolveTimestampsAsync('compute');
console.log(renderer.info.render.timestamp, renderer.info.compute.timestamp); // ms on GPU
```

- **The playground does this for you**: `profile=1&trackTimestamp=1`, warm the effect, call
  `window.__PLAYGROUND__.profile.reset()`, then read `profile.snapshot()` for CPU, frame and GPU
  p50/p95/p99 (`src/playground/README.md`). Missing timestamps are reported as unavailable,
  never as a zero cost.
- **The fleet bench** runs the real game per theme: `npm run perf:themes:bench`
  (`docs/THEME_FLEET_240_HANDOVER_2026-10-27.md`). Budgets are gated by `npm run perf:budgets:gate`.
- `backend.hasTimestampQuery(uid)` asks whether a uid has a query. `backend.hasTimestamp` is a
  boolean capability getter: calling it is a TypeError, and a bare truthiness check means
  "timestamps are supported at all".

Quick bound diagnosis without tooling:

- **Shrink the window or lower the pixel ratio** → frame time drops = fill-bound (most themes
  are: additive overdraw and full-screen functions).
- Frame time the same at a quarter of the resolution → vertex- or CPU-bound; check
  `renderer.info.render.drawCalls`.
- **The integrated GPU is arithmetic-bound, the discrete one is not.** A sky-shader change that
  costs nothing at High can cost 25 % at Low on the iGPU (gotcha #262, #269): time the lean
  tiers there on their own.
- Themes with dynamic resolution throttle under capture: switch it off with that theme's own
  flag (`noDrs` for Neon Dusk, Nimbus Veil and Synthwave Sunset, `blackHoleNoDrs`,
  `chromadelicBaseline`) before an A/B, or the controller invalidates the comparison.
- Measure against a production build, not the dev server.

## 2. Gate the frame loop

A theme's loop goes through `BaseTheme.safeAnimate()` (`src/themes/base-theme.js`): it schedules
the next frame first, registers the id, and gates on `shouldRenderFrame()` (hidden tab, frame
pacing). Clamp the delta so a backgrounded tab does not integrate a giant step on return:

```javascript
this.animate = this.safeAnimate((time) => {      // time: theme time in ms
  const dt = Math.min((time - (this.lastTime ?? time)) / 1000, 0.05);
  this.lastTime = time;
  world.update(dt);
  post.render();
});
this.animate();
```

- The newest adapters write the same thing out as `stepFrame(now)` with their own
  `lastFrameMs` (`src/themes/serenity-warp/serenity-warp-theme.js`); either way the method stays
  named `animate`.
- A hand-rolled loop that returns early WITHOUT rescheduling kills itself for good. That form is
  only safe inside `renderer.setAnimationLoop`.
- `THREE.Clock` is deprecated (r183) and warns on construction. Use the rAF timestamp as above,
  or `THREE.Timer` (`timer.update(time); timer.getDelta()`).
- A missing gate was the most repeated finding of the early audits: a hidden tab kept paying
  for compute dispatches and bloom every frame (gotcha #78).

## 3. Fill rate: the usual suspects, in order of payoff

1. **Bloom resolution.** `bloomNode.setResolutionScale()` per tier (three's default is 0.5 of
   the drawing buffer; bloom is 12 full-screen draws a frame). Wolfhour:
   `WOLFHOUR_POST_PROFILES.bloomDownsample` 0.56 at Minimal to 0.64 at Extreme, applied as
   `setResolutionScale(0.5 * bloomDownsample)` in `src/themes/wolfhour/wolfhour-grade.js`;
   Winter's `POST_LOOK.bloomResolution` runs 0.25–0.5.
2. **A sky drawn first.** A dome or backdrop drawn before the solids shades every pixel, twice
   with a mirror. Draw it LAST among the opaque parts, depth test on (gotcha #100).
3. **Full-screen functions.** Every term is paid at every pixel. Branch out what only part of
   the frame needs, and keep event terms out of the per-pixel path when no event is live
   (gotcha #257, #269).
4. **Additive particle overdraw.** Layered additive quads are a top fill cost. Budget the
   total light per tier (gotcha #120): finer grain as the count rises, never just more quads.
5. **Redundant post taps.** Every extra read of the scene pass is a full-screen fetch. Gate
   unused taps out of the graph, and feed addons a texture, not an expression (an expression
   costs a hidden full-screen pass: `docs/post-processing.md`).
6. **Mirrors.** `reflector()` re-renders the scene: `bounces: false`, a tier-scaled
   `resolutionScale`, the scene pass's `samples`, and a camera layer that keeps small things out.
   Mirror the sky analytically instead (gotcha #137).
7. **Pixel ratio.** Always `renderer.setPixelRatio(this.getEffectivePixelRatio(cap))`: it
   applies the player's render scale and the tier policy. Give it a per-tier `cap`, never a
   literal `Math.min(devicePixelRatio, 2)`.
8. **Marches.** Space the steps by what the ray crosses, read grain once per pixel, cone-march
   a dense field at low resolution first (gotcha #150, #115, #229).

## 4. Node-graph costs (TSL-specific traps)

- **A zero uniform eliminates nothing**: the subgraph still runs per fragment. Disable in
  JavaScript: do not build the node, or swap `outputNode` and set `needsUpdate = true` (gotcha #72).
- **A helper without `setLayout` is inlined at every call site**, a JavaScript `forEach` that
  emits TSL unrolls it, and a node read in several scopes is emitted in each: all three grow the
  shader and its compile time (gotcha #81, #101, #215, #228).
- **`mx_noise_*` compiles slowly**: 20 evaluations took 7.3 s for one pipeline (gotcha #80).
- **In-place mutation of a `uniform(Color/Vector)` uploads every frame**: fine when intended;
  skip the write when the value did not change, and reuse scratch objects (gotcha #73).
- **Fold constants in JavaScript.** A value that never changes is a plain number in the graph,
  not a uniform.
- **Hoist trig and matrix work out of per-frame JavaScript loops**, and never call
  `computeVertexNormals()` per frame.
- **An instance pool rewritten every frame** uploads only what it drew with `uploadUsed`
  (`src/themes/shared/instance-upload.js`).

## 5. Draw calls and geometry

- Instanced quads through `InstancedBufferGeometry` with one `InstancedInterleavedBuffer` per
  pool is the house form (`docs/theme-foundation.md` §4); `InstancedMesh` when real instance
  matrices are wanted (then write `instanceMatrix.array` directly and set `needsUpdate` once).
- `THREE.BatchedMesh` merges different geometries that share one material into one draw.
- Freeze static transforms (`matrixAutoUpdate = false` and one `updateMatrix()`).
- Two geometries with the same attribute layout and material share a pipeline, so a pool can
  switch geometry without a compile (gotcha #145).

## 6. Compute-pass hygiene

- Build compute nodes **once** (`const computeNode = Fn(kernel)().compute(count)` at init); only
  `renderer.compute(computeNode)` per frame. Re-creating the node recompiles its pipeline.
- The first dispatch of a node creates its pipeline synchronously: compile ahead on a loading
  surface (`docs/compute-shaders.md`).
- Skip dispatches when the effect is idle or unseen, under the same frame gate.
- Workgroup size: leave the default `[64]`; tune only with timestamp data.
- GPU→CPU readback (`getArrayBufferAsync`) stalls: for tools and debugging, never in the loop.

## 7. Start-up and warm-up

- **The cost is pipelines**: one per mesh per pass it is drawn in (scene pass, mirror, shadow
  pass, any direct `renderer.render()`), whatever the materials share. Count them, then cut
  passes and keep sample counts equal (gotcha #96).
- **An ordinary theme warms nothing by hand.** It puts its whole world in the scene before
  `createScene()` resolves; the theme manager's async pipeline session compiles it behind the
  loading screen (ADR-0020). Parked FX drawables need `warmParkedSoon`
  (`src/themes/shared/warm-hidden-drawables.js`).
- `renderer.compileAsync(scene, camera)` compiles for the target bound when it is called, not
  for a `pass()`'s own target. `await scenePass.compileAsync(renderer)` covers the pass's scene;
  the output quad and bloom still need one real `post.render()`. One `compileAsync` at a time
  per renderer, and `(object, camera, scene)` is the argument order (`docs/three-r187.md`).
- **CPU bakes cost start-up too.** Take them through `bakeOnce` (cached across rebuilds), run
  first-visit bakes in the bake worker, and write the world's build as steps that yield
  (`src/themes/shared/bake-cache.js`, `bake-worker-client.js`, `build-steps.js`). Time each
  bake in Node.

## 8. Quality tiers

- Read quality from `window.settings.effectQuality` (`'Minimal' | 'Low' | 'Medium' | 'High' |
  'Ultra' | 'Extreme' | 'Custom'`, normalised by `normalizeQuality`). `graphicsQuality` is a
  legacy fallback, never the live key.
- **Every tier keeps the whole picture and every event.** A tier cuts counts, octaves, steps,
  bloom and mirror resolution; it never drops a feature or a beat. Every theme has a tier table
  (`<id>-quality.js`, `POST_LOOK` in `<id>-post.js`): extend it, do not invent a second mechanism.
- Drop a term in JavaScript. A neutral constant fed through a non-linear function is not
  neutral (gotcha #135). Capture the lowest tier before calling a surface done.

## Checklist before and after any performance change

1. A/B with the same camera and a `?t=` phase-locked time, old and new interleaved, on the GPU
   that is slow (usually the integrated one).
2. High is pixel-identical; lower tiers are equivalent to the eye, shown side by side.
3. The instrument and the numbers go in the commit message or the theme's record doc.
4. Hidden-tab and reduced-quality behaviour still gate to about zero cost.
