/**
 * Sunset Theme - Tetromino Visual Configuration
 *
 * Inspired by the warm, radiant colors of golden hour: blazing sun, fiery horizons,
 * soft dawn pinks, deep twilight purples, and the golden amber light of magic hour.
 */

export const SUNSET_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffd700',  // Golden sun - brilliant golden hour light
        O: '#ff6b1a',  // Blazing orange - sun at the horizon
        T: '#ff4d8f',  // Sunset magenta - vibrant evening sky
        S: '#b794f6',  // Twilight lavender - soft purple dusk
        Z: '#dc2626',  // Deep crimson - intense sunset red
        J: '#f59e0b',  // Warm amber - golden hour glow
        L: '#ff8a65',  // Coral peach - dawn and dusk clouds
        GARBAGE: '#1a1a2e', // Deep night - post-sunset darkness
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 13,
        glowIntensity: 0.8,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2.0,
        outlineColor: 'rgba(255, 215, 0, 0.35)', // Golden sun outline

        // Pulse like the flickering sun and atmospheric shimmer
        pulse: true,
        pulseSpeed: 0.038,         // Gentle, warm pulsing
        pulseAmplitude: 0.2,       // Noticeable radiance

        // Shimmer like heat haze and atmospheric distortion
        shimmer: true,
        shimmerSpeed: 0.055,
        shimmerIntensity: 0.22,

        // Trails like sun rays and lens flares
        trails: true,
        trailLength: 0.16,
        trailOpacity: 0.32,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 11,
            glowIntensity: 0.75,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 15,
            glowIntensity: 0.85,
            outlineWidth: 2.2,
        },
    },
};
