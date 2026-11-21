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
        T: '#78e79f', // New fern leaf
        S: '#ff91b8', // Orchid lip
        Z: '#829be8', // Moonlit indigo
        J: '#ff9f60', // Copper lantern
        L: '#60ddd8', // Canal glass
        GARBAGE: '#112021', // Greenhouse silhouette
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 7,
        glowIntensity: 0.52,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.7,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.07,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.08,

        trails: true,
        trailLength: 0.14,
        trailOpacity: 0.28,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 6,
            glowIntensity: 0.48,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 8,
            glowIntensity: 0.54,
            outlineWidth: 1.6,
        },
    },
};
