// @ts-check

/**
 * Odyssey charms: gather, keep, spend (docs/ODYSSEY_CHARMS_AUDIT_2026-10.md §5).
 *
 * A charm is a typed consumable. Clearing an orb leaves one behind (two for three stars), the
 * bag keeps at most three of each for the journey, and during an orb one key press spends one.
 * Nothing is chosen on the way in: the drop is picked for the road ahead, and after three falls
 * in a row on one orb the road leaves the one charm that helps there. Full stars, always.
 *
 * This module is the rules and the bag: the catalogue, the drop, the pity, and the saved shape
 * made whole on load (including the conversion of the older gathered-and-carried bag). What a
 * charm does to a live well lives in odyssey-charm-use.js.
 */
import { isOdysseyTallBoard } from './odyssey-board-shape.js';
import { generateSessionSeed } from '../session-rng.js';

/** Tide: rows cleared from the floor of the well. */
export const ODYSSEY_TIDE_ROWS = 4;
/** Still Air: how long the gentlest fall lasts, and how slow that fall is at most. */
export const ODYSSEY_STILL_AIR_MS = 20000;
export const ODYSSEY_STILL_AIR_SLOWEST_MS = 1500;
/** Long Breath: seconds added to a clock. */
export const ODYSSEY_LONG_BREATH_SECONDS = 30;
/** The bag holds this many of each charm. */
export const ODYSSEY_CHARM_CAP = 3;
/** After this many falls in a row on one orb, the road leaves a charm that helps there... */
export const ODYSSEY_PITY_FALLS = 3;
/** ...but only while fewer than this many of it are held. */
export const ODYSSEY_PITY_HOLD = 2;
/** The glyph every charm line opens with. */
export const ODYSSEY_CHARM_GLYPH = '◆';

/**
 * @typedef {Object} OdysseyCharm
 * @property {string} id
 * @property {string} name
 * @property {string} key the keyboard digit that uses it during an orb
 * @property {string} line what pressing it does, in one sentence that follows the name
 * @property {string} press the same rule as an instruction, for the sheets
 */

/** @type {readonly OdysseyCharm[]} */
export const ODYSSEY_CHARMS = Object.freeze([
    Object.freeze({
        id: 'tide',
        name: 'Tide',
        key: '1',
        line: `clears the bottom ${ODYSSEY_TIDE_ROWS} rows. Once an attempt.`,
        press: `Press 1 to clear the bottom ${ODYSSEY_TIDE_ROWS} rows.`,
    }),
    Object.freeze({
        id: 'still-air',
        name: 'Still Air',
        key: '2',
        line: `slows the fall for ${ODYSSEY_STILL_AIR_MS / 1000} seconds.`,
        press: `Press 2 to slow the fall for ${ODYSSEY_STILL_AIR_MS / 1000} seconds.`,
    }),
    Object.freeze({
        id: 'long-breath',
        name: 'Long Breath',
        key: '3',
        line: `adds ${ODYSSEY_LONG_BREATH_SECONDS} seconds to the clock.`,
        press: `Press 3 for ${ODYSSEY_LONG_BREATH_SECONDS} more seconds.`,
    }),
    Object.freeze({
        id: 'hearth',
        name: 'Hearth',
        key: '4',
        line: 'arm it, and your next top-out clears the well instead of ending the orb.',
        press: 'Press 4 to arm it: your next top-out clears the well.',
    }),
]);

/** @type {readonly string[]} */
export const ODYSSEY_CHARM_IDS = Object.freeze(ODYSSEY_CHARMS.map((charm) => charm.id));

/** @param {string} id */
export function odysseyCharmById(id) {
    return ODYSSEY_CHARMS.find((charm) => charm.id === id) || null;
}

/** The charm objects for a list of ids, unknown ids dropped. @param {readonly string[]} [ids] */
export function describeOdysseyCharms(ids) {
    return (ids || []).map((id) => odysseyCharmById(id)).filter(Boolean);
}

/** A chip's title: "Tide · clears the bottom 4 rows. Once an attempt." @param {OdysseyCharm} charm */
export function odysseyCharmTitle(charm) {
    return charm ? `${charm.name} · ${charm.line}` : '';
}

// =============================
// What an orb asks of a charm
// =============================

/** @param {object | undefined} level the authored orb */
export function odysseyLevelHasClock(level) {
    const failure = level?.victory?.failure;
    return failure?.type === 'time' && Number.isFinite(failure.value) && failure.value > 0;
}

/**
 * Whether a charm does something on this orb. Tide, Still Air and Hearth always do; Long
 * Breath needs a clock. Without an orb at hand every charm is assumed to help.
 * @param {object | undefined} level the authored orb
 * @param {string} charmId
 */
export function odysseyCharmHelps(level, charmId) {
    if (!odysseyCharmById(charmId)) return false;
    if (charmId === 'long-breath') return !level || odysseyLevelHasClock(level);
    return true;
}

