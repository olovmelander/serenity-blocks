/**
 * Desert Oasis Theme - Tetromino Visual Configuration
 *
 * Warm sand and twilight palette with glowing highlights to match the serene desert sky.
 */

export const DESERT_OASIS_TETROMINOS = {
    version: 1,

    colors: {
        I: '#8be9ff', // Oasis cyan
        O: '#ffd38a', // Dune gold
        T: '#f9a8ff', // Twilight magenta
        S: '#a7ffcb', // Mint mirage
        Z: '#ff8d73', // Sunset coral
        J: '#6f7bff', // Indigo night
        L: '#ffe799', // Lantern glow
        GARBAGE: '#1a1c2e', // Desert night shadow
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
        pulseSpeed: 0.04,
        pulseAmplitude: 0.22,

        shimmer: true,
        shimmerSpeed: 0.06,
        shimmerIntensity: 0.2,

        trails: true,
        trailLength: 0.18,
        trailOpacity: 0.32,
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
