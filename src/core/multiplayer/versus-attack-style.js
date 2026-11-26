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
 * A match's attack rules in a line, for a guest who did not set them: the style, then every
 * setting that is off its default. "Standard", "Blind · smallest attacking clear 3 ·
 * cancelling on". A peaceful match sends nothing, so its other settings go unsaid.
 * @param {AttackConfig} config
 */
export function describeVersusAttackRules(config) {
    const style = readVersusAttackStyle(config);
    /** @type {string[]} */
    const words = [ATTACK_STYLE_NAMES[style]];
    if (style === 'peaceful') return words[0];
    const smallest = readMinAttackLines(config?.minAttackLines);
    if (smallest !== MIN_ATTACK_LINES_DEFAULT) words.push(`smallest attacking clear ${smallest}`);
    if (config?.garbageCancellation && config.garbageCancellation !== 'disabled') words.push('cancelling on');
    if (config?.boringRules) words.push('no attack scaling');
    return words.join(' · ');
}
