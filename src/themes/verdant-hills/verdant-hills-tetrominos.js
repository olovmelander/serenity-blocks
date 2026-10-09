/**
 * Verdant Hills Theme — Tetromino Visual Configuration
 *
 * Seven kites for a windy day on the downs, one for each piece. The sky behind the board
 * flies the same kite when its piece locks (see verdant-hills-reactions.js), so the colours
 * here and VERDANT_HILLS_KITE_COLOURS are one list. Which colour goes with which piece is
 * chosen so that no piece has the hue its shape usually has elsewhere
 * (`npm run check:palette` scores this palette 0 of 7).
 */

/** Kite slot of each tetromino letter; the order of VERDANT_HILLS_KITE_COLOURS. */
export const VERDANT_HILLS_PIECE_KITES = Object.freeze({
    I: 0, O: 1, T: 2, S: 3, Z: 4, J: 5, L: 6,
});

/** Ripstop colours, in kite-slot order. */
export const VERDANT_HILLS_KITE_COLOURS = Object.freeze([
    '#e8402f', // I — poppy red
    '#3fa9f5', // O — cerulean
    '#ffc928', // T — sunflower
    '#f0509f', // S — fuchsia
    '#19c3b2', // Z — teal
    '#ff8b2b', // J — tangerine
    '#9a6cf0', // L — violet
]);

export const VERDANT_HILLS_TETROMINOS = {
    version: 1,

    colors: {
        I: '#e8402f', // poppy red
        O: '#3fa9f5', // cerulean
        T: '#ffc928', // sunflower
        S: '#f0509f', // fuchsia
        Z: '#19c3b2', // teal
        J: '#ff8b2b', // tangerine
        L: '#9a6cf0', // violet
        GARBAGE: '#34502a', // hedge shade — foundation / shadowed blocks
        CLEAN_GARBAGE: '#7d9a6a',
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 11,
        glowIntensity: 0.68,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.6,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.16,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.18,

        trails: true,
        trailLength: 0.18,
        trailOpacity: 0.3,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 8,
            glowIntensity: 0.58,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 13,
            glowIntensity: 0.76,
            outlineWidth: 1.9,
        },
    },
};
