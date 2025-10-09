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
    return function() {
        state = (state * 9301 + 49297) % 233280;
        return state / 233280;
    };
}
