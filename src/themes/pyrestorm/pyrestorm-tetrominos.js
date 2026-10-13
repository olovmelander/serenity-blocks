/**
 * Pyrestorm — the piece palette: the eruption's own colours, solid in every board and preview.
 *
 * Lightning lavender, incandescent orange, storm blue, ash white, ember crimson, olivine green
 * and sulphur yellow; roles deliberately reassigned (the palette gate scores 2/7), separated by
 * lightness as well as hue (the worst pair under colour-vision deficiency is ΔE 16).
 */
export const PYRESTORM_TETROMINOS = {
    version: 2,
    colors: {
        I: '#C9B5FF',
        O: '#F4C430',
        T: '#FF6A1F',
        S: '#C21E3A',
        Z: '#2673E6',
        J: '#33B07A',
        L: '#EDE6DA',
        GARBAGE: '#2B2422',
        CLEAN_GARBAGE: '#D8CBBB',
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
