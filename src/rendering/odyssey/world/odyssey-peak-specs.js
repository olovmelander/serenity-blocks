/**
 * THE canonical Act II peak specifications — the world's own frozen authority.
 *
 * The world's `ODYSSEY_MASSIFS` height-field table is checked against this data
 * (`odyssey-world-height.test.js`), and the rest of Act II takes its peaks from there.
 *
 * Deliberately import-free pure data, like `odyssey-world-height.js`: safe to read from a
 * worker, a bake or a test without dragging in THREE or path-utils.
 *
 * Coordinates are OFFSETS, not absolutes, because that is what the shipped derivation has
 * always been: X/Z relative to the Chapter 4 path-range centre, and the foot datum
 * relative to the Chapter 3 path-range centre's Y (`footDy` = the shipped
 * `centerMountainY = chapter3Center.y - 30`, with the far-left flank seated 50 u lower).
 * `odyssey-world-height.js` keeps its ABSOLUTE transcription (it must stay dependency-free
 * for the bake); its test verifies that transcription against this table + the live path,
 * so a re-sited path or an edited offset fails a world-side test instead of silently
 * drifting the two apart.
 *
 * Geometry only. Treatments (colour/haze/mist) are look, not truth — they stay with the
 * renderers that use them.
 */

/** The fraction of a peak's authored plane `size` its displaced cone actually reaches. */
export const PEAK_CONE_RADIUS_FRAC = 0.45;

export const ODYSSEY_PEAK_SPECS = Object.freeze([
    Object.freeze({
        id: 'ch4-left-main',
        massifId: 'left-main',
        role: 'main',
        size: 920,
        height: 360,
        seed: 12.34,
        dx: -230,
        dz: -600,
        footDy: -30,
    }),
    Object.freeze({
        id: 'ch4-right-main',
        massifId: 'right-main',
        role: 'main',
        size: 900,
        height: 340,
        seed: 45.67,
        dx: 230,
        dz: -630,
        footDy: -30,
    }),
    Object.freeze({
        id: 'ch4-center-hero',
        massifId: 'hero',
        role: 'hero',
        size: 1340,
        height: 720,
        seed: 89.12,
        dx: 0,
        dz: -680,
        footDy: -30,
    }),
    Object.freeze({
        id: 'ch4-far-left',
        massifId: 'far-left',
        role: 'far-range',
        size: 1500,
        height: 430,
        seed: 7.77,
        dx: -1710,
        dz: -1260,
        footDy: -80,
    }),
]);
