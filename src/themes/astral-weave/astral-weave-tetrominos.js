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

    // Ethereal crystalline palette
    colors: {
        I: '#00ffff', // Cyan Starlight
        O: '#ffd700', // Golden Thread
        T: '#ff00ff', // Mystic Magenta
        S: '#00ff7f', // Spring Green Aurora
        Z: '#ff6b6b', // Coral Nova
        J: '#1e90ff', // Dodger Blue Void
        L: '#ffa500', // Orange Comet
        GARBAGE: '#4b0082', // Indigo/Deep Purple
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
