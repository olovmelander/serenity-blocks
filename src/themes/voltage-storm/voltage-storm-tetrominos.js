/**
 * Voltage Storm Theme - Tetromino Visual Configuration
 *
 * High-voltage, neon-charged tetrominos with sharp glow and electric pulse effects.
 */

export const VOLTAGE_STORM_TETROMINOS = {
    version: 1,

    colors: {
        I: '#f5e000', // Charged amber
        O: '#b64bff', // Arc violet
        T: '#2bff6a', // Plasma green
        S: '#ff2a3d', // Overload crimson
        Z: '#1e9bff', // Spark azure
        J: '#ff7a1a', // Energy ember
        L: '#1ef0ff', // Plasma cyan
        GARBAGE: '#202028', // Dark matter
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 20, // Stronger glow
        glowIntensity: 1.2, // Very bright
        glowColor: 'auto',

        outline: true,
        outlineWidth: 3.0, // Thicker outline
        outlineColor: '#ffffff', // White core

        pulse: true,
        pulseSpeed: 0.2, // Fast pulse
        pulseAmplitude: 0.5,

        shimmer: true,
        shimmerSpeed: 0.3, // Fast shimmer
        shimmerIntensity: 0.5,

        trails: true,
        trailLength: 0.4,
        trailOpacity: 0.6,

        // Theme specific
        electricArc: true, // Custom flag for renderer if supported
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 15,
            glowIntensity: 1.0,
            outlineWidth: 2.5,
        },
        phaser: {
            glowRadius: 25,
            glowIntensity: 1.5,
            outlineWidth: 3.0,
        },
    },
};
