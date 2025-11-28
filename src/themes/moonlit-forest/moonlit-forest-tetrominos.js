/**
 * Moonlit Forest Theme - Tetromino Visual Configuration
 *
 * Inspired by the mystical, enchanted forest: bioluminescent mushrooms,
 * silvery moonbeams, glowing wildlife eyes, and the magical interplay
 * of moonlight and shadow through ancient trees.
 */

export const MOONLIT_FOREST_TETROMINOS = {
    version: 1,

    colors: {
        I: '#c0d8f0', // Moonbeam silver - pale silvery moonlight rays
        O: '#00d9ff', // Glowing mushroom cyan - bioluminescent fungi
        T: '#a78bfa', // Mystical purple - enchanted forest magic
        S: '#4a9b6b', // Forest emerald - lush tree foliage
        Z: '#2c4a5a', // Shadowy teal - deep forest night
        J: '#ffa726', // Amber eyes - glowing wildlife and fireflies
        L: '#6ee7b7', // Moss aqua - undergrowth and forest floor
        GARBAGE: '#1a2820', // Deep shadow - darkest forest depths
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 12,
        glowIntensity: 0.75,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'rgba(192, 216, 240, 0.3)', // Soft moonlight outline

        // Pulse like glowing mushrooms and breathing forest
        pulse: true,
        pulseSpeed: 0.042, // Gentle, organic pulsing
        pulseAmplitude: 0.21, // Noticeable bioluminescence

        // Shimmer like moonlight filtering through leaves
        shimmer: true,
        shimmerSpeed: 0.048,
        shimmerIntensity: 0.18,

        // Trails like moonbeams through mist
        trails: true,
        trailLength: 0.14,
        trailOpacity: 0.28,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 10,
            glowIntensity: 0.7,
            outlineWidth: 1.6,
        },
        phaser: {
            glowRadius: 14,
            glowIntensity: 0.8,
            outlineWidth: 2.0,
        },
    },
};
