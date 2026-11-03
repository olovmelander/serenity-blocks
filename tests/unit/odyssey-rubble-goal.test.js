import {
    afterEach, describe, expect, it,
} from 'vitest';
import {
    hardDrop, move, rotate, spawnPiece,
} from '../../src/core/game.js';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { VictoryConditionEvaluator } from '../../src/core/odyssey/VictoryConditionEvaluator.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { countRubbleRows } from '../../src/core/odyssey/odyssey-rubble.js';

// "Dig out N rubble rows" (level design audit 2026-11, phase 3), played with the real lock and clear physics.
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

function start(board, primary) {
    const level = structuredClone(getLevelById(8));
    level.mechanics.board = { ...level.mechanics.board, ...board };
    level.victory.primary = primary;
    engine = new GameplayHybridEngine();
    engine.configure(level);
    state = engine.createGameState({ rngSeed: 11 });
    state.simTimeMs = 1000;
    state.isSeeking = true;
    state.currentPiece = null;
    return engine.buildPhysicsCallbacks({});
}

async function drop(callbacks, shape, turns, column) {
    state.nextPieces = [shape, 'O', 'O', 'O'];
    state.currentPiece = null;
    spawnPiece(state, null, () => {});
    for (let turn = 0; turn < turns; turn++) rotate(state, 'right');
    for (let guard = 0; leftColumn(state.currentPiece) !== column && guard < 12; guard++) {
        if (!move(state, Math.sign(column - leftColumn(state.currentPiece)))) break;
    }
    hardDrop(state, null, callbacks);
    await state.latestPhysicsPromise;
}

describe('rubble rows', () => {
    it('counts rows that still hold rubble, and nothing on an empty board', () => {
        expect(countRubbleRows(null)).toBe(0);
        const cell = (type) => ({ type, color: '#808080', id: 'x' });
        expect(countRubbleRows([
            [null, null],
            [cell('T'), null],
            [cell('GARBAGE'), cell('I')],
            [cell('CLEAN_GARBAGE'), null],
        ])).toBe(2);
    });

    it('starts the count from the seeded rubble', () => {
        start({ startingRows: 6, opening: undefined }, { type: 'rubble', target: 6 });
        expect(engine.getMetrics()).toMatchObject({ rubbleLeft: 6, rubbleCleared: 0 });
        expect(engine.checkVictory()).toBe(false);
    });

    it('counts a rubble row as dug out once it clears, through the rebuild after the clear', async () => {
        const callbacks = start(
            { startingRows: 0, opening: ['XXXXXXXXX.', 'XXXX.XXXXX'] },
            { type: 'rubble', target: 2 },
        );
        expect(engine.getMetrics()).toMatchObject({ rubbleLeft: 2, rubbleCleared: 0 });
        await drop(callbacks, 'I', 1, 9);
        expect(engine.getMetrics()).toMatchObject({ lines: 1, rubbleLeft: 1, rubbleCleared: 1 });
        expect(engine.checkVictory()).toBe(false);
        // The rebuilt rubble keeps its type, so the second row still counts until it clears too.
        expect(countRubbleRows(state.boardGrid)).toBe(1);
    });
});

describe('rubble goal', () => {
    const evaluate = (cleared, left, target) => {
        const evaluator = new VictoryConditionEvaluator();
        evaluator.updateRubble(left, cleared + left);
        return evaluator.evaluate({}, { primary: { type: 'rubble', target }, failure: { type: 'top-out' } });
    };

    it('is met once the asked rows are dug out', () => {
        expect(evaluate(5, 1, 6)).toBe(false);
        expect(evaluate(6, 0, 6)).toBe(true);
        expect(evaluate(4, 2, 4)).toBe(true);
    });

    it('never asks for more rows than the attempt started with, and never wins on an empty seabed', () => {
        expect(evaluate(4, 0, 6)).toBe(true);
        expect(evaluate(0, 0, 6)).toBe(false);
    });
});

describe('survival stars', () => {
    const stars = (seconds) => {
        const evaluator = new VictoryConditionEvaluator();
        evaluator.updateTime(seconds);
        return evaluator.calculateStars(
            { one: { survived: 90 }, two: { survived: 150 }, three: { survived: 210 } },
            {},
        );
    };

    it('count the seconds survived as a lower bound', () => {
        expect([stars(60), stars(90), stars(149), stars(150), stars(240)]).toEqual([0, 1, 1, 2, 3]);
    });

    it('leave finish-within times as upper bounds', () => {
        const evaluator = new VictoryConditionEvaluator();
        evaluator.updateTime(70);
        expect(evaluator.calculateStars({ one: {}, two: { time: 80 }, three: { time: 60 } }, {})).toBe(2);
    });
});
