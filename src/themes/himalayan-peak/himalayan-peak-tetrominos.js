/**
 * Himalayan Peak Theme - Tetromino Visual Configuration
 *
 * Inspired by prayer flags, snow-capped peaks, and the mystical high-altitude atmosphere.
 * Colors drawn from traditional Tibetan prayer flags and the majestic Himalayan landscape.
 */

export const HIMALAYAN_PEAK_TETROMINOS = {
    version: 2,

    colors: {
        I: '#f0f5ff', // Snow cap white - pristine peak snow
        O: '#9c88ff', // Prayer flag purple - spiritual wisdom
        T: '#4cd137', // Prayer flag green - nature and harmony
        S: '#e84118', // Prayer flag red - life force and bravery
        Z: '#5a7090', // Deep mountain gray - shadowed peaks
        J: '#fbc531', // Prayer flag yellow - earth and enlightenment
        L: '#00a8ff', // Prayer flag blue - sky and space
        GARBAGE: '#3c465a', // Mountain shadow - deep rocky depths
    },

    // A cool bevel catches light at the edge of each dyed block. The face stays steady.
    renderMode: 'solid',
    effects: {
        premium: true,
        phaser: {
            gradient: true,
            highlight: 0.19,
            shadow: 0.17,
            rim: true,
            rimAlpha: 0.44,
            rimWidthFactor: 0.055,
            gloss: true,
            glossAlpha: 0.12,
        },
    },
    rendererOverrides: {},
};
