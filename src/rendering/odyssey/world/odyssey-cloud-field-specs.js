/**
 * ACT II CLOUD FIELD — the composition (cloud-field plan Wave 1).
 *
 * Frozen, import-free pure data (the `odyssey-peak-specs.js` / hero-specs pattern) so a test
 * or a worker can read it without pulling in three.js.
 *
 * THE SIX FRAMING MASSES ARE THE RETIRED HEROES' PLACEMENTS, UNCHANGED. That composition was
 * owner-approved on 2026-08-13 and only the MODEL failed — glued spheres you could count.
 * Re-authoring the placement at the same time as the geometry would have made the retirement
 * un-diagnosable: if the new sky still read wrong, nothing would say whether the sculptor or
 * the composition was at fault. Everything ELSE here is new, and fills the two jobs the six
 * heroes never did — populating the middle distance and giving the horizon a row to sit on.
 *
 * ROLES, and what each one is for:
 *   - `framing`   the read. Big, near-ish, silhouetted against sky at the summit stations.
 *   - `overhead`  the middle distance the heroes left empty; keeps the sky from reading as
 *                 "six clouds and a void" once the sheet is gone.
 *   - `strata`    the far row. Small on screen, cheap, and the thing that makes the horizon
 *                 feel inhabited — the job The Witness gives its painted cutout quads.
 *
 * CLEARANCE IS A SURFACE DISTANCE, PER ROLE — see `CLOUD_FIELD_CLEARANCE` and
 * `validateCloudFieldClearance`. The heroes used CENTRE distance, which cannot do the job: a
 * mass 700 u away by centre but 880 u wide still swallows the camera, and Wave 0's ch5 probe
 * frame photographed exactly that (the "white slab" the owner circled twice).
 */

/**
 * Minimum distance from the rail to a mass's SURFACE, in world units, by role.
 *
 * `framing` keeps the largest margin because those masses are the ones big enough on screen to
 * fill the frame if the rail drifts toward them; `strata` can sit closer to the rail in plan
 * because it is far above it. All are checked against the LIVE rail by the test, at the
 * smooth hull (no crinkle) — the crinkle can only push the surface outward by CRINKLE_AMP of
 * the half-width, which every margin here comfortably exceeds.
 */
export const CLOUD_FIELD_CLEARANCE = Object.freeze({
    framing: 420,
    overhead: 300,
    strata: 260,
    default: 300,
});

/**
 * The field. `lod` selects an icosphere subdivision from `CLOUD_FIELD_LOD_DETAIL`
 * (near 980 / mid 320 / far 80 faces), so the triangle budget is legible from this table
 * alone: 10 near + 12 mid + 16 far = 9800 + 3840 + 1280 = 14,920 triangles.
 *
 * ⚠️ LOD IS LOAD-BEARING, NOT AN OPTIMISATION. Wave 0 measured ~0.131 ms fixed + ~0.0094 ms
 * per mass at ch5; 34 masses at uniform NEAR detail would blow gate F1 on triangles alone.
 * A future mass added at `near` must come out of another `near`, not be appended.
 */
