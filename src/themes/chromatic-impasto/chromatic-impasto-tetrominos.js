/** Tube pigments on the solo well's dark ground. */

export const CHROMATIC_IMPASTO_TETROMINOS = {
    version: 2,

    colors: {
        I: '#FECE24', // Cadmium yellow
        J: '#F98433', // Cadmium orange
        L: '#44AE6D', // Viridian with a little white
        O: '#2CE0D3', // Turquoise
        S: '#657DF2', // Ultramarine raised with white
        T: '#ED4A4A', // Vermilion
        Z: '#FFF1C3', // Naples yellow light
        GARBAGE: '#514747', // Burnt umber and charcoal
    },

    renderMode: 'solid',
    effects: {
        outline: false,
        phaser: {
            highlight: 0.23,
            shadow: 0.26,
            rimAlpha: 0.35,
            rimWidthFactor: 0.045,
            glossAlpha: 0.27,
        },
    },
};
