/**
 * Synthwave Sunset Theme - Tetromino Visual Configuration
 *
 * Vibrant retro 80s neon color palette inspired by synthwave aesthetics,
 * vintage VHS tapes, and electric sunset horizons.
 *
 * Color Palette:
 * - Hot pink and magenta neon
 * - Electric orange-red sunset
 * - Violet purple glow
 * - Coral and neon accents
 * - Retro grid aesthetic
 */

export const SYNTHWAVE_SUNSET_TETROMINOS = {
    version: 1,

    // Retro synthwave neon palette
    colors: {
        I: '#ff0066',  // Hot Pink (signature synthwave)
        O: '#ff4500',  // Orange-Red (sunset)
        T: '#b000ff',  // Violet Purple (neon purple)
        S: '#ff006e',  // Deep Pink (magenta)
        Z: '#ff5e78',  // Coral (warm sunset)
        J: '#00d4ff',  // Electric Blue (retro neon)
        L: '#ffff00',  // Neon Yellow (bright accent)
        GARBAGE: '#0a0515', // Dark purple-black (synthwave background)
    },

    // Intense neon glow render mode (synthwave aesthetic)
    renderMode: 'glow',

    effects: {
        // Vibrant neon glow
        glowRadius: 16,
        glowIntensity: 0.95,
        glowColor: 'auto', // Use piece color for glow

        // Bold outline for retro definition
        outline: true,
        outlineWidth: 2.5,
        outlineColor: 'lighten',

        // Fast, energetic pulsing like neon signs
        pulse: true,
        pulseSpeed: 0.06,      // Faster pulse for retro energy
        pulseAmplitude: 0.35,  // Strong pulsing

        // VHS shimmer effect
        shimmer: true,
        shimmerSpeed: 0.1,
        shimmerIntensity: 0.25,

        // Optional: Retro scanline effect (if supported)
        scanlines: true,
        scanlineIntensity: 0.1,
    },

    // Renderer-specific tweaks
    rendererOverrides: {
        canvas: {
            glowRadius: 14,      // Strong glow in Canvas
            glowIntensity: 0.9,  // Intense neon glow
            outlineWidth: 2.5,   // Bold retro outline
        },
        phaser: {
            glowRadius: 18,      // Maximum neon glow with WebGL
            glowIntensity: 1.0,  // Full intensity in WebGL
            outlineWidth: 3,     // Thick bold outline
        },
    },
};
