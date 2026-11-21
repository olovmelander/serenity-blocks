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
        GARBAGE: '#536875', // Blue slate ice, visible in the wells at night
        CLEAN_GARBAGE: '#a7bcc6',
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 10,
        glowIntensity: 0.68,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: '#031627',

        pulse: true,
        pulseSpeed: 0.038,
        pulseAmplitude: 0.12,

        shimmer: true,
        shimmerSpeed: 0.065,
        shimmerIntensity: 0.16,

        trails: true,
        trailLength: 0.20,
        trailOpacity: 0.24,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 8,
            glowIntensity: 0.62,
            outlineWidth: 1.7,
        },
        phaser: {
            glowRadius: 11,
            glowIntensity: 0.72,
            outlineWidth: 2.3,
        },
    },
};
