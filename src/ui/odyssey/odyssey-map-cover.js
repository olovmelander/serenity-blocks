// @ts-check
/**
 * The map stops drawing while an opaque sheet covers all of it (the navigator, the charm guide):
 * the board's frames go on updating and draw nothing, GPU work nobody would see. Both sheets fade
 * in, so the map draws on until the sheet's own entrance has finished; it draws the current frame
 * at once when the sheet goes (call the returned uncover before removing or hiding the sheet); and
 * the board asks on every covered frame whether the sheet is still shown, so a sheet taken away by
 * any other path never leaves the map undrawn (OdysseyBoardController.setCovered).
 */

/**
 * Whether `sheet` is on the page and shown.
 * @param {{isConnected?: boolean, style?: {display?: string}}|null|undefined} sheet
 * @returns {boolean}
 */
export function isSheetShown(sheet) {
    return Boolean(sheet && sheet.isConnected !== false && sheet.style?.display !== 'none');
}

/**
 * Resolves true once the sheet's own entrance animations have finished (at once without any, as
 * under Reduce motion), and false when one was cancelled or the page cannot say.
 * @param {{getAnimations?: () => Array<{finished: Promise<unknown>}>}} sheet
 * @returns {Promise<boolean>}
 */
function entranceFinished(sheet) {
    if (typeof sheet?.getAnimations !== 'function') return Promise.resolve(false);
    let animations;
    try {
        animations = sheet.getAnimations();
    } catch {
        return Promise.resolve(false);
    }
    return Promise.all(animations.map((animation) => animation.finished)).then(() => true, () => false);
}

/**
 * Cover the mode's map with `sheet` once the sheet is opaque.
 * @param {{boardController?: {setCovered?: Function}|null}} mode
 * @param {HTMLElement} sheet a fixed, opaque element over the whole viewport
 * @returns {() => void} uncover: the map draws again at once
 */
export function coverOdysseyMapWith(mode, sheet) {
    let open = true;
    // The board the sheet covered, not whichever one the mode holds when the sheet goes.
    let covered = null;
    entranceFinished(sheet).then((finished) => {
        if (!open || !finished || !isSheetShown(sheet)) return;
        covered = mode?.boardController ?? null;
        covered?.setCovered?.(sheet, true, () => isSheetShown(sheet));
    });
    return () => {
        if (!open) return;
        open = false;
        covered?.setCovered?.(sheet, false);
        covered = null;
    };
}
