/**
 * Winter Theme - Tetromino Visual Configuration
 *
 * The fox fires' own colours on a ground of ice: the green of the aurora's foot, its violet
 * crown and rose hem, the moon's pale gold, and three kinds of ice. A locking piece leaves the
 * board as sparks of its colour and the sky holds that colour for a while, so the palette is
 * also what the night is painted with.
 */

export const WINTER_TETROMINOS = {
    version: 1,

    colors: {
        I: '#5df2a6', // Aurora green - the fires' foot
        O: '#eaf6ff', // Frost white - rime in moonlight
        T: '#6de0ff', // Ice cyan - wind-swept lake ice
        S: '#ff9ccf', // Rose - the hem of an energetic curtain
        Z: '#b79bff', // Violet - the aurora's crown
        J: '#ffe2a0', // Moon gold - the ring of ice-light
        L: '#4a9fd8', // Glacier blue - shadow on snow
        GARBAGE: '#16222e', // Deep night - the dark under the boughs
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 15,
        glowIntensity: 0.85,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: '#d4ecff', // Icy blue-white outline

        // Crystalline pulsing like frozen shimmer
        pulse: true,
        pulseSpeed: 0.032, // Slow, cold breathing
        pulseAmplitude: 0.25, // Noticeable shimmer

        // Ice crystal shimmer effect
        shimmer: true,
        shimmerSpeed: 0.055,
        shimmerIntensity: 0.22,

        // Frozen trails disabled for clean ice aesthetic
        trails: false,
        trailLength: 0,
        trailOpacity: 0,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 12,
            glowIntensity: 0.78,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 17,
            glowIntensity: 0.9,
            outlineWidth: 2.3,
        },
    },
};
