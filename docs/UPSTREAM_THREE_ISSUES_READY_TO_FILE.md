# three.js issues — ready to file

Two independent-but-related dispose leaks found in three **r181** (`three@0.181.2`), both
reproducible with public API only. File each at <https://github.com/mrdoob/three.js/issues/new>.
They share one root pattern — *renderer disposal leaves `dispose` event-listeners attached to a
module-level shared quad geometry* — but live in different renderers with different fixes, so
they are cleaner as two issues that cross-reference each other.

The detailed internal analysis (with heap-snapshot retainer paths) backing these is in
[UPSTREAM_THREE_BLOOMNODE_DISPOSE_ISSUE.md](UPSTREAM_THREE_BLOOMNODE_DISPOSE_ISSUE.md).

> **How to file:** copy everything between the `─── ISSUE N ───` rules into a new issue. Strip
> this header. Line references were checked against `three@0.181.2`; re-point them if a newer
> release has shifted lines. Neither block contains project-specific detail.

---

─── ISSUE 1 ───────────────────────────────────────────────────────────────────

## `BloomNode.dispose()` leaks its NodeMaterials; with `RenderObjects.dispose()` not disposing individual RenderObjects, every disposed scene that used bloom stays reachable via the shared QuadMesh geometry

### Description

An app that builds a `PostProcessing` graph per scene/level (a scene `pass()` + `bloom()` from
`three/addons/tsl/display/BloomNode.js`), renders it, then tears everything down with the full
public API — `bloomNode.dispose()`, `postProcessing.dispose()`, `scene.traverse(o => o.geometry?.dispose()/o.material?.dispose())`,
`renderer.dispose()` — still leaks the entire scene graph on **every** create→render→dispose cycle.
Heap never returns to baseline (verified with `HeapProfiler.collectGarbage` between cycles).

### Steps to reproduce

1. In a loop: create a `Scene`, a `PostProcessing` whose `outputNode` includes `bloom(scenePass)`,
   render one frame, then dispose everything the public API exposes (bloom node, post processing,
   all scene geometries/materials, and finally the renderer if you recreate it per cycle).
2. `renderer.collectGarbage`/`HeapProfiler.collectGarbage` between cycles.
3. Observe JS heap grow by ~the retained size of one scene per cycle, monotonically.

Heap-snapshot retainer paths for the retained TSL nodes all funnel through the module-level shared quad:

```
(module) QuadGeometry singleton (QuadMesh.js `_geometry`)
  ._listeners.dispose[i]                     ← RenderObject.onGeometryDispose closures
    → RenderObject
      ._nodeBuilderState.updateBeforeNodes[0] → PassNode
        → .scene → (the whole disposed Scene)
```

Measured: **+7 leaked dispose-listeners on the shared quad geometry per bloom-pipeline teardown**
(1 high-pass + 5 separable-blur + 1 composite material), each pinning the full scene of that cycle.

### Cause — three defects that compose

1. **`BloomNode.dispose()` does not dispose its materials.**
   `examples/jsm/tsl/display/BloomNode.js` `dispose()` disposes only
   `_renderTargetsHorizontal`, `_renderTargetsVertical`, and `_renderTargetBright`.
   `_highPassFilterMaterial`, `_separableBlurMaterials[0..n]`, and `_compositeMaterial` are never
   disposed by any code path.

2. **`RenderObjects.dispose()` never disposes the individual RenderObjects.**
   `src/renderers/common/RenderObjects.js` `dispose()` is just `this.chainMaps = {};`. Each
   `RenderObject` subscribes to its material's and geometry's `dispose` events in its constructor,
   and only its own `dispose()` unsubscribes — so `Renderer.dispose()` never detaches those
   listeners from geometries/materials that outlive the renderer.

3. **`QuadMesh` uses a module-level shared `QuadGeometry` singleton** that is never disposed
   (`src/renderers/common/QuadMesh.js`: `const _geometry = new QuadGeometry()`), so every leaked
   `onGeometryDispose` listener from (2) is permanent. Module singletons like BloomNode's
   `_quadMesh` also keep the **last-assigned material** parked on `.material`, retaining that
   material's full node graph even after `material.dispose()`.

Disposing a quad material detaches its RenderObject (via `onMaterialDispose → dispose()`), which is
why (1) is the gating defect: apps cannot fix this through public API because the bloom materials
are private.

### Suggested fix

- `BloomNode.dispose()`: also dispose `_highPassFilterMaterial`, `_compositeMaterial`, and every
  entry of `_separableBlurMaterials` (and null the module `_quadMesh.material`).
- `RenderObjects.dispose()`: iterate all chain-map entries and call `renderObject.dispose()` before
  dropping the maps, so `Renderer.dispose()` detaches listeners from shared/global geometries and
  materials.
- Consider auditing other addons display nodes that own private NodeMaterials for the same pattern.

### Workaround (app side)

