/**
 * Aurora Theme - Tetromino Visual Configuration
 *
 * Vapor-bright ribbons of emerald, teal, cyan, and lilac mirroring the aurora
 * curtains and combo-driven color shifts.
 */

export const AURORA_TETROMINOS = {
    version: 1,

    colors: {
        I: '#6cf5ff',  // Glacier cyan beam
        O: '#d6ffb0',  // Polar horizon glow
        T: '#c18bff',  // Violet surge
        S: '#62ffbf',  // Emerald ribbon
        Z: '#ff88ee',  // Combo magenta flare
        J: '#5a7cff',  // Midnight cobalt
        L: '#8dfdff',  // Aqua cascade
        GARBAGE: '#030713', // Night sky shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 16,
        glowIntensity: 0.9,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: '#031627',

        pulse: true,
        pulseSpeed: 0.038,
        pulseAmplitude: 0.3,

        shimmer: true,
        shimmerSpeed: 0.065,
        shimmerIntensity: 0.24,

        trails: true,
        trailLength: 0.26,
        trailOpacity: 0.36,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 13,
            glowIntensity: 0.82,
            outlineWidth: 1.7,
        },
        phaser: {
            glowRadius: 18,
            glowIntensity: 0.94,
            outlineWidth: 2.3,
        },
    },
};
