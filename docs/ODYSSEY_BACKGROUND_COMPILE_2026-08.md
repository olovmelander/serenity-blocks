# Odyssey background chapter compile under the live loop (plan item 2.11)

Status: **design final, implementation in progress** (2026-08-21). three 0.185.1, WebGPURenderer,
Electron 38 / Chrome 140. Companion rows: `docs/R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md` 2.9
(landed), 2.11 (this), 2.12 (Bloom first frame, landed). All three.js references are to
`node_modules/three/src/...` at r185.

A first cut of this design is already in the working tree (uncommitted):
`src/rendering/odyssey/warmup/post-target-compile.js` (`rawBinding`, `beginLiveCompileReads`,
`launchCompileInScenePassPrologue`, `compileGroupUnderLiveLoop`, lines ~40-730) and
`src/rendering/odyssey/OdysseyBoardController.js` (`liveCompileEnabled` :367, drain :1399-1470,
sweep :1630-1660, `_deferRenderWarm` :1694-1706, `_prewarmChapterEnvironment` :1923-1948).
§3 lists what that cut still lacks; the adversarial review found one real hole (H-6 below).

---

## §0 Problem and gate

**Problem.** After the board reveal, chapters outside the eager window (6, 7, 8 under One World)
are created by `ChapterEnvironmentManager.loadChaptersInBackground` and then WARMED so their first
visit does not compile on a visible frame. Since the 08-20 r185 rework the warm is the
SYNCHRONOUS private-target render (`OdysseyBoardController._renderWarmChapterOffscreen`,
`renderer.render()` into a 320x180 clone of the scene-pass target), because r185's `compileAsync`
defers every node build into a main-thread-yielding drain that reads the **live**
`renderer.getRenderTarget()/getMRT()` at build time (`Renderer.js:884-1067`,
`NodeMaterial.js:475/561/685`, `MRTNode.js:160-184`, `NodeBuilder.js:574-590/3451`,
`WGSLNodeBuilder.js:2297-2318`). A held global binding across that drain either redirects every
live frame into the bound target (black canvas: `Renderer.js:1524-1564, 1774-1780`,
`RenderPipeline.js:121-151`) or, when the bound target is the shared scene-pass target, aliases
its `output` texture as both sampled binding and colour attachment of the quad's depth-0 pass
(the 2026-08-12 device poison: `Renderer.js:1686-1740, 3712-3725`, `PassNode.js:837-868`).

The synchronous render-warm therefore reaches `Pipelines.getForRender(renderObject, null)` ->
`device.createRenderPipeline` (`Renderer.js:3690-3732`, `Pipelines.js:331-335`,
`WebGPUPipelineUtils.js:261-341`): ~78 synchronous pipeline creations for chapters 6-8 at
13-17 s after launch, 1.4-1.8 s idle-gated stalls (AGGREGATE.md r185p1light cells).

**Gate (plan row 2.11).**

| Gate | Instrument | Pass condition |
|---|---|---|
| Zero synchronous `createRenderPipeline` after the reveal | `scripts/odyssey-perf-session.mjs` `browser.pipelines.sync` (`ms: -1` entries, hook :371-378, summary :660) | 0 entries with `at >= 10 s` after activation, load session, n = 3 cold + warm |
| No visual regression | ADR-0007 screenshot set (reveal, idle 15 s / 20 s, first visit ch 6/7/8) | no black / flickered frame, MRT emissive bloom present |
| No device poisoning | console + session: zero WebGPU validation errors, no `setPipeline ... not of type GPURenderPipeline` | 0 |
| Startup / board-visible flat | session `startup total`, `board visible` | within noise of r185p1light (5,510 / 6,539 cold; 5,456 / 6,447 warm) |
| Frame health not regressed | post-reveal p99 / max, idle frame max | <= 573 ms / 1,752 ms cold p99 / max; idle max <= 26 ms |

---

## §1 Mechanism

One sentence: **the scene-pass binding is applied to the real renderer only for `compileAsync`'s
synchronous prologue; the drained builds' target/MRT reads are answered by instance accessors on
the renderer's own `_renderTarget`/`_mrt` fields, which are suspended for the synchronous extent
of every live render and of the drain's own update hooks; nothing is bound or patched across any
yield; the render-warm stays as a cheap post-compile cache-hit pass.**

### 1.1 Why accessors on the fields, not method shadows

`_renderTarget` and `_mrt` are own data properties assigned in the constructor
(`Renderer.js:500, 536`). Every prototype member that matters reads them directly:
`getRenderTarget` (:2593), `getMRT` (:1190), `isOutputTarget` (:2525) and thus
`currentToneMapping`/`currentColorSpace`/`needsFrameBufferTarget` (:2500-2527, 2446-2453), and
`currentSamples` (:2480-2482, `samples = this._renderTarget.samples`). A method shadow of
`getRenderTarget`/`getMRT` would miss `currentSamples` (read by `NodeMaterial.setupClipping`
:624, `Shapes.js:13-25`, `WebGPUUtils.getTextureSampleData` :104-131,
`WebGPUTextureUtils` :468-551), `isOutputTarget`, and the direct field reads inside
`compileAsync` (:909-911) and `_renderScene` (:1546, 1589). An accessor on the instance
intercepts all of them. The accessor MUST have a setter: `setRenderTarget` (:2580), `setMRT`
(:1177) and `_renderScene` assign the fields in strict-mode modules.

