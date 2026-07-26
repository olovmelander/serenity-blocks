# Draft upstream issue for three.js — BloomNode / RenderObjects dispose gaps retain entire disposed scenes

Status: **draft, not yet filed**. Prepared 2026-07-17 from the Serenity Blocks performance audit
(`PERFORMANCE_STABILITY_AUDIT.md`, finding SB-15 and its remediation log). File against
https://github.com/mrdoob/three.js — verified on **r181** (`three@0.181.2`), WebGPURenderer
(both WebGPU and WebGL backends).

---

## Title

`BloomNode.dispose()` leaks its internal NodeMaterials; combined with `RenderObjects.dispose()`
not disposing individual RenderObjects, every disposed scene that used bloom stays reachable
via the shared QuadMesh geometry.

## Body

### Setup

An app that creates a `PostProcessing` graph per "level/theme" (scene pass + `bloom()` from
`three/addons/tsl/display/BloomNode.js`), renders it, and later tears everything down:
`bloomNode.dispose()`, `postProcessing.dispose()`, scene traversal dispose,
`renderer.dispose()` — i.e. everything the public API offers.

### Observed

JS heap grows by roughly the retained size of the scene graph on **every**
create-render-dispose cycle and never returns to baseline (verified with
`HeapProfiler.collectGarbage` between cycles). Heap-snapshot retainer paths for the retained
TSL nodes all funnel through the module-level shared quad:

```
(module scope) QuadGeometry singleton (QuadMesh.js `_geometry`)
  ._listeners.dispose[i]                    ← RenderObject.onGeometryDispose closures
    → RenderObject
      ._nodeBuilderState.updateBeforeNodes[0] → PassNode
        → .scene → (the disposed Scene, in full)
```

Measured in our app: **+7 leaked dispose-listeners on the shared quad geometry per
bloom-pipeline teardown** (1 highpass + 5 separable-blur + 1 composite material), each pinning
the full scene of that cycle; ≈ +2.4–3.3 MB GC-immune heap per cycle for mid-sized scenes.

### Cause — three defects that compose

1. **`BloomNode.dispose()` does not dispose its materials**
   (`examples/jsm/tsl/display/BloomNode.js`): it disposes the render targets only.
   `_highPassFilterMaterial`, `_separableBlurMaterials[0..n]`, and `_compositeMaterial` are
   never disposed by any code path.

2. **`RenderObject` unsubscribes from geometry/material dispose only via its own `dispose()`**
   (`RenderObject.js` constructor adds `material.addEventListener('dispose', …)` and
   `geometry.addEventListener('dispose', …)`), but **`RenderObjects.dispose()` merely does
   `this.chainMaps = {}`** — so `Renderer.dispose()` never disposes individual RenderObjects.
   Their listeners survive on any geometry/material that outlives the renderer.

