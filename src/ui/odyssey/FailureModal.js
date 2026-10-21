/**
 * @fileoverview Odyssey level-failed sheet (Retry / Back to Map).
 *
 * Pure DOM/view: the orb's world as the hero in its chapter's light, the orb's name, what ended
 * the attempt, how far the main goal got (a figure and a cell meter) or the duel's knockouts,
 * the road's mercy charm as a gift card, and the next attempt's tip. The actions sit in a footer
 * that never scrolls away. Styles: public/styles/odyssey-outcome.css.
 * The caller owns removing the modal (a retry keeps the dark backdrop up while the board resets),
 * so a choice only detaches input and fires its callback. Disposal also removes the modal.
 */

import {
    appendKeyHint, createKeystoneSheet, el, isSettingsOverSheet,
} from './keystone-sheet.js';
import { getOdysseyRetryDebrief } from './objective-copy.js';
import { describeOdysseyCharmPity } from './odyssey-charm-copy.js';
import { createOdysseyCharmIconNode } from './odyssey-charm-icon-stage.js';
import { ODYSSEY_PITY_FALLS, odysseyCharmById } from '../../core/odyssey/odyssey-charm-bag.js';
import {
    createOdysseyOutcomeFrame, describeOdysseyOutcomeEyebrow, describeOdysseyOutcomeOrb,
} from './odyssey-outcome-sheet.js';

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
/** More knockouts than this to win draws the duel as a figure alone, without a cell per knockout. */
const DUEL_CELL_CAP = 10;

function setData(node, name, value) {
    if (node?.dataset) node.dataset[name] = String(value);
}

/**
 * How far the main goal got: the goal, the attempt's figure against its target, a cell meter
 * and the shortfall.
 */
function createDebrief(debrief) {
    const progress = el('section', 'sb-ody-debrief');
    progress.ariaLabel = 'Main goal progress for this attempt';
    const head = el('p', 'sb-ody-debrief__goal');
    head.appendChild(el('span', 'sb-ody-debrief__label', 'This attempt · Main goal'));
    head.appendChild(el('span', 'sb-ody-debrief__objective', debrief.objective));
    progress.appendChild(head);

    // "31 / 42 lines" (or "Best chain: 3 / 5 waves") as a figure: the attempt's number, large.
    const [reached, target = ''] = debrief.progressLabel.split(' / ');
    const prefix = reached.includes(': ') ? reached.slice(0, reached.lastIndexOf(': ') + 2) : '';
    const value = el('p', 'sb-ody-debrief__value');
    if (prefix) value.appendChild(el('span', 'sb-ody-debrief__prefix', prefix.trim()));
    value.appendChild(el('b', '', reached.slice(prefix.length)));
    if (target) value.appendChild(el('span', 'sb-ody-debrief__target', `/ ${target}`));
    progress.appendChild(value);

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
    progress.appendChild(el('p', 'sb-ody-debrief__remaining', debrief.remainingText));
    return progress;
}

/** A side of the duel: its knockouts as a figure, and a cell for each one toward the target. */
function duelSide(name, frags, target, className) {
    const side = el('div', `sb-ody-duel__side ${className}`);
    side.appendChild(el('b', 'sb-ody-duel__frags', String(frags)));
    side.appendChild(el('span', 'sb-ody-duel__name', name));
    if (target > 0 && target <= DUEL_CELL_CAP) {
        const cells = el('span', 'sb-ody-duel__cells');
        cells.ariaHidden = 'true';
        for (let index = 0; index < target; index += 1) {
            cells.appendChild(el('i', index < frags ? 'is-filled' : ''));
        }
        side.appendChild(cells);
    }
    return side;
}

/** The lost duel as a scoreboard: you and the rival, the knockouts each reached. */
function createDuelScore(duel, rivalName) {
    const playerFrags = Math.max(0, Number(duel.playerFrags) || 0);
    const botFrags = Math.max(0, Number(duel.botFrags) || 0);
    const target = Math.max(1, Number(duel.targetFrags) || 3);
    const rival = duel.botName || rivalName || 'The rival';
    const score = el('section', 'sb-ody-duel');
    score.ariaLabel = `Knockouts: you ${playerFrags}, ${rival} ${botFrags}. First to ${target} wins.`;
    score.appendChild(el('p', 'sb-ody-debrief__label', `Knockouts · first to ${target} wins`));
    const board = el('div', 'sb-ody-duel__board');
    board.appendChild(duelSide('You', playerFrags, target, 'is-you'));
    const dash = el('span', 'sb-ody-duel__dash', '–');
    dash.ariaHidden = 'true';
    board.appendChild(dash);
    board.appendChild(duelSide(rival, botFrags, target, 'is-rival'));
    score.appendChild(board);
    return score;
}

/**
 * The road's mercy as a gift: the charm the third fall in a row left, large and live in its own
 * tone, its name, and the key that uses it. Nothing to choose.
 */
