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

    // Ultra-vibrant neon rainbow spectrum palette
    colors: {
        I: '#ff1493', // Deep Hot Pink (electric magenta)
        O: '#ff8c00', // Vivid Orange (blazing)
        T: '#ffea00', // Electric Lemon Yellow
        S: '#00ff80', // Bright Neon Green
        Z: '#00f5ff', // Brilliant Cyan
        J: '#4d90fe', // Vibrant Electric Blue
        L: '#bf40ff', // Rich Neon Purple
        GARBAGE: '#2a2a45', // Deep cosmic purple
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
