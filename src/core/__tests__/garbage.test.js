import { describe, it, expect } from 'vitest';
import {
    calculateGarbage, maskArrayToBits, bitsToColumns, ATTACK_TYPES,
    applyHandicap, accumulateHandicapStamps,
} from '../garbage.js';
import { COLS } from '../constants.js';

describe('Garbage Logic (Quadra Compliance)', () => {
    describe('Bitwise Encoding (Inverse Mapping)', () => {
        // Quadra encoding: MSB (Bit 9) is Column 0, LSB (Bit 0) is Column 9
        // 1 = Hole, 0 = Solid

        it('encodes Column 0 as Bit 9 (512)', () => {
            const mask = Array(COLS).fill(false);
            mask[0] = true; // Hole at col 0

            // Expected: 1000000000 binary = 512 decimal
            expect(maskArrayToBits(mask)).toBe(512);
        });

        it('encodes Column 9 as Bit 0 (1)', () => {
            const mask = Array(COLS).fill(false);
            mask[9] = true; // Hole at col 9

            // Expected: 0000000001 binary = 1 decimal
            expect(maskArrayToBits(mask)).toBe(1);
        });

        it('encodes Columns 0 and 9 together as 513', () => {
            const mask = Array(COLS).fill(false);
            mask[0] = true;
            mask[9] = true;

            // Expected: 1000000001 binary = 513 decimal
            expect(maskArrayToBits(mask)).toBe(513);
        });

        it('decodes 512 back to Column 0', () => {
            const cols = bitsToColumns(512);
            expect(cols).toEqual([0]);
        });
    });

    describe('calculateGarbage (Quadra Logic)', () => {
        it('generates correct hole mask for single line clear', () => {
            // Simulate a summary from a manual clear
            // Quadra Logic: The "moved" cells (where piece was) become holes.

            // Scenario: Piece placed in Column 5.
            const summary = {
                depth: 1, // 1 line cleared
                complexity: 1,
                holeMask: [
                    // Row 0 mask: True at index 5
                    Array.from({ length: COLS }, (_, i) => i === 5),
                ],
                manualColumns: [5],
            };

            const attack = calculateGarbage(summary);

            // Base attack = depth - 1. So for 1 line, attack is 0.
            // 1 line -> 0 attack lines; 2 -> 1; 3 -> 2; 4 -> 3.
            // (Single line clears send no garbage.)

            // Let's verify the mask generation even if 0 lines are effectively sent "as attack",
            // the object should still capture the masks generally.
            // But wait, calculateGarbage uses `rowsToSend = Math.max(0, depth - 1)`.
            // So for depth 1, rowsToSend is 0.

            expect(attack.rows).toBe(0);
        });

        it('generates correct hole mask for Double (2 lines) clear', () => {
            // Scenario: Piece placed at Column 0 (Vertical I-piece maybe, or part of it)
            // contributing to 2 cleared lines.

            const col0Mask = Array.from({ length: COLS }, (_, i) => i === 0);

            const summary = {
                depth: 2,
                complexity: 1,
                holeMask: [
                    col0Mask, // Line 1 hole at 0
                    col0Mask, // Line 2 hole at 0
                ],
                manualColumns: [0],
            };

            const attack = calculateGarbage(summary);

            // Quadra: Depth 2 -> 1 attack line
            expect(attack.rows).toBe(1);

            // The hole mask for that 1 line should correspond to the first cleared line's mask
            // The sender loops over the outgoing garbage rows.
            // `holeMasks` in `calculateGarbage` slices `rowsToSend`.
            // So it takes the first mask.

            const expectedBit = 512; // Col 0 -> Bit 9
            expect(attack.holeMasks[0]).toBe(expectedBit);
        });

        it('generates clean bonus correctly (Quadra 72/585 pattern)', () => {
            const summary = {
                depth: 4, // Tetris
                complexity: 1,
                holeMask: Array(4).fill(Array(COLS).fill(false)), // Doesn't matter for clean
                sendForPerfectClear: true,
            };

            const attack = calculateGarbage(summary);

            // Quadra Clean Bonus: (1 + depth) / 2
            // (1 + 4) / 2 = 2 (floored)
            expect(attack.cleanRowBonus).toBe(2);
            expect(attack.cleanMasks.length).toBe(2);

            // Pattern 0 (Even): 72 (0001001000) -> Cols 3, 6
            // Pattern 1 (Odd): 585 (1001001001) -> Cols 0, 3, 6, 9

            // Check first mask
            const cols0 = bitsToColumns(attack.cleanMasks[0]);
            expect(cols0).toEqual([3, 6]);

            // Check second mask
            const cols1 = bitsToColumns(attack.cleanMasks[1]);
            expect(cols1).toEqual([0, 3, 6, 9]);
        });
    });

    describe('Attack rulesets (config-selectable)', () => {
        const doubleClear = () => ({
            depth: 2,
            complexity: 1,
            holeMask: [
                Array.from({ length: COLS }, (_, i) => i === 0),
                Array.from({ length: COLS }, (_, i) => i === 0),
            ],
            manualColumns: [0],
        });

        it('defaults to a line attack when no rules are given', () => {
            const attack = calculateGarbage(doubleClear());
            expect(attack.attackType).toBe(ATTACK_TYPES.LINES);
            expect(attack.param).toBe(0);
        });

        it('forces a Blind attack when rules.forceAttackType=blind', () => {
            const attack = calculateGarbage(doubleClear(), { forceAttackType: ATTACK_TYPES.BLIND });
            expect(attack.attackType).toBe(ATTACK_TYPES.BLIND);
            // Blind param = blindBaseDuration(3) + complexity(1)
            expect(attack.param).toBe(4);
            // A blind attack still carries its blackout entry on expansion
            const entries = attack.expandEntries();
            expect(entries.some((e) => e.type === 'blind')).toBe(true);
        });

        it('forces a Full Blind attack when rules.forceAttackType=full_blind', () => {
            const attack = calculateGarbage(doubleClear(), { forceAttackType: ATTACK_TYPES.FULL_BLIND });
            expect(attack.attackType).toBe(ATTACK_TYPES.FULL_BLIND);
            // Full blind param = depth(2) * fullBlindMultiplier(2)
            expect(attack.param).toBe(4);
            const entries = attack.expandEntries();
            expect(entries.some((e) => e.type === 'full_blind')).toBe(true);
        });

        it('honours custom blind tuning params', () => {
            const attack = calculateGarbage(doubleClear(), {
                forceAttackType: ATTACK_TYPES.BLIND,
                blindBaseDuration: 5,
            });
            expect(attack.param).toBe(6); // 5 + complexity(1)
        });

        it('forces a Hot Potato attack with a timer param', () => {
            const attack = calculateGarbage(doubleClear(), {
                forceAttackType: ATTACK_TYPES.POTATO,
                potatoDurationMs: 9000,
            });
            expect(attack.attackType).toBe(ATTACK_TYPES.POTATO);
            expect(attack.param).toBe(9000);
        });
    });

    describe('Handicap pipeline', () => {
        const mkState = (handicap) => ({
            handicap, handicaps: {}, handicapCrowd: 0, isAlive: true,
        });

        it('equal handicaps accumulate no stamps and never reduce attacks', () => {
            const sender = mkState(2);
            const opponent = mkState(2);

            for (let i = 0; i < 20; i++) {
                accumulateHandicapStamps(sender, { 1: opponent }, 2);
            }

            expect(sender.handicaps[1] || 0).toBe(0);
            expect(applyHandicap(4, sender, 1)).toBe(4); // unchanged
        });

        it('a higher-handicap sender accumulates stamps and reduces lines to weaker opponents', () => {
            const sender = mkState(4); // Grandmaster
            const opponent = mkState(1); // Apprentice
            // diff = 3 → max 9 stamps; 1 stamp accrues per placement
            for (let i = 0; i < 9; i++) {
                accumulateHandicapStamps(sender, { 1: opponent }, 2);
            }
            expect(sender.handicaps[1]).toBe(9);

            // 3 stamps reduce 1 line → 9 stamps reduce up to 3 lines
            expect(applyHandicap(4, sender, 1)).toBe(1);
            // stamps consumed
            expect(sender.handicaps[1]).toBe(0);
        });

        it('caps accumulated stamps at the level difference', () => {
            const sender = mkState(3);
            const opponent = mkState(2); // diff = 1 → max 3 stamps
            for (let i = 0; i < 10; i++) {
                accumulateHandicapStamps(sender, { 1: opponent }, 2);
            }
            expect(sender.handicaps[1]).toBe(3);
        });

        it('clean attacks bypass handicap (no reduction, no stamp spend)', () => {
            const sender = mkState(4);
            sender.handicaps[1] = 9;
            expect(applyHandicap(4, sender, 1, true)).toBe(4);
            expect(sender.handicaps[1]).toBe(9);
        });
    });
});
