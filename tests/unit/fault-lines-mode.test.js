/**
 * FaultLinesMode on a live GameState and the live physics: it deals the supply, judges
 * the goal once each cascade settles, takes back pieces, and publishes state for the HUD.
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
import { listPlacements, createRun } from '../../src/core/fault-lines/fault-lines-sim.js';
import { bankPuzzle } from '../../src/core/fault-lines/puzzle-bank.js';
import { faultLinesProgress } from '../../src/core/fault-lines/fault-lines-progress.js';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
vi.mock('../../src/ui/next-queue-ui.js', () => ({ updateNextQueue: vi.fn() }));

const { FaultLinesMode } = await import('../../src/core/game-modes/FaultLinesMode.js');
const { SinglePlayerMode } = await import('../../src/core/game-modes/SinglePlayerMode.js');

const silent = new Proxy({}, { get: () => () => {} });

function startMode(puzzleId) {
    const mode = new FaultLinesMode({
        settingsManager: { get: () => ({}) },
        soundManager: { sfxPlayer: silent },
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

const states = [];
let stop;
beforeEach(() => {
    vi.stubGlobal('document', { getElementById: () => null, querySelector: () => null });
    faultLinesProgress.restore([]);
    states.length = 0;
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
        expect(mode.gameState.showBodySeams).toBe(true);
        expect(mode._recordsDemos()).toBe(false);
        expect(mode._allowsFixedTick()).toBe(false);
        const single = new SinglePlayerMode({});
        expect(single._recordsDemos()).toBe(true);
        expect(single._allowsFixedTick()).toBe(true);
        expect(single._createSessionGameState({}).finiteSupply).toBe(false);
    });

    it('deals the supply, solves on the certified solution and records the solve', async () => {
        const mode = startMode('second-wave');
        expect(mode.gameState.currentPiece.shapeKey).toBe('I');
        expect(states.at(-1)).toMatchObject({
            active: true, outcome: 'open', inHand: 'I', canUndo: false,
        });

        const [placement] = solvePuzzle(buildPuzzle(bankPuzzle('second-wave'))).solution;
        await play(mode, placement);

        expect(states.at(-1)).toMatchObject({
            outcome: 'solved', bestWaves: 2, firstSolve: true, canUndo: true,
        });
        expect(faultLinesProgress.solvedIds()).toEqual(['second-wave']);
        expect(mode.gameState.currentPiece).toBeNull();
    });

    it('undo after the last piece deals it again on the board it fell on', async () => {
        const mode = startMode('first-fall');
        const before = JSON.stringify(mode.gameState.boardGrid);
        const [placement] = solvePuzzle(buildPuzzle(bankPuzzle('first-fall'))).solution;
        await play(mode, placement);
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
        const losing = listPlacements(createRun(buildPuzzle(bankPuzzle('first-fall'))))
            .find((placement) => placement.footprint !== solvePuzzle(buildPuzzle(bankPuzzle('first-fall'))).solution[0].footprint);
        await play(mode, losing);
        expect(states.at(-1)).toMatchObject({ outcome: 'failed', canUndo: true });
        expect(faultLinesProgress.solvedIds()).toEqual([]);

        expect(mode.restart()).toBe(true);
        expect(states.at(-1)).toMatchObject({ outcome: 'open', inHand: 'I', dealt: 0 });
    });

    it('steps back one turn at a time through a two-piece puzzle', async () => {
        const mode = startMode('the-relic');
        const { solution } = solvePuzzle(buildPuzzle(bankPuzzle('the-relic')));
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

    it('takes commands from the HUD: next and load only reach open puzzles', async () => {
        const mode = startMode('first-fall');
        mode._onCommand({ type: 'load', puzzleId: 'keyhole' }); // tier 3, still closed
        expect(mode.puzzle.id).toBe('first-fall');
        mode._onCommand({ type: 'next' });
        expect(mode.puzzle.id).toBe('second-wave');
        mode._onCommand({ type: 'load', puzzleId: 'staircase' });
        expect(mode.puzzle.id).toBe('staircase');
        expect(states.at(-1).bank.filter((entry) => entry.open)).toHaveLength(5);
        mode.isPaused = true;
        mode._onCommand({ type: 'load', puzzleId: 'lanterns' });
        expect(mode.puzzle.id).toBe('staircase');
    });
});
