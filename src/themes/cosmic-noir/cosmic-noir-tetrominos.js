/**
 * Cosmic Noir Theme - Tetromino Visual Configuration
 *
 * A black-and-white picture: the pieces are silver prints, from paper white down to a mid grey.
 * None goes darker than that (the board they fall on is nearly black, and a piece must read at a
 * glance), and neighbours on the scale lean by turns a breath cold and a breath warm, as two
 * papers do, so two greys side by side in the stack are still two pieces.
 */

export const COSMIC_NOIR_TETROMINOS = {
    version: 2,

    colors: {
        I: '#f6f6fa', // Paper white: the beam
        O: '#dcdad4', // Warm white: the lamp's glass
        T: '#c2c7d0', // Cold silver: moonlit steel
        S: '#aaa7a1', // Warm grey: wet stone
        Z: '#939aa6', // Cold grey: the sea under the galaxy
        J: '#807d79', // Warm mid grey: the tower's dark band
        L: '#6c727d', // Cold mid grey: slate
        GARBAGE: '#2b2d33', // Soot
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 9,
        glowIntensity: 0.6,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.2,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.18,

        trails: true,
        trailLength: 0.15,
        trailOpacity: 0.3,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 7,
            glowIntensity: 0.55,
            outlineWidth: 1.6,
        },
        phaser: {
            glowRadius: 11,
            glowIntensity: 0.65,
            outlineWidth: 2,
        },
    },
};
