// Local versus by the rules the game ships, for the tools here that build their own match. It
// mirrors LocalMultiplayerMode (the match) and main.js (onPieceLock, spawnPiece): the same
// constants and calls, so a rule changed in versus-rules.js reaches every tool.
//
// 'pre-versus' plays the rules before 6b04e7477 (22 November 2026): a bag of seven, the lock
// delay, rows that would lift any column past the top counted as a top-out, no row limit, no
// credit for rows a garbage settle closes. It keeps the recorded measurements reproducible.
// Choose it per call, or for a whole run with SERENITY_BOT_RULES=pre-versus.
import { applyGarbage, fillBag, spawnPiece } from '../../src/core/game.js';
import { takeSpawnBlinds } from '../../src/core/blind.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { expandGridIfNeeded } from '../../src/core/infinity-grid.js';
import { synchronizeInfinitySimulationCamera } from '../../src/core/infinity-spawn-policy.js';
import { bindLegacySessionRng } from '../../src/core/session-rng.js';
import {
    VERSUS_GARBAGE_OPTIONS, VERSUS_MAX_PENDING_LINES, applyVersusFeel,
} from '../../src/core/multiplayer/versus-rules.js';

export const RULES = Object.freeze(['shipped', 'pre-versus']);

export function versusRules(asked = process.env.SERENITY_BOT_RULES || 'shipped') {
    if (!RULES.includes(asked)) throw RangeError(`Unknown versus rules ${asked}: ${RULES.join(' or ')}`);
    return asked;
}

const shipped = (rules) => versusRules(rules) === 'shipped';

/** The local match LocalMultiplayerMode builds, for `seats` players. */
export function versusMatch(seats, { rules, matchConfig } = {}) {
    if (!shipped(rules)) return new MultiPlayerState(seats);
    const match = new MultiPlayerState(seats, { maxPendingLines: VERSUS_MAX_PENDING_LINES });
    match.players.forEach(applyVersusFeel);
    match.setMatchConfig({ ...match.matchConfig, ...matchConfig });
    return match;
}

/**
 * A Last Standing match as LocalMultiplayerMode builds it: Infinity boards in a well of
 * `wellRows`, without the versus feel (a bag of seven and the lock delay), out at the roof.
 */
export function lastStandingMatch(seats, wellRows, matchConfig = {}) {
    const match = new MultiPlayerState(seats, { maxPendingLines: VERSUS_MAX_PENDING_LINES });
    match.setMatchConfig({ ...match.matchConfig, ...matchConfig, isInfinityLMS: true, infinityMaxRows: wellRows });
    match.reset();
    return match;
}

/** A Last Standing board grows ten rows at a time as its tower nears the top of the grid. */
export function growWell(state) {
    const grid = state.boardGrid;
    if (!state.isInfinityMode || state.isProcessingPhysics || grid.length >= state.maxRows) return;
    if (grid.findIndex((row) => row.some(Boolean)) > 30) return;
    if (expandGridIfNeeded(state, Math.min(state.maxRows, grid.length + 10))) synchronizeInfinitySimulationCamera(state);
}

/** A board's feel, before its first pieces are dealt. */
export function prepareVersusBoard(state, rules) {
    if (shipped(rules)) applyVersusFeel(state);
}

/** The shared deal, from the seed every seat plays. */
export function dealVersus(state, seed) {
    bindLegacySessionRng(state, seed);
    fillBag(state.nextPieces, state.randomGenerator, state.pieceRandomizer);
}

/** What one placement counts for (main.js onPieceLock). */
export function notePlaced(match, seat, rules) {
    if (shipped(rules)) match.notePiecePlaced(seat);
}

/**
 * Everything waiting for a seat goes into its board before its next piece (main.js spawnPiece).
 * @returns {{ rows: number, topOut: boolean, settled: number }} topOut can only be the old rule's
 */
export function takeGarbage(state, queue, { rules, onGarbageReady } = {}) {
    const live = shipped(rules);
    if (live) takeSpawnBlinds(state, queue);
    const entries = [];
    for (let burst = queue.dequeueLineBurst(); burst.length; burst = queue.dequeueLineBurst()) entries.push(...burst);
    if (!entries.length) return { rows: 0, topOut: false, settled: 0 };
    const result = applyGarbage(state, entries, live ? VERSUS_GARBAGE_OPTIONS : {});
    if (result.settleSummary) onGarbageReady?.(result.settleSummary);
    return { rows: entries.length, topOut: result.topOut, settled: result.settleSummary?.totalLines ?? 0 };
}

/**
 * Whether these rows end a player: by the old rule when they would lift any column past the
 * top, by the shipped rule when the next piece then cannot appear. Changes the board.
 */
export function rowsEndPlayer(state, entries, rules) {
    if (!entries.length) return false;
    if (!shipped(rules)) return applyGarbage(state, entries).topOut;
    if (!state.nextPieces.length) throw Error('Judging a spawn needs the player\'s next piece');
    applyGarbage(state, entries, VERSUS_GARBAGE_OPTIONS);
    spawnPiece(state, null, () => {});
    return state.isGameOver;
}
