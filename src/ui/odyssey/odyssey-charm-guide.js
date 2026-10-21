/**
 * The charm guide: the map header's charm chip opens a page naming all four charms, the ones in
 * the bag (how many, of three) and the ones not in it, what each does, when it helps, and how
 * charms are found and used. Read-only: nothing is chosen or spent here.
 *
 * The page speaks the navigator's language (docs/ODYSSEY_NAVIGATOR_2026-10.md): a header with
 * the bag in figures and cells, the four charms as a rail on the left, the selected charm's card
 * on the stage with its live icon as the art, and how charms work as a path of five steps under
 * it. The selected charm lends the page its light (aqua, lavender, gold, coral).
 *
 * Opened from the map by a click or tap on the chip, Enter or Space on it, or Y on the controller
 * (odyssey-map-input.js wires those); Back to the map, Escape, B or a click outside the page
 * closes it. Focus is the selection: the arrows, the D-pad, LB and RB walk the rail, and 1 to 4
 * show the charm that key uses during an orb. The rules live in core/odyssey/odyssey-charm-bag.js;
 * this module only says them. Styles: public/styles/odyssey-charms.css.
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
const STAGE_ID = `${ODYSSEY_CHARM_GUIDE_ID}-stage`;
const tabId = (charmId) => `${ODYSSEY_CHARM_GUIDE_ID}-tab-${charmId}`;

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

/** Each rule's word, the step it names on the path. */
const RULE_TITLES = Object.freeze(['Find', 'Use', 'Keep', 'Mercy', 'Stars']);

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
    const used = whole(stats?.used);
    const tally = found > 0 ? ` Found ${found} this journey, used ${used}.` : '';
    const lede = total > 0
        ? `You carry ${total} ${total === 1 ? 'charm' : 'charms'}.${tally}`
        : `Your bag is empty.${tally || ' Clearing an orb leaves you a charm.'}`;
    return {
        charms,
        total,
        capacity: charms.length * ODYSSEY_CHARM_CAP,
        found,
        used,
        lede,
        // The page opens on the first charm in the bag, or on Tide while the bag is empty.
        selected: (charms.find((charm) => charm.held) || charms[0]).id,
        rules: ODYSSEY_CHARM_GUIDE_RULES,
        steps: ODYSSEY_CHARM_GUIDE_RULES.map((line, index) => ({ title: RULE_TITLES[index] || '', line })),
    };
}

/** A keycap, and the controller button that does the same where there is one. */
function keycaps(parent, key, pad) {
    const keyCap = el('kbd', 'sb-kbd', key);
    if (keyCap.dataset) keyCap.dataset.key = '';
    parent.appendChild(keyCap);
    if (!pad) return;
    const padCap = el('kbd', 'sb-kbd', pad);
    if (padCap.dataset) padCap.dataset.pad = '';
    parent.appendChild(padCap);
}

/** A cell per charm the bag can hold of a kind, the held ones marked. */
function appendCells(parent, count, cap) {
    const cells = [];
    for (let index = 0; index < cap; index += 1) {
        cells.push(parent.appendChild(el('i', index < count ? 'is-held' : '')));
    }
    return cells;
}

/** Three diamonds, one per charm the bag can hold of a kind; the held ones lit. */
function createPips(className, count, cap) {
    const pips = el('span', className);
    pips.ariaHidden = 'true';
    return { pips, cells: appendCells(pips, count, cap) };
}

/** A header figure: the number (of the whole, where there is one) and what it counts. */
function figure(label, value, of = null) {
    const node = el('span', 'sb-ody-charms__figure');
    const number = el('b', '', String(value));
    if (of !== null) number.appendChild(el('small', '', ` / ${of}`));
    node.appendChild(number);
    node.appendChild(el('span', '', label));
    return node;
}

/**
 * The header: the bag named and counted, its twelve cells in the four charms' tones, the way
 * back. A press on a charm's cells shows it.
 */
