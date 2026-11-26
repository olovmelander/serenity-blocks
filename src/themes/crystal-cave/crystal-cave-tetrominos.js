/**
 * The lock's light travels from the piece to its mineral family. Citrine and fire opal
 * share the amber clusters; emerald and aquamarine share the pool's cool clusters.
 * Give each pair distinct lightness so the pieces can still be read at preview size.
 */
export const CRYSTAL_CAVE_TETROMINOS = {
    version: 2,
    colors: {
        I: '#FCDF7E', // Citrine
        O: '#D595FF', // Amethyst
        T: '#2BC685', // Emerald
        S: '#F947A3', // Rubellite
        Z: '#547CFA', // Sapphire
        J: '#FF873B', // Fire opal
        L: '#88F8F5', // Aquamarine
        GARBAGE: '#4B485E', // Weathered slate
        CLEAN_GARBAGE: '#6A687D', // Fresh cleavage
    },
    renderMode: 'solid',
    effects: {
        // The Canvas queue draws its own continuous rim in solid mode.
        outline: false,
        phaser: {
            highlight: 0.21,
            shadow: 0.23,
            rimAlpha: 0.48,
            rimWidthFactor: 0.05,
            glossAlpha: 0.18,
        },
    },
};
