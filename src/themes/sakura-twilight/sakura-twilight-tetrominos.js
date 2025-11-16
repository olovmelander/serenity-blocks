/**
 * @fileoverview Sakura Twilight Tetromino Configuration
 * Sunset-inspired colors with warm pinks, oranges, and purples
 */

export const SAKURA_TWILIGHT_TETROMINOS = {
    version: 1,
    colors: {
        I: '#FF85C1', // Soft sakura pink
        O: '#FFB347', // Warm sunset orange
        T: '#DA70D6', // Twilight orchid
        S: '#FFA6C9', // Cherry blossom pink
        Z: '#FF6B9D', // Deep pink
        J: '#C77DFF', // Lavender twilight
        L: '#FF9A8B', // Peach sunset
        GARBAGE: '#8B6B8B', // Muted purple-gray
    },
    renderMode: 'glow',
    effects: {
        glowRadius: 18,
        glowIntensity: 1.0,
        glowColor: 'auto',
        outline: true,
        outlineWidth: 2,
        outlineColor: '#FFF5F7',
        pulse: true,
        pulseSpeed: 0.04,
        pulseAmplitude: 0.35,
        shimmer: true,
        shimmerSpeed: 0.07,
        shimmerIntensity: 0.28,
        trails: true,
        trailLength: 0.3,
        trailOpacity: 0.4,
    },
    rendererOverrides: {
        canvas: {
            glowRadius: 16,
            glowIntensity: 0.9,
        },
        phaser: {
            glowRadius: 20,
            glowIntensity: 1.1,
            shimmerIntensity: 0.32,
        },
    },
};
