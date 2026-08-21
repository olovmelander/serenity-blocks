# Draft upstream issues for three.js r185 — WebGPURenderer defects found during the r181 → r185 upgrade

Status: **Issues 2, 3 and 4 drafted, not yet filed; Issue 1 withdrawn** (see below). Issues 3–4 added
2026-08-21 from the Phase-2 prewarm work (`R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md` item 2.9). Prepared 2026-08-21 from the Serenity Blocks upgrade
(`THREE_UPGRADE_RESEARCH_R181_TO_R185_2026-08.md` §10, last two rows). Both were verified on
**r185** (`three@0.185.1`) with `WebGPURenderer` on the WebGPU backend (Chromium 140 / Electron
38 and Chrome, Windows 11, RTX 3070). Both are regressions relative to r181 in the sense that
r181 code paths never triggered them. Copy-paste-ready bodies below; the file:line references
are into the `three@0.185.1` npm tarball (`src/` tree).

---

## Issue 1 — WITHDRAWN 2026-08-21 (was: `compileAsync` throws when `targetScene` is a `Group`)

**Do not file.** The premise was wrong. three's contract (Renderer.js JSDoc, r181 and r185
alike) is `compileAsync(objectToCompile, camera, targetScene)`: the **first** argument is the
scene *or 3D object* to precompile and the **third** "must represent the scene the 3D object is
going to be added" to. The repo had the order inverted — `compileAsync(scene, camera, group)` —
so r185 correctly read `background` off a `Group` (undefined) and threw. r181 merely tolerated
the misuse, and tolerated it expensively: every "targeted" prewarm walked the whole scene.

Fixed in-repo by calling `compileAsync(group, camera, scene)`
(`src/rendering/odyssey/warmup/post-target-compile.js`); the `group.background = null` patch
and its test were removed; the parameter order is now pinned from the installed source by
`tests/unit/odyssey-post-target-compile.test.js`. A doc-only upstream suggestion remains
legitimate: a `targetScene` that is not a `Scene` could warn instead of throwing deep inside
`Background.update`. Not worth an issue on its own.

---

## Issue 2 — `WebGPUBackend.dispose()` destroys the device while timestamp-query resolves are in flight

### Title

`WebGPUBackend.dispose()` does not await `WebGPUTimestampQueryPool.dispose()` before
`device.destroy()` → in-flight `resolveTimestampsAsync()` logs `Error resolving queries:
DOMException` on every renderer dispose with `trackTimestamp` active (r185)

### Body

**Description**

r185's `WebGPUBackend.dispose()` now destroys the renderer-owned `GPUDevice` (new behavior —
r181 did not destroy the device). It also calls `dispose()` on each `WebGPUTimestampQueryPool`,
but that method is `async` (it awaits `this.pendingResolve` to let an in-flight `mapAsync`
finish) and `WebGPUBackend.dispose()` is synchronous and does not await it:

```js
// src/renderers/webgpu/WebGPUBackend.js, dispose()
for ( const queryPool of Object.values( this.timestampQueryPool ) ) {
    if ( queryPool !== null ) queryPool.dispose();   // async, not awaited
}
...
if ( this.parameters.device === undefined && this.device !== null ) {
    this.device.destroy();                           // runs immediately
}
```

So when a `resolveTimestampsAsync()` is pending at dispose time, the pool's `mapAsync()` rejects
against a destroyed device, and `WebGPUTimestampQueryPool._resolveQueries()` catches it and
logs `error( 'Error resolving queries:', e )` — once per pool (`render` and `compute`).

**Reproduction** (r185, WebGPU backend)

```js
import * as THREE from 'three/webgpu';

const renderer = new THREE.WebGPURenderer({ trackTimestamp: true });
await renderer.init();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial()));

renderer.render(scene, camera);
renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER); // pending...
renderer.dispose();                                            // destroys the device now

// console: "THREE.Error resolving queries: [object DOMException]"
```

