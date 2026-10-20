/**
 * The charm guide: the map header's charm chip opens a sheet naming all four charms, the ones in
 * the bag (how many, of three) and the ones not in it, what each does, when it helps, and how
 * charms are found and used. Read-only: nothing is chosen or spent here.
 *
 * Opened from the map by a click or tap on the chip, Enter or Space on it, or Y on the controller
 * (odyssey-map-input.js wires those); Back to map, Escape, B or a click outside the sheet closes
 * it. The rules live in core/odyssey/odyssey-charm-bag.js; this module only says them.
 */
import {
    ODYSSEY_CHARMS, ODYSSEY_CHARM_CAP, ODYSSEY_PITY_FALLS, ODYSSEY_PITY_HOLD,
} from '../../core/odyssey/odyssey-charm-bag.js';
import { appendKeyHint, createKeystoneSheet, el } from './keystone-sheet.js';
import { createOdysseyCharmIconNode } from './odyssey-charm-icon-stage.js';
import { canNavigateOdysseyMap, installOdysseyMapInput } from './odyssey-map-input.js';

export const ODYSSEY_CHARM_GUIDE_ID = 'odyssey-charm-guide';
/** The name sheet-input.js knows the guide by (focus on open, focus back on close). */
const MODAL_NAME = 'odysseyCharms';

/** When each charm earns its press: the walls it breaks (docs/ODYSSEY_CHARMS_AUDIT_2026-10.md §5.2). */
const WHEN = Object.freeze({
    tide: 'Best against rubble or a tall, crowded well.',
    'still-air': 'Best when the pace outruns you.',
    'long-breath': 'Only on orbs with a clock.',
    hearth: 'A safety net for a long attempt or a duel.',
});

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const inWords = (count) => NUMBER_WORDS[count] || String(count);
const sentence = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : '');
const whole = (value) => Math.max(0, Math.floor(Number(value) || 0));

/** How charms are found and used, in the order a player meets it. */
export const ODYSSEY_CHARM_GUIDE_RULES = Object.freeze([
    'Clearing an orb leaves you a charm; a three-star clear leaves two. Each is picked for the orb ahead.',
    'During an orb, press a charm’s number or tap it to use it. Each works once an attempt and is spent '
        + 'when used.',
    `You can hold ${inWords(ODYSSEY_CHARM_CAP)} of each. A new journey starts with an empty bag.`,
    `After ${inWords(ODYSSEY_PITY_FALLS)} falls in a row on one orb, the road leaves you the charm that helps `
        + `there, unless you already hold ${inWords(ODYSSEY_PITY_HOLD)}.`,
    'Using a charm never costs stars.',
]);

/**
 * What the guide says, from the bag and the journey's tally. Pure.
 * @param {{ counts?: Record<string, number>, stats?: { found?: number, used?: number } }} [bag]
 */
export function describeOdysseyCharmGuide({ counts = {}, stats = {} } = {}) {
    const charms = ODYSSEY_CHARMS.map((charm) => {
        const count = Math.min(ODYSSEY_CHARM_CAP, whole(counts?.[charm.id]));
        return {
            id: charm.id,
            name: charm.name,
            key: charm.key,
            rule: sentence(charm.line),
            when: WHEN[charm.id] || '',
            count,
            cap: ODYSSEY_CHARM_CAP,
            held: count > 0,
            status: count > 0 ? `${count} of ${ODYSSEY_CHARM_CAP}` : 'None in your bag',
        };
    });
    const total = charms.reduce((sum, charm) => sum + charm.count, 0);
    const found = whole(stats?.found);
    const tally = found > 0 ? ` Found ${found} this journey, used ${whole(stats?.used)}.` : '';
    const lede = total > 0
        ? `You carry ${total} ${total === 1 ? 'charm' : 'charms'}.${tally}`
        : `Your bag is empty.${tally || ' Clearing an orb leaves you a charm.'}`;
    return {
        charms, total, lede, rules: ODYSSEY_CHARM_GUIDE_RULES,
    };
}

