/**
 * Swedish Forest Theme - Tetromino Visual Configuration
 *
 * Boreal palette inspired by moonlit pines, firefly amber, and nordic skies.
 */

export const SWEDISH_FOREST_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffd27a', // Lantern amber
        O: '#c7b5ff', // Twilight lavender
        T: '#7ff4c9', // Mossy mint
        S: '#ff9fc0', // Aurora rose
        Z: '#6479d8', // Pine indigo
        J: '#ffe8a6', // Dawn glow
        L: '#9be8ff', // Misty cyan
        GARBAGE: '#121b27', // Forest shadow
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
        shimmerIntensity: 0.18,

        trails: true,
        trailLength: 0.16,
        trailOpacity: 0.3,
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
