/**
 * Void Ember Theme - Tetromino Visual Configuration
 *
 * Every piece is an element thrown on the ember, and it burns in its flame-test colour:
 * - Magnesium white, the hottest flame there is
 * - Calcium vermilion and sodium amber, the ember's own fire
 * - Strontium crimson
 * - Potassium violet
 * - Copper teal
 * - The blue of something hotter than white
 * Garbage is what is left when a flame goes out: cold ash.
 */

export const VOID_EMBER_TETROMINOS = {
    version: 1,

    colors: {
        I: '#fff0c2', // Magnesium white - the hottest flame
        O: '#ff5a2e', // Calcium vermilion
        T: '#ffb23a', // Sodium amber
        S: '#ff2e63', // Strontium crimson
        Z: '#7c5cff', // Potassium violet
        J: '#35d6c9', // Copper teal
        L: '#5aa8ff', // Blue-hot
        GARBAGE: '#140b09', // Cold ash
    },

    renderMode: 'glow',

    effects: {
        // The warm halo of something burning
        glowRadius: 18,
        glowIntensity: 0.95,
        glowColor: '#ffb070',

        // A dark, warm edge for definition against the void
        outline: true,
        outlineWidth: 2.2,
        outlineColor: '#0a0403',

        // A slow pulse, like a coal breathing
        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.35,

        // The flicker of a flame
        shimmer: true,
        shimmerSpeed: 0.08,
        shimmerIntensity: 0.3,

        // Light trails for movement
        trails: true,
        trailLength: 0.32,
        trailOpacity: 0.45,

        // Inner glow for depth
        innerGlow: true,
        innerGlowRadius: 4,
        innerGlowIntensity: 0.6,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 14,
            glowIntensity: 0.88,
            outlineWidth: 1.9,
            pulseAmplitude: 0.28,
        },
        phaser: {
            glowRadius: 20,
            glowIntensity: 1.0,
            outlineWidth: 2.5,
            pulseAmplitude: 0.38,
        },
    },
};
