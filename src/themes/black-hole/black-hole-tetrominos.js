/**
 * Black Hole Theme - Tetromino Visual Configuration
 *
 * Deep-space monochrome palette with hints of ultraviolet, representing
 * matter being stretched by intense gravity. Pieces use a dark core with
 * glow halos to match the event horizon aesthetic.
 */

export const BLACK_HOLE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#c4d1ff', // Event horizon blue-white
        O: '#8895ff', // Accretion lavender
        T: '#5f6dff', // Ultraviolet violet
        S: '#62ffe0', // Teal ion stream
        Z: '#ff78c4', // Magenta flare
        J: '#3a3f66', // Shadow indigo
        L: '#f8b24f', // Golden lensing streak
        GARBAGE: '#11121b', // Deep void
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 11,
        glowIntensity: 0.75,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.9,
        outlineColor: 'darken',

        pulse: true,
        pulseSpeed: 0.04,
        pulseAmplitude: 0.22,

        shimmer: true,
        shimmerSpeed: 0.06,
        shimmerIntensity: 0.2,

        trails: true,
        trailLength: 0.18,
        trailOpacity: 0.3,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 9,
            glowIntensity: 0.7,
            outlineWidth: 1.7,
        },
        phaser: {
            glowRadius: 13,
            glowIntensity: 0.8,
            outlineWidth: 2.1,
        },
    },
};
