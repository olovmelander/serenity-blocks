/**
 * Pyrestorm Theme - Tetromino Visual Configuration
 *
 * Super-heated magma palette filled with lava oranges, ember reds,
 * and volcanic yellows so the pieces feel forged inside the volcanoes.
 */

export const PYRESTORM_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ff6b1a',  // Lava orange beam
        O: '#ffd200',  // Molten core yellow
        T: '#ff3b00',  // Super-heated magma red
        S: '#ffb347',  // Ember amber
        Z: '#ff0048',  // Volcanic plasma pink-red
        J: '#94211a',  // Charred obsidian edge
        L: '#ff8c00',  // Flame orange
        GARBAGE: '#1a0b06', // Basalt ash
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 14,
        glowIntensity: 0.9,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2.2,
        outlineColor: 'darken',

        pulse: true,
        pulseSpeed: 0.05,
        pulseAmplitude: 0.3,

        shimmer: true,
        shimmerSpeed: 0.08,
        shimmerIntensity: 0.2,

        trails: true,
        trailLength: 0.18,
        trailOpacity: 0.35,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 12,
            glowIntensity: 0.85,
            outlineWidth: 2,
        },
        phaser: {
            glowRadius: 16,
            glowIntensity: 1.0,
            outlineWidth: 2.5,
        },
    },
};
