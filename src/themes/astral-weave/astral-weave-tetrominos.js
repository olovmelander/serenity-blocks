/**
 * Astral Weave Theme - Tetromino Visual Configuration
 *
 * Prismatic cosmic crystal treatment tuned to stay readable against the more
 * luminous Astral Weave WebGPU background.
 */

export const ASTRAL_WEAVE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#7deeff',
        O: '#ffd86e',
        T: '#ee79ff',
        S: '#6cf9d5',
        Z: '#ff7ccf',
        J: '#6ca8ff',
        L: '#ffab63',
        GARBAGE: '#3f3f72',
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 16,
        glowIntensity: 0.82,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: '#f4fbff',

        pulse: true,
        pulseSpeed: 0.034,
        pulseAmplitude: 0.18,

        shimmer: true,
        shimmerSpeed: 0.055,
        shimmerIntensity: 0.22,

        trails: true,
        trailLength: 0.24,
        trailOpacity: 0.34,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 13,
            glowIntensity: 0.76,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 18,
            glowIntensity: 0.88,
            outlineWidth: 2.2,
        },
    },
};
