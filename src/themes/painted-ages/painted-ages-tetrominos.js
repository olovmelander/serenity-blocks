/** Mineral slabs: deliberately reassigned pigments, solid in every board and preview. */
export const PAINTED_AGES_TETROMINOS = {
    version: 2,
    colors: {
        I: '#D8432C',
        O: '#4C74E9',
        T: '#0E726F',
        S: '#F0C02D',
        Z: '#B7AADE',
        J: '#D3739A',
        L: '#81CA8B',
        GARBAGE: '#2A2630',
        CLEAN_GARBAGE: '#E6DCC8',
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
