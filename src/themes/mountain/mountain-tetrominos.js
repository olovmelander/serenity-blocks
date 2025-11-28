/**
 * Mountain Theme - Tetromino Visual Configuration
 *
 * Majestic alpine palette with rocky peaks, snow caps, and stormy skies.
 * Each piece evokes the grandeur and solidity of mountain ranges.
 */

export const MOUNTAIN_TETROMINOS = {
    version: 1,

    colors: {
        I: '#5a9fd8', // Alpine sky - bright mountain atmosphere
        O: '#e8f0f7', // Snow cap - pristine peak snow
        T: '#6b7a9e', // Storm ridge - dramatic mountain weather
        S: '#8b9cb3', // Granite gray - solid mountain rock
        Z: '#4a5d7a', // Slate blue - weathered stone
        J: '#2c3e50', // Deep valley - shadowed mountain depths (matches mid-range)
        L: '#d4a574', // Dawn gold - sunrise over peaks
        GARBAGE: '#1b2631', // Dark rock - deep mountain shadow (matches front-range)
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 10,
        glowIntensity: 0.6,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2.5,
        outlineColor: '#3e517a', // Mountain ridge outline (matches back-range)

        // Subtle atmospheric pulsing like mountain mist
        pulse: true,
        pulseSpeed: 0.025, // Slow, majestic breathing
        pulseAmplitude: 0.15, // Gentle variation

        // Subtle shimmer like distant peaks in haze
        shimmer: true,
        shimmerSpeed: 0.04,
        shimmerIntensity: 0.12,

        // No trails - keeps the solid, rocky aesthetic
        trails: false,
        trailLength: 0,
        trailOpacity: 0,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 8,
            glowIntensity: 0.55,
            outlineWidth: 2.2,
        },
        phaser: {
            glowRadius: 12,
            glowIntensity: 0.68,
            outlineWidth: 2.8,
        },
    },
};
