/**
 * Ice Temple Theme - Tetromino Visual Configuration
 *
 * Glacial gradients inspired by aurora-lit ice walls, crystalline shards, and moonlit snow.
 */

export const ICE_TEMPLE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#67e7b5', // Jade frost
        O: '#e8f5ff', // Snow halo
        T: '#9faaff', // Moonlit indigo
        S: '#56d8ee', // Glacier vein
        Z: '#df9edc', // Rose fluorite
        J: '#f0c28a', // Lantern gold
        L: '#669ddd', // Deep icewall
        GARBAGE: '#0f1b27', // Frozen basalt
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 8,
        glowIntensity: 0.58,
        glowColor: '#b4f5ff',

        outline: true,
        outlineWidth: 1.8,
        outlineColor: '#071019',

        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.09,

        shimmer: true,
        shimmerSpeed: 0.055,
        shimmerIntensity: 0.12,

        trails: true,
        trailLength: 0.22,
        trailOpacity: 0.19,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 7,
            glowIntensity: 0.55,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 9,
            glowIntensity: 0.64,
            outlineWidth: 2.1,
        },
    },
};
