// @ts-check

/**
 * Waystones climates: how a world bends the rules for one stop, and what the stop asks.
 *
 * A climate is a speed, a few rule modifiers and a goal. The modifiers are Odyssey's
 * (src/core/odyssey/ModifierStack.js: mirror, speed-up, slow-start, combo-multiplier) plus
 * two of this mode's own that WaystonesMode applies itself: `mist` hides the queue and
 * `long-breath` slows gravity and lengthens the lock. Goals count only what happens at the
 * stop: lines cleared, points scored, or cascades at least two waves deep (the board's
 * "×2" combo popup or deeper).
 */

import { MODIFIER_DEFINITIONS } from '../odyssey/ModifierStack.js';
import { LEVEL_SPEEDS } from '../constants.js';

/**
 * @typedef {'lines' | 'score' | 'cascades'} ClimateGoalType
 * @typedef {{ type: ClimateGoalType, base: number }} ClimateGoal
 * @typedef {Object} Climate
 * @property {string} id
 * @property {string} name
 * @property {string} line one sentence for the briefing
 * @property {number} level the speed level the stop starts at (constants LEVEL_SPEEDS)
 * @property {string[]} modifiers modifier ids, Odyssey's or this mode's
 * @property {ClimateGoal} goal
 */

/**
 * What each modifier is called on the road, in this mode's own words. Odyssey's names and
 * tooltips ("Speed increases faster than normal") describe level progression, which the
 * road holds still: here Fast fall is a flat half again, Slow fall a flat third less.
 */
export const MODIFIER_WORDS = Object.freeze({
    mirror: Object.freeze({ name: 'Mirror', description: 'Left and right are swapped.' }),
    'speed-up': Object.freeze({ name: 'Fast fall', description: 'Gravity pulls half again as hard.' }),
    'slow-start': Object.freeze({ name: 'Slow fall', description: 'Gravity eases by a third.' }),
    'combo-multiplier': Object.freeze({ name: 'Chain bonus', description: 'Clear after clear scores more.' }),
    mist: Object.freeze({ name: 'Mist', description: 'The queue is hidden: each piece arrives unannounced.' }),
    'long-breath': Object.freeze({ name: 'Long breath', description: 'Gravity is slow and the lock is patient.' }),
});

/** The modifiers WaystonesMode applies itself; the rest are Odyssey's ModifierStack. */
export const OWN_MODIFIERS = Object.freeze(['mist', 'long-breath']);

/** Long breath: gravity this much slower, the lock this much longer. */
export const LONG_BREATH = Object.freeze({ dropFactor: 1.6, lockFactor: 1.8 });

/**
 * @param {string} id
 * @returns {{ id: string, name: string, description: string } | null}
 */
export function modifierInfo(id) {
    const words = MODIFIER_WORDS[/** @type {keyof typeof MODIFIER_WORDS} */ (id)];
    if (words) return { id, name: words.name, description: words.description };
    const definition = MODIFIER_DEFINITIONS[id];
    return definition ? { id, name: definition.name, description: definition.description } : null;
}

/**
 * The asks are a ladder by how hard the weather is for a careful player, not for a bot:
 * mirrored controls cost more than fast gravity, a slow fall is a gift, a hidden queue
 * costs little. The bot certifies that each is reachable; a playtest sets the numbers.
 * @type {readonly Climate[]}
 */
