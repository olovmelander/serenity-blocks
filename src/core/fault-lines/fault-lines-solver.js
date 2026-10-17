// @ts-check

/**
 * Exhaustive Fault Lines solver. It searches every distinct reachable landing for each
 * supply piece in turn, so a puzzle it calls unsolvable is unsolvable under the real
 * controls, and a solution it returns replays through them. CI runs it over the whole
 * puzzle bank, so a rules change that breaks a shipped puzzle fails the build.
 */

import {
    applyPlacement, createRun, listPlacements,
} from './fault-lines-sim.js';

/** @typedef {import('./fault-lines-puzzle.js').FaultLinesPuzzle} FaultLinesPuzzle */
/** @typedef {import('./fault-lines-sim.js').FaultLinesPlacement} FaultLinesPlacement */
/** @typedef {import('./fault-lines-sim.js').FaultLinesRun} FaultLinesRun */

/**
 * @typedef {Object} FaultLinesSolveReport
 * @property {boolean} solvable
 * @property {FaultLinesPlacement[]} solution the first solution found, in supply order
 * @property {number} solutions how many full lines of play solve it
 * @property {number} lines how many full lines of play exist
 * @property {number} openingMoves distinct landings for the first piece
 * @property {number} winningOpenings first landings from which some continuation solves it
 */

/**
 * @param {FaultLinesPuzzle} puzzle
 * @returns {FaultLinesSolveReport}
 */
export function solvePuzzle(puzzle) {
    /** @type {FaultLinesPlacement[]} */
    let solution = [];
    let solutions = 0;
    let lines = 0;

    /**
     * @param {FaultLinesRun} run
     * @param {FaultLinesPlacement[]} path
     * @returns {number} solving lines of play below this run
     */
    const search = (run, path) => {
        if (run.outcome !== 'open') {
            lines += 1;
            if (run.outcome !== 'solved') return 0;
            solutions += 1;
            if (solution.length === 0) solution = path;
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
    return {
        solvable: solutions > 0,
        solution,
        solutions,
        lines,
        openingMoves: openings.length,
        winningOpenings,
    };
}
