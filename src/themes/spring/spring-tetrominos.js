/**
 * Spring Theme - Tetromino Visual Configuration
 *
 * Dewy pastels inspired by rain-washed skies, budding leaves, and blooming petals.
 */

export const SPRING_TETROMINOS = {
    version: 1,

    colors: {
        I: '#8fdfff',  // Rainwashed sky
        O: '#f6f2a4',  // Warm sunlight
        T: '#d5a5ff',  // Lavender bloom
        S: '#88e29a',  // Fresh sprout
        Z: '#ff9fb8',  // Pink petals
        J: '#7baed6',  // Soft raincloud
        L: '#f6c58c',  // Golden dawn
        GARBAGE: '#2f3e34', // Earthy soil
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 11,
        glowIntensity: 0.75,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.6,
        outlineColor: '#152019',

        pulse: true,
        pulseSpeed: 0.032,
        pulseAmplitude: 0.2,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.18,

        trails: true,
        trailLength: 0.18,
        trailOpacity: 0.28,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 9,
            glowIntensity: 0.68,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 13,
            glowIntensity: 0.82,
            outlineWidth: 1.9,
        },
    },
};
