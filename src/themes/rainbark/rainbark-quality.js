/**
 * Rainbark — content tiers. Every tier keeps the whole picture and every event: a tier cuts
 * counts and detail terms (dropped in JavaScript, never multiplied by zero), never a beat.
 *
 * trunks         trunk instances (the near draw holds at most 8 of them; the rest are far)
 * grids          tube grids θ × h of the near and the far trunk draws
 * limbs          the most limb instances in the far trunk draw (the plan grows fewer where a far
 *                trunk's limb cannot read as a branch)
 * atlas          the patch atlas's size (texels a side)
 * striation      fine vertical striation and rim lift on the bark
 * fleckLod       the sunfleck gobo: 'fixed' (one read at a fixed level), 'pixel' (a level per
 *                pixel) or 'penumbra' (per pixel, plus a second penumbra tap)
 * impostors      impostor ranks painted in the backdrop
 * billows        octaves of the mist top's billows (Low and Minimal drop the second)
 * canopy         the canopy's reads: 'full', or 'lite' (rbCanopy's Low and Minimal path: no leaf
 *                lace ragging the edges, no crown-gap lobes; the crown field, its limbs and its
 *                size test are the same, so the same openings show)
 * mistSheets     horizontal mist sheets, and `wisps` the camera-facing wisps between ranks
 * curlsAmbient   ambient curl slots, and `curlsEvent` the event curl and sheet slots
 * flakes         bark-chip flakes, and `drops` the drips, gust veil and sunshower streaks
 * vapour         vapour threads off lit bark, and `beads` the amber resin beads
 * shaftsAmbient  ambient shaft slabs, and `shaftsCombo` the canopy-gap shafts of a chain
 * lorikeets      birds crossing a gap (0 = none)
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        trunks: 12,
        grids: Object.freeze({ near: Object.freeze([24, 48]), far: Object.freeze([12, 24]) }),
        limbs: 0,
        atlas: 256,
        striation: false,
        fleckLod: 'fixed',
        impostors: 1,
        billows: 1,
        canopy: 'lite',
        mistSheets: 1,
        wisps: 0,
        curlsAmbient: 40,
        curlsEvent: 48,
        flakes: 32,
        drops: 64,
        vapour: 0,
        beads: 0,
        shaftsAmbient: 0,
        shaftsCombo: 0,
        lorikeets: 0,
    }),
    Low: Object.freeze({
        trunks: 16,
        grids: Object.freeze({ near: Object.freeze([32, 64]), far: Object.freeze([16, 32]) }),
        limbs: 6,
        atlas: 512,
        striation: false,
        fleckLod: 'fixed',
        impostors: 2,
        billows: 1,
        canopy: 'lite',
        mistSheets: 2,
        wisps: 1,
        curlsAmbient: 80,
        curlsEvent: 64,
        flakes: 48,
        drops: 96,
        vapour: 0,
        beads: 18,
        shaftsAmbient: 0,
        shaftsCombo: 7,
        lorikeets: 0,
    }),
    Medium: Object.freeze({
        trunks: 24,
        grids: Object.freeze({ near: Object.freeze([40, 88]), far: Object.freeze([20, 48]) }),
        limbs: 12,
        atlas: 512,
        striation: true,
        fleckLod: 'pixel',
        impostors: 3,
        billows: 2,
        canopy: 'full',
        mistSheets: 3,
        wisps: 2,
        curlsAmbient: 160,
        curlsEvent: 96,
        flakes: 64,
        drops: 160,
        vapour: 4,
        beads: 36,
        shaftsAmbient: 3,
        shaftsCombo: 7,
        lorikeets: 2,
    }),
    High: Object.freeze({
        trunks: 32,
        grids: Object.freeze({ near: Object.freeze([48, 112]), far: Object.freeze([24, 64]) }),
        limbs: 20,
        atlas: 512,
        striation: true,
        fleckLod: 'pixel',
        impostors: 3,
        billows: 2,
        canopy: 'full',
        mistSheets: 4,
        wisps: 4,
        curlsAmbient: 260,
        curlsEvent: 128,
        flakes: 96,
        drops: 240,
        vapour: 6,
        beads: 54,
        shaftsAmbient: 3,
        shaftsCombo: 7,
        lorikeets: 5,
    }),
    Ultra: Object.freeze({
        trunks: 42,
        grids: Object.freeze({ near: Object.freeze([56, 136]), far: Object.freeze([28, 80]) }),
        limbs: 28,
        atlas: 512,
        striation: true,
        fleckLod: 'penumbra',
        impostors: 3,
        billows: 2,
        canopy: 'full',
        mistSheets: 5,
        wisps: 6,
        curlsAmbient: 360,
        curlsEvent: 192,
        flakes: 128,
        drops: 320,
        vapour: 8,
        beads: 72,
        shaftsAmbient: 3,
        shaftsCombo: 7,
        lorikeets: 5,
    }),
    Extreme: Object.freeze({
        trunks: 54,
        grids: Object.freeze({ near: Object.freeze([64, 160]), far: Object.freeze([32, 96]) }),
        limbs: 36,
        atlas: 512,
        striation: true,
        fleckLod: 'penumbra',
        impostors: 3,
        billows: 2,
        canopy: 'full',
        mistSheets: 6,
        wisps: 8,
        curlsAmbient: 480,
        curlsEvent: 256,
        flakes: 160,
        drops: 400,
        vapour: 10,
        beads: 84,
        shaftsAmbient: 3,
        shaftsCombo: 7,
        lorikeets: 5,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

/** The tier for a quality name (High for anything unknown, including inherited keys). */
export function tierFor(quality) {
    return typeof quality === 'string' && Object.prototype.hasOwnProperty.call(QUALITY, quality)
        ? QUALITY[quality]
        : QUALITY.High;
}
