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
        I: '#ffc852', // Lantern gold - warm amber glow
        O: '#ffadd2', // Blossom pink - soft sakura
        T: '#7dffb8', // Lily pad green - fresh and bright
        S: '#ff7b52', // Koi orange - vivid scales
        Z: '#7b94ff', // Twilight indigo - evening reflection
        J: '#ffe48a', // Candle glow - soft warm light
        L: '#7eeeff', // Crystal pond cyan - clearer, more vibrant
        GARBAGE: '#0f1f1a', // Deep pond shadow
    },

    renderMode: 'glow',

    effects: {
        // Soft water-like glow
        glowRadius: 11,
        glowIntensity: 0.7,
        glowColor: 'auto',

        // Subtle water ripple outline
        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',

        // Gentle floating pulse
        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.22,

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
            glowRadius: 9,
            glowIntensity: 0.65,
            outlineWidth: 1.5,
            pulseAmplitude: 0.18,
        },
        phaser: {
            glowRadius: 13,
            glowIntensity: 0.75,
            outlineWidth: 2.0,
            pulseAmplitude: 0.25,
        },
    },
};
