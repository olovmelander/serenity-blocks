// @ts-nocheck
/**
 * P0-7 (ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18 §2.8) — opponent mini-board dirty-check.
 *
 * The opponent piece is snapshot-INTERPOLATED (sub-cell fractional position). The dirty-check
 * signature must be STABLE across sub-cell motion so `_animate` skips the full-board repaint
 * (and its per-frame `getBoundingClientRect` forced layout), and change ONLY on a real
 * cell/rotation change. This pins the whole-cell quantization that fixes the layout thrash.
 */
import { describe, it, expect } from 'vitest';
import { OpponentWatchManager } from '../../src/ui/opponent-watch-manager.js';

// The hash uses no instance state — call the prototype method against a bare object to avoid
// the (DOM-touching) constructor.
const hash = (piece) => OpponentWatchManager.prototype._computePieceHash.call(null, piece);

describe('_computePieceHash whole-cell quantization (P0-7 §2.8)', () => {
    it('is identical for sub-cell interpolation within the same cell (no per-frame repaint)', () => {
        const base = { type: 'T', x: 3, y: 5, rotation: 0 };
        // A gravity/interpolation step that stays within the same cell must NOT change the hash.
        expect(hash({ ...base, y: 5.0 })).toBe(hash({ ...base, y: 5.1 }));
        expect(hash({ ...base, y: 5.1 })).toBe(hash({ ...base, y: 5.4 }));
        expect(hash({ ...base, x: 3.0 })).toBe(hash({ ...base, x: 3.4 }));
    });

    it('changes when the piece moves a whole cell (real visual change → repaint)', () => {
        const base = { type: 'T', x: 3, y: 5, rotation: 0 };
        expect(hash({ ...base, y: 5 })).not.toBe(hash({ ...base, y: 6 }));
        expect(hash({ ...base, x: 3 })).not.toBe(hash({ ...base, x: 4 }));
    });

    it('changes on rotation', () => {
        const base = { type: 'T', x: 3, y: 5, rotation: 0 };
        expect(hash(base)).not.toBe(hash({ ...base, rotation: 1 }));
    });

    it('changes on piece type', () => {
        expect(hash({ type: 'T', x: 3, y: 5, rotation: 0 }))
            .not.toBe(hash({ type: 'I', x: 3, y: 5, rotation: 0 }));
    });

    it('returns a stable sentinel when there is no piece', () => {
        expect(hash(null)).toBe('none');
        expect(hash(undefined)).toBe('none');
    });

    it('does not thrash across a full cell of interpolated fall (≤1 change per cell)', () => {
        const base = { type: 'S', x: 4, rotation: 0 };
        const frames = [5.0, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.0];
        const hashes = frames.map((y) => hash({ ...base, y }));
        const distinct = new Set(hashes).size;
        // Old tenths-precision hash would have produced ~11 distinct values (a repaint every
        // frame). Whole-cell quantization yields at most 2 across a full cell of travel.
        expect(distinct).toBeLessThanOrEqual(2);
    });
});
