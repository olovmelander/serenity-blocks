/** The seven lane colours in cut glass, with a fine highlight around each fused silhouette. */
export const CHROMADELIC_HIGHWAY_TETROMINOS = {
    version: 2,
    colors: {
        I: '#fe4595',
        O: '#ff963c',
        T: '#ffe163',
        S: '#48e79a',
        Z: '#45e5f5',
        J: '#6799ff',
        L: '#c478fc',
        GARBAGE: '#504966',
    },
    renderMode: 'solid',
    effects: {
        outline: false,
        phaser: {
            highlight: 0.25,
            shadow: 0.24,
            rimAlpha: 0.47,
            rimWidthFactor: 0.048,
            glossAlpha: 0.24,
        },
    },
};
