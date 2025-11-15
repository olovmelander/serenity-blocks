/**
 * Moonrise Summit Theme - Tetromino Visual Configuration
 *
 * Soft alpine palette inspired by moonlit peaks and twilight skies:
 * icy blues, lavender dusk, and warm lantern glows.
 */

export const MOONRISE_SUMMIT_TETROMINOS = {
    version: 1,

    colors: {
        I: '#bfe9ff',  // Glacier blue
        O: '#ffe7b3',  // Warm lantern glow
        T: '#c9b2ff',  // Lavender dusk
        S: '#d3fff1',  // Misty teal
        Z: '#ffb0c9',  // Alpine rose pink
        J: '#8aa4d5',  // Twilight indigo
        L: '#ffd089',  // Summit sunrise
        GARBAGE: '#1b1f33', // Mountain shadow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 9,
        glowIntensity: 0.65,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.6,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.18,

        shimmer: true,
        shimmerSpeed: 0.045,
        shimmerIntensity: 0.15,

        trails: true,
        trailLength: 0.12,
        trailOpacity: 0.25,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 7,
            glowIntensity: 0.6,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 11,
            glowIntensity: 0.7,
            outlineWidth: 1.8,
        },
    },
};
