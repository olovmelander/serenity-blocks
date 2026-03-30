/**
 * Tornado Theme - Tetromino Visual Configuration
 *
 * Warm glow palette with rich contrast for storm-lit backgrounds.
 */

export const TORNADO_TETROMINOS = {
    version: 1,

    colors: {
        I: '#87CEEB', // Cool contrast
        O: '#FFD700', // Bright gold
        T: '#E6A8D7', // Soft accent
        S: '#98FB98', // Fresh green
        Z: '#FFB7C5', // Warm pink
        J: '#9DC8E8', // Light blue
        L: '#FFCC5C', // Warm amber
        GARBAGE: '#4a6741', // Deep neutral
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 14,
        glowIntensity: 0.85,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.8,
        outlineColor: '#1a3020',

        pulse: true,
        pulseSpeed: 0.028,
        pulseAmplitude: 0.25,

        shimmer: true,
        shimmerSpeed: 0.045,
        shimmerIntensity: 0.22,

        trails: true,
        trailLength: 0.22,
        trailOpacity: 0.32,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 12,
            glowIntensity: 0.75,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 16,
            glowIntensity: 0.92,
            outlineWidth: 2.0,
        },
    },
};
