/**
 * Crystal Cave Theme - Tetromino Visual Configuration
 *
 * Jewel-toned palette inspired by amethyst, emerald, and sapphire crystals with
 * luminous glows to match the cavern’s ambience.
 */

export const CRYSTAL_CAVE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffc860', // Radiant Amber Crystal
        O: '#c080ff', // Deep Amethyst Glow
        T: '#50ffc0', // Vibrant Emerald
        S: '#ff60c0', // Brilliant Rose Quartz
        Z: '#6080ff', // Deep Sapphire
        J: '#ffa060', // Glowing Citrine
        L: '#70f0ff', // Luminous Aquamarine
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
