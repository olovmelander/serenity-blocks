/**
 * Sky Children V2 - Tetromino Visual Configuration
 */

export const SKY_CHILDREN_V2_TETROMINOS = {
    version: 1,

    colors: {
        I: '#f4c873',
        O: '#f7ece0',
        T: '#a49ad9',
        S: '#8ec7da',
        Z: '#d98d67',
        J: '#6b77be',
        L: '#ebb068',
        GARBAGE: '#2a3149',
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 11,
        glowIntensity: 0.72,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.028,
        pulseAmplitude: 0.16,

        shimmer: true,
        shimmerSpeed: 0.045,
        shimmerIntensity: 0.12,

        trails: true,
        trailLength: 0.12,
        trailOpacity: 0.24,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 9,
            glowIntensity: 0.68,
            outlineWidth: 1.6,
        },
        phaser: {
            glowRadius: 13,
            glowIntensity: 0.78,
            outlineWidth: 2.0,
        },
    },
};
