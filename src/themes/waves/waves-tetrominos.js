/**
 * Waves Theme - Tetromino Visual Configuration
 *
 * Soft aquatic palette inspired by moonlit waves and submerged light rays.
 */

export const WAVES_TETROMINOS = {
    version: 1,

    colors: {
        I: '#a8f6ff',  // Cyan crest
        O: '#f4ffb5',  // Pale sunlight
        T: '#bdb9ff',  // Lavender foam
        S: '#87ffd6',  // Mint tide
        Z: '#ffa6e3',  // Coral bloom
        J: '#6b8dff',  // Indigo depth
        L: '#ffe08f',  // Golden shore
        GARBAGE: '#0c1b27', // Deep ocean shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 9,
        glowIntensity: 0.65,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.6,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.2,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.15,

        trails: true,
        trailLength: 0.14,
        trailOpacity: 0.28,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 7,
            glowIntensity: 0.6,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 11,
            glowIntensity: 0.7,
            outlineWidth: 1.8,
        },
    },
};
