import { describe, expect, it } from 'vitest';

import {
    createInfinityGrid,
    expandGridIfNeeded,
    calculateTopRow,
    calculateBuildHeight,
    shouldExpandGrid,
    getGridStats,
    checkInfinityGameOver,
} from '../infinity-grid.js';
import { COLS } from '../constants.js';

function createMockGameState(options = {}) {
    const board = options.board || createInfinityGrid(COLS, 24);

    return {
        isInfinityMode: true,
        maxRows: options.maxRows || 1000,
        board,
        boardGrid: board,
        lockedPieces: options.lockedPieces || [],
        currentPiece: options.currentPiece || null,
        ghostPiece: options.ghostPiece || null,
        boardCacheDirty: false,
    };
}

describe('infinity-grid utilities', () => {
    it('creates a grid with the requested dimensions', () => {
        const grid = createInfinityGrid(10, 20);

        expect(grid).toHaveLength(20);
        expect(grid[0]).toHaveLength(10);
        expect(grid[0][0]).toBeNull();
    });

    it('expands by the capped batch size and offsets active positions', () => {
        const gameState = createMockGameState({
            currentPiece: { y: 12 },
            ghostPiece: { y: 15 },
        });
        const initialLength = gameState.board.length;

        gameState.lockedPieces.push({
            y: 10,
            blocks: [{ row: 10, col: 5 }],
        });

        const expanded = expandGridIfNeeded(gameState, initialLength + 20);

        expect(expanded).toBe(true);
        expect(gameState.board).toHaveLength(initialLength + 10);
        expect(gameState.boardGrid).toBe(gameState.board);
        expect(gameState.lockedPieces[0].y).toBe(20);
        expect(gameState.lockedPieces[0].blocks[0].row).toBe(20);
        expect(gameState.currentPiece.y).toBe(22);
        expect(gameState.ghostPiece.y).toBe(25);
        expect(gameState.boardCacheDirty).toBe(true);
    });

    it('does not expand past maxRows', () => {
        const gameState = createMockGameState({ maxRows: 28 });

        const expanded = expandGridIfNeeded(gameState, 100);

        expect(expanded).toBe(true);
        expect(gameState.board).toHaveLength(28);
    });

    it('calculates top row and build height', () => {
        const gameState = createMockGameState();
        gameState.board[5][3] = { color: '#ff0000' };
        gameState.board[20][5] = { color: '#00ff00' };

        expect(calculateTopRow(gameState)).toBe(5);
        expect(calculateBuildHeight(gameState)).toBe(19);
    });

    it('returns the bottom row for an empty board', () => {
        const gameState = createMockGameState();

        expect(calculateTopRow(gameState)).toBe(23);
        expect(calculateBuildHeight(gameState)).toBe(1);
    });

    it('checks whether the grid should expand near the top', () => {
        const gameState = createMockGameState();
        gameState.board[5][3] = { color: '#ff0000' };

        expect(shouldExpandGrid(gameState, 30)).toBe(true);
        expect(shouldExpandGrid(gameState, 4)).toBe(false);
    });

    it('returns grid statistics', () => {
        const gameState = createMockGameState();
        gameState.board[10][3] = { color: '#ff0000' };
        gameState.board[10][4] = { color: '#ff0000' };

        expect(getGridStats(gameState)).toMatchObject({
            totalRows: 24,
            topRow: 10,
            buildHeight: 14,
            blocksCount: 2,
            maxRows: 1000,
            canExpand: true,
        });
    });

    it('detects infinity game over only at the absolute top', () => {
        const gameState = createMockGameState();
        gameState.board[0][5] = { color: '#ff0000' };

        expect(checkInfinityGameOver(gameState)).toBe(true);

        const safeGameState = createMockGameState();
        safeGameState.board[10][5] = { color: '#ff0000' };

        expect(checkInfinityGameOver(safeGameState)).toBe(false);
    });
});
