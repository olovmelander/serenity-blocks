// @ts-check

/**
 * Waystones charms: what you draft between stops and keep for the rest of the road.
 *
 * Three pay points (which buy a lantern back, src/core/waystones/run.js), two move the
 * asks, two keep a run alive. WaystonesMode pays the score charms after each lock's
 * cascade settles; the run model applies the rest. Names avoid the climates' words
 * (Ember wind, Deep current) and the lanterns themselves.
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
        id: 'kindle', name: 'Kindle', kind: 'score', line: 'A cascade two waves deep or more scores half again.',
    },
    {
        id: 'swell', name: 'Swell', kind: 'score', line: 'Three or four lines at once score 40% more.',
    },
    {
        id: 'tide', name: 'Tide', kind: 'score', line: 'Banking the stack pays double.',
    },
    {
        id: 'keel', name: 'Keel', kind: 'goal', line: 'Every stop from here asks 15% less; a cascade stop asks one fewer.',
    },
    {
        id: 'ballast', name: 'Ballast', kind: 'goal', line: 'A banked stack raises the next ask half as much.',
    },
    {
        id: 'hearth', name: 'Hearth', kind: 'safety', line: 'The first top-out of the road costs no lantern.',
    },
    {
        id: 'wick', name: 'Wick', kind: 'safety', line: 'One more lantern.',
    },
]);

/** Kindle: the bonus share of a lock's clear points when its cascade ran this deep. */
export const KINDLE = Object.freeze({ wavesAtLeast: 2, bonusShare: 0.5 });
/** Swell: the bonus share when one wave cleared this many lines. */
export const SWELL = Object.freeze({ linesAtLeast: 3, bonusShare: 0.4 });
/** Tide: banking pays this many times over. */
export const TIDE_FACTOR = 2;
/** Keel: line and score asks are this much less; a cascade ask is one fewer. */
export const KEEL_FACTOR = 0.85;
/** Ballast: a banked stack counts for this much of its rows when the next ask is set. */
export const BALLAST_FACTOR = 0.5;

/** @param {string} id */
export function charmById(id) {
    return CHARMS.find((charm) => charm.id === id) || null;
}
