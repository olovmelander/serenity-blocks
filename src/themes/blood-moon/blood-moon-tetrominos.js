/**
 * Blood Moon Theme - Tetromino Visual Configuration
 *
 * Dark crimson and blood-red color palette inspired by the ominous
 * blood moon, creating an atmospheric and haunting visual style.
 *
 * Color Palette:
 * - Deep crimsons and blood reds
 * - Dark burgundy and maroon tones
 * - Ominous atmospheric glow
 * - Pulsing blood moon energy
 */

export const BLOOD_MOON_TETROMINOS = {
    version: 1,

    // Blood moon crimson palette
    colors: {
        I: '#cc1a2e', // Deep Crimson (matches moon body)
        O: '#8b0000', // Dark Blood Red
        T: '#dc143c', // Crimson Red (bright blood)
        S: '#6b0f1a', // Dark Maroon
        Z: '#a01525', // Blood Red
        J: '#7a0f1a', // Deep Burgundy
        L: '#b22222', // Firebrick Red
        GARBAGE: '#1a0510', // Dark purple-black (matches background)
    },

    // Ominous glow render mode (blood moon aesthetic)
    renderMode: 'glow',

    effects: {
        // Haunting blood glow
        glowRadius: 14,
        glowIntensity: 0.85,
        glowColor: 'auto', // Use piece color for glow

        // Dark outline for atmospheric depth
        outline: true,
        outlineWidth: 2,
        outlineColor: 'darken',

        // Slow, ominous pulsing like a beating heart
        pulse: true,
        pulseSpeed: 0.03, // Slower pulse for eerie effect
        pulseAmplitude: 0.3, // Pronounced pulsing

        // Blood shimmer effect
        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.2,

        // Optional: Atmospheric particle trails (if supported)
        trails: true,
        trailLength: 0.15,
        trailOpacity: 0.3,
    },

    // Renderer-specific tweaks
    rendererOverrides: {
        canvas: {
            glowRadius: 12, // Strong glow in Canvas
            glowIntensity: 0.8, // Intense atmospheric glow
            outlineWidth: 2, // Clear dark outline
        },
        phaser: {
            glowRadius: 16, // Maximum glow with WebGL
            glowIntensity: 0.9, // Most intense in WebGL
            outlineWidth: 2.5, // Thick dark outline
        },
    },
};
