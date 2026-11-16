/**
 * Wolfhour — the pieces wear the valley's own colours, one each: the moon's silver, the northern
 * lights' green, the ember of the hut's fire, the violet of dusk, the blue of ice, the rose of the
 * alpenglow and the blue-grey of granite in shade. None sits in the hue a falling-block game
 * usually gives its shape, and every pair stays apart (CIELAB ΔE > 16) to full, protan, deutan and
 * tritan sight (tests/unit/wolfhour-night.test.js): the seven silvers they replace were within
 * ΔE 5 of one another.
 */

export const WOLFHOUR_TETROMINOS = {
    version: 1,

    colors: {
        I: '#F1F5FC', // moon silver
        O: '#2DA084', // northern lights
        T: '#DF8D38', // the hut's ember
        S: '#8A70EA', // dusk violet
        Z: '#84C8F9', // ice
        J: '#F3A9C1', // alpenglow
        L: '#46608F', // granite in shade
        GARBAGE: '#222a38', // rock under the snow
    },

    renderMode: 'glow',

    effects: {
        glowRadius: 18,
        glowIntensity: 0.95,
        glowColor: 'auto',

        outline: true,
        outlineWidth: 2,
        outlineColor: '#e8f0f8', // Silver starlight outline

        // Cosmic pulsing like twinkling stars
        pulse: true,
        pulseSpeed: 0.042, // Medium mystical breathing
        pulseAmplitude: 0.35, // Strong variation like star twinkle

        // Cosmic shimmer like nebula energy
        shimmer: true,
        shimmerSpeed: 0.068,
        shimmerIntensity: 0.28,

        // Shooting star trails
        trails: true,
        trailLength: 0.32,
        trailOpacity: 0.42,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 15,
            glowIntensity: 0.88,
            outlineWidth: 1.8,
        },
        phaser: {
            glowRadius: 20,
            glowIntensity: 0.98,
            outlineWidth: 2.2,
        },
    },
};
