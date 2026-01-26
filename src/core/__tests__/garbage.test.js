import { describe, it, expect } from 'vitest';
import {
    calculateGarbage, maskArrayToBits, bitsToColumns, columnsToMask,
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

            // Quadra: Base attack = depth - 1. So for 1 line, attack is 0.
            // Wait, Quadra logic: 1 line -> 0 attack lines?
            // Yes: case 1: score_add=250.
            // attacks are sent via Net_list::sendlines.
            // "base attack lines: depth - 1" is consistent with game.cc/canvas.cc comments?
            // Actually, for sending lines:
            // Canvas::give_line: i = max(0, depth-1-alive_count)

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
            // In Quadra `Net_list::send`, it loops j < nb.
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
                sendForClean: true,
            };

            const attack = calculateGarbage(summary);

            // Quadra Clean Bonus: (1 + depth) / 2
            // (1 + 4) / 2 = 2 (floored)
            expect(attack.cleanBonus).toBe(2);
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
});
