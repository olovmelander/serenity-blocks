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
        glowRadius: 3,
        glowIntensity: 0.95,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1,
        outlineColor: 'lighten',
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 2,
        },
        phaser: {
            // The board lights one continuous silhouette. A narrow silver rim separates
            // neighbours in the stack while the shaded faces retain their piece colours.
            highlight: 0.22,
            shadow: 0.27,
            rimAlpha: 0.48,
            rimWidthFactor: 0.045,
            glossAlpha: 0.16,
        },
    },
};