(Any app that samples GPU timings every frame — e.g. for dynamic resolution — and disposes the
renderer on a scene/theme switch hits this deterministically.)

**Suggested fix**

Make the device destruction wait for the pools: e.g. collect the pools' `dispose()` promises and
destroy the device in a `.finally()`, or have `_resolveQueries()` treat a rejection after
`isDisposed === true` as expected and skip the `error()` log.

**Workaround**

Before `renderer.dispose()`, set `renderer.backend.trackTimestamp = false` and await each pool's
`pendingResolve` (`renderer.backend.timestampQueryPool.render?.pendingResolve`, `...compute?...`)
with a bounded timeout, then dispose.

---

## Issue 3 — `compileAsync` compiles transparent DoubleSide materials with the wrong `side` (deferred work items drain after the two-pass walk restored it)

### Title

`compileAsync()` builds one DoubleSide pipeline for transparent double-sided materials instead of the
BackSide/FrontSide pair `render()` uses — every such material compiles again, synchronously, on the
first real frame (r185 regression: work items are drained after `material.side` is restored)

### Body

**Description**

r185 changed `Renderer._createObjectPipeline()` so that, in async compilation mode, it no longer
builds the render object; it pushes a work item and `compileAsync()` drains the queue later, one
object at a time (`src/renderers/common/Renderer.js`, `_createObjectPipeline` →
`this._compilationPromises.push({ object, material, … , passId })`; drain:
`for ( const item of compilationPromises ) { … this._objects.get( item.object, item.material, …, item.passId ) … }`).

The two-pass handling of transparent double-sided materials still sets the side *around the call*:

```js
// renderObject()
if ( material.transparent === true && material.side === DoubleSide && material.forceSinglePass === false ) {
    material.side = BackSide;
    this._handleObjectFunction( …, 'backSide' );   // r185: only QUEUES an item
    material.side = FrontSide;
    this._handleObjectFunction( …, passId );       // r185: only QUEUES an item
    material.side = DoubleSide;                    // restored BEFORE the queue is drained
}
// _renderTransparents() does the same for the whole doublePassList
```

By the time the drain runs, `material.side === DoubleSide` again, so both queued passes build a
render object whose material cache key, node builder state and backend pipeline key carry
`side = DoubleSide` — a pipeline `render()` never uses. On the first real frame the renderer needs
BackSide (pass `'backSide'`) and FrontSide (default pass); neither exists, so both are created
synchronously (`createRenderPipeline`, not `Async`) and, because the render objects' keys changed,
the DoubleSide pipeline is released. r181 built the pipeline inside `_createObjectPipeline` while
the side was still set, so the pair was correct.

**Measured** (Chromium 140 / Electron 38, Windows 11, RTX 3070, D3D12/DXC): in a scene with ~45
transparent double-sided unlit materials, `compileAsync` of the whole scene followed by the first
`render()` → 45 synchronous `createRenderPipeline` calls on that frame (two per material), a
0.5–1.5 s frame on a cold shader cache. Hooking `Pipelines._getRenderPipeline` shows identical
program ids and an identical dynamic key for the compile-time and render-time builds; the only
differing field of `WebGPUBackend.getRenderCacheKey` is `material.side` (2 → 1, 2 → 0).

**Reproduction**

```js
const material = new THREE.MeshBasicNodeMaterial( { transparent: true, side: THREE.DoubleSide, opacity: 0.5 } );
scene.add( new THREE.Mesh( new THREE.PlaneGeometry(), material ) );
await renderer.compileAsync( scene, camera );
const device = renderer.backend.device;
const orig = device.createRenderPipeline.bind( device );
device.createRenderPipeline = ( d ) => { console.log( 'SYNC pipeline', d.label ); return orig( d ); };
renderer.render( scene, camera ); // logs two SYNC pipelines for the material compileAsync just "compiled"
```

**Suggested fix**

