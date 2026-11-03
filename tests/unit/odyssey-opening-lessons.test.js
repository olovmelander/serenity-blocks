import {
    afterEach, describe, expect, it,
} from 'vitest';
import {
    hardDrop, move, rotate, spawnPiece,
} from '../../src/core/game.js';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';

// The prepared openings of the teaching orbs (level design audit 2026-11, phase 2) must teach what
// their tips say: these play the shipped openings with the real lock and cascade physics.
let engine;
let state;

afterEach(() => {
    state?.reset?.();
    engine?.reset?.();
    state = null;
    engine = null;
});

const leftColumn = (piece) => piece.x + Math.min(...piece.shape.flatMap((row) => row.flatMap(
    (cell, column) => (cell ? [column] : []),
)));

/** Drop each move ({ shape, turns, column }: turns right, then aimed by its leftmost cell). */
async function play(levelId, moves) {
    engine = new GameplayHybridEngine();
    engine.configure(structuredClone(getLevelById(levelId)));
    state = engine.createGameState({ rngSeed: 11 });
    const callbacks = engine.buildPhysicsCallbacks({});
    state.simTimeMs = 1000;
    state.isSeeking = true;
    state.currentPiece = null;
    state.nextPieces = [...moves.map((step) => step.shape), 'O', 'O', 'O'];
    for (const step of moves) {
        if (!state.currentPiece) spawnPiece(state, null, () => {});
        expect(state.currentPiece?.type).toBe(step.shape);
        for (let turn = 0; turn < step.turns; turn++) rotate(state, 'right');
        for (let guard = 0; leftColumn(state.currentPiece) !== step.column && guard < 12; guard++) {
            if (!move(state, Math.sign(step.column - leftColumn(state.currentPiece)))) break;
        }
        expect(leftColumn(state.currentPiece)).toBe(step.column);
        hardDrop(state, null, callbacks);
        await state.latestPhysicsPromise; // eslint-disable-line no-await-in-loop -- each lock settles before the next piece
    }
    return engine.getMetrics();
}

const UPRIGHT_I = { shape: 'I', turns: 1, column: 9 };

describe('prepared openings teach their lesson', () => {
    it('orb 2: an I in the open column drops the hanging block into its gap, a first cascade', async () => {
        expect(getLevelById(2).mechanics.board.opening).toEqual(['........X.', 'XXXXXXXX..', 'XXXXXXXXX.']);
        const metrics = await play(2, [UPRIGHT_I]);
        expect(metrics).toMatchObject({ lines: 2, cascades: 1, maxCascadeDepth: 2 });
    });

    it('orb 12: an I in the open column clears all four rows, the first Quad', async () => {
        expect(getLevelById(12).mechanics.board.opening).toEqual(Array(4).fill('XXXXXXXXX.'));
        const metrics = await play(12, [UPRIGHT_I]);
        expect(metrics).toMatchObject({ lines: 4, tetrises: 1 });
    });
});
