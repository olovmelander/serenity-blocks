/**
 * @fileoverview Unit tests for Quadra-style scoring implementation
 * Verifies that calculateQuadraLineScore matches the exact Quadra formula
 */

import { describe, it, expect } from 'vitest';
import { calculateQuadraLineScore } from '../../src/core/scoring.js';
import { SCORE_VALUES, QUADRA_SCORING } from '../../src/core/constants.js';

describe('Quadra Scoring', () => {
    describe('SCORE_VALUES constants', () => {
        it('should have Quadra base values', () => {
            expect(SCORE_VALUES[1]).toBe(250);  // Single
            expect(SCORE_VALUES[2]).toBe(500);  // Double
            expect(SCORE_VALUES[3]).toBe(1000); // Triple
            expect(SCORE_VALUES[4]).toBe(2000); // Tetris
        });
    });

    describe('QUADRA_SCORING constants', () => {
        it('should have correct cascade and level multipliers', () => {
            expect(QUADRA_SCORING.CASCADE_BASE).toBe(200);
            expect(QUADRA_SCORING.PERFECT_CLEAR_BASE).toBe(1250);
            expect(QUADRA_SCORING.LEVEL_MULTIPLIER).toBe(0.1);
        });
    });

    describe('calculateQuadraLineScore', () => {
        describe('base scoring at level 1, no cascade', () => {
            it('should score single line correctly', () => {
                // Base: 250, Level bonus: 250 * 0.1 * 1 = 25
                // Total: 275
                const score = calculateQuadraLineScore(1, 1, 1, false);
                expect(score).toBe(275);
            });

            it('should score double correctly', () => {
                // Base: 500, Level bonus: 500 * 0.1 * 1 = 50
                // Total: 550
                const score = calculateQuadraLineScore(2, 1, 1, false);
                expect(score).toBe(550);
            });

            it('should score triple correctly', () => {
                // Base: 1000, Level bonus: 1000 * 0.1 * 1 = 100
                // Total: 1100
                const score = calculateQuadraLineScore(3, 1, 1, false);
                expect(score).toBe(1100);
            });

            it('should score tetris correctly', () => {
                // Base: 2000, Level bonus: 2000 * 0.1 * 1 = 200
                // Total: 2200
                const score = calculateQuadraLineScore(4, 1, 1, false);
                expect(score).toBe(2200);
            });
        });

        describe('level multiplier (+10% per level)', () => {
            it('should apply 10% per level additively', () => {
                // Level 5: Base 250 + (250 * 0.1 * 5) = 250 + 125 = 375
                const score = calculateQuadraLineScore(1, 5, 1, false);
                expect(score).toBe(375);
            });

            it('should calculate tetris at level 10', () => {
                // Base: 2000, Level bonus: 2000 * 0.1 * 10 = 2000
                // Total: 4000
                const score = calculateQuadraLineScore(4, 10, 1, false);
                expect(score).toBe(4000);
            });
        });

        describe('cascade bonus (complexity > 1)', () => {
            it('should add cascade bonus for complexity 2', () => {
                // Base: 250
                // Cascade: 200 * (2-1)^2 = 200
                // Subtotal: 450
                // Level bonus: 450 * 0.1 * 1 = 45
                // Total: 495
                const score = calculateQuadraLineScore(1, 1, 2, false);
                expect(score).toBe(495);
            });

            it('should add larger cascade bonus for complexity 3', () => {
                // Base: 250
                // Cascade: 200 * (3-1)^2 = 200 * 4 = 800
                // Subtotal: 1050
                // Level bonus: 1050 * 0.1 * 1 = 105
                // Total: 1155
                const score = calculateQuadraLineScore(1, 1, 3, false);
                expect(score).toBe(1155);
            });

            it('should add huge cascade bonus for complexity 5', () => {
                // Base: 250
                // Cascade: 200 * (5-1)^2 = 200 * 16 = 3200
                // Subtotal: 3450
                // Level bonus: 3450 * 0.1 * 1 = 345
                // Total: 3795
                const score = calculateQuadraLineScore(1, 1, 5, false);
                expect(score).toBe(3795);
            });
        });

        describe('perfect clear bonus', () => {
            it('should add perfect clear bonus for single line', () => {
                // Base: 250
                // Perfect: 1 * 1250 = 1250
                // Subtotal: 1500
                // Level bonus: 1500 * 0.1 * 1 = 150
                // Total: 1650
                const score = calculateQuadraLineScore(1, 1, 1, true);
                expect(score).toBe(1650);
            });

            it('should add perfect clear bonus for tetris', () => {
                // Base: 2000
                // Perfect: 4 * 1250 = 5000
                // Subtotal: 7000
                // Level bonus: 7000 * 0.1 * 1 = 700
                // Total: 7700
                const score = calculateQuadraLineScore(4, 1, 1, true);
                expect(score).toBe(7700);
            });
        });

        describe('edge cases', () => {
            it('should return 0 for 0 lines', () => {
                expect(calculateQuadraLineScore(0, 1, 1, false)).toBe(0);
            });

            it('should return 0 for negative lines', () => {
                expect(calculateQuadraLineScore(-1, 1, 1, false)).toBe(0);
            });

            it('should handle mega-clears (>4 lines) with quadratic formula', () => {
                // Base: 200 * 5^2 = 5000
                // Level bonus: 5000 * 0.1 * 1 = 500
                // Total: 5500
                const score = calculateQuadraLineScore(5, 1, 1, false);
                expect(score).toBe(5500);
            });
        });
    });
});

