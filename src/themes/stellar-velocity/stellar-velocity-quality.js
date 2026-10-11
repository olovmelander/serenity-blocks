/**
 * Stellar Velocity — content tiers. Every tier keeps the whole picture and every event.
 *
 * march        steps along a ray of the canyon
 * detail       the second, finer read that frays the cloud's edges (one read per lit step)
 * taps         reads of the cloud toward the sun per lit step (0 = flat light, 2 = soft shade)
 * lights       the cloud is marched with the hoops and the fronts (else they are drawn, unlit)
 * canyonScale  the canyon's target, as a share of the drawing buffer
 * noise        the baked cloud volume's edge, in texels
 * skyLayers    lattices of far stars behind the canyon
 * stars        the near stars' pool
 * motes        the dust's pool
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        march: 12, detail: false, taps: 0, lights: false, canyonScale: 0.34, noise: 32, skyLayers: 1, stars: 500, motes: 140,
    }),
    Low: Object.freeze({
        march: 18, detail: false, taps: 1, lights: true, canyonScale: 0.4, noise: 48, skyLayers: 2, stars: 900, motes: 260,
    }),
    Medium: Object.freeze({
        march: 28, detail: true, taps: 1, lights: true, canyonScale: 0.45, noise: 64, skyLayers: 2, stars: 1600, motes: 450,
    }),
    High: Object.freeze({
        march: 40, detail: true, taps: 2, lights: true, canyonScale: 0.6, noise: 64, skyLayers: 3, stars: 3000, motes: 700,
    }),
    Ultra: Object.freeze({
        march: 52, detail: true, taps: 2, lights: true, canyonScale: 0.7, noise: 64, skyLayers: 3, stars: 4200, motes: 1000,
    }),
    Extreme: Object.freeze({
        march: 64, detail: true, taps: 2, lights: true, canyonScale: 0.8, noise: 64, skyLayers: 3, stars: 5600, motes: 1400,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
