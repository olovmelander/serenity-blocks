/**
 * Behavioral release-observability seams (remediation plan Phase 3b).
 *
 * Kept outside main.js so the packaging gate can execute the actual preload
 * recovery and runtime-validation behavior without booting the whole app.
 */

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const defaultWait = (delayMs) => new Promise((resolve) => {
    setTimeout(resolve, delayMs);
});

/**
 * Observe Vite dynamic-import failures without taking ownership away from the
 * importer. ThemeManager owns a bounded retry and fallback policy; preventing
 * the event makes Vite resolve the failed import as `undefined`, while reloading
 * here destroys a live game session. Let the import promise reject so its caller
 * can recover without a page reload.
 *
 * @param {{
 *   windowRef?: Window,
 *   logError?: (...args: any[]) => void,
 * }} [options]
 * @returns {() => void} cleanup
 */
export function installPreloadErrorRecovery({
    windowRef = typeof window !== 'undefined' ? window : null,
    logError = (...args) => console.error(...args),
} = {}) {
    if (!windowRef?.addEventListener) return () => {};

    const handlePreloadError = (event) => {
        logError('[BuildResilience] Dynamic preload failed; delegating to importer recovery:', event?.payload || event);
    };

    windowRef.addEventListener('vite:preloadError', handlePreloadError);
    return () => windowRef.removeEventListener?.('vite:preloadError', handlePreloadError);
}

/**
 * Create the developer/runtime validation API installed on window.
 *
 * @param {{
 *   themeManager?: any,
 *   performanceMonitor: {getReleaseGateSnapshot: () => any},
 *   storeDesktopBenchmark?: (stage: string, extra: object) => Promise<any>,
 *   now?: () => number,
 *   wait?: (delayMs: number) => Promise<void>,
 * }} options
 */
export function createRuntimeValidation({
    themeManager = null,
    performanceMonitor,
    storeDesktopBenchmark = async () => null,
    now = defaultNow,
    wait = defaultWait,
}) {
    const getReleaseGates = () => performanceMonitor.getReleaseGateSnapshot();

    return {
        runThemeSwitchSoak: async ({
            themes = null,
            iterations = 20,
            delayMs = 250,
        } = {}) => {
            const cycleThemes = themes || themeManager?.getAvailableThemes?.() || [];
            const startedAt = now();

            for (let i = 0; i < iterations; i += 1) {
                const themeName = cycleThemes[i % cycleThemes.length];
                if (!themeName) break;
                // Sequential by design: overlapping theme lifecycles would make
                // the soak test a transition-race generator instead of a gate.
                // eslint-disable-next-line no-await-in-loop
                await themeManager.switchTheme(themeName);
                // eslint-disable-next-line no-await-in-loop
                await wait(delayMs);
            }

            const summary = {
                iterations,
                elapsedMs: now() - startedAt,
                releaseGates: getReleaseGates(),
            };
            console.log('[RuntimeValidation] Theme switch soak complete', summary);
            return summary;
        },
        getReleaseGates,
        captureDesktopBenchmark: async (stage = 'manual-benchmark', extra = {}) => {
            const normalizedStage = typeof stage === 'string' && stage.trim()
                ? stage.trim()
                : 'manual-benchmark';
            const report = await storeDesktopBenchmark(normalizedStage, extra);
            return {
                stage: normalizedStage,
                report,
                releaseGates: getReleaseGates(),
            };
        },
    };
}
