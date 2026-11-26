// @ts-check

/**
 * A versus match's attack style in words, for the surfaces that tell a player what kind of
 * room it is: the match list, the waiting room and the match bar. The rules themselves are in
 * versus-rules.js, garbage.js, blind.js and hot-potato.js (ADR-0025); nothing here changes play.
 */

import { MIN_ATTACK_LINES_DEFAULT, readMinAttackLines } from '../garbage.js';

/** Versus attack styles, as the create sheet offers them. */
export const VERSUS_ATTACK_STYLES = Object.freeze(['standard', 'blind', 'full_blind', 'hot_potato', 'peaceful']);

/** @typedef {'standard' | 'blind' | 'full_blind' | 'hot_potato' | 'peaceful'} VersusAttackStyle */

/**
 * @typedef {{
 *   attackStyle?: unknown, hotPotato?: unknown,
 *   attackRules?: { forceAttackType?: unknown, disableAttacks?: unknown } | null,
 *   minAttackLines?: unknown, garbageCancellation?: unknown, boringRules?: unknown,
 * } | null | undefined} AttackConfig
 */

const ATTACK_STYLE_NAMES = Object.freeze({
    standard: 'Standard',
    blind: 'Blind',
    full_blind: 'Full blind',
    hot_potato: 'Hot potato',
    peaceful: 'Peaceful',
});

/**
 * A match's attack style. The create sheet writes `attackStyle`; a config without it is read
 * from the rules the style sets (hot potato's switch, a forced attack type, attacks off).
 * @param {AttackConfig} config
 * @returns {VersusAttackStyle}
 */
export function readVersusAttackStyle(config) {
    const style = config?.attackStyle;
    if (typeof style === 'string' && VERSUS_ATTACK_STYLES.includes(style)) {
        return /** @type {VersusAttackStyle} */ (style);
    }
    if (config?.hotPotato) return 'hot_potato';
    const forced = config?.attackRules?.forceAttackType;
    if (forced === 'blind' || forced === 'full_blind') return forced;
    return config?.attackRules?.disableAttacks ? 'peaceful' : 'standard';
}

/**
 * The attack style in a word or two.
 * @param {AttackConfig} config
 */
export function describeVersusAttackStyle(config) {
    return ATTACK_STYLE_NAMES[readVersusAttackStyle(config)];
}

/**
 * A match's attack rules for a guest who did not set them: the style, then every setting that
 * is off its default, one short phrase each. ["Standard"], ["Blind", "attacks from 3 lines",
 * "cancelling on"]. A peaceful match sends nothing, so its other settings go unsaid.
 * @param {AttackConfig} config
 * @returns {string[]}
 */
export function listVersusAttackRules(config) {
    const style = readVersusAttackStyle(config);
    /** @type {string[]} */
    const rules = [ATTACK_STYLE_NAMES[style]];
    if (style === 'peaceful') return rules;
    const smallest = readMinAttackLines(config?.minAttackLines);
    // The create sheet's "Smallest attacking clear": a clear of fewer lines sends nothing.
    if (smallest !== MIN_ATTACK_LINES_DEFAULT) rules.push(`attacks from ${smallest} lines`);
    if (config?.garbageCancellation && config.garbageCancellation !== 'disabled') rules.push('cancelling on');
    if (config?.boringRules) rules.push('no attack scaling');
    return rules;
}

/**
 * The same rules in one line: "Blind · attacks from 3 lines · cancelling on".
 * @param {AttackConfig} config
 */
export function describeVersusAttackRules(config) {
    return listVersusAttackRules(config).join(' · ');
}
