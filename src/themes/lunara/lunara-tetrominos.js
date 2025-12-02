/**
 * Lunara Theme - Tetromino Visual Configuration
 *
 * Moonlit alpine palette: amethyst skies, icy blues, and soft aurora greens.
 */

export const LUNARA_TETROMINOS = {
    version: 1,

    colors: {
        I: '#a8e0ff', // Brilliant Moonlit Glacier
        O: '#ffd4a8', // Warm Lantern Amber
        T: '#d8a8ff', // Vivid Amethyst Glow
        S: '#a8ffe8', // Bright Aurora Teal
        Z: '#ffa8d0', // Vibrant Alpine Rose
        J: '#8090e0', // Deep Twilight Indigo
        L: '#ffc050', // Radiant Sunrise Gold
        GARBAGE: '#252840', // Deep Mountain Shadow
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
        shimmerSpeed: 0.05,
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
