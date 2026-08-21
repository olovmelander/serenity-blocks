/**
 * @fileoverview Post-target compile mechanics for Odyssey warm-up.
 *
 * Extracted from OdysseyBoardController (masterplan E2 — decompose the warm-up/seam orchestration
 * out of the 2,800-line board god object). These are the most self-contained pieces of the warm-up:
 * pure renderer/render-target manipulation with no board state, so they lift cleanly into reusable,
 * testable functions. The board keeps thin wrappers so every internal caller is unchanged.
 *
 * WHY the post target is bound before compileAsync: the chapters always render THROUGH the post
 * PassNode's HalfFloat/MRT scene-pass target. Binding the scene-pass target makes compileAsync
 * build the pipelines the chapter ACTUALLY uses live; without it, canvas-format pipelines were
 * built that the post path never used, so the REAL pipelines compiled synchronously inside the
 * warm-up renders — the loading-screen freeze.
 *
 * WHY the binding is HELD ACROSS THE ENTIRE AWAIT (r185 rework, 2026-08-20). r181's compileAsync
 * did all node building in a synchronous prologue, so bind → launch → restore-in-finally was safe:
 * the restore could not affect the in-flight compile. r185 restructured compileAsync into a
 * DEFERRED build loop — `_createObjectPipeline` only queues work items, and every object's node
 * build + pipeline creation runs AFTER the synchronous section, one object at a time, yielding to
 * the main thread between shader stages (r185 Renderer.js:884-1067, NodeBuilder.js:3265). Each
 * deferred build reads the LIVE `renderer.getMRT()` at build time, and the resulting builder state
 * is cached under an MRT-agnostic key (RenderObject.js:949-951, NodeManager.js:151-153). Restore
 * before the promise resolves and objects 2..N build against the restored (null) MRT → single-
 * output shaders poison the cache the live MRT pass then reuses — the documented poisoned-cache
 * black screen, self-inflicted. Upstream's own recipe (r185 PassNode.compileAsync, PassNode.js:
 * 749-762) holds the binding across the await; this module now does the same, with a refcounted
 * session so the controller's CONCURRENT startup compile pool shares one binding and the true
 * previous state is restored only when the last pooled compile resolves.
 *
 * WHY compileAsync IS SKIPPED ENTIRELY WHILE THE RENDER LOOP IS LIVE (r185 rework). Holding a
 * global target/MRT binding across a multi-frame-yielding compile is impossible under a live rAF
 * loop — the loop rebinds targets for its own frames between yields, so the deferred builds read
 * drifting state no matter what this module binds (and binding the SHARED scene-pass target while
 * the loop renders aliases its `output` texture as both sampled binding and render attachment,
 * which permanently poisons the device — the 2026-08-12 crash, still true on r185). There is no
 * safe background compileAsync on r185. Background/live-loop warming is owned by the synchronous
 * private-target render-warm ({@link createWarmRenderTarget} + {@link beginWarmTargetRender} +
 * `renderer.render()`), which r185 leaves untouched: `render()` is still fully synchronous, and
 * the WebGPU pipeline cache key is format-based (`WebGPUBackend.getRenderCacheKey`), so a
 * format-matched private clone warms exactly the pipelines the live post path uses.
 */

/**
 * Bind the post scene-pass render target + MRT so a following compileAsync captures the real
 * render context. Returns the saved state to pass to {@link endPostTargetCompile}, or null when
 * post is inactive (direct-to-canvas rendering — the plain compile is correct as-is).
 * @param {object} renderer the WebGPU/WebGL renderer
 * @param {?object} postProcessingStack the post stack (or null when post is inactive)
 * @param {boolean} [renderLoopActive] when true the binding is SKIPPED — see the file header.
 * @returns {?{previousTarget: *, previousMRT: *, restoreContexts: ?Function}} saved state, or null when post is inactive
 */
