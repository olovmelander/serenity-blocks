/**
 * Singing Bowl Theme - Tetromino Visual Configuration
 *
 * Tranquil palette inspired by warm brass, incense smoke, and lotus petals.
 */

export const SINGING_BOWL_TETROMINOS = {
    version: 1,

    colors: {
        I: '#b5fff2',  // Soft aqua
        O: '#fdda9b',  // Brass glow
        T: '#e5b6ff',  // Lavender incense
        S: '#a9ffd0',  // Lotus leaf
        Z: '#ff9fbf',  // Rose petal
        J: '#8d99ff',  // Indigo chant
        L: '#ffe8aa',  // Candlelight
        GARBAGE: '#1a1a21', // Meditation shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 9,
        glowIntensity: 0.65,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.6,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.2,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.14,

        trails: true,
        trailLength: 0.14,
        trailOpacity: 0.25,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 7,
            glowIntensity: 0.6,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 11,
            glowIntensity: 0.7,
            outlineWidth: 1.8,
        },
    },
};
