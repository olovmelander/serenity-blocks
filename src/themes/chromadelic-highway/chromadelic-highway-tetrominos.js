/**
 * Chromadelic Highway Theme - Tetromino Visual Configuration
 *
 * Vibrant rainbow color palette inspired by 80s neon highways,
 * psychedelic visuals, and flowing chromatic waves.
 *
 * Color Palette:
 * - Full spectrum rainbow colors (ROYGBIV)
 * - Maximum saturation and brightness
 * - Dynamic glow effects for neon aesthetic
 * - Pulsing rainbow energy
 */

export const CHROMADELIC_HIGHWAY_TETROMINOS = {
    version: 1,

    // Vibrant rainbow spectrum palette
    colors: {
        I: '#ff0099', // Hot Pink/Magenta (vibrant start of spectrum)
        O: '#ff6600', // Bright Orange (warm energy)
        T: '#ffff00', // Electric Yellow (brightest point)
        S: '#00ff66', // Neon Green (cyber aesthetic)
        Z: '#00ffff', // Cyan (cool vibrant)
        J: '#0099ff', // Electric Blue (deep vibrant)
        L: '#9933ff', // Purple (completing the spectrum)
        GARBAGE: '#333355', // Dark purple-grey (minimal presence)
    },

    // Neon glow render mode (signature chromadelic effect)
    renderMode: 'glow',

    effects: {
        // Intense glowing aura for neon highway aesthetic
        glowRadius: 12,
        glowIntensity: 0.8,
        glowColor: 'auto', // Use piece color for glow

        // Bright outline for sharp neon definition
        outline: true,
        outlineWidth: 2.5,
        outlineColor: 'lighten',

        // Pulsating rainbow energy effect
        pulse: true,
        pulseSpeed: 0.05, // Faster pulse for energetic feel
        pulseAmplitude: 0.25, // More pronounced pulsing

        // Optional: Rainbow shimmer effect (if supported)
        shimmer: true,
        shimmerSpeed: 0.08,
        shimmerIntensity: 0.15,
    },

    // Renderer-specific tweaks
    rendererOverrides: {
        canvas: {
            glowRadius: 10, // Strong glow in Canvas
            glowIntensity: 0.75, // Vibrant but not overwhelming
            outlineWidth: 2, // Clear neon outline
        },
        phaser: {
            glowRadius: 14, // Maximum glow with WebGL
            glowIntensity: 0.9, // Brightest in WebGL
            outlineWidth: 3, // Thick neon outline
        },
    },
};
