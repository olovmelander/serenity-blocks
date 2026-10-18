/**
 * The charm bag as the map and the mode hand it around: the header line, what the panel's
 * carry controls do, what a draft's take and pass do, and the road's mercy when the bag already
 * holds what would help. The copy lives here (it reads the orb through objective-copy); the
 * rules live in core/odyssey/odyssey-charms.js.
 */
import {
    LONG_BREATH_SECONDS, ODYSSEY_CHARM_SLOTS, ODYSSEY_MERCY_FALLS, applyOdysseyCharmsToLevel, describeOdysseyCharms,
    odysseyCharmById, odysseyCharmEases,
} from '../../core/odyssey/odyssey-charms.js';
import { formatOdysseyMapObjective } from './objective-copy.js';

const EMPTY_BAG = Object.freeze({ gathered: Object.freeze([]), carried: Object.freeze([]) });

/**
 * What one charm does to this orb, in the orb's own numbers; null when it changes nothing here.
 * @param {object} level the authored orb
 * @param {string} charmId
 * @returns {string | null}
 */
export function describeOdysseyCharmEffect(level, charmId) {
    if (!level || !odysseyCharmEases(level, charmId)) return null;
    const played = applyOdysseyCharmsToLevel(level, [charmId]);
    switch (charmId) {
    case 'keel': {
        const authored = Number(level.victory.primary.target) || 0;
        return `${formatOdysseyMapObjective(played.victory.primary)}, not ${authored.toLocaleString()}`;
    }
    case 'long-breath':
        return `${LONG_BREATH_SECONDS} more seconds on the clock`;
    case 'low-tide': {
        const cleared = (Number(level.mechanics.board.startingRows) || 0) - (played.mechanics.board.startingRows || 0);
        return `${cleared} fewer ${cleared === 1 ? 'row' : 'rows'} of rubble`;
    }
    case 'still-air':
        return 'pieces fall a quarter slower';
    case 'hearth':
        return level.mechanics?.versus ? 'one top-out costs no knockout' : 'one top-out forgiven';
    default:
        return null;
    }
}

/**
 * The bag's charms that would ease this orb but are not carried, each with what it would do.
 * @param {{ gathered: readonly string[], carried: readonly string[] }} bag
 * @param {object} level the authored orb
 * @returns {{ charm: object, effect: string }[]}
 */
export function odysseyUncarriedHelp(bag, level) {
    const uncarried = (bag?.gathered || []).filter((id) => !(bag.carried || []).includes(id));
    return describeOdysseyCharms(uncarried)
        .map((charm) => ({ charm, effect: describeOdysseyCharmEffect(level, charm.id) }))
        .filter((entry) => entry.effect);
}

/** The header's charm line: what is carried, and how the bag stands. */
export function renderOdysseyCharmHeader(mode, node = document.getElementById('odyssey-header-charms')) {
    if (!node) return;
    const bag = mode?.odysseyState?.getCharmBag?.() || EMPTY_BAG;
    const gathered = describeOdysseyCharms(bag.gathered);
    const carried = describeOdysseyCharms(bag.carried);
    if (!gathered.length) {
        node.textContent = '◇ No charms yet';
        node.title = 'Charms: each chapter’s arrival offers one to keep. You carry up to three.';
        return;
    }
    node.textContent = carried.length
        ? `◇ ${carried.map((charm) => charm.name).join(' · ')}`
        : `◇ Carrying none · ${gathered.length} in the bag`;
    node.title = gathered
        .map((charm) => `${bag.carried.includes(charm.id) ? '◆' : '◇'} ${charm.name}: ${charm.line}`)
        .join('\n');
}

/**
 * The panel's charm block as the mode hands it over: the bag, a one-time notice, and the carry
 * toggle, which re-renders the panel and the header so the goal below follows the carried set.
 * @returns {{ gathered: string[], carried: string[], notice: string | null, onToggle: function(string): void } | null}
 */
export function odysseyPanelCharms(mode, levelId) {
    const bag = mode?.odysseyState?.getCharmBag?.();
    if (!bag) return null;
    const notice = mode._charmNotice || null;
    mode._charmNotice = null;
    return {
        ...bag,
        notice,
        onToggle: (charmId) => {
            const result = mode.odysseyState.toggleCarriedCharm(charmId);
            mode._charmNotice = result?.refused
                ? `You carry ${ODYSSEY_CHARM_SLOTS}. Set one down to carry another.` : null;
            mode._updateLevelPreview(levelId);
            mode._updateHeaderProgress?.();
        },
    };
}

/**
 * A draft as the sheets take it: the cards, and what taking or passing does. Taking carries
 * the charm from here; the sheet is told what was set down to make room.
 * @returns {{ charms: object[], onTake: function(string): ({ taken: true, setDown: object | null } | false),
 *   onPass: function(): boolean } | null}
 */
export function describeOdysseyCharmDraft(mode, draft) {
    if (!draft?.charms?.length) return null;
    return {
        charms: draft.charms,
        onTake: (charmId) => {
            const outcome = mode.odysseyState?.takeCharm?.(draft, charmId);
            if (!outcome) return false;
            mode._updateHeaderProgress?.();
            return { taken: true, setDown: outcome.setDown ? odysseyCharmById(outcome.setDown) : null };
        },
        onPass: () => Boolean(mode.odysseyState?.passCharm?.(draft)),
    };
}

/**
 * After a fall: the road's mercy as a draft, or, when the bag already holds what would ease this
 * orb, a word on carrying it. Both ride on the attempt for the failure sheet.
 * @returns {{ charmDraft: object | null, charmHint: string | null }}
 */
export function describeOdysseyMercy(mode, session, falls) {
    const levelId = session?.levelId;
    const charmDraft = describeOdysseyCharmDraft(mode, mode?.odysseyState?.getMercyDraft?.(levelId));
    if (charmDraft || !(Number(falls) >= ODYSSEY_MERCY_FALLS)) return { charmDraft, charmHint: null };
    const level = mode.levelRegistry?.getLevel?.(levelId) || session?.levelConfig;
    const help = odysseyUncarriedHelp(mode.odysseyState?.getCharmBag?.() || EMPTY_BAG, level);
    if (!help.length) return { charmDraft: null, charmHint: null };
    const named = help.map(({ charm, effect }) => `${charm.name} (${effect})`).join(' · ');
    return { charmDraft: null, charmHint: `In your bag, not carried: ${named}. Change what you carry on the map.` };
}
