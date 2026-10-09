/**
 * Tornado — content tiers. Every tier keeps the whole picture and every event.
 *
 * shear       true: the cloud base winds round the funnel (two cross-faded phases of a sheared
 *             read); false: the deck turns as one piece
 * relief      a second read toward the sun, so the deck's lobes have a lit and a shaded side
 * detail      the fine octave of the deck and of the funnel's streaks
 * radial      the funnel's segments round and up (the mesh is a grid wrapped into a tube)
 * shells      1 = the body alone, 2 = body and the torn outer veil
 * wheat       stalks drawn round the lens
 * debris      boards and shingles in the air round the foot
 * motes       sparks per locked piece
 * poles       the power line's poles (nearest first)
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        shear: false,
        relief: false,
        detail: false,
        radial: [40, 48],
        shells: 1,
        wheat: 5000,
        debris: 180,
        motes: 16,
        poles: 5,
    }),
    Low: Object.freeze({
        shear: false,
        relief: false,
        detail: false,
        radial: [48, 64],
        shells: 1,
        wheat: 10000,
        debris: 320,
        motes: 24,
        poles: 6,
    }),
    Medium: Object.freeze({
        shear: true,
        relief: false,
        detail: true,
        radial: [64, 96],
        shells: 2,
        wheat: 24000,
        debris: 640,
        motes: 40,
        poles: 8,
    }),
    High: Object.freeze({
        shear: true,
        relief: true,
        detail: true,
        radial: [96, 128],
        shells: 2,
        wheat: 48000,
        debris: 1100,
        motes: 60,
        poles: 9,
    }),
    Ultra: Object.freeze({
        shear: true,
        relief: true,
        detail: true,
        radial: [112, 160],
        shells: 2,
        wheat: 66000,
        debris: 1500,
        motes: 72,
        poles: 9,
    }),
    Extreme: Object.freeze({
        shear: true,
        relief: true,
        detail: true,
        radial: [128, 192],
        shells: 2,
        wheat: 90000,
        debris: 2000,
        motes: 84,
        poles: 9,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
