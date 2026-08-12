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
 * So the target binding is now conditional on the loop being idle. Background compiles fall back to
 * a plain compileAsync: they build canvas-format pipelines, so those chapters may still pay a small
 * first-visit compile — a hitch, which is what this optimisation existed to remove, but a hitch is
 * strictly better than a dead device, and the startup path (where the freeze actually hurt) keeps
 * the optimisation in full.
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
) {
    const saved = beginPostTargetCompile(renderer, postProcessingStack, renderLoopActive);
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
