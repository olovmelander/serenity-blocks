/**
 * Rainy Window Theme - Tetromino Visual Configuration
 *
 * Misty blues and city-light golds mirroring rain-streaked glass.
 */

export const RAINY_WINDOW_TETROMINOS = {
    version: 1,

    colors: {
        I: '#f6c46a', // Streetlight glow
        O: '#c9b4ff', // Lavender neon
        T: '#7bf0d0', // Mint reflections
        S: '#ff8fb5', // Umbrella pink
        Z: '#586abf', // Midnight indigo
        J: '#ffe9b7', // Window light
        L: '#8ccff9', // Rain haze
        GARBAGE: '#0b131d', // Storm shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 12,
        glowIntensity: 0.82,
        glowColor: '#8cb8ff',

        outline: true,
        outlineWidth: 1.9,
        outlineColor: '#09101a',

        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.26,

        shimmer: true,
        shimmerSpeed: 0.055,
        shimmerIntensity: 0.23,

        trails: true,
        trailLength: 0.2,
        trailOpacity: 0.34,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 9,
            glowIntensity: 0.72,
            outlineWidth: 1.6,
        },
        phaser: {
            glowRadius: 14,
            glowIntensity: 0.88,
            outlineWidth: 2.1,
        },
    },
};
