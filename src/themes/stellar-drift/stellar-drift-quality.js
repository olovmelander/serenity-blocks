/**
 * Stellar Drift — content tiers. Every tier keeps the whole picture and every event.
 *
 * fbmSize / fbmOctaves  the baked cloud texture (the giant's weather and the nebula read it)
 * ringSize       texels of the rings' radial profile
 * cloudDetail    0 = one read of the cloud along the wind (it shears and is wound back by the
 *                clock's own cycle), 1 = two reads cross-faded, 2 = and the fine field on top
 * storms         ovals the cloud lookup is twisted round
 * nebulaDetail   the nebula's fine field (one more fetch per sky pixel)
 * starLayers     lattices of far stars
 * ice            the drifting ice: [boulders, shards, motes]
 * sparks         the pool a lock's splash and a meteor's burst throw from
 * moonSize       width of the icy moon's baked map (the rust world's is always 512)
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        fbmSize: 256,
        fbmOctaves: 5,
        ringSize: 1024,
        cloudDetail: 0,
        storms: 3,
        nebulaDetail: 0,
        starLayers: 2,
        ice: Object.freeze([2, 24, 400]),
        sparks: 160,
        moonSize: 512,
    }),
    Low: Object.freeze({
        fbmSize: 256,
        fbmOctaves: 5,
        ringSize: 1024,
        cloudDetail: 1,
        storms: 4,
        nebulaDetail: 0,
        starLayers: 2,
        ice: Object.freeze([3, 40, 700]),
        sparks: 260,
        moonSize: 512,
    }),
    Medium: Object.freeze({
        fbmSize: 512,
        fbmOctaves: 6,
        ringSize: 2048,
        cloudDetail: 2,
        storms: 6,
        nebulaDetail: 1,
        starLayers: 3,
        ice: Object.freeze([4, 70, 1300]),
        sparks: 420,
        moonSize: 1024,
    }),
    High: Object.freeze({
        fbmSize: 512,
        fbmOctaves: 6,
        ringSize: 2048,
        cloudDetail: 2,
        storms: 8,
        nebulaDetail: 1,
        starLayers: 3,
        ice: Object.freeze([6, 110, 2200]),
        sparks: 700,
        moonSize: 1024,
    }),
    Ultra: Object.freeze({
        fbmSize: 512,
        fbmOctaves: 6,
        ringSize: 2048,
        cloudDetail: 2,
        storms: 8,
        nebulaDetail: 1,
        starLayers: 3,
        ice: Object.freeze([8, 150, 3200]),
        sparks: 1000,
        moonSize: 1024,
    }),
    Extreme: Object.freeze({
        fbmSize: 512,
        fbmOctaves: 6,
        ringSize: 2048,
        cloudDetail: 2,
        storms: 8,
        nebulaDetail: 1,
        starLayers: 3,
        ice: Object.freeze([10, 200, 4600]),
        sparks: 1400,
        moonSize: 1024,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
