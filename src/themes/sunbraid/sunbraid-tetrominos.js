/**
 * Sunbraid — the seven colours of the braid's light, deliberately reassigned, solid in every
 * board and preview: the three suns (I coral, O cobalt, J jade), the colours their shadows make
 * (Z cyan where the coral sun is hidden, S magenta where the jade one is, T gold where the cobalt
 * one is), and L the lilac of the far sky. Separated by value as well as hue, so no two collapse
 * under any colour-vision deficiency. The same table, by piece code, is PIECE_COLORS in
 * sunbraid-core.js. Garbage is shadowed stone; clean garbage the pale gypsum of the valley floor.
 */
export const SUNBRAID_TETROMINOS = {
    version: 2,
    colors: {
        I: '#FF8463',
        O: '#2B4FC4',
        T: '#F5BB45',
        S: '#C8378A',
        Z: '#62E0D6',
        J: '#22804A',
        L: '#B9A2F7',
        GARBAGE: '#2A2D3B',
        CLEAN_GARBAGE: '#CFC8BC',
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
