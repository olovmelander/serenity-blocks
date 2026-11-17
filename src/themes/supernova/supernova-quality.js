/**
 * Supernova — content tiers. Every tier keeps the whole picture and every event.
 *
 * shells       standing shells of the nebula (each is two crossings per view ray it meets)
 * nebulaDetail noise reads per crossing (1 draws the threads from the coarse read; 2 adds the fine
 *              threads; 3 adds the finest on shells large enough on screen to show them)
 * starDetail   surface reads on the photosphere (3 adds the finest granules and the flowing corona)
 * spikes       the lens's six spikes round the star
 * embers       motes in the star's wind
 * sparks       ejecta pool (a lock's spray, a shock's debris, a detonation's knots)
 * loops        prominences that can stand on the star at once
 * skyLayers    lattices of faint stars on the dome
 * skyClouds    lit clouds on the dome (two reads), which also carry a detonation's echo and shape
 *              the band of far suns (without them the band is a plain river of points)
 * skyDeep      1 adds the bright stars with a lens's four rays; 2 adds the far galaxies
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        shells: 2,
        nebulaDetail: 1,
        starDetail: 2,
        spikes: false,
        embers: 260,
        sparks: 160,
        loops: 4,
        skyLayers: 1,
        skyClouds: false,
        skyDeep: 0,
    }),
    Low: Object.freeze({
        shells: 3,
        nebulaDetail: 1,
        starDetail: 2,
        spikes: true,
        embers: 520,
        sparks: 280,
        loops: 6,
        skyLayers: 2,
        skyClouds: true,
        skyDeep: 1,
    }),
    Medium: Object.freeze({
        shells: 3,
        nebulaDetail: 2,
        starDetail: 3,
        spikes: true,
        embers: 1000,
        sparks: 480,
        loops: 8,
        skyLayers: 2,
        skyClouds: true,
        skyDeep: 1,
    }),
    High: Object.freeze({
        shells: 4,
        nebulaDetail: 2,
        starDetail: 3,
        spikes: true,
        embers: 1800,
        sparks: 800,
        loops: 10,
        skyLayers: 3,
        skyClouds: true,
        skyDeep: 2,
    }),
    Ultra: Object.freeze({
        shells: 5,
        nebulaDetail: 3,
        starDetail: 3,
        spikes: true,
        embers: 2800,
        sparks: 1200,
        loops: 10,
        skyLayers: 3,
        skyClouds: true,
        skyDeep: 2,
    }),
    Extreme: Object.freeze({
        shells: 5,
        nebulaDetail: 3,
        starDetail: 3,
        spikes: true,
        embers: 4200,
        sparks: 1700,
        loops: 10,
        skyLayers: 3,
        skyClouds: true,
        skyDeep: 2,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
