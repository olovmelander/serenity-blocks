/**
 * @fileoverview Post-target compile mechanics for Odyssey warm-up.
 *
 * Extracted from OdysseyBoardController (masterplan E2 — decompose the warm-up/seam orchestration
 * out of the 2,800-line board god object). These are the most self-contained pieces of the warm-up:
 * pure renderer/render-target manipulation with no board state, so they lift cleanly into reusable,
 * testable functions. The board keeps thin wrappers so every internal caller is unchanged.
 *
 * WHY the post target is bound before compileAsync: the chapters always render THROUGH the post
 * PassNode's HalfFloat/MRT scene-pass target, and `Renderer.compileAsync` captures the currently
 * bound render context (target + MRT) in its synchronous phase. Binding the scene-pass target here
 * makes compileAsync build the pipelines the chapter ACTUALLY uses live; without it, canvas-format
 * pipelines were built that the post path never used, so the REAL pipelines compiled synchronously
 * inside the warm-up renders — the loading-screen freeze.
 *
 * ...AND WHY IT IS ONLY SAFE BEFORE THE RENDER LOOP STARTS (2026-08-12, crash fix).
 * `compileAsync` opens its own render pass on whatever target is bound. Do that while the rAF loop
 * is also rendering the post graph and both touch the SAME scene-pass target inside one command
 * encoder — the graph SAMPLES `output` while the compile pass has it attached for writing:
 *
 *   [Texture "output"] usage (TextureBinding|RenderAttachment) includes writable usage and
 *   another usage in the same synchronization scope
 *
 * WebGPU then refuses to create the pipeline, `getForRender` hands back undefined, and the very
 * next draw throws `setPipeline: parameter 1 is not of type 'GPURenderPipeline'`. From there the
 * device is poisoned: every subsequent frame re-emits the usage error plus an invalid-CommandBuffer
 * error, forever. It reproduces as soon as chapters are prewarmed in the BACKGROUND (after the loop
 * is live) rather than during startup.
 *
 * So the target binding is conditional on the loop being idle.
 *
 * ...AND HOW THE BACKGROUND PATH GOT ITS OPTIMISATION BACK (2026-08-17).
 * The fallback above — a plain compileAsync building CANVAS-format pipelines — meant background
 * chapters never had their post-format pipelines built asynchronously. Those compiled
 * SYNCHRONOUSLY inside the later render-warm instead, measured at 482-560ms per chapter, landing
 * as a visible hitch wherever the sweep happened to reach. The hazard was never "a render target"
 * — it was specifically the SHARED scene-pass target. A PRIVATE, format-matched target (see
 * {@link createWarmRenderTarget}) cannot alias anything the live graph touches, so both the
 * background compile and the render-warm can bind it while the loop runs, and both build exactly
 * the pipelines the live post path uses (the pipeline cache key is format-based — see that
 * function's docs). Startup keeps the exact scene-pass binding; only the live-loop path uses the
 * private clone.
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
 * a following `renderer.render()` compiles the pipelines the chapter uses live. Safe while the
 * rAF loop is running, which is the whole point. Restore with {@link endPostTargetCompile}.
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
 * Launch a targeted compileAsync for one group with the post target bound for its synchronous
 * context-capture phase, restoring renderer state immediately after (the returned promise resolves
 * later, off the main thread — safe to pool in parallel).
 * @param {object} renderer the renderer
 * @param {?object} postProcessingStack the post stack
 * @param {object} scene the scene
 * @param {object} camera the camera
 * @param {object} group the chapter group to compile
 * @param {boolean} [renderLoopActive] when true the post target is not bound — see the file header.
 * @returns {Promise<void>} resolves when the group's pipelines are compiled
 */
export function compileGroupThroughPost(
    renderer,
    postProcessingStack,
    scene,
    camera,
    group,
    renderLoopActive = false,
    warmTarget = null,
) {
    // Under a live loop the scene-pass target is off limits, but a PRIVATE format-matched target
    // is not — and using it here is what makes a background compile actually async. Without it
    // the background path fell back to a plain compileAsync, which captures the CANVAS format, so
    // the post-format pipelines were never built asynchronously and instead compiled SYNCHRONOUSLY
    // inside the later render-warm (measured at 482-560ms per chapter, landing as a visible hitch
    // wherever the sweep happened to reach). Same formats => same pipeline cache key, so this
    // builds exactly the pipelines the live post path uses, off the main thread.
    const saved = beginPostTargetCompile(renderer, postProcessingStack, renderLoopActive)
        || beginWarmTargetRender(renderer, warmTarget, postProcessingStack?.scenePass);
    try {
        if (typeof renderer.compileAsync === 'function') {
            return renderer.compileAsync(scene, camera, group);
        }
        if (typeof renderer.compile === 'function') {
            renderer.compile(scene, camera, group);
        }
        return Promise.resolve();
    } finally {
        // compileAsync captures its render context (incl. the bound target) in its synchronous
        // phase — restoring here cannot affect the in-flight compile.
        endPostTargetCompile(renderer, saved);
    }
}
