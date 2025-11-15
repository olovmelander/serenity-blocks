/**
 * Summer Theme - Tetromino Visual Configuration
 *
 * Sun-faded citrus, dune gold, and sea-breeze turquoise for playful, hazy warmth.
 */

export const SUMMER_TETROMINOS = {
    version: 1,

    colors: {
        I: '#71e6ff',  // Ocean spray
        O: '#ffe58f',  // Noon sun
        T: '#ffb4d6',  // Bougainvillea pop
        S: '#8deba3',  // Palm frond
        Z: '#ff8a63',  // Sunset coral
        J: '#6bb0ff',  // Horizon blue
        L: '#ffd28a',  // Sandstone glow
        GARBAGE: '#3e2f1c', // Driftwood shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 12,
        glowIntensity: 0.8,
        glowColor: '#ffe5b2',

        outline: true,
        outlineWidth: 1.7,
        outlineColor: '#2c1c0d',

        pulse: true,
        pulseSpeed: 0.04,
        pulseAmplitude: 0.24,

        shimmer: true,
        shimmerSpeed: 0.06,
        shimmerIntensity: 0.22,

        trails: true,
        trailLength: 0.2,
        trailOpacity: 0.32,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 10,
            glowIntensity: 0.72,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 14,
            glowIntensity: 0.88,
            outlineWidth: 2.0,
        },
    },
};
