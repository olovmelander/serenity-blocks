/**
 * Fall Theme - Tetromino Visual Configuration
 *
 * Warm autumn palette of glowing embers, falling leaves, and golden harvest tones.
 * Each piece glows like a gentle ember floating through the autumn twilight.
 */

export const FALL_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffb300', // Golden harvest amber - like wheat fields at sunset
        O: '#ff6f00', // Deep pumpkin orange - rich autumn squash
        T: '#ff5722', // Fiery maple red-orange - blazing fall foliage
        S: '#f4511e', // Crimson maple leaf - deep autumn red
        Z: '#ffa726', // Warm golden yellow - candlelight glow
        J: '#fb8c00', // Burnt sienna orange - autumn oak bark
        L: '#ff9100', // Brilliant amber - glowing ember core
        GARBAGE: '#3e2723', // Dark walnut bark - forest floor shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 14,
        glowIntensity: 0.75,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: 'lighten', // Lighter edges like ember edges

        // Gentle pulsing like fireflies and embers
        pulse: true,
        pulseSpeed: 0.028, // Slow, organic breathing
        pulseAmplitude: 0.22, // Gentle variation

        // Subtle shimmer like heat haze from embers
        shimmer: true,
        shimmerSpeed: 0.045,
        shimmerIntensity: 0.18,

        // Soft trails for falling motion
        trails: false, // Keep it clean, falling leaves don't trail
        trailLength: 0,
        trailOpacity: 0,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 11,
            glowIntensity: 0.68,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 16,
            glowIntensity: 0.82,
            outlineWidth: 2.2,
        },
    },
};
