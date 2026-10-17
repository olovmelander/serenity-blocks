// @ts-check

/**
 * Waystones climates: how a world bends the rules for one stop, and what the stop asks.
 *
 * A climate is a speed, a few rule modifiers and a goal. The modifiers are Odyssey's
 * (src/core/odyssey/ModifierStack.js: mirror, speed-up, slow-start, combo-multiplier) plus
 * two of this mode's own that WaystonesMode applies itself: `mist` hides the queue and
 * `long-breath` slows gravity and lengthens the lock. Goals count only what happens at the
 * stop: lines cleared, points scored, or cascades at least two waves deep.
 */

import { MODIFIER_DEFINITIONS } from '../odyssey/ModifierStack.js';

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

/** The modifiers that are this mode's own; Odyssey's come from MODIFIER_DEFINITIONS. */
export const WAYSTONES_MODIFIERS = Object.freeze({
    mist: Object.freeze({ name: 'Mist', description: 'The queue is hidden: each piece arrives unannounced.' }),
    'long-breath': Object.freeze({ name: 'Long breath', description: 'Gravity is slow and the lock is patient.' }),
});

/** Long breath: gravity this much slower, the lock this much longer. */
export const LONG_BREATH = Object.freeze({ dropFactor: 1.6, lockFactor: 1.8 });

/**
 * @param {string} id
 * @returns {{ id: string, name: string, description: string } | null}
 */
export function modifierInfo(id) {
    const own = WAYSTONES_MODIFIERS[/** @type {keyof typeof WAYSTONES_MODIFIERS} */ (id)];
    if (own) return { id, name: own.name, description: own.description };
    const definition = MODIFIER_DEFINITIONS[id];
    return definition ? { id, name: definition.name, description: definition.description } : null;
}

/** @type {readonly Climate[]} */
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
        goal: { type: 'lines', base: 8 },
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
        goal: { type: 'lines', base: 8 },
    },
    {
        id: 'mist',
        name: 'Mist',
        line: 'The queue is hidden. Each piece arrives unannounced.',
        level: 2,
        modifiers: ['mist'],
        goal: { type: 'lines', base: 8 },
    },
    {
        id: 'ember-wind',
        name: 'Ember wind',
        line: 'Clear after clear multiplies the score. Keep the chain alive.',
        level: 2,
        modifiers: ['combo-multiplier'],
        goal: { type: 'score', base: 2400 },
    },
    {
        id: 'slow-dusk',
        name: 'Slow dusk',
        line: 'The evening starts slowly. Score before it quickens.',
        level: 2,
        modifiers: ['slow-start'],
        goal: { type: 'score', base: 2000 },
    },
    {
        id: 'deep-current',
        name: 'Deep current',
        line: 'What falls can finish the row beneath it. Set off cascades.',
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
        goal: { type: 'lines', base: 7 },
    },
    {
        id: 'squall',
        name: 'Squall',
        line: 'Fast gravity and a hidden queue. The hardest weather on the road.',
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
 * The goal as a sentence.
 * @param {{ type: ClimateGoalType, target: number }} goal
 */
export function goalText(goal) {
    const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
    if (goal.type === 'lines') return `Clear ${plural(goal.target, 'line', 'lines')}`;
    if (goal.type === 'score') return `Score ${goal.target.toLocaleString('en-US')} points`;
    return `Set off ${plural(goal.target, 'cascade', 'cascades')} two waves deep`;
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
    return problems;
}
