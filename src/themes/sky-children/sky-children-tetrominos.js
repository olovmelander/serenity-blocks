/**
 * Sky Children Theme - Tetromino Visual Configuration
 *
 * Sunset-forward palette with cool shadow support to match
 * Valley of Triumph style warm/cool contrast.
 */

export const SKY_CHILDREN_TETROMINOS = {
    version: 1,

    colors: {
        I: '#f4c873', // Sunlit gold
        O: '#f7ece0', // Cloud light
        T: '#a49ad9', // Twilight violet
        S: '#8ec7da', // Sky cyan
        Z: '#d98d67', // Warm dusk coral
        J: '#6b77be', // Shadow indigo
        L: '#ebb068', // Sunset amber
        GARBAGE: '#2a3149', // Deep dusk neutral
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