// ============================================================
// FALL SPEED TESTS - Verify Quadra's drop interval formula
// ============================================================

import { getQuadraDropInterval, LEVEL_SPEEDS } from '../../src/core/constants.js';

describe('Quadra Fall Speed', () => {
    describe('getQuadraDropInterval', () => {
        // Speed formula from canvas.cc:calc_speed():
        // level <= 10: speed = 4 + (level - 1) * 5
        // level > 10: speed = 50 + (level - 10) * 3
        // 
        // Conversion from calc_by (>>4 = divide by 16):
        // Cell = 18 pixels × 16 = 288 sub-units
        // Drop interval = 2880 / speed ms (288 × 10ms per frame)

        it('should calculate level 1 speed correctly', () => {
            // speed = 4, interval = 2880/4 = 720ms
            expect(getQuadraDropInterval(1)).toBe(720);
        });

        it('should calculate level 5 speed correctly', () => {
            // speed = 4 + 4*5 = 24, interval = 2880/24 = 120ms
            expect(getQuadraDropInterval(5)).toBe(120);
        });

        it('should calculate level 10 speed correctly', () => {
            // speed = 4 + 9*5 = 49, interval = 2880/49 = 58ms
            expect(getQuadraDropInterval(10)).toBe(58);
        });

        it('should calculate level 11 speed correctly (transition)', () => {
            // speed = 50 + 1*3 = 53, interval = 2880/53 = 54ms
            expect(getQuadraDropInterval(11)).toBe(54);
        });

        it('should calculate level 20 speed correctly', () => {
            // speed = 50 + 10*3 = 80, interval = 2880/80 = 36ms
            expect(getQuadraDropInterval(20)).toBe(36);
        });
    });

    describe('LEVEL_SPEEDS array', () => {
        it('should have 100 levels', () => {
            expect(LEVEL_SPEEDS.length).toBe(100);
        });

        it('should match getQuadraDropInterval for all levels', () => {
            for (let level = 1; level <= 100; level++) {
                expect(LEVEL_SPEEDS[level - 1]).toBe(getQuadraDropInterval(level));
            }
        });

        it('should have decreasing or equal speeds as level increases', () => {
            for (let i = 1; i < LEVEL_SPEEDS.length; i++) {
                expect(LEVEL_SPEEDS[i]).toBeLessThanOrEqual(LEVEL_SPEEDS[i - 1]);
            }
        });
    });
});
