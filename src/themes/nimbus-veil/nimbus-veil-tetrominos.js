/**
 * Nimbus Veil Theme - Tetromino Visual Configuration
 *
 * Ethereal palette inspired by moonlit clouds drifting in a dark void.
 * Soft whites, icy blues, and gentle lavenders keep the pieces airy while
 * a cool glow effect mirrors the theme's atmospheric lighting.
 */

export const NIMBUS_VEIL_TETROMINOS = {
    version: 1,

    colors: {
        I: '#dff6ff',  // Moonlit cyan
        O: '#f6f6ff',  // Soft cloud white
        T: '#bfc6ff',  // Lavender mist
        S: '#cfe9ff',  // Pale aqua drift
        Z: '#aebdff',  // Cool indigo haze
        J: '#9ab0d8',  // Dusky periwinkle
        L: '#e2ecff',  // Frosted blue-white
        GARBAGE: '#161a27', // Void shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 10,
        glowIntensity: 0.7,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.6,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.18,

        shimmer: true,
        shimmerSpeed: 0.04,
        shimmerIntensity: 0.15,

        trails: true,
        trailLength: 0.12,
        trailOpacity: 0.25,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 8,
            glowIntensity: 0.65,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 12,
            glowIntensity: 0.75,
            outlineWidth: 1.8,
        },
    },
};
