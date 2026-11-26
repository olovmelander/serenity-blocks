/**
 * Waves Theme - Tetromino Visual Configuration
 *
 * Sea-glass pastels for the inside of a wave at the end of the day. Each piece's colour is also
 * the colour of the light it leaves in the water when it locks (waves-world.js `onLock`), so
 * the seven have to stay apart from one another against emerald and gold.
 */

export const WAVES_TETROMINOS = {
    version: 1,

    colors: {
        I: '#f1ef96', // Straw sunlight
        O: '#78dff7', // Cyan crest
        T: '#c7abf5', // Lavender foam
        S: '#7194e8', // Indigo depth
        Z: '#f792b3', // Pink coral
        J: '#ffb579', // Apricot sunset
        L: '#74dfb3', // Mint tide
        GARBAGE: '#638391', // Weathered slate against the dark well
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 6,
        glowIntensity: 0.42,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.6,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.07,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.09,

        trails: true,
        trailLength: 0.14,
        trailOpacity: 0.28,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 5,
            glowIntensity: 0.4,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 7,
            glowIntensity: 0.46,
            outlineWidth: 1.8,
        },
    },
};
