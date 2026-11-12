/**
 * Vesper Chrysalis — Tetromino Visual Configuration
 *
 * The falling pieces read as shards of the relic: icy-cyan and violet crystal
 * with molten-amber accents, softly glowing to sit inside the twilight scene.
 * The shards are dealt to the pieces in the relic's own order: no piece wears the
 * colour its shape usually has (the palette gate reads 0/7, with its bands widened too).
 */

export const VESPER_CHRYSALIS_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffd88a', // gold
        O: '#e0629a', // magenta
        T: '#ffb347', // amber
        S: '#8a5cff', // violet
        Z: '#c8f4ff', // pale cyan
        J: '#ff7a1a', // molten amber
        L: '#9fe8ff', // icy cyan
        GARBAGE: '#2a2140',
        CLEAN_GARBAGE: '#5a4a7a',
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 11,
        glowIntensity: 0.7,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.7,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.2,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.18,

        trails: true,
        trailLength: 0.18,
        trailOpacity: 0.32,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 8,
            glowIntensity: 0.6,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 13,
            glowIntensity: 0.74,
            outlineWidth: 1.9,
        },
    },
};
