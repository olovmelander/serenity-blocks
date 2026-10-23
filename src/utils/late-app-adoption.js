// @ts-check
/**
 * The startup watchdog (45 s, startup-pipeline-state-machine.js) opens a degraded menu when the
 * game's init stalls, and the boot goes on without the app. Nothing that needs the app ran after
 * that, even when the init finished a moment later: no Steam, no save flush on quit, no deferred
 * services, no menu stats, for the whole session. main.js wires such an app when it arrives.
 */

/**
 * Call `adopt` once with the app the stalled init produces; an init that fails leaves the
 * degraded menu as it is (and is not an unhandled rejection).
 * @template T
 * @param {Promise<T | null | undefined>} appInitPromise
 * @param {(app: T) => void} adopt
 * @returns {Promise<void>}
 */
export function adoptLateApp(appInitPromise, adopt) {
    return Promise.resolve(appInitPromise).then((app) => {
        if (app) adopt(app);
    }, (error) => {
        console.warn('[Startup] The stalled init failed after the degraded menu:', error);
    });
}
