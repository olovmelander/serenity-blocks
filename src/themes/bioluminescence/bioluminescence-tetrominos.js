/**
 * Bioluminescence Theme - Tetromino Visual Configuration
 *
 * Seven living lights, one per piece, each a colour something in the dark really makes: the
 * cyan of sea-sparkle, foxfire's lime, an orchid jelly, mint fungus, a pink anemone, the blue
 * of the deep and the amber of a spore. A locking piece gives its colour to a mushroom in the
 * grotto, so the seven have to read apart at a glance.
 */

export const BIOLUMINESCENCE_TETROMINOS = {
    version: 2,

    // Which piece wears which light is this theme's own: no shape keeps the hue it has in the
    // familiar arrangement (scripts/palette-guideline-check.mjs screens for that).
    colors: {
        I: '#ffc75a', // Amber spore
        O: '#b48cff', // Orchid jelly violet
        T: '#3df5ff', // Sea-sparkle cyan
        S: '#ff6fb5', // Anemone pink
        Z: '#3dffa8', // Mint fungus
        J: '#b8ff5a', // Foxfire lime
        L: '#4d9bff', // Abyss blue
        GARBAGE: '#1c3a38', // Wet stone
    },

    // Glowing render mode (signature bioluminescence effect)
    renderMode: 'glow',

    effects: {
        // Soft glowing aura around each block
        glowRadius: 9,
        glowIntensity: 0.65,
        glowColor: 'auto', // Use piece color for glow

        // Brighter outline for definition
        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',

        // Slow pulse, like something breathing
        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.16,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.14,
    },

    // Renderer-specific tweaks
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