This is deliberately NOT an `Object.create(renderer)` proxy handed to the builder
(Design 2, rejected): `PMREMNode.setup` stores `builder.renderer` into a `PMREMGenerator`
(`PMREMNode.js:325`) and `EnvironmentNode`/`PMREMNode` key WeakMaps on renderer identity
(`EnvironmentNode.js:58/115`, `PMREMNode.js:128`), `ReflectorNode.setup` passes it to
`_updateResolution` (`ReflectorNode.js:355`) — a per-build proxy is a latent live-frame crash the
moment a chapter uses an env map. The real-renderer accessor also answers the A2 reads a proxy
cannot reach (`Textures.updateTexture` :220-232, `getTextureSampleData`, `getColorBuffer`).

### 1.2 Exact renderer members wrapped (`beginLiveCompileReads(renderer, binding)`)

Refcounted on `renderer.__odysseyLiveCompileReads`; installed by `compileGroupUnderLiveLoop`
for the lifetime of one chapter compile; removed when the last in-flight chapter compile
releases. `binding = { renderTarget: scenePass.renderTarget, mrt: scenePass.getMRT() }` — ONE
binding for every item of every pooled compile, because the Odyssey post stack has exactly one
scene pass with one MRT (`odyssey-tsl-pipeline.js:258-283`).

| Member | Kind | Behaviour while installed |
|---|---|---|
| `_renderTarget` | own accessor (get/set, configurable) | get: `liveDepth === 0 ? binding.renderTarget : backing.renderTarget`; set: `backing.renderTarget = v` (always) |
| `_mrt` | own accessor | same shape with `binding.mrt` / `backing.mrt` |
| `render`, `compute` | own method wrapper | `liveDepth++` / `finally liveDepth--` around the ORIGINAL (synchronous end to end: `Renderer.js:1362-1370, 3690-3731`) |
| `clear`, `clearColor`, `clearDepth`, `clearStencil` | own method wrapper | suspend (read `_renderTarget` directly :2306, 2341) |
| `copyFramebufferToTexture`, `copyTextureToTexture` | own method wrapper | suspend (:3007) |
| `setSize`, `setPixelRatio` | own method wrapper | suspend — canvas attachment allocation reads `currentSamples` via `_getDefaultRenderPassDescriptor` / `getColorBuffer` / `getDepthBuffer` (`WebGPUBackend.js:438-461`, `WebGPUTextureUtils.js:465-551`); with the override active `isOutputTarget` is false and the MSAA buffer would get the scene target's sample count |
| `_nodes.updateBefore`, `_nodes.updateForRender`, `_nodes.updateAfter` | own method wrappers on the NodeManager instance | suspend — **the drain calls these outside any render** (`Renderer.js:1046-1050, 1060`); see H-6 |

NOT wrapped, and why: `renderAsync`, `computeAsync`, `clear*Async`, `readRenderTargetPixelsAsync`
are async functions — wrapping them would leave `liveDepth` raised across their awaits and make
drained builds between frames read the backing (wrong shader). `_outputRenderTarget`,
`_activeCubeFace`, `_activeMipmapLevel`, `toneMapping`, `outputColorSpace`, `depth`, `stencil`
are not overridden: the scene pass runs at mip 0 / face 0 and object shaders carry no tone
mapping in r185 (`NodeMaterial.js:1184-1200`; tone mapping lives in the output pass,
`NodeManager.js:869-908`, which `compileAsync` never precompiles). `_currentRenderContext` is
not overridden: `NodeBuilder._getBindGroup` (`NodeBuilder.js:690`) uses it only as a per-build
dedupe key, and the 2.9 pre-reveal compile (also built with it restored to null,
`Renderer.js:1029`) was verified exact on the first live frame.

`rawBinding(renderer)` (the module's own save/restore reader, used by `beginWarmTargetRender`,
`beginPostTargetCompile`, `launchCompileInScenePassPrologue`) returns `state.backing` when the
override is installed, never the accessor's answer.

Release: restore the saved own-property descriptors (or delete if there was none), then write
the final backing values into the plain fields, delete `__odysseyLiveCompileReads`.

### 1.3 Per-item captured state and where it is applied

