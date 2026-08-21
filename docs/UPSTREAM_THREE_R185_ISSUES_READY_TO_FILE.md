# Draft upstream issues for three.js r185 — two WebGPURenderer defects found during the r181 → r185 upgrade

Status: **Issue 2 draft, not yet filed; Issue 1 withdrawn** (see below). Prepared 2026-08-21 from the Serenity Blocks upgrade
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

## Related, already public

- #34184 (`screenDPR` wrong with multiple node graphs) — also present in r181, fixed for r186.
- #34241 (`WebGPUTimestampQueryPool.timestamps` Map grows unbounded with `trackTimestamp`) —
  also present in r181, fixed for r186. Issue 2 above is distinct: it is the dispose-time race,
  not the unbounded map.
