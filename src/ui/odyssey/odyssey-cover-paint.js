// @ts-check
/**
 * Paint under the portal gate's cover. The gate draws in a worker and keeps moving while the
 * page works, so the page is cheapest to paint for the first time while the gate still covers
 * it: the frames the gate then opens on show surfaces that are already painted, instead of
 * paying their style, layout and raster on the most watched frames of an orb entry or return.
 *
 * Nothing here changes what the player sees: a surface painted under the cover sits at
 * COVER_PAINT_OPACITY (indistinguishable from 0) until the reveal fades it up from there.
 */

/**
 * The opacity a surface waits at, painted, under the cover. Not 0: the compositor need not
 * keep the tiles of a layer that draws nothing, and the reveal would raster them again.
 */
export const COVER_PAINT_OPACITY = 0.001;

/**
 * Resolve after `count` animation frames, or after `timeoutMs` whatever happens (an unseen
 * window runs no frames, and a cover must never hang on one).
 * @param {number} [count]
 * @param {{timeoutMs?: number, win?: {requestAnimationFrame?: Function, setTimeout?: Function, clearTimeout?: Function}}} [options]
 * @returns {Promise<void>}
 */
export function waitForAnimationFrames(count = 2, { timeoutMs = 120, win = globalThis } = {}) {
    const raf = typeof win?.requestAnimationFrame === 'function' ? win.requestAnimationFrame.bind(win) : null;
    const startTimer = typeof win?.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
    const stopTimer = typeof win?.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout;
    if (!raf || !(count > 0)) return Promise.resolve();
    return new Promise((resolve) => {
        let left = count;
        let done = false;
        let timer = null;
        const finish = () => {
            if (done) return;
            done = true;
            if (timer !== null) stopTimer(timer);
            resolve();
        };
        timer = startTimer(finish, timeoutMs);
        const step = () => {
            if (done) return;
            left -= 1;
            if (left <= 0) finish();
            else raf(step);
        };
        raf(step);
    });
}

/**
 * The surfaces an orb's reveal fades up, and what each will animate.
 * @param {Document|undefined} doc
 * @returns {Array<{element: HTMLElement, willChange: string}>}
 */
function gameplaySurfaces(doc) {
    if (!doc) return [];
    const statsBar = /** @type {HTMLElement|null} */ (doc.querySelector?.('.single-player-stats-bar') ?? null);
    return [
        { element: doc.getElementById?.('single-player-container'), willChange: 'opacity, transform' },
        { element: doc.getElementById?.('phaser-game-container'), willChange: 'opacity' },
        { element: statsBar, willChange: 'opacity' },
    ].filter((entry) => entry.element?.style);
}

/**
 * Entry: lay out and paint the well, the queue, the board canvas and the stats once beneath the
 * gate (they waited the whole hold at visibility:hidden, so the reveal's first frame painted
 * them), each on the layer its reveal will animate. The game container keeps the start scale
 * the hold set (`_prepareGameplayReveal`).
 * @param {Document} [doc]
 * @returns {HTMLElement[]} the surfaces now painted under the cover
 */
export function paintGameplaySurfacesUnderCover(doc = globalThis.document) {
    return gameplaySurfaces(doc).map(({ element, willChange }) => {
        element.style.willChange = willChange;
        element.style.visibility = 'visible';
        element.style.opacity = String(COVER_PAINT_OPACITY);
        if (element.classList?.contains?.('single-player-stats-bar')) {
            element.style.setProperty('display', 'flex', 'important');
        }
        return element;
    });
}

/**
 * Drop the layer hints once a reveal has finished with them (or never ran).
 * @param {Document} [doc]
 */
export function releaseGameplaySurfacesFromCover(doc = globalThis.document) {
    gameplaySurfaces(doc).forEach(({ element }) => {
        element.style.willChange = '';
    });
}
