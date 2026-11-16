// @ts-check
/**
 * Wolfhour — the wolves' coats and builds (plain numbers, three-free).
 *
 * A coat is three albedos (linear: the share of the night's light each gives back): the `dark` of the saddle, the ears'
 * backs and the tail's tip, the `mid` of the flanks, and the `pale` of the legs, the belly, the
 * cheeks and the chin (wolfhour-wolf-rig.js gives every capsule its place between them), and how
 * brightly its eyes give the moon back. A build is the rig's WOLF_SHAPE: girth, ruff, brush, ears,
 * legs, head. No two wolves of the night are the same animal.
 */

/**
 * @typedef {{ dark: readonly number[], mid: readonly number[], pale: readonly number[], eye: number }} WolfCoat
 */

/** @type {Readonly<Record<string, WolfCoat>>} */
export const WOLF_COATS = Object.freeze({
    // The grey wolf of the north: a dark saddle over grey flanks, buff legs and cheeks.
    timber: Object.freeze({
        dark: Object.freeze([0.062, 0.064, 0.07]),
        mid: Object.freeze([0.185, 0.185, 0.19]),
        pale: Object.freeze([0.44, 0.42, 0.38]),
        eye: 1,
    }),
    // A black wolf: only the moon's rim and its eyes find it.
    black: Object.freeze({
        dark: Object.freeze([0.012, 0.012, 0.015]),
        mid: Object.freeze([0.03, 0.03, 0.036]),
        pale: Object.freeze([0.075, 0.073, 0.078]),
        eye: 1.25,
    }),
    // A white wolf, cream in its shadows.
    white: Object.freeze({
        dark: Object.freeze([0.56, 0.56, 0.55]),
        mid: Object.freeze([0.76, 0.76, 0.74]),
        pale: Object.freeze([0.9, 0.88, 0.85]),
        eye: 0.85,
    }),
    // Tawny: the red-brown of an old coat in winter.
    tawny: Object.freeze({
        dark: Object.freeze([0.085, 0.064, 0.047]),
        mid: Object.freeze([0.25, 0.18, 0.118]),
        pale: Object.freeze([0.5, 0.41, 0.3]),
        eye: 1,
    }),
    // Silver: pale grey all over, a faint saddle.
    silver: Object.freeze({
        dark: Object.freeze([0.12, 0.126, 0.14]),
        mid: Object.freeze([0.33, 0.34, 0.36]),
        pale: Object.freeze([0.6, 0.6, 0.6]),
        eye: 0.95,
    }),
    // Ash: the pale grey-buff of a wolf not yet grown into its coat.
    ash: Object.freeze({
        dark: Object.freeze([0.1, 0.098, 0.094]),
        mid: Object.freeze([0.26, 0.252, 0.236]),
        pale: Object.freeze([0.52, 0.5, 0.455]),
        eye: 1,
    }),
    // Smoke: a dark grey wolf with a pale mask and legs.
    smoke: Object.freeze({
        dark: Object.freeze([0.026, 0.028, 0.034]),
        mid: Object.freeze([0.09, 0.094, 0.106]),
        pale: Object.freeze([0.36, 0.355, 0.34]),
        eye: 1.1,
    }),
});

/**
 * Who is who: each wolf's coat and its build. The lead is the big grey; its mate silver; the
 * sitter an old tawny one; the young wolf dark and leggy; the yearling a small ash-pale one, all ears
 * and paws; the wolf across the valley black; the wolf of the summit white.
 */
export const WOLF_LOOKS = Object.freeze({
    lead: Object.freeze({
        coat: 'timber',
        shape: Object.freeze({ bulk: 1.06, ruff: 1.1, tail: 1.05 }),
    }),
    sitter: Object.freeze({
        coat: 'tawny',
        shape: Object.freeze({ bulk: 1.08, ruff: 1.05, limb: 1.05 }),
    }),
    young: Object.freeze({
        coat: 'smoke',
        shape: Object.freeze({
            bulk: 0.92, ruff: 0.9, ear: 1.12, limb: 0.95, head: 1.03,
        }),
    }),
    mate: Object.freeze({
        coat: 'silver',
        shape: Object.freeze({ bulk: 0.97, ruff: 1, tail: 1.1 }),
    }),
    yearling: Object.freeze({
        coat: 'ash',
        shape: Object.freeze({
            bulk: 0.9, ruff: 0.85, ear: 1.22, head: 1.08, muzzle: 0.9, tail: 0.9,
        }),
    }),
    answer: Object.freeze({
        coat: 'black',
        shape: Object.freeze({ bulk: 1.02, ruff: 1.15 }),
    }),
    scout: Object.freeze({
        coat: 'silver',
        shape: Object.freeze({ bulk: 0.98, ruff: 1, limb: 1 }),
    }),
    moon: Object.freeze({
        coat: 'white',
        shape: Object.freeze({ bulk: 1.05, ruff: 1.2, tail: 1.1 }),
    }),
});

/** The coats a passing wolf may wear, in the order a visit deals them out. */
export const ROVER_COATS = Object.freeze(['timber', 'white', 'smoke', 'tawny', 'silver', 'black']);

/**
 * A passing wolf's look: its coat and a build of its own, from its place in the file and the
 * visit's number (a pure function of both, so a seek shows the same animals).
 * @param {number} visit
 * @param {number} place
 */
export function roverLook(visit, place) {
    const n = ROVER_COATS.length;
    const k = Math.abs(Math.trunc(visit)) * 5 + Math.abs(Math.trunc(place)) * 7;
    const wobble = (seed) => {
        const s = Math.sin((k + seed) * 12.9898) * 43758.5453;
        return s - Math.floor(s);
    };
    return {
        // (Down the file each wears the next coat round: no two alike in a visit of six or fewer.)
        coat: ROVER_COATS[(Math.abs(Math.trunc(visit)) * 5 + Math.abs(Math.trunc(place))) % n],
        shape: {
            bulk: 0.92 + wobble(1) * 0.18,
            ruff: 0.9 + wobble(2) * 0.25,
            tail: 0.9 + wobble(3) * 0.25,
            ear: 0.95 + wobble(4) * 0.2,
            limb: 0.94 + wobble(5) * 0.12,
            head: 0.97 + wobble(6) * 0.08,
            muzzle: 0.95 + wobble(7) * 0.1,
        },
        scale: 0.9 + wobble(8) * 0.2,
    };
}
