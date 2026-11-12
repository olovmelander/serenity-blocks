/**
 * Kaleidosonic — seven notes in psychedelic jewel tones, solid in every board and preview: ember,
 * ultraviolet, jade, hot magenta, aqua, sunflower gold and sky, in piece order. The order is the
 * world's own: no piece wears the colour its shape usually has (the palette gate reads 0/7, with
 * its bands widened too). Every pair stays ΔE > 15 under protan, deutan and tritan simulation, and
 * the closest pairs are held apart in lightness. kaleidosonic-core.js carries the same table by
 * piece code.
 */
export const KALEIDOSONIC_TETROMINOS = {
    version: 2,
    colors: {
        I: '#FF8A45', // ember
        O: '#7B4DFF', // ultraviolet
        T: '#15A05A', // jade
        S: '#E8329E', // hot magenta
        Z: '#2EE6D0', // aqua
        J: '#FFD23F', // sunflower gold
        L: '#5AB0FF', // sky
        GARBAGE: '#2E2440',
        CLEAN_GARBAGE: '#E9DEF5',
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
