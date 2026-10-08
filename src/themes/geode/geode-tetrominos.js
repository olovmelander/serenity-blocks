/**
 * Geode Theme - Tetromino Visual Configuration
 *
 * Seven cut stones: citrine, amethyst, emerald, fire opal, rose tourmaline, topaz and
 * aquamarine. The theme reads these colours too: a locking piece sends a ring and a spark of its
 * own colour into the geode, so they are kept saturated and well apart in hue.
 */

export const GEODE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffd060', // Citrine
        O: '#e060ff', // Amethyst
        T: '#60ff90', // Emerald
        S: '#ff6040', // Fire Opal
        Z: '#ff70ff', // Rose Tourmaline
        J: '#ffa050', // Topaz
        L: '#60ffff', // Aquamarine
        GARBAGE: '#0a0608', // Matrix
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 18,
        glowIntensity: 0.95,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: '#080406',

        pulse: true,
        pulseSpeed: 0.06,
        pulseAmplitude: 0.35,

        shimmer: true,
        shimmerSpeed: 0.1,
        shimmerIntensity: 0.32,

        trails: true,
        trailLength: 0.3,
        trailOpacity: 0.45,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 16,
            glowIntensity: 0.88,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 20,
            glowIntensity: 0.98,
            outlineWidth: 2.2,
        },
    },
};
