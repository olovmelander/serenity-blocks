// @ts-check

/**
 * A Waystones run: the road, where the player is on it, what they carry and what they hold.
 *
 * Pure state, no engine: WaystonesMode feeds it what happened on the board (lines, points,
 * cascades, a top-out) and asks it what the stop wants next. Between stops the player
 * settles the stack (bank or release), may take a charm, may relight a lantern with
 * points, then chooses the next world; the run accepts those in that order and refuses
 * anything out of turn.
 *
 * The economy: a banked stack pays its toll only once the next stop is cleared (a top-out
 * there loses the stack and the toll with it), and points buy lanterns back. So the
 * choice between stops is carried risk now against safety later, and the score charms
 * are a currency, not a vanity.
 */

import { charmById } from './charms.js';
import {
    draftCharms, generateRoad, offerClimate, scaledGoal, tollFor,
} from './road.js';

export { BANK_TOLL_PER_ROW } from './road.js';

/** @typedef {import('./road.js').Road} Road */
/** @typedef {import('./road.js').Offer} Offer */
/** @typedef {import('./road.js').World} World */
/** @typedef {import('./climates.js').Climate} Climate */

/** Lanterns at the start of a road. */
export const LANTERNS = 3;
/** Points to relight a lantern between stops. */
export const RELIGHT_COST = 1500;

/**
 * @typedef {Object} StopState
 * @property {number} index
 * @property {World} world
 * @property {Climate} climate
 * @property {{ type: import('./climates.js').ClimateGoalType, target: number }} goal
 * @property {number} progress toward the goal, in the goal's unit
 * @property {number} lines cleared at this stop
 * @property {number} score scored at this stop
 * @property {number} cascades two waves deep or more at this stop
 * @property {number} carriedRows rows of blocks banked into this stop
 * @property {number} carriedToll points the banked stack pays once this stop is cleared
 * @property {number} topOuts at this stop
 */

/**
 * @typedef {Object} BetweenState
 * @property {boolean | null} banked null until the stack is settled
 * @property {boolean} autoReleased the well was already empty: nothing to settle
 * @property {number} carriedRows rows carried on (0 after a release)
 * @property {number} toll what the bank will pay once the next stop is cleared
 * @property {string[]} draft charm ids on offer
 * @property {string | null} charmTaken
 * @property {boolean} charmSettled taken or passed
 * @property {boolean} relit a lantern was bought back here
 */

/**
 * @typedef {Object} WaystonesRun
 * @property {string} seed
 * @property {Road} road
 * @property {number} stopIndex
 * @property {'play' | 'between' | 'ended'} phase
 * @property {number} lanterns
 * @property {number} lanternsMax
 * @property {string[]} charms
 * @property {boolean} hearthUsed Hearth forgives one top-out a road
 * @property {number} bankedRows over the whole road
 * @property {number} toll points banked stacks have paid over the whole road
 * @property {number} lastPayout what the last cleared stop paid for its banked stack
 * @property {number} relights lanterns bought back over the whole road
 * @property {StopState} stop
 * @property {BetweenState | null} between
 * @property {StopState[]} history stops completed
 * @property {{ won: boolean, reason: 'keeper' | 'lanterns' } | null} ended
 */

/**
 * @param {WaystonesRun} run
 * @param {Climate} climate
 * @param {number} index
 * @param {number} carriedRows
 */
function askFor(run, climate, index, carriedRows) {
    return scaledGoal(climate, {
        carriedRows,
        keeper: Boolean(run.road.stops[index]?.keeper),
        keel: run.charms.includes('keel'),
        ballast: run.charms.includes('ballast'),
    });
}

/**
 * @param {WaystonesRun} run
 * @param {Offer} offer
 * @param {number} index
 * @param {number} carriedRows
 * @param {number} carriedToll
 * @returns {StopState}
 */
function startStop(run, offer, index, carriedRows, carriedToll) {
    const climate = offerClimate(offer);
    return {
        index,
        world: offer.world,
        climate,
        goal: askFor(run, climate, index, carriedRows),
        progress: 0,
        lines: 0,
        score: 0,
        cascades: 0,
        carriedRows,
        carriedToll,
        topOuts: 0,
    };
}

