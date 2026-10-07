/**
 * @fileoverview Odyssey level-failed modal (Retry / Back to Map).
 *
 * Pure DOM/view: presents the outcome and an optional primary-goal retry debrief.
 * The caller owns removing the modal (a retry keeps the dark backdrop up while the board resets),
 * so a choice only detaches input and fires its callback. Disposal also removes the modal.
 */

import { appendKeyHint, createKeystoneSheet, el } from './keystone-sheet.js';
import { getOdysseyRetryDebrief } from './objective-copy.js';

/**
 * Build the level-failed sheet.
 * @param {object} deps
 * @param {string} deps.reasonText human-readable failure reason ("Time ran out!" / "You topped out!")
 * @param {function('retry'|'map'):void} deps.onChoose single-fire; fired by button or keyboard
 * @param {?number} deps.attemptNumber current attempt (shows an "Attempt N" line when finite)
 * @param {boolean} [deps.includeLegacyResults=true] whether this attempt is persisted
 * @param {object} [deps.levelConfig] authored objective for this attempt
 * @param {object} [deps.metrics] final metrics after in-flight physics settles
 * @param {string} [deps.failureReason] outcome code, independent of the displayed title
 * @returns {HTMLElement} the modal root element (caller mounts + later removes it)
 */
export function createFailureModal({
    reasonText,
    onChoose,
    attemptNumber,
    includeLegacyResults = true,
    results = null,
    duel = results?.duel,
    levelConfig = null,
    metrics = null,
    failureReason = null,
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
    const debrief = duel ? null : getOdysseyRetryDebrief(levelConfig, metrics, failureReason);
    const retryText = duel
        ? `Final frags: ${duel.playerFrags ?? 0}–${duel.botFrags ?? 0}. `
            + `First to ${duel.targetFrags || 7} wins. Retry begins at 0–0.`
        : 'Take a breath. Retry starts a fresh attempt.';
    content.appendChild(el('p', 'sb-ody-lede', retryText));

    if (debrief) {
        const progress = el('section', 'sb-ody-note sb-ody-debrief');
        progress.ariaLabel = 'Main objective progress for this attempt';
        progress.appendChild(el('strong', '', 'This attempt · Main objective'));
        progress.appendChild(el('p', '', debrief.objective));
        progress.appendChild(el('p', 'sb-ody-debrief__value', debrief.progressLabel));
        const track = el('div', 'sb-ody-debrief__track');
        track.role = 'progressbar';
        track.ariaLabel = 'Main objective progress for this attempt';
        track.ariaValueMin = '0';
        track.ariaValueMax = String(debrief.target);
        track.ariaValueNow = String(Math.min(debrief.value, debrief.target));
        track.ariaValueText = `${debrief.progressLabel}. ${debrief.remainingText}`;
        const fill = el('div', 'sb-ody-debrief__fill');
        fill.style.width = `${Math.min(100, (debrief.value / debrief.target) * 100)}%`;
        track.appendChild(fill);
        progress.appendChild(track);
        progress.appendChild(el('p', '', debrief.remainingText));
        content.appendChild(progress);
        const coaching = el('div', 'sb-ody-note');
        coaching.appendChild(el('strong', '', 'Next attempt'));
        coaching.appendChild(el('span', '', debrief.tip));
        content.appendChild(coaching);
    }

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
    let disposed = false;
    let onKeyDown = null;
    let focusTimer = null;
    const detachInput = () => {
        document.removeEventListener('keydown', onKeyDown, true);
        clearTimeout(focusTimer);
    };
    modal.dispose = () => {
        if (disposed) return;
        disposed = true;
        resolved = true;
        detachInput();
        modal.remove();
    };
    const choose = (choice) => {
        if (resolved) return;
        resolved = true;
        detachInput();
        onChoose(choice);
    };
    onKeyDown = (e) => {
        if (modal.isConnected === false) {
            modal.dispose();
            return;
        }
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
    focusTimer = setTimeout(() => retryBtn.focus?.({ preventScroll: true }), 0);

    return modal;
}

export default createFailureModal;
