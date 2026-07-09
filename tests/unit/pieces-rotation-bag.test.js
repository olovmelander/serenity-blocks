/**
 * @fileoverview Tests for the piece rotation primitive and the 7-bag randomizer.
 *
 * These cover two previously-untested foundations of the gameplay core:
 *  - rotateShape() rotation invariants (the basis of SRS rotation states), and
 *  - the 7-bag property (every 7-piece bag is a permutation of all piece types).
 * Both are fully deterministic and need no GPU/DOM (remediation Phase 3).
 */

import {
    describe, it, expect, beforeEach,
} from 'vitest';
import {
    rotateShape, fillBag, getNextPieces, setNextPieces,
} from '../../src/core/pieces.js';
import { SHAPES, PIECE_KEYS } from '../../src/core/constants.js';

describe('rotateShape (rotation primitive)', () => {
    const shape = SHAPES.T; // T = [[0,0,0],[1,1,1],[0,1,0]] — asymmetric

    // Concrete pinned outputs (verified against the real implementation). These
    // are what kill an identity / left-right-swap bug: the algebraic-invariant
    // tests below pass for a broken identity rotateShape, but these do not.
    it('rotates T clockwise to the exact expected matrix', () => {
        expect(rotateShape(shape, 'right')).toEqual([[0, 1, 0], [1, 1, 0], [0, 1, 0]]);
    });

    it('rotates T counter-clockwise to a DIFFERENT exact matrix', () => {
        expect(rotateShape(shape, 'left')).toEqual([[0, 1, 0], [0, 1, 1], [0, 1, 0]]);
        // Distinct from clockwise — pins direction correctness, not just symmetry.
        expect(rotateShape(shape, 'left')).not.toEqual(rotateShape(shape, 'right'));
    });

    it('rotates J clockwise to the exact expected matrix', () => {
        // J = [[0,0,0],[1,1,1],[0,0,1]]
        expect(rotateShape(SHAPES.J, 'right')).toEqual([[0, 1, 0], [0, 1, 0], [1, 1, 0]]);
    });

    it('returns to the original after four clockwise rotations', () => {
        let s = shape;
        for (let i = 0; i < 4; i++) s = rotateShape(s, 'right');
        expect(s).toEqual(shape);
    });

    it('left rotation is the inverse of right rotation', () => {
        expect(rotateShape(rotateShape(shape, 'right'), 'left')).toEqual(shape);
    });

    it('a 180 flip equals two right rotations', () => {
        expect(rotateShape(shape, 'flip')).toEqual(rotateShape(rotateShape(shape, 'right'), 'right'));
    });
});

describe('7-bag randomizer (fillBag)', () => {
    const ALL = [...PIECE_KEYS].sort();

    beforeEach(() => {
        setNextPieces([]);
    });

    it('fills the queue to at least the 10-piece lookahead floor', () => {
        fillBag();
        expect(getNextPieces().length).toBeGreaterThanOrEqual(10);
    });

    it('emits complete bags: each aligned 7-window is a permutation of all 7 types', () => {
        fillBag();
        const queue = getNextPieces();
        for (let start = 0; start + 7 <= queue.length; start += 7) {
            const window = queue.slice(start, start + 7).sort();
            expect(window).toEqual(ALL);
        }
    });

    it('never emits a piece type outside the canonical set', () => {
        fillBag();
        for (const key of getNextPieces()) {
            expect(PIECE_KEYS).toContain(key);
        }
    });
});
