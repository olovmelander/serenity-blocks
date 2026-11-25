/**
 * Fluid Dreams Theme - Tetromino Visual Configuration
 *
 * Electric iridescent palette: the colours the dreaming sea is painted in, seven hues at least
 * 36 degrees apart round the colour wheel (gold 48, coral 7, hot pink 330, violet 274, azure 222,
 * cyan 186, mint 148), so no two pieces are told apart by lightness alone. (Until 2026-11-25 S
 * and O were both cyan, T and L both pink and I and Z both gold: three pairs a few degrees
 * apart.) A locked piece's colour is the colour of the droplet it sends into the sea and of the
 * stain it leaves there.
 */

export const FLUID_DREAMS_TETROMINOS = {
    version: 2,

    colors: {
        I: '#FFD93D', // warm gold accent
        O: '#00E5FF', // electric cyan
        T: '#FF2D95', // neon pink-magenta
        S: '#FF6B57', // coral
        Z: '#5CF2A2', // mint
        J: '#B14CFF', // electric violet
        L: '#5B8CFF', // azure
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
