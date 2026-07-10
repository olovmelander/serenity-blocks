/**
 * SRS kick-table + T-spin pins (plan Phase 3b — "the strongest engineering in
 * the core gets its pin"; previously ZERO kick tests).
 *
 * Conventions under test (game.js):
 * - Kick tables are guideline SRS, stored with +y = UP; application SUBTRACTS
 *   dy (`originalY - dy`) because board y grows downward. Kick [0,-2] moves
 *   the piece 2 rows DOWN.
 * - piece.rotation ∈ 0..3 = ['0','R','2','L']; keys are `${from}>${to}`.
 * - After all 5 SRS kicks fail, a LEGACY horizontal fallback
 *   ([±1,0],[±2,0]) runs before the rotation reverts.
 */
import { describe, it, expect } from 'vitest';
import {
    GameState, rotate, markBoardDirty, lockPiece, rotateShapeMatrix,
    JLSTZ_KICKS, I_KICKS, ROTATION_NAMES,
} from '../../src/core/game.js';
import { SHAPES } from '../../src/core/constants.js';

// ── Golden guideline-SRS values (https://tetris.wiki/Super_Rotation_System) ──
const GUIDELINE_JLSTZ = {
    '0>R': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    'R>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    'R>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>R': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>L': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    'L>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    'L>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>L': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const GUIDELINE_I = {
    '0>R': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    'R>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    'R>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>R': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>L': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    'L>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    'L>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>L': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

const DIR_FOR = (from, to) => (((to - from + 4) % 4) === 1 ? 'right' : 'left');

function shapeAtRotation(shapeKey, rotation) {
    let shape = SHAPES[shapeKey].map((row) => row.slice());
    for (let step = 0; step < rotation; step += 1) shape = rotateShapeMatrix(shape, 'right');
    return shape;
}
function footprint(shape, x, y) {
    const cells = [];
    shape.forEach((row, r) => row.forEach((v, c) => { if (v) cells.push(`${x + c},${y + r}`); }));
    return cells;
}
function makeState(shapeKey, rotation, x, y) {
    const gs = new GameState();
    gs.currentPiece = {
        shapeKey, type: shapeKey, shape: shapeAtRotation(shapeKey, rotation), rotation, x, y, color: shapeKey,
    };
    return gs;
}

/**
 * Build a board where every kick candidate BEFORE targetIndex is blocked by a
 * filled cell chosen outside the target footprint, so exactly kick
 * [targetIndex] is the first that fits.
 */
function blockEarlierKicks(gs, shapeKey, from, to, kicks, targetIndex, x0, y0) {
    const rotatedShape = shapeAtRotation(shapeKey, to);
    const [tdx, tdy] = kicks[targetIndex];
    const targetCells = new Set(footprint(rotatedShape, x0 + tdx, y0 - tdy));
    for (let i = 0; i < targetIndex; i += 1) {
        const [dx, dy] = kicks[i];
        const cells = footprint(rotatedShape, x0 + dx, y0 - dy);
        const blocker = cells.find((c) => !targetCells.has(c));
        expect(blocker, `kick ${i} of ${from}>${to} needs a blockable cell`).toBeTruthy();
        const [bx, by] = blocker.split(',').map(Number);
        gs.boardGrid[by][bx] = { type: 'G', color: '#888', id: 999 + i };
    }
    markBoardDirty(gs);
}

describe('SRS kick tables are guideline-exact (golden pin)', () => {
    it('JLSTZ table matches guideline SRS', () => {
        expect(JLSTZ_KICKS).toEqual(GUIDELINE_JLSTZ);
    });
    it('I table matches guideline SRS', () => {
        expect(I_KICKS).toEqual(GUIDELINE_I);
    });
    it('rotation-state names index the tables', () => {
        expect(ROTATION_NAMES).toEqual(['0', 'R', '2', 'L']);
    });
});

describe('kick application — every table entry lands the piece at (x+dx, y-dy)', () => {
    const TRANSITIONS = [[0, 1], [1, 0], [1, 2], [2, 1], [2, 3], [3, 2], [3, 0], [0, 3]];
    const CASES = [];
    for (const [from, to] of TRANSITIONS) {
        const key = `${ROTATION_NAMES[from]}>${ROTATION_NAMES[to]}`;
        for (const [shapeKey, table] of [['T', JLSTZ_KICKS], ['S', JLSTZ_KICKS], ['I', I_KICKS]]) {
            for (let k = 0; k < table[key].length; k += 1) {
                CASES.push({ shapeKey, from, to, key, k, kicks: table[key] });
            }
        }
    }

    it.each(CASES)('$shapeKey $key kick[$k] applies exactly', ({ shapeKey, from, to, key, k, kicks }) => {
        // Mid-board so every candidate offset stays in bounds.
        const x0 = 4;
        const y0 = 10;
        const gs = makeState(shapeKey, from, x0, y0);
        blockEarlierKicks(gs, shapeKey, from, to, kicks, k, x0, y0);
        const ok = rotate(gs, DIR_FOR(from, to));
        expect(ok).toBe(true);
        const [dx, dy] = kicks[k];
        expect([gs.currentPiece.x, gs.currentPiece.y]).toEqual([x0 + dx, y0 - dy]);
        expect(gs.currentPiece.rotation).toBe(to);
        expect(gs.currentPiece.shape).toEqual(shapeAtRotation(shapeKey, to));
        expect(gs.lastMoveWasRotation).toBe(true);
    });

    it('open-field rotation uses kick[0] and does not translate', () => {
        const gs = makeState('T', 0, 4, 10);
        expect(rotate(gs, 'right')).toBe(true);
        expect([gs.currentPiece.x, gs.currentPiece.y]).toEqual([4, 10]);
    });

    it('[0,-2] means DOWN two rows on the board (y-sign convention pin)', () => {
        // T 0>R kick index 3 is [0,-2]; the table-driven case above asserts the
        // general rule — this pins the sign convention by name so a future
        // "fix" of the subtraction fails loudly.
        const x0 = 4;
        const y0 = 10;
        const gs = makeState('T', 0, x0, y0);
        blockEarlierKicks(gs, 'T', 0, 1, JLSTZ_KICKS['0>R'], 3, x0, y0);
        expect(rotate(gs, 'right')).toBe(true);
        expect(gs.currentPiece.y).toBe(y0 + 2);
    });

    it('O-piece rotation is a successful no-op that does not arm T-spin', () => {
        const gs = makeState('O', 0, 4, 10);
        expect(rotate(gs, 'right')).toBe(true);
        expect([gs.currentPiece.x, gs.currentPiece.y, gs.currentPiece.rotation]).toEqual([4, 10, 0]);
        expect(gs.lastMoveWasRotation).not.toBe(true);
    });

    it('a fully-blocked rotation reverts and returns false (incl. legacy fallback)', () => {
        const x0 = 4;
        const y0 = 10;
        const gs = makeState('T', 0, x0, y0);
        const kicks = JLSTZ_KICKS['0>R'];
        const rotated = shapeAtRotation('T', 1);
        // Block every SRS candidate AND the legacy horizontal probes ([±1,0],[±2,0]).
        const candidates = [...kicks, [1, 0], [-1, 0], [2, 0], [-2, 0]];
        for (const [dx, dy] of candidates) {
            for (const cell of footprint(rotated, x0 + dx, y0 - dy)) {
                const [bx, by] = cell.split(',').map(Number);
                if (gs.boardGrid[by]?.[bx] === null) gs.boardGrid[by][bx] = { type: 'G', color: '#888', id: 1 };
            }
        }
        // Keep the piece's CURRENT footprint clear so the revert is a legal pose.
        for (const cell of footprint(gs.currentPiece.shape, x0, y0)) {
            const [bx, by] = cell.split(',').map(Number);
            gs.boardGrid[by][bx] = null;
        }
        markBoardDirty(gs);
        expect(rotate(gs, 'right')).toBe(false);
        expect([gs.currentPiece.x, gs.currentPiece.y, gs.currentPiece.rotation]).toEqual([x0, y0, 0]);
        expect(gs.currentPiece.shape).toEqual(shapeAtRotation('T', 0));
    });
});

describe('T-spin 3-corner detection (lockPiece)', () => {
    // The 3×3 corner box is the T shape-matrix footprint at (piece.x, piece.y).
    function lockT({ corners, lastMoveWasRotation, x = 4, y = 20 }) {
        const gs = makeState('T', 0, x, y);
        gs.lastMoveWasRotation = lastMoveWasRotation;
        for (const [cx, cy] of corners) gs.boardGrid[cy][cx] = { type: 'G', color: '#888', id: 7 };
        markBoardDirty(gs);
        lockPiece(gs);
        return gs.comboState?.tSpin === true;
    }

    it('3 filled corners + last move was rotation → T-spin', () => {
        expect(lockT({
            corners: [[4, 20], [6, 20], [4, 22]],
            lastMoveWasRotation: true,
        })).toBe(true);
    });

    it('same corners without a final rotation → no T-spin', () => {
        expect(lockT({
            corners: [[4, 20], [6, 20], [4, 22]],
            lastMoveWasRotation: false,
        })).toBe(false);
    });

    it('only 2 corners → no T-spin', () => {
        expect(lockT({
            corners: [[4, 20], [6, 20]],
            lastMoveWasRotation: true,
        })).toBe(false);
    });

    it('out-of-bounds corners count as filled (wall T-spin)', () => {
        // At x=-1 the two left corners are off-board; one filled right corner
        // reaches the 3-corner threshold.
        expect(lockT({
            corners: [[1, 20]],
            lastMoveWasRotation: true,
            x: -1,
        })).toBe(true);
    });

    it('non-T pieces never T-spin', () => {
        const gs = makeState('S', 0, 4, 20);
        gs.lastMoveWasRotation = true;
        for (const [cx, cy] of [[4, 20], [6, 20], [4, 22], [6, 22]]) {
            gs.boardGrid[cy][cx] = { type: 'G', color: '#888', id: 7 };
        }
        markBoardDirty(gs);
        lockPiece(gs);
        expect(gs.comboState?.tSpin).toBe(false);
    });
});
