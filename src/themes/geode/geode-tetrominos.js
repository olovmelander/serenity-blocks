/**
 * Geode Theme - Tetromino Visual Configuration
 *
 * Deep cave palette inspired by luminous crystals -
 * amethyst, sapphire, emerald, and rose quartz.
 * Enhanced glow effects to match the mystical geode atmosphere.
 */

export const GEODE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#60f8ff', // Brilliant Aquamarine
        O: '#e0a0ff', // Radiant Amethyst
        T: '#9070ff', // Deep Geode Violet
        S: '#50ffc0', // Luminous Emerald
        Z: '#ff70c0', // Rose Quartz Glow
        J: '#6080ff', // Sapphire Crystal
        L: '#90ffe8', // Opal Shimmer
        GARBAGE: '#08060d', // Cavern Shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 16,
        glowIntensity: 0.92,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2.5,
        outlineColor: '#0a0816',

        pulse: true,
        pulseSpeed: 0.05,
        pulseAmplitude: 0.32,

        shimmer: true,
        shimmerSpeed: 0.09,
        shimmerIntensity: 0.28,

        trails: true,
        trailLength: 0.25,
        trailOpacity: 0.42,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 14,
            glowIntensity: 0.85,
            outlineWidth: 2.2,
        },
        phaser: {
            glowRadius: 18,
            glowIntensity: 0.95,
            outlineWidth: 2.8,
        },
    },
};
