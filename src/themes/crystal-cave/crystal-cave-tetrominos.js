/**
 * Crystal Cave Theme - Tetromino Visual Configuration
 *
 * Jewel-toned palette inspired by amethyst, emerald, and sapphire crystals with
 * luminous glows to match the cavern’s ambience.
 */

export const CRYSTAL_CAVE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#70f0ff', // Luminous Aquamarine
        O: '#ffc860', // Radiant Amber Crystal
        T: '#c080ff', // Deep Amethyst Glow
        S: '#50ffc0', // Vibrant Emerald
        Z: '#ff60c0', // Brilliant Rose Quartz
        J: '#6080ff', // Deep Sapphire
        L: '#ffa060', // Glowing Citrine
        GARBAGE: '#0a0818', // Abyssal Shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 16,
        glowIntensity: 0.9,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2.5,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.04,
        pulseAmplitude: 0.3,

        shimmer: true,
        shimmerSpeed: 0.06,
        shimmerIntensity: 0.25,

        trails: true,
        trailLength: 0.22,
        trailOpacity: 0.4,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 10,
            glowIntensity: 0.75,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 14,
            glowIntensity: 0.85,
            outlineWidth: 2.2,
        },
    },
};
