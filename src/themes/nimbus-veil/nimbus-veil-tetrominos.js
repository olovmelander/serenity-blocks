/**
 * Nimbus Veil — the pieces: the colours of the light over the cloud sea.
 *
 * Seven lights a day above the clouds passes through, each a hue of its own so two pieces are
 * never told apart by shade alone: the sun's gold, the ember of its last light, the rose of the
 * evening deck, the violet of the towers' shade, the blue of the high noon sky, the sea-green in
 * a corona's mother-of-pearl, and the pearl of a crown the sun has just reached. They are luminous and a
 * little soft, like light on cloud, and they read against the dark board at a glance. None sits
 * in the hue band a falling-block game usually gives its shape
 * (scripts/palette-guideline-check.mjs screens 0 of 7).
 *
 * Neighbouring hues stand 30 degrees or more apart (gold 42, ember 10, rose 335, violet 262,
 * sky 212, ice 172, pearl nearly white) and differ in lightness as well.
 */

export const NIMBUS_VEIL_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffcf6b', // sun gold
        O: '#6fb2ff', // noon sky
        T: '#ff7d66', // ember
        S: '#a98bff', // tower shade violet
        Z: '#5fd9c4', // corona green
        J: '#ff86b8', // evening rose
        L: '#f3efff', // crown pearl
        GARBAGE: '#46486a', // deck shade
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 10,
        glowIntensity: 0.7,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 1.6,
        outlineColor: 'lighten',

        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.14,

        shimmer: true,
        shimmerSpeed: 0.04,
        shimmerIntensity: 0.15,

        trails: true,
        trailLength: 0.12,
        trailOpacity: 0.25,
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
            outlineWidth: 1.8,
        },
    },
};