function createHeader(guide, select) {
    const header = el('header', 'sb-ody-charms__header');
    const brand = el('div', 'sb-ody-charms__brand');
    brand.appendChild(el('p', 'sb-eyebrow sb-ody-eyebrow', 'Your bag'));
    const title = el('h2', 'sb-ody-title', 'Charms');
    title.id = `${ODYSSEY_CHARM_GUIDE_ID}-title`;
    brand.appendChild(title);
    brand.appendChild(el('p', 'sb-ody-lede', guide.lede));
    header.appendChild(brand);

    // The lede says the bag in words; the figures and cells are for the eye.
    const bag = el('div', 'sb-ody-charms__bag');
    bag.ariaHidden = 'true';
    const figures = el('p', 'sb-ody-charms__figures');
    figures.appendChild(figure('Held', guide.total, guide.capacity));
    figures.appendChild(figure('Found', guide.found));
    figures.appendChild(figure('Used', guide.used));
    bag.appendChild(figures);
    const meter = el('div', 'sb-ody-charms__meter');
    guide.charms.forEach((entry) => {
        const group = el('span', 'sb-ody-charms__meter-group');
        if (group.dataset) group.dataset.charm = entry.id;
        appendCells(group, entry.count, entry.cap);
        group.addEventListener('click', () => select(entry.id, { focus: true }));
        meter.appendChild(group);
    });
    bag.appendChild(meter);
    header.appendChild(bag);

    const back = el('button', 'sb-btn sb-ody-charms__close', 'Back to the map');
    back.type = 'button';
    back.setAttribute?.('data-charm-guide-action', 'close');
    appendKeyHint(back, 'Esc', 'B');
    header.appendChild(back);
    return { header, back };
}

/** One charm on the rail: its icon (greyed when none is held), name and key, and count. */
function charmRow(entry, select) {
    const row = el('li', 'sb-ody-charm-guide__charm');
    row.setAttribute?.('role', 'presentation');
    if (row.dataset) {
        row.dataset.charm = entry.id;
        row.dataset.held = String(entry.held);
    }
    const tab = el('button', 'sb-ody-charm-guide__tab');
    tab.type = 'button';
    tab.id = tabId(entry.id);
    tab.setAttribute?.('role', 'tab');
    tab.setAttribute?.('aria-selected', 'false');
    tab.setAttribute?.('aria-controls', STAGE_ID);
    if (tab.dataset) tab.dataset.charm = entry.id;
    const icon = createOdysseyCharmIconNode(entry.id, { state: entry.held ? 'ready' : 'empty' });
    if (icon) tab.appendChild(icon);

    const body = el('span', 'sb-ody-charm-guide__body');
    const head = el('span', 'sb-ody-charm-guide__head');
    head.appendChild(el('span', 'sb-ody-charm-guide__name', entry.name));
    const key = el('kbd', 'sb-kbd', entry.key);
    key.title = `Press ${entry.key} during an orb`;
    head.appendChild(key);
    body.appendChild(head);

    // A pip per charm held, of three, then the same in words.
    const count = el('span', 'sb-ody-charm-guide__count');
    if (entry.held) count.appendChild(createPips('sb-ody-charm-guide__pips', entry.count, entry.cap).pips);
    count.appendChild(el('span', '', entry.status));
    body.appendChild(count);
    tab.appendChild(body);
    row.appendChild(tab);

    // Focus is the selection, so the D-pad and Tab show what they land on; a click shows it too.
    tab.addEventListener('focus', () => select(entry.id));
    tab.addEventListener('click', () => select(entry.id));
    return { row, tab };
}

/**
 * The selected charm's card: its live icon large in a halo and orbit (one icon per charm, the
 * others hidden, so a change of charm draws on the next frame), its standing in the bag, what it
 * does, and beside that how to use it and when it helps. `fill` writes a charm into it.
 */
