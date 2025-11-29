// =================================================================================
// UTILITY HELPERS - Helper functions for Serenity Blocks
// =================================================================================

/**
 * Generate a random number between min and max
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Random number in range
 */
export function random(min, max) {
    return Math.random() * (max - min) + min;
}

/**
 * Seeded random number generator for deterministic randomness
 * Used for theme generation to ensure consistent visual output
 * @param {number} seed - Seed value for random generator
 * @returns {Function} Function that returns pseudo-random numbers
 */
export function seededRandom(seed) {
    let state = seed;
    return function () {
        state = (state * 9301 + 49297) % 233280;
        return state / 233280;
    };
}

/**
 * Format time in MM:SS format
 * @param {number} ms - Time in milliseconds
 * @returns {string} Formatted time string
 */
export function formatTime(ms) {
    if (!ms || isNaN(ms)) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
