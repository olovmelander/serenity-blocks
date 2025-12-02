/**
 * Astral Weave Theme - Tetromino Visual Configuration
 *
 * A mystical, ethereal palette inspired by the weaving of fate and starlight.
 * Crystalline structures with internal light.
 *
 * Color Palette:
 * - Ethereal cyans, magentas, and golds
 * - Deep indigo shadows
 * - Crystalline transparency
 */

export const ASTRAL_WEAVE_TETROMINOS = {
    version: 1,

    // Enhanced ethereal crystalline palette
    colors: {
        I: '#00f5ff', // Brilliant Cyan Starlight
        O: '#ffc800', // Radiant Golden Thread
        T: '#f050ff', // Vivid Mystic Magenta
        S: '#00ff90', // Bright Aurora Green
        Z: '#ff5080', // Coral Nova Pink
        J: '#40a0ff', // Electric Blue Void
        L: '#ff8020', // Blazing Orange Comet
        GARBAGE: '#6020a0', // Deep Cosmic Purple
    },

    // Crystal render mode
    renderMode: 'crystal', // Assuming 'crystal' or similar exists, otherwise 'glow' or 'flat' with effects

    effects: {
        // Inner glow
        glowRadius: 10,
        glowIntensity: 0.6,
        glowColor: 'auto',

        // Sharp, crystalline edges
        outline: true,
        outlineWidth: 1.5,
        outlineColor: 'lighten', // Light edges for crystal look

        // Gentle pulsing
        pulse: true,
        pulseSpeed: 0.02,
        pulseAmplitude: 0.15,

        // Shimmering surface
        shimmer: true,
        shimmerSpeed: 0.08,
        shimmerIntensity: 0.3,

        // Star dust trails
        trails: true,
        trailLength: 0.2,
        trailOpacity: 0.4,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 8,
            glowIntensity: 0.5,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 12,
            glowIntensity: 0.7,
            outlineWidth: 2,
        },
    },
};
