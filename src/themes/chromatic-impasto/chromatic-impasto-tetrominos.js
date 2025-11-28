/**
 * Chromatic Impasto Tetrominos - Colors inspired by Bengt Lindström's "Kvinnan Alpha"
 * Bold, deeply saturated colors from the expressionist painting
 */

export const CHROMATIC_IMPASTO_TETROMINOS = {
    I: {
        shape: [
            [0, 0, 0, 0],
            [1, 1, 1, 1],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ],
        color: '#00D9CC', // Bright turquoise/cyan (vibrant from the painting)
        glowColor: '#00FFF5',
        trailColor: 'rgba(0, 217, 204, 0.6)',
    },
    J: {
        shape: [
            [1, 0, 0],
            [1, 1, 1],
            [0, 0, 0],
        ],
        color: '#0033CC', // Deep saturated blue
        glowColor: '#3366FF',
        trailColor: 'rgba(0, 51, 204, 0.6)',
    },
    L: {
        shape: [
            [0, 0, 1],
            [1, 1, 1],
            [0, 0, 0],
        ],
        color: '#FF7F00', // Pure saturated orange
        glowColor: '#FFB347',
        trailColor: 'rgba(255, 127, 0, 0.6)',
    },
    O: {
        shape: [
            [1, 1],
            [1, 1],
        ],
        color: '#FFD000', // Rich golden yellow
        glowColor: '#FFED4E',
        trailColor: 'rgba(255, 208, 0, 0.6)',
    },
    S: {
        shape: [
            [0, 1, 1],
            [1, 1, 0],
            [0, 0, 0],
        ],
        color: '#1A7F4D', // Deep forest green (almost black-green)
        glowColor: '#2D995F',
        trailColor: 'rgba(26, 127, 77, 0.6)',
    },
    T: {
        shape: [
            [0, 1, 0],
            [1, 1, 1],
            [0, 0, 0],
        ],
        color: '#B30000', // Deep blood red
        glowColor: '#E61919',
        trailColor: 'rgba(179, 0, 0, 0.6)',
    },
    Z: {
        shape: [
            [1, 1, 0],
            [0, 1, 1],
            [0, 0, 0],
        ],
        color: '#FFF8DC', // Warm cream white with slight yellow tint
        glowColor: '#FFFFFF',
        trailColor: 'rgba(255, 248, 220, 0.6)',
    },
};