```js
function disposeBloomNodeDeep(bloomNode) {
    if (!bloomNode) return;
    bloomNode.dispose?.();
    const materials = [
        bloomNode._highPassFilterMaterial,
        bloomNode._compositeMaterial,
        ...(Array.isArray(bloomNode._separableBlurMaterials) ? bloomNode._separableBlurMaterials : []),
    ];
    for (const m of materials) {
        m?.dispose?.();
        try { m.fragmentNode = null; m.colorNode = null; m.outputNode = null; } catch {}
    }
}
```

With this in place of plain `bloomNode.dispose()`, the shared-quad listener count returns to 0 after
each teardown and heap returns to baseline.

### Version / Environment

- three `0.181.2`, `WebGPURenderer` — reproduced on the WebGPU backend (SwiftShader and native) and
  observed on the WebGL backend.
- Chromium 141; also reproduces in Electron 38.

### Related

Same "renderer disposal leaves `dispose` listeners on a module-shared quad geometry" root pattern
also affects the **classic `WebGLRenderer` + `three/addons/postprocessing`** path — see the
companion issue (ISSUE 2 below / link once filed).

─── end ISSUE 1 ────────────────────────────────────────────────────────────────

---

─── ISSUE 2 ───────────────────────────────────────────────────────────────────

## `WebGLRenderer.dispose()` never removes `onGeometryDispose` listeners; with `Pass`'s module-level shared `_geometry`, each disposed renderer stays partly reachable through the postprocessing full-screen quad

### Description

An app that builds a `three/addons/postprocessing` `EffectComposer` (with `RenderPass`,
`UnrealBloomPass`, `ShaderPass`, …) on a **fresh `WebGLRenderer` per scene/level**, renders it, then
disposes each pass and `renderer.dispose()`, accumulates one leaked `onGeometryDispose` listener on
the shared full-screen-quad geometry per renderer teardown. Each leaked listener's closure retains
that renderer's `WebGLGeometries`/`WebGLBindingStates`/`WebGLInfo` state — i.e. a slice of the
disposed renderer — permanently.

### Steps to reproduce

1. In a loop: create a `WebGLRenderer`, an `EffectComposer` with at least one full-screen pass
   (`ShaderPass`/`UnrealBloomPass`/`RenderPass`), render one frame, dispose the passes + composer,
   then `renderer.dispose()` and drop the renderer.
2. GC between cycles.
3. Inspect `Pass`'s module-level `_geometry`
   (`three/addons/postprocessing/Pass.js`, `const _geometry = new FullscreenTriangleGeometry()`) —
   its `_listeners.dispose` array grows by one entry per cycle and never shrinks.

### Cause

- `Pass.js` shares a **module-level geometry singleton**:
  `const _geometry = new FullscreenTriangleGeometry()` (`Pass.js`), used by every `FullScreenQuad`
  of every pass across all renderer instances.
- When a geometry is first rendered, `WebGLGeometries.get()` does
  `geometry.addEventListener('dispose', onGeometryDispose)`
  (`src/renderers/webgl/WebGLGeometries.js`); `onGeometryDispose` removes that listener **only when
  the geometry itself is disposed**.
- `WebGLRenderer.dispose()` (`src/renderers/WebGLRenderer.js`) disposes `objects`, `bindingStates`,
  `programCache`, etc., but **nothing removes the `onGeometryDispose` listeners**, and
  `WebGLGeometries` exposes no dispose path that iterates its tracked geometries. So every
  `WebGLRenderer` that ever rendered a full-screen pass leaves its `onGeometryDispose` closure
  permanently attached to the shared module `_geometry`.

The shared `_geometry` is a permanent module singleton, so the listeners accumulate for the life of
the page; each closure retains its (disposed) renderer's internals.

### Suggested fix

- Give `WebGLGeometries` a `dispose()` that iterates its tracked `geometries` and calls
  `geometry.removeEventListener('dispose', onGeometryDispose)`, and call it from
  `WebGLRenderer.dispose()` — so renderer disposal detaches listeners from shared/module geometries.
- Or make `Pass`/`FullScreenQuad` not hard-share one module-level `_geometry` across renderer
  instances (ref-count it, or make it per-`FullScreenQuad`).

### Note on app-side workaround

Unlike the BloomNode case there is **no clean app-side workaround**: `_geometry` is private to
`Pass.js` (not exported), and disposing it is globally side-effecting (it is shared by every live
pass). This one needs an upstream fix.

### Version / Environment

- three `0.181.2`, classic `WebGLRenderer` + `three/addons/postprocessing` (`EffectComposer`/`Pass`).
- Reproduced on real-hardware WebGL2 (Chromium 141) and SwiftShader.

### Related

Same root pattern as the WebGPU `BloomNode` / `RenderObjects` / `QuadMesh` issue (ISSUE 1 above /
link once filed): renderer disposal fails to detach `dispose` listeners from a module-level shared
quad geometry.

─── end ISSUE 2 ────────────────────────────────────────────────────────────────
