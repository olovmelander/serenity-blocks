/**
 * High Coast — the coast's own colours, deliberately reassigned (0/7 in the conventional bands),
 * solid in every board and preview: Baltic blue, Falu red, cloudberry, heather, map lichen,
 * rapakivi rose and spruce. Every pair stays ΔE > 16 under protan, deutan and tritan simulation.
 */
export const HIGH_COAST_TETROMINOS = {
    version: 2,
    colors: {
        I: '#3B78E0',
        O: '#B5322A',
        T: '#F59A2E',
        S: '#C44AA0',
        Z: '#D7EA6A',
        J: '#F2B4A2',
        L: '#1E8C6E',
        GARBAGE: '#363C45',
        CLEAN_GARBAGE: '#E4DED2',
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
