/**
 * Halcyon Apex — content tiers. Every tier keeps the whole picture and every event.
 *
 * reflection   planar reflector resolution scale for the lagoon (0 = mirror the sky function)
 * shadowMap    the sun's shadow map (0 = none: the sanctuary is lit as if the sun reached it all)
 * shadowEvery  frames between redraws of that map (the crystals drift; 0 = drawn once)
 * decks        cloud decks (0..2); `litClouds` = a deck is lit from the sun's side (one more fetch)
 * shimmer      the lagoon's light rippling on the lowest walls
 * glitter      the sun's sparkle on the water
 * bedDetail    ripple marks and sea grass on the bed
 * dispersion   the sun's refracted image splits per colour channel inside the crystals
 * beads        drops of the lagoon a chain of clears lifts into the air
 * motes        dust in the sunlight
 * upfall       drops in the water that rises into the Halcyon
 * sparks       spark / spray pool
 * birds        the flock over the lagoon
 * ranges       how finely the far ranges are cut (segments per ridge)
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        reflection: 0,
        shadowMap: 0,
        shadowEvery: 0,
        decks: 1,
        litClouds: false,
        shimmer: false,
        glitter: false,
        bedDetail: false,
        dispersion: false,
        beads: 90,
        motes: 0,
        upfall: 60,
        sparks: 96,
        birds: 0,
        ranges: 40,
    }),
    Low: Object.freeze({
        reflection: 0,
        shadowMap: 1024,
        shadowEvery: 0,
        decks: 2,
        litClouds: true,
        shimmer: true,
        glitter: true,
        bedDetail: true,
        dispersion: false,
        beads: 180,
        motes: 120,
        upfall: 110,
        sparks: 160,
        birds: 7,
        ranges: 56,
    }),
    Medium: Object.freeze({
        reflection: 0.4,
        shadowMap: 2048,
        shadowEvery: 4,
        decks: 2,
        litClouds: true,
        shimmer: true,
        glitter: true,
        bedDetail: true,
        dispersion: true,
        beads: 360,
        motes: 260,
        upfall: 180,
        sparks: 320,
        birds: 11,
        ranges: 72,
    }),
    High: Object.freeze({
        reflection: 0.5,
        shadowMap: 2048,
        shadowEvery: 2,
        decks: 2,
        litClouds: true,
        shimmer: true,
        glitter: true,
        bedDetail: true,
        dispersion: true,
        beads: 640,
        motes: 420,
        upfall: 260,
        sparks: 512,
        birds: 15,
        ranges: 96,
    }),
    Ultra: Object.freeze({
        reflection: 0.62,
        shadowMap: 4096,
        shadowEvery: 1,
        decks: 2,
        litClouds: true,
        shimmer: true,
        glitter: true,
        bedDetail: true,
        dispersion: true,
        beads: 960,
        motes: 640,
        upfall: 360,
        sparks: 768,
        birds: 19,
        ranges: 128,
    }),
    Extreme: Object.freeze({
        reflection: 0.75,
        shadowMap: 4096,
        shadowEvery: 1,
        decks: 2,
        litClouds: true,
        shimmer: true,
        glitter: true,
        bedDetail: true,
        dispersion: true,
        beads: 1400,
        motes: 900,
        upfall: 480,
        sparks: 1024,
        birds: 23,
        ranges: 160,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
