/**
 * Misty Lake Theme - Tetromino Visual Configuration
 *
 * Serene palette of moonlit blues, misty purples, and lantern golds to match
 * the tranquil lake atmosphere.
 */

export const MISTY_LAKE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffd59a', // Lantern amber
        O: '#cfc2ff', // Lilac glow
        T: '#9efad2', // Dewy mint
        S: '#ffa9c4', // Petal pink
        Z: '#7a92d5', // Twilight indigo
        J: '#ffe388', // Warm sunrise
        L: '#b1e5ff', // Misty cyan
        GARBAGE: '#131c2d', // Lake shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 15,
        glowIntensity: 0.85,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2.0,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.04,
        pulseAmplitude: 0.25,

        shimmer: true,
        shimmerSpeed: 0.06,
        shimmerIntensity: 0.3,

        trails: true,
        trailLength: 0.25,
        trailOpacity: 0.4,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 7,
            glowIntensity: 0.6,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 18,
            glowIntensity: 0.9,
            outlineWidth: 2.5,
        },
    },
};
