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
        I: '#a8f6ff', // Cyan crest
        O: '#f4ffb5', // Pale sunlight
        T: '#bdb9ff', // Lavender foam
        S: '#87ffd6', // Mint tide
        Z: '#ffa6e3', // Coral bloom
        J: '#6b8dff', // Indigo depth
        L: '#ffe08f', // Golden shore
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
