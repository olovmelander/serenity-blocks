/**
 * Singing Bowl Theme - Tetromino Visual Configuration
 *
 * Tranquil palette inspired by warm brass, incense smoke, lotus petals,
 * and the soft glow of candlelight in a meditation space.
 *
 * Enhanced for the 3D Three.js implementation with richer effects.
 */

export const SINGING_BOWL_TETROMINOS = {
    version: 1,

    colors: {
        I: '#b5fff2', // Soft aqua - like clear water in the bowl
        O: '#fdda9b', // Brass glow - reflecting the bowl itself
        T: '#e5b6ff', // Lavender incense - rising smoke
        S: '#a9ffd0', // Lotus leaf - fresh green tranquility
        Z: '#ff9fbf', // Rose petal - gentle warmth
        J: '#8d99ff', // Indigo chant - deep meditation
        L: '#ffe8aa', // Candlelight - warm golden flicker
        GARBAGE: '#1a1a21', // Meditation shadow - deep void
    },

    renderMode: 'glow',

    effects: {
        // Enhanced glow for the 3D theme
        glowRadius: 11,
        glowIntensity: 0.7,
        glowColor: 'auto',

        // Soft outline for definition
        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',

        // Gentle breathing pulse like meditation
        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.18,

        // Soft shimmer like water reflections
        shimmer: true,
        shimmerSpeed: 0.04,
        shimmerIntensity: 0.16,

        // Subtle trails for piece movement
        trails: true,
        trailLength: 0.16,
        trailOpacity: 0.28,

        // Inner glow for depth
        innerGlow: true,
        innerGlowIntensity: 0.25,
        innerGlowColor: 'lighten',

        // Soft shadow for grounding
        shadow: true,
        shadowBlur: 8,
        shadowOpacity: 0.3,
        shadowOffsetY: 2,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 9,
            glowIntensity: 0.65,
            outlineWidth: 1.5,
            pulseSpeed: 0.035,
            shimmerIntensity: 0.14,
        },
        phaser: {
            glowRadius: 13,
            glowIntensity: 0.75,
            outlineWidth: 2.0,
            pulseSpeed: 0.028,
            shimmerIntensity: 0.18,
            innerGlowIntensity: 0.3,
        },
    },

    // Lock animation settings
    lockAnimation: {
        duration: 300,
        flashIntensity: 0.8,
        rippleEffect: true,
        scaleDown: 0.95,
    },

    // Clear animation settings
    clearAnimation: {
        duration: 400,
        dissolveEffect: true,
        glowBurst: true,
        particleCount: 12,
    },
};
