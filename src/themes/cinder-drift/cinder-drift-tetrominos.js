/**
 * Cinder Drift Theme - Tetromino Visual Configuration
 *
 * Warm ember and charred tones with glowing effects for a smoldering atmosphere.
 */

export const CINDER_DRIFT_TETROMINOS = {
    version: 1,

    // "Molten" Palette - Rich, deep, hot colors
    // "Molten" Palette - Strict Heat Spectrum (No Neons)
    colors: {
        I: '#fff5e6', // White Hot (hottest)
        O: '#ffcc00', // Gold
        T: '#800020', // Burgundy (cooling)
        S: '#cccc00', // Dull Sulfur
        Z: '#cc3300', // Red Clay
        J: '#4a0404', // Dark Slag
        L: '#ff8800', // Bright Ember
        GARBAGE: '#333333', // Basalt
    },

    renderMode: 'gradient',

    effects: {
        // Molten Core look
        gradientType: 'radial',
        gradientStops: [
            { offset: 0, color: 'lighten', opacity: 1 },  // Hot center
            { offset: 1, color: 'base', opacity: 1 }      // Base color edge
        ],

        // Heat Haze Glow
        glowRadius: 15, // Tighter glow
        glowIntensity: 1.2,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.0, // Thin crisp edge
        outlineColor: 'lighten', // Glowing edge

        pulse: true,
        pulseSpeed: 0.5,
        pulseAmplitude: 0.15, // Subtle breathing

        shimmer: true, // Heat shimmer
        shimmerSpeed: 0.2,
        shimmerIntensity: 0.3,

        trails: true,
        trailLength: 0.3,
        trailOpacity: 0.4,

        emberGlow: true,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 12,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 20,
            outlineWidth: 2.0,
        },
    },
};
