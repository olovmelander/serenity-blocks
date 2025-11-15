/**
 * Starlight Theme - Tetromino Visual Configuration
 *
 * Starfield palette with shimmering whites, blues, and soft auroras.
 */

export const STARLIGHT_TETROMINOS = {
    version: 1,

    colors: {
        I: '#cfeaff',  // Ice blue
        O: '#fff1c1',  // Starlight gold
        T: '#d8c9ff',  // Lavender glow
        S: '#a7ffe5',  // Mint aurora
        Z: '#ffb4e0',  // Pink nebula
        J: '#7a8bff',  // Indigo night
        L: '#ffe6a3',  // Warm sunrise
        GARBAGE: '#111326', // Deep cosmos
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 9,
        glowIntensity: 0.65,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.6,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.2,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.15,

        trails: true,
        trailLength: 0.14,
        trailOpacity: 0.28,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 7,
            glowIntensity: 0.6,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 11,
            glowIntensity: 0.7,
            outlineWidth: 1.8,
        },
    },
};
