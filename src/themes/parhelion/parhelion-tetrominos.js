/**
 * Parhelion halo palette.
 *
 * Every piece borrows a colour from the halo display around the hidden sun:
 * halo gold, outer-halo lavender, sundog-tail ice, zenith cobalt, alpenglow
 * rose, sastrugi-crest ember and glacier mint. The board sits on the Vigil
 * Stone's dark shadow face, so identity comes from hue/value separation plus
 * the restrained fused-shape gradient/rim/gloss treatment; nothing depends on
 * glow, pulse, shimmer or trails. That keeps active, ghost, hold, next, Canvas
 * preview/opponent-watch and multiplayer surfaces readable.
 *
 * Tuning notes: T was re-tuned away from L (the design pair sat under the 60
 * RGB-distance bar), and S/J/I/O/Z were nudged for tritan separation and stone
 * contrast. GARBAGE stays a cool slate a step above the stone face; the scene
 * shades its in-card drift to the stone value so garbage keeps >= 1.3:1 there.
 * No shape lands in its familiar hue role (palette gate 0/7).
 *
 * Keep this header free of colour literals: scripts/palette-guideline-check.mjs
 * reads the first per-shape literal in the file, which must be the block below.
 */

export const PARHELION_TETROMINOS = {
    version: 1,

    colors: {
        I: '#FFD068', // Halo gold
        O: '#D0A6FF', // Outer-halo lavender
        T: '#7EF0C2', // Glacier mint
        S: '#E46CB0', // Alpenglow rose
        Z: '#5C8AFF', // Zenith cobalt
        J: '#FF7E40', // Ember apricot
        L: '#A6E2FF', // Sundog-tail ice
        GARBAGE: '#2C3352', // Rimed slate
        CLEAN_GARBAGE: '#909CC6', // Frost haze
    },

    renderMode: 'solid',

    effects: {
        premium: true,
        phaser: {
            gradient: true,
            highlight: 0.18,
            shadow: 0.2,
            rim: true,
            rimAlpha: 0.44,
            rimWidthFactor: 0.05,
            gloss: true,
            glossAlpha: 0.18,
        },
    },

    rendererOverrides: {},
};
