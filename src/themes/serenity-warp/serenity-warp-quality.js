/**
 * Serenity Warp — content tiers. Every tier keeps the whole picture and every event.
 *
 * detail       the vortex's second, finer read of the gas (frays the arms' edges)
 * warpRead     the far gas is read through a second, warping read (its lanes curl)
 * skyLayers    lattices of far stars in the sky
 * env          the environment target the glass refracts (width; height is half): the sky in
 *              every direction, painted each frame (`envEvery` = every n-th frame)
 * pieces       glass pieces held at once, and `ambient` how many drift there with no play
 * bevel        segments in a piece's rounded edges and corners (its silhouette)
 * stars        near stars that stream past, and `motes` the dust in the current
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        detail: false,
        warpRead: false,
        skyLayers: 1,
        env: 256,
        envEvery: 2,
        pieces: 12,
        ambient: 6,
        bevel: 1,
        stars: 400,
        motes: 120,
    }),
    Low: Object.freeze({
        detail: false,
        warpRead: false,
        skyLayers: 2,
        env: 384,
        envEvery: 2,
        pieces: 16,
        ambient: 8,
        bevel: 2,
        stars: 800,
        motes: 220,
    }),
    Medium: Object.freeze({
        detail: true,
        warpRead: false,
        skyLayers: 2,
        env: 512,
        envEvery: 1,
        pieces: 20,
        ambient: 9,
        bevel: 2,
        stars: 1400,
        motes: 380,
    }),
    High: Object.freeze({
        detail: true,
        warpRead: true,
        skyLayers: 3,
        env: 768,
        envEvery: 1,
        pieces: 24,
        ambient: 10,
        bevel: 3,
        stars: 2400,
        motes: 600,
    }),
    Ultra: Object.freeze({
        detail: true,
        warpRead: true,
        skyLayers: 3,
        env: 1024,
        envEvery: 1,
        pieces: 24,
        ambient: 11,
        bevel: 4,
        stars: 3400,
        motes: 850,
    }),
    Extreme: Object.freeze({
        detail: true,
        warpRead: true,
        skyLayers: 3,
        env: 1024,
        envEvery: 1,
        pieces: 24,
        ambient: 12,
        bevel: 4,
        stars: 4400,
        motes: 1100,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