| Captured | When captured | Where it is read by the drain | Mechanism |
|---|---|---|---|
| render context (target signature + `mrt.id` + call depth 1 => `context.id`) | `compileAsync` prologue, `Renderer.js:909-911` (default callDepth 0 -> patched to 1) | `item.renderContext` -> `_objects.get` -> `RenderObject.initialCacheKey` (`RenderObject.js:263, 841`); backend key + pipeline descriptor read `renderObject.context` (`WebGPUBackend.js:2113-2143`, `WebGPUPipelineUtils.js:128-218`) | `launchCompileInScenePassPrologue`: `setRenderTarget(scenePass.renderTarget)`, `setMRT(scenePass.getMRT())`, `beginNestedContextDepth` installed, `renderer.compileAsync(object, camera, scene)` called, all three restored in `finally` BEFORE the promise is returned. `compileAsync` has no await before its drain once initialised (`Renderer.js:884-1037`), so the whole render-list walk and item 1's synchronous S0 prefix run inside the call. The resulting context is the LIVE scene pass's own `RenderContext` object (`RenderContexts.js:41-72`: key hashes signature, not identity). |
| `ctx.depth` / `ctx.stencil` | prologue writes them from `renderer.depth/stencil` (`Renderer.js:931-932`); live pass derives from `renderTarget.depthBuffer/stencilBuffer` (:1693-1708) | `WebGPUPipelineUtils.js:198-218`, `WebGPUUtils.getCurrentDepthStencilFormat` :44-88 | prologue `finally` re-asserts `ctx.depth = target.depthBuffer`, `ctx.stencil = !!target.stencilBuffer` on `_renderContexts.get(target, mrt, 1)` via the ORIGINAL `get` (FIX-1; a no-op today, hardening against item 1 reaching `Pipelines.getForRender` with no task boundary) |
| `material.side` (two-pass DoubleSide split, `Renderer.js:3617-3626`) | `_createObjectPipeline` push (2.9 `beginDeferredSideCapture`, `post-target-compile.js:324-390`) | first drain read `this._objects.get(item.object, item.material, ...)` (`Renderer.js:1039`) AND `Pipelines.getForRender` backend key (`WebGPUBackend.js:2113-2141` includes `material.side`) | material getter re-applies at :1039; the `getForRender` wrapper must RE-APPLY the captured side BEFORE calling the original when `Array.isArray(promises)` (FIX-4 — a live frame drawing a shared material during `getForRenderAsync`'s yields leaves DoubleSide), then restore the pre-drain side in `finally` |
| target / MRT / samples answers for S0 and A1 reads | constant (`binding`) | `NodeMaterial.setup` :475/559-583/624/685, `NodeBuilder.needsPreviousData` :3451, `MRTNode.setup` :160-184, `NodeBuilder.getOutputType` :574-590, `WGSLNodeBuilder.buildCode` :2297-2318, catch/fallback rebuild `NodeManager.js:226-242`, `Textures.updateTexture` :220-232, `getTextureSampleData` :104-131 | the accessors (§1.2): every resumed build segment (9 `yieldToMain` per cold build, `NodeBuilder.js:3265`; one per object, `Renderer.js:1063`) reads the binding regardless of what any frame bound in between |
| object visibility for the prologue | per representative object | `_projectObject` skips `visible === false` (`Renderer.js:3082`) | prologue reveals the representative (never lights, `frustumCulled=false` on renderables) and restores in the same `finally` — a far chapter is never visible to a live frame |

### 1.4 Suspension during live render — what a frame sees

A live frame is `OdysseyBoardController.animate -> renderFrame -> postProcessingStack.render()`
-> `RenderPipeline.render` -> `QuadMesh.render` -> `renderer.render` (wrapped: `liveDepth=1`)
-> `_renderScene` depth 0 -> `PassNode.updateBefore` (FRAME-gated) -> `renderer.render` nested
(`liveDepth=2`) depth 1 -> Bloom (`RendererUtils` save/restore) -> RTT. Throughout, every
`_renderTarget`/`_mrt` read returns the backing; every `setRenderTarget`/`setMRT` writes the
backing. The frame therefore resolves its depth-0 context unpatched, takes the
`_getFrameBufferTarget`/`_renderOutput` path to the canvas exactly as without the override, and
the quad never has the scene target as its outer binding.

The drain's own stages run with `liveDepth=0` (reads answered from the binding) EXCEPT the
three NodeManager update calls, which are suspended so that any FRAME-type hook that
saves/rebinds/restores the target (`PassNode.updateBefore` :807-868, `ReflectorNode` :547-548,
`RTTNode` :217/256, `RendererUtils.resetRendererState` :19-75) saves and restores the TRUE
binding (null) — not the overridden scene target (H-6).

### 1.5 What happens per chapter (`_drainPrewarmQueue`)

1. Gate: `isActive`, `_canRunBackgroundTask` (idle + scroll-idle + frame-healthy, :1281-1322).
2. `env._compileInFlight = this._prewarmChapterEnvironment(ch)`; await it. Inside:
   `_compileGroupThroughPost(group, { live: true })` -> `compileGroupUnderLiveLoop` ->
   `beginLiveCompileReads` + `beginDeferredSideCapture` -> `compileObjectsFannedOut(..., {
   includeHidden: true, aroundCall: launchCompileInScenePassPrologue })` (6-wide pool, one
   representative per builder-identity bucket, DoubleSide buckets of one material serialised,
   `post-target-compile.js:431-520`). Every pipeline is created through
   `device.createRenderPipelineAsync`. On success and `!renderer._isDeviceLost`: `env.prewarmed
   = true` ("compile landed" regains its meaning).
3. Re-check `isActive` and `environments.get(ch) === env` (eviction / teardown mid-compile).
4. Synchronous `_renderWarmChapterOffscreen(ch, env)` into the private 320x180 clone
   (`createWarmRenderTarget`, depth patch held only inside this synchronous task). Creates no
   pipelines (~4 ms measured cache-hit case, :1612-1614); pays first draw of the
   non-representative bucket members (geometry/bind groups), `onBeforeRender`, the warm
   target's attachments, and RENDER-type update hooks the drain skipped (renderId gating,
   `NodeFrame.js:147-166`). Sets `env._renderWarmed` (Galaxy guarantee reader :1345).
