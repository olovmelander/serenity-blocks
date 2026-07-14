/**
 * Golden rule fixtures (plan Phase 3b, Quadra takeaway #10).
 *
 * Table-driven pins of the GAMEPLAY RULES — scoring, level progression,
 * garbage/attack mapping, hole-mask encoding — with hand-computed literal
 * expectations (never derived from the implementation under test). Keyed by
 * simVersion: when Phase 5.8's rules registry lands, a balance change bumps
 * the version and adds a NEW table; the old table keeps verifying old
 * artifacts. Changing a value in an existing table is a rules change and must
 * be treated as one.
 */
import { describe, it, expect } from 'vitest';
import { calculateQuadraLineScore, getDropInterval } from '../../src/core/scoring.js';
import { COLS, ROWS, HIDDEN_ROWS, LEVEL_SPEEDS } from '../../src/core/constants.js';
import { processPhysics } from '../../src/core/physics.js';
import { createBoardGrid } from '../../src/core/board.js';
import {
    calculateGarbage, maskArrayToBits, bitsToColumns, columnsToMask,
    serializeAttack, deserializeAttack,
} from '../../src/core/garbage.js';

const SIM_VERSION = 1;
const BOTTOM = ROWS + HIDDEN_ROWS - 1;

// ─────────────────────────────────────────────────────────────────────────────
// Scoring (Quadra formula): base 250/500/1000/2000 (200·d² above 4)
// + 200·(complexity−1)² cascade + perfect d·1250 (d²·500 above 4),
// then +10%·level additive (floored).
// ─────────────────────────────────────────────────────────────────────────────
const SCORING_FIXTURES_V1 = [
    // [lines, level, complexity, perfectClear, expected]
    [1, 0, 1, false, 250],
    [2, 0, 1, false, 500],
    [3, 0, 1, false, 1000],
    [4, 0, 1, false, 2000],
    [5, 0, 1, false, 5000], // 200·25 — mega-clear quadratic
    [6, 0, 1, false, 7200], // 200·36
    [1, 0, 2, false, 450], // +200·1² cascade
    [2, 0, 3, false, 1300], // +200·2²
    [4, 0, 5, false, 5200], // +200·4²
    [1, 0, 1, true, 1500], // +1·1250 perfect
    [4, 0, 1, true, 7000], // +4·1250
    [5, 0, 1, true, 17500], // 5000 + 25·500 large-clear perfect
    [4, 5, 1, false, 3000], // 2000 + floor(2000·0.5)
    [1, 3, 1, false, 325], // 250 + floor(250·0.3)
    [2, 7, 2, true, 5440], // (500+200+2500) + floor(3200·0.7)
    [0, 9, 4, true, 0], // no lines → nothing, ever
];

