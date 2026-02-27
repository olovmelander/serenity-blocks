/**
 * Chiral Gold Theme - Tetromino Visual Configuration
 */

export const CHIRAL_GOLD_TETROMINOS = {
    version: 1,

    colors: {
        I: '#FFD700',
        O: '#DAA520',
        T: '#B8860B',
        S: '#CD853F',
        Z: '#D4AF37',
        J: '#8B6914',
        L: '#C5B358',
        GARBAGE: '#2A1D08',
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 10,
        glowIntensity: 0.7,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.038,
        pulseAmplitude: 0.22,

        shimmer: true,
        shimmerSpeed: 0.058,
        shimmerIntensity: 0.2,

        trails: true,
        trailLength: 0.18,
        trailOpacity: 0.34,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 8,
            glowIntensity: 0.65,
            outlineWidth: 1.6,
        },
        phaser: {
            glowRadius: 12,
            glowIntensity: 0.74,
            outlineWidth: 2.0,
        },
    },
};