5. Clear `env._compileInFlight`; 180 ms to the next chapter; 5-retry cap on failure.

The sweep (`_startBackgroundRenderWarm`) and `_deferRenderWarm` never call
`_renderWarmChapterOffscreen` on an env with `!env.prewarmed` while `liveCompileEnabled`: they
queue it to the drain and rotate; after the bounded wait they log "compile never landed — left
to first visit" and move on (no "warming anyway" escape — that IS the synchronous compile this
item removes).

---

## §2 Hazards

| # | Hazard | How handled | Evidence |
|---|---|---|---|
| H-1 | Stale target/MRT read after a yield (the r185 black-screen bug) | Reads are answered by the accessors for the whole compile; only synchronous entry points suspend them, and no suspension spans an await | `NodeBuilder.js:3226-3281` (9 yields after `prebuild`), `Renderer.js:1037-1065` (drain), `utils.js:352-370` (`scheduler.yield` => task boundaries) |
| H-2 | Shared scene-pass `output` texture aliased as attachment + binding of the quad's pass (device poison) | The scene target is bound globally only inside the synchronous prologue and restored in `finally` before the promise is returned; live frames read/write the backing only; the render-warm binds a private clone | `Renderer.js:884-1037` (no await before the drain), :1686-1740 (pass begun before `updateBefore` :3712), `post-target-compile.js` `createWarmRenderTarget` |
| H-3 | Live frame redirected into a bound target (black canvas) | Nothing is bound between frames; `render` is suspended so `_renderScene` sees `_renderTarget === null`, takes `_getFrameBufferTarget` + `_renderOutput` | `Renderer.js:1524-1564, 1774-1780, 2525` |
| H-4 | Builder cache key / content mismatch | Key: `initialCacheKey` = material key + `context.id` + dynamic key; `context.id` is the live depth-1 scene-pass context (prologue under the depth patch, same signature + `mrt.id`). Content: built under the same target/MRT/samples answers the live pass gives. Lights stable (chapter-light-pool v2, 2.9). Backend key: `renderObject.context` + re-applied `material.side` (FIX-4) + re-asserted `ctx.depth/stencil` (FIX-1) | `RenderObject.js:263, 730-848, 841`, `RenderContexts.js:41-72`, `NodeManager.js:151-155, 194-304`, `WebGPUBackend.js:2113-2143`, `Pipelines.js:431-435` |
| H-5 | Depth patch re-keying live contexts | `beginNestedContextDepth` is installed only inside the synchronous prologue `call()` and inside the synchronous warm render; `compileAsync`'s only `contexts.get` is in the prologue (:911); the live quad's depth-0 `get` (:1589) never sees it | `post-target-compile.js:226-240`, `Renderer.js:911, 1589, 2313` |
| H-6 | **Drain-time FRAME hook restores the overridden target into the backing** (`updateBefore` runs outside `render()` with the override active; `PassNode/Reflector/RTT/RendererUtils` save `getRenderTarget()` = scene target, render, then `setRenderTarget(saved)` writes the scene target into the backing; the next quad frame then draws into the scene target while sampling it = H-2) | Wrap `renderer._nodes.updateBefore/updateForRender/updateAfter` in the suspend set; dev assertion after every suspended section that `backing.renderTarget !== scenePass.renderTarget`. Latent today (no chapter carries such a node; `surface-world` `reflector()` opt-in OFF; `castShadow=false`; `ShadowNode` RENDER-type skipped) | `Renderer.js:1046-1050, 1060`, `PassNode.js:807-868`, `ReflectorNode.js:547-548`, `RTTNode.js:217/256`, `RendererUtils.js:19-75`, `NodeManager.js:930-1000` |
| H-7 | `rawBinding()` reading the accessor and "restoring" the scene target | `rawBinding` returns `state.backing` when the override is installed | `post-target-compile.js:55-61` (already in the cut; unit-tested in §4) |
| H-8 | Async entry points wrapped => `liveDepth` raised across awaits => drained builds read the backing | Only synchronous members are wrapped; drop `renderAsync`, `computeAsync`, `clear*Async`, `readRenderTargetPixelsAsync` from the current cut's list | `Renderer.js:1078-1086` (`renderAsync` is `await init(); render()`) |
| H-9 | Resize during a compile allocates canvas MSAA buffers with the scene target's sample count | `setSize`/`setPixelRatio` suspended | `WebGPUBackend.js:438-461`, `WebGPUTextureUtils.js:465-551` |
| H-10 | `material.side` reset by a live frame between `_objects.get` and `Pipelines.getForRender` (shared material) | FIX-4 re-apply before the original `getForRender` when `promises` is an array; restore in `finally` | `Renderer.js:1039, 1044, 1053, 3617-3626`, `WebGPUBackend.js:2113-2141` |
| H-11 | Eviction / teardown mid-compile | Drain re-checks `isActive` and env identity after the await; queued items referencing disposed materials build dead states (cost only); accessors released in `finally`. Eviction (`?odysseyChapterEvict=1`) disables background loading anyway | `OdysseyBoardController.js:364-366, 1443-1444`, `RenderObject.js:349-351` |
| H-12 | Device loss | `compileAsync` returns early on `_isDeviceLost` (:886) => would report success; check `renderer._isDeviceLost` before setting `env.prewarmed`. `createRenderPipelineAsync` rejection propagates through `Promise.all` (:1056) -> `finally` releases everything; `env.prewarmed` stays false; drain's 5-retry cap | `Renderer.js:886, 1053-1058` |
| H-13 | Concurrent compiles (6-wide pool, overlapping chapters) | All items want the same binding; refcount keeps accessors installed until the last release; DoubleSide buckets of one material serialised; drain is one chapter per tick | `post-target-compile.js:431-520`, `beginLiveCompileReads` refcount |
| H-14 | Sweep / `_deferRenderWarm` warming a chapter whose compile is in flight (sync render while `createRenderPipelineAsync` pending => draw skipped or `setPipeline` TypeError, and any un-requested object created synchronously) | Both wait on `env.prewarmed` / `env._compileInFlight`, no "warming anyway" under `liveCompileEnabled` | `Pipelines.js:255-265`, `OdysseyBoardController.js:1607-1609, 1630-1660, 1694-1706` |
| H-15 | Live sync build of the same key racing the drain (player reaches the chapter mid-compile) | The async `.then` overwrites with an equivalent state; wasted, not wrong | `NodeManager.js:250-257` |
| H-16 | RENDER-type update hooks skipped in the drain (renderId restored before the drain) | Run by the post-compile render-warm, not on a visible frame; same as the verified 2.9 path | `Renderer.js:1026`, `NodeFrame.js:147-166` |
| H-17 | Prologue mutates the live scene-pass context (clipping context, background, textures) | Same camera/scene; live pass rewrites every frame; `ctx.depth/stencil` re-asserted | `Renderer.js:927-1005` |
| H-18 | NodeManager deferred queue (`getForRenderDeferred`) | Dead code in r185 (no caller); contract test pins that `_renderObjectDirect` does not consult it | `NodeManager.js:337-412` |