Capture the transient material state in the work item and re-apply it when the item is processed:
`this._compilationPromises.push( { …, side: material.side } )`, then in the drain
`const previousSide = item.material.side; item.material.side = item.side; … ; item.material.side = previousSide;`
(the same applies to anything else `renderObject()` mutates around the call — the
`scene.overrideMaterial` node swaps). Alternatively build the render object (`this._objects.get` +
`initialCacheKey`) synchronously at push time and defer only the node build / pipeline creation.

**Workaround used** (Serenity Blocks `src/rendering/odyssey/warmup/post-target-compile.js`,
`beginDeferredSideCapture`): for the duration of a compile, wrap `_createObjectPipeline` so the
queued item's `material` property is a getter that re-applies the captured side when the drain reads
it, and restore after `Pipelines.getForRender`. Sync creations on the first frame: 45 → 0 for these
materials.

**Version**: r185 (`three@0.185.1`). r181: not affected. Browser: Chrome 140 / Electron 38, Windows 11.

---

## Issue 4 — `compileAsync` resolves its render context at call depth 0; anything rendered through `PostProcessing` (depth 1) never hits the compiled builder states

### Title

`compileAsync()` uses `_renderContexts.get( renderTarget, mrt )` (callDepth 0) while a scene rendered by
`PostProcessing` / `PassNode` runs at callDepth 1 — the render-context id is part of every material
cache key, so the compiled states are never reused and every pipeline is built again on the first
frame (r185)

### Body

**Description**

r185 keys render contexts by call depth: `RenderContexts.get( renderTarget, mrt, callDepth )`
(`renderStateKey = attachmentState + '-' + mrtState + '-' + callDepth`), `Renderer._callDepth` starts
at `-1` and `_renderScene()` increments it, so a scene drawn by a `PassNode` inside
`PostProcessing.render()` (quad at depth 0 → scene pass at depth 1) gets a different
`RenderContext` — with a different `id` — from the same scene drawn at top level.
`RenderObject.getMaterialCacheKey()` appends `this.context.id` (RenderObject.js, `cacheKey += this.context.id + ','`),
and `compileAsync()` always resolves `this._renderContexts.get( renderTarget, this._mrt )` → depth 0.

Consequently `await renderer.compileAsync( scene, camera )` followed by
`postProcessing.render()` (scene pass with the same render target + MRT, same lights, same
everything) rebuilds every render object (`initialCacheKey !== getCacheKey()`), and because the
pipeline and program caches are reference-counted, the compiled pipelines are released as the
rebuilt ones are created synchronously. With ~50 visible materials on a cold shader cache this is a
1.5 s first frame; the compile did nothing useful.

**Reproduction**

```js
const scenePass = pass( scene, camera ); // any PassNode
const post = new THREE.PostProcessing( renderer ); post.outputNode = scenePass;
renderer.setRenderTarget( scenePass.renderTarget ); renderer.setMRT( scenePass.getMRT() );
await renderer.compileAsync( scene, camera );
renderer.setRenderTarget( null ); renderer.setMRT( null );
// hook device.createRenderPipeline as in Issue 3 →
post.render(); // every scene material is created again, synchronously
```

**Suggested fix**

Either resolve the compile context at the depth the caller will render at (e.g. a `callDepth`
option / use `this._callDepth + 1` consistently so compile and a nested render agree), or drop the
call depth from the material cache key (it exists to keep nested render contexts apart, which the
context *object* already does — the key only needs the attachment/MRT state).

**Workaround used**: during the compile, wrap `renderer._renderContexts.get` so a default depth of 0
resolves at depth 1 (the post scene pass's depth). Pinned by a contract test against the r185 source.

**Version**: r185 (`three@0.185.1`). Browser: Chrome 140 / Electron 38, Windows 11.

---

## Related, already public

- #34184 (`screenDPR` wrong with multiple node graphs) — also present in r181, fixed for r186.
- #34241 (`WebGPUTimestampQueryPool.timestamps` Map grows unbounded with `trackTimestamp`) —
  also present in r181, fixed for r186. Issue 2 above is distinct: it is the dispose-time race,
  not the unbounded map.
