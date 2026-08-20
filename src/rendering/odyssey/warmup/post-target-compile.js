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
 * @returns {?{previousTarget: *, previousMRT: *}} saved state, or null when post is inactive
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
    return { previousTarget, previousMRT };
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
    return { previousTarget, previousMRT };
}

/**
 * Restore the renderer state captured by {@link beginPostTargetCompile}.
 * @param {object} renderer the renderer
 * @param {?{previousTarget: *, previousMRT: *}} saved state returned by beginPostTargetCompile
 */
export function endPostTargetCompile(renderer, saved) {
    if (!saved) return;
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
    const session = { saved, count: 1 };
    _compileSessions.set(renderer, session);
    return session;
}

function releaseCompileBinding(renderer, session) {
    if (!session) return;
    session.count -= 1;
    if (session.count > 0) return;
    _compileSessions.delete(renderer);
    endPostTargetCompile(renderer, session.saved);
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
 * @returns {Promise<boolean>} true when a compile ran, false when skipped (live loop + post)
 */
export async function compileGroupThroughPost(
    renderer,
    postProcessingStack,
    scene,
    camera,
    group,
    renderLoopActive = false,
) {
    const postActive = !!postProcessingStack?.scenePass?.renderTarget;
    if (renderLoopActive && postActive) return false;

    if (typeof renderer?.compileAsync !== 'function') {
        if (typeof renderer?.compile === 'function') renderer.compile(scene, camera, group);
        return true;
    }

    // r185 upstream bug (caught by the 2026-08-20 capture matrix): with a target
    // group, compileAsync routes `_background.update(targetScene, ...)` at the
    // GROUP (Renderer.js:1005-1007), and Background.update guards `=== null`
    // while a Group's `background` is UNDEFINED — `background.isColor` then
    // TypeErrors and the swallowing catch silently voids every chapter prewarm
    // (r181 always used the real scene here). Mirror Scene's `background = null`
    // default onto the group so the null branch is taken.
    if (group && typeof group === 'object' && group.background === undefined) {
        group.background = null;
    }

    const session = renderLoopActive ? null : acquireCompileBinding(renderer, postProcessingStack);
    try {
        await renderer.compileAsync(scene, camera, group);
    } finally {
        releaseCompileBinding(renderer, session);
    }
    return true;
}
