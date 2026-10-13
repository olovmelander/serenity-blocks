/**
 * Luminous Tides — the glowing shore's own colours, deliberately reassigned (0/7 in the
 * conventional bands), solid in every board and preview: the far coast's sodium lamps, the sea's
 * cyan fire, sea glass, coral, the cobalt of the deep night, the orchid of the blue hour and pale
 * sand. Every pair stays ΔE > 16 under protan, deutan and tritan simulation (worst: T/S deutan 16).
 */
export const LUMINOUS_TIDES_TETROMINOS = {
    version: 2,
    colors: {
        I: '#FFB23E',
        O: '#45DCF7',
        T: '#1F9E63',
        S: '#FF7F95',
        Z: '#3557E8',
        J: '#C08AF7',
        L: '#ECEDC9',
        GARBAGE: '#2F3640',
        CLEAN_GARBAGE: '#DDE6EA',
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
