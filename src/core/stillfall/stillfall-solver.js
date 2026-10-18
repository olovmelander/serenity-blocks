// @ts-check

/**
 * Exhaustive Stillfall solver. It searches every distinct reachable landing for each
 * supply piece in turn, so a puzzle it calls unsolvable is unsolvable under the real
 * controls, and every solution it returns replays through them. CI runs it over the
 * whole puzzle bank, so a rules change that breaks a shipped puzzle fails the build.
 *
 * A placement is "straight" when its path has no soft drop: rotate and move at the deal
 * row, then drop. A player reasoning about the structure finds those. A placement that
 * needs a soft drop and a slide or a rotation at the bottom (a tuck, a kick) is legal in
 * the game but no puzzle may depend on one: the bank requires a straight solution.
 */

import {
    applyPlacement, createRun, listPlacements,
} from './stillfall-sim.js';

/** @typedef {import('./stillfall-puzzle.js').StillfallPuzzle} StillfallPuzzle */
/** @typedef {import('./stillfall-sim.js').StillfallPlacement} StillfallPlacement */
/** @typedef {import('./stillfall-sim.js').StillfallRun} StillfallRun */

/** The most solutions kept per puzzle; the counts are exact regardless. */
export const MAX_SOLUTIONS_KEPT = 64;

/**
 * @typedef {Object} StillfallSolveReport
 * @property {boolean} solvable
 * @property {StillfallPlacement[]} solution the first straight solution, else the first solution
 * @property {StillfallPlacement[][]} solutions every solution found (up to MAX_SOLUTIONS_KEPT)
 * @property {StillfallPlacement[][]} straightSolutions the solutions made of straight placements only
 * @property {number} solutionCount how many full lines of play solve it
 * @property {number} lines how many full lines of play exist
 * @property {number} minPieces the fewest pieces any solution uses (Infinity when unsolvable)
 * @property {number} openingMoves distinct landings for the first piece
 * @property {number} winningOpenings first landings from which some continuation solves it
 */

/** @param {StillfallPlacement} placement */
export function isStraight(placement) {
    return !placement.actions.some((action) => action.type === 'softDrop');
}

/**
 * @param {StillfallPuzzle} puzzle
 * @returns {StillfallSolveReport}
 */
export function solvePuzzle(puzzle) {
    /** @type {StillfallPlacement[][]} */
    const solutions = [];
    let solutionCount = 0;
    let lines = 0;
    let minPieces = Infinity;

    /**
     * @param {StillfallRun} run
     * @param {StillfallPlacement[]} path
     * @returns {number} solving lines of play below this run
     */
    const search = (run, path) => {
        if (run.outcome !== 'open') {
            lines += 1;
            if (run.outcome !== 'solved') return 0;
            solutionCount += 1;
            minPieces = Math.min(minPieces, path.length);
            if (solutions.length < MAX_SOLUTIONS_KEPT) solutions.push(path);
            return 1;
        }
        const placements = listPlacements(run);
        if (placements.length === 0) {
            lines += 1;
            return 0;
        }
        let solving = 0;
        for (const placement of placements) {
            solving += search(applyPlacement(run, placement).run, [...path, placement]);
        }
        return solving;
    };

    const start = createRun(puzzle);
    const openings = listPlacements(start);
    let winningOpenings = 0;
    for (const placement of openings) {
        if (search(applyPlacement(start, placement).run, [placement]) > 0) winningOpenings += 1;
    }
    const straightSolutions = solutions.filter((path) => path.every(isStraight));
    return {
        solvable: solutionCount > 0,
        solution: straightSolutions[0] || solutions[0] || [],
        solutions,
        straightSolutions,
        solutionCount,
        lines,
        minPieces,
        openingMoves: openings.length,
        winningOpenings,
    };
}

/**
 * A straight-drop line of play that solves the puzzle from this run on, or null. Used
 * for a hint when the pieces placed so far have left the stored solution.
 * @param {StillfallRun} run
 * @returns {StillfallPlacement[] | null}
 */
export function solveFrom(run) {
    if (run.outcome === 'solved') return [];
    if (run.outcome !== 'open') return null;
    for (const placement of listPlacements(run)) {
        if (!isStraight(placement)) continue;
        const rest = solveFrom(applyPlacement(run, placement).run);
        if (rest) return [placement, ...rest];
    }
    return null;
}

/**
 * Whether every piece in the supply is needed: dealing only a later part of the supply
 * (dropping the first piece, then the first two, …) never solves the puzzle.
 * @param {StillfallPuzzle} puzzle
 * @returns {boolean}
 */
export function everyPieceMatters(puzzle) {
    for (let skip = 1; skip < puzzle.supply.length; skip += 1) {
        const shorter = { ...puzzle, supply: puzzle.supply.slice(skip) };
        if (solvePuzzle(shorter).solvable) return false;
    }
    return true;
}
