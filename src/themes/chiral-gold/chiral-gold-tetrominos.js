/**
 * Chiral Gold Theme - Tetromino Visual Configuration
 * Upgraded to match AAA gaming glow, trails, and color temperature gradients.
 */

export const CHIRAL_GOLD_TETROMINOS = {
    version: 1,

    colors: {
        I: '#FFF6D6', // Radiant white-gold core
        O: '#FFD700', // Classic brilliant gold
        T: '#FFAC33', // Deep sunset gold
        S: '#FFC857', // Amber-gold
        Z: '#E67E22', // Bronze/copper gold
        J: '#D35400', // Burnt amber
        L: '#F39C12', // Rich golden yellow
        GARBAGE: '#3D2B12', // Gold-infused obsidian
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 22,
        glowIntensity: 1.35,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2.2,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.046,
        pulseAmplitude: 0.28,

        shimmer: true,
        shimmerSpeed: 0.068,
        shimmerIntensity: 0.32,

        trails: true,
        trailLength: 0.38,
        trailOpacity: 0.48,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 12,
            glowIntensity: 0.95,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 26,
            glowIntensity: 1.45,
            outlineWidth: 2.4,
        },
    },
};
