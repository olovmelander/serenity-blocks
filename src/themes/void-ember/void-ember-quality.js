/**
 * Void Ember — content tiers. Every tier keeps the whole picture and every event.
 *
 * starDetail   noise reads per pixel of the photosphere beyond the first two (0..3): the warp
 *              that tears the plates, the plates' second field, the finest cells
 * coronaDetail noise reads per pixel of the corona beyond the first (0..2): the fine rays, the
 *              hair of the fringe
 * segments     tessellation of the star's sphere
 * wind         the ember wind's pool
 * sparks       the pool an impact or a torn-off loop throws from
 * rocks        the cinder belt: boulders, stones, gravel
 * ringDetail   noise reads per pixel of the belt's dust ring (1..3)
 * cracks       fire in the stones' cracks (one noise read per stone pixel)
 * skyLayers    lattices of far stars on the dome
 * dust         the void's cold dust (two fetches per sky pixel)
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        starDetail: 0,
        coronaDetail: 0,
        segments: 48,
        wind: 1400,
        sparks: 160,
        rocks: Object.freeze([10, 80, 380]),
        ringDetail: 1,
        cracks: false,
        skyLayers: 1,
        dust: true,
    }),
    Low: Object.freeze({
        starDetail: 1,
        coronaDetail: 0,
        segments: 64,
        wind: 2600,
        sparks: 260,
        rocks: Object.freeze([14, 140, 800]),
        ringDetail: 1,
        cracks: false,
        skyLayers: 2,
        dust: true,
    }),
    Medium: Object.freeze({
        starDetail: 2,
        coronaDetail: 1,
        segments: 80,
        wind: 5200,
        sparks: 420,
        rocks: Object.freeze([22, 240, 1500]),
        ringDetail: 2,
        cracks: true,
        skyLayers: 2,
        dust: true,
    }),
    High: Object.freeze({
        starDetail: 3,
        coronaDetail: 2,
        segments: 96,
        wind: 9000,
        sparks: 700,
        rocks: Object.freeze([30, 340, 2600]),
        ringDetail: 3,
        cracks: true,
        skyLayers: 3,
        dust: true,
    }),
    Ultra: Object.freeze({
        starDetail: 3,
        coronaDetail: 2,
        segments: 112,
        wind: 14000,
        sparks: 1000,
        rocks: Object.freeze([36, 460, 4000]),
        ringDetail: 3,
        cracks: true,
        skyLayers: 3,
        dust: true,
    }),
    Extreme: Object.freeze({
        starDetail: 3,
        coronaDetail: 2,
        segments: 128,
        wind: 22000,
        sparks: 1400,
        rocks: Object.freeze([44, 600, 6000]),
        ringDetail: 3,
        cracks: true,
        skyLayers: 3,
        dust: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