/**
 * @param {Object} options
 * @param {string} options.seed
 * @param {World} options.startWorld
 * @param {World[]} options.worlds
 * @param {number} [options.lanterns]
 * @returns {WaystonesRun}
 */
export function createRun({
    seed, startWorld, worlds, lanterns = LANTERNS,
}) {
    const road = generateRoad({ seed, startWorld, worlds });
    /** @type {WaystonesRun} */
    const run = {
        seed: road.seed,
        road,
        stopIndex: 0,
        phase: 'play',
        lanterns,
        lanternsMax: lanterns,
        charms: [],
        hearthUsed: false,
        bankedRows: 0,
        toll: 0,
        lastPayout: 0,
        relights: 0,
        stop: /** @type {StopState} */ (/** @type {unknown} */ (null)),
        between: null,
        history: [],
        ended: null,
    };
    run.stop = startStop(run, road.stops[0].offers[0], 0, 0, 0);
    return run;
}

/** @param {WaystonesRun} run */
export function isLastStop(run) {
    return run.stopIndex >= run.road.stops.length - 1;
}

/** The ask of the next stop's offer under the current settlement and charms. @param {WaystonesRun} run */
export function offerAsk(run, offer, carriedRows) {
    return askFor(run, offerClimate(offer), run.stopIndex + 1, carriedRows);
}

/**
 * What the board did at this stop so far. Returns true once the goal is met.
 * @param {WaystonesRun} run
 * @param {{ lines: number, score: number, cascades: number }} totals since the stop began
 */
export function recordStop(run, { lines, score, cascades }) {
    if (run.phase !== 'play') return false;
    const { stop } = run;
    stop.lines = lines;
    stop.score = score;
    stop.cascades = cascades;
    stop.progress = { lines, score, cascades }[stop.goal.type];
    return stop.progress >= stop.goal.target;
}

/**
 * The stop's goal is met: a banked stack pays out, and the road ends at the Keeper or the
 * between-stops choices open with a draft of three charms. An empty well has nothing to
 * settle and counts as released.
 * @param {WaystonesRun} run
 * @param {{ material?: number }} [board] rows of blocks standing in the well
 */
export function completeStop(run, { material = 1 } = {}) {
    if (run.phase !== 'play' || run.stop.progress < run.stop.goal.target) return run;
    run.lastPayout = run.stop.carriedToll;
    run.toll += run.stop.carriedToll;
    run.history.push(run.stop);
    if (isLastStop(run)) {
        run.phase = 'ended';
        run.ended = { won: true, reason: 'keeper' };
        return run;
    }
    run.phase = 'between';
    run.between = {
        banked: null,
        autoReleased: false,
        carriedRows: 0,
        toll: 0,
        draft: draftCharms(run.seed, run.stopIndex, run.charms),
        charmTaken: null,
        charmSettled: false,
        relit: false,
    };
    if (material <= 0) {
        run.between.banked = false;
        run.between.autoReleased = true;
    }
    return run;
}

/**
 * Keep the stack: it raises the next ask and pays once that stop is cleared.
 * @param {WaystonesRun} run
 * @param {number} rows rows of blocks standing in the well
 * @returns {number} what the bank will pay, or -1 when the stack cannot be banked now
 */
export function bank(run, rows) {
    const { between } = run;
    if (run.phase !== 'between' || !between || between.banked !== null) return -1;
    const carried = Math.max(0, Math.floor(rows));
    const toll = tollFor(carried, { tide: run.charms.includes('tide') });
    between.banked = true;
    between.carriedRows = carried;
    between.toll = toll;
    run.bankedRows += carried;
    return toll;
}

/** Clear the well: a clean start and the base ask. @param {WaystonesRun} run */
export function release(run) {
    const { between } = run;
    if (run.phase !== 'between' || !between || between.banked !== null) return false;
    between.banked = false;
    between.carriedRows = 0;
    between.toll = 0;
    return true;
}

/**
 * @param {WaystonesRun} run
 * @param {string} charmId one of the draft
 */
