/**
 * Cosmic Chimes Theme - Tetromino Visual Configuration
 *
 * Ethereal palette combining soft auroras, chime glows, and cosmic dust hues.
 */

export const COSMIC_CHIMES_TETROMINOS = {
    version: 1,

    colors: {
        I: '#abf4ff', // Icy cyan
        O: '#ffe3a8', // Bell gold
        T: '#d8c1ff', // Lavender chime
        S: '#98ffd8', // Mint aurora
        Z: '#ff9fd5', // Rose nebula
        J: '#7a8bff', // Deep indigo
        L: '#ffd99f', // Warm glow
        GARBAGE: '#121629', // Void shadow
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
        shimmerIntensity: 0.15,

        trails: true,
        trailLength: 0.14,
        trailOpacity: 0.28,
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
