/**
 * Meadow Theme - Tetromino Visual Configuration
 *
 * Blooming meadow palette with soft greens, floral pinks, and sunlit yellows.
 */

export const MEADOW_TETROMINOS = {
    version: 1,

    colors: {
        I: '#9ff6d5', // Mint leaf
        O: '#ffe58f', // Sunflower glow
        T: '#d9b7ff', // Lavender bloom
        S: '#8befb0', // Clover green
        Z: '#ff9fbf', // Rose petal
        J: '#87a6ff', // Sky blue
        L: '#ffdca1', // Warm pollen
        GARBAGE: '#1d2b1f', // Forest shadow
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
