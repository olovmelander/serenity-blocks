/**
 * Supernova Theme - Tetromino Visual Configuration
 *
 * High-energy palette inspired by an exploding star: cyan cores, magenta halos,
 * solar oranges, and plasma violets. Pieces glow brightly with trails to match
 * the theme's shockwaves.
 */

export const SUPERNOVA_TETROMINOS = {
    version: 1,

    colors: {
        I: '#64dcff', // Electric Blue (Shockwave)
        O: '#ffaa00', // Core Orange
        T: '#ff0033', // Nebula Red
        S: '#00ff88', // Greenish Tint (Plasma)
        Z: '#ff00ff', // Magenta (Mixing zone)
        J: '#0088ff', // Deep Blue
        L: '#ffdd00', // Solar Gold
        GARBAGE: '#1a0033', // Dark Space Blue
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 13,
        glowIntensity: 0.85,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.045,
        pulseAmplitude: 0.28,

        shimmer: true,
        shimmerSpeed: 0.07,
        shimmerIntensity: 0.25,

        trails: true,
        trailLength: 0.2,
        trailOpacity: 0.35,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 11,
            glowIntensity: 0.8,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 15,
            glowIntensity: 0.9,
            outlineWidth: 2.2,
        },
    },
};
