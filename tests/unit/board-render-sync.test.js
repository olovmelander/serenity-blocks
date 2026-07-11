/**
 * §5.1 renderer-rebuild retirement pins: syncBoardGridForRender rebuilds the
 * grid exactly when the board changed — version bump (markBoardDirty from any
 * in-place writer) or boardGrid object replacement (restores/expansion, which
 * may adopt a numerically-colliding snapshot boardVersion) — and skips the
 * formerly-unconditional per-frame rebuild otherwise.
 */
import { describe, it, expect } from 'vitest';
import {
    createBoardGrid, syncBoardGridForRender, markBoardDirty,
} from '../../src/core/board.js';
import { ROWS, HIDDEN_ROWS } from '../../src/core/constants.js';

const BOTTOM = ROWS + HIDDEN_ROWS - 1;

function block(x, y, id = `b-${x}-${y}`) {
    return {
        pieceId: id, color: '#888', type: 'block', x, y, shape: [[1]],
    };
}
function makeState() {
    return {
        boardGrid: createBoardGrid(),
        lockedPieces: [block(3, BOTTOM)],
        boardVersion: 7,
    };
}

describe('syncBoardGridForRender (§5.1 per-frame rebuild retirement)', () => {
    it('first call rebuilds (no bookkeeping yet)', () => {
        const gs = makeState();
        syncBoardGridForRender(gs);
        expect(gs.boardGrid[BOTTOM][3]).not.toBeNull();
    });

    it('unchanged board: subsequent calls skip the rebuild', () => {
        const gs = makeState();
        syncBoardGridForRender(gs);
        // Mutate pieces WITHOUT marking dirty — a skipped rebuild leaves the
        // grid untouched, proving the per-frame work is gone.
        gs.lockedPieces.push(block(5, BOTTOM, 'unmarked'));
        syncBoardGridForRender(gs);
        expect(gs.boardGrid[BOTTOM][5]).toBeNull();
    });

    it('markBoardDirty (any boundary writer) triggers the rebuild', () => {
        const gs = makeState();
        syncBoardGridForRender(gs);
        gs.lockedPieces.push(block(5, BOTTOM, 'marked'));
        markBoardDirty(gs);
        syncBoardGridForRender(gs);
        expect(gs.boardGrid[BOTTOM][5]).not.toBeNull();
    });

    it('boardGrid replacement rebuilds even when boardVersion collides (demo seek)', () => {
        const gs = makeState();
        syncBoardGridForRender(gs);
        // Simulate restoreGameStateSnapshot: new grid object + adopted
        // boardVersion numerically equal to the current one.
        gs.boardGrid = createBoardGrid();
        gs.lockedPieces = [block(8, BOTTOM, 'restored')];
        // boardVersion stays 7 — identity check must catch it
        syncBoardGridForRender(gs);
        expect(gs.boardGrid[BOTTOM][8]).not.toBeNull();
    });

    it('bookkeeping is per-gameState (local multiplayer boards stay independent)', () => {
        const a = makeState();
        const b = makeState();
        syncBoardGridForRender(a);
        b.lockedPieces.push(block(9, BOTTOM, 'p2'));
        markBoardDirty(b);
        syncBoardGridForRender(b);
        expect(b.boardGrid[BOTTOM][9]).not.toBeNull();
        expect(a.boardGrid[BOTTOM][9]).toBeNull();
    });

    it('missing boardGrid is a safe no-op', () => {
        expect(() => syncBoardGridForRender({ lockedPieces: [] })).not.toThrow();
        expect(() => syncBoardGridForRender(null)).not.toThrow();
    });
});
