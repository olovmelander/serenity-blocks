/**
 * Chromatic Impasto Tetrominos - Colors inspired by Bengt Lindström's "Kvinnan Alpha"
 * Bold, deeply saturated colors from the expressionist painting
 */

export const CHROMATIC_IMPASTO_TETROMINOS = {
    version: 1,

    colors: {
        I: '#00D9CC', // Bright turquoise/cyan
        J: '#0033CC', // Deep saturated blue
        L: '#FF7F00', // Pure saturated orange
        O: '#FFD000', // Rich golden yellow
        S: '#1A7F4D', // Deep forest green
        T: '#B30000', // Deep blood red
        Z: '#FFF8DC', // Warm cream white
        GARBAGE: '#2A2A2A', // Dark charcoal (neutral canvas)
    },

    renderMode: 'glow', // Using glow to simulate the "wet paint" look

    effects: {
        glowRadius: 12, // Slightly tighter glow for "thick paint" feel
        glowIntensity: 0.8,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 3, // Thicker outline for "impasto" strokes
        outlineColor: '#000000', // Black outline to separate colors like in the painting

        pulse: false, // Paint doesn't usually pulse
        shimmer: true, // Slight shimmer for "wetness"
        shimmerSpeed: 0.02,
        shimmerIntensity: 0.1,

        trails: true,
        trailLength: 0.2,
        trailOpacity: 0.4,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 10,
            outlineWidth: 2.5,
        },
        phaser: {
            glowRadius: 14,
            outlineWidth: 3.5,
        },
    },
};
