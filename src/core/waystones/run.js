// @ts-check

/**
 * A Waystones run: the road, where the player is on it, what they carry and what they hold.
 *
 * Pure state, no engine: WaystonesMode feeds it what happened on the board (lines, points,
 * cascades, a top-out) and asks it what the stop wants next. Between stops the player
 * settles the stack (bank or release), may take a charm, then chooses the next world; the
 * run accepts those in that order and refuses anything out of turn.
 */

import { charmById } from './charms.js';
import {
    draftCharms, generateRoad, offerClimate, scaledGoal,
} from './road.js';

/** @typedef {import('./road.js').Road} Road */
/** @typedef {import('./road.js').Offer} Offer */
/** @typedef {import('./road.js').World} World */
/** @typedef {import('./climates.js').Climate} Climate */

/** Lanterns at the start of a road. */
export const LANTERNS = 3;
/** Points for each row carried into the next stop. */
export const BANK_TOLL_PER_ROW = 60;

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
 * @property {number} carriedRows the stack's height when the stop began
 * @property {number} topOuts at this stop
 */

/**
 * @typedef {Object} BetweenState
 * @property {boolean | null} banked null until the stack is settled
 * @property {number} carriedRows rows carried on (0 after a release)
 * @property {number} toll points the bank paid
 * @property {string[]} draft charm ids on offer
 * @property {string | null} charmTaken
 * @property {boolean} charmSettled taken or skipped
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
 * @property {number} bankedRows over the whole road
 * @property {number} toll points paid for banking over the whole road
 * @property {StopState} stop
 * @property {BetweenState | null} between
 * @property {StopState[]} history stops completed
 * @property {{ won: boolean, reason: 'keeper' | 'lanterns' } | null} ended
 */

/**
 * @param {WaystonesRun} run
 * @param {Offer} offer
 * @param {number} index
 * @param {number} carriedRows
 * @returns {StopState}
 */
function startStop(run, offer, index, carriedRows) {
    const climate = offerClimate(offer);
    const { keeper } = run.road.stops[index];
    return {
        index,
        world: offer.world,
        climate,
        goal: scaledGoal(climate, { carriedRows, keeper, keel: run.charms.includes('keel') }),
        progress: 0,
        lines: 0,
        score: 0,
        cascades: 0,
        carriedRows,
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
        bankedRows: 0,
        toll: 0,
        stop: /** @type {StopState} */ (/** @type {unknown} */ (null)),
        between: null,
        history: [],
        ended: null,
    };
    run.stop = startStop(run, road.stops[0].offers[0], 0, 0);
    return run;
}

/** @param {WaystonesRun} run */
export function isLastStop(run) {
    return run.stopIndex >= run.road.stops.length - 1;
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
 * The stop's goal is met: the road ends at the Keeper, otherwise the between-stops
 * choices open with a draft of three charms.
 * @param {WaystonesRun} run
 */
export function completeStop(run) {
    if (run.phase !== 'play' || run.stop.progress < run.stop.goal.target) return run;
    run.history.push(run.stop);
    if (isLastStop(run)) {
        run.phase = 'ended';
        run.ended = { won: true, reason: 'keeper' };
        return run;
    }
    run.phase = 'between';
    run.between = {
        banked: null,
        carriedRows: 0,
        toll: 0,
        draft: draftCharms(run.seed, run.stopIndex, run.charms),
        charmTaken: null,
        charmSettled: false,
    };
    return run;
}

/**
 * Keep the stack: it pays a toll now and raises the next ask.
 * @param {WaystonesRun} run
 * @param {number} rows the stack's height
 * @returns {number} the toll paid, or -1 when the stack cannot be banked now
 */
export function bank(run, rows) {
    const { between } = run;
    if (run.phase !== 'between' || !between || between.banked !== null) return -1;
    const carried = Math.max(0, Math.floor(rows));
    const toll = carried * BANK_TOLL_PER_ROW * (run.charms.includes('tide') ? 2 : 1);
    between.banked = true;
    between.carriedRows = carried;
    between.toll = toll;
    run.bankedRows += carried;
    run.toll += toll;
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
    if (charmId === 'lantern') {
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

/** The next stop's offers, once the stack is settled. @param {WaystonesRun} run */
export function nextOffers(run) {
    if (run.phase !== 'between') return [];
    return run.road.stops[run.stopIndex + 1]?.offers || [];
}

/**
 * Set out for one of the next stop's worlds. The stack must be settled first; an unsettled
 * draft counts as skipped.
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
    run.stop = startStop(run, offer, run.stopIndex, between.carriedRows);
    run.between = null;
    run.phase = 'play';
    return true;
}

/**
 * The stack reached the top. Hearth forgives the first at each stop; otherwise a lantern
 * goes out, and the road ends in the dark when the last one does.
 * @param {WaystonesRun} run
 * @returns {{ forgiven: boolean, ended: boolean }}
 */
export function spendLantern(run) {
    if (run.phase !== 'play') return { forgiven: false, ended: run.phase === 'ended' };
    const { stop } = run;
    const forgiven = run.charms.includes('hearth') && stop.topOuts === 0;
    stop.topOuts += 1;
    if (forgiven) return { forgiven: true, ended: false };
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
    const stopsCleared = run.history.length;
    return {
        seed: run.seed,
        won: run.ended?.won === true,
        reason: run.ended?.reason || null,
        stopsCleared,
        stopCount: run.road.stops.length,
        score,
        toll: run.toll,
        bankedRows: run.bankedRows,
        lanternsLeft: run.lanterns,
        charms: run.charms.slice(),
        worlds: run.history.map((stop) => stop.world.name),
    };
}
