/**
 * Electric Dreams Theme - Tetromino Visual Configuration
 *
 * Vaporwave-inspired neon palette with energetic glows to match the flowing blobs
 * and electric particles.
 */

export const ELECTRIC_DREAMS_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffb347', // Neon amber
        O: '#ff66f0', // Hot pink glow
        T: '#94ffb3', // Mint pulse
        S: '#ff5c7c', // Coral neon
        Z: '#8a8dff', // Indigo haze
        J: '#ffe066', // Vapor gold
        L: '#62f6ff', // Cyan electric streak
        GARBAGE: '#1b1024', // Midnight background
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 12,
        glowIntensity: 0.8,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.05,
        pulseAmplitude: 0.25,

        shimmer: true,
        shimmerSpeed: 0.08,
        shimmerIntensity: 0.22,

        trails: true,
        trailLength: 0.2,
        trailOpacity: 0.35,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 10,
            glowIntensity: 0.75,
            outlineWidth: 1.6,
        },
        phaser: {
            glowRadius: 14,
            glowIntensity: 0.85,
            outlineWidth: 2.0,
        },
    },
};
