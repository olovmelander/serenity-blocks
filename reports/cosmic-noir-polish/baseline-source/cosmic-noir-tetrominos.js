/**
 * Cosmic Noir Theme - Tetromino Visual Configuration
 *
 * Monochrome palette inspired by noir sci-fi: ink blacks, gunmetal grays,
 * and starlit whites, with a sharp glow to stand out against the void.
 */

export const COSMIC_NOIR_TETROMINOS = {
    version: 1,

    colors: {
        I: '#f8f8ff', // Stark white beam
        O: '#cfd2d6', // Polished steel
        T: '#b0b5c0', // Dim moonlight lavender-gray
        S: '#9aa0aa', // Smoke gray
        Z: '#7f8691', // Gunmetal
        J: '#5b616c', // Slate shadow
        L: '#3c4049', // Charcoal edge
        GARBAGE: '#16181d', // Deep void
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 9,
        glowIntensity: 0.6,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.2,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.18,

        trails: true,
        trailLength: 0.15,
        trailOpacity: 0.3,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 7,
            glowIntensity: 0.55,
            outlineWidth: 1.6,
        },
        phaser: {
            glowRadius: 11,
            glowIntensity: 0.65,
            outlineWidth: 2,
        },
    },
};
