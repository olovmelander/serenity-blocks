/**
 * Fall Theme - Tetromino Visual Configuration
 *
 * Warm autumn palette of glowing embers, falling leaves, and golden harvest tones.
 * Each piece glows like a gentle ember floating through the autumn twilight.
 */

export const FALL_TETROMINOS = {
    version: 1,

    colors: {
        I: '#f6cf72', // Sunlit birch gold
        O: '#ef9e42', // Harvest amber
        T: '#bc77ac', // Plum twilight
        S: '#8fb89c', // Woodland sage
        Z: '#df7052', // Copper maple
        J: '#7faaca', // Blue mist between the trees
        L: '#edb68b', // Peach light through the canopy
        GARBAGE: '#3e2723', // Dark walnut bark - forest floor shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 14,
        glowIntensity: 0.62,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: 'lighten', // Lighter edges like ember edges

        // Gentle pulsing like fireflies and embers
        pulse: true,
        pulseSpeed: 0.028, // Slow, organic breathing
        pulseAmplitude: 0.12, // Gentle variation

        // Subtle shimmer like heat haze from embers
        shimmer: true,
        shimmerSpeed: 0.045,
        shimmerIntensity: 0.11,

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
