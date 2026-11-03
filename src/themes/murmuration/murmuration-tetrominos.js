/**
 * Murmuration Theme - Tetromino Visual Configuration
 *
 * The swarm's own colours (composition/swarm-palette.js: violet, electric blue, cyan, mint,
 * magenta, rose) and the gold of its fire, lifted to glow over the night nebula. No piece wears
 * its familiar hue (0/7 on scripts/palette-guideline-check.mjs).
 */

export const MURMURATION_TETROMINOS = {
    version: 1,

    colors: {
        I: '#9b6dff', // Swarm violet
        O: '#4ad9ff', // Swarm cyan
        T: '#5cffc6', // Swarm mint
        S: '#ff6f8f', // Swarm rose
        Z: '#ffb347', // Fire gold
        J: '#ff5bd6', // Swarm magenta
        L: '#5a86ff', // Electric blue
        GARBAGE: '#0b0820', // Night between the motes
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 9,
        glowIntensity: 0.65,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.4,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.18,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.14,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 7,
            glowIntensity: 0.6,
            outlineWidth: 1.3,
        },
        phaser: {
            glowRadius: 11,
            glowIntensity: 0.7,
            outlineWidth: 1.7,
        },
    },
};
