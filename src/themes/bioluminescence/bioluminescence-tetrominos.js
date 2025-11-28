/**
 * Bioluminescence Theme - Tetromino Visual Configuration
 *
 * Glowing cyan-green-teal palette inspired by bioluminescent organisms
 * in deep ocean and forest environments.
 *
 * Color Palette:
 * - Bright cyan-greens for active pieces (like glowing plankton)
 * - Teal and aqua tones for variety
 * - Subtle pulse animation for organic feel
 * - Soft glow effect mimicking bioluminescence
 */

export const BIOLUMINESCENCE_TETROMINOS = {
    version: 1,

    // Bioluminescent color palette (cyan-green-teal spectrum)
    colors: {
        I: '#00ff88', // Bright cyan-green (most bioluminescent)
        O: '#88ffff', // Bright cyan (like jellyfish glow)
        T: '#00ddaa', // Teal (like plankton)
        S: '#66ffaa', // Light green (like algae)
        Z: '#00ff99', // Medium green (like fireflies)
        J: '#44ffcc', // Aqua (like deep sea creatures)
        L: '#22ffbb', // Sea green (like coral)
        GARBAGE: '#224433', // Dark teal (minimal glow)
    },

    // Glowing render mode (signature bioluminescence effect)
    renderMode: 'glow',

    effects: {
        // Soft glowing aura around each block
        glowRadius: 8,
        glowIntensity: 0.6,
        glowColor: 'auto', // Use piece color for glow

        // Brighter outline for definition
        outline: true,
        outlineWidth: 2,
        outlineColor: 'lighten',

        // Subtle pulsating effect (like breathing organisms)
        pulse: true,
        pulseSpeed: 0.03, // Slow, organic pulse
        pulseAmplitude: 0.15, // Subtle intensity variation
    },

    // Renderer-specific tweaks
    rendererOverrides: {
        canvas: {
            glowRadius: 6, // Slightly smaller glow in Canvas
            outlineWidth: 1.5, // Thinner outline for clarity
        },
        phaser: {
            glowRadius: 10, // Larger glow with WebGL
            glowIntensity: 0.7, // Slightly brighter in WebGL
        },
    },
};
