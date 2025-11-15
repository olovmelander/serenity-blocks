/**
 * Supernova Theme - Tetromino Visual Configuration
 *
 * High-energy palette inspired by an exploding star: cyan cores, magenta halos,
 * solar oranges, and plasma violets. Pieces glow brightly with trails to match
 * the theme's shockwaves.
 */

export const SUPERNOVA_TETROMINOS = {
    version: 1,

    colors: {
        I: '#64dcff',  // Shockwave cyan
        O: '#ffd05e',  // Solar gold
        T: '#d05bff',  // Stellar magenta
        S: '#8cf6ff',  // Plasma teal
        Z: '#ff6bb7',  // Fusion pink
        J: '#7c8bff',  // Cosmic indigo
        L: '#ff9150',  // Ember orange
        GARBAGE: '#1b1022', // Deep space shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 13,
        glowIntensity: 0.85,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.045,
        pulseAmplitude: 0.28,

        shimmer: true,
        shimmerSpeed: 0.07,
        shimmerIntensity: 0.25,

        trails: true,
        trailLength: 0.2,
        trailOpacity: 0.35,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 11,
            glowIntensity: 0.8,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 15,
            glowIntensity: 0.9,
            outlineWidth: 2.2,
        },
    },
};
