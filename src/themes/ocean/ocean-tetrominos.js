/**
 * Ocean reef palette.
 *
 * Seven colours off the reef, dealt to the pieces so that none wears the colour a falling-block
 * player expects of its shape. Piece identity comes from hue/value separation and a restrained
 * fused-shape gradient/rim/gloss treatment. It does not depend on glow, pulse, shimmer, or
 * trails, which keeps active, ghost, hold, next, Canvas preview/opponent-watch, and multiplayer
 * surfaces readable. The production Phaser 4 board itself is WebGL-only; there is no Phaser
 * Canvas board fallback to configure.
 *
 * The world takes each piece's colour for the light it lays on the reef (a ring, and the colony
 * that holds it until a clear lets it go).
 */

export const OCEAN_TETROMINOS = {
    version: 2,

    colors: {
        I: '#FFD166', // Butterflyfish gold
        O: '#39D9E8', // Lagoon cyan
        T: '#4FD68B', // Seagrass emerald
        S: '#B58CFF', // Sea-fan violet
        Z: '#4C8DFF', // Damselfish blue
        J: '#FF9550', // Clownfish orange
        L: '#FF6B81', // Coral rose
        GARBAGE: '#1C2B36', // Basalt
        CLEAN_GARBAGE: '#94B9C6', // Sea glass
    },

    renderMode: 'solid',

    effects: {
        premium: true,
        phaser: {
            gradient: true,
            highlight: 0.2,
            shadow: 0.22,
            rim: true,
            rimAlpha: 0.46,
            rimWidthFactor: 0.05,
            gloss: true,
            glossAlpha: 0.16,
        },
    },

    rendererOverrides: {},
};
