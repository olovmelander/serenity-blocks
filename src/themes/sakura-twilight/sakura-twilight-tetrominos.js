/**
 * @fileoverview Sakura Twilight Tetromino Configuration
 * Mystical twilight palette: soft sakura pinks, deep purples,
 * cool moonlight blues, and warm lantern amber accents
 */

export const SAKURA_TWILIGHT_TETROMINOS = {
    version: 1,
    colors: {
        I: '#A8C8E8', // Moonlight blue - cool ethereal glow
        O: '#FFCF8B', // Lantern amber - warm floating light
        T: '#7B5B9A', // Deep twilight purple - matches fog
        S: '#FFB7C5', // Soft sakura pink - cherry blossom lit
        Z: '#DB7093', // Rose pink - sakura shadow tone
        J: '#9B7BB8', // Lavender mist - evening sky
        L: '#E8B4C8', // Pale cherry blossom - delicate pink
        GARBAGE: '#4A3B5C', // Muted twilight - dark purple-gray
    },
    renderMode: 'glow',
    effects: {
        glowRadius: 16,
        glowIntensity: 0.85,
        glowColor: 'auto',
        outline: true,
        outlineWidth: 1.5,
        outlineColor: '#FFF0F5', // Lavender blush - soft highlight
        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.25,
        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.22,
        trails: true,
        trailLength: 0.35,
        trailOpacity: 0.35,
    },
    rendererOverrides: {
        canvas: {
            glowRadius: 14,
            glowIntensity: 0.75,
        },
        phaser: {
            glowRadius: 18,
            glowIntensity: 0.9,
            shimmerIntensity: 0.26,
        },
    },
};