3. **`QuadMesh` uses a module-level shared `QuadGeometry` singleton** that is never disposed —
   so every leaked `onGeometryDispose` listener from (2) is permanent. (Additionally, module
   singletons such as BloomNode's `_quadMesh` keep the **last assigned material** parked on
   `.material`, retaining that material's full node graph even after `material.dispose()`.)

Disposing a quad material detaches its RenderObject (via `onMaterialDispose → dispose()`),
which is why (1) is the gating defect: apps cannot fix this through public API because the
bloom materials are private.

### Suggested fixes

- `BloomNode.dispose()`: also dispose `_highPassFilterMaterial`, `_compositeMaterial`, and
  every entry of `_separableBlurMaterials` (and null the module `_quadMesh.material`).
- `RenderObjects.dispose()`: iterate all chain-map entries and call `renderObject.dispose()`
  before dropping the maps, so `Renderer.dispose()` detaches listeners from shared/global
  geometries and materials.
- Consider auditing other addons display nodes that own private NodeMaterials for the same
  pattern (our app-side workaround also had to cover materials swapped through module-level
  `QuadMesh` singletons).

### Workaround used in our app

```js
export function disposeBloomNodeDeep(bloomNode) {
    if (!bloomNode) return;
    try { bloomNode.dispose?.(); } catch {}
    const materials = [
        bloomNode._highPassFilterMaterial,
        bloomNode._compositeMaterial,
        ...(Array.isArray(bloomNode._separableBlurMaterials) ? bloomNode._separableBlurMaterials : []),
    ];
    for (const m of materials) {
        try { m?.dispose?.(); } catch {}
        try { m.fragmentNode = null; m.colorNode = null; m.outputNode = null; } catch {}
    }
}
```

With this in place of plain `bloomNode.dispose()`, the shared-quad listener count returns to 0
after each teardown and heap returns to baseline (validation data available on request).

### Related manifestation — classic `WebGLRenderer` + `EffectComposer` (same root pattern)

The identical "renderer disposal leaves dispose-listeners on a module-level shared geometry"
pattern also occurs on the **classic `WebGLRenderer` + `three/addons/postprocessing`** path,
independent of the node system:

- `Pass.js` declares a **module-level shared geometry**:
  `const _geometry = new FullscreenTriangleGeometry()` (`three/addons/postprocessing/Pass.js`),
  used by **every** `FullScreenQuad` of **every** pass (`RenderPass`, `UnrealBloomPass`,
  `ShaderPass`, `EffectComposer`'s internal `copyPass`, …) across **all** renderer instances.
- When a geometry is first rendered, `WebGLGeometries.get()` does
  `geometry.addEventListener('dispose', onGeometryDispose)`
  (`src/renderers/webgl/WebGLGeometries.js`); `onGeometryDispose` removes that listener **only
  when the geometry itself is disposed**.
- `WebGLRenderer.dispose()` (`src/renderers/WebGLRenderer.js`) calls `objects.dispose()`,
  `bindingStates.dispose()`, `programCache.dispose()`, etc., but **nothing removes the
  `onGeometryDispose` listeners**, and `WebGLGeometries` exposes no dispose that iterates its
  tracked geometries. So every `WebGLRenderer` that ever rendered a full-screen pass leaves its
  `onGeometryDispose` closure permanently attached to the shared module `_geometry`.

An app that builds a post pipeline per level/theme on a **fresh `WebGLRenderer` each time**
therefore accumulates one `onGeometryDispose` listener on `Pass.js`'s `_geometry` per renderer
teardown; each closure retains that renderer's `attributes` / `bindingStates` / `info` — i.e. a
slice of the disposed renderer. Measured in our app (`WebGLRenderer` fallback lane, heap-snapshot
retainer analysis): `_geometry._listeners.dispose[]` grows one entry per theme activation and
never shrinks (≈ +0.16 MB retained per activation for our scenes).

Suggested fixes (parallel to the WebGPU ones above):

- `WebGLGeometries` should expose a `dispose()` that iterates its tracked `geometries` and calls
  `geometry.removeEventListener('dispose', onGeometryDispose)`, and `WebGLRenderer.dispose()`
  should call it — so renderer disposal detaches listeners from shared/module geometries.
- Or `Pass`/`FullScreenQuad` should not hard-share a single module-level `_geometry` across
  renderer instances (ref-count it, or make it per-`FullScreenQuad`), so a disposed renderer's
  listeners are not stranded on a permanent global.

Unlike the BloomNode case there is **no clean app-side workaround**: `_geometry` is private to
`Pass.js` (not exported), and disposing it is globally side-effecting (it is shared by every live
pass). We therefore leave this one to upstream rather than patch it app-side.

### Environment

- three r181 (`0.181.2`), WebGPURenderer — reproduced on the WebGPU backend
  (SwiftShader and native) and observed on the WebGL backend.
- Related manifestation: three r181 classic `WebGLRenderer` + `three/addons/postprocessing`
  `EffectComposer`/`Pass` — reproduced on real-hardware WebGL2 (Chrome 141) and SwiftShader.
- Chromium 141 headless; also applies in Electron 38.

---

*Repo-side note (not part of the upstream text): the workaround lives at
`src/themes/shared/bloom-dispose.js` and is wired into every BloomNode user; if a future three
upgrade fixes `BloomNode.dispose()`, the helper degrades to calling it plus harmless no-ops.
Delete the helper when the pinned three release contains the upstream fix.*
