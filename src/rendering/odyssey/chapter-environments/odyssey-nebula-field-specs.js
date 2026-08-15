/**
 * @fileoverview Ch6 sculpted nebula field — authored mass specs (Space overhaul
 * Wave 3, RE-COMPOSED 2026-08-15 against the plan's §3b composition contract).
 *
 * FROZEN SPECS MODULE — import-free by convention (the cloud-field specs pattern):
 * placement data only, no code, so the calibration story stays legible from this file
 * alone and nothing here can drift with a refactor.
 *
 * COORDINATE SPACE: corridor-local (the `cosmic-corridor` group) — spread in x/y,
 * depth along −Z, exactly like the sprite tiers these masses replaced. The corridor
 * origin sits on the CAMERA'S TRAVEL (backset 40 from the chapter mid), and the
 * camera traverses roughly z +150 → −150 of this space over the chapter, so
 * everything at z ≤ −400 is ahead-of-camera scenery for the whole ride.
 *
 * COMPOSITION (§3b rules this table implements):
 * - Rule 12 (break same-size/even-spacing): 1 colossal HERO / 2 medium / 2 small at
 *   deliberately irregular depths (−300, −460, −540, −640, −1060, −1390).
 * - Rule 1 (one dominant per view): the hero veil hangs FAR RIGHT while the black
 *   hole owns the upper LEFT third — they never rival inside one frame third.
 * - Rule 6 (big+soft vs tiny+sharp): the hero is the `cool` role (dimmer, softer
 *   paint — see odyssey-nebula-field.js); the two small witnesses are warm, crisp,
 *   and near the rail, sweeping past fast (rule 7's parallax statement).
 * - Rule 8 (causal light): every mass's yaw leans its lobe grain toward the
 *   accretion key up-left-ahead; the pillar points AT the black hole.
 * - Rule 5 (prove the dome is behind): the hero veil's 980 u width guarantees it
 *   overlaps baked-dome pockets for the whole ride.
 *
 * CLEARANCE is the SDF-at-rail rule: `validateNebulaFieldClearance` asserts the
 * corridor axis keeps ≥ NEBULA_FIELD_CLEARANCE.axis units of free field along the
 * travel window — a spec edit that swallows the camera fails CI, not review.
 *
 * The spec shape is the cloud sculptor's contract verbatim ({id, role, lod, x, base,
 * z, w, h, yaw, seed}; centre y = base + 0.42h; `lod` picks icosphere detail).
 * `paint` picks the palette role in odyssey-nebula-field.js: 'warm' | 'cool'.
 * Triangle budget legible here alone: 4 near (980 faces) + 2 mid (500) ≈ 4,920 faces
 * merged into TWO draws (one per paint role).
 */

export const NEBULA_FIELD_CLEARANCE = Object.freeze({
    axis: 120,
    travelWindow: Object.freeze({ zFrom: 160, zTo: -260, step: 20 }),
});

export const ODYSSEY_NEBULA_FIELD_SPECS = Object.freeze([
    // ── THE WITNESSES — small, sharp, near the rail; they sweep past fast and
    // calibrate everything behind them (rules 6+7) ─────────────────────────────────
    Object.freeze({
        id: 'S1-witness-near', role: 'witness', paint: 'warm', lod: 'near', x: -240, base: -70, z: -310, w: 115, h: 85, yaw: 2.4, seed: 12.9,
    }),
    Object.freeze({
        id: 'S2-witness-mid', role: 'witness', paint: 'cool', lod: 'near', x: 235, base: 100, z: -540, w: 135, h: 95, yaw: -0.6, seed: 55.3,
    }),
    // ── THE REEF — two medium workhorses the rail threads between ─────────────────
    Object.freeze({
        id: 'N1-reef-left', role: 'reef', paint: 'warm', lod: 'near', x: -280, base: -180, z: -460, w: 330, h: 240, yaw: 0.7, seed: 21.4,
    }),
    Object.freeze({
        id: 'N2-reef-right', role: 'reef', paint: 'warm', lod: 'mid', x: 305, base: -55, z: -640, w: 285, h: 185, yaw: -1.3, seed: 47.2,
    }),
    // ── THE PILLAR — the vertical landmark, pointing AT the black hole (rule 8);
    // its dense head faces the accretion key up-left, wisps streaming away ────────
    Object.freeze({
        id: 'N5-pillar', role: 'pillar', paint: 'warm', lod: 'near', x: 190, base: -280, z: -1060, w: 210, h: 640, yaw: 2.6, seed: 84.5,
    }),
    // ── THE HERO VEIL — one colossal cool mass, far right, soft and dim (rule 6's
    // big+soft), the cathedral wall the whole chapter hangs against ───────────────
    Object.freeze({
        id: 'N4-hero-veil', role: 'hero', paint: 'cool', lod: 'mid', x: 520, base: -340, z: -1390, w: 980, h: 560, yaw: -0.3, seed: 63.1,
    }),
]);
