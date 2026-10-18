/**
 * Rainbow Terraces — the pieces: the seven colours of the bow, re-dealt.
 *
 * Read outside to inside the bow is S J I T Z L O. The colours are luminous, like light rather
 * than paint, and none of them sits in the hue band a falling-block game usually gives its shape
 * (scripts/palette-guideline-check.mjs screens 0 of 7). Neighbouring hues stay 17-40 degrees
 * apart and differ in lightness as well, so J beside I and S beside J still read as two.
 *
 * The board renderer draws the ghost itself (a white-alpha outline), so there is no key for it.
 * RainbowTerracesTheme.getTetrominoConfig() returns this table, and the director falls back to it
 * for a piece that carries no colour of its own.
 */
export const RAINBOW_TERRACES_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffd04a', // saffron
        O: '#c46bf0', // orchid violet
        T: '#6fe3a6', // spray green
        S: '#ff6b5e', // bow red
        Z: '#45d0e6', // mist cyan
        J: '#ff9a45', // ember orange
        L: '#6577ff', // indigo
        GARBAGE: '#3a4260', // wet slate
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 11,
        glowIntensity: 0.74,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.14,

        // A water sheen running over the cells.
        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.14,

        trails: true,
        trailLength: 0.12,
        trailOpacity: 0.24,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 9,
            glowIntensity: 0.7,
            outlineWidth: 1.6,
        },
        phaser: {
            glowRadius: 13,
            glowIntensity: 0.8,
            outlineWidth: 2.0,
        },
    },
};
