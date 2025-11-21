/**
 * Voltage Storm Theme - Tetromino Visual Configuration
 *
 * High-voltage, neon-charged tetrominos with sharp glow and electric pulse effects.
 */

export const VOLTAGE_STORM_TETROMINOS = {
    version: 1,

    colors: {
        I: '#00ffff',  // Cyan - Plasma
        O: '#ffff00',  // Yellow - High Voltage
        T: '#b000ff',  // Electric Purple - Arc
        S: '#00ff00',  // Neon Green - Radioactive
        Z: '#ff0000',  // Red - Overload
        J: '#0088ff',  // Blue - Spark
        L: '#ff8800',  // Orange - Energy
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