export function takeCharm(run, charmId) {
    const { between } = run;
    if (run.phase !== 'between' || !between || between.charmSettled) return false;
    if (!between.draft.includes(charmId) || run.charms.includes(charmId) || !charmById(charmId)) return false;
    run.charms.push(charmId);
    between.charmTaken = charmId;
    between.charmSettled = true;
    if (charmId === 'wick') {
        run.lanterns += 1;
        run.lanternsMax = Math.max(run.lanternsMax, run.lanterns);
    }
    return true;
}

/** @param {WaystonesRun} run */
export function skipCharm(run) {
    const { between } = run;
    if (run.phase !== 'between' || !between || between.charmSettled) return false;
    between.charmSettled = true;
    return true;
}

/**
 * Whether a lantern can be bought back now, and if not, why.
 * @param {WaystonesRun} run
 * @param {number} score the road's points
 * @returns {{ can: boolean, why: 'done' | 'full' | 'short' | null }}
 */
export function canRelight(run, score) {
    if (run.phase !== 'between' || !run.between) return { can: false, why: null };
    if (run.between.relit) return { can: false, why: 'done' };
    if (run.lanterns >= run.lanternsMax) return { can: false, why: 'full' };
    if (score < RELIGHT_COST) return { can: false, why: 'short' };
    return { can: true, why: null };
}

/**
 * Buys a lantern back for RELIGHT_COST points, once between stops. The caller takes the
 * points off the score.
 * @param {WaystonesRun} run
 * @param {{ score: number }} board
 */
export function relightLantern(run, { score }) {
    if (!canRelight(run, score).can || !run.between) return false;
    run.lanterns += 1;
    run.relights += 1;
    run.between.relit = true;
    return true;
}

/** The next stop's offers, once the stack is settled. @param {WaystonesRun} run */
export function nextOffers(run) {
    if (run.phase !== 'between') return [];
    return run.road.stops[run.stopIndex + 1]?.offers || [];
}

/**
 * Set out for one of the next stop's worlds. The stack must be settled first; an unsettled
 * draft counts as passed.
 * @param {WaystonesRun} run
 * @param {number} offerIndex
 */
export function choose(run, offerIndex) {
    const { between } = run;
    if (run.phase !== 'between' || !between || between.banked === null) return false;
    const offer = nextOffers(run)[offerIndex];
    if (!offer) return false;
    between.charmSettled = true;
    run.stopIndex += 1;
    run.stop = startStop(run, offer, run.stopIndex, between.carriedRows, between.toll);
    run.between = null;
    run.phase = 'play';
    return true;
}

/**
 * The stack reached the top. The well clears either way, so the banked stack and its
 * toll are gone and the ask falls back to the base. Hearth forgives the first top-out of
 * the road; otherwise a lantern goes out, and the road ends in the dark when the last does.
 * @param {WaystonesRun} run
 * @returns {{ forgiven: boolean, ended: boolean }}
 */
export function spendLantern(run) {
    if (run.phase !== 'play') return { forgiven: false, ended: run.phase === 'ended' };
    const { stop } = run;
    stop.topOuts += 1;
    stop.carriedRows = 0;
    stop.carriedToll = 0;
    stop.goal = askFor(run, stop.climate, stop.index, 0);
    if (run.charms.includes('hearth') && !run.hearthUsed) {
        run.hearthUsed = true;
        return { forgiven: true, ended: false };
    }
    run.lanterns -= 1;
    if (run.lanterns <= 0) {
        run.lanterns = 0;
        run.phase = 'ended';
        run.ended = { won: false, reason: 'lanterns' };
        return { forgiven: false, ended: true };
    }
    return { forgiven: false, ended: false };
}

/**
 * The run in one view, for the summary and the stage.
 * @param {WaystonesRun} run
 * @param {number} score the board's score for the whole road
 */
export function summary(run, score) {
    const worlds = run.history.map((stop) => stop.world.name);
    return {
        seed: run.seed,
        won: run.ended?.won === true,
        reason: run.ended?.reason || null,
        stopsCleared: run.history.length,
        stopCount: run.road.stops.length,
        score,
        toll: run.toll,
        bankedRows: run.bankedRows,
        relights: run.relights,
        lanternsLeft: run.lanterns,
        charms: run.charms.slice(),
        worlds,
        uniqueWorlds: new Set(worlds).size,
    };
}
