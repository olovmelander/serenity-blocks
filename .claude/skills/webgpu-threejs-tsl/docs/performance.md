# WebGPU Performance Playbook (this repo)

This distills the recurring findings from this repo's theme perf audits (wolfhour,
ice-temple, stellar-drift, tornado, cosmic-noir, ocean, chromadelic, black-hole).
Apply in order: **measure → gate → trim fill → trim CPU**.

## 1. Measure first — GPU timestamps, not FPS guesses

FPS conflates CPU and GPU. r185 has real GPU timing (WebGPU `timestamp-query`):

```javascript
const renderer = new THREE.WebGPURenderer({ trackTimestamp: true });
await renderer.init();

// each frame (or when profiling):
await renderer.resolveTimestampsAsync('render');
await renderer.resolveTimestampsAsync('compute');
console.log(renderer.info.render.timestamp, renderer.info.compute.timestamp); // ms on GPU
```

> **r185 backend API change:** `backend.hasTimestamp(uid)` was renamed
> `backend.hasTimestampQuery(uid)`. `hasTimestamp` still exists but is now a boolean
> **capability getter** — calling it like a function is a TypeError, and a bare
> truthiness check (`if (backend.hasTimestamp)`) silently changed meaning from
> "this uid has a query" to "timestamps are supported at all".

Quick bound diagnosis without tooling:
- **Shrink the window / drop `setPixelRatio`** → FPS jumps = fill-bound (most themes
  here are — additive overdraw).
- FPS identical at 25% resolution → vertex- or CPU-bound; check draw-call count via
  `renderer.info.render.drawCalls`.
- Capture against the **production preview (`:4173`)**, not dev `:5173` — dev-server
  overhead skews results (ocean audit).
- chrome-devtools MCP captures can throttle `effectScale` below 0.64 — force
  `effectScale=1` + `noDrs` when A/B-ing visuals, or the adaptive controller
  invalidates the comparison.

## 2. Gate the frame loop (mandatory pattern)

Every theme loop must honor `shouldRenderFrame()` (see `src/themes/base-theme.js`
— reduced-quality throttling, hidden-tab pause) and clamp delta so a backgrounded
tab doesn't integrate a giant timestep on return:

```javascript
const loop = () => {
  const id = requestAnimationFrame(loop); // schedule FIRST — the gate must skip work, not kill the loop
  this.registerAnimation(id);
  if (!this.shouldRenderFrame()) return;   // skips render AND compute dispatches
  const dt = Math.min(clock.getDelta(), 0.1);
  update(dt);
  renderer.compute(computeNode);
  postProcessing.render();
};
```

Order matters: every repo theme schedules the next frame *before* the gate (see
`base-theme.js` `safeAnimate`) so a throttled/hidden frame only skips work. An
early return **without** rescheduling permanently kills a self-scheduled rAF loop —
that form is only safe inside `renderer.setAnimationLoop`.

Missing this gate was the single most repeated finding across theme audits — a
hidden tab kept burning compute dispatches + bloom every frame.

## 3. Fill rate: the usual suspects, in order of payoff

1. **Bloom input resolution.** The repo convention is a tier-scaled
   `bloomDownsample` factor on the bloom source RT (see
   `src/themes/wolfhour/wolfhour-post.js` — 0.58 at low tiers to 0.74 at Extreme).
   Dropping ~0.8 → ~0.65 was repeatedly near-invisible and a top win.
2. **Additive particle overdraw.** Layered additive quads are the #1 fill cost
   (cosmic-noir). Tier-gate layer counts; shrink quads; prefer fewer, brighter
   sprites over many dim ones.
3. **Redundant post taps.** Every extra `texture()` sample of the scene pass costs
   a full-screen read. Gate unused taps out of the graph entirely (chromadelic
   found dead CA/grain taps still executing).
4. **Reflections/mirrors.** `reflector()` re-renders the scene — always pass a
   reduced `resolutionScale` (repo uses 0.4–0.5) and cull the reflected layer set.
5. **Pixel ratio.** Cap it (`Math.min(devicePixelRatio, 2)`, lower on iGPU); a 1.25
   vs 1.1 cap was a visible-sharpness bug in Odyssey, so match the theme baseline.

## 4. Node-graph costs (TSL-specific traps)

- **Multiplying by a 0-value uniform eliminates nothing** — the whole subgraph
  still executes per fragment. Disable effects in JS: swap `outputNode` /
  rebuild the material and set `needsUpdate = true`.
- **In-place mutation of a `uniform(Color/Vector)` uploads every frame** — fine
  when intended, but don't assume unchanged writes are free; skip the write when
  the value didn't change (stellar-drift saved ~28 Color allocs/frame by reusing
  scratch objects too).
- **Fold constants at module scope.** Values that never change per frame should be
  plain JS numbers baked into the graph (ice-temple froze fog-profile constants),
  not uniforms — uniforms cost bind-group traffic.
- **Hoist trig/matrix work out of per-frame JS loops** — compute once, write into
  `instanceMatrix` directly (wolfhour meteors), and never call
  `computeVertexNormals()` per frame (chromadelic's biggest single fix).

## 5. Draw calls & geometry

- `InstancedMesh` for repeated geometry; write transforms straight into
  `instanceMatrix.array`, set `needsUpdate` once.
- `THREE.BatchedMesh` (in `three/webgpu` core exports) merges *different*
  geometries sharing one material into one draw — the modern version of the ocean
  audit's hand-merged corals (48 → 8 draws).
- Freeze static transforms (`matrixAutoUpdate = false` + one `updateMatrix()`).

## 6. Compute-pass hygiene

- Build compute node objects **once** — `const computeNode = Fn(kernel)().compute(count)`
  at init; only `renderer.compute(computeNode)` per frame. Re-creating the compute
  node per frame recompiles pipelines (ice-temple "bind-loop-once" fix).
- Skip dispatches when the effect is idle or invisible — gate with the same
  `shouldRenderFrame()`.
- Workgroup size: leave default or use `[64]`; only tune with timestamp data.
- GPU→CPU readback (`getArrayBufferAsync`) stalls — debug only, never in the loop.

## 7. Startup & warm-up

- `renderer.compileAsync(scene, camera)` does NOT cover post-processing
  (`PassNode`) pipelines or first-update node paths — the proven fix is to
  actually render each pass/scene once off-screen or behind the loading overlay
  (Odyssey warms by replaying the journey).
- Cold `createScene()` ≈ ~1s main-thread shader build on this machine — never
  build scenes mid-gameplay; warm before the intro (loading-screen work).

## 8. Quality tiers

- Read quality from `window.settings.graphicsQuality` (the live key — a past audit
  wasted a pass reading a stale seeded key).
- Tier-gate: particle counts, noise octaves, post effects, bloom downsample,
  reflection resolutionScale, layer counts. Every theme already has a tier table —
  extend it rather than inventing a new mechanism.

## Checklist before/after any perf change

1. A/B with identical camera + `?t=` phase-locked time, production build.
2. Confirm byte-identical or imperceptible visuals at Extreme (the audits ship
   only changes that preserve the intended look).
3. Timestamp or FPS delta recorded in the PR/commit message.
4. Verify hidden-tab and reduced-quality behavior still gates to ~0 cost.