export function beginPostTargetCompile(renderer, postProcessingStack, renderLoopActive = false) {
    if (renderLoopActive) return null;
    const scenePass = postProcessingStack?.scenePass;
    if (!scenePass?.renderTarget
        || typeof renderer?.getMRT !== 'function'
        || typeof renderer?.setMRT !== 'function') {
        return null;
    }
    const previousTarget = renderer.getRenderTarget();
    const previousMRT = renderer.getMRT();
    renderer.setRenderTarget(scenePass.renderTarget);
    renderer.setMRT(scenePass.getMRT?.() ?? null);
    // Same context DEPTH as the live scene pass (see beginNestedContextDepth) — the target alone
    // is not enough: the builder key carries the render-context id, which includes the depth.
    return { previousTarget, previousMRT, restoreContexts: beginNestedContextDepth(renderer) };
}

/**
 * Create a small PRIVATE render target that mirrors the post scene-pass's ATTACHMENT FORMATS.
 *
 * Why this exists (2026-08-17): the post-reveal background render-warm was a structural no-op.
 * It called {@link beginPostTargetCompile}, which correctly refuses to bind the scene-pass target
 * while the rAF loop is live (doing so aliases a texture as both sampled binding and render
 * attachment and permanently poisons the device — see the file header), and then bailed on the
 * null return. Measured: chapters 6/7/8 finished a whole session with `_renderWarmed === false`
 * and six failed warm attempts each, so every first visit still compiled on a visible frame.
 *
 * A private target breaks the aliasing by construction — the live post graph never touches it —
 * so the warm can run at any time. It still warms the RIGHT pipelines because the WebGPU pipeline
 * cache key is built from FORMATS, not texture identity: see `WebGPUBackend.getRenderCacheKey`,
 * which hashes `getSampleCountRenderContext` / `getCurrentColorSpace` / `getCurrentColorFormat` /
 * `getCurrentDepthStencilFormat`. `RenderTarget.copy` reproduces every one of those (all MRT
 * attachment textures, the depth texture and `samples`), so a clone yields identical cache keys.
 * Re-verified against r185 source (WebGPUBackend.js:2113-2141; RenderTarget.js:349-389).
 *
 * Dimensions are deliberately tiny: pipeline specialisation does not depend on resolution, so a
 * 320x180 warm pass compiles exactly the same pipelines as a full-resolution one for a small
 * fraction of the fill cost.
 *
 * @param {?object} scenePass the post stack's scene pass
 * @param {number} [width] warm target width in px
 * @param {number} [height] warm target height in px
 * @returns {?object} the private render target, or null when post is inactive/unclonable
 */
export function createWarmRenderTarget(scenePass, width = 320, height = 180) {
    const source = scenePass?.renderTarget;
    if (!source || typeof source.clone !== 'function') return null;
    try {
        const target = source.clone();
        if (typeof target.setSize === 'function') target.setSize(width, height);
        return target;
    } catch {
        return null; // caller falls back to skipping the warm — never worse than before
    }
}

/**
 * Bind a private warm target (from {@link createWarmRenderTarget}) plus the scene pass's MRT, so
 * a following SYNCHRONOUS `renderer.render()` compiles the pipelines the chapter uses live. Safe
 * while the rAF loop is running, which is the whole point — the render, bind and restore all
 * happen inside one synchronous task, so the live loop can never observe the binding. (This is
 * the render-warm path; it must NOT be used to wrap an r185 compileAsync, whose deferred builds
 * outlive any synchronous binding — see the file header.) Restore with
 * {@link endPostTargetCompile}.
 * @param {object} renderer the renderer
 * @param {?object} warmTarget the private target
 * @param {?object} scenePass the post stack's scene pass (for its MRT configuration)
 * @returns {?{previousTarget: *, previousMRT: *}} saved state, or null when unavailable
 */
export function beginWarmTargetRender(renderer, warmTarget, scenePass) {
    if (!warmTarget
        || typeof renderer?.getMRT !== 'function'
        || typeof renderer?.setMRT !== 'function'
        || typeof renderer?.getRenderTarget !== 'function') {
        return null;
    }
    const previousTarget = renderer.getRenderTarget();
    const previousMRT = renderer.getMRT();
    renderer.setRenderTarget(warmTarget);
    renderer.setMRT(scenePass?.getMRT?.() ?? null);
    // The warm render is synchronous, so the context-depth patch is scoped to this one call
    // (see beginNestedContextDepth): without it the warm render resolves the depth-0 context and
    // re-creates every pipeline the depth-1 live pass already has (52 sync creations, measured).
    return { previousTarget, previousMRT, restoreContexts: beginNestedContextDepth(renderer) };
}

