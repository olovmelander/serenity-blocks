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
 * motes          seeds and pollen adrift in the air, glinting in the canopy's light (MOTES)
 * vapour         vapour threads off lit bark, and `beads` the amber resin beads
 * shaftsAmbient  ambient shaft slabs, and `shaftsCombo` the canopy-gap shafts of a chain
 * beams          the beam field: the sun through the canopy as beams standing in the haze (BEAMS)
 * sparks         speck slots: what a beat throws into the light (SPARKS)
 * lorikeets      birds crossing a gap (0 = none)
 * sprays         eucalyptus sprays hanging into the top of the frame, and `boughs` the crowns' own under the canopy (FOLIAGE)
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
        drops: 160,
        motes: 80,
        vapour: 0,
        beads: 0,
        shaftsAmbient: 0,
        shaftsCombo: 0,
        beams: 0,
        sparks: 96,
        lorikeets: 0,
        sprays: 8,
        boughs: 0,
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
        drops: 240,
        motes: 150,
        vapour: 0,
        beads: 18,
        shaftsAmbient: 0,
        shaftsCombo: 7,
        beams: 5,
        sparks: 160,
        lorikeets: 0,
        sprays: 12,
        boughs: 110,
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
        drops: 400,
        motes: 250,
        vapour: 4,
        beads: 36,
        shaftsAmbient: 3,
        shaftsCombo: 7,
        beams: 9,
        sparks: 280,
        lorikeets: 3,
        sprays: 16,
        boughs: 240,
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
        drops: 600,
        motes: 360,
        vapour: 6,
        beads: 54,
        shaftsAmbient: 3,
        shaftsCombo: 7,
        beams: 14,
        sparks: 420,
        lorikeets: 6,
        sprays: 22,
        boughs: 420,
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
        drops: 800,
        motes: 460,
        vapour: 8,
        beads: 72,
        shaftsAmbient: 3,
        shaftsCombo: 7,
        beams: 18,
        sparks: 560,
        lorikeets: 7,
        sprays: 26,
        boughs: 560,
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
        drops: 1000,
        motes: 560,
        vapour: 10,
        beads: 84,
        shaftsAmbient: 3,
        shaftsCombo: 7,
        beams: 22,
        sparks: 700,
        lorikeets: 8,
        sprays: 30,
        boughs: 720,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

/** The tier for a quality name (High for anything unknown, including inherited keys). */
export function tierFor(quality) {
    return typeof quality === 'string' && Object.prototype.hasOwnProperty.call(QUALITY, quality)
        ? QUALITY[quality]
        : QUALITY.High;
}
