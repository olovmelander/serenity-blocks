/**
 * Geode Theme - Tetromino Visual Configuration
 *
 * Warm cosmic starfield palette inspired by fiber-optic lights -
 * glowing oranges, magentas, teals, and cosmic yellows.
 * Enhanced glow effects to match the luminous starfield atmosphere.
 */

export const GEODE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#60ffff', // Cosmic Teal
        O: '#ffd060', // Solar Gold
        T: '#e060ff', // Nebula Magenta
        S: '#60ff90', // Aurora Green
        Z: '#ff6040', // Ember Orange
        J: '#ff70ff', // Starlight Pink
        L: '#ffa050', // Supernova Amber
        GARBAGE: '#0a0608', // Void Shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 18,
        glowIntensity: 0.95,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: '#080406',

        pulse: true,
        pulseSpeed: 0.06,
        pulseAmplitude: 0.35,

        shimmer: true,
        shimmerSpeed: 0.1,
        shimmerIntensity: 0.32,

        trails: true,
        trailLength: 0.3,
        trailOpacity: 0.45,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 16,
            glowIntensity: 0.88,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 20,
            glowIntensity: 0.98,
            outlineWidth: 2.2,
        },
    },
};
