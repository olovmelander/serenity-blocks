/**
 * Startup warm helpers (app boot, 2026-08-21) — extracted from main.js so the boot
 * choreography can grow without the god-file (plan §3d line ceiling) growing with it.
 * Both helpers are inert outside a browser and never throw into the boot path.
 */
import { performanceMonitor } from './performance-monitor.js';

/**
 * Request the `three/webgpu` chunk as the FIRST thing bootstrap does.
 *
 * three (1.75 MB) is no longer on the menu's static boot path — the chunk graph had been
 * welding it there through absorbed shared modules (vite.config.js). Every mode and every
 * WebGPU theme needs it, so its chunk is fetched and compiled off the main thread and
 * evaluates whenever it lands — during init, as before — so a click the instant the menu
 * appears never pays it serially. `?noThreeWarm=1` opts out (A/B: menu-first vs mode-first).
 * The dynamic import keeps three OUT of main's static closure (scripts/check-boot-closure.mjs).
 */
export function warmThreeEarly() {
    if (typeof window === 'undefined') return;
    try {
        if (new URLSearchParams(window.location?.search || '').get('noThreeWarm') === '1') return;
    } catch { /* no location */ }
    const start = performance.now();
    import('three/webgpu').then(() => {
        performanceMonitor.recordEvent('startup_three_warmed', { ms: Math.round(performance.now() - start) });
    }).catch((error) => {
        console.warn('[Startup] three warm failed (a mode will load it on demand):', error?.message || error);
    });
}

/**
 * Wait (bounded) while the active Odyssey board is still background-building, so the
 * first-entry theme warm-up does not compile a second WebGPU scene on top of it.
 *
 * If the player went straight into Odyssey, its board is background-building chapters and
 * compiling their shaders for the first ~20s after reveal. Warming a SECOND WebGPU scene
 * concurrently doubles up the exact contention that shows as multi-second mid-play freezes
 * (profiled 2026-08-17: a conserved ~3-4s of session work landing on whichever compile await
 * was open). Yield the window: wait for the board's pipeline to go quiet, capped so this can
 * never hang the warm forever. Skipping the warm entirely would also be safe — the
 * loading-overlay resume safety-net makes an unwarmed first entry identical to the no-warm path.
 *
 * Resolves immediately when the current mode is not Odyssey, when the mode cannot report
 * quiet, or once it does.
 * @param {{ getCurrentModeId?: Function, getCurrentMode?: Function } | null | undefined} gameModeManager
 * @param {number} [maxWaitMs] hard cap on the wait
 * @returns {Promise<void>}
 */
export async function deferThemeWarmWhileOdysseyLoads(gameModeManager, maxWaitMs = 25000) {
    const startedAt = Date.now();
    for (;;) {
        if (gameModeManager?.getCurrentModeId?.() !== 'odyssey') return;
        const mode = gameModeManager?.getCurrentMode?.();
        if (typeof mode?.isBackgroundPipelineQuiet !== 'function') return;
        if (mode.isBackgroundPipelineQuiet()) return;
        if (Date.now() - startedAt > maxWaitMs) return;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setTimeout(resolve, 500); });
    }
}
