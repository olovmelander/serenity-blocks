import { waitForStartupThemeIdle } from './boot-warp-startup.js';

/**
 * Own async theme compilation for an overlay that controls its own lifecycle
 * (local multiplayer and Odyssey). Main's mode-entry overlay owns its lease there.
 */
export function createCinematicLoadingSurface(themeManager) {
    const release = themeManager?.beginLoadingSurface?.('cinematic-loading') || (() => {});
    let closed = false;
    const ready = new Promise((resolve) => {
        const timer = setTimeout(resolve, 2000);
        Promise.resolve().then(() => themeManager?.preloadAsyncRenderPipelines?.())
            .catch(() => {})
            .finally(() => { clearTimeout(timer); resolve(); });
    });
    return {
        ready,
        cancel() {
            if (closed) return;
            closed = true;
            release();
        },
        uncover() {
            if (closed) return;
            closed = true;
            release.uncover?.();
            // Late streamed scenery keeps compiling async after the cover lifts.
            // New mode entries must acquire their own covering lease.
            waitForStartupThemeIdle(() => themeManager?.activeTheme || null, {
                maxWaitMs: 20000,
                stableMs: 1000,
            })
                .then(() => themeManager?.whenLoadingSurfacePipelinesSettled?.(5000))
                .catch(() => {})
                .finally(release);
        },
    };
}
