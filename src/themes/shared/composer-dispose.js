// @ts-check

/**
 * Dispose every pass held by a three EffectComposer.
 *
 * three r181's EffectComposer.dispose()
 * (three/addons/postprocessing/EffectComposer.js) frees only renderTarget1,
 * renderTarget2 and its internal copyPass — it does NOT iterate this.passes.
 * Passes added through addPass() / insertPass() (RenderPass, UnrealBloomPass,
 * ShaderPass, …) are therefore never disposed by composer.dispose() alone.
 *
 * Each such pass owns render targets and/or materials plus a fullscreen quad —
 * e.g. one UnrealBloomPass holds 11 render targets, 5 separable-blur materials
 * and a composite/blend/basic material (three/addons UnrealBloomPass.dispose()).
 * On a WebGPU theme's WebGL-fallback lane, nulling the pass references without
 * disposing them leaks that whole stack on every theme activation — the
 * WebGL-lane residual left open in PERFORMANCE_STABILITY_AUDIT.md SB-15.
 *
 * Call this immediately before composer.dispose(). Passes and composer.dispose()
 * are disjoint (copyPass is internal and not in the passes array), so there is
 * no double-disposal. Null-safe, tolerant of a passless composer, and safe
 * against passes whose base Pass.dispose() is a no-op.
 *
 * @param {{ passes?: Array<{ dispose?: () => void }> } | null | undefined} composer
 */
export function disposeComposerPasses(composer) {
    const passes = composer?.passes;
    if (!Array.isArray(passes)) return;
    for (const pass of passes) {
        try {
            pass?.dispose?.();
        } catch (error) {
            console.warn('[composer-dispose] pass dispose failed:', error);
        }
    }
}
