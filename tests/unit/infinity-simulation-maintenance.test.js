import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { GameState } from '../../src/core/game.js';
import { maintainInfinitySimulation } from '../../src/core/infinity-simulation-maintenance.js';

function createInfinityState({ maxRows = 64, rows = 44 } = {}) {
    return new GameState({
        initialInfinityRows: rows,
        isInfinityMode: true,
        maxRows,
    });
}

function occupy(state, row, column = 0) {
    state.boardGrid[row][column] = { occupied: true };
}

describe('Infinity simulation maintenance', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('expands headlessly and returns camera-offset presentation metadata', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const state = createInfinityState();
        occupy(state, 30);

        const result = maintainInfinitySimulation(state);

        expect(result).toEqual({
            previousRowCount: 44,
            rowCount: 54,
            rowsAdded: 10,
            currentTopRow: 40,
            expanded: true,
            gameOver: false,
            gameOverTransitioned: false,
        });
        expect(state.board).toBe(state.boardGrid);
        expect(state.boardGrid[40][0]).toEqual({ occupied: true });
        expect(state.infinityStats.rowsReached).toBe(54);
    });

    it('offsets piece coordinates exactly once across repeated maintenance', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const state = createInfinityState();
        occupy(state, 30);
        state.currentPiece = { y: 5 };
        state.ghostPiece = { y: 8 };
        state.lockedPieces = [{
            y: 30,
            blocks: [{ row: 30, col: 0 }],
        }];

        const first = maintainInfinitySimulation(state);
        const second = maintainInfinitySimulation(state);

        expect(first.rowsAdded).toBe(10);
        expect(second.rowsAdded).toBe(0);
        expect(state.currentPiece.y).toBe(15);
        expect(state.ghostPiece.y).toBe(18);
        expect(state.lockedPieces[0].y).toBe(40);
        expect(state.lockedPieces[0].blocks[0].row).toBe(40);
        expect(state.boardGrid[40][0]).toEqual({ occupied: true });
        expect(state.boardGrid).toHaveLength(54);
    });

    it('caps the final expansion at maxRows', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const state = createInfinityState({ maxRows: 49 });
        occupy(state, 30);

        const first = maintainInfinitySimulation(state);
        const second = maintainInfinitySimulation(state);

        expect(first).toMatchObject({
            previousRowCount: 44,
            rowCount: 49,
            rowsAdded: 5,
            expanded: true,
        });
        expect(second).toMatchObject({ rowCount: 49, rowsAdded: 0, expanded: false });
        expect(state.infinityStats.rowsReached).toBe(49);
    });

    it('transitions roof game-over once when the grid cannot expand', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const state = createInfinityState({ maxRows: 44 });
        occupy(state, 0);

        const first = maintainInfinitySimulation(state);
        const second = maintainInfinitySimulation(state);

        expect(first).toMatchObject({
            rowsAdded: 0,
            currentTopRow: 0,
            gameOver: true,
            gameOverTransitioned: true,
        });
        expect(second).toMatchObject({
            rowsAdded: 0,
            currentTopRow: 0,
            gameOver: true,
            gameOverTransitioned: false,
        });
    });
});
