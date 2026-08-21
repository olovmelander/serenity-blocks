# Draft upstream issues for three.js r185 — two WebGPURenderer defects found during the r181 → r185 upgrade

Status: **draft, not yet filed**. Prepared 2026-08-21 from the Serenity Blocks upgrade
(`THREE_UPGRADE_RESEARCH_R181_TO_R185_2026-08.md` §10, last two rows). Both verified on
**r185** (`three@0.185.1`) with `WebGPURenderer` on the WebGPU backend (Chromium 140 / Electron
38 and Chrome, Windows 11, RTX 3070). Both are regressions relative to r181 in the sense that
r181 code paths never triggered them. Copy-paste-ready bodies below; the file:line references
are into the `three@0.185.1` npm tarball (`src/` tree).

---

## Issue 1 — `compileAsync(scene, camera, targetScene)` throws when `targetScene` is a `Group`

### Title

`WebGPURenderer.compileAsync()`: passing a `Group` as `targetScene` throws
`TypeError: Cannot read properties of undefined (reading 'isColor')` in r185 (worked in r181)

### Body

**Description**

The documented three-argument form `renderer.compileAsync(scene, camera, targetScene)` — where
`targetScene` is a sub-group whose materials should be compiled in the context of `scene` —
throws in r185 when `targetScene` is an `Object3D`/`Group` rather than a `Scene`.

**Reproduction** (r185, WebGPU backend)

```js
import * as THREE from 'three/webgpu';

const renderer = new THREE.WebGPURenderer();
await renderer.init();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const group = new THREE.Group();
group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardNodeMaterial()));
scene.add(group);

await renderer.compileAsync(scene, camera, group);
// r181: resolves. r185: TypeError: Cannot read properties of undefined (reading 'isColor')
```

Live example: https://jsfiddle.net/ (paste the snippet above into an `importmap` fiddle on
`three@0.185.1`).

**Cause**

`Renderer.compileAsync()` now routes the background update at the *target* scene when it
differs from `scene` (`src/renderers/common/Renderer.js:1005-1007`):

```js
if ( targetScene !== scene ) {
    this._background.update( targetScene, renderList, renderContext );
}
```

`Background.update()` then does (`src/renderers/common/Background.js`, `update()`):

```js
const background = this.nodes.getBackgroundNode( scene ) || scene.background;
if ( background === null ) { ... } else if ( background.isColor === true ) { ...
```

A `Group` has no `background` property, so `background` is `undefined`, the `=== null` guard
does not fire, and `background.isColor` throws. r181 always updated the background against the
real scene (`sceneRef`), so any `Object3D` was accepted as `targetScene`.

**Impact**

Every targeted compile of a sub-group fails. Because `compileAsync` is usually awaited inside a
try/catch by warm-up code, the failure tends to be *silent* — the app's shader prewarm stops
working and first-use compile hitches return without an obvious error.

**Suggested fix**

Either guard for `undefined` as well as `null` in `Background.update()`
(`if ( background == null )`), or keep using `sceneRef` for the background update and only
use `targetScene` for the render-list traversal, as r181 did.

**Workaround**

Set `group.background = null` before calling `compileAsync(scene, camera, group)`.

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
