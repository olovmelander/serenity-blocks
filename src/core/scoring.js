// =================================================================================
// SCORING - Score calculation and level progression for Serenity Blocks
// =================================================================================

import { SCORE_VALUES, LEVEL_SPEEDS } from './constants.js';

/**
 * Calculate score for line clears
 * @param {number} linesCleared - Number of lines cleared (1-4)
 * @param {number} currentLevel - Current game level
 * @returns {number} Points earned
 */
export function calculateLineScore(linesCleared, currentLevel) {
    const baseScore = SCORE_VALUES[linesCleared] || 0;
    return baseScore * currentLevel;
}

/**
 * Calculate score for soft drop
 * @param {number} rowsDropped - Number of rows dropped
 * @param {number} currentLevel - Current game level
 * @returns {number} Points earned (1 point per row * level)
 */
export function calculateSoftDropScore(rowsDropped, currentLevel) {
    return rowsDropped * currentLevel;
}

/**
 * Calculate score for hard drop
 * @param {number} rowsDropped - Number of rows dropped
 * @param {number} currentLevel - Current game level
 * @returns {number} Points earned (2 points per row * level)
 */
export function calculateHardDropScore(rowsDropped, currentLevel) {
    return rowsDropped * 2 * currentLevel;
}

/**
 * Calculate new level based on lines cleared
 * Level increases every 10 lines
 * @param {number} totalLines - Total lines cleared
 * @returns {number} Current level (1-based)
 */
export function calculateLevel(totalLines) {
    return Math.floor(totalLines / 10) + 1;
}

/**
 * Calculate lines needed for next level
 * @param {number} totalLines - Total lines cleared
 * @returns {number} Lines remaining until next level
 */
export function getLinesUntilNextLevel(totalLines) {
    return 10 - (totalLines % 10);
}

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
    return multiplier.toFixed(1) + 'x';
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

    // Ideal scenario: 4 lines per piece (Tetris every time) = 100% efficiency
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
