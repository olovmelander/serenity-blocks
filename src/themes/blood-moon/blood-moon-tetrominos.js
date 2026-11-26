/** Salt, copper and garnet in eclipse light. The queue and the board share a cut edge. */
export const BLOOD_MOON_TETROMINOS = {
    version: 2,
    colors: {
        I: '#e85c73', // Garnet
        O: '#d6e8f1', // Moonlit salt
        T: '#70bdb0', // Ozone fringe
        S: '#ee9263', // Copper
        Z: '#bb8bcc', // Plum in the umbra
        J: '#edc477', // Golden limb
        L: '#789ed6', // Twilight blue
        GARBAGE: '#66606d', // Ash
        CLEAN_GARBAGE: '#928694',
    },
    renderMode: 'solid',
    effects: {
        outline: false,
        phaser: {
            highlight: 0.21,
            shadow: 0.28,
            rimAlpha: 0.43,
            rimWidthFactor: 0.05,
            glossAlpha: 0.19,
        },
    },
};
