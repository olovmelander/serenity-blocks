import { waitForStartupThemeIdle } from './boot-warp-startup.js';

/**
 * Node-build budget per task for a theme built behind an ANIMATED cover (Odyssey's entry tunnel):
 * the tunnel draws on the same main thread at the display's rate (7.6 ms frames on the dev
 * laptop), so the builds get most of a frame and the tunnel the rest.
 */
export const COVERED_ENTRY_BUILD_BUDGET_MS = 5;

/**
 * Own async theme compilation for an overlay that controls its own lifecycle
 * (local multiplayer and Odyssey). Main's mode-entry overlay owns its lease there.
 * `buildBudgetMs` (see ThemeManager.beginLoadingSurface) is for a surface that waits for the
 * theme's pipelines to settle before it lifts.
 * @param {any} themeManager
 * @param {{ buildBudgetMs?: number }} [options]
 */
export function createCinematicLoadingSurface(themeManager, { buildBudgetMs = 0 } = {}) {
    const release = (buildBudgetMs > 0
        ? themeManager?.beginLoadingSurface?.('cinematic-loading', { buildBudgetMs })
        : themeManager?.beginLoadingSurface?.('cinematic-loading')) || (() => {});
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
