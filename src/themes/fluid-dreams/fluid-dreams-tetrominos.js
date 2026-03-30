/**
 * Fluid Dreams Theme - Tetromino Visual Configuration
 *
 * Liquid neon palette inspired by morphing blobs and iridescent bubbles.
 */

export const FLUID_DREAMS_TETROMINOS = {
    version: 1,

    colors: {
        I: '#79faff', // Aqua glow
        O: '#ffd59e', // Soft amber
        T: '#ff7cf0', // Magenta shine
        S: '#a1ffcf', // Mint wave
        Z: '#ff8ba0', // Coral dream
        J: '#8c9bff', // Indigo haze
        L: '#ffe066', // Golden highlight
        GARBAGE: '#161428', // Deep night
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 11,
        glowIntensity: 0.8,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.05,
        pulseAmplitude: 0.25,

        shimmer: true,
        shimmerSpeed: 0.08,
        shimmerIntensity: 0.2,

        trails: true,
        trailLength: 0.2,
        trailOpacity: 0.35,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 9,
            glowIntensity: 0.75,
            outlineWidth: 1.6,
        },
        phaser: {
            glowRadius: 13,
            glowIntensity: 0.85,
            outlineWidth: 2.0,
        },
    },
};
