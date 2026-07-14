import { describe, expect, it } from 'vitest';
import { createBoardGrid } from '../../src/core/board.js';
import { COLS, HIDDEN_ROWS, ROWS } from '../../src/core/constants.js';
import {
    prepareResolvedPhysics,
    processPhysicsResolved,
} from '../../src/core/physics.js';

const BOTTOM = ROWS + HIDDEN_ROWS - 1;

function fullRow(y) {
    return {
        color: '#666',
        pieceId: `row-${y}`,
        shape: [Array(COLS).fill(1)],
        type: 'garbage',
        x: 0,
        y,
    };
}

function block(x, y) {
    return {
        color: '#888', pieceId: `block-${x}-${y}`, shape: [[1]], type: 'block', x, y,
    };
}

function createState() {
    return {
        b2bActive: false,
        boardGrid: createBoardGrid(),
        comboCount: 0,
        comboMultiplier: 1,
        comboMultiplierEnabled: false,
        comboState: { lockFootprint: [], manualColumns: [] },
        disableLevelProgression: false,
        dropInterval: 800,
        isSeeking: true,
        level: 1,
        lineClearCounts: {},
        lines: 0,
        linesUntilNextLevel: 15,
        lockedPieces: [fullRow(BOTTOM), block(0, BOTTOM - 4)],
        score: 0,
    };
}

function callbackRecorder(log) {
    const scalarize = (value) => {
        if (value === null || value === undefined || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.join(',');
        return '<object>';
    };
    return new Proxy({}, {
        get(_target, name) {
            return (...args) => log.push([name, ...args.map(scalarize)]);
        },
    });
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
}

describe('prepared cascade replay seam', () => {
    it('prepares synchronously without mutating live state, then replays identically', async () => {
        const preparedState = createState();
        const ordinaryState = structuredClone(preparedState);
        const beforePreparation = structuredClone(preparedState);

        const prepared = prepareResolvedPhysics(preparedState);

        expect(preparedState).toEqual(beforePreparation);
        expect(prepared.waves).toHaveLength(1);
        deepFreeze(prepared);

        const preparedLog = [];
        const ordinaryLog = [];
        await processPhysicsResolved(preparedState, callbackRecorder(preparedLog), prepared);
        await processPhysicsResolved(ordinaryState, callbackRecorder(ordinaryLog));

        expect(preparedLog).toEqual(ordinaryLog);
        expect(preparedState).toEqual(ordinaryState);
    });

    it('rejects stale progression context before replay mutates live state', async () => {
        const state = createState();
        const prepared = prepareResolvedPhysics(state);
        state.linesUntilNextLevel = 1;
        const beforeReplay = structuredClone(state);

        await expect(processPhysicsResolved(state, {}, prepared)).rejects.toThrow(
            'Cannot replay a stale prepared cascade',
        );
        expect(state).toEqual(beforeReplay);
    });

    it('rejects a prepared result after its source board changes', async () => {
        const state = createState();
        const prepared = prepareResolvedPhysics(state);
        state.lockedPieces.push(block(3, BOTTOM - 2));
        const beforeReplay = structuredClone(state);

        await expect(processPhysicsResolved(state, {}, prepared)).rejects.toThrow(
            'Cannot replay a stale prepared cascade',
        );
        expect(state).toEqual(beforeReplay);
    });

    it('rejects cloned or mutated prepared results before replay', async () => {
        const state = createState();
        const prepared = prepareResolvedPhysics(state);

        await expect(processPhysicsResolved(state, {}, structuredClone(prepared))).rejects.toThrow(
            'requires a result from prepareResolvedPhysics',
        );

        prepared.waves[0].points += 1;
        await expect(processPhysicsResolved(state, {}, prepared)).rejects.toThrow(
            'prepared cascade result after it was mutated',
        );
    });
});
