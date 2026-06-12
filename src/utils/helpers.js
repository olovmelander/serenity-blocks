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
    let state = Number.isFinite(Number(seed)) ? Number(seed) : 1;
    const rng = function () {
        state = (state * 9301 + 49297) % 233280;
        return state / 233280;
    };

    rng.getState = () => state;
    rng.setState = (nextState) => {
        if (Number.isFinite(Number(nextState))) {
            state = Number(nextState);
        }
    };
    rng.seed = seed;

    return rng;
}

/**
 * Clamp a value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum bound
 * @param {number} max - Maximum bound
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Clamp a value between 0 and 1
 * @param {number} value - Value to clamp
 * @returns {number} Clamped value in [0, 1]
 */
export function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

/**
 * Convert hex color string to RGB object
 * Supports 3-digit and 6-digit hex with or without # prefix
 * @param {string} hex - Hex color string (e.g. '#ff0000', 'f00')
 * @returns {Object|null} { r, g, b } (0-255) or null if invalid
 */
export function hexToRgb(hex) {
    if (!hex) return null;

    let value = hex.trim();
    if (value.startsWith('#')) value = value.slice(1);

    if (value.length === 3) {
        value = value.split('').map((char) => char + char).join('');
    }

    if (value.length !== 6) return null;

    const r = parseInt(value.substring(0, 2), 16);
    const g = parseInt(value.substring(2, 4), 16);
    const b = parseInt(value.substring(4, 6), 16);

    if ([r, g, b].some((c) => Number.isNaN(c))) return null;

    return { r, g, b };
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