describe(`scoring goldens (simVersion ${SIM_VERSION})`, () => {
    it.each(SCORING_FIXTURES_V1)(
        '%i lines @ level %i, complexity %i, perfect=%s → %i',
        (lines, level, complexity, perfect, expected) => {
            expect(calculateQuadraLineScore(lines, level, complexity, perfect)).toBe(expected);
        },
    );

    it('drop interval clamps into LEVEL_SPEEDS', () => {
        expect(getDropInterval(1)).toBe(LEVEL_SPEEDS[0]);
        expect(getDropInterval(LEVEL_SPEEDS.length)).toBe(LEVEL_SPEEDS[LEVEL_SPEEDS.length - 1]);
        expect(getDropInterval(999)).toBe(LEVEL_SPEEDS[LEVEL_SPEEDS.length - 1]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Level progression through REAL physics: 15 lines per level, deficit carries.
// Harness pattern from odyssey-modifiers.test.js (isSeeking skips animation
// delays → deterministic, no timers).
// ─────────────────────────────────────────────────────────────────────────────
function fullRowsPiece(rowCount) {
    return {
        pieceId: 'fixture-rows',
        color: '#666',
        type: 'garbage',
        x: 0,
        y: BOTTOM - (rowCount - 1),
        shape: Array.from({ length: rowCount }, () => Array(COLS).fill(1)),
    };
}
function loneBlockPiece() {
    return {
        pieceId: 'fixture-block', color: '#888', type: 'block', x: 0, y: BOTTOM - 6, shape: [[1]],
    };
}
function makeState(overrides = {}) {
    return {
        boardGrid: createBoardGrid(),
        lockedPieces: [],
        score: 0,
        level: 1,
        lines: 0,
        linesUntilNextLevel: 15,
        isSeeking: true,
        comboState: { lockFootprint: [], manualColumns: [] },
        ...overrides,
    };
}

describe(`level progression goldens (simVersion ${SIM_VERSION}) — 15 lines per level`, () => {
    it('crossing the threshold levels up and re-arms the counter at 15', async () => {
        const gs = makeState({ lockedPieces: [fullRowsPiece(1), loneBlockPiece()], linesUntilNextLevel: 1 });
        await processPhysics(gs, {});
        expect(gs.lines).toBe(1);
        expect(gs.level).toBe(2);
        expect(gs.linesUntilNextLevel).toBe(15);
        expect(gs.dropInterval).toBe(LEVEL_SPEEDS[1]); // recomputed for the new level
    });

    it('an overshoot carries the deficit into the next level window', async () => {
        const gs = makeState({ lockedPieces: [fullRowsPiece(2), loneBlockPiece()], linesUntilNextLevel: 1 });
        await processPhysics(gs, {});
        expect(gs.level).toBe(2);
        expect(gs.linesUntilNextLevel).toBe(14); // 1 − 2 = −1, +15
    });

    it('14 lines of headroom does not level up', async () => {
        const gs = makeState({ lockedPieces: [fullRowsPiece(1), loneBlockPiece()] });
        await processPhysics(gs, {});
        expect(gs.level).toBe(1);
        expect(gs.linesUntilNextLevel).toBe(14);
    });

    it('disableLevelProgression freezes the level but still re-arms the counter', async () => {
        const gs = makeState({
            lockedPieces: [fullRowsPiece(1), loneBlockPiece()],
            linesUntilNextLevel: 1,
            disableLevelProgression: true,
        });
        await processPhysics(gs, {});
        expect(gs.level).toBe(1);
        expect(gs.linesUntilNextLevel).toBe(15);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Garbage attack mapping (Quadra formulas) + hole-mask encoding.
// Encoding is MSB-first: column 0 → bit 9 … column 9 → bit 0; a 1-bit is a
// HOLE. Competitive-visible — a flipped bit order sends mirrored garbage.
// ─────────────────────────────────────────────────────────────────────────────
describe(`garbage attack goldens (simVersion ${SIM_VERSION})`, () => {
    it.each([
        [1, 0], [2, 1], [3, 2], [4, 3], [5, 4],
    ])('depth %i sends depth−1 = %i rows', (depth, rows) => {
        const attack = calculateGarbage({ depth, holeMask: [] });
        expect(attack.rows).toBe(rows);
    });

    it.each([
        [1, 1], [2, 1], [3, 2], [4, 2], [5, 3],
    ])('clean bonus for depth %i is floor((1+depth)/2) = %i', (depth, bonus) => {
        const attack = calculateGarbage({ depth, holeMask: [], sendForClean: true });
        expect(attack.cleanBonus).toBe(bonus);
        expect(calculateGarbage({ depth, holeMask: [] }).cleanBonus).toBe(0);
    });

    it('clean masks alternate the Quadra 72/585 patterns', () => {
        const attack = calculateGarbage({ depth: 5, holeMask: [], sendForClean: true });
        expect(attack.cleanMasks).toEqual([72, 585, 72]); // cols [3,6] / [0,3,6,9] / [3,6]
    });

    it('hole masks ride the wire MSB-first (column 0 → bit 9)', () => {
        expect(maskArrayToBits(columnsToMask([3, 6]))).toBe(72);
        expect(maskArrayToBits(columnsToMask([0, 3, 6, 9]))).toBe(585);
        expect(maskArrayToBits(columnsToMask([2]))).toBe(128); // bit 7, NOT 4
        expect(maskArrayToBits(columnsToMask([0]))).toBe(512);
        expect(maskArrayToBits(columnsToMask([9]))).toBe(1);
        expect(bitsToColumns(585)).toEqual([0, 3, 6, 9]);
        expect(bitsToColumns(72)).toEqual([3, 6]);
    });

    it('a lock footprint becomes the opponent hole mask (inverse mapping)', () => {
        const attack = calculateGarbage({
            depth: 3,
            holeMask: [columnsToMask([4, 5]), columnsToMask([4])],
        });
        expect(attack.rows).toBe(2);
        expect(attack.holeMasks).toEqual([
            maskArrayToBits(columnsToMask([4, 5])),
            maskArrayToBits(columnsToMask([4])),
        ]);
        expect(attack.holeMasks[0]).toBe(32 + 16); // cols 4,5 → bits 5,4
    });

    it('attacks round-trip the wire serializer without drift', () => {
        const attack = calculateGarbage({
            depth: 4,
            complexity: 2,
            holeMask: [columnsToMask([1]), columnsToMask([2]), columnsToMask([3])],
            sendForClean: true,
        });
        const restored = deserializeAttack(serializeAttack(attack));
        expect(restored.rows).toBe(attack.rows);
        expect(restored.holeMasks).toEqual(attack.holeMasks);
        expect(restored.cleanBonus).toBe(attack.cleanBonus);
        expect(restored.cleanMasks).toEqual(attack.cleanMasks);
    });
});
