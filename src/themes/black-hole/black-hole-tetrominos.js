/**
 * Black Hole Theme - Tetromino Visual Configuration
 *
 * Photon blue, gold, violet and copper seen in the disk and the surrounding gas.
 * The luminous edge is narrow enough to keep adjacent occupied cells legible.
 */

export const BLACK_HOLE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#bcecff', // Photon ice
        O: '#779ee8', // Cobalt dust
        T: '#ac87f4', // Violet shear
        S: '#f28faa', // Ionised rose
        Z: '#62d8c5', // Teal emission
        J: '#ffd278', // Inner disk
        L: '#ed8f5c', // Copper rim
        GARBAGE: '#758094', // Cold ash
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 7,
        glowIntensity: 0.54,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.9,
        outlineColor: 'darken',

        pulse: true,
        pulseSpeed: 0.04,
        pulseAmplitude: 0.08,

        shimmer: true,
        shimmerSpeed: 0.06,
        shimmerIntensity: 0.10,

        trails: true,
        trailLength: 0.18,
        trailOpacity: 0.2,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 6,
            glowIntensity: 0.5,
            outlineWidth: 1.7,
        },
        phaser: {
            glowRadius: 8,
            glowIntensity: 0.56,
            outlineWidth: 2.1,
        },
    },
};
