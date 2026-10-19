// The Stillfall certifier's standard, shared by the files that hold it to the bank a few tiers
// at a time (so CI runs them side by side): every puzzle must be solvable by straight drops
// (rotate and move at the top, then drop: no tuck, no kick) and not by most openings, need
// every piece, store a straight solution the controls reach, and play every solution out the
// same through the real game: the real controls from the deal row, a real hard drop, and the
// live async cascade physics, cell for cell after every lock.
import { describe, expect, it } from 'vitest';
import {
    GameState, hardDrop, move, rotate, softDrop, spawnPiece,
} from '../../../src/core/game.js';
import { rebuildBoardGridFromPieces, markBoardDirty } from '../../../src/core/board.js';
import { buildPuzzle } from '../../../src/core/stillfall/stillfall-puzzle.js';
import {
    applyPlacement, boardFor, createRun, dealIntoView, solutionPlacement,
} from '../../../src/core/stillfall/stillfall-sim.js';
import { everyPieceMatters, isStraight, solvePuzzle } from '../../../src/core/stillfall/stillfall-solver.js';
import { STILLFALL_PUZZLES } from '../../../src/core/stillfall/puzzle-bank.js';

/**
 * Which file certifies which tiers: stillfall-puzzles.test.js the first group, then
 * stillfall-puzzles-tiers-7-8, -tier-9 and -tier-10. A new tier joins a group (the bank
 * test fails until it does).
 */
export const CERTIFIED_TIER_GROUPS = Object.freeze([[1, 2, 3, 4, 5, 6], [7, 8], [9], [10]]);

/** The share of first landings that may lead to a solution: a quarter, a tenth, then 6%. */
export const maxWinningShare = (tier) => {
    if (tier <= 2) return 0.25;
    return tier <= 4 ? 0.1 : 0.06;
};
/** From this tier on, exactly one first landing leads to a solution. */
export const ONE_WAY_IN_FROM_TIER = 5;

/** Every cell as `type:id`, so two boards match only if the same bodies hold the same cells. */
function cellMap(grid) {
    return grid.map((row) => row.map((cell) => (cell ? `${cell.type}:${cell.id}` : '.')).join(' '));
}

/** Loads a puzzle into a real GameState, as the mode does, with its supply dealt in order. */
function liveGame(puzzle) {
    const gameState = new GameState({ hitStopEnabled: false, finiteSupply: true, gravityWaits: true });
    gameState.isSeeking = true; // physics skips its animation delays
    gameState.lockedPieces = puzzle.lockedPieces.map((piece) => ({
        ...piece, shape: piece.shape.map((row) => row.slice()),
    }));
    gameState._pieceIdCounter = puzzle.nextPieceId - 1;
    gameState.nextPieces = puzzle.supply.slice();
    rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
    markBoardDirty(gameState);
    const waves = [];
    const physicsCallbacks = {
        onLineClear: (count, holes, masks, rows, wave) => waves.push(wave),
        spawnPiece: () => {},
    };
    spawnPiece(gameState);
    dealIntoView(gameState);
    return { gameState, physicsCallbacks, waves };
}

async function playLive(live, placement) {
    const { gameState, physicsCallbacks } = live;
    expect(gameState.currentPiece?.shapeKey).toBe(placement.shapeKey);
    for (const action of placement.actions) {
        if (action.type === 'move') expect(move(gameState, action.dir)).toBe(true);
        else if (action.type === 'rotate') expect(rotate(gameState, action.dir)).toBe(true);
        else if (action.type === 'softDrop') expect(softDrop(gameState, null, physicsCallbacks)).toBe(true);
    }
    hardDrop(gameState, null, physicsCallbacks);
    await gameState.latestPhysicsPromise;
    if (gameState.nextPieces.length > 0) {
        spawnPiece(gameState);
        dealIntoView(gameState);
    }
}

/** Replays one line of play through the live game, checking the board after each lock. */
async function certifyLine(puzzle, line, label) {
    const live = liveGame(puzzle);
    let run = createRun(puzzle);
    expect(cellMap(live.gameState.boardGrid)).toEqual(cellMap(boardFor(run.lockedPieces)));
    for (const placement of line) {
        const step = applyPlacement(run, placement);
        const wavesBefore = live.waves.length;
        // eslint-disable-next-line no-await-in-loop
        await playLive(live, placement);
        expect(live.waves.length - wavesBefore, `${label}: waves`).toBe(step.resolution.cascadeCount);
        expect(cellMap(live.gameState.boardGrid), `${label}: board`)
            .toEqual(cellMap(boardFor(step.run.lockedPieces)));
        ({ run } = step);
    }
    expect(run.outcome, label).toBe('solved');
    // Every goal needs at least one clear, so the live game must have cascaded.
    expect(live.waves.length, label).toBeGreaterThan(0);
}

/**
 * Certifies every bank puzzle in the given tiers.
 * @param {number[]} tiers
 */
export function certifyTiers(tiers) {
    const definitions = STILLFALL_PUZZLES.filter((definition) => tiers.includes(definition.tier));
    it(`has puzzles in tiers ${tiers.join(', ')}`, () => {
        expect(new Set(definitions.map((definition) => definition.tier))).toEqual(new Set(tiers));
    });
    describe.each(definitions.map((definition) => [definition.id, definition]))('%s', (id, definition) => {
        const puzzle = buildPuzzle(definition);
        const report = solvePuzzle(puzzle);

        it('is solvable by straight drops, and not by most openings', () => {
            expect(report.solvable).toBe(true);
            expect(report.straightSolutions.length, 'a solution with no tuck or kick').toBeGreaterThan(0);
            expect(report.winningOpenings / report.openingMoves)
                .toBeLessThanOrEqual(maxWinningShare(definition.tier));
            if (definition.tier >= ONE_WAY_IN_FROM_TIER) expect(report.winningOpenings, 'one way in').toBe(1);
        });

        it('needs every piece, and is not solved before the last one lands', () => {
            expect(report.minPieces).toBe(definition.supply.length);
            if (definition.supply.length > 1) expect(everyPieceMatters(puzzle)).toBe(true);
        });

        it('stores a straight solution the controls reach, for the hint', () => {
            let run = createRun(puzzle);
            for (const step of puzzle.solution) {
                const placement = solutionPlacement(run, step);
                expect(placement, `${id}: step ${JSON.stringify(step)}`).not.toBeNull();
                expect(isStraight(placement), `${id}: step ${JSON.stringify(step)} is straight`).toBe(true);
                ({ run } = applyPlacement(run, placement));
            }
            expect(run.outcome).toBe('solved');
        });

        it('plays every solution out identically through the real controls and live physics', async () => {
            for (const [index, line] of report.solutions.entries()) {
                // eslint-disable-next-line no-await-in-loop
                await certifyLine(puzzle, line, `${id} #${index}`);
            }
        });
    });
}
