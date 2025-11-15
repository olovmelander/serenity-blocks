/**
 * Wolfhour Theme - Tetromino Visual Configuration
 *
 * Mystical cosmic palette with celestial blues, ethereal cyans, and nebula purples.
 * Each piece glows like a cosmic entity in the mystical night sky.
 */

export const WOLFHOUR_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ddeeff',  // Celestial silver - bright moonlit beam (very light)
        O: '#f5f8fa',  // Moonlight silver - pristine starlight (brightest)
        T: '#b0c4d8',  // Mystic silver - ethereal cloud (medium-light)
        S: '#a0b8cc',  // Spirit silver - gentle essence (medium)
        Z: '#98a8bc',  // Twilight silver - mystical shimmer (medium-dark)
        J: '#708090',  // Deep silver - shadowed depths (dark - slate gray)
        L: '#c8d8e8',  // Crystal silver - luminous glow (light)
        GARBAGE: '#1a1a1a', // Cosmic void - deep darkness (matches foreground mountain)
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 18,
        glowIntensity: 0.95,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: '#e8f0f8', // Silver starlight outline

        // Cosmic pulsing like twinkling stars
        pulse: true,
        pulseSpeed: 0.042,        // Medium mystical breathing
        pulseAmplitude: 0.35,     // Strong variation like star twinkle

        // Cosmic shimmer like nebula energy
        shimmer: true,
        shimmerSpeed: 0.068,
        shimmerIntensity: 0.28,

        // Shooting star trails
        trails: true,
        trailLength: 0.32,
        trailOpacity: 0.42,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 15,
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
