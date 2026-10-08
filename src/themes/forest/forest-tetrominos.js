/**
 * Forest Theme - Tetromino Visual Configuration
 *
 * A night palette for a deep blue, moonlit wood: the fireflies' own yellow-green, moss,
 * foxfire, wild rose, the indigo of the sky, the moon and the bark of the birches. Every
 * piece is a light colour, so all seven read against the dark card and the dark forest.
 */

export const FOREST_TETROMINOS = {
    version: 1,

    colors: {
        I: '#c9f25c', // Firefly chartreuse
        O: '#52b868', // Moss green
        T: '#38d9cf', // Foxfire teal
        S: '#f59ab9', // Wild rose
        Z: '#8084f5', // Twilight indigo
        J: '#f5edd3', // Moon ivory
        L: '#a3b8d4', // Birch silver
        GARBAGE: '#1a2433', // Night slate
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 10,
        glowIntensity: 0.7,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.7,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.04,
        pulseAmplitude: 0.22,

        shimmer: true,
        shimmerSpeed: 0.06,
        shimmerIntensity: 0.18,

        trails: true,
        trailLength: 0.16,
        trailOpacity: 0.3,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 8,
            glowIntensity: 0.65,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 12,
            glowIntensity: 0.75,
            outlineWidth: 1.9,
        },
    },
};
