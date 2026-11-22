import { describe, it, expect } from 'vitest';
import {
    BLIND_MAX_TICKS,
    BLIND_PIECE_TICKS,
    BLIND_TICK_MS,
    FULL_BLIND_FACTOR,
    advanceBlindClock,
    applyFullBlind,
    captureBlindSnapshot,
    clearBlind,
    createBlindState,
    fullBlindTicks,
    hasBlindCells,
    normalizeBlindState,
    restoreBlindSnapshot,
    sameBlindCells,
    takePieceBlind,
    takeSpawnBlinds,
} from '../blind.js';
import { rebuildBoardGridFromPieces, createBoardGrid } from '../board.js';

/** A board with the given locked pieces and a grid that mirrors them. */
function board(pieces) {
    const gameState = { blind: createBlindState(), lockedPieces: pieces, boardGrid: createBoardGrid() };
    rebuildBoardGridFromPieces(pieces, gameState.boardGrid);
    return gameState;
}
const piece = (pieceId, x, y, shape = [[1, 1]], extra = {}) => ({
    pieceId, shapeKey: 'O', color: '#fff', x, y, shape, ...extra,
});

describe('blind state', () => {
    it('starts with no clock, no waiting piece blind', () => {
        expect(createBlindState()).toEqual({ clockMs: 0, pieceTicks: 0, version: 0 });
    });

    it('normalizes anything into a valid state', () => {
        expect(normalizeBlindState(null)).toEqual(createBlindState());
        expect(normalizeBlindState({ clockMs: -3, pieceTicks: 900, version: 2.5 }))
            .toEqual({ clockMs: 0, pieceTicks: BLIND_MAX_TICKS, version: 2 });
        expect(normalizeBlindState({ clockMs: BLIND_TICK_MS + 4, pieceTicks: 30, version: 7 }))
            .toEqual({ clockMs: 4, pieceTicks: 30, version: 7 });
    });

    it('sizes a full blind as rows × combo × 12, capped at 255', () => {
        expect(FULL_BLIND_FACTOR).toBe(12);
        expect(fullBlindTicks(3, 1)).toBe(36);
        expect(fullBlindTicks(2, 3)).toBe(72);
        expect(fullBlindTicks(2, 0)).toBe(24); // a combo is at least one wave
        expect(fullBlindTicks(9, 4)).toBe(BLIND_MAX_TICKS);
        expect(fullBlindTicks(0, 5)).toBe(0);
    });
});

describe('blind pieces', () => {
    it('take one blind entry per spawn and hand it to the piece that locks next', () => {
        const gameState = board([]);
        const queue = { entries: [{ type: 'blind', ticks: 30 }, { type: 'blind', ticks: 30 }] };

        expect(takeSpawnBlinds(gameState, queue)).toHaveLength(1);
        expect(gameState.blind.pieceTicks).toBe(BLIND_PIECE_TICKS);
        expect(queue.entries).toHaveLength(1);

        expect(takePieceBlind(gameState)).toBe(BLIND_PIECE_TICKS);
        expect(gameState.blind.pieceTicks).toBe(0);
        expect(takePieceBlind(gameState)).toBe(0);
    });

    it('never take rows, and full blinds ahead of them land at once', () => {
        const gameState = board([piece(1, 0, 22)]);
        const queue = {
            entries: [
                { type: 'full_blind', ticks: 12 },
                { type: 'blind', ticks: 30 },
                { type: 'line', holeMask: 1 },
            ],
        };

        expect(takeSpawnBlinds(gameState, queue).map((entry) => entry.type)).toEqual(['full_blind', 'blind']);
        expect(queue.entries.map((entry) => entry.type)).toEqual(['line']);
        expect(gameState.lockedPieces[0].blindTicks).toBe(12);
    });
});

