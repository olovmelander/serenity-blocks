/**
 * "Start a new journey" in the navigator: a two-step reset. The first press opens the
 * consequence (orbs, stars and charms erased; earned themes kept) beside the choice, and only
 * the second press erases. The mode owns the actual reset; this module owns the DOM.
 */

import { isOdysseyWorldInterlude } from './odyssey-world-return.js';

/**
 * Erase the campaign save and begin again at Orb 1. Earned themes stay in the collection,
 * which keeps its own store; the Chapter 1 arrival welcomes the new journey again.
 * @param {object} mode the active OdysseyMode, on its map
 * @returns {Promise<boolean>} whether the journey was reset
 */
export async function startOdysseyNewJourney(mode) {
    if (!mode?.isInBoardView || mode.isEnteringLevel || isOdysseyWorldInterlude(mode)) return false;
    mode.odysseyState.reset();
    mode.odysseyState.save();
    mode.selectedLevelId = 1;
    mode.boardController?.updateProgress?.(mode._buildOdysseyProgressData());
    mode._updateHeaderProgress();
    mode._updateLevelSelectUI(1);
    mode.closeOdysseyNavigator({ restoreBoardPreview: false });
    await mode._focusBoardLevelForLaunch(1, { updatePreview: true, settle: true });
    mode._offerFirstArrival();
    return true;
}

/**
 * @param {HTMLElement} root the navigator container holding the new-journey controls
 * @param {() => (Promise<unknown>|unknown)} onConfirm performs the reset
 * @returns {{ setOpen: (open: boolean) => void }|null} controls, or null without the markup
 */
export function wireOdysseyNewJourney(root, onConfirm) {
    const open = root?.querySelector?.('#odyssey-new-journey-btn');
    const panel = root?.querySelector?.('#odyssey-new-journey-confirm');
    const confirm = root?.querySelector?.('#odyssey-new-journey-confirm-btn');
    const cancel = root?.querySelector?.('#odyssey-new-journey-cancel-btn');
    if (!open || !panel || !confirm || !cancel) return null;

    const setOpen = (isOpen, { focus = true } = {}) => {
        panel.hidden = !isOpen;
        open.hidden = isOpen;
        open.setAttribute?.('aria-expanded', String(isOpen));
        if (focus) (isOpen ? cancel : open).focus?.({ preventScroll: true });
    };
    open.addEventListener('click', () => setOpen(true));
    cancel.addEventListener('click', () => setOpen(false));
    confirm.addEventListener('click', () => {
        if (confirm.disabled) return;
        confirm.disabled = true;
        // The reset starts on this press; the panel closes when it has settled either way.
        new Promise((resolve) => { resolve(onConfirm?.()); })
            .catch((error) => console.warn('[Odyssey] New journey could not start:', error))
            .finally(() => {
                confirm.disabled = false;
                setOpen(false, { focus: false });
            });
    });
    return { setOpen };
}
