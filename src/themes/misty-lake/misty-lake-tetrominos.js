/**
 * Misty Lake Theme - Tetromino Visual Configuration
 *
 * Serene palette of moonlit blues, misty purples, and lantern golds to match
 * the tranquil lake atmosphere.
 */

export const MISTY_LAKE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#b1e5ff', // Misty cyan
        O: '#ffd59a', // Lantern amber
        T: '#cfc2ff', // Lilac glow
        S: '#9efad2', // Dewy mint
        Z: '#ffa9c4', // Petal pink
        J: '#7a92d5', // Twilight indigo
        L: '#ffe388', // Warm sunrise
        GARBAGE: '#131c2d', // Lake shadow
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
        pulseSpeed: 0.03,
        pulseAmplitude: 0.18,

        shimmer: true,
        shimmerSpeed: 0.045,
        shimmerIntensity: 0.15,

        trails: true,
        trailLength: 0.12,
        trailOpacity: 0.25,
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
