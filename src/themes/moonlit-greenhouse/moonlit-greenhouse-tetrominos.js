/**
 * Moonlit Greenhouse Theme - Tetromino Visual Configuration
 *
 * Verdant palette inspired by moonlit leaves, dewdrops, and moth wings.
 */

export const MOONLIT_GREENHOUSE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffda9e', // Lantern glow
        O: '#d7b3ff', // Lavender bloom
        T: '#82f5b8', // Lush leaf
        S: '#ff9ecf', // Petal pink
        Z: '#5b7ba7', // Night indigo
        J: '#ffd76a', // Warm candlelight
        L: '#a8ffd8', // Dewdrop mint
        GARBAGE: '#112021', // Greenhouse silhouette
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 10,
        glowIntensity: 0.7,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.7,
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
            glowRadius: 8,
            glowIntensity: 0.65,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 12,
            glowIntensity: 0.75,
            outlineWidth: 1.9,
        },
    },
};
