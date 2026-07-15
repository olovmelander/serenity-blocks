/**
 * Shifting Sands Theme - Tetromino Visual Configuration
 *
 * A magical desert night palette featuring:
 * - Warm lantern glows and firefly lights
 * - Cool moonlit blues and purples
 * - Sandy gold and amber tones
 * - Oasis water reflections
 */

export const SHIFTING_SANDS_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffd06a', // Lantern gold - warm amber glow
        O: '#c9a0ff', // Twilight purple - desert dusk
        T: '#7fffb8', // Desert mint - cool oasis green
        S: '#ff9070', // Sunset coral - warm horizon
        Z: '#8090ff', // Night sky indigo - deep blue
        J: '#ffb855', // Firefly amber - glowing orange
        L: '#7ec8ff', // Moonlit oasis - soft blue water
        GARBAGE: '#1a1528', // Desert shadow - deep night
    },

    renderMode: 'glow',

    effects: {
        // Warm mystical glow
        glowRadius: 11,
        glowIntensity: 0.72,
        glowColor: 'auto',

        // Soft sand-colored outline
        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',

        // Gentle firefly pulse
        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.24,

        // Moonlight shimmer
        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.22,

        // Desert wind trails
        trails: true,
        trailLength: 0.18,
        trailOpacity: 0.35,

        // Inner oasis glow
        innerGlow: true,
        innerGlowRadius: 3.5,
        innerGlowIntensity: 0.45,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 9,
            glowIntensity: 0.68,
            outlineWidth: 1.5,
            pulseAmplitude: 0.2,
        },
        phaser: {
            glowRadius: 13,
            glowIntensity: 0.78,
            outlineWidth: 2.0,
            pulseAmplitude: 0.28,
        },
    },
};
