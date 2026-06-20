/**
 * Halcyon Apex Theme - Tetromino Visual Configuration
 *
 * Warm sandstone, turquoise water, moss, and cyan crystals from the dawn
 * pyramid scene.
 */

export const HALCYON_APEX_TETROMINOS = {
    version: 1,

    colors: {
        I: '#8ff5ee',
        O: '#c9bfa2',
        T: '#3fd6cf',
        S: '#8fa84e',
        Z: '#2a8fa0',
        J: '#bfd8d6',
        L: '#d8cba8',
        GARBAGE: '#5a5e68',
        CLEAN_GARBAGE: '#b3a98c',
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 10,
        glowIntensity: 0.68,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.7,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.032,
        pulseAmplitude: 0.18,

        shimmer: true,
        shimmerSpeed: 0.045,
        shimmerIntensity: 0.16,

        trails: true,
        trailLength: 0.16,
        trailOpacity: 0.3,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 7,
            glowIntensity: 0.58,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 12,
            glowIntensity: 0.72,
            outlineWidth: 1.9,
        },
    },
};
