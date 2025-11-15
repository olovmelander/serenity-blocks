/**
 * Winter Theme - Tetromino Visual Configuration
 *
 * Frozen crystalline palette with icy blues, glacial whites, and arctic tones.
 * Each piece glows like ice crystals in a winter storm.
 */

export const WINTER_TETROMINOS = {
    version: 1,

    colors: {
        I: '#6de0ff',  // Glacier ice beam - bright frozen cyan
        O: '#e8f4ff',  // Frost white - pristine snow crystal
        T: '#4a9fd8',  // Deep ice blue - frozen lake depths
        S: '#7ef2ff',  // Arctic cyan - shimmering ice surface
        Z: '#b8d9f0',  // Silver ice - cool metallic frost
        J: '#2b5f8a',  // Cobalt ice - midnight glacier
        L: '#5ec3e8',  // Crystal blue - sparkling icicle
        GARBAGE: '#0d1821', // Dark frozen shadow - winter night
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 15,
        glowIntensity: 0.85,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: '#d4ecff', // Icy blue-white outline

        // Crystalline pulsing like frozen shimmer
        pulse: true,
        pulseSpeed: 0.032,        // Slow, cold breathing
        pulseAmplitude: 0.25,     // Noticeable shimmer

        // Ice crystal shimmer effect
        shimmer: true,
        shimmerSpeed: 0.055,
        shimmerIntensity: 0.22,

        // Frozen trails disabled for clean ice aesthetic
        trails: false,
        trailLength: 0,
        trailOpacity: 0,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 12,
            glowIntensity: 0.78,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 17,
            glowIntensity: 0.9,
            outlineWidth: 2.3,
        },
    },
};
