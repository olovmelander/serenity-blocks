/**
 * Rainbark piece palette.
 *
 * Every piece is one age of the painted bark: the seven colours are the stops of the grove's
 * age ramp (rainbark-core.js RAMP_STOPS), dealt so that no piece wears the colour a
 * falling-block player expects of its shape (palette gate 0/7). Identity comes from hue and
 * value separation, checked under protanopia, deuteranopia and tritanopia simulation. The
 * cells read as satin bark tiles: a soft wet highlight, a slightly older centre and a fresher
 * rim, with no glow, pulse, shimmer or trails, so active, ghost, hold, next and multiplayer
 * previews stay crisp.
 */

export const RAINBARK_TETROMINOS = {
    version: 2,

    colors: {
        I: '#C2F23D', // First Skin: fresh bark, age 0.00
        O: '#F07A2A', // Ember Bark, age 0.79
        T: '#2BCB72', // Young Emerald, age 0.12
        S: '#B98AF2', // Bloom Violet, age 0.52
        Z: '#1A93AC', // Glaucous Teal, age 0.26
        J: '#D23468', // Ruby Bark, age 0.66
        L: '#2F4CC0', // Cobalt Bark, age 0.38
        GARBAGE: '#4A2A30', // Old Husk
        CLEAN_GARBAGE: '#D8D2BE', // Cambium
    },

    renderMode: 'solid',

    effects: {
        premium: true,
        phaser: {
            gradient: true,
            highlight: 0.16,
            shadow: 0.2,
            rim: true,
            rimAlpha: 0.4,
            rimWidthFactor: 0.05,
            gloss: true,
            glossAlpha: 0.14,
        },
    },

    rendererOverrides: {},
};
