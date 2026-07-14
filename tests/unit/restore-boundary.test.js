/**
 * restoreBoardState boundary pins (plan §5.1 slice 2).
 *
 * The MP snapshot-adoption paths bulk-assigned board/stat fields inline — the
 * "permanent bypass" the plan warns any mutation boundary against. The
 * boundary now owns those writes; ffa computes only the policy. These pins
 * lock the policy matrix the peer-local-sim machinery depends on.
 */
import { describe, it, expect } from 'vitest';
import { restoreBoardState } from '../../src/core/game.js';

function makeState() {
    return {
        score: 500,
        lines: 7,
        level: 2,
        boardGrid: [['old']],
        grid: undefined,
        lockedPieces: [{ id: 'local' }],
        currentPiece: { shapeKey: 'T', x: 4 },
        nextPieces: ['I'],
        dropInterval: 800,
        dropCounter: 3,
        boardCache: { stale: true },
        boardCacheDirty: false,
    };
}

describe('restoreBoardState — statsMode', () => {
    it("'adopt' hard-overwrites score/lines/level", () => {
        const gs = makeState();
        restoreBoardState(gs, { score: 100, lines: 3, level: 1 }, { statsMode: 'adopt' });
        expect([gs.score, gs.lines, gs.level]).toEqual([100, 3, 1]);
    });

    it("'monotonic' never lets a lagged frame pull stats below the prediction", () => {
        const gs = makeState();
        restoreBoardState(gs, { score: 100, lines: 3, level: 1 }, { statsMode: 'monotonic' });
        expect([gs.score, gs.lines, gs.level]).toEqual([500, 7, 2]); // local prediction wins

        restoreBoardState(gs, { score: 900, lines: 9, level: 3 }, { statsMode: 'monotonic' });
        expect([gs.score, gs.lines, gs.level]).toEqual([900, 9, 3]); // genuinely-ahead host wins
    });

    it("'hold' (and default) leaves stats untouched", () => {
        const gs = makeState();
        restoreBoardState(gs, { score: 1, lines: 1, level: 1 }, { statsMode: 'hold' });
        restoreBoardState(gs, { score: 1, lines: 1, level: 1 }, {});
        expect([gs.score, gs.lines, gs.level]).toEqual([500, 7, 2]);
    });
});

describe('restoreBoardState — board adoption', () => {
    it('adoptBoard writes grid/pieces and invalidates the cache', () => {
        const gs = makeState();
        const wireGrid = [['new']];
        restoreBoardState(gs, {
            grid: wireGrid, lockedPieces: [{ id: 'host' }], currentPiece: { shapeKey: 'I', x: 0 },
        }, { adoptBoard: true, mirrorGrid: true });

        expect(gs.boardGrid).toBe(wireGrid); // adopted by reference (wire path)
        expect(gs.grid).toBe(wireGrid); // the MP mirror
        expect(gs.lockedPieces).toEqual([{ id: 'host' }]);
        expect(gs.currentPiece).toEqual({ shapeKey: 'I', x: 0 });
        expect(gs.currentPiece).not.toBe(wireGrid); // piece is CLONED, not aliased
        expect(gs.boardCache).toBe(null);
        expect(gs.boardCacheDirty).toBe(true);
    });

    it('keepCurrentPiece preserves the locally-owned piece (peer-owns path)', () => {
        const gs = makeState();
        restoreBoardState(gs, {
            grid: [['new']], lockedPieces: [], currentPiece: { shapeKey: 'I' },
        }, { adoptBoard: true, keepCurrentPiece: true });
        expect(gs.currentPiece).toEqual({ shapeKey: 'T', x: 4 }); // untouched
    });

    it('no adoptBoard → board untouched even with grid in the snapshot', () => {
        const gs = makeState();
        restoreBoardState(gs, { grid: [['new']], lockedPieces: [] }, { statsMode: 'adopt', score: 0 });
        expect(gs.boardGrid).toEqual([['old']]);
        expect(gs.boardCacheDirty).toBe(false); // cache not invalidated
    });

    it('missing grid still clears the piece + cache (lock-event without grid)', () => {
        const gs = makeState();
        restoreBoardState(gs, { grid: null, currentPiece: null }, { adoptBoard: true });
        expect(gs.boardGrid).toEqual([['old']]); // grid kept
        expect(gs.currentPiece).toBe(null); // piece cleared
        expect(gs.boardCacheDirty).toBe(true);
    });
});

describe('restoreBoardState — speed adoption', () => {
    it('adoptSpeed takes dropInterval + a CLONED preview queue; dropCounter only when asked', () => {
        const gs = makeState();
        const queue = ['S', 'Z'];
        restoreBoardState(gs, { dropInterval: 650, nextPieces: queue, dropCounter: 42 }, { adoptSpeed: true });
        expect(gs.dropInterval).toBe(650);
        expect(gs.nextPieces).toEqual(queue);
        expect(gs.nextPieces).not.toBe(queue); // cloned
        expect(gs.dropCounter).toBe(3); // local gravity phase preserved

        restoreBoardState(gs, { dropInterval: 650, dropCounter: 42 }, { adoptSpeed: true, adoptDropCounter: true });
        expect(gs.dropCounter).toBe(42); // remote board adopts phase
    });
});