describe('full blind', () => {
    it('hides every cell now on the board and adds onto blind time already there, up to 255', () => {
        const gameState = board([piece(1, 0, 22), piece(2, 4, 22, [[1]], { blindTicks: 20 })]);

        expect(applyFullBlind(gameState, 36)).toBe(2);
        expect(gameState.lockedPieces.map((p) => p.blindTicks)).toEqual([36, 56]);
        expect(gameState.boardGrid[22][0].blind).toBe(36);
        expect(gameState.boardGrid[22][4].blind).toBe(56);

        applyFullBlind(gameState, 240);
        expect(gameState.lockedPieces.map((p) => p.blindTicks)).toEqual([BLIND_MAX_TICKS, BLIND_MAX_TICKS]);
    });

    it('leaves pieces placed afterwards visible', () => {
        const gameState = board([piece(1, 0, 22)]);
        applyFullBlind(gameState, 24);
        gameState.lockedPieces.push(piece(2, 4, 22));
        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
        expect(gameState.boardGrid[22][4].blind).toBeUndefined();
        expect(gameState.boardGrid[22][0].blind).toBe(24);
    });
});

describe('the blind clock', () => {
    it('takes one tick off every hidden cell per 160 ms of game time and shows it at 0', () => {
        const gameState = board([piece(1, 0, 22, [[1]], { blindTicks: 2 })]);
        const { version } = gameState.blind;

        advanceBlindClock(gameState, BLIND_TICK_MS - 1);
        expect(gameState.lockedPieces[0].blindTicks).toBe(2);
        advanceBlindClock(gameState, 1);
        expect(gameState.lockedPieces[0].blindTicks).toBe(1);
        expect(gameState.boardGrid[22][0].blind).toBe(1);
        expect(gameState.blind.version).toBe(version); // still hidden: nothing to redraw

        expect(advanceBlindClock(gameState, BLIND_TICK_MS)).toBe(true);
        expect(gameState.lockedPieces[0].blindTicks).toBeUndefined();
        expect(gameState.boardGrid[22][0].blind).toBeUndefined();
        expect(gameState.blind.version).toBe(version + 1);
        expect(hasBlindCells(gameState)).toBe(false);
    });

    it('counts several ticks in one long step', () => {
        const gameState = board([piece(1, 0, 22, [[1]], { blindTicks: 5 })]);
        advanceBlindClock(gameState, BLIND_TICK_MS * 3 + 10);
        expect(gameState.lockedPieces[0].blindTicks).toBe(2);
        expect(gameState.blind.clockMs).toBeCloseTo(10, 9);
    });
});

describe('clearing blind', () => {
    it('shows every hidden cell and forgets a waiting piece blind', () => {
        const gameState = board([piece(1, 0, 22, [[1]], { blindTicks: 40 })]);
        gameState.blind.pieceTicks = 30;
        expect(clearBlind(gameState)).toBe(true);
        expect(gameState.blind.pieceTicks).toBe(0);
        expect(hasBlindCells(gameState)).toBe(false);
        expect(gameState.boardGrid[22][0].blind).toBeUndefined();
        expect(clearBlind(gameState)).toBe(false);
    });
});

describe('blind on the wire', () => {
    it('lists every hidden cell with its time, and restores them onto an adopted board', () => {
        const source = board([piece(1, 0, 22, [[1, 1]], { blindTicks: 7 }), piece(2, 5, 23, [[1]])]);
        source.blind.clockMs = 42;
        source.blind.pieceTicks = 30;
        const snapshot = captureBlindSnapshot(source);
        expect(snapshot).toEqual({ clockMs: 42, pieceTicks: 30, cells: [[220, 7], [221, 7]] });

        // The adopted board arrives as single cells (the binary wire) with no blind of its own.
        const target = board([piece('a', 0, 22, [[1]]), piece('b', 1, 22, [[1]]), piece('c', 5, 23, [[1]])]);
        target.boardGrid[23][5].blind = 9; // stale
        restoreBlindSnapshot(target, snapshot);

        expect(target.lockedPieces.map((p) => p.blindTicks)).toEqual([7, 7, undefined]);
        expect(target.boardGrid[22][0].blind).toBe(7);
        expect(target.boardGrid[23][5].blind).toBeUndefined();
        expect(target.blind).toMatchObject({ clockMs: 42, pieceTicks: 30 });
        expect(sameBlindCells(captureBlindSnapshot(target), snapshot)).toBe(true);
    });

    it('tells hidden-cell changes apart from the clock alone', () => {
        const a = { clockMs: 1, pieceTicks: 0, cells: [[5, 3]] };
        expect(sameBlindCells(a, { ...a, clockMs: 99 })).toBe(true);
        expect(sameBlindCells(a, { ...a, cells: [[5, 2]] })).toBe(false);
        expect(sameBlindCells(a, { ...a, pieceTicks: 30 })).toBe(false);
    });
});
