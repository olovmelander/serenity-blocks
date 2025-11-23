/**
 * Cinder Drift Theme - Tetromino Visual Configuration
 *
 * Warm ember and charred tones with glowing effects for a smoldering atmosphere.
 */

export const CINDER_DRIFT_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ff6b35',  // Ember Orange
        O: '#ffa500',  // Bright Ember
        T: '#8B4513',  // Charred Brown
        S: '#D2691E',  // Burnt Orange
        Z: '#CD5C5C',  // Smoldering Red
        J: '#696969',  // Ash Gray
        L: '#FF4500',  // Hot Ember
        GARBAGE: '#1a1614', // Charcoal
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 18,
        glowIntensity: 0.9,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2.5,
        outlineColor: '#2a1810', // Dark ember outline

        pulse: true,
        pulseSpeed: 0.15, // Slow ember pulse
        pulseAmplitude: 0.3,

        shimmer: true,
        shimmerSpeed: 0.2,
        shimmerIntensity: 0.4,

        trails: true,
        trailLength: 0.3,
        trailOpacity: 0.5,

        // Theme specific
        emberGlow: true,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 14,
            glowIntensity: 0.8,
            outlineWidth: 2.0,
        },
        phaser: {
            glowRadius: 22,
            glowIntensity: 1.1,
            outlineWidth: 3.0,
        },
    },
};
