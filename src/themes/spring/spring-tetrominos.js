/**
 * Spring Theme - Tetromino Visual Configuration
 *
 * A vibrant celebration of spring: cherry blossoms, fresh leaves,
 * golden sunlight, and the magical essence of renewal.
 */

export const SPRING_TETROMINOS = {
    version: 1,

    colors: {
        I: '#87CEEB', // Clear spring sky blue
        O: '#FFD700', // Brilliant sunshine gold
        T: '#E6A8D7', // Cherry blossom pink
        S: '#98FB98', // Fresh mint sprout
        Z: '#FFB7C5', // Soft sakura petal
        J: '#9DC8E8', // Morning dewdrop blue
        L: '#FFCC5C', // Warm buttercup yellow
        GARBAGE: '#4a6741', // Rich forest soil
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 14,
        glowIntensity: 0.85,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.8,
        outlineColor: '#1a3020',

        pulse: true,
        pulseSpeed: 0.028,
        pulseAmplitude: 0.25,

        shimmer: true,
        shimmerSpeed: 0.045,
        shimmerIntensity: 0.22,

        trails: true,
        trailLength: 0.22,
        trailOpacity: 0.32,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 12,
            glowIntensity: 0.75,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 16,
            glowIntensity: 0.92,
            outlineWidth: 2.0,
        },
    },
};
