// @ts-check
// =================================================================================
// SCORING - Score calculation and level progression for Serenity Blocks
// Implements the cascade / perfect-clear scoring system
// =================================================================================

import { SCORE_VALUES, LEVEL_SPEEDS, QUADRA_SCORING } from './constants.js';

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
export function calculateQuadraLineScore(linesCleared, level, complexity = 1, isPerfectClear = false) {
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
    const cascadeBonus = QUADRA_SCORING.CASCADE_BASE * Math.max(0, complexity - 1) ** 2;

    // Perfect clear bonus (board is now empty)
    let perfectBonus = 0;
    if (isPerfectClear) {
        if (linesCleared <= 4) {
            perfectBonus = linesCleared * QUADRA_SCORING.PERFECT_CLEAR_BASE;
        } else {
            perfectBonus = linesCleared * linesCleared * QUADRA_SCORING.PERFECT_CLEAR_LARGE;
        }
    }

    // Subtotal before level multiplier
    const subtotal = baseScore + cascadeBonus + perfectBonus;

    // Level multiplier: +10% per level (additive)
    // Formula: subtotal + (subtotal * 0.1 * level)
    const levelBonus = Math.floor(subtotal * QUADRA_SCORING.LEVEL_MULTIPLIER * level);

    return subtotal + levelBonus;
}

// NOTE (remediation Phase 2): the live level/line progression — 15 lines per
// level — is implemented in processPhysics (src/core/physics.js) and seeded by
// GameState.linesUntilNextLevel. The following pre-Quadra helpers were removed
// here because they had ZERO call sites and contradicted the live rule:
//   - calculateLevel / getLinesUntilNextLevel  (encoded a wrong 10-line cadence)
//   - calculateLineScore / calculateSoftDropScore / calculateHardDropScore
//     (additive pre-Quadra scoring, superseded by calculateQuadraLineScore)
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

/**
 * Calculate rank based on score
 * @param {number} score - Player's score
 * @returns {string} Rank label
 */
export function calculateRank(score) {
    if (score < 1000) return 'Beginner';
    if (score < 5000) return 'Novice';
    if (score < 10000) return 'Intermediate';
    if (score < 25000) return 'Advanced';
    if (score < 50000) return 'Expert';
    if (score < 100000) return 'Master';
    if (score < 250000) return 'Grandmaster';
    return 'Legend';
}

/**
 * Format score with commas for display
 * @param {number} score - Score to format
 * @returns {string} Formatted score
 */
export function formatScore(score) {
    return score.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Calculate efficiency rating based on performance
 * @param {number} score - Total score
 * @param {number} lines - Lines cleared
 * @param {number} piecesPlaced - Total pieces placed
 * @returns {number} Efficiency percentage (0-100)
 */
export function calculateEfficiency(score, lines, piecesPlaced) {
    if (piecesPlaced === 0) return 0;

    // Ideal scenario: 4 lines per piece (a quad every piece) = 100% efficiency
    const idealLines = piecesPlaced * 4;
    const efficiency = (lines / idealLines) * 100;

    return Math.min(100, Math.round(efficiency));
}

/**
 * Get performance grade based on efficiency
 * @param {number} efficiency - Efficiency percentage
 * @returns {string} Grade (S, A, B, C, D, F)
 */
export function getPerformanceGrade(efficiency) {
    if (efficiency >= 90) return 'S';
    if (efficiency >= 80) return 'A';
    if (efficiency >= 70) return 'B';
    if (efficiency >= 60) return 'C';
    if (efficiency >= 50) return 'D';
    return 'F';
}
