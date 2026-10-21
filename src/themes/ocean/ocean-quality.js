/**
 * Ocean — content tiers. Every tier keeps the whole picture and every event.
 *
 * light      edge of the baked light pattern (the caustic net and the shafts' mask), texels
 * seabed     share of the seabed's full grid
 * waves      wave trains summed on the surface
 * clouds     cloud in the sky seen through the surface
 * corals     share of the reef's colonies (the hero ones by the viewer always)
 * kelp       stands of kelp, and blades to a stand
 * grass      blades of seagrass
 * school     fish in the silver school
 * reefFish   fish that keep to the coral heads
 * jellies    moon jellies
 * motes      what drifts in the water
 * near       specks right in front of the eye (sharp in a shaft, soft discs out of focus)
 * pool       pool of the bubbles, beads and comets every event is made of
 * glints     whether the school's flanks flash as it turns
 */
import { normalizeQuality } from '../../utils/quality.js';

export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        light: 256,
        seabed: 0.42,
        waves: 3,
        clouds: false,
        corals: 0.3,
        kelp: 8,
        blades: 16,
        grass: 260,
        school: 380,
        reefFish: 50,
        jellies: 0,
        motes: 260,
        near: 120,
        pool: 256,
        glints: false,
    }),
    Low: Object.freeze({
        light: 256,
        seabed: 0.55,
        waves: 4,
        clouds: false,
        corals: 0.45,
        kelp: 12,
        blades: 22,
        grass: 520,
        school: 700,
        reefFish: 90,
        jellies: 4,
        motes: 500,
        near: 200,
        pool: 384,
        glints: true,
    }),
    Medium: Object.freeze({
        light: 384,
        seabed: 0.75,
        waves: 5,
        clouds: true,
        corals: 0.7,
        kelp: 18,
        blades: 28,
        grass: 1000,
        school: 1300,
        reefFish: 150,
        jellies: 7,
        motes: 900,
        near: 380,
        pool: 640,
        glints: true,
    }),
    High: Object.freeze({
        light: 512,
        seabed: 1,
        waves: 6,
        clouds: true,
        corals: 1,
        kelp: 26,
        blades: 36,
        grass: 1700,
        school: 2200,
        reefFish: 230,
        jellies: 10,
        motes: 1500,
        near: 640,
        pool: 960,
        glints: true,
    }),
    Ultra: Object.freeze({
        light: 512,
        seabed: 1.15,
        waves: 6,
        clouds: true,
        corals: 1.2,
        kelp: 32,
        blades: 40,
        grass: 2300,
        school: 3200,
        reefFish: 300,
        jellies: 12,
        motes: 2100,
        near: 820,
        pool: 1280,
        glints: true,
    }),
    Extreme: Object.freeze({
        light: 768,
        seabed: 1.3,
        waves: 6,
        clouds: true,
        corals: 1.4,
        kelp: 38,
        blades: 44,
        grass: 3000,
        school: 4400,
        reefFish: 380,
        jellies: 14,
        motes: 2800,
        near: 1000,
        pool: 1600,
        glints: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    // (An own name only: 'constructor' and its kind are names every object answers to.)
    return Object.prototype.hasOwnProperty.call(QUALITY, quality) ? QUALITY[quality] : QUALITY.High;
}

/** Keep playground overrides and the shipped graphics setting on the same quality tier. */
export function resolveOceanQuality(params, settings) {
    return normalizeQuality(
        params?.get?.('quality')
        || settings?.effectQuality
        || settings?.graphicsQuality
        || 'High',
    );
}
