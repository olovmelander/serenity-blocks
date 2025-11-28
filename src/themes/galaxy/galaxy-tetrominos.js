/**
 * Galaxy Theme - Tetromino Visual Configuration
 *
 * Electric magentas, ultraviolet blues, and comet golds that mirror the
 * rotating nebula layers and bright starlight streaking through the scene.
 */

export const GALAXY_TETROMINOS = {
    version: 1,

    colors: {
        I: '#4fcfff', // Ion trail cyan
        O: '#ffe26b', // Star core gold
        T: '#c46bff', // Nebula violet
        S: '#5bffd5', // Aurora teal
        Z: '#ff5ed1', // Solar flare magenta
        J: '#5256ff', // Deep midnight indigo
        L: '#ff9c6b', // Comet ember
        GARBAGE: '#050015', // Interstellar void
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 15,
        glowIntensity: 0.9,
        glowColor: '#7ed2ff',

        outline: true,
        outlineWidth: 2.1,
        outlineColor: '#070014',

        pulse: true,
        pulseSpeed: 0.04,
        pulseAmplitude: 0.32,

        shimmer: true,
        shimmerSpeed: 0.09,
        shimmerIntensity: 0.27,

        trails: true,
        trailLength: 0.28,
        trailOpacity: 0.4,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 12,
            glowIntensity: 0.82,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 17,
            glowIntensity: 0.95,
            outlineWidth: 2.4,
        },
    },
};
