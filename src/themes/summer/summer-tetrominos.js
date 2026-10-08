/**
 * Summer Theme — Tetromino Visual Configuration
 *
 * The seven kinds of flowers picked on Midsummer's Eve, one for each piece. The meadow
 * behind the board answers a lock with the same flower (see summer-reactions.js), so the
 * colours here and the petal colours in summer-flowers.js are kept the same. Which flower
 * goes with which piece is chosen so that no piece has the hue its shape usually has
 * elsewhere (`npm run check:palette` scores this palette 0 of 7).
 */

export const SUMMER_TETROMINOS = {
    version: 1,

    colors: {
        I: '#e4412c', // vallmo — poppy
        O: '#7fa6f5', // blåklocka — harebell
        T: '#ffd21f', // smörblomma — buttercup
        S: '#fffdf2', // prästkrage — oxeye daisy
        Z: '#5d5fd6', // lupin — lupine
        J: '#ff8a2e', // rödfibbla — orange hawkweed
        L: '#b267e0', // midsommarblomster — wood cranesbill
        GARBAGE: '#2a4b38', // spruce shade — foundation / shadowed blocks
        CLEAN_GARBAGE: '#6f8a70',
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 11,
        glowIntensity: 0.7,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.6,
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
            glowRadius: 8,
            glowIntensity: 0.6,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 13,
            glowIntensity: 0.78,
            outlineWidth: 1.9,
        },
    },
};
