/**
 * Aether Tides Theme - Tetromino Visual Configuration
 *
 * Nebula palette: starlight amber, coral, aqua and violet gas, sea green and deep tidal blue.
 * These are also the colours a locking piece pours into the nebula and lights its star in
 * (aether-tides-director.js resolves a piece's colour from this table).
 */

export const AETHER_TIDES_TETROMINOS = {
    version: 1,

    colors: {
        I: '#F5C542', // Amber Star
        J: '#FF7A3C', // Coral Tide
        L: '#2CE0FF', // Aqua Current
        O: '#8A5CFF', // Nebula Violet
        S: '#FF4D6D', // Crimson Drift
        T: '#3CE68C', // Sea Green
        Z: '#3A7BFF', // Deep Blue
        GARBAGE: '#232842', // Deep Indigo Dust
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 9,
        glowIntensity: 0.65,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.6,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.18,

        shimmer: true,
        shimmerSpeed: 0.05,
        shimmerIntensity: 0.15,

        trails: true,
        trailLength: 0.12,
        trailOpacity: 0.25,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 7,
            glowIntensity: 0.6,
            outlineWidth: 1.4,
        },
        phaser: {
            glowRadius: 11,
            glowIntensity: 0.7,
            outlineWidth: 1.8,
        },
    },
};
