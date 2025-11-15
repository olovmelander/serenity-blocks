/**
 * Crystal Cave Theme - Tetromino Visual Configuration
 *
 * Jewel-toned palette inspired by amethyst, emerald, and sapphire crystals with
 * luminous glows to match the cavern’s ambience.
 */

export const CRYSTAL_CAVE_TETROMINOS = {
    version: 1,

    colors: {
        I: '#8ffbff',  // Cyan shard
        O: '#ffd48f',  // Amber crystal
        T: '#d598ff',  // Amethyst glow
        S: '#66ffc7',  // Emerald glimmer
        Z: '#ff7bd9',  // Rose quartz
        J: '#8090ff',  // Sapphire edge
        L: '#ffb88b',  // Citrine orange
        GARBAGE: '#101428', // Cavern shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 12,
        glowIntensity: 0.8,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.045,
        pulseAmplitude: 0.25,

        shimmer: true,
        shimmerSpeed: 0.07,
        shimmerIntensity: 0.2,

        trails: true,
        trailLength: 0.18,
        trailOpacity: 0.35,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 10,
            glowIntensity: 0.75,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 14,
            glowIntensity: 0.85,
            outlineWidth: 2.2,
        },
    },
};
