/**
 * Sunset — content tiers. Every tier keeps the whole picture and every event.
 *
 * skyNoise     the sky's noise field (pixels across)       seaNoise   the water's
 * slices       slices the cloud deck is drawn in on the dome (its relief)
 * mirror       slices of the deck the sea mirrors (0: the sea mirrors the air and the glows only)
 * fine         the deck's torn edges                       cirrus     the high cloud
 * bars         the bars of cloud low over the sea          milky      the Milky Way
 * seaRings     rings of the sea's fan mesh                 seaSpokes  its spokes
 * ripples      ripple layers read from the noise (1..3)
 * lanterns     lanterns alive at once (on the water and in the air)
 * lit          lanterns the water mirrors and is lit by     rings     rings alive on the water
 * motes        lights in flight from the card to the sea   drops     the splash pool
 * birds        the largest flock a chain can call
 */
const tier = (values) => Object.freeze(values);

export const QUALITY = Object.freeze({
    Minimal: tier({
        skyNoise: 256,
        seaNoise: 128,
        slices: 2,
        mirror: 0,
        fine: false,
        cirrus: false,
        bars: true,
        milky: false,
        seaRings: 90,
        seaSpokes: 64,
        ripples: 1,
        lanterns: 24,
        lit: 4,
        rings: 4,
        motes: 6,
        drops: 160,
        birds: 9,
    }),
    Low: tier({
        skyNoise: 256,
        seaNoise: 256,
        slices: 3,
        mirror: 0,
        fine: false,
        cirrus: true,
        bars: true,
        milky: true,
        seaRings: 120,
        seaSpokes: 96,
        ripples: 2,
        lanterns: 32,
        lit: 6,
        rings: 5,
        motes: 8,
        drops: 260,
        birds: 13,
    }),
    Medium: tier({
        skyNoise: 512,
        seaNoise: 256,
        slices: 4,
        mirror: 1,
        fine: true,
        cirrus: true,
        bars: true,
        milky: true,
        seaRings: 160,
        seaSpokes: 128,
        ripples: 3,
        lanterns: 40,
        lit: 10,
        rings: 6,
        motes: 10,
        drops: 420,
        birds: 17,
    }),
    High: tier({
        skyNoise: 512,
        seaNoise: 512,
        slices: 5,
        mirror: 2,
        fine: true,
        cirrus: true,
        bars: true,
        milky: true,
        seaRings: 220,
        seaSpokes: 176,
        ripples: 3,
        lanterns: 48,
        lit: 14,
        rings: 8,
        motes: 12,
        drops: 640,
        birds: 23,
    }),
    Ultra: tier({
        skyNoise: 512,
        seaNoise: 512,
        slices: 6,
        mirror: 2,
        fine: true,
        cirrus: true,
        bars: true,
        milky: true,
        seaRings: 260,
        seaSpokes: 208,
        ripples: 3,
        lanterns: 56,
        lit: 18,
        rings: 8,
        motes: 14,
        drops: 820,
        birds: 29,
    }),
    Extreme: tier({
        skyNoise: 512,
        seaNoise: 512,
        slices: 7,
        mirror: 3,
        fine: true,
        cirrus: true,
        bars: true,
        milky: true,
        seaRings: 300,
        seaSpokes: 240,
        ripples: 3,
        lanterns: 64,
        lit: 22,
        rings: 8,
        motes: 16,
        drops: 1000,
        birds: 35,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return Object.prototype.hasOwnProperty.call(QUALITY, quality) ? QUALITY[quality] : QUALITY.High;
}