---

## §3 Implementation steps (in order)

### 3.1 `src/rendering/odyssey/warmup/post-target-compile.js`

1. `beginLiveCompileReads`: trim the suspend list to synchronous members only —
   `['render', 'compute', 'clear', 'clearColor', 'clearDepth', 'clearStencil',
   'copyFramebufferToTexture', 'copyTextureToTexture', 'setSize', 'setPixelRatio']` (remove
   `renderAsync`, `computeAsync`, `clear*Async`, `readRenderTargetPixelsAsync`). Add a second
   suspend set on `renderer._nodes` for `updateBefore`, `updateForRender`, `updateAfter`
   (same `liveDepth` counter; save/restore own descriptors on the NodeManager instance; skip
   silently on doubles without `_nodes`). Add a dev-only assertion helper `assertBackingSane()`
   called in each wrapper's `finally`: `state.backing.renderTarget !== state.binding.renderTarget`
   else `console.error('[OdysseyCompile] backing aliased to scene-pass target')` and force
   `backing.renderTarget = null`.
2. `rawBinding`: keep the `__odysseyLiveCompileReads` branch (already present); add the unit
   test (§4).
3. `beginDeferredSideCapture` `getForRender` wrapper: store `{ preDrain, captured }` per material
   in `pending`; when `Array.isArray(promises) && pending.has(material)` set
   `material.side = captured` BEFORE the original call, restore `preDrain` in `finally`. The
   material getter records `captured = side` at push time (it already closes over `side`).
4. `launchCompileInScenePassPrologue`: keep as is (reveal, bind, depth patch, `call()`, FIX-1
   re-assert, restore in `finally`). Add: `if (!object) return call()` guard; ensure the
   `_renderContexts.get` used for the re-assert is the ORIGINAL (the patch is already restored
   at that point, so the plain call is correct — add a comment and a test).
