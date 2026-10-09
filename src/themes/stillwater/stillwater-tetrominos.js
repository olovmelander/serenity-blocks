/**
 * Stillwater folklore palette.
 *
 * Seven colours from the tarn at night, dealt to the pieces so that none wears the colour a
 * falling-block player expects of its shape. Piece identity comes from hue/value separation and
 * a restrained fused-shape gradient/rim/gloss treatment. It does not depend on glow, pulse,
 * shimmer, or trails, which keeps active, ghost, hold, next, Canvas preview/opponent-watch, and
 * multiplayer surfaces readable. The production Phaser 4 board itself is WebGL-only; there is no
 * Phaser Canvas board fallback to configure.
 *
 * The world takes each piece's colour for the light it leaves on the water (a wisp, its ring).
 */

export const STILLWATER_TETROMINOS = {
    version: 2,

    colors: {
        I: '#F2D68A', // Foxfire gold
        O: '#6CC7C6', // Moonlit cyan
        T: '#5F9B72', // Moss green
        S: '#9A7FB7', // Heather violet
        Z: '#537E9F', // Twilight indigo
        J: '#D99A5E', // Lantern amber
        L: '#C36F73', // Lingonberry rose
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
