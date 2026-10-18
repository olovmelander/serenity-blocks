/**
 * FaultLinesMode on a live GameState and the live physics: it deals the supply, judges
 * the goal once each cascade settles, takes back pieces, hints, and publishes state for
 * the HUD.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    hardDrop, move, rotate, softDrop,
} from '../../src/core/game.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { buildPuzzle } from '../../src/core/fault-lines/fault-lines-puzzle.js';
import { solvePuzzle } from '../../src/core/fault-lines/fault-lines-solver.js';
import {
    applyPlacement, cellsOf, createRun, listPlacements, solutionPlacement,
} from '../../src/core/fault-lines/fault-lines-sim.js';
import { bankPuzzle, FAULT_LINES_PUZZLES } from '../../src/core/fault-lines/puzzle-bank.js';
import { faultLinesProgress } from '../../src/core/fault-lines/fault-lines-progress.js';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
vi.mock('../../src/ui/next-queue-ui.js', () => ({ updateNextQueue: vi.fn() }));

const { FaultLinesMode } = await import('../../src/core/game-modes/FaultLinesMode.js');
const { SinglePlayerMode } = await import('../../src/core/game-modes/SinglePlayerMode.js');

const playLevelUp = vi.fn();
const sfxPlayer = new Proxy({ playLevelUp }, { get: (target, name) => target[name] || (() => {}) });

function startMode(puzzleId) {
    const mode = new FaultLinesMode({
        settingsManager: { get: () => ({}) },
        soundManager: { sfxPlayer },
    });
    mode.isActive = true;
    mode.isRunning = true;
    mode.gameState = mode._createSessionGameState({ hitStopEnabled: false });
    mode.gameState.isSeeking = true; // physics skips its animation delays
    mode._loadPuzzle(puzzleId);
    return mode;
}

async function play(mode, placement) {
    const { gameState } = mode;
    const callbacks = mode._getPhysicsCallbacks();
    for (const action of placement.actions) {
        if (action.type === 'move') move(gameState, action.dir);
        else if (action.type === 'rotate') rotate(gameState, action.dir);
        else softDrop(gameState, null, callbacks);
    }
    hardDrop(gameState, null, callbacks);
    await gameState.latestPhysicsPromise;
}

const solutionOf = (id) => solvePuzzle(buildPuzzle(bankPuzzle(id))).solution;
const tier = (n) => FAULT_LINES_PUZZLES.filter((p) => p.tier === n).map((p) => p.id);

const states = [];
let stop;
beforeEach(() => {
    vi.stubGlobal('document', { getElementById: () => null, querySelector: () => null });
    faultLinesProgress.restore([]);
    states.length = 0;
    playLevelUp.mockClear();
    stop = eventBus.on(EVENTS.FAULT_LINES_STATE, (state) => states.push(state));
});
afterEach(() => {
    stop();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('FaultLinesMode', () => {
    it('latches puzzle rules on its GameState, and Single Player keeps its own', () => {
        const mode = startMode('first-fall');
        expect(mode.gameState.finiteSupply).toBe(true);
        expect(mode.gameState.gravityWaits).toBe(true);
        expect(mode.gameState.disableLevelProgression).toBe(true);
        expect(mode.gameState.showBodySeams).toBe(true);
        expect(mode.gameState.moveSummaryVocabulary).toBe('wave');
        expect(mode._recordsDemos()).toBe(false);
        expect(mode._allowsFixedTick()).toBe(false);
        const single = new SinglePlayerMode({});
        expect(single._recordsDemos()).toBe(true);
        expect(single._allowsFixedTick()).toBe(true);
        const singleState = single._createSessionGameState({});
        expect(singleState.finiteSupply).toBe(false);
        expect(singleState.disableLevelProgression).toBe(false);
        expect(singleState.moveSummaryVocabulary).toBe('combo');
    });

    it('deals the supply, solves on the certified solution, records the solve and chimes', async () => {
        const mode = startMode('second-wave');
        expect(mode.gameState.currentPiece.shapeKey).toBe('I');
        expect(states.at(-1)).toMatchObject({
            active: true, outcome: 'open', inHand: 'I', canUndo: false,
        });

        await play(mode, solutionOf('second-wave')[0]);

        expect(states.at(-1)).toMatchObject({
            outcome: 'solved', bestWaves: 2, firstSolve: true, canUndo: true,
        });
        expect(faultLinesProgress.solvedIds()).toEqual(['second-wave']);
        expect(mode.gameState.currentPiece).toBeNull();
        expect(playLevelUp).toHaveBeenCalledOnce();
    });

    it('undo after the last piece deals it again on the board it fell on', async () => {
        const mode = startMode('first-fall');
        const before = JSON.stringify(mode.gameState.boardGrid);
        await play(mode, solutionOf('first-fall')[0]);
        expect(mode._outcome).toBe('solved');

        expect(mode.undo()).toBe(true);
        expect(mode._outcome).toBe('open');
        expect(JSON.stringify(mode.gameState.boardGrid)).toBe(before);
        expect(mode.gameState.currentPiece.shapeKey).toBe('I');
        expect(mode.gameState.lines).toBe(0);
        expect(mode._canUndo()).toBe(false);
    });

    it('fails when the supply runs out short of the goal, and restart deals it again', async () => {
        const mode = startMode('first-fall');
        const winning = solutionOf('first-fall')[0].footprint;
        const losing = listPlacements(createRun(buildPuzzle(bankPuzzle('first-fall'))))
            .find((placement) => placement.footprint !== winning);
        await play(mode, losing);
        expect(states.at(-1)).toMatchObject({ outcome: 'failed', reason: 'spent', canUndo: true });
        expect(faultLinesProgress.solvedIds()).toEqual([]);
        expect(playLevelUp).not.toHaveBeenCalled();

        expect(mode.restart()).toBe(true);
        expect(states.at(-1)).toMatchObject({ outcome: 'open', inHand: 'I', dealt: 0 });
    });

    it('steps back one turn at a time through a two-piece puzzle', async () => {
        const mode = startMode('the-relic');
        const solution = solutionOf('the-relic');
        await play(mode, solution[0]);
        expect(mode._outcome).toBe('open');
        expect(mode.gameState.currentPiece.shapeKey).toBe('I');
        const afterFirst = JSON.stringify(mode.gameState.boardGrid);
        await play(mode, solution[1]);
        expect(mode._outcome).toBe('solved');

        mode.undo();
        expect(JSON.stringify(mode.gameState.boardGrid)).toBe(afterFirst);
        expect(mode._dealt).toBe(1);
        mode.undo();
        expect(mode._dealt).toBe(0);
        expect(mode._canUndo()).toBe(false);
    });

    it('fails a deal the structure blocks without ending the session, and undo recovers', async () => {
        const mode = startMode('the-relic');
        // A column just under the deal row keeps the first I at its spawn row, where it
        // locks; the second I then has no room to spawn.
        const { gameState, puzzle } = mode;
        const wall = {
            x: 4, y: 4, shape: [[1], [1], [1], [1]], pieceId: 900, shapeKey: 'I', type: 'I', color: '#0f0',
        };
        mode._turns = [];
        mode._restoreTurn({
            lockedPieces: [...puzzle.lockedPieces, wall],
            nextPieces: puzzle.supply,
            pieceIdCounter: puzzle.nextPieceId - 1,
            lines: 0,
            bestWaves: 0,
            dealt: 0,
        });
        expect(gameState.currentPiece.y).toBe(2); // the deal row is blocked: it stays at its spawn row
        const callbacks = mode._getPhysicsCallbacks();
        hardDrop(gameState, null, callbacks);
        await gameState.latestPhysicsPromise;

        expect(states.at(-1)).toMatchObject({ outcome: 'failed', reason: 'blocked', inHand: null });
        expect(gameState.isGameOver).toBe(false); // the game loop would stop drawing otherwise
        expect(gameState.currentPiece).toBeNull();

        expect(mode.undo()).toBe(true);
        expect(states.at(-1)).toMatchObject({ outcome: 'open', dealt: 0, inHand: 'I' });
    });

    it('names why an attempt failed: the supply spent, or the relic cleared away', async () => {
        const mode = startMode('first-fall');
        const winning = solutionOf('first-fall')[0].footprint;
        const losing = listPlacements(createRun(buildPuzzle(bankPuzzle('first-fall'))))
            .find((placement) => placement.footprint !== winning);
        await play(mode, losing);
        expect(states.at(-1)).toMatchObject({ outcome: 'failed', reason: 'spent', lines: 0 });

        // A relic in a row the piece completes is cleared away with it.
        const relic = startMode('the-relic');
        const custom = buildPuzzle({
            id: 'relic-lost', title: 'Relic lost', rows: ['AAAAAAAAR.', 'BBBBBBBBB.'], supply: ['I'], goal: { type: 'relic-floor', body: 'R' },
        });
        relic.puzzle = custom;
        relic.gameState.relicPieceId = custom.bodyIds.R;
        relic._turns = [];
        relic._restoreTurn({
            lockedPieces: custom.lockedPieces,
            nextPieces: custom.supply,
            pieceIdCounter: custom.nextPieceId - 1,
            lines: 0,
            bestWaves: 0,
            dealt: 0,
        });
        const upright = listPlacements(createRun(custom)).find((p) => p.footprint === '9,20;9,21;9,22;9,23');
        await play(relic, upright);
        expect(states.at(-1)).toMatchObject({ outcome: 'failed', reason: 'relic-lost', cellsLeft: 2 });
    });

    it('hints from the live board when the stored line was left but a straight way on exists', async () => {
        const mode = startMode('the-relic');
        const puzzle = buildPuzzle(bankPuzzle('the-relic'));
        // The relic's two solutions are the two orders of the same I placements: taking the
        // second one first leaves the stored line, yet a straight way on exists.
        const [, second] = puzzle.solution;
        const otherFirst = listPlacements(createRun(puzzle)).find((p) => p.rotation === second.rotation && p.x === second.x);
        await play(mode, otherFirst);
        expect(mode._dealt).toBe(1);
        expect(mode.hint()).toBe(true);
        expect(mode._dealt).toBe(1); // no restart
        expect(states.at(-1)).toMatchObject({ hintShown: true, hintRestarted: false });
        const [first] = puzzle.solution;
        const run = { ...mode._liveRun(), lockedPieces: mode.gameState.lockedPieces };
        expect(mode.gameState.hintCells).toEqual(cellsOf(solutionPlacement(run, first)));
    });

    it('drops the "first solve" mark once the solve is taken back', async () => {
        const mode = startMode('first-fall');
        await play(mode, solutionOf('first-fall')[0]);
        expect(states.at(-1).firstSolve).toBe(true);
        mode.undo();
        expect(states.at(-1).firstSolve).toBe(false);
        await play(mode, solutionOf('first-fall')[0]);
        expect(states.at(-1)).toMatchObject({ outcome: 'solved', firstSolve: false });
    });

    it('keeps a saved solve for a puzzle the bank no longer has', () => {
        faultLinesProgress.restore(['first-fall', 'retired-puzzle', 42]);
        expect(faultLinesProgress.solvedIds()).toEqual(['first-fall', 'retired-puzzle']);
        expect(faultLinesProgress.allSolved()).toBe(false);
        expect([...faultLinesProgress.openIds()]).toEqual(tier(1));
    });

    it('lights the stored solution as a hint, restarts when the board left it, and clears on lock', async () => {
        const mode = startMode('the-relic');
        const puzzle = buildPuzzle(bankPuzzle('the-relic'));
        expect(mode.hint()).toBe(true);
        const first = solutionPlacement(createRun(puzzle), puzzle.solution[0]);
        expect(mode.gameState.hintCells).toEqual(cellsOf(first));
        expect(states.at(-1)).toMatchObject({ hintShown: true, canHint: true });

        // Following the hint: the next hint is for the second piece on the board as it is.
        await play(mode, first);
        expect(mode.gameState.hintCells).toBeNull();
        expect(mode.hint()).toBe(true);
        const { run } = applyPlacement(createRun(puzzle), first);
        expect(mode.gameState.hintCells).toEqual(cellsOf(solutionPlacement(run, puzzle.solution[1])));

        // Leaving it: a different first piece, then a hint restarts and shows the first step.
        mode.restart();
        const other = listPlacements(createRun(puzzle)).find((p) => p.footprint !== first.footprint);
        await play(mode, other);
        expect(mode._dealt).toBe(1);
        expect(mode.hint()).toBe(true);
        expect(mode._dealt).toBe(0);
        expect(mode.gameState.hintCells).toEqual(cellsOf(first));
    });

    it('takes commands from the HUD: next and load only reach open puzzles', () => {
        const mode = startMode('first-fall');
        mode._onCommand({ type: 'load', puzzleId: tier(3)[0] }); // still closed
        expect(mode.puzzle.id).toBe('first-fall');
        mode._onCommand({ type: 'next' });
        expect(mode.puzzle.id).toBe('second-wave');
        mode._onCommand({ type: 'load', puzzleId: 'staircase' });
        expect(mode.puzzle.id).toBe('staircase');
        expect(states.at(-1).bank.filter((entry) => entry.open)).toHaveLength(tier(1).length);
        mode.isPaused = true;
        mode._onCommand({ type: 'load', puzzleId: 'lanterns' });
        expect(mode.puzzle.id).toBe('staircase');
    });

    it('goes on to an earlier unsolved puzzle when nothing later is open', () => {
        faultLinesProgress.restore(tier(1).slice(1)); // four of five: tier 2 is open
        expect(faultLinesProgress.after(tier(1).at(-1))).toBe(tier(2)[0]);
        faultLinesProgress.restore([...tier(1).slice(1), ...tier(2)]);
        expect(faultLinesProgress.after(tier(2).at(-1))).toBe(tier(3)[0]);
        const last = tier(Math.max(...FAULT_LINES_PUZZLES.map((p) => p.tier)));
        faultLinesProgress.restore(FAULT_LINES_PUZZLES.map((p) => p.id).filter((id) => id !== tier(1)[0]));
        expect(faultLinesProgress.after(last.at(-1))).toBe(tier(1)[0]);
        expect(faultLinesProgress.allSolved()).toBe(false);
        faultLinesProgress.restore(FAULT_LINES_PUZZLES.map((p) => p.id));
        expect(faultLinesProgress.allSolved()).toBe(true);
        expect(faultLinesProgress.after(last.at(-1))).toBeNull();
    });
});
