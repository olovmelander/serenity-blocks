/**
 * Ice Temple Theme - Tetromino Visual Configuration
 *
 * Glacial gradients inspired by aurora-lit ice walls, crystalline shards, and moonlit snow.
 */

export const ICE_TEMPLE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#7fe8ff', // Glacier vein
        O: '#e8fcff', // Snow halo
        T: '#b5c7ff', // Moonlit indigo
        S: '#7cf3c9', // Jade frost
        Z: '#c0a7ff', // Aurora violet
        J: '#5ba8dd', // Deep icewall
        L: '#f2d5b0', // Lantern gold
        GARBAGE: '#0f1b27', // Frozen basalt
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 13,
        glowIntensity: 0.85,
        glowColor: '#b4f5ff',

        outline: true,
        outlineWidth: 1.8,
        outlineColor: '#071019',

        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.26,

        shimmer: true,
        shimmerSpeed: 0.055,
        shimmerIntensity: 0.23,

        trails: true,
        trailLength: 0.22,
        trailOpacity: 0.34,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 10,
            glowIntensity: 0.78,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 15,
            glowIntensity: 0.92,
            outlineWidth: 2.1,
        },
    },
};