function createCard(guide) {
    const card = el('article', 'sb-ody-charm-card');
    card.setAttribute?.('aria-labelledby', `${ODYSSEY_CHARM_GUIDE_ID}-card-title`);

    const art = el('div', 'sb-ody-charm-card__art');
    art.ariaHidden = 'true';
    art.appendChild(el('span', 'sb-ody-charm-card__halo'));
    art.appendChild(el('span', 'sb-ody-charm-card__orbit'));
    const heroes = new Map();
    guide.charms.forEach((entry) => {
        const slot = el('span', 'sb-ody-charm-card__icon');
        if (slot.dataset) slot.dataset.charm = entry.id;
        // The card shows a charm as it looks in the tray: lit when held, at rest when not.
        const icon = createOdysseyCharmIconNode(entry.id, { state: entry.held ? 'active' : 'ready' });
        if (icon) slot.appendChild(icon);
        art.appendChild(slot);
        heroes.set(entry.id, slot);
    });
    card.appendChild(art);

    const copy = el('div', 'sb-ody-charm-card__copy');
    const eyebrow = el('p', 'sb-eyebrow sb-ody-charm-card__eyebrow');
    copy.appendChild(eyebrow);
    const title = el('h3', 'sb-ody-charm-card__title');
    title.id = `${ODYSSEY_CHARM_GUIDE_ID}-card-title`;
    copy.appendChild(title);
    const count = el('p', 'sb-ody-charm-card__count');
    const { pips, cells } = createPips('sb-ody-charm-card__pips', 0, ODYSSEY_CHARM_CAP);
    count.appendChild(pips);
    const countText = el('span', '');
    count.appendChild(countText);
    copy.appendChild(count);
    const rule = el('p', 'sb-ody-charm-card__rule');
    copy.appendChild(rule);
    card.appendChild(copy);

    const facts = el('dl', 'sb-ody-charm-card__facts');
    const useFact = el('div', 'sb-ody-charm-card__fact');
    useFact.appendChild(el('dt', '', 'To use'));
    const use = el('dd', '');
    use.appendChild(el('span', '', 'Press '));
    const useKey = el('kbd', 'sb-kbd');
    use.appendChild(useKey);
    use.appendChild(el('span', '', ' during an orb, or tap its tile.'));
    useFact.appendChild(use);
    facts.appendChild(useFact);
    const whenFact = el('div', 'sb-ody-charm-card__fact');
    whenFact.appendChild(el('dt', '', 'When it helps'));
    const when = el('dd', '');
    whenFact.appendChild(when);
    facts.appendChild(whenFact);
    card.appendChild(facts);

    const fill = (entry) => {
        if (card.dataset) {
            card.dataset.charm = entry.id;
            card.dataset.held = String(entry.held);
        }
        eyebrow.textContent = entry.held ? 'In your bag' : 'Not in your bag yet';
        title.textContent = entry.name;
        cells.forEach((cell, index) => { cell.className = index < entry.count ? 'is-held' : ''; });
        countText.textContent = `${entry.count} of ${entry.cap}`;
        rule.textContent = entry.rule;
        useKey.textContent = entry.key;
        when.textContent = entry.when;
        heroes.forEach((slot, id) => { slot.hidden = id !== entry.id; });
    };
    return { card, fill };
}

/** How charms work: five steps on a path, each a numbered gem, its word and its rule. */
function createRules(guide) {
    const rules = el('section', 'sb-ody-charm-guide__rules');
    rules.setAttribute?.('aria-label', 'How charms work');
    rules.appendChild(el('p', 'sb-eyebrow sb-eyebrow--quiet sb-ody-charm-guide__rules-label', 'How charms work'));
    const steps = el('ol', 'sb-ody-charm-guide__steps');
    guide.steps.forEach((step, index) => {
        const item = el('li', 'sb-ody-charm-guide__step');
        if (index < guide.steps.length - 1 && item.dataset) item.dataset.link = '';
        const gem = el('span', 'sb-ody-charm-guide__gem', String(index + 1));
        gem.ariaHidden = 'true';
        item.appendChild(gem);
        const text = el('div', 'sb-ody-charm-guide__step-copy');
        text.appendChild(el('strong', '', step.title));
        text.appendChild(el('p', '', step.line));
        item.appendChild(text);
        steps.appendChild(item);
    });
    rules.appendChild(steps);
    return rules;
}

/** The footer: the keys and buttons the page answers. */
function createFooter() {
    const footer = el('footer', 'sb-ody-charms__footer');
    const hints = el('ul', 'sb-hints sb-ody-charms__hints');
    hints.ariaHidden = 'true';
    const hint = (caps, label) => {
        const item = el('li', '');
        // A hint with no controller button leaves the footer while the pad is in hand.
        if (caps.every(([, pad]) => !pad) && item.dataset) item.dataset.keysOnly = '';
        caps.forEach(([key, pad]) => keycaps(item, key, pad));
        item.appendChild(el('span', '', label));
        hints.appendChild(item);
    };
    hint([['↑', 'LB'], ['↓', 'RB']], 'Charm');
    hint([['1–4', null]], 'Its key in an orb');
    hint([['Esc', 'B']], 'Map');
    footer.appendChild(hints);
    return footer;
}

/** Play a node's entrance again (odyssey-navigator-list.js does the same for its card). */
function restartEntrance(node, className) {
    if (!node?.classList) return;
    node.classList.remove(className);
    if (node.offsetWidth >= 0) node.classList.add(className);
}