/** The charms that do something on this orb, in catalogue order. @param {object | undefined} level */
export function odysseyCharmsThatHelp(level) {
    return ODYSSEY_CHARM_IDS.filter((id) => odysseyCharmHelps(level, id));
}

/**
 * The one charm the road leaves after three falls in a row on an orb: its clock, else its
 * rubble or its height, else its rival, else the pace.
 * @param {object | undefined} level the authored orb
 */
export function odysseyPityCharm(level) {
    if (odysseyLevelHasClock(level)) return 'long-breath';
    const board = level?.mechanics?.board;
    if ((Number(board?.startingRows) || 0) > 0 || isOdysseyTallBoard(board)) return 'tide';
    if (level?.mechanics?.versus) return 'hearth';
    return 'still-air';
}

// =============================
// The bag
// =============================

/**
 * @typedef {Object} OdysseyCharmState
 * @property {Record<string, number>} bag how many of each charm are held, by id
 * @property {number} found charms found this journey
 * @property {number} used charms used this journey
 * @property {{ levelId: number | null, falls: number }} streak falls in a row on one orb
 */

const whole = (value) => Math.max(0, Math.floor(Number(value) || 0));
const capped = (value) => Math.min(ODYSSEY_CHARM_CAP, whole(value));

/** @returns {OdysseyCharmState} */
export function createOdysseyCharmState() {
    return {
        bag: Object.fromEntries(ODYSSEY_CHARM_IDS.map((id) => [id, 0])),
        found: 0,
        used: 0,
        streak: { levelId: null, falls: 0 },
    };
}

/**
 * The older bag (2026-10-18: a gathered list, three carried, drafts) converted so nobody loses
 * what they gathered: a charm that still exists keeps its name; any other becomes the next
 * charm of the new catalogue in turn. Carried and drafts are dropped; nothing is chosen now.
 * @param {readonly unknown[]} gathered
 * @returns {OdysseyCharmState}
 */
export function migrateOdysseyGatheredCharms(gathered) {
    const state = createOdysseyCharmState();
    let turn = 0;
    const nextInTurn = () => {
        for (let step = 0; step < ODYSSEY_CHARM_IDS.length; step += 1) {
            const id = ODYSSEY_CHARM_IDS[(turn + step) % ODYSSEY_CHARM_IDS.length];
            if (state.bag[id] < ODYSSEY_CHARM_CAP) {
                turn = (turn + step + 1) % ODYSSEY_CHARM_IDS.length;
                return id;
            }
        }
        return null;
    };
    for (const old of gathered) {
        if (typeof old !== 'string' || !old) continue;
        const kept = odysseyCharmById(old) && state.bag[old] < ODYSSEY_CHARM_CAP ? old : nextInTurn();
        if (!kept) break;
        state.bag[kept] += 1;
        state.found += 1;
    }
    return state;
}

/**
 * A saved charm state made whole: unknown charms dropped, counts whole and capped, the streak
 * on one known orb. A save without a bag but with the older gathered list is converted.
 * @param {unknown} raw
 * @returns {OdysseyCharmState}
 */
export function normalizeOdysseyCharmState(raw) {
    const source = /** @type {any} */ (raw);
    if (source && typeof source === 'object' && !source.bag) {
        const gathered = [source.gathered, source.owned].find(Array.isArray);
        if (gathered) return migrateOdysseyGatheredCharms(gathered);
    }
    const state = createOdysseyCharmState();
    const bag = source?.bag && typeof source.bag === 'object' ? source.bag : {};
    ODYSSEY_CHARM_IDS.forEach((id) => { state.bag[id] = capped(bag[id]); });
    state.found = whole(source?.found);
    state.used = whole(source?.used);
    const levelId = Number(source?.streak?.levelId);
    const falls = whole(source?.streak?.falls);
    if (Number.isInteger(levelId) && levelId > 0 && falls > 0) state.streak = { levelId, falls };
    return state;
}

/** The plain copy that goes into the save. @param {OdysseyCharmState} state */
export function serializeOdysseyCharmState(state) {
    const safe = normalizeOdysseyCharmState(state);
    return {
        bag: { ...safe.bag }, found: safe.found, used: safe.used, streak: { ...safe.streak },
    };
}

/** @param {OdysseyCharmState | null | undefined} state @param {string} charmId */
export function odysseyCharmCount(state, charmId) {
    return whole(state?.bag?.[charmId]);
}

/** Every charm held, in catalogue order, with its count. @param {OdysseyCharmState | null | undefined} state */
export function odysseyCharmBagEntries(state) {
    return ODYSSEY_CHARMS
        .map((charm) => ({ ...charm, count: odysseyCharmCount(state, charm.id) }))
        .filter((entry) => entry.count > 0);
}

/** How many charms the bag holds in all. @param {OdysseyCharmState | null | undefined} state */
export function odysseyCharmBagTotal(state) {
    return ODYSSEY_CHARM_IDS.reduce((total, id) => total + odysseyCharmCount(state, id), 0);
}

