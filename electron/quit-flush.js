/**
 * Before the game window closes, the main process asks the renderer to finish its saves
 * and waits for the answer for at most QUIT_FLUSH_TIMEOUT_MS (audit LIFE-14, R-02 step 4).
 * Quitting used to tear the page down while that async work was still running, cutting
 * off the run's demo autosave, the Odyssey session save and Steam Cloud uploads still
 * waiting out their debounce. The renderer side is src/utils/page-teardown.js; the
 * preload answers at once when the game has not registered a handler yet.
 */
export const QUIT_FLUSH_TIMEOUT_MS = 2000;
export const PREPARE_QUIT_CHANNEL = 'desktop:prepare-quit';
export const QUIT_READY_CHANNEL = 'desktop:quit-ready';

let lastRequestId = 0;

/**
 * @param {{
 *   ipc: { on: Function, removeListener: Function },
 *   webContents: { send: (channel: string, requestId: number) => void },
 *   timeoutMs?: number,
 * }} options
 * @returns {Promise<'flushed' | 'timed-out' | 'unavailable'>}
 */
export function requestRendererQuitFlush({ ipc, webContents, timeoutMs = QUIT_FLUSH_TIMEOUT_MS }) {
    lastRequestId += 1;
    const requestId = lastRequestId;
    return new Promise((resolve) => {
        let timer = null;
        let onReady = null;
        const finish = (outcome) => {
            clearTimeout(timer);
            ipc.removeListener(QUIT_READY_CHANNEL, onReady);
            resolve(outcome);
        };
        onReady = (event, answeredId) => {
            if (event?.sender === webContents && answeredId === requestId) finish('flushed');
        };
        ipc.on(QUIT_READY_CHANNEL, onReady);
        timer = setTimeout(() => finish('timed-out'), timeoutMs);
        try {
            webContents.send(PREPARE_QUIT_CHANNEL, requestId);
        } catch {
            finish('unavailable');
        }
    });
}
