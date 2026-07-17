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

### Environment

- three r181 (`0.181.2`), WebGPURenderer — reproduced on the WebGPU backend
  (SwiftShader and native) and observed on the WebGL backend.
- Chromium 141 headless; also applies in Electron 38.

---

*Repo-side note (not part of the upstream text): the workaround lives at
`src/themes/shared/bloom-dispose.js` and is wired into every BloomNode user; if a future three
upgrade fixes `BloomNode.dispose()`, the helper degrades to calling it plus harmless no-ops.
Delete the helper when the pinned three release contains the upstream fix.*
