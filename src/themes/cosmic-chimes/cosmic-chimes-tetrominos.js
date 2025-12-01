/**
 * Cosmic Chimes Theme - Tetromino Visual Configuration
 *
 * An ethereal palette inspired by:
 * - Crystalline wind chimes catching starlight
 * - Soft auroras dancing across the void
 * - Cosmic dust clouds in pastel nebulae
 * - The gentle glow of celestial bells
 */

export const COSMIC_CHIMES_TETROMINOS = {
    version: 1,

    colors: {
        I: '#8fffff', // Crystal cyan - bright chime reflection
        O: '#ffd666', // Bell gold - warm resonant glow
        T: '#c9a8ff', // Lavender chime - soft ethereal purple
        S: '#6fffc4', // Mint aurora - fresh cosmic green
        Z: '#ff8fc8', // Rose nebula - gentle pink
        J: '#6b7fff', // Deep indigo - twilight depth
        L: '#ffcc6b', // Warm glow - amber light
        GARBAGE: '#0d1520', // Void shadow - deep space
    },

    renderMode: 'glow',

    effects: {
        // Soft ethereal glow
        glowRadius: 11,
        glowIntensity: 0.7,
        glowColor: 'auto',

        // Gentle chime outline
        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',

        // Harmonic pulse
        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.25,

        // Starlight shimmer
        shimmer: true,
        shimmerSpeed: 0.045,
        shimmerIntensity: 0.2,

        // Gentle movement trails
        trails: true,
        trailLength: 0.16,
        trailOpacity: 0.3,

        // Inner glow for depth
        innerGlow: true,
        innerGlowRadius: 3,
        innerGlowIntensity: 0.5,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 9,
            glowIntensity: 0.65,
            outlineWidth: 1.5,
            pulseAmplitude: 0.2,
        },
        phaser: {
            glowRadius: 13,
            glowIntensity: 0.75,
            outlineWidth: 2.0,
            pulseAmplitude: 0.28,
        },
    },
};