/**
 * Restore the renderer state captured by {@link beginPostTargetCompile}.
 * @param {object} renderer the renderer
 * @param {?{previousTarget: *, previousMRT: *}} saved state returned by beginPostTargetCompile
 */
export function endPostTargetCompile(renderer, saved) {
    if (!saved) return;
    saved.restoreContexts?.();
    renderer.setRenderTarget(saved.previousTarget);
    renderer.setMRT(saved.previousMRT);
}

/**
 * Refcounted post-target binding sessions, one per renderer. The startup compile pool launches
 * several compileGroupThroughPost calls CONCURRENTLY (barrier later); they must share ONE binding
 * — the first acquire binds and records the true previous state, later acquires join, and only
 * the final release restores. Without this, overlapped holds would save each other's bound state
 * and the last-resolving compile could leave the scene-pass target bound after the pool drains.
 */
const _compileSessions = new WeakMap();

function acquireCompileBinding(renderer, postProcessingStack) {
    const existing = _compileSessions.get(renderer);
    if (existing) {
        existing.count += 1;
        return existing;
    }
    const saved = beginPostTargetCompile(renderer, postProcessingStack, false);
    if (!saved) return null;
    const session = { saved, count: 1, restoreContexts: beginNestedContextDepth(renderer) };
    _compileSessions.set(renderer, session);
    return session;
}

function releaseCompileBinding(renderer, session) {
    if (!session) return;
    session.count -= 1;
    if (session.count > 0) return;
    _compileSessions.delete(renderer);
    session.restoreContexts?.();
    endPostTargetCompile(renderer, session.saved);
}

/**
 * The call depth the post scene pass renders at: `Renderer._callDepth` starts at -1, every
 * `_renderScene` increments it on entry, and the scene pass runs NESTED inside
 * `RenderPipeline.render()` — depth 1 — while `compileAsync` resolves its render context at the
 * default depth 0.
 */
export const POST_SCENE_PASS_CALL_DEPTH = 1;

/**
 * Make every render context resolved during the compile session the one the LIVE post scene pass
 * uses.
 *
 * WHY (measured 2026-08-21 with the per-pipeline instrument, once the light-set churn of plan
 * item 2.9 was gone): `RenderContexts.get(renderTarget, mrt, callDepth)` keys contexts by
 * attachment state + MRT + call depth, and every builder state is keyed by its context id
 * (`RenderObject.getMaterialCacheKey`, r185:835). The prewarm resolved context
 * `1:1023:1016:4:true:false-default-0` (id 0); the scene pass inside the RenderPipeline renders in
 * `…-default-1` (id 2). Same attachments, same lights, same everything — different id — so the
 * first live post frame re-built and re-created all ~50 visible pipelines synchronously (a
 * 1.5 s frame). The private-target warm-up render (depth 0) had been hitting the prewarm's
 * states, which is why the problem only showed on the live frame. Forcing depth-0 requests to
 * depth 1 while a session is open makes the prewarm build exactly the states the live frame
 * reuses. Restored when the last pooled compile releases. Pinned by a contract test reading the
 * installed three source.
 * @param {object} renderer the renderer
 * @returns {?() => void} restore function, or null when the private map is not where r185 keeps it
 */
export function beginNestedContextDepth(renderer) {
    const contexts = renderer?._renderContexts;
    if (!contexts || typeof contexts.get !== 'function' || contexts.__odysseyDepthPatched) return null;
    const originalGet = contexts.get;
    contexts.get = function patchedGet(renderTarget = null, mrt = null, callDepth = 0) {
        return originalGet.call(this, renderTarget, mrt, callDepth === 0 ? POST_SCENE_PASS_CALL_DEPTH : callDepth);
    };
    contexts.__odysseyDepthPatched = true;
    return () => {
        contexts.get = originalGet;
        delete contexts.__odysseyDepthPatched;
    };
}

