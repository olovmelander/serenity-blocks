/**
 * Nebula Flow Theme - Tetromino Visual Configuration
 *
 * Vibrant, glowing tetrominos inspired by flowing nebula colors
 * with dynamic shimmer and pulse effects to match the fluid simulation.
 */

export const NEBULA_FLOW_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ff5ea8', // Rose nebula
        O: '#6ad0ff', // Cyan vapor
        T: '#ffb03a', // Solar amber
        S: '#c04bff', // Violet core
        Z: '#2be0a0', // Aurora mint
        J: '#ff7a3c', // Ember flare
        L: '#3a86ff', // Cosmic blue
        GARBAGE: '#181820', // Dark void
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 16,
        glowIntensity: 0.95,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2.0,
        outlineColor: '#0a0a12',

        pulse: true,
        pulseSpeed: 0.06,
        pulseAmplitude: 0.35,

        shimmer: true,
        shimmerSpeed: 0.12,
        shimmerIntensity: 0.32,

        trails: true,
        trailLength: 0.28,
        trailOpacity: 0.42,

        // Nebula-specific effects
        nebula: true,
        nebulaFlow: 0.15,
        colorShift: 0.08,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 13,
            glowIntensity: 0.88,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 18,
            glowIntensity: 1.0,
            outlineWidth: 2.2,
        },
    },
};
