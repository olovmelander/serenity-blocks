/**
 * The charm bag as the map and the sheets say it (docs/ODYSSEY_CHARMS_AUDIT_2026-10.md §5.6):
 * the map header's count, the line a clear leaves on the ceremony, the road's mercy on the
 * failure sheet, the orb panel's read-only line and the first arrival's note. Copy only, in
 * the game's calm voice with each rule said plainly; the rules live in
 * core/odyssey/odyssey-charm-bag.js.
 */
import {
    ODYSSEY_CHARM_GLYPH, ODYSSEY_PITY_FALLS, describeOdysseyCharms, odysseyCharmById, odysseyCharmHelps,
} from '../../core/odyssey/odyssey-charm-bag.js';

/** The first arrival's word on charms. */
export const ODYSSEY_CHARM_ARRIVAL_NOTE = 'Clearing an orb leaves you a charm. Press 1–4 during an orb to use one; '
    + 'it is spent when used.';

/** How the map header says an empty bag, and how a charm is found. */
const EMPTY_HEADER = Object.freeze({
    text: '◇ No charms yet',
    title: 'Clearing an orb leaves you a charm. Press 1–4 during an orb to use one.',
});

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

/**
 * The map header's charm line: "◆ 5 charms", with every charm held named in the tooltip.
 * @param {readonly { id: string, name: string, line: string, count: number }[]} entries the bag, held charms only
 */
export function describeOdysseyCharmHeader(entries) {
    const held = (entries || []).filter((entry) => entry.count > 0);
    const total = held.reduce((sum, entry) => sum + entry.count, 0);
    if (!total) return { ...EMPTY_HEADER };
    return {
        text: `${ODYSSEY_CHARM_GLYPH} ${total} ${total === 1 ? 'charm' : 'charms'}`,
        title: held.map((entry) => `${entry.name} ×${entry.count} · ${entry.line}`).join('\n'),
    };
}

/** Write the header line into the map's overlay. */
export function renderOdysseyCharmHeader(entries, node = globalThis.document?.getElementById?.('odyssey-header-charms')) {
    if (!node) return;
    const { text, title } = describeOdysseyCharmHeader(entries);
    node.textContent = text;
    node.title = title;
}

/**
 * The ceremony's line for what the clear left: "◆ Found: Tide · Hearth", and, for the first charm
 * of the journey, how to use it. Null when the clear left nothing.
 * @param {{ charmsFound?: string[], charmsFirstFound?: boolean } | null} results
 * @returns {{ line: string, hint: string | null, words: string[] } | null}
 */
export function describeOdysseyCharmsFound(results) {
    const found = describeOdysseyCharms(results?.charmsFound);
    if (!found.length) return null;
    const line = `${ODYSSEY_CHARM_GLYPH} Found: ${found.map((charm) => charm.name).join(' · ')}`;
    const hint = results?.charmsFirstFound ? `Press ${found[0].key} during an orb to use it.` : null;
    return { line, hint, words: hint ? [line, hint] : [line] };
}

/** The failure sheet's note after the third fall in a row on one orb. Null for an unknown charm. */
export function describeOdysseyCharmPity(charmId) {
    const charm = odysseyCharmById(charmId);
    if (!charm) return null;
    const falls = NUMBER_WORDS[ODYSSEY_PITY_FALLS] || String(ODYSSEY_PITY_FALLS);
    return `${ODYSSEY_CHARM_GLYPH} After ${falls} falls here, the road leaves you ${charm.name}. ${charm.press}`;
}

/**
 * The orb panel's one read-only line: the charms held that do something on this orb.
 * @param {readonly { id: string, name: string, count: number }[]} entries the bag
 * @param {object} level the authored orb
 */
export function describeOdysseyPanelCharms(entries, level) {
    const helping = (entries || []).filter((entry) => entry.count > 0 && odysseyCharmHelps(level, entry.id));
    if (!helping.length) return null;
    const names = helping.map((entry) => (entry.count > 1 ? `${entry.name} ×${entry.count}` : entry.name));
    return `Charms that help here: ${names.join(', ')}.`;
}