/**
 * Compile one group with the post target bound — held for the ENTIRE compile (r185 contract, see
 * the file header) — restoring renderer state after the last concurrent compile resolves.
 *
 * While the render loop is live and post is active this SKIPS the compile and resolves `false`:
 * r185's deferred builds read drifting global target/MRT under a live loop and poison the
 * MRT-agnostic builder cache, so there is no safe background compileAsync — callers must leave
 * live-loop warming to the private-target render-warm. (With post INACTIVE a bare compile stays
 * safe on a live loop: no MRT exists to poison, matching direct-to-canvas rendering.)
 *
 * @param {object} renderer the renderer
 * @param {?object} postProcessingStack the post stack
 * @param {object} scene the scene
 * @param {object} camera the camera
 * @param {object} group the chapter group to compile
 * @param {boolean} [renderLoopActive] when true + post active, the compile is skipped entirely.
 * @param {{concurrency?: number}} [options] fan-out width (default {@link DEFAULT_COMPILE_CONCURRENCY})
 * @returns {Promise<boolean>} true when a compile ran, false when skipped (live loop + post)
 */
export async function compileGroupThroughPost(
    renderer,
    postProcessingStack,
    scene,
    camera,
    group,
    renderLoopActive = false,
    options = {},
) {
    const postActive = !!postProcessingStack?.scenePass?.renderTarget;
    if (renderLoopActive && postActive) return false;

    // ARGUMENT ORDER (three's contract, Renderer.js JSDoc): `compileAsync(objectToCompile,
    // camera, targetScene)` — the FIRST argument is projected into the render list, the THIRD
    // supplies lights, background and the render-list/cache key. This call was inverted
    // (`scene, camera, group`) from r181 through 2026-08-21: every "targeted" prewarm walked
    // the WHOLE scene and took lights/background from a Group (whose `background` is
    // undefined — the `background.isColor` TypeError first blamed on r185 was this misuse).
    // Cheap on r181 (sync build, cache hits); on r185's per-object yielding loop the four
    // concurrent whole-scene walks cost seconds (corridor/breach/one-world "compiles" of
    // identical length regardless of group size were the tell).
    if (typeof renderer?.compileAsync !== 'function') {
        if (typeof renderer?.compile === 'function') renderer.compile(group, camera, scene);
        return true;
    }

    const session = renderLoopActive ? null : acquireCompileBinding(renderer, postProcessingStack);
    const releaseSideCapture = beginDeferredSideCapture(renderer);
    try {
        await compileObjectsFannedOut(renderer, scene, camera, group, options.concurrency);
    } finally {
        releaseSideCapture?.();
        releaseCompileBinding(renderer, session);
    }
    return true;
}

/**
 * r185 `compileAsync` regression, worked around for the duration of a compile
 * (upstream: Renderer.js `_createObjectPipeline` / the deferred drain in `compileAsync`).
 *
 * WHAT (measured 2026-08-21 with the renderer-level key trace, after the context-depth and
 * light-set fixes): every pipeline the prewarm built for a transparent DoubleSide material was
 * still re-created on the first live frame — identical programs, identical dynamic key, ONE field
 * of the backend key different: `material.side` 2 at compile time vs 1 then 0 live. The live
 * renderer draws such materials in two passes (`_renderTransparents` / `renderObject`: side =
 * BackSide for pass id 'backSide', FrontSide for the default pass, then DoubleSide restored).
 * r181 built pipelines synchronously inside those calls, so the side was right. r185's
 * `_createObjectPipeline` instead pushes a work item `{ object, material, …, passId }` and
 * compileAsync drains the queue AFTER the render-list walk has restored `side = DoubleSide` — both
 * queued passes compile one DoubleSide pipeline the live path never uses, and the real pair is
 * created synchronously on the first visible frame (45 sync creations, a 0.5–1.5 s stall).
 *
 * FIX: while a compile runs, `_createObjectPipeline` queues an item whose `material` property is a
 * getter that re-applies the side captured at queue time the moment the drain reads the item
 * (`this._objects.get(item.object, item.material, …)` is the first thing it does), and
 * `Pipelines.getForRender` restores the material's pre-drain side once the pipeline has been
 * requested (the drain passes a promise array; live renders do not, and are left alone). Every
 * other field of the item is exactly what three pushes today, so the drain is unchanged.
 * @param {object} renderer
 * @returns {?Function} restore, or null when this renderer has no deferred compile path
 */