/** The charm a step from `id` lands on, round the rail. */
function stepCharm(charms, id, step) {
    const index = charms.findIndex((entry) => entry.id === id);
    return charms[(index + step + charms.length) % charms.length].id;
}

/** Arrow keys that walk the rail; the strip of chips on narrow windows walks across. */
const RAIL_STEPS = Object.freeze({
    ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1,
});

/**
 * Build the guide page. The caller mounts it; `modal.dispose()` removes it.
 * @param {{ counts?: Record<string, number>, stats?: object, selected?: string, onClose?: () => void }} options
 * @returns {HTMLElement} the modal root
 */
export function createOdysseyCharmGuideSheet({
    counts, stats, selected, onClose,
} = {}) {
    const guide = describeOdysseyCharmGuide({ counts, stats });
    const { modal, panel } = createKeystoneSheet({ id: ODYSSEY_CHARM_GUIDE_ID, label: 'Charms', variant: 'charms' });

    const tabs = new Map();
    const { card, fill } = createCard(guide);
    // The selected charm's light, behind the page: it blooms again when the charm changes.
    const glow = el('div', 'sb-ody-charms__glow');
    glow.ariaHidden = 'true';
    modal.appendChild(glow);
    const stage = el('section', 'sb-ody-charms__stage');
    stage.id = STAGE_ID;
    stage.setAttribute?.('role', 'tabpanel');
    let current = null;
    const select = (id, { focus = false } = {}) => {
        const entry = guide.charms.find((charm) => charm.id === id);
        if (!entry) return;
        if (focus) tabs.get(id)?.focus?.({ preventScroll: true });
        if (current === id) return;
        const first = current === null;
        current = id;
        if (modal.dataset) modal.dataset.charm = id;
        tabs.forEach((tab, tabCharm) => tab.setAttribute?.('aria-selected', String(tabCharm === id)));
        stage.setAttribute?.('aria-labelledby', tabId(id));
        fill(entry);
        if (first) return;
        // The card settles in again for each charm and its light blooms (the navigator's card and
        // sky do the same).
        restartEntrance(card, 'is-entering');
        restartEntrance(glow, 'is-entering');
    };

    const { header, back } = createHeader(guide, select);
    panel.appendChild(header);

    const body = el('div', 'sb-ody-charms__body');
    const rail = el('nav', 'sb-ody-charms__rail');
    rail.setAttribute?.('aria-label', 'The four charms');
    rail.appendChild(el('p', 'sb-eyebrow sb-eyebrow--quiet sb-ody-charms__rail-label', 'The four charms'));
    const list = el('ul', 'sb-ody-charm-guide');
    list.setAttribute?.('role', 'tablist');
    list.setAttribute?.('aria-orientation', 'vertical');
    guide.charms.forEach((entry) => {
        const { row, tab } = charmRow(entry, select);
        tabs.set(entry.id, tab);
        list.appendChild(row);
    });
    rail.appendChild(list);
    body.appendChild(rail);

    stage.appendChild(card);
    body.appendChild(stage);
    // The rail and the card, then the path under both: the page's middle, centred as one.
    const main = el('div', 'sb-ody-charms__main');
    main.appendChild(body);
    main.appendChild(createRules(guide));
    panel.appendChild(main);
    panel.appendChild(createFooter());

    select(guide.charms.some((entry) => entry.id === selected) ? selected : guide.selected);

    const close = () => onClose?.();
    back.addEventListener('click', close);
    modal.addEventListener('keydown', (event) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        // 1 to 4 show the charm that key uses during an orb.
        const byKey = guide.charms.find((entry) => entry.key === event.key);
        if (byKey) {
            event.preventDefault();
            select(byKey.id, { focus: true });
            return;
        }
        if (!event.target?.closest?.('[role="tab"]')) return;
        let target = null;
        if (RAIL_STEPS[event.key]) target = stepCharm(guide.charms, current, RAIL_STEPS[event.key]);
        else if (event.key === 'Home') target = guide.charms[0].id;
        else if (event.key === 'End') target = guide.charms[guide.charms.length - 1].id;
        if (!target) return;
        event.preventDefault();
        select(target, { focus: true });
    });
    // A click on the page around the stage closes it too; a click on anything in it does not.
    modal.addEventListener('click', (event) => {
        if (event.target === modal) close();
    });
    /** LB and RB (gamepad-controller.js): the previous or next charm, round the rail. */
    modal.stepCharm = (step) => select(stepCharm(guide.charms, current, step < 0 ? -1 : 1), { focus: true });
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
