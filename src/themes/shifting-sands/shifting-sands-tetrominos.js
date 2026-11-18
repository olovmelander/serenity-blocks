/**
 * Shifting Sands Theme - Tetromino Visual Configuration
 *
 * The colours of the twin-sun dusk, seven that stand apart on the board:
 * - the suns' gold, the ember's coral and the rose of the afterglow (three warm ones a long way
 *   apart in hue and in lightness, so I, S and J are never taken for one another)
 * - the violet of the upper sky, the indigo of the night and the pale blue of the moons
 * - one green: the mint of the glass the sand leaves where lightning strikes it
 */

export const SHIFTING_SANDS_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffd872', // The white sun's gold
        O: '#c9a0ff', // Upper-sky violet
        T: '#74f2bc', // Fulgurite mint
        S: '#ff7858', // The ember sun's coral
        Z: '#7a84ff', // Night indigo
        J: '#ff7cc0', // Afterglow rose
        L: '#66d2ff', // Moon blue
        GARBAGE: '#1a1528', // Dune shadow
    },

    renderMode: 'glow',

    effects: {
        // A warm glow
        glowRadius: 11,
        glowIntensity: 0.72,
        glowColor: 'auto',

        // Soft sand-colored outline
        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',

        // A slow pulse
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

        // Inner glow
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
