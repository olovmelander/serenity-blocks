/**
 * Tornado Theme - Tetromino Visual Configuration
 *
 * Seven clear hues that read against slate cloud and amber light, and as the ribbons of light
 * the funnel carries for each locked piece.
 */

export const TORNADO_TETROMINOS = {
    version: 1,

    colors: {
        I: '#FFC21A', // Storm gold
        O: '#D95BFF', // Violet
        T: '#38F08C', // Hail green
        S: '#FF4D6D', // Ember rose
        Z: '#3AA0FF', // Rain blue
        J: '#FF7A1A', // Sunset orange
        L: '#2EE6E6', // Ice cyan
        GARBAGE: '#5a6068', // Slate
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 14,
        glowIntensity: 0.85,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.8,
        outlineColor: '#14171c',

        pulse: true,
        pulseSpeed: 0.028,
        pulseAmplitude: 0.25,

        shimmer: true,
        shimmerSpeed: 0.045,
        shimmerIntensity: 0.22,

        trails: true,
        trailLength: 0.22,
        trailOpacity: 0.32,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 12,
            glowIntensity: 0.75,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 16,
            glowIntensity: 0.92,
            outlineWidth: 2.0,
        },
    },
};
