/**
 * Synthwave Sunset piece palette.
 *
 * The seaside's own lights: the warm gold of the pier's bulbs, the tangerine of the setting sun,
 * the flamingo pink and mint of the wheel's neon and cabins, a deep coral, the sky blue of the
 * deco hotels' windows and the lilac of the dusk. The lights are dealt to the pieces in the pier's
 * own order: no piece wears the colour its shape usually has (the palette gate reads 0/7, with its
 * bands widened too). Identity comes from hue and value separation, checked under protanopia,
 * deuteranopia and tritanopia simulation: the closest pair is gold against tangerine under
 * deuteranopia, ΔE 14.8 with 13 points of lightness between them.
 * The cells read as glossy enamel tiles, with no glow, pulse, shimmer or trails, so active, ghost,
 * hold, next and multiplayer previews stay crisp.
 */

export const SYNTHWAVE_SUNSET_TETROMINOS = {
    version: 2,

    colors: {
        I: '#FFD36E', // Bulb Gold: the pier's railing strings
        O: '#4FB4FF', // Sky Blue: the hotels' cool windows
        T: '#FF9440', // Tangerine: the sun on the sea
        S: '#F24FAE', // Flamingo: the wheel's neon ring
        Z: '#6CF5C9', // Mint: the coaster's lights and the cabins
        J: '#D92B4A', // Deep Coral: the dome stripes at dusk
        L: '#8A55F5', // Dusk Lilac: the sky over the bay
        GARBAGE: '#2A2238', // Wet sand at nightfall
        CLEAN_GARBAGE: '#E8D6CA', // Pastel stucco
    },

    renderMode: 'solid',

    effects: {
        premium: true,
        phaser: {
            gradient: true,
            highlight: 0.16,
            shadow: 0.2,
            rim: true,
            rimAlpha: 0.4,
            rimWidthFactor: 0.05,
            gloss: true,
            glossAlpha: 0.14,
        },
    },

    rendererOverrides: {},
};
