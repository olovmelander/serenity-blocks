// @ts-check
/**
 * How the game page finishes its work before it goes away (audit LIFE-14, R-02 step 4).
 *
 * pagehide starts the app cleanup, but a desktop quit tore the page down before that
 * async work could finish: the run's demo autosave, the Odyssey session save and any
 * Steam Cloud upload still waiting out its debounce were lost. The desktop build now
 * asks first (electron/quit-flush.js) and closes the window once prepareForQuit()
 * settles, or after two seconds.
 */

/**
 * @param {{ cleanup: () => Promise<unknown>, cloudSyncManager?: { flushPendingUploads?: () => Promise<void> } | null }} app
 */
export async function prepareForQuit(app) {
    try {
        // Ends the mode first: the Odyssey save, the demo autosave and a pending settings
        // save each queue their Cloud upload on the way out.
        await app.cleanup();
    } catch (error) {
        console.warn('[Quit] Cleanup before quit failed:', error);
    }
    try {
        await app.cloudSyncManager?.flushPendingUploads?.();
    } catch (error) {
        console.warn('[Quit] Steam Cloud upload before quit failed:', error);
    }
}

/**
 * @param {{ cleanup: () => Promise<unknown>, cleanupHandlers: Array<() => void> }} app
 * @param {{ target?: Window, desktopApi?: { onPrepareQuit?: (prepare: () => Promise<void>) => void } }} [options]
 */
export function installPageTeardown(app, {
    target = window,
    desktopApi = /** @type {any} */ (window).electronAPI,
} = {}) {
    const handlePageHide = () => { app.cleanup(); };
    target.addEventListener('pagehide', handlePageHide);
    app.cleanupHandlers.push(() => target.removeEventListener('pagehide', handlePageHide));
    desktopApi?.onPrepareQuit?.(() => prepareForQuit(app));
}
