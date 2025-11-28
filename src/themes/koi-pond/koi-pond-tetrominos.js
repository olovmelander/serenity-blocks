/**
 * Koi Pond Theme - Tetromino Visual Configuration
 *
 * Inspired by koi fish, lily pads, and lantern reflections.
 */

export const KOI_POND_TETROMINOS = {
    version: 1,

    colors: {
        I: '#8ef6ff', // Pond cyan
        O: '#ffd58a', // Lantern gold
        T: '#ff9fbf', // Blossom pink
        S: '#a5ffc9', // Lily green
        Z: '#ff8865', // Koi orange
        J: '#6982d8', // Indigo ripple
        L: '#ffe7a3', // Candle glow
        GARBAGE: '#152033', // Deep water shadow
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
