/**
 * applyGarbage boundary pins (plan §5.1 slice 1).
 *
 * insertGarbageEntries mutates lockedPieces by alias and never repairs the
 * derived board representations; its callers hand-rolled the repair three
 * different ways (one deferred it to the renderer's per-frame rebuild).
 * applyGarbage is now the ONE mutation+repair path — these pins lock the
 * contract every caller relies on.
 */
import { describe, it, expect } from 'vitest';
import { applyGarbage, GameState } from '../../src/core/game.js';
import { COLS, ROWS, HIDDEN_ROWS } from '../../src/core/constants.js';

const BOTTOM = ROWS + HIDDEN_ROWS - 1;

function lineEntry(holeMask = 0) {
    return { type: 'line', holeMask, variant: 'normal' };
}

function occupiedCells(grid) {
    let n = 0;
    for (const row of grid) for (const cell of row) if (cell) n += 1;
    return n;
}

describe('applyGarbage (the §5.1 garbage boundary)', () => {
    it('inserts rows, rebuilds boardGrid, and invalidates the cache in one call', () => {
        const gs = new GameState();
        const versionBefore = gs.boardVersion || 0;
        gs.boardCacheDirty = false; // simulate a clean cache pre-insert

        const result = applyGarbage(gs, [lineEntry(), lineEntry()]);

        expect(result.success).toBe(true);
        expect(result.topOut).toBe(false);
        expect(result.garbagePieces.length).toBe(2);
        // The derived grid reflects the mutation WITHOUT any caller-side repair:
        expect(occupiedCells(gs.boardGrid)).toBeGreaterThan(0);
        expect(gs.boardGrid[BOTTOM].some((cell) => cell !== null)).toBe(true);
        expect(gs.boardCacheDirty).toBe(true);
        expect(gs.boardVersion).toBeGreaterThan(versionBefore);
    });

    it('garbage rows carry the hole from the mask', () => {
        const gs = new GameState();
        // Hole at column 0 → MSB-first encoding: bit 9.
        applyGarbage(gs, [lineEntry(1 << (COLS - 1))]);
        expect(gs.boardGrid[BOTTOM][0]).toBe(null); // the hole
        expect(gs.boardGrid[BOTTOM][1]).not.toBe(null); // solid
    });

    it('shifts existing locked pieces up by the inserted row count', () => {
        const gs = new GameState();
        gs.lockedPieces.push({
            pieceId: 'p1', shapeKey: 'I', color: '#fff', type: 'I', x: 0, y: BOTTOM, shape: [Array(COLS).fill(1)],
        });
        applyGarbage(gs, [lineEntry()]);
        expect(gs.lockedPieces[0].y).toBe(BOTTOM - 1); // shifted up
        expect(gs.boardGrid[BOTTOM - 1].every((cell) => cell !== null)).toBe(true);
    });

    it('no-ops safely on empty entries and invalid state', () => {
        const gs = new GameState();
        const result = applyGarbage(gs, []);
        expect(result.success).toBe(true);
        expect(result.garbagePieces).toEqual([]);
        expect(applyGarbage(null, [lineEntry()])).toBe(null);
    });

    it.each([44, 100])('uses the bottom of a %i-row Infinity grid for garbage', (rows) => {
        const gs = new GameState({ isInfinityMode: true, initialInfinityRows: rows });
        const result = applyGarbage(gs, [lineEntry()]);

        expect(result.topOut).toBe(false);
        expect(result.garbagePieces[0].y).toBe(rows - 1);
        expect(result.linesAfterInsertion).toEqual([rows - 1]);
        expect(gs.boardGrid[rows - 1].every((cell) => cell !== null)).toBe(true);
        expect(gs.boardGrid[BOTTOM].every((cell) => cell === null)).toBe(true);
    });

    it('settles a floating piece onto garbage at the Infinity floor', () => {
        const gs = new GameState({ isInfinityMode: true, initialInfinityRows: 44 });
        const piece = {
            pieceId: 'floating', shapeKey: 'I', color: '#fff', x: 0, y: 20, shape: [[1]],
        };
        gs.lockedPieces.push(piece);

        // The mask leaves column 9 empty; column 0 supports the floating piece.
        const result = applyGarbage(gs, [lineEntry(1)]);

        expect(piece.y).toBe(42);
        expect(result.garbagePieces[0].y).toBe(43);
        expect(gs.boardGrid[42][0]?.id).toBe('floating');
        expect(gs.boardGrid[43][0]).not.toBe(null);
    });

    it.each([1, 2, 3])('keeps Infinity row %i playable after a garbage push', (topRow) => {
        const gs = new GameState({
            isInfinityMode: true, initialInfinityRows: 100, maxRows: 100,
        });
        const piece = {
            pieceId: 'roof-neighbor', shapeKey: 'I', x: 0, y: topRow + 1, shape: [[1]],
        };
        gs.lockedPieces.push(piece);

        const result = applyGarbage(gs, [lineEntry(1)], { settleFloatingBlocks: false });

        expect(result.topOut).toBe(false);
        expect(piece.y).toBe(topRow);
        expect(gs.boardGrid[topRow][0]).not.toBe(null);
    });

    it('rejects an Infinity burst that reaches row zero at the maximum height', () => {
        const gs = new GameState({
            isInfinityMode: true, initialInfinityRows: 100, maxRows: 100,
        });
        const piece = { pieceId: 'roof', shapeKey: 'I', x: 0, y: 1, shape: [[1]] };
        gs.lockedPieces.push(piece);

        const result = applyGarbage(gs, [lineEntry(1)], { settleFloatingBlocks: false });

        expect(result.topOut).toBe(true);
        expect(result.rowsAdded).toBe(0);
        expect(gs.lockedPieces).toEqual([piece]);
        expect(piece.y).toBe(1);
    });

    it('reserves enough Infinity capacity for a burst larger than one expansion batch', () => {
        const gs = new GameState({
            isInfinityMode: true, initialInfinityRows: 44, maxRows: 100,
        });
        const piece = { pieceId: 'tower', shapeKey: 'I', x: 0, y: 3, shape: [[1]] };
        gs.lockedPieces.push(piece);
        const burst = Array.from({ length: 25 }, () => lineEntry(1));

        const result = applyGarbage(gs, burst, { settleFloatingBlocks: false });

        expect(result.topOut).toBe(false);
        expect(result.rowsAdded).toBe(30);
        expect(gs.boardGrid).toHaveLength(74);
        expect(gs.infinityStats.rowsReached).toBe(74);
        expect(gs.board).toBe(gs.boardGrid);
        expect(piece.y).toBe(8);
        expect(result.garbagePieces.at(-1).y).toBe(73);
        expect(gs.boardGrid[8][0]?.id).toBe('tower');
    });

    it('still rejects garbage entering the standard hidden rows', () => {
        const gs = new GameState();
        const piece = { pieceId: 'roof', shapeKey: 'I', x: 0, y: HIDDEN_ROWS, shape: [[1]] };
        gs.lockedPieces.push(piece);

        const result = applyGarbage(gs, [lineEntry(1)], { settleFloatingBlocks: false });

        expect(result.topOut).toBe(true);
        expect(piece.y).toBe(HIDDEN_ROWS);
    });

    it('caps burst headroom at maxRows and still tops out if the burst cannot fit', () => {
        const gs = new GameState({
            isInfinityMode: true, initialInfinityRows: 44, maxRows: 50,
        });
        const piece = { pieceId: 'tower', shapeKey: 'I', x: 0, y: 3, shape: [[1]] };
        gs.lockedPieces.push(piece);
        const burst = Array.from({ length: 25 }, () => lineEntry(1));

        const result = applyGarbage(gs, burst, { settleFloatingBlocks: false });

        expect(result.topOut).toBe(true);
        expect(result.rowsAdded).toBe(6);
        expect(gs.boardGrid).toHaveLength(50);
        expect(gs.infinityStats.rowsReached).toBe(50);
        expect(gs.lockedPieces).toEqual([piece]);
        expect(piece.y).toBe(9);
    });

    it('no caller hand-rolls the repair anymore (source tripwire)', async () => {
        const { readFileSync } = await import('node:fs');
        const { execFileSync } = await import('node:child_process');
        const files = execFileSync('git', ['ls-files', 'src/core/**/*.js'], { encoding: 'utf8' })
            .split('\n').filter((f) => f && !f.endsWith('.test.js'))
            .map((f) => f.replace(/\\/g, '/'));
        const offenders = [];
        for (const file of files) {
            if (file === 'src/core/game.js' || file === 'src/core/garbage.js') continue;
            const src = readFileSync(file, 'utf8');
            if (/insertGarbageEntries\s*\(/.test(src)) offenders.push(file);
        }
        expect(offenders, 'call applyGarbage (game.js) instead of insertGarbageEntries').toEqual([]);
    });
});
