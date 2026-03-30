/**
 * Swedish Forest Theme - Tetromino Visual Configuration
 *
 * Boreal palette inspired by moonlit pines, firefly amber, and nordic skies.
 */

export const SWEDISH_FOREST_TETROMINOS = {
    version: 1,

    colors: {
        I: '#9be8ff', // Misty cyan
        O: '#ffd27a', // Lantern amber
        T: '#c7b5ff', // Twilight lavender
        S: '#7ff4c9', // Mossy mint
        Z: '#ff9fc0', // Aurora rose
        J: '#6479d8', // Pine indigo
        L: '#ffe8a6', // Dawn glow
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
