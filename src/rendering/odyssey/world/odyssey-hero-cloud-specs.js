/**
 * ACT II HERO CUMULUS — placements (cloud plan §7.1, owner-approved 2026-08-13).
 *
 * The cloud DECK is a horizontal sheet: its silhouette is a plan-view contour, so scaling it up
 * gives bigger popcorn, never a cumulus with vertical mass. The owner's Witness reference is a
 * FEW BIG clouds standing in generous blue — discrete objects with tops, sides and flat-ish
 * bases. That is a different primitive, and this file is where it is placed.
 *
 * Frozen, import-free pure data (the `odyssey-peak-specs.js` pattern) so a test or a worker can
 * read it without pulling in three.js.
 *
 * COORDINATES ARE ABSOLUTE WORLD. `base` is the flat underside plane of the mass; `w`/`h` are
 * the overall silhouette extents. Every entry below was validated against the live path modules
 * (`getOdysseyPathPointAt`, the derived `chapterPositions`) rather than eyeballed — see the
 * invariants in `odyssey-hero-clouds.test.js`, which re-derive the rail distances at build time
 * so a bad edit fails the suite instead of shipping.
 */

/**
 * Placement invariants. These are not style preferences; each one prevents a specific failure.
 */
export const HERO_CLOUD_RULES = Object.freeze({
    /**
     * The deck's billow ceiling is ~776, and the eye reaches ~672 at the very end of the act
     * gate (the rail DOES cross the 660 plane for the last ~0.01 of the window, so "always seen
     * from below" is false at the edge). 820 keeps every hero above both with ~150 u to spare.
     */
    MIN_LOBE_Y: 820,
    /**
     * The heroes are OPAQUE. If the camera enters one, the near plane slices it and the player
     * sees the inside of a cloud — a hole in the sky. 600 u of rail clearance makes that
     * geometrically impossible, so no near-fade is needed anywhere in the shader.
     */
    MIN_RAIL_DIST: 600,
    /**
     * Past this the aerial term has eaten the value bands and a hero is a pale smudge; it is
     * also inside the r=3600 sky dome, so a hero can never poke through the sky.
     */
    MAX_RAIL_DIST: 3200,
});

/**
 * SLICE 1 ships H1/H2/H4 (see the plan's Wave 4 outcome); H3/H5/H6 are authored and validated
 * but held back so the first measurement prices the mechanism, not the art budget.
 */
export const ODYSSEY_HERO_CLOUD_SPECS = Object.freeze([
    Object.freeze({
        id: 'H1-summit-tower', x: -320, base: 860, z: -2250, w: 640, h: 330, yaw: 0.4, seed: 11.3,
    }),
    Object.freeze({
        id: 'H2-left-flank', x: -1750, base: 830, z: -2050, w: 700, h: 300, yaw: 1.9, seed: 27.1,
    }),
    Object.freeze({
        id: 'H4-deep-ahead', x: -750, base: 900, z: -3150, w: 880, h: 380, yaw: 2.6, seed: 58.2,
    }),
]);

/**
 * Authored and validated, held for slice 2 so the first pair prices the mechanism alone.
 */
export const ODYSSEY_HERO_CLOUD_SPECS_SLICE2 = Object.freeze([
    Object.freeze({
        id: 'H3-right-flank', x: 620, base: 845, z: -2150, w: 600, h: 280, yaw: -0.8, seed: 43.6,
    }),
    Object.freeze({
        id: 'H5-far-right', x: 1450, base: 875, z: -3050, w: 820, h: 320, yaw: -2.1, seed: 71.9,
    }),
    Object.freeze({
        id: 'H6-ascent-right', x: 1550, base: 855, z: -1000, w: 620, h: 290, yaw: 1.2, seed: 86.4,
    }),
]);