export function beginDeferredSideCapture(renderer) {
    if (!renderer || typeof renderer._createObjectPipeline !== 'function') return null;
    if (renderer.__odysseySideCapture) {
        renderer.__odysseySideCapture.count += 1;
        return renderer.__odysseySideCapture.release;
    }
    const pipelines = renderer._pipelines;
    const originalCreate = renderer._createObjectPipeline;
    const originalGetForRender = pipelines?.getForRender;
    /** @type {Map<object, number>} material → side to restore once its drained item is built */
    const pending = new Map();
    renderer._createObjectPipeline = function odysseyCreateObjectPipeline(object, material, scene, camera, lightsNode, group, clippingContext, passId) {
        if (!Array.isArray(this._compilationPromises) || !material) {
            return originalCreate.call(this, object, material, scene, camera, lightsNode, group, clippingContext, passId);
        }
        const { side } = material;
        this._compilationPromises.push({
            object,
            scene,
            camera,
            lightsNode,
            group,
            clippingContext,
            passId,
            renderContext: this._currentRenderContext,
            get material() {
                if (!pending.has(material)) pending.set(material, material.side);
                if (material.side !== side) material.side = side;
                return material;
            },
        });
        return undefined;
    };
    if (pipelines && typeof originalGetForRender === 'function') {
        pipelines.getForRender = function odysseyGetForRender(renderObject, promises) {
            try {
                return originalGetForRender.call(this, renderObject, promises);
            } finally {
                const material = renderObject?.material;
                if (Array.isArray(promises) && material && pending.has(material)) {
                    material.side = pending.get(material);
                    pending.delete(material);
                }
            }
        };
    }
    const state = {
        count: 1,
        release: () => {
            state.count -= 1;
            if (state.count > 0) return;
            renderer._createObjectPipeline = originalCreate;
            if (pipelines && typeof originalGetForRender === 'function') pipelines.getForRender = originalGetForRender;
            for (const [material, side] of pending) material.side = side;
            pending.clear();
            delete renderer.__odysseySideCapture;
        },
    };
    renderer.__odysseySideCapture = state;
    return state.release;
}

/**
 * Default fan-out width for {@link compileGroupThroughPost}. Measured 2026-08-21 (RTX 3070,
 * Electron 38, cold Dawn cache): the Earth Core group compiled as ONE targeted call serialised
 * its pipelines (lake 1.65 s + 0.8 + 0.46 + 0.44 + 0.37 … = 5.4 s); the same objects through a
 * pool overlap in Dawn. Kept modest: each concurrent call costs duplicate JS node builds for any
 * material that is mid-build in another worker (pipelines and shader modules dedupe by cache
 * key; builder states only dedupe once set), which the by-material grouping below avoids.
 */
export const DEFAULT_COMPILE_CONCURRENCY = 6;

/** three's `DoubleSide` constant (kept numeric: this module has no three import on purpose). */
const DOUBLE_SIDE = 2;

/**
 * Compile a group's renderables through a small concurrent pool of targeted
 * `compileAsync(object, camera, scene)` calls.
 *
 * WHY: r185's compileAsync awaits each object's pipeline creation before moving to the next
 * (Renderer.js deferred loop, `await Promise.all(pipelinePromises)` per object; r181 awaited once
 * at the end), so one call keeps at most ONE `createRenderPipelineAsync` in flight and a chapter
 * compiles as the SUM of its shader compile times. The repo's old inverted call
 * (`compileAsync(scene, camera, group)`) had hidden this: four whole-scene walks drained the same
 * object list concurrently, i.e. ~4 pipelines in flight by accident. The fan-out restores that
 * parallelism on purpose, with the public API only.
 *
 * Objects are bucketed by three's OWN builder-cache identity (`RenderObject.getMaterialCacheKey`,
 * r185): the material instance's properties, the vertex layout, `receiveShadow`, the skeleton — and,
 * for an InstancedMesh / `count > 1` / BatchedMesh, the OBJECT's uuid (RenderObject.js:833), so
 * every instanced object owns a distinct builder state no matter what it shares. One representative
 * per bucket is therefore exact for plain meshes sharing a material instance + layout, and every
 * instanced object is its own bucket. Getting this wrong in either direction was measured:
 * collapsing the One World forest's 40 instanced chunks (40 material instances of one program) to
 * one call moved 39 node builds onto the first frames (load p99 344 → 2,820 ms); compiling all 50
 * world objects individually cost ~22 ms of compileAsync overhead per cache-hit call. Objects
 * without a material (groups, lights, cameras) are skipped — they are not renderables; an object
 * whose `traverse` is absent (unit-test doubles) compiles as one call.
 */
