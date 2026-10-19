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
 *
 * The last piece is judged before its landings are searched. A lock that clears nothing
 * moves nothing, so it cannot meet a goal the board did not already meet (and a met goal
 * ends the run before the last piece). The solver plays only the places where the last
 * piece could rest and complete a row, and only when one of those solves does it search
 * what the controls reach, to keep the solving landings among them with their real input
 * paths. That skips most of the tree and is what lets four-piece puzzles be certified on
 * every CI run; the answer is the one the full search gives.
 */

import {
    applyPlacement, boardOf, createRun, lineClearingRests, listPlacements, runAfter,
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
 * @property {number} minPieces the fewest pieces any solution uses (Infinity when unsolvable)
 * @property {number} openingMoves distinct landings for the first piece
 * @property {number} winningOpenings first landings from which some continuation solves it
 */

/** @param {StillfallPlacement} placement */
export function isStraight(placement) {
    return !placement.actions.some((action) => action.type === 'softDrop');
}

/**
 * The landings of the piece in hand that could still lead to a solve, in listPlacements'
 * order: all of them, or for the last piece only the reachable ones that solve.
 * @param {StillfallRun} run an open run
 * @returns {StillfallPlacement[]}
 */
function promisingPlacements(run) {
    if (run.dealt < run.puzzle.supply.length - 1) return listPlacements(run);
    const solving = new Set(lineClearingRests(run, boardOf(run))
        .filter((rest) => applyPlacement(run, rest).run.outcome === 'solved')
        .map((rest) => rest.footprint));
    if (solving.size === 0) return [];
    return listPlacements(run).filter((placement) => solving.has(placement.footprint));
}

/**
 * @param {StillfallPuzzle} puzzle
 * @returns {StillfallSolveReport}
 */
export function solvePuzzle(puzzle) {
    /** @type {StillfallPlacement[][]} */
    const solutions = [];
    let solutionCount = 0;
    let minPieces = Infinity;

    /**
     * @param {StillfallRun} run
     * @param {StillfallPlacement[]} path
     * @returns {number} solving lines of play below this run
     */
    const search = (run, path) => {
        if (run.outcome !== 'open') {
            if (run.outcome !== 'solved') return 0;
            solutionCount += 1;
            minPieces = Math.min(minPieces, path.length);
            if (solutions.length < MAX_SOLUTIONS_KEPT) solutions.push(path);
            return 1;
        }
        let solving = 0;
        for (const placement of promisingPlacements(run)) {
            solving += search(runAfter(run, placement), [...path, placement]);
        }
        return solving;
    };

    const start = createRun(puzzle);
    const openings = listPlacements(start);
    const promising = new Set(promisingPlacements(start).map((placement) => placement.footprint));
    let winningOpenings = 0;
    for (const placement of openings) {
        if (!promising.has(placement.footprint)) continue;
        if (search(runAfter(start, placement), [placement]) > 0) winningOpenings += 1;
    }
    const straightSolutions = solutions.filter((path) => path.every(isStraight));
    return {
        solvable: solutionCount > 0,
        solution: straightSolutions[0] || solutions[0] || [],
        solutions,
        straightSolutions,
        solutionCount,
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
    for (const placement of promisingPlacements(run)) {
        if (!isStraight(placement)) continue;
        const rest = solveFrom(runAfter(run, placement));
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
