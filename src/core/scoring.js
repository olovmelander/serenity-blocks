// @ts-check
// =================================================================================
// SCORING - Score calculation and level progression for Serenity Blocks
// Implements the cascade / perfect-clear scoring system
// =================================================================================

import { SCORE_VALUES, LEVEL_SPEEDS, CASCADE_SCORING } from './constants.js';

/**
 * Calculate the score for line clears
 * Scoring formula:
 * - Base score: 250/500/1000/2000 (or 200*depth² for >4 lines)
 * - Cascade bonus: 200 * (complexity-1)²
 * - Perfect clear bonus: depth*1250 (or depth²*500 for >4)
 * - Level multiplier: +10% per level (additive)
 *
 * @param {number} linesCleared - Number of lines cleared (depth)
 * @param {number} level - Current game level
 * @param {number} complexity - Cascade count (1 = first clear, 2+ = cascades)
 * @param {boolean} isPerfectClear - True if board is now empty
 * @returns {number} Total points earned
 */
export function calculateLineClearScore(linesCleared, level, complexity = 1, isPerfectClear = false) {
    if (linesCleared <= 0) return 0;

    // Base score from SCORE_VALUES or quadratic for >4 lines
    let baseScore;
    if (linesCleared <= 4) {
        baseScore = SCORE_VALUES[linesCleared] || 0;
    } else {
        // 200 * depth² for mega-clears (>4 lines)
        baseScore = 200 * linesCleared * linesCleared;
    }

    // Cascade/complexity bonus: 200 * (complexity-1)²
    // complexity=1 means first clear (no cascade bonus)
    // complexity=2+ means cascades occurred
    const cascadeBonus = CASCADE_SCORING.CASCADE_BASE * Math.max(0, complexity - 1) ** 2;

    // Perfect clear bonus (board is now empty)
    let perfectBonus = 0;
    if (isPerfectClear) {
        if (linesCleared <= 4) {
            perfectBonus = linesCleared * CASCADE_SCORING.PERFECT_CLEAR_BASE;
        } else {
            perfectBonus = linesCleared * linesCleared * CASCADE_SCORING.PERFECT_CLEAR_LARGE;
        }
    }

    // Subtotal before level multiplier
    const subtotal = baseScore + cascadeBonus + perfectBonus;

    // Level multiplier: +10% per level (additive)
    // Formula: subtotal + (subtotal * 0.1 * level)
    const levelBonus = Math.floor(subtotal * CASCADE_SCORING.LEVEL_MULTIPLIER * level);

    return subtotal + levelBonus;
}

// NOTE (remediation Phase 2): the live level/line progression — 15 lines per
// level — is implemented in processPhysics (src/core/physics.js) and seeded by
// GameState.linesUntilNextLevel. The following older helpers were removed
// here because they had ZERO call sites and contradicted the live rule:
//   - calculateLevel / getLinesUntilNextLevel  (encoded a wrong 10-line cadence)
//   - calculateLineScore / calculateSoftDropScore / calculateHardDropScore
//     (older additive scoring, superseded by calculateLineClearScore)
// Do NOT re-introduce a progression helper here without making physics.js
// consume it, so the rule keeps a single source of truth.

/**
 * Get drop interval (speed) for a given level
 * @param {number} level - Current level
 * @returns {number} Drop interval in milliseconds
 */
export function getDropInterval(level) {
    const index = Math.min(level - 1, LEVEL_SPEEDS.length - 1);
    return LEVEL_SPEEDS[index];
}

/**
 * Get speed multiplier for display
 * @param {number} level - Current level
 * @returns {string} Speed multiplier (e.g., "1.0x", "2.5x")
 */
export function getSpeedMultiplier(level) {
    const baseSpeed = LEVEL_SPEEDS[0];
    const currentSpeed = getDropInterval(level);
    const multiplier = baseSpeed / currentSpeed;
    return `${multiplier.toFixed(1)}x`;
}
