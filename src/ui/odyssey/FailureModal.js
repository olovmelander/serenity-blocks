/**
 * @fileoverview Odyssey level-failed modal (Retry / Back to Map).
 *
 * Pure DOM/view: presents the outcome and an optional primary-goal retry debrief.
 * The caller owns removing the modal (a retry keeps the dark backdrop up while the board resets),
 * so a choice only detaches input and fires its callback. Disposal also removes the modal.
 */

import { appendKeyHint, createKeystoneSheet, el } from './keystone-sheet.js';
import { getOdysseyRetryDebrief } from './objective-copy.js';
import { ODYSSEY_CHARM_KIND_LABELS, ODYSSEY_MERCY_FALLS } from '../../core/odyssey/odyssey-charms.js';

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
 * @param {?{charms: object[], onTake: function(string), onPass: function}} [deps.charmDraft]
 *   the road's mercy: a draft of charms after the third fall on this orb
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
    charmDraft = null,
}) {
    // Keystone sheet (keystone-overlays.css). A failed level is a pause for breath, not
    // an alarm: no red, the reason in plain words, Retry as the one primary action.
    const { modal, panel: content } = createKeystoneSheet({
        id: 'odyssey-failure-modal',
        label: 'Orb not cleared',
        variant: 'failed',
    });

    // Attempt counter as the eyebrow (builds the "one more try" momentum)
    if (Number.isFinite(attemptNumber)) {
        content.appendChild(el('p', 'sb-eyebrow sb-ody-eyebrow', `Attempt ${attemptNumber}`));
    }
    content.appendChild(el('h2', 'sb-ody-title', String(reasonText || 'Orb not cleared').replace(/!+$/, '.')));
    const debrief = duel ? null : getOdysseyRetryDebrief(levelConfig, metrics, failureReason);
    const retryText = duel
        ? `Knockouts: ${duel.playerFrags ?? 0}–${duel.botFrags ?? 0}. `
            + `First to ${duel.targetFrags || 3} wins. Retry begins at 0–0.`
        : 'Take a breath. Retry starts a fresh attempt.';
    content.appendChild(el('p', 'sb-ody-lede', retryText));

    // Single-fire choice state, declared early because the charm cards consult it.
    let resolved = false;
    let disposed = false;
    let focusPrimary = () => {};

    // The road's mercy: after the third fall on one orb a draft of charms rides on the sheet.
    // Taking one or passing settles it here; Retry then plays with the charm held.
    const charmNodes = [];
    if (charmDraft?.charms?.length) {
        const mercy = el('section', 'sb-ody-note sb-ody-charms');
        mercy.ariaLabel = 'The road offers a charm';
        mercy.appendChild(el('strong', '', 'The road offers a charm'));
        mercy.appendChild(el('p', '', `After ${ODYSSEY_MERCY_FALLS} falls on one orb the road offers a charm. `
            + 'Take one and keep it for the rest of the way, or pass.'));
        const list = el('div', 'sb-ody-charm-list');
        list.role = 'group';
        list.ariaLabel = 'Charms offered';
        const pass = el('button', 'sb-btn sb-ody-charm-pass', 'Not now');
        pass.type = 'button';
        let settled = false;
        const settle = (taken) => {
            settled = true;
            list.hidden = true;
            pass.hidden = true;
            charmNodes.splice(0);
            const line = el('p', 'sb-ody-charm-settled', taken
                ? `${taken.name} is yours for the rest of the road. ${taken.line}`
                : 'No charm this time. The road offers another at the next chapter.');
            line.role = 'status';
            mercy.appendChild(line);
            focusPrimary();
        };
        charmDraft.charms.forEach((charm) => {
            const card = el('button', 'sb-ody-charm');
            card.type = 'button';
            if (card.dataset) card.dataset.charm = charm.id;
            card.appendChild(el('i', 'sb-ody-charm__kind', ODYSSEY_CHARM_KIND_LABELS[charm.kind] || ''));
            card.appendChild(el('b', 'sb-ody-charm__name', charm.name));
            card.appendChild(el('span', 'sb-ody-charm__line', charm.line));
            card.addEventListener('click', () => {
                if (settled || resolved) return;
                if (charmDraft.onTake?.(charm.id) === false) return;
                settle(charm);
            });
            list.appendChild(card);
            charmNodes.push(card);
        });
        mercy.appendChild(list);
        pass.addEventListener('click', () => {
            if (settled || resolved) return;
            charmDraft.onPass?.();
            settle(null);
        });
        mercy.appendChild(pass);
        charmNodes.push(pass);
        content.appendChild(mercy);
    }

    if (debrief) {
        const progress = el('section', 'sb-ody-note sb-ody-debrief');
        progress.ariaLabel = 'Main goal progress for this attempt';
        progress.appendChild(el('strong', '', 'This attempt · Main goal'));
        progress.appendChild(el('p', '', debrief.objective));
        progress.appendChild(el('p', 'sb-ody-debrief__value', debrief.progressLabel));
        const track = el('div', 'sb-ody-debrief__track');
        track.role = 'progressbar';
        track.ariaLabel = 'Main goal progress for this attempt';
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
    focusPrimary = () => retryBtn.focus?.({ preventScroll: true });
    const mapBtn = el('button', 'sb-btn', 'Back to Map');
    mapBtn.type = 'button';
    appendKeyHint(mapBtn, 'Esc', 'B');
    actions.appendChild(retryBtn);
    actions.appendChild(mapBtn);
    content.appendChild(actions);

    // Single-fire choice dispatch shared by buttons + keyboard. The caller owns
    // removing the modal (a retry keeps the backdrop up while the board resets).
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
        // used to retry); so does a charm card or Not now.
        const focused = document.activeElement;
        if ((e.key === 'Enter' || e.key === ' ')
            && (focused === retryBtn || focused === mapBtn || charmNodes.includes(focused))) return;
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
