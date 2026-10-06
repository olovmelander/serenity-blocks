/**
 * @fileoverview Odyssey level-failed modal (Retry / Back to Map).
 *
 * Extracted verbatim from OdysseyMode._createFailureModal (masterplan E1). Pure DOM/view: it takes
 * the failure reason text + the attempt number + a single-fire choice callback, and returns the
 * modal element. The caller owns removing the modal (a retry keeps the dark backdrop up while the
 * board resets), so this never removes itself — it only detaches its own keydown listener on choice.
 */

import { appendKeyHint, createKeystoneSheet, el } from './keystone-sheet.js';

/**
 * Build the level-failed sheet.
 * @param {object} deps
 * @param {string} deps.reasonText human-readable failure reason ("Time ran out!" / "You topped out!")
 * @param {function('retry'|'map'):void} deps.onChoose single-fire; fired by button or keyboard
 * @param {?number} deps.attemptNumber current attempt (shows an "Attempt N" line when finite)
 * @param {boolean} [deps.includeLegacyResults=true] whether this attempt is persisted
 * @returns {HTMLElement} the modal root element (caller mounts + later removes it)
 */
export function createFailureModal({
    reasonText,
    onChoose,
    attemptNumber,
    includeLegacyResults = true,
}) {
    // Keystone sheet (keystone-overlays.css). A failed level is a pause for breath, not
    // an alarm: no red, the reason in plain words, Retry as the one primary action.
    const { modal, panel: content } = createKeystoneSheet({
        id: 'odyssey-failure-modal',
        label: 'Level failed',
        variant: 'failed',
    });

    // Attempt counter as the eyebrow (builds the "one more try" momentum)
    if (Number.isFinite(attemptNumber)) {
        content.appendChild(el('p', 'sb-eyebrow sb-ody-eyebrow', `Attempt ${attemptNumber}`));
    }
    content.appendChild(el('h2', 'sb-ody-title', String(reasonText || 'Level failed').replace(/!+$/, '.')));
    content.appendChild(el('p', 'sb-ody-lede', 'Take a breath. The level begins again exactly as it was.'));

    if (!includeLegacyResults) {
        content.appendChild(el(
            'div',
            'sb-ody-note odyssey-failure-unranked',
            'Experimental Session · Unranked — this attempt was not recorded.',
        ));
    }

    // Actions: Retry (primary) + Back to Map (secondary)
    const actions = el('div', 'sb-ody-actions');
    const retryBtn = el('button', 'sb-btn sb-btn--primary', 'Retry');
    retryBtn.type = 'button';
    appendKeyHint(retryBtn, 'R', 'A');
    const mapBtn = el('button', 'sb-btn', 'Back to Map');
    mapBtn.type = 'button';
    appendKeyHint(mapBtn, 'Esc', 'B');
    actions.appendChild(retryBtn);
    actions.appendChild(mapBtn);
    content.appendChild(actions);

    // Single-fire choice dispatch shared by buttons + keyboard. The caller owns
    // removing the modal (a retry keeps the backdrop up while the board resets).
    let resolved = false;
    let onKeyDown = null;
    const choose = (choice) => {
        if (resolved) return;
        resolved = true;
        document.removeEventListener('keydown', onKeyDown, true);
        onChoose(choice);
    };
    onKeyDown = (e) => {
        // A focused button owns Enter/Space (tabbing to Back to Map and pressing Enter
        // used to retry).
        const focused = document.activeElement;
        if ((e.key === 'Enter' || e.key === ' ') && (focused === retryBtn || focused === mapBtn)) return;
        switch (e.key) {
        case 'Enter':
        case ' ':
        case 'r':
        case 'R':
            e.preventDefault();
            e.stopPropagation();
            choose('retry');
            break;
        case 'Escape':
            e.preventDefault();
            e.stopPropagation();
            choose('map');
            break;
        default:
            break;
        }
    };
    // Capture phase so the modal wins over any still-attached gameplay key handlers.
    document.addEventListener('keydown', onKeyDown, true);

    retryBtn.addEventListener('click', () => choose('retry'));
    mapBtn.addEventListener('click', () => choose('map'));
    setTimeout(() => retryBtn.focus?.({ preventScroll: true }), 0);

    return modal;
}

export default createFailureModal;
