/**
 * Galaxy — content tiers. Every tier keeps the whole picture and every event.
 *
 * stars        suns drawn in the disc, the bulge and the halo (the plan mixes its four
 *              populations evenly, so a tier takes the first N and still has all of them)
 * march        steps through the gas slab per pixel (1 = the thin-disc solution: one sample on
 *              the midplane, no depth in the dust)
 * detail       noise reads per pixel (2 on every tier: without the fine grain the knots and the
 *              threads of dust smear along the arms; kept as a lever)
 * nurseries    star-forming knots along the arms (the board's instrument)
 * sparks       nova debris pool
 * meteors      shooting-star pool
 * giants       foreground stars with diffraction spikes
 * skyLayers    lattices of faint stars on the dome
 * skyNebula    lit clouds on the dome (two fetches)
 * deepField    the far galaxies sprinkled over the dome
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        stars: 12000,
        march: 1,
        detail: 2,
        nurseries: 40,
        sparks: 128,
        meteors: 6,
        giants: 20,
        skyLayers: 1,
        skyNebula: false,
        deepField: false,
    }),
    Low: Object.freeze({
        stars: 24000,
        march: 1,
        detail: 2,
        nurseries: 56,
        sparks: 224,
        meteors: 8,
        giants: 36,
        skyLayers: 2,
        skyNebula: true,
        deepField: false,
    }),
    Medium: Object.freeze({
        stars: 46000,
        march: 6,
        detail: 2,
        nurseries: 72,
        sparks: 384,
        meteors: 12,
        giants: 56,
        skyLayers: 2,
        skyNebula: true,
        deepField: true,
    }),
    High: Object.freeze({
        stars: 84000,
        march: 10,
        detail: 2,
        nurseries: 96,
        sparks: 640,
        meteors: 16,
        giants: 80,
        skyLayers: 3,
        skyNebula: true,
        deepField: true,
    }),
    Ultra: Object.freeze({
        stars: 130000,
        march: 14,
        detail: 2,
        nurseries: 120,
        sparks: 900,
        meteors: 24,
        giants: 110,
        skyLayers: 3,
        skyNebula: true,
        deepField: true,
    }),
    Extreme: Object.freeze({
        stars: 190000,
        march: 20,
        detail: 2,
        nurseries: 144,
        sparks: 1200,
        meteors: 32,
        giants: 140,
        skyLayers: 3,
        skyNebula: true,
        deepField: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
