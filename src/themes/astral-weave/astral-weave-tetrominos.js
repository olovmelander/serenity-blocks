/**
 * Astral Weave Theme - Tetromino Visual Configuration
 *
 * Pearl-and-jewel glow pieces. The loom behind the board is thin light on a dark field and the
 * post stack soft-clips what shows through the card, so the pieces keep their own colour.
 */

export const ASTRAL_WEAVE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffe08a',
        O: '#c792ff',
        T: '#66e5b0',
        S: '#fa82b1',
        Z: '#80a3ff',
        J: '#ffa272',
        L: '#7be2f5',
        GARBAGE: '#3f3f72',
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 10,
        glowIntensity: 0.82,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: '#f4fbff',

        pulse: true,
        pulseSpeed: 0.034,
        pulseAmplitude: 0.08,

        shimmer: true,
        shimmerSpeed: 0.055,
        shimmerIntensity: 0.13,

        trails: true,
        trailLength: 0.24,
        trailOpacity: 0.21,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 8,
            glowIntensity: 0.90,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 11,
            glowIntensity: 0.84,
            outlineWidth: 1.6,
        },
    },
};
