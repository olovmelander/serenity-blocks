/**
 * Koi Pond Theme - Tetromino Visual Configuration
 *
 * A serene aquatic palette inspired by:
 * - Crystal clear pond water
 * - Glowing paper lantern reflections
 * - Delicate cherry blossom petals
 * - Vibrant koi fish scales
 * - Fresh lily pad greens
 * - Deep water shadows
 */

export const KOI_POND_TETROMINOS = {
    version: 1,

    colors: {
        I: '#f5bd58', // Amber lantern
        O: '#f3a4c5', // Lotus pink
        T: '#76ce87', // New lily leaf
        S: '#f27850', // Vermilion koi
        Z: '#9899ee', // Twilight iris
        J: '#e1ece2', // Platinum koi
        L: '#58ccd0', // Reflected water
        GARBAGE: '#465c60', // Wet slate against the dark board
    },

    renderMode: 'glow',

    effects: {
        // Soft water-like glow
        glowRadius: 6,
        glowIntensity: 0.42,
        glowColor: 'auto',

        // Subtle water ripple outline
        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',

        // Gentle floating pulse
        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.07,

        // Water shimmer effect
        shimmer: true,
        shimmerSpeed: 0.045,
        shimmerIntensity: 0.18,

        // Soft movement trails
        trails: true,
        trailLength: 0.16,
        trailOpacity: 0.32,

        // Inner reflection glow
        innerGlow: true,
        innerGlowRadius: 3,
        innerGlowIntensity: 0.5,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 5,
            glowIntensity: 0.38,
            outlineWidth: 1.5,
            pulseAmplitude: 0.06,
        },
        phaser: {
            highlight: 0.19,
            shadow: 0.26,
            rimAlpha: 0.48,
            rimWidthFactor: 0.04,
            glossAlpha: 0.16,
        },
    },
};
