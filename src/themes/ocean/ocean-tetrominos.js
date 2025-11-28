/**
 * Ocean Theme - Tetromino Visual Configuration
 *
 * Inspired by the vibrant underwater world: bioluminescent creatures,
 * coral reefs, tropical fish, and the mesmerizing play of light through water.
 */

export const OCEAN_TETROMINOS = {
    version: 1,

    colors: {
        I: '#00e5ff', // Bioluminescent cyan - glowing plankton and jellyfish
        O: '#ff6b35', // Vibrant coral orange - living coral reefs
        T: '#a855f7', // Jellyfish purple - majestic bell jellies
        S: '#10b981', // Tropical sea green - vibrant reef fish
        Z: '#0284c7', // Deep ocean blue - mysterious depths
        J: '#fbbf24', // Golden treasure - sunken gold and yellow tang fish
        L: '#14b8a6', // Teal aqua - clear tropical waters
        GARBAGE: '#0f172a', // Abyssal shadow - deepest ocean trenches
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 14,
        glowIntensity: 0.85,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2.2,
        outlineColor: 'rgba(0, 229, 255, 0.3)', // Cyan underwater glow

        // Pulse like bioluminescent creatures breathing
        pulse: true,
        pulseSpeed: 0.045, // Rhythmic underwater pulsing
        pulseAmplitude: 0.25, // Strong bioluminescent effect

        // Shimmer like light refracting through water
        shimmer: true,
        shimmerSpeed: 0.06,
        shimmerIntensity: 0.25,

        // Trails like light moving through water currents
        trails: true,
        trailLength: 0.18,
        trailOpacity: 0.35,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 12,
            glowIntensity: 0.8,
            outlineWidth: 2.0,
        },
        phaser: {
            glowRadius: 16,
            glowIntensity: 0.9,
            outlineWidth: 2.4,
        },
    },
};
