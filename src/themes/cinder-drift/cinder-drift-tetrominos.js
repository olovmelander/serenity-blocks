/** Tempered metal pieces. The active board uses the Phaser bevel and the Canvas queue uses the same alloys. */
export const CINDER_DRIFT_TETROMINOS = {
    version: 2,
    colors: {
        I: '#ffedc9', // Incandescent ivory
        O: '#f15840', // Vermilion
        T: '#d980a0', // Rose iron
        S: '#b7cd72', // Olivine
        Z: '#f4c647', // Sulfur gold
        J: '#84a6c8', // Tempered steel under the skylight
        L: '#ff9347', // Copper orange
        GARBAGE: '#4f505a',
        CLEAN_GARBAGE: '#797783',
    },
    renderMode: 'solid',
    effects: {
        outline: false,
        phaser: {
            highlight: 0.22,
            shadow: 0.27,
            rimAlpha: 0.48,
            rimWidthFactor: 0.05,
            glossAlpha: 0.12,
        },
    },
};