/** One charm's row: its icon (greyed when none is held), name and key, rule, when, and count. */
function charmRow(entry) {
    const row = el('li', 'sb-ody-charm-guide__charm');
    if (row.dataset) {
        row.dataset.charm = entry.id;
        row.dataset.held = String(entry.held);
    }
    const icon = createOdysseyCharmIconNode(entry.id, { state: entry.held ? 'ready' : 'empty' });
    if (icon) row.appendChild(icon);

    const body = el('div', 'sb-ody-charm-guide__body');
    const head = el('p', 'sb-ody-charm-guide__head');
    head.appendChild(el('span', 'sb-ody-charm-guide__name', entry.name));
    const key = el('kbd', 'sb-kbd', entry.key);
    key.title = `Press ${entry.key} during an orb`;
    head.appendChild(key);
    body.appendChild(head);
    body.appendChild(el('p', 'sb-ody-charm-guide__rule', entry.rule));
    if (entry.when) body.appendChild(el('p', 'sb-ody-charm-guide__when', entry.when));
    row.appendChild(body);

    // The count closes the card: a pip per charm held, of three, then the same in words.
    const count = el('p', 'sb-ody-charm-guide__count');
    if (entry.held) {
        const pips = el('span', 'sb-ody-charm-guide__pips');
        pips.ariaHidden = 'true';
        for (let index = 0; index < entry.cap; index += 1) {
            pips.appendChild(el('i', index < entry.count ? 'is-held' : ''));
        }
        count.appendChild(pips);
    }
    count.appendChild(el('span', '', entry.status));
    body.appendChild(count);
    return row;
}

/**
 * Build the guide sheet. The caller mounts it; `modal.dispose()` removes it.
 * @param {{ counts?: Record<string, number>, stats?: object, onClose?: () => void }} options
 * @returns {HTMLElement} the modal root
 */
export function createOdysseyCharmGuideSheet({ counts, stats, onClose } = {}) {
    const guide = describeOdysseyCharmGuide({ counts, stats });
    const { modal, panel } = createKeystoneSheet({ id: ODYSSEY_CHARM_GUIDE_ID, label: 'Charms', variant: 'charms' });

    panel.appendChild(el('p', 'sb-eyebrow sb-ody-eyebrow', 'Your bag'));
    panel.appendChild(el('h2', 'sb-ody-title', 'Charms'));
    panel.appendChild(el('p', 'sb-ody-lede', guide.lede));

    const list = el('ul', 'sb-ody-charm-guide');
    guide.charms.forEach((entry) => list.appendChild(charmRow(entry)));
    panel.appendChild(list);

    const rules = el('section', 'sb-ody-note sb-ody-charm-guide__rules');
    rules.appendChild(el('strong', '', 'How charms work'));
    const ruleList = el('ul');
    guide.rules.forEach((line) => ruleList.appendChild(el('li', '', line)));
    rules.appendChild(ruleList);
    panel.appendChild(rules);

    const actions = el('div', 'sb-ody-actions');
    const back = el('button', 'sb-btn sb-btn--primary', 'Back to map');
    back.type = 'button';
    back.setAttribute?.('data-charm-guide-action', 'close');
    appendKeyHint(back, 'Esc', 'B');
    actions.appendChild(back);
    panel.appendChild(actions);

    const close = () => onClose?.();
    back.addEventListener('click', close);
    // A click on the scrim around the sheet closes it too; a click inside the sheet does not.
    modal.addEventListener('click', (event) => {
        if (event.target === modal) close();
    });
    modal.dispose = () => modal.remove();
    return modal;
}

function announce(type) {
    if (typeof CustomEvent !== 'function') return;
    globalThis.window?.dispatchEvent?.(new CustomEvent(type, { detail: { modalName: MODAL_NAME } }));
}

/**
 * The guide over one mode's map: opens only while the map itself is on screen, with the bag as
 * it stands, and closes on its own controls or when the map input is disposed.
 * @param {object} mode the Odyssey mode (odysseyState, isInBoardView, ...)
 * @param {{ doc?: Document }} [options]
 */
export function createOdysseyCharmGuide(mode, { doc = globalThis.document } = {}) {
    let modal = null;
    const isOpen = () => Boolean(modal && modal.isConnected !== false);
    const close = () => {
        if (!modal) return false;
        const closing = modal;
        modal = null;
        // Announced while the sheet is still mounted: sheet-input.js hands focus back to the chip
        // only when it can see that focus was inside the sheet.
        announce('modalHidden');
        closing.dispose();
        return true;
    };
    const open = () => {
        if (isOpen()) return true;
        modal = null;
        if (!doc?.body || !canNavigateOdysseyMap(mode, doc)) return false;
        const state = mode.odysseyState;
        modal = createOdysseyCharmGuideSheet({
            counts: state?.getCharmCounts?.(),
            stats: state?.getCharmStats?.(),
            onClose: close,
        });
        doc.body.appendChild(modal);
        announce('modalShown');
        return true;
    };
    return { open, close, isOpen };
}

/**
 * The map's keys and pad with the charm guide wired to the header chip and Y; OdysseyMode installs
 * this for as long as it is active, and the returned dispose also closes the guide.
 * @param {object} mode
 */
export function installOdysseyMapInputWithCharmGuide(mode) {
    return installOdysseyMapInput(mode, { charmGuide: createOdysseyCharmGuide(mode) });
}
