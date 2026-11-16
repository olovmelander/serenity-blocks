/**
 * Halcyon Apex Theme - Tetromino Visual Configuration
 *
 * Seven lights of the sanctuary, one hue each so no two pieces are mistaken for each other on
 * the board: the sun's gold, the lagoon's turquoise, the rose hour, the blue hour's violet, the
 * islets' green, the sandstone at first light and the clear morning's blue. (The world takes a
 * piece's colour for the light it sends up the ley lines, so a board of seven hues plays the
 * sanctuary in seven.)
 */

export const HALCYON_APEX_TETROMINOS = {
    version: 1,

    colors: {
        I: '#f4c95d',
        O: '#2fd9be',
        T: '#f08aa0',
        S: '#a98cf2',
        Z: '#8fcf5b',
        J: '#e0723f',
        L: '#4a8fe6',
        GARBAGE: '#5a5e68',
        CLEAN_GARBAGE: '#b3a98c',
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 10,
        glowIntensity: 0.68,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.7,
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
            glowRadius: 7,
            glowIntensity: 0.58,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 12,
            glowIntensity: 0.72,
            outlineWidth: 1.9,
        },
    },
};
