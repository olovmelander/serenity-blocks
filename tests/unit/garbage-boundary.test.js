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
        // main.js's legacy-loop call site is outside src/core and dies with §5.5.
        expect(offenders, 'call applyGarbage (game.js) instead of insertGarbageEntries').toEqual([]);
    });
});
