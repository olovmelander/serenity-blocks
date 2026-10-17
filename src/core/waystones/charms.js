// @ts-check

/**
 * Waystones charms: what you draft between stops and keep for the rest of the road.
 *
 * The lite road's charms are mostly about score, with two that keep a run alive and one
 * that moves the goals. WaystonesMode applies the score charms after each lock's cascade
 * settles, the run model applies the rest (src/core/waystones/run.js).
 */

/**
 * @typedef {Object} Charm
 * @property {string} id
 * @property {string} name
 * @property {string} line one sentence for the draft
 * @property {'score' | 'goal' | 'safety'} kind
 */

/** @type {readonly Charm[]} */
export const CHARMS = Object.freeze([
    {
        id: 'ember', name: 'Ember', kind: 'score', line: 'A cascade two waves deep or more scores half again.',
    },
    {
        id: 'current', name: 'Current', kind: 'score', line: 'Three or four lines at once score 40% more.',
    },
    {
        id: 'tide', name: 'Tide', kind: 'score', line: 'Banking the stack pays double.',
    },
    {
        id: 'keel', name: 'Keel', kind: 'goal', line: 'Every stop from here asks 15% less.',
    },
    {
        id: 'hearth', name: 'Hearth', kind: 'safety', line: 'The first top-out at each stop costs no lantern.',
    },
    {
        id: 'lantern', name: 'Lantern', kind: 'safety', line: 'One more lantern, lit now.',
    },
]);

/** Ember: the bonus share of a lock's points when its cascade ran this deep. */
export const EMBER = Object.freeze({ wavesAtLeast: 2, bonusShare: 0.5 });
/** Current: the bonus share when one wave cleared this many lines. */
export const CURRENT = Object.freeze({ linesAtLeast: 3, bonusShare: 0.4 });
/** Keel: goals ask this much less. */
export const KEEL_FACTOR = 0.85;

/** @param {string} id */
export function charmById(id) {
    return CHARMS.find((charm) => charm.id === id) || null;
}