/** Vertex-layout part of the pipeline key: attribute names + item sizes + index presence. */
function attributeSignatureOf(geometry) {
    const attributes = geometry?.attributes;
    if (!attributes) return '';
    const parts = Object.keys(attributes).sort().map((name) => {
        const attribute = attributes[name];
        const instanced = attribute?.isInstancedBufferAttribute || attribute?.isInstancedInterleavedBufferAttribute;
        const kind = instanced ? 'I' : 'A';
        return `${name}:${attribute?.itemSize ?? '?'}${kind}`;
    });
    return `${parts.join(',')}${geometry.index ? '#idx' : ''}`;
}

export async function compileObjectsFannedOut(
    renderer,
    scene,
    camera,
    group,
    concurrency = DEFAULT_COMPILE_CONCURRENCY,
) {
    if (!group || typeof group.traverse !== 'function') {
        await renderer.compileAsync(group, camera, scene);
        return 1;
    }
    const byMaterial = new Map();
    group.traverse((object) => {
        if (!(object.isMesh || object.isPoints || object.isSprite || object.isLine) || !object.material) return;
        if (object.visible === false) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const identity = materials.map((m) => String(m.uuid ?? m.id ?? m)).join('|');
        // Instanced / multi-draw / batched / skinned objects own their builder state (three keys
        // it on the object) — never share a representative across them.
        const perObject = object.isInstancedMesh || object.isBatchedMesh || object.isSkinnedMesh
            || (typeof object.count === 'number' && object.count > 1);
        const owner = perObject ? `|obj:${object.uuid ?? object.id ?? Math.random()}` : '';
        const key = `${identity}${object.receiveShadow ? '|rs' : ''}|${attributeSignatureOf(object.geometry)}${owner}`;
        let bucket = byMaterial.get(key);
        if (!bucket) {
            bucket = [];
            byMaterial.set(key, bucket);
        }
        bucket.push(object);
    });
    // Buckets that share a TWO-PASS material instance (transparent + DoubleSide, not
    // forceSinglePass — the only materials whose `side` three mutates during the walk) run one
    // after the other, never concurrently: the deferred-side capture above re-applies
    // `material.side` per drained item, the node build yields mid-way (buildAsync), and two
    // interleaved drains of one such material with different sides would race it. Every other
    // material's captured side is constant, so its buckets stay fully parallel — serialising ALL
    // same-instance buckets was measured at one-world 1.26 → 4.72 s (its opaque instanced forest).
    const byInstance = new Map();
    let chainId = 0;
    for (const [key, bucket] of byMaterial) {
        const materials = Array.isArray(bucket[0].material) ? bucket[0].material : [bucket[0].material];
        const twoPass = materials.some((m) => m && m.transparent === true && m.side === DOUBLE_SIDE && m.forceSinglePass !== true);
        chainId += 1;
        const instance = twoPass ? key.split('|')[0] : `#${chainId}`;
        let chain = byInstance.get(instance);
        if (!chain) {
            chain = [];
            byInstance.set(instance, chain);
        }
        chain.push(bucket);
    }
    const queue = [...byInstance.values()];
    if (queue.length === 0) {
        // Nothing renderable under the group (or a group whose children are all hidden):
        // one plain call keeps three's own semantics for whatever is there.
        await renderer.compileAsync(group, camera, scene);
        return 1;
    }
    let calls = 0;
    const worker = async () => {
        while (queue.length > 0) {
            // ONE representative per bucket (see the bucket rule above): the first object's node
            // build + pipeline IS the others'. Each extra call would be a cache hit that still
            // pays ~22 ms of compileAsync overhead (render list, light traversal, background,
            // yields).
            const chain = queue.shift();
            for (const [object] of chain) {
                calls += 1;
                // eslint-disable-next-line no-await-in-loop
                await renderer.compileAsync(object, camera, scene);
            }
        }
    };
    const width = Math.max(1, Math.min(concurrency | 0 || 1, queue.length));
    await Promise.all(Array.from({ length: width }, worker));
    return calls;
}
