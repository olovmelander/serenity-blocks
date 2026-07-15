/**
 * Starlight Theme - Tetromino Visual Configuration
 *
 * Starfield palette with shimmering whites, blues, and soft auroras.
 */

export const STARLIGHT_TETROMINOS = {
    version: 1,

    colors: {
        I: '#fff4c7', // Warm starlight
        O: '#c9b8ff', // Violet deep-field glint
        T: '#93ffe8', // OIII teal
        S: '#ffa7d8', // H-alpha rose
        Z: '#8fa2ff', // Indigo parallax shell
        J: '#ffd69a', // Golden dwarf
        L: '#cfefff', // Blue-white giant
        GARBAGE: '#070a18', // Deep cosmos
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 10,
        glowIntensity: 0.72,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.6,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.16,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.18,

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
