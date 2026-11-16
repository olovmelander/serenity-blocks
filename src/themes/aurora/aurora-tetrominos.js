/**
 * Aurora Theme - Tetromino Visual Configuration
 *
 * Vapor-bright ribbons of emerald, cyan, cobalt, lilac, magenta and the crown's rose, mirroring
 * the aurora curtains: seven hues a glance can tell apart on the dark field.
 */

export const AURORA_TETROMINOS = {
    version: 1,

    colors: {
        I: '#c18bff', // Violet surge
        O: '#d6ffb0', // Polar horizon glow
        T: '#6cf5ff', // Glacier cyan beam
        S: '#5a7cff', // Midnight cobalt
        Z: '#ff88ee', // Combo magenta flare
        J: '#62ffbf', // Emerald ribbon
        L: '#ff6f86', // Crown rose: the red of the tall rays (it was an aqua a hair from T's cyan)
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