5. `compileGroupUnderLiveLoop`: after `compileObjectsFannedOut` resolves, return
   `!renderer._isDeviceLost` (false when lost). Export a dev counter
   `renderer.__odysseyLiveCompileStats = { launches, asyncPipelines }` incremented in the
   `getForRender` wrapper when `promises.length` grew (per-path attribution, §5).
6. `compileGroupThroughPost(renderer, stack, scene, camera, group, renderLoopActive, options)`:
   `if (options.live && renderLoopActive) return compileGroupUnderLiveLoop(...)`; keep the
   pre-reveal shared-target session path byte-identical; keep `return false` for
   `renderLoopActive && postActive && !options.live`.
7. File header (lines 1-46): already updated for 2.11; replace the remaining "there is no safe
   background compileAsync on r185" sentence in the 08-20 block with a pointer to the 2.11 block.

### 3.2 `src/rendering/odyssey/OdysseyBoardController.js`

8. Flag: keep `this.liveCompileEnabled = !readBooleanUrlFlag('odysseyLiveCompileOff') &&
   readUrlValue('odysseyLiveCompile') !== '0'` (:367). Register both spellings in the flag
   registry (`tests/unit/odyssey-flag-registry-drift.test.js` will fail otherwise).
9. `_drainPrewarmQueue` (:1399-1470): set `env._compileInFlight = promise` before the await and
   clear it in `finally`; after a successful compile require `env.prewarmed === true` before
   the render-warm — if the compile returned false (device lost / no post) fall through to the
   sync warm ONLY when `!this.liveCompileEnabled`, otherwise re-queue (5-retry cap) and log
   `[OdysseyBoard] live compile did not land for chapter N (attempt k)`. Update the stale
   "(pipelines, GPU uploads, first update())" comment: pipelines are now created by the compile.
10. `_startBackgroundRenderWarm` (:1630-1660): already queues to the drain and bounds at 90 x
    200 ms with "left to first visit"; additionally skip the warm when
    `env._compileInFlight` is pending even if `env.prewarmed` flipped (cannot happen in order,
    but cheap). Count drain-warmed chapters toward `_bgRenderWarmComplete`.
11. `_deferRenderWarm` (:1694-1706): under `liveCompileEnabled`, after 30 polls without
    `env.prewarmed`, `_queueChapterPrewarm` and return (never call the sync warm); set
    `_renderWarmed` only from the drain.
12. `_prewarmChapterEnvironment` (:1923-1948): live branch already selects `{ live: true }`; add
    the `renderer._isDeviceLost` check and `[OdysseyBoard] Prewarmed chapter N shaders (live
    loop, Xms, k async pipelines)` using `__odysseyLiveCompileStats`.
13. `_renderWarmChapterOffscreen`: no change, but in dev (`?odysseyAAA=1`) wrap the warm with a
    `GPUDevice.prototype.createRenderPipeline` counter and `console.warn` when > 0 after a live
    compile (the gate, visible in-app).

### 3.3 `scripts/odyssey-perf-session.mjs`

14. Summary: add `pipelines.syncAfter10s` (count of `ms: -1` entries with `at >= activation + 10 s`)
    and `pipelines.asyncByWindow` (async creations bucketed per 5 s) so the 78 creations can be
    seen MOVING to the async branch rather than vanishing into first-visit misses. Pass
    `--url-flag odysseyLiveCompile=0` through the existing `--url-flag` plumbing (:186) for the
    A/B.

### 3.4 Docs

