/**
 * Grainfields — the seven mineral pigments of a gold-leaf folding screen of autumn fields,
 * deliberately reassigned, solid in every board and preview: I gold leaf, T malachite, Z violet,
 * L rose madder, S azurite, J shell white, O vermilion. The same table, by piece code, is
 * PIECE_COLORS in grainfields-core.js. Clean garbage is dry stubble.
 */
export const GRAINFIELDS_TETROMINOS = {
    version: 2,
    colors: {
        I: '#E9B53B',
        O: '#E5482C',
        T: '#25A26B',
        S: '#3A6CE2',
        Z: '#9356D8',
        J: '#F2EDE1',
        L: '#D7356E',
        GARBAGE: '#2E3238',
        CLEAN_GARBAGE: '#C9BC98',
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
