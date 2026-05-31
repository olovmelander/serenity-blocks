/**
 * Fluid Dreams Theme - Tetromino Visual Configuration
 *
 * Electric iridescent palette — tints pulled from the same 5-stop ramp used
 * by the hero TSL fluid surface and the curl-noise compute particles, so the
 * whole scene reads as one material language.
 */

export const FLUID_DREAMS_TETROMINOS = {
    version: 2,

    colors: {
        I: '#00E5FF', // electric cyan
        O: '#FFD93D', // warm gold accent
        T: '#FF2D95', // neon pink-magenta
        S: '#6FE7E0', // soft cyan-mint
        Z: '#FF6FB5', // pink rim
        J: '#B14CFF', // electric violet
        L: '#FFA84C', // gold-orange
        GARBAGE: '#1A0532', // deep amethyst
    },

    renderMode: 'glow',

    effects: {
        // Toned down — let the scene bloom carry the glow rather than per-piece stacking.
        glowRadius: 6,
        glowIntensity: 0.5,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.5,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.05,
        pulseAmplitude: 0.18,

        shimmer: true,
        shimmerSpeed: 0.08,
        shimmerIntensity: 0.15,

        trails: true,
        trailLength: 0.18,
        trailOpacity: 0.3,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 5,
            glowIntensity: 0.5,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 7,
            glowIntensity: 0.55,
            outlineWidth: 1.7,
        },
    },
};
