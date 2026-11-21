/**
 * Lunara Theme - Tetromino Visual Configuration
 *
 * Moonlit alpine palette: amethyst skies, icy blues, and soft aurora greens.
 */

export const LUNARA_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffad89', // Copper in the companion's light
        O: '#be97ff', // Amethyst
        T: '#65efd0', // Aurora mint
        S: '#ff83b7', // Rose quartz
        Z: '#889eff', // Blue-violet feldspar
        J: '#ffda72', // Moonfire gold
        L: '#8ddcff', // Ice blue
        GARBAGE: '#252840', // Deep Mountain Shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 9,
        glowIntensity: 0.48,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.6,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.09,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.09,

        trails: true,
        trailLength: 0.12,
        trailOpacity: 0.25,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 7,
            glowIntensity: 0.43,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 8,
            glowIntensity: 0.5,
            outlineWidth: 1.8,
        },
    },
};
