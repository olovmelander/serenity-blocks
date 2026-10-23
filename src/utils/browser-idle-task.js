/**
 * Run a startup task once the browser is idle, after `delayMs`, or after `timeout` at the latest.
 * A failing task is logged, never thrown. Returns a cancel function.
 * @param {() => unknown} task
 * @param {{ delayMs?: number, timeout?: number }} [options]
 * @returns {() => void}
 */
export function scheduleBrowserIdleTask(task, { delayMs = 0, timeout = 2000 } = {}) {
    let timeoutId = null;
    let idleId = null;
    let cancelled = false;

    const runTask = () => {
        if (cancelled) {
            return;
        }

        idleId = null;
        timeoutId = null;
        Promise.resolve(task()).catch((error) => {
            console.warn('[Startup] Deferred task failed:', error);
        });
    };

    const startTask = () => {
        if (cancelled) {
            return;
        }

        timeoutId = null;

        if (typeof requestIdleCallback === 'function') {
            idleId = requestIdleCallback(runTask, { timeout });
            return;
        }

        timeoutId = setTimeout(runTask, 0);
    };

    timeoutId = setTimeout(startTask, delayMs);

    return () => {
        cancelled = true;
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        if (typeof cancelIdleCallback === 'function' && idleId !== null) {
            cancelIdleCallback(idleId);
            idleId = null;
        }
    };
}
