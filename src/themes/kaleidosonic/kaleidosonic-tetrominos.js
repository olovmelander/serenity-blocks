/**
 * Kaleidosonic — seven notes in psychedelic jewel tones, solid in every board and preview:
 * aqua, sunflower gold, hot magenta, jade, ember, ultraviolet and sky. Two roles are deliberately
 * reassigned (3/7 sit in the conventional bands); every pair stays ΔE > 15 under protan, deutan
 * and tritan simulation, and the closest pairs are held apart in lightness.
 */
export const KALEIDOSONIC_TETROMINOS = {
    version: 2,
    colors: {
        I: '#2EE6D0',
        O: '#FFD23F',
        T: '#E8329E',
        S: '#15A05A',
        Z: '#FF8A45',
        J: '#7B4DFF',
        L: '#5AB0FF',
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
