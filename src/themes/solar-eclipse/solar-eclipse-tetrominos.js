/**
 * Solar Eclipse Theme - Tetromino Visual Configuration
 *
 * High-contrast palette representing the corona glow against the shadowed moon.
 */

export const SOLAR_ECLIPSE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#fff7b1',  // Corona gold
        O: '#ff9635',  // Amber flare
        T: '#ff5f8a',  // Rose aurora
        S: '#c3e8ff',  // Pale blue halo
        Z: '#ffbe5d',  // Ember orange
        J: '#7085ff',  // Twilight indigo
        L: '#ffeedd',  // Warm eclipse white
        GARBAGE: '#0a0b14', // Umbra shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 10,
        glowIntensity: 0.7,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.7,
        outlineColor: 'darken',

        pulse: true,
        pulseSpeed: 0.04,
        pulseAmplitude: 0.22,

        shimmer: true,
        shimmerSpeed: 0.06,
        shimmerIntensity: 0.18,

        trails: true,
        trailLength: 0.18,
        trailOpacity: 0.3,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 8,
            glowIntensity: 0.65,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 12,
            glowIntensity: 0.75,
            outlineWidth: 1.9,
        },
    },
};
