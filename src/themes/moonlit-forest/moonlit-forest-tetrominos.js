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
        I: '#c5d8dc', // Neutral silver moon key
        O: '#62d9bd', // Bioluminescent fungal teal
        T: '#9d89c7', // Bark-violet forest magic
        S: '#5f9f82', // Moonlit moss
        Z: '#7194a5', // Mist blue — lifted so it remains legible in deep shadow
        J: '#ebcb69', // Rare firefly gold
        L: '#82baa8', // Pale fern green
        GARBAGE: '#344854', // Cool slate with enough separation from the foreground
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 10,
        glowIntensity: 0.62,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.65,
        outlineColor: 'rgba(197, 216, 220, 0.38)',

        // Pulse like glowing mushrooms and breathing forest
        pulse: true,
        pulseSpeed: 0.042, // Gentle, organic pulsing
        pulseAmplitude: 0.14,

        // Shimmer like moonlight filtering through leaves
        shimmer: true,
        shimmerSpeed: 0.048,
        shimmerIntensity: 0.12,

        // Trails like moonbeams through mist
        trails: true,
        trailLength: 0.14,
        trailOpacity: 0.2,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 9,
            glowIntensity: 0.58,
            outlineWidth: 1.6,
        },
        phaser: {
            glowRadius: 12,
            glowIntensity: 0.68,
            outlineWidth: 2.0,
        },
    },
};
