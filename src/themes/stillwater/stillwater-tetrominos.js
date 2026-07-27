/**
 * Stillwater folklore palette.
 *
 * Piece identity comes from hue/value separation and a restrained fused-shape
 * gradient/rim/gloss treatment. It does not depend on glow, pulse, shimmer, or
 * trails, which keeps active, ghost, hold, next, Canvas preview/opponent-watch,
 * and multiplayer surfaces readable. The production Phaser 4 board itself is
 * WebGL-only; there is no Phaser Canvas board fallback to configure.
 */

export const STILLWATER_TETROMINOS = {
    version: 1,

    colors: {
        I: '#6CC7C6', // Moonlit cyan
        O: '#F2D68A', // Foxfire gold
        T: '#9A7FB7', // Heather violet
        S: '#5F9B72', // Moss green
        Z: '#C36F73', // Lingonberry rose
        J: '#537E9F', // Twilight indigo
        L: '#D99A5E', // Amber
        GARBAGE: '#273631', // Wet bark
        CLEAN_GARBAGE: '#98B5A9', // Mist sage
    },

    renderMode: 'solid',

    effects: {
        premium: true,
        phaser: {
            gradient: true,
            highlight: 0.2,
            shadow: 0.22,
            rim: true,
            rimAlpha: 0.46,
            rimWidthFactor: 0.05,
            gloss: true,
            glossAlpha: 0.16,
        },
    },

    rendererOverrides: {},
};
