/**
 * Lunara Theme - Tetromino Visual Configuration
 *
 * Moonlit alpine palette: amethyst skies, icy blues, and soft aurora greens.
 */

export const LUNARA_TETROMINOS = {
    version: 1,

    colors: {
        I: '#b7d8ff', // Moonlit glacier
        O: '#ffe5c7', // Lantern amber
        T: '#d3b6ff', // Amethyst glow
        S: '#c6fff2', // Aurora teal
        Z: '#ffb0de', // Alpine rose
        J: '#8aa0d8', // Twilight indigo
        L: '#ffd27a', // Sunrise gold
        GARBAGE: '#1c1f33', // Mountain shadow
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
