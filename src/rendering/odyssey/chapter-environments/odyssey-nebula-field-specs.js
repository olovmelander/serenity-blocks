/**
 * @fileoverview Ch6 sculpted nebula field — authored mass specs (Space overhaul Wave 3,
 * docs/ODYSSEY_CH6_SPACE_OVERHAUL_PLAN_2026-08.md §3.1/§5).
 *
 * FROZEN SPECS MODULE — import-free by convention (the cloud-field specs pattern):
 * placement data only, no code, so the calibration story stays legible from this file
 * alone and nothing here can drift with a refactor.
 *
 * COORDINATE SPACE: corridor-local (the `cosmic-corridor` group) — spread in x/y,
 * depth along −Z, exactly like the sprite tiers these masses replace. The corridor
 * origin sits on the CAMERA'S TRAVEL (backset 40 from the chapter mid), and the
 * camera traverses roughly z +150 → −150 of this space over the chapter, so
 * everything at z ≤ −400 is ahead-of-camera scenery for the whole ride.
 *
 * CLEARANCE is the SDF-at-rail rule (cloud-field plan law, replacing centre
 * distance): `validateNebulaFieldClearance` in odyssey-nebula-field.js asserts the
 * corridor axis keeps ≥ NEBULA_FIELD_CLEARANCE.axis units of free field along the
 * travel window — enforced by test, so a spec edit that swallows the camera fails CI,
 * not review.
 *
 * The spec shape is the cloud sculptor's contract verbatim ({id, role, lod, x, base,
 * z, w, h, yaw, seed}; centre y = base + 0.42h; `lod` picks the icosphere detail).
 * Triangle budget is legible here alone: 3 near (980 faces) + 2 mid (500) ≈ 3,940
 * faces merged into ONE draw.
 */

export const NEBULA_FIELD_CLEARANCE = Object.freeze({
    // Free signed distance required from the corridor axis over the camera's travel
    // window. The travel window is z ∈ [+160, −260] (backset + follow sway included).
    axis: 120,
    travelWindow: Object.freeze({ zFrom: 160, zTo: -260, step: 20 }),
});

export const ODYSSEY_NEBULA_FIELD_SPECS = Object.freeze([
    // ── THE REEF (plan §3.2 beat 3) — the masses the rail threads between ──────────
    Object.freeze({
        id: 'N1-reef-left', role: 'reef', lod: 'near', x: -280, base: -180, z: -460, w: 330, h: 240, yaw: 0.7, seed: 21.4,
    }),
    Object.freeze({
        id: 'N2-reef-right', role: 'reef', lod: 'near', x: 300, base: -60, z: -600, w: 300, h: 210, yaw: -1.3, seed: 47.2,
    }),
    // ── THE VAULT — an overhead mass so the reef reads in three dimensions ─────────
    Object.freeze({
        id: 'N3-vault-high', role: 'vault', lod: 'mid', x: 40, base: 140, z: -820, w: 380, h: 200, yaw: 2.1, seed: 9.8,
    }),
    // ── THE DEEP ANCHOR — the big far body that gives the chapter a horizon ────────
    Object.freeze({
        id: 'N4-deep-anchor', role: 'deep', lod: 'mid', x: -220, base: -160, z: -1150, w: 540, h: 320, yaw: -0.4, seed: 63.1,
    }),
    // ── THE PILLAR — the Pillars-of-Creation landmark, rebuilt as real sculpted
    // geometry (the old additive billboard pillar retires with the sprite tiers) ────
    Object.freeze({
        id: 'N5-pillar', role: 'pillar', lod: 'near', x: 190, base: -280, z: -1060, w: 210, h: 640, yaw: 1.6, seed: 84.5,
    }),
]);
