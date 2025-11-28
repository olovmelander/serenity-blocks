/**
 * Geode Theme - Tetromino Visual Configuration
 *
 * Deep cave palette inspired by amethyst, sapphire, and emerald crystals,
 * complete with glowing rims to match the geode atmosphere.
 */

export const GEODE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#6beaff', // Aquamarine vein
        O: '#d6a4ff', // Amethyst heart
        T: '#8b63ff', // Deep geode violet
        S: '#43f0c0', // Emerald glimmer
        Z: '#ff81c7', // Rose quartz flare
        J: '#5c6dff', // Sapphire ridge
        L: '#99ffe5', // Opal highlight
        GARBAGE: '#05070d', // Basalt shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 14,
        glowIntensity: 0.85,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2.2,
        outlineColor: '#0a0816',

        pulse: true,
        pulseSpeed: 0.045,
        pulseAmplitude: 0.28,

        shimmer: true,
        shimmerSpeed: 0.08,
        shimmerIntensity: 0.24,

        trails: true,
        trailLength: 0.22,
        trailOpacity: 0.38,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 11,
            glowIntensity: 0.78,
            outlineWidth: 1.9,
        },
        phaser: {
            glowRadius: 16,
            glowIntensity: 0.9,
            outlineWidth: 2.4,
        },
    },
};