15. Plan row 2.11 result + AGGREGATE cells after measurement; upstream note in
    `docs/UPSTREAM_THREE_R185_ISSUES_READY_TO_FILE.md` ("the drain should re-apply
    `item.renderContext`'s target/MRT around each build"); drain comment.

---

## §4 Tests

All under `tests/unit/` (vitest), extending `odyssey-post-target-compile.test.js` and
`odyssey-board-controller.test.js`.

### 4.1 Renderer double

A double with own data fields `_renderTarget`, `_mrt`, `_outputRenderTarget = null`,
`_samples`, `depth`, `stencil`, `_isDeviceLost`, prototype getters mirroring
`Renderer.js:1190, 2480-2482, 2525, 2593` (`getRenderTarget`, `getMRT`, `isOutputTarget`,
`currentSamples`, `needsFrameBufferTarget`), methods `setRenderTarget`/`setMRT` (field writes),
synchronous `render`/`clear`/`setSize` that record what they saw and rebind, `_nodes` with
`updateBefore/updateForRender/updateAfter` that run a pluggable hook, `_renderContexts.get`
keyed as `RenderContexts.js:67`, `_pipelines.getForRender(ro, promises)`.

Cases:
- accessors: with the override installed `getRenderTarget()/getMRT()/isOutputTarget/
  currentSamples/needsFrameBufferTarget` answer from the binding; inside wrapped `render()`,
  `clear()`, `setSize()` and `_nodes.updateBefore()` they answer the backing; `setRenderTarget`
  inside `render()` updates the backing and is visible after release; release restores plain
  data properties holding the last backing values; two begins + one release keeps the override.
- H-6 regression: a hook inside `_nodes.updateBefore` does `saved = getRenderTarget();
  setRenderTarget(X); render(); setRenderTarget(saved)` — assert the backing afterwards is the
  pre-hook backing (null), NOT the scene target.
- H-7: `rawBinding` returns the backing while installed.
- H-8: an async member is NOT wrapped (spy that `renderAsync` descriptor is untouched).

### 4.2 Drain double (replays `Renderer.js:1037-1065`)

Items `{ material getter, renderContext }`; per item: `_objects.get` reads `item.material` once
(records side), a `NodeMaterial.setup` stand-in records `getRenderTarget()/getMRT()/
currentSamples` at S0, `await yield` (microtask + a fake "live frame" that calls wrapped
`render()` binding/rebinding a different target and resetting `material.side = DoubleSide`),
A1 stand-in records the reads again, then `_pipelines.getForRender(ro, [])` records
`material.side`, then `_nodes.updateBefore`. Assert: every S0/A1 read equals the scene-pass
binding; the fake frame saw the backing; `getForRender` saw the captured side (FIX-4) and the
pre-drain side is restored after; the item's `renderContext` is the depth-1 context and
`_renderContexts.get` is unpatched once `launchCompileInScenePassPrologue` returned;
`ctx.depth/stencil` equal `target.depthBuffer/stencilBuffer` even when `renderer.depth/stencil`
differ (FIX-1); visibility/`frustumCulled` restored when `call()` throws; lights never revealed.

### 4.3 Controller

- Drain awaits the live compile, then the render-warm; skips the warm when the env was replaced
  or `isActive` dropped; sets `_compileInFlight` and clears it.
- Sweep and `_deferRenderWarm` never call `_renderWarmChapterOffscreen` for `!env.prewarmed`
  under `liveCompileEnabled`; under `?odysseyLiveCompile=0` the 08-20 behaviour returns (warm
  sets both flags).
- Compile returning false (device lost) leaves `env.prewarmed` false and re-queues.

### 4.4 Source contract pins (read `node_modules/three/src`, fail on a three bump)

1. `Renderer.js` `compileAsync`: `const renderContext = this._renderContexts.get( renderTarget, this._mrt );`
   (no callDepth) and `const renderTarget = useFrameBufferTarget ? this._getFrameBufferTarget() : ( this._renderTarget || this._outputRenderTarget );`
   and `renderContext.depth = this.depth;` before the drain.
2. `Renderer.js` drain order: `this._objects.get( item.object, item.material,` followed by
   `await this._nodes.getForRenderAsync( renderObject );` then `this._nodes.updateBefore( renderObject );`
   then `this._pipelines.getForRender( renderObject, pipelinePromises );`.
3. `Renderer.js`: `samples = this._renderTarget.samples;` (currentSamples) and
   `return this._renderTarget === this._outputRenderTarget || this._renderTarget === null;`
   (isOutputTarget) — field-level accessors are required.
4. `NodeMaterial.js`: `const renderer = builder.renderer;` ... `const renderTarget = renderer.getRenderTarget();`
   and `const mrt = renderer.getMRT();` under `if ( renderTarget !== null )`.
5. `NodeManager.js`: `this.backend.createNodeBuilder( renderObject.object, this.renderer )`
   and no caller of `getForRenderDeferred` outside its definition (H-18).
6. `RenderContexts.js`: `attachmentState + '-' + mrtState + '-' + callDepth` and
   `RenderObject.js`: `cacheKey += this.context.id + ','`.
7. `PassNode.js` `updateBefore`: `renderer.setRenderTarget( currentRenderTarget );` after
   `renderer.render( scene, camera );` (the H-6 pattern this design must survive).

---

## §5 Measurement protocol

Per ADR-0016 every number comes from the verified instrument; per ADR-0018 the three pin is
0.185.1 throughout.

1. Dev server up on the session's port (the session does not start one).
2. Load session, cold and warm, n = 3 each, via the process-per-run driver:
   `reports/odyssey-perf/rtx3070-r181-vs-r185/perf-driver.sh` with
   `ODYSSEY_PERF_KEY_TRACE=1` (renderer-level builder-state / pipeline miss trace, session :383-395)
   and `--duration 30000`. Cells: `r185p2live` (default, live compile ON) and `r185p2sync`
   (`--url-flag odysseyLiveCompile=0`).
3. Read off per cell: `browser.pipelines.sync` list with timestamps (gate: none with
   `at >= 10 s`); `pipelines.asyncByWindow` (expect the ~78 creations in the 12-20 s async
   buckets for `r185p2live`, and as sync entries at 13-17 s for `r185p2sync`); key trace: zero
   builder-state misses and zero pipeline misses for chapter 6/7/8 objects on first visit
   (journey segment of the session); post-reveal frame p95/p99/max, long-task count/total/max,
   idle frame max and spikes, startup total, board visible.
4. Console lines required in every `r185p2live` run: `[OdysseyBoard] Prewarmed chapter N shaders
   (live loop, ...)` for 6, 7, 8 followed by `[OdysseyBoard] Drain render-warmed chapter N in Xms`
   with X <= ~10 ms; forbidden: `warming anyway`, `compile never landed`, `setPipeline`,
   `backing aliased`, any WebGPU validation error.
5. Aggregate with `scripts/odyssey-perf-compare.mjs` into AGGREGATE.md as new columns next to
   r185p1light; fill plan row 2.11's result cell.
6. ADR-0007 visual set (one capture per session — iGPU TDR rule in CLAUDE.md; the RTX box is
   used for the perf cells): `scripts/odyssey-chapter-capture.mjs` for chapters 6, 7, 8 first
   visit and `scripts/odyssey-journey-capture.mjs` frames at t = 12, 15, 20 s during the drain
   window; compare against the r185p1light set — no black/flickered frame, emissive bloom present
   on the MRT tier. Repeat the ch 6-8 captures with `?odysseyLiveCompile=0` as the control.
7. Optional: `?odysseyTravelGate=1` run to confirm `isChapterReady` flips only after the
   drain's warm (Galaxy guarantee unchanged).

---

## §6 Rollback flag

`?odysseyLiveCompile=0` (alias `?odysseyLiveCompileOff=1`), read at
`OdysseyBoardController.js:367` into `this.liveCompileEnabled`. When false:

- the drain skips the compile and runs the 08-20 synchronous private-target render-warm alone
  (sets both `prewarmed` and `_renderWarmed`);
- `_prewarmChapterEnvironment` returns immediately under a live loop;
- the sweep keeps its 30 x 200 ms grace and the "warming anyway" escape;
- `_deferRenderWarm` calls the sync warm after its poll;
- no accessor, no NodeManager wrapper, no prologue binding is ever installed.

Pre-reveal behaviour (compile pool + shared-target session) is identical in both states.
Default is ON once §5 passes; until then the flag is the A/B control.

---

## §7 Open risks

1. **Private-member surface.** `_renderTarget`, `_mrt`, `_renderContexts.get`,
   `_createObjectPipeline`, `_pipelines.getForRender`, `_nodes.updateBefore/…`, `_isDeviceLost`
   and the drain's exact ordering are all r185 internals. The §4.4 pins fail loudly on a bump;
   the flag is the rollback; ADR-0018 governs the next upgrade.
2. **Unlisted synchronous readers.** Any renderer entry point that reads `_renderTarget`/`_mrt`
   or `currentSamples` between frames and is not in the suspend set sees the scene-pass binding
   while a compile is in flight (future theme timers, XR paths). Mitigation: a grep lint test
   that no `src/` file calls `getRenderTarget/getMRT/currentSamples` outside render-time code
   (themes call them inside `onBeforeRender`/`update`, which are suspended).
3. **A2 readers that bypass `builder.renderer` AND the fields** — none known; `Textures.updateTexture`
   and `getTextureSampleData` go through the fields (covered). A chapter adding
   `viewportSharedTexture` or a bare `DepthTexture` should be checked against the `multisampled`
   layout flag on compile vs live.
4. **Player scroll during an in-flight compile.** `_canRunBackgroundTask` gates the START of a
   chapter; the drain continues in ms-sized JS segments between yields with Dawn work
   off-thread. If the session shows small long tasks during scroll windows, add a per-launch
   gate check inside the pool worker.
5. **Compile slower than the sweep bound** (90 x 200 ms = 18 s). The sweep then logs "left to
   first visit" and that chapter pays on first visit — visible as sync entries in the session,
   i.e. the gate catches it; widen the bound or make the sweep await `_compileInFlight` if seen.
6. **Nested renders from drain-time FRAME hooks** spend GPU time outside the frame-health check.
   Only the opt-in surface-world reflector does this today; with H-6's suspension they are
   target-safe.
7. **Non-representative bucket members' first draw** stays in the synchronous warm (uploads,
   bind groups, `onBeforeRender`): not pipeline compiles, expected ~4 ms per chapter; if a
   chapter's warm is measurably above that, the bucket identity in `compileObjectsFannedOut` is
   too coarse for it.
8. **One World-suppressed ids 2-5** still flow through `loadChaptersInBackground` ->
   `_queueChapterPrewarm` with no env (dropped in the drain) — timer churn only.
9. **Dynamic cache key memoised per `info.calls`** (`NodeManager.js:590-633`): a lights/env/fog
   change made by the live loop inside the same `info.calls` window as a drained item's
   `_objects.get` would be missed — same exposure as the pre-reveal compile, bounded by the
   fixed light rig.