/**
 * One charm into the bag, counted as found. Refused at the cap and for an unknown charm.
 * @param {OdysseyCharmState} state
 * @param {string} charmId
 */
export function addOdysseyCharm(state, charmId) {
    if (!state?.bag || !odysseyCharmById(charmId) || odysseyCharmCount(state, charmId) >= ODYSSEY_CHARM_CAP) {
        return false;
    }
    state.bag[charmId] = odysseyCharmCount(state, charmId) + 1;
    state.found = whole(state.found) + 1;
    return true;
}

/**
 * One charm out of the bag, counted as used. Refused when none is held.
 * @param {OdysseyCharmState} state
 * @param {string} charmId
 */
export function spendOdysseyCharm(state, charmId) {
    if (!state?.bag || odysseyCharmCount(state, charmId) <= 0) return false;
    state.bag[charmId] -= 1;
    state.used = whole(state.used) + 1;
    return true;
}

// =============================
// Drops: the work
// =============================

/** A clear drops one charm; a three-star clear drops two. @param {number} stars */
export function odysseyCharmDropCount(stars) {
    return whole(stars) >= 3 ? 2 : 1;
}

/**
 * A uniform draw in [0, 1) from the session seed source, so the core adds no clock or dice of
 * its own. A host without Web Crypto (or a test that stubs it away) takes the seed's fallback.
 */
const defaultRandom = () => {
    const provider = globalThis.crypto;
    const cryptoProvider = typeof provider?.getRandomValues === 'function' ? provider : null;
    return generateSessionSeed({ cryptoProvider }) / 4294967296;
};

/**
 * The charm a clear leaves: uniformly among the charms that do something on the next uncleared
 * orb and are not yet at their cap. Null when the bag is full of everything that would help.
 * @param {OdysseyCharmState} state
 * @param {object | undefined} nextLevel the next uncleared orb (or none at the end of the road)
 * @param {() => number} [random] a draw in [0, 1)
 */
export function pickOdysseyCharmDrop(state, nextLevel, random = defaultRandom) {
    const candidates = odysseyCharmsThatHelp(nextLevel)
        .filter((id) => odysseyCharmCount(state, id) < ODYSSEY_CHARM_CAP);
    if (!candidates.length) return null;
    const draw = Number(random());
    const last = candidates.length - 1;
    const index = Number.isFinite(draw) ? Math.min(last, Math.max(0, Math.floor(draw * candidates.length))) : 0;
    return candidates[index];
}

/**
 * What a clear leaves in the bag: one charm, two for three stars, each picked for the road
 * ahead. The streak of falls ends with the clear.
 * @param {OdysseyCharmState} state
 * @param {object | undefined} nextLevel the next uncleared orb
 * @param {number} stars the clear's stars
 * @param {() => number} [random]
 * @returns {string[]} the charm ids found, in order
 */
export function dropOdysseyCharms(state, nextLevel, stars, random = defaultRandom) {
    const found = [];
    clearOdysseyCharmStreak(state);
    for (let count = odysseyCharmDropCount(stars); count > 0; count -= 1) {
        const id = pickOdysseyCharmDrop(state, nextLevel, random);
        if (!id || !addOdysseyCharm(state, id)) break;
        found.push(id);
    }
    return found;
}

// =============================
// Pity: the road's mercy
// =============================

/** One more fall on an orb; a fall on another orb starts the count over. @param {OdysseyCharmState} state */
export function recordOdysseyCharmFall(state, levelId) {
    const id = Number(levelId);
    if (!state) return { levelId: id, falls: 0 };
    const same = state.streak?.levelId === id;
    state.streak = { levelId: id, falls: same ? whole(state.streak.falls) + 1 : 1 };
    return { ...state.streak };
}

/** A clear, anywhere, ends the streak. @param {OdysseyCharmState} state */
export function clearOdysseyCharmStreak(state) {
    if (state) state.streak = { levelId: null, falls: 0 };
}

/**
 * After every third fall in a row on one orb, the charm that helps there, while fewer than two
 * of it are held. Adds it to the bag and returns its id, or null when nothing is owed.
 * @param {OdysseyCharmState} state
 * @param {object | undefined} level the authored orb fallen on
 * @param {number} [levelId] the orb's id when no orb is at hand
 */
export function claimOdysseyPity(state, level, levelId = level?.id) {
    const id = Number(levelId);
    const falls = state?.streak?.levelId === id ? whole(state.streak.falls) : 0;
    if (falls < ODYSSEY_PITY_FALLS || falls % ODYSSEY_PITY_FALLS !== 0) return null;
    const charmId = odysseyPityCharm(level);
    if (odysseyCharmCount(state, charmId) >= ODYSSEY_PITY_HOLD) return null;
    return addOdysseyCharm(state, charmId) ? charmId : null;
}