export const ODYSSEY_CLOUD_FIELD_SPECS = Object.freeze([
    // ── FRAMING — the retired heroes' placements, verbatim ────────────────────────────
    Object.freeze({
        id: 'F1-summit-tower', role: 'framing', lod: 'near', x: -320, base: 860, z: -2250, w: 640, h: 330, yaw: 0.4, seed: 11.3,
    }),
    Object.freeze({
        id: 'F2-left-flank', role: 'framing', lod: 'near', x: -1750, base: 830, z: -2050, w: 700, h: 300, yaw: 1.9, seed: 27.1,
    }),
    Object.freeze({
        id: 'F3-deep-ahead', role: 'framing', lod: 'near', x: -750, base: 900, z: -3150, w: 880, h: 380, yaw: 2.6, seed: 58.2,
    }),
    Object.freeze({
        id: 'F4-right-flank', role: 'framing', lod: 'near', x: 620, base: 845, z: -2150, w: 600, h: 280, yaw: -0.8, seed: 43.6,
    }),
    Object.freeze({
        id: 'F5-far-right', role: 'framing', lod: 'near', x: 1450, base: 875, z: -3050, w: 820, h: 320, yaw: -2.1, seed: 71.9,
    }),
    Object.freeze({
        id: 'F6-ascent-right', role: 'framing', lod: 'near', x: 1550, base: 855, z: -1000, w: 620, h: 290, yaw: 1.2, seed: 86.4,
    }),

    // ── OVERHEAD — the middle distance the heroes left empty ──────────────────────────
    Object.freeze({
        id: 'O01', role: 'overhead', lod: 'mid', x: -2300, base: 890, z: -1250, w: 520, h: 240, yaw: 0.9, seed: 101.7,
    }),
    Object.freeze({
        id: 'O02', role: 'overhead', lod: 'mid', x: -1150, base: 935, z: -520, w: 470, h: 215, yaw: 2.3, seed: 118.2,
    }),
    Object.freeze({
        id: 'O03', role: 'overhead', lod: 'mid', x: 900, base: 910, z: -520, w: 540, h: 250, yaw: -1.4, seed: 133.9,
    }),
    Object.freeze({
        id: 'O04', role: 'overhead', lod: 'mid', x: 2250, base: 880, z: -1900, w: 580, h: 260, yaw: 0.2, seed: 149.4,
    }),
    Object.freeze({
        id: 'O05', role: 'overhead', lod: 'mid', x: -2600, base: 925, z: -2750, w: 610, h: 275, yaw: 1.7, seed: 164.8,
    }),
    Object.freeze({
        id: 'O06', role: 'overhead', lod: 'mid', x: 250, base: 955, z: -3850, w: 640, h: 290, yaw: -2.6, seed: 180.3,
    }),
    Object.freeze({
        id: 'O07', role: 'overhead', lod: 'mid', x: -1650, base: 900, z: -3950, w: 560, h: 255, yaw: 0.6, seed: 195.1,
    }),
    Object.freeze({
        id: 'O08', role: 'overhead', lod: 'mid', x: 2450, base: 945, z: -3450, w: 590, h: 265, yaw: -0.4, seed: 211.6,
    }),
    Object.freeze({
        id: 'O09', role: 'overhead', lod: 'mid', x: -600, base: 985, z: 350, w: 500, h: 230, yaw: 2.9, seed: 226.2,
    }),
    Object.freeze({
        id: 'O10', role: 'overhead', lod: 'mid', x: 1750, base: 965, z: 250, w: 530, h: 245, yaw: -1.9, seed: 241.5,
    }),
    Object.freeze({
        id: 'O11', role: 'overhead', lod: 'mid', x: -3050, base: 870, z: -350, w: 550, h: 250, yaw: 1.1, seed: 257.8,
    }),
    Object.freeze({
        id: 'O12', role: 'overhead', lod: 'mid', x: 3150, base: 900, z: -800, w: 570, h: 255, yaw: -0.7, seed: 272.4,
    }),

    // ── ZENITH — the ch5 climb's overhead sky ─────────────────────────────────────────
    // MEASURED GAP, not a guess: the first sculpted capture at the ch5 station (p=0.565, the
    // camera pitched 18 degrees off VERTICAL) showed an EMPTY sky. The rail there runs
    // x -212..-184, z -495..-594, topping out at y 656, so an up-pitched camera sees a narrow
    // cone about the zenith — and every mass above was authored 900+ u away in plan, i.e.
    // outside it. Overhead sky needs masses placed against the RAIL's own track, not scattered
    // around the act and hoped into frame.
    //
    // ⚠️ THESE WERE FIRST AUTHORED AT base 1015-1080 AND w 540-620, AND THEY LOOKED AWFUL:
    // 350-500 u above the eye, a 600-wide mass subtends ~70 degrees, so the ch5 frame filled
    // with two featureless white potatoes showing their flat BASES with visible polygon edges.
    // An overhead cloud is seen base-first and a flat base is by design featureless, so the
    // only cure is angular size — they now sit 900-1100 u up at w 410-500 (~25 degrees) and
    // take `near` LOD, because a mass this prominent cannot wear a 320-triangle silhouette.
    // The general rule this bought: ANGULAR size, not world size, is what the LOD and the
    // authored width must be chosen against.
    //
    // Bases sit at 1470-1700. The margin claim is the validator's, not this comment's: an
    // earlier draft of these four asserted "clears by 354-424 u" from base-minus-rail-top
    // arithmetic and THREE of them failed the check (Z02 by 79 u), because the nearest rail
    // point is not the highest one. Trust the test.
    Object.freeze({
        id: 'Z01', role: 'overhead', lod: 'near', x: -520, base: 1520, z: -380, w: 430, h: 205, yaw: 0.5, seed: 601.4,
    }),
    Object.freeze({
        id: 'Z02', role: 'overhead', lod: 'near', x: 190, base: 1610, z: -700, w: 470, h: 220, yaw: -1.7, seed: 617.9,
    }),
    Object.freeze({
        id: 'Z03', role: 'overhead', lod: 'near', x: -640, base: 1700, z: -900, w: 500, h: 235, yaw: 2.2, seed: 633.5,
    }),
    Object.freeze({
        id: 'Z04', role: 'overhead', lod: 'near', x: 330, base: 1470, z: -180, w: 410, h: 195, yaw: -0.6, seed: 649.1,
    }),

    // ── STRATA — the far row that inhabits the horizon ────────────────────────────────
    Object.freeze({
        id: 'S01', role: 'strata', lod: 'far', x: -4200, base: 1010, z: -2400, w: 760, h: 300, yaw: 0.3, seed: 301.2,
    }),
    Object.freeze({
        id: 'S02', role: 'strata', lod: 'far', x: -3400, base: 1035, z: -4600, w: 820, h: 320, yaw: 1.5, seed: 316.7,
    }),
    Object.freeze({
        id: 'S03', role: 'strata', lod: 'far', x: -1200, base: 1055, z: -5300, w: 880, h: 340, yaw: -2.2, seed: 332.1,
    }),
    Object.freeze({
        id: 'S04', role: 'strata', lod: 'far', x: 1300, base: 1020, z: -5100, w: 840, h: 330, yaw: 0.8, seed: 347.6,
    }),
    Object.freeze({
        id: 'S05', role: 'strata', lod: 'far', x: 3600, base: 1045, z: -4300, w: 800, h: 315, yaw: -1.1, seed: 363.3,
    }),
    Object.freeze({
        id: 'S06', role: 'strata', lod: 'far', x: 4400, base: 1000, z: -2100, w: 780, h: 305, yaw: 2.0, seed: 378.9,
    }),
    Object.freeze({
        id: 'S07', role: 'strata', lod: 'far', x: 4100, base: 1030, z: 500, w: 810, h: 320, yaw: -0.5, seed: 394.2,
    }),
    Object.freeze({
        id: 'S08', role: 'strata', lod: 'far', x: 2100, base: 1060, z: 1500, w: 850, h: 335, yaw: 1.8, seed: 409.8,
    }),
    Object.freeze({
        id: 'S09', role: 'strata', lod: 'far', x: -900, base: 1040, z: 1750, w: 830, h: 325, yaw: -2.7, seed: 425.4,
    }),
    Object.freeze({
        id: 'S10', role: 'strata', lod: 'far', x: -3300, base: 1015, z: 1100, w: 790, h: 310, yaw: 0.1, seed: 440.9,
    }),
    Object.freeze({
        id: 'S11', role: 'strata', lod: 'far', x: -4700, base: 1050, z: -700, w: 800, h: 315, yaw: 1.3, seed: 456.5,
    }),
    Object.freeze({
        id: 'S12', role: 'strata', lod: 'far', x: 200, base: 1075, z: -6400, w: 900, h: 350, yaw: -1.6, seed: 472.1,
    }),
    Object.freeze({
        id: 'S13', role: 'strata', lod: 'far', x: -2400, base: 1065, z: -6100, w: 870, h: 340, yaw: 2.5, seed: 487.7,
    }),
    Object.freeze({
        id: 'S14', role: 'strata', lod: 'far', x: 2900, base: 1070, z: -6000, w: 860, h: 335, yaw: -0.9, seed: 503.2,
    }),
    Object.freeze({
        id: 'S15', role: 'strata', lod: 'far', x: 5200, base: 1025, z: -3300, w: 790, h: 310, yaw: 0.7, seed: 518.8,
    }),
    Object.freeze({
        id: 'S16', role: 'strata', lod: 'far', x: -5300, base: 1005, z: -3600, w: 780, h: 305, yaw: -2.4, seed: 534.3,
    }),
]);
