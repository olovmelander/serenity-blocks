import { describe, expect, it } from 'vitest';
import { GameState } from '../../src/core/game.js';
import { rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { processPhysicsLegacy, processPhysicsResolved, tryProcessNoClearSync } from '../../src/core/physics.js';
import { armCascadeShadow, settleCascadeShadow } from '../../src/core/cascade-shadow.js';

function createRoofClearState(isInfinityMode, row) {
    const state = new GameState({ isInfinityMode, initialInfinityRows: 100, maxRows: 100 });
    state.isSeeking = true; // Skip animation waits; run actual wave commits and gravity.
    state.lockedPieces = [{ x: 0, y: row, shape: [Array(10).fill(1)], pieceId: 1, shapeKey: 'I' }];
    rebuildBoardGridFromPieces(state.lockedPieces, state.boardGrid);
    return state;
}

describe('Infinity has no hidden rows during cascade resolution', () => {
    for (const resolvePhysics of [processPhysicsLegacy, processPhysicsResolved]) {
        it.each([0, 1, 2, 3])(`${resolvePhysics.name} clears playable roof row %s`, async (row) => {
            const state = createRoofClearState(true, row);
            const sample = armCascadeShadow(state);
            await resolvePhysics(state, {});
            expect(state.lines).toBe(1);
            expect(state.lockedPieces).toEqual([]);
            expect(state.boardGrid.every((cells) => cells.every((cell) => cell === null))).toBe(true);
            expect(settleCascadeShadow(sample, state)).toEqual({ status: 'clean' });
        });

        it(`${resolvePhysics.name} preserves the standard hidden-row rule`, async () => {
            const state = createRoofClearState(false, 3);
            await resolvePhysics(state, {});
            expect(state.lines).toBe(0);
            expect(state.lockedPieces).toHaveLength(1);
        });
    }

    it('does not take the no-clear shortcut when an Infinity roof row is full', () => {
        const state = createRoofClearState(true, 2);
        expect(tryProcessNoClearSync(state, {})).toBe(false);
        expect(state.lines).toBe(0);
        expect(state.lockedPieces).toHaveLength(1);
    });
});
