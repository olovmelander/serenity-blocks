/**
 * Summer "Midsommar Solstice" Theme — Tetromino Visual Configuration
 *
 * Golden-hour split-complementary palette: warm sunset accents (golden, peach, Falu
 * red) against calming layered greens and lake-blues — the same harmony as the
 * environment (sky #85B9D1 · peach #F8A898 · golden #FCD581 · pine #2A4B38 ·
 * canopy #4A7C59 · grass #97AD43 · Falu #A23629 · lake #5B92A8).
 */

export const SUMMER_TETROMINOS = {
    version: 1,

    colors: {
        I: '#5B92A8', // lake blue (teal)
        O: '#FCD581', // golden yellow
        T: '#F8A898', // sunset peach
        S: '#97AD43', // sunlit grass
        Z: '#A23629', // Falu red accent
        J: '#85B9D1', // soft sky blue
        L: '#4A7C59', // midtone canopy green
        GARBAGE: '#2A4B38', // deep pine — foundation / shadowed blocks
        CLEAN_GARBAGE: '#6F8A70',
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 11,
        glowIntensity: 0.7,
        glowColor: '#FCD581', // golden-hour glow

        outline: true,
        outlineWidth: 1.6,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.032,
        pulseAmplitude: 0.18,

        shimmer: true,
        shimmerSpeed: 0.045,
        shimmerIntensity: 0.16,

        trails: true,
        trailLength: 0.16,
        trailOpacity: 0.3,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 8,
            glowIntensity: 0.6,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 13,
            glowIntensity: 0.78,
            outlineWidth: 1.9,
        },
    },
};
