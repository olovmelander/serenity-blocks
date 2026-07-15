/**
 * Neon Dusk Theme - Tetromino Visual Configuration
 *
 * Hyper-saturated neon gradients inspired by a futuristic dusk skyline.
 * Palette leans into cyan lasers, magenta haze, mint energy trails,
 * and gold sunset flares to match the theme's particles and effects.
 */

export const NEON_DUSK_TETROMINOS = {
    version: 1,

    // Vibrant neon palette (cyan, magenta, mint, electric gold)
    colors: {
        I: '#ff5cc8', // Rose haze
        O: '#a24bff', // Twilight violet
        T: '#2bffb0', // Mint laser streak
        S: '#ff7b24', // Ember sunset glow
        Z: '#00b4ff', // Azure neon skyline
        J: '#ffcf1a', // Gold sun flare
        L: '#00f6ff', // Electric cyan beam
        GARBAGE: '#0c0418', // Deep dusk purple
    },

    // Neon glow render mode to match skyline lighting
    renderMode: 'glow',

    effects: {
        glowRadius: 12,
        glowIntensity: 0.85,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: 'darken',

        pulse: true,
        pulseSpeed: 0.04,
        pulseAmplitude: 0.25,

        shimmer: true,
        shimmerSpeed: 0.08,
        shimmerIntensity: 0.25,

        trails: true,
        trailLength: 0.2,
        trailOpacity: 0.35,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 10,
            glowIntensity: 0.8,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 14,
            glowIntensity: 0.9,
            outlineWidth: 2.2,
        },
    },
};