export const CLIMATES = Object.freeze([
    {
        id: 'clear-night',
        name: 'Clear night',
        line: 'Nothing bends the rules. The well as you know it.',
        level: 2,
        modifiers: [],
        goal: { type: 'lines', base: 10 },
    },
    {
        id: 'still-air',
        name: 'Still air',
        line: 'Slow gravity and a patient lock. Build what you mean to.',
        level: 1,
        modifiers: ['long-breath'],
        goal: { type: 'lines', base: 12 },
    },
    {
        id: 'rising-wind',
        name: 'Rising wind',
        line: 'Gravity pulls harder here. Keep the stack low.',
        level: 2,
        modifiers: ['speed-up'],
        goal: { type: 'lines', base: 9 },
    },
    {
        id: 'mirror-pool',
        name: 'Mirror pool',
        line: 'Left is right and right is left.',
        level: 2,
        modifiers: ['mirror'],
        goal: { type: 'lines', base: 7 },
    },
    {
        id: 'mist',
        name: 'Mist',
        line: 'The queue is hidden. Each piece arrives unannounced.',
        level: 2,
        modifiers: ['mist'],
        goal: { type: 'lines', base: 9 },
    },
    {
        id: 'ember-wind',
        name: 'Ember wind',
        line: 'Clear after clear scores more. Keep the chain alive.',
        level: 2,
        modifiers: ['combo-multiplier'],
        goal: { type: 'score', base: 3500 },
    },
    {
        id: 'slow-dusk',
        name: 'Slow dusk',
        line: 'The evening falls slowly. Make every clear count.',
        level: 2,
        modifiers: ['slow-start'],
        goal: { type: 'score', base: 3000 },
    },
    {
        id: 'deep-current',
        name: 'Deep current',
        line: 'Leave a gap under an overhang. When the row beneath clears, what falls may finish another.',
        level: 1,
        modifiers: ['long-breath'],
        goal: { type: 'cascades', base: 2 },
    },
    {
        id: 'crosswind',
        name: 'Crosswind',
        line: 'Mirrored controls under a patient lock.',
        level: 2,
        modifiers: ['mirror', 'long-breath'],
        goal: { type: 'lines', base: 8 },
    },
    {
        id: 'squall',
        name: 'Squall',
        line: 'Fast gravity and a hidden queue.',
        level: 2,
        modifiers: ['speed-up', 'mist'],
        goal: { type: 'lines', base: 7 },
    },
]);

/** @param {string} id */
export function climateById(id) {
    return CLIMATES.find((climate) => climate.id === id) || null;
}

/**
 * Gentle enough for the first stop of a road: a lines ask with nothing bent but, at most,
 * a long breath. A new player's first stop never reverses their controls or asks for a
 * cascade they have not been shown.
 * @param {Climate} climate
 */
export function isGentle(climate) {
    return climate.goal.type === 'lines' && climate.modifiers.every((id) => id === 'long-breath');
}

/**
 * How long a row takes to fall under the climate, in ms: the same arithmetic the mode
 * applies to the GameState (baseline, then Odyssey's modifiers, then long breath).
 * @param {Climate} climate
 */
export function effectiveDropMs(climate) {
    let ms = LEVEL_SPEEDS[Math.min(climate.level, LEVEL_SPEEDS.length) - 1];
    if (climate.modifiers.includes('speed-up')) ms /= 1.5;
    if (climate.modifiers.includes('slow-start')) ms = Math.min(ms * 1.5, 2000);
    if (climate.modifiers.includes('long-breath')) ms = Math.round(ms * LONG_BREATH.dropFactor);
    return ms;
}

/** The pace in one word, for the offer card. @param {Climate} climate */
export function paceWord(climate) {
    const ms = effectiveDropMs(climate);
    if (ms >= 900) return 'slow';
    if (ms >= 420) return 'unhurried';
    if (ms >= 260) return 'steady';
    return 'brisk';
}

/**
 * The goal as a sentence.
 * @param {{ type: ClimateGoalType, target: number }} goal
 */
export function goalText(goal) {
    const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
    if (goal.type === 'lines') return `Clear ${plural(goal.target, 'line', 'lines')}`;
    if (goal.type === 'score') return `Score ${goal.target.toLocaleString('en-US')} points`;
    return `Set off ${plural(goal.target, 'cascade', 'cascades')} (a ×2 or deeper)`;
}

/** Every modifier a climate names must exist, so a typo cannot ship as "no rule". */
export function validateClimates(climates = CLIMATES) {
    const problems = [];
    const ids = new Set();
    for (const climate of climates) {
        if (ids.has(climate.id)) problems.push(`duplicate climate id '${climate.id}'`);
        ids.add(climate.id);
        for (const id of climate.modifiers) {
            if (!modifierInfo(id)) problems.push(`climate '${climate.id}' names unknown modifier '${id}'`);
        }
        if (!['lines', 'score', 'cascades'].includes(climate.goal.type)) {
            problems.push(`climate '${climate.id}' has an unknown goal type`);
        }
        if (!(climate.goal.base > 0)) problems.push(`climate '${climate.id}' asks for nothing`);
        if (!(climate.level >= 1)) problems.push(`climate '${climate.id}' has no speed level`);
    }
    if (!climates.some(isGentle)) problems.push('no climate is gentle enough for a first stop');
    return problems;
}