function createMercyCard(charmId) {
    const charm = odysseyCharmById(charmId);
    if (!charm || !describeOdysseyCharmPity(charmId)) return null;
    const card = el('section', 'sb-ody-note sb-ody-charm-pity');
    card.role = 'status';
    setData(card, 'charm', charm.id);
    const art = el('span', 'sb-ody-gift__art');
    art.ariaHidden = 'true';
    art.appendChild(el('span', 'sb-ody-gift__halo'));
    art.appendChild(el('span', 'sb-ody-gift__orbit'));
    const icon = createOdysseyCharmIconNode(charm.id, { state: 'active' });
    if (icon) art.appendChild(icon);
    card.appendChild(art);

    const copy = el('div', 'sb-ody-gift__copy');
    const falls = NUMBER_WORDS[ODYSSEY_PITY_FALLS] || String(ODYSSEY_PITY_FALLS);
    copy.appendChild(el('p', 'sb-eyebrow sb-ody-gift__eyebrow', `After ${falls} falls here`));
    copy.appendChild(el('p', 'sb-ody-gift__name', charm.name));
    const line = el('p', 'sb-ody-gift__line');
    line.appendChild(el('span', '', 'The road leaves you this charm. '));
    // "Press 3 for 30 more seconds." with the key as a keycap.
    const pressed = /^Press (\S+)\s+(.*)$/.exec(charm.press);
    if (pressed && pressed[1] === charm.key) {
        line.appendChild(el('span', '', 'Press '));
        line.appendChild(el('kbd', 'sb-kbd sb-ody-gift__key', charm.key));
        line.appendChild(el('span', '', ` ${pressed[2]}`));
    } else {
        line.appendChild(el('span', '', charm.press));
    }
    copy.appendChild(line);
    card.appendChild(copy);
    return card;
}

/**
 * Build the level-failed sheet.
 * @param {object} deps
 * @param {string} deps.reasonText human-readable failure reason ("Time ran out!" / "You topped out!")
 * @param {function('retry'|'map'):void} deps.onChoose single-fire; fired by button or keyboard
 * @param {?number} deps.attemptNumber current attempt (shows an "Attempt N" line when finite)
 * @param {boolean} [deps.includeLegacyResults=true] whether this attempt is persisted
 * @param {object} [deps.levelConfig] the orb's resolved level (its name, chapter, world, goal)
 * @param {object} [deps.metrics] final metrics after in-flight physics settles
 * @param {string} [deps.failureReason] outcome code, independent of the displayed title
 * @param {?string} [deps.charmPity] the charm the road left after the third fall in a row on this orb
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
    charmPity = null,
}) {
    // Keystone sheet. A failed orb is a pause for breath, not an alarm: no red, the orb still in
    // its own light, the reason in plain words, Retry as the one primary action.
    const { modal, panel } = createKeystoneSheet({
        id: 'odyssey-failure-modal',
        label: 'Orb not cleared',
        variant: 'failed',
    });
    const orb = describeOdysseyOutcomeOrb(levelConfig);
    const { main, footer } = createOdysseyOutcomeFrame(modal, panel, { orb, state: 'failed' });

    // Where the orb lies, then the attempt counter (it builds the "one more try" momentum).
    const reason = String(reasonText || 'Orb not cleared').replace(/!+$/, '.');
    const eyebrow = describeOdysseyOutcomeEyebrow(
        orb,
        Number.isFinite(attemptNumber) ? `Attempt ${attemptNumber}` : '',
    );
    if (eyebrow) main.appendChild(el('p', 'sb-eyebrow sb-ody-eyebrow', eyebrow));
    // The orb's name is the title; what ended the attempt is the outcome line under it.
    const named = Boolean(orb?.name);
    main.appendChild(el('h2', 'sb-ody-title', named ? orb.name : reason));
    if (named) main.appendChild(el('p', 'sb-ody-outcome__line', reason));
    main.appendChild(el('p', 'sb-ody-lede', duel
        ? 'Take a breath. Retry begins at 0–0.'
        : 'Take a breath. Retry starts a fresh attempt.'));

    // Single-fire choice state.
    let resolved = false;
    let disposed = false;

    const debrief = duel ? null : getOdysseyRetryDebrief(levelConfig, metrics, failureReason);
    if (duel || debrief) {
        const facts = el('div', 'sb-ody-outcome__facts');
        if (duel) facts.appendChild(createDuelScore(duel, orb?.rivalName));
        if (debrief) {
            facts.appendChild(createDebrief(debrief));
            const coaching = el('div', 'sb-ody-outcome__tip');
            coaching.appendChild(el('strong', '', 'Next attempt'));
            coaching.appendChild(el('span', '', debrief.tip));
            facts.appendChild(coaching);
        }
        main.appendChild(facts);
    }

    // The road's mercy: after the third fall in a row on this orb the save left one charm that
    // helps here. Nothing to choose; the sheet shows which, and the key that uses it.
    const mercy = createMercyCard(charmPity);
    if (mercy) main.appendChild(mercy);

    if (!includeLegacyResults) {
        main.appendChild(el(
            'div',
            'sb-ody-note odyssey-failure-unranked',
            'Experimental Session · Unranked — this attempt was not recorded.',
        ));
    }

    // Actions: Retry (primary) + Back to Map (secondary), alone in their row (sheet-input.js
    // finds them as the row's first and last button).
    const actions = el('div', 'sb-ody-actions');
    const retryBtn = el('button', 'sb-btn sb-btn--primary', 'Retry');
    retryBtn.type = 'button';
    appendKeyHint(retryBtn, 'R', 'A');
    const mapBtn = el('button', 'sb-btn', 'Back to Map');
    mapBtn.type = 'button';
    appendKeyHint(mapBtn, 'Esc', 'B');
    actions.appendChild(retryBtn);
    actions.appendChild(mapBtn);
    footer.appendChild(actions);

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
        if (isSettingsOverSheet()) return;
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
