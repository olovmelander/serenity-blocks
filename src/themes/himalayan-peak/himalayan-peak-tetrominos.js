/**
 * Himalayan Peak Theme - Tetromino Visual Configuration
 *
 * Inspired by prayer flags, snow-capped peaks, and the mystical high-altitude atmosphere.
 * Colors drawn from traditional Tibetan prayer flags and the majestic Himalayan landscape.
 */

export const HIMALAYAN_PEAK_TETROMINOS = {
    version: 1,

    colors: {
        I: '#f0f5ff', // Snow cap white - pristine peak snow
        O: '#9c88ff', // Prayer flag purple - spiritual wisdom
        T: '#4cd137', // Prayer flag green - nature and harmony
        S: '#e84118', // Prayer flag red - life force and bravery
        Z: '#5a7090', // Deep mountain gray - shadowed peaks
        J: '#fbc531', // Prayer flag yellow - earth and enlightenment
        L: '#00a8ff', // Prayer flag blue - sky and space
        GARBAGE: '#3c465a', // Mountain shadow - deep rocky depths
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 11,
        glowIntensity: 0.75,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2.0,
        outlineColor: 'rgba(240, 245, 255, 0.4)', // Subtle icy outline like snow

        // Pulse like prayer flags waving in high-altitude winds
        pulse: true,
        pulseSpeed: 0.04, // Gentle, rhythmic movement
        pulseAmplitude: 0.22, // Noticeable wave

        // Shimmer like thin air and mystical atmosphere
        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.2,

        // Trails like prayer flags leaving spiritual traces
        trails: true,
        trailLength: 0.15,
        trailOpacity: 0.3,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 9,
            glowIntensity: 0.7,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 13,
            glowIntensity: 0.8,
            outlineWidth: 2.2,
        },
    },
};
