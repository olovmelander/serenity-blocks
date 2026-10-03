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
 * z, w, h, yaw, seed}) — the SDF clearance rule still reads it that way. Since the
 * masterpiece pass (2026-10) the masses are drawn as luminous GAS, not sculpts: each spec
 * becomes a primary ellipsoid + four seeded satellites (odyssey-nebula-field.js
 * `resolveNebulaGasVolumes`), `role` sets how much gas surrounds the placement, `paint`
 * is the palette fallback ('warm' | 'cool') and the id keys the per-mass palette. Triangle
 * budget: 4 masses x 5 volumes x a 320-face proxy hull = 6,400 faces in ONE draw.
 */

export const NEBULA_FIELD_CLEARANCE = Object.freeze({
    axis: 120,
    travelWindow: Object.freeze({ zFrom: 160, zTo: -260, step: 20 }),
});

/**
 * RE-COMPOSED 2026-10-03 (owner: improve chapter 6's experience, visuals and composition). A
 * real-camera replay of the six-mass table found the gas IN FRONT of every hero: the purple reef
 * spanned ndc y -0.25..0.7 across the black hole's whole path (it never read as black until the
 * hand-off), the blue reef and the cyan witness sat on the gas giant and the galaxy, and the
 * pillar stood on the screen's centre column — the black hole's final seat. Six hues in one frame.
 *
 * Now FOUR masses, each clear of the heroes' sightlines for the whole chapter (replayed at p
 * 0.76-0.865), each arriving on its own BEAT (`beat`: [from, to] in chapter-local progress —
 * the field's shader fades a mass in across it; see odyssey-nebula-field.js):
 *   - S1, the near wisp: low on the left, the one thing that really sweeps PAST (the Drift);
 *   - N1, the violet reef: the lower-left quadrant, under the black hole's path;
 *   - N2, the indigo counterweight: the lower right corner, under the gas giant;
 *   - N4, THE CATHEDRAL WALL: far, wide and cool, behind the black hole's late path and final
 *     seat (ndc x -0.65..0.35, y -0.05..1.2 at the hand-off) — so the hole is a black disc
 *     against glowing gas from node 43 on. The galaxy sits just outside its right edge and the
 *     giant below it; both are nearer than the wall, so it only ever backlights them.
 */
export const ODYSSEY_NEBULA_FIELD_SPECS = Object.freeze([
    Object.freeze({
        id: 'S1-witness-near',
        role: 'witness',
        paint: 'warm',
        lod: 'near',
        x: -240,
        base: -215,
        z: -310,
        w: 115,
        h: 85,
        yaw: 2.4,
        seed: 12.9,
        beat: Object.freeze([0.26, 0.44]),
    }),
    Object.freeze({
        id: 'N1-reef-left',
        role: 'reef',
        paint: 'warm',
        lod: 'near',
        x: -340,
        base: -430,
        z: -460,
        w: 330,
        h: 240,
        yaw: 0.7,
        seed: 21.4,
        beat: Object.freeze([0.46, 0.68]),
    }),
    Object.freeze({
        id: 'N2-reef-right',
        role: 'reef',
        paint: 'cool',
        lod: 'mid',
        x: 560,
        base: -330,
        z: -640,
        w: 285,
        h: 185,
        yaw: -1.3,
        seed: 47.2,
        beat: Object.freeze([0.5, 0.72]),
    }),
    Object.freeze({
        id: 'N4-hero-veil',
        role: 'hero',
        paint: 'cool',
        lod: 'mid',
        x: -120,
        base: -150,
        z: -1390,
        w: 860,
        h: 520,
        yaw: -0.3,
        seed: 63.1,
        beat: Object.freeze([0.5, 0.76]),
    }),
]);
