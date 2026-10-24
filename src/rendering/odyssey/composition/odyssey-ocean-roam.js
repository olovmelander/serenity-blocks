// @ts-check
/**
 * @fileoverview THE OCEAN'S ANIMALS ROAM — their own sea, not the camera's (2026-10-24).
 *
 * Olov: "in odyssey mode, i dont want the big fishes to follow the movement of the camera, i just
 * want them to swim around freely and so they can be seen when we are moving along the journey!"
 *
 * From 2026-10-23 every animal escorted the eye: a slot in the rail camera's view, its anchor
 * swimming after that slot. So on screen they held their places while the sea moved past, as if
 * glued to the lens. Now each swims its own route in the world. Its place is a function of the
 * clock alone, so the camera moves past the animals and they never move with it.
 *
 * WHERE. The journey climbs a column of water (the rail stays within ~13 u of OCEAN_COLUMN from
 * y 108 to the surface), looking up it. From below, the water seen most is high in the column, on
 * the screen's left and right (its wide axis). After the rail bends toward -x -z (from y ~210) the
 * frame holds only a wedge of water under the surface ahead. The routes were placed by scoring the
 * real camera over the drift (Act I ~4.1 u/s) from eight clock phases, because the clock is
 * wherever the player's time has put it when they reach the sea:
 *   - the whale shark loops high on the screen's left of the column (+x -z), seen from the deep
 *     and the middle of the climb;
 *   - the mother and calf loop high on its right (-x +z), seen from the deep;
 *   - the manta glides just under the surface out past the bend (-x -z), seen from the bend to the
 *     breach and from orb 10.
 * Each route is a loop round its own centre, round enough that a 46-58 u body never turns tighter
 * than ~0.4 of its length. Its pace and length breathe and its depth rises and falls, so it never
 * reads as a turntable. Each stays clear of the camera's path and of the others.
 *
 * Pure: no three.js (vectors are anything with x, y, z).
 */

const TAU = Math.PI * 2;

/** The deep column's axis (world xz): the rail climbs within ~13 u of it from y 108 to the surface. */
export const OCEAN_COLUMN = Object.freeze({ x: -8, z: 3 });

/** A loop's perimeter (Ramanujan), for its period at its speed. */
const perimeter = (a, b) => Math.PI * ((3 * (a + b)) - Math.sqrt(((3 * a) + b) * (a + (3 * b))));

/**
 * A route, frozen with its period (its perimeter at its mean speed).
 * @param {Omit<OceanRoute, 'period'>} r
 * @returns {OceanRoute}
 */
const route = (r) => Object.freeze({ ...r, period: perimeter(r.along, r.across) / r.speed });

/**
 * @typedef {object} OceanRoute
 * @property {number} bearing its loop's centre lies this way from the column (degrees in the xz
 *   plane, from +x toward +z)...
 * @property {number} out ...this far out from it (u)
 * @property {number} y the loop's height
 * @property {number} along half its length, round the column (u)
 * @property {number} across half its breadth, out from the column (u)
 * @property {number} speed mean pace (u/s)
 * @property {number} pace how much that pace swells and slackens (share), over `paceS` seconds
 * @property {number} paceS
 * @property {number} breathe how much its length swells (share), over `breatheS` seconds
 * @property {number} breatheS
 * @property {number} rise how much it climbs at one end of the loop and dives at the other (u)
 * @property {number} bob its slow drift in depth (u), over `bobS` seconds
 * @property {number} bobS
 * @property {number} phase rad
 * @property {number} turn +1 / -1, which way round
 * @property {number} period seconds per loop
 */

/** The routes (scored as described above). The calf rides the mother's (odyssey-whale-pass.js). */
export const OCEAN_ROAM = Object.freeze({
    whaleShark: route({
        bearing: -60,
        out: 74,
        y: 267,
        along: 29,
        across: 25,
        speed: 2.6,
        pace: 0.35,
        paceS: 47,
        breathe: 0.1,
        breatheS: 61,
        rise: 4,
        bob: 6,
        bobS: 53,
        phase: 0.6,
        turn: 1,
    }),
    whales: route({
        bearing: 145,
        out: 86,
        y: 270,
        along: 32,
        across: 29,
        speed: 2.4,
        pace: 0.35,
        paceS: 59,
        breathe: 0.1,
        breatheS: 73,
        rise: 3,
        bob: 2,
        bobS: 67,
        phase: 2.1,
        turn: -1,
    }),
    manta: route({
        bearing: -132,
        out: 80,
        y: 280,
        along: 28,
        across: 27,
        speed: 3,
        pace: 0.35,
        paceS: 29,
        breathe: 0.1,
        breatheS: 37,
        rise: 2,
        bob: 0.7,
        bobS: 31,
        phase: 2.4,
        turn: 1,
    }),
});

export const OCEAN_ROAM_MOTION = Object.freeze({
    /** Once the water allows them it fades in from the water colour over this many seconds. */
    arriveS: 5,
    /** It swims mostly level: the vertical share of its heading is scaled by this. */
    pitch: 0.35,
});

/**
 * A lane beside another animal's route (the calf's beside its mother's): `inward` nearer the
 * column, `shorter` of its length, `above` it and `lead` (rad) ahead of it. It keeps the route's
 * period, so the two swim together.
 * @param {OceanRoute} r
 * @param {{ inward: number, shorter: number, above: number, lead: number }} lane
 * @returns {OceanRoute}
 */
export function roamLane(r, lane) {
    return Object.freeze({
        ...r,
        out: r.out - lane.inward,
        along: r.along - lane.shorter,
        y: r.y + lane.above,
        phase: r.phase + lane.lead,
    });
}

/** Where on its route an animal is at time `t` (world), without its velocity. */
function placeOnRoute(r, t, out) {
    const w = TAU / r.period;
    // Round its loop at its own pace, which swells and slackens by `pace` (never stops).
    const a = (r.turn * ((w * t) + r.phase))
        + (r.pace * (r.paceS / r.period) * Math.sin(((TAU * t) / r.paceS) + (r.phase * 1.7)));
    const along = r.along * (1 + (r.breathe * Math.sin(((TAU * t) / r.breatheS) + (r.phase * 2.3))));
    const b = r.bearing * (Math.PI / 180);
    const ox = Math.cos(b);
    const oz = Math.sin(b);
    const u = Math.cos(a) * along; // round the column (the tangent is (-oz, ox))
    const v = Math.sin(a) * r.across; // out from it
    out.x = OCEAN_COLUMN.x + (ox * (r.out + v)) - (oz * u);
    out.y = r.y + (r.bob * Math.sin(((TAU * t) / r.bobS) + (r.phase * 0.7))) + (r.rise * Math.cos(a));
    out.z = OCEAN_COLUMN.z + (oz * (r.out + v)) + (ox * u);
    return out;
}

const _ahead = { x: 0, y: 0, z: 0 };
const _behind = { x: 0, y: 0, z: 0 };

/**
 * An animal's place on its route at time `t` (world), and its velocity there when asked for.
 * @param {OceanRoute} r
 * @param {number} t seconds (the board's clock)
 * @param {{ x: number, y: number, z: number }} out written
 * @param {{ x: number, y: number, z: number }} [velocity] written when given (u/s)
 * @returns {{ x: number, y: number, z: number }} out
 */
export function roamAt(r, t, out, velocity) {
    placeOnRoute(r, t, out);
    if (velocity) {
        const h = 0.05;
        placeOnRoute(r, t + h, _ahead);
        placeOnRoute(r, t - h, _behind);
        velocity.x = (_ahead.x - _behind.x) / (2 * h);
        velocity.y = (_ahead.y - _behind.y) / (2 * h);
        velocity.z = (_ahead.z - _behind.z) / (2 * h);
    }
    return out;
}

/**
 * One step of an animal's arrival: 0 the moment the water allows it, 1 after OCEAN_ROAM_MOTION.
 * arriveS seconds. `state.arrive` is kept; returns its fade (eased).
 * @param {{ arrive?: number }} state
 * @param {number} dt seconds
 * @returns {number}
 */
export function stepRoamArrival(state, dt) {
    const h = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.1);
    state.arrive = Math.min(1, (state.arrive ?? 0) + (h / OCEAN_ROAM_MOTION.arriveS));
    const s = state.arrive;
    return s * s * (3 - (2 * s));
}

/**
 * The heading an animal swims along from its velocity: mostly level (OCEAN_ROAM_MOTION.pitch).
 * @param {{ x: number, y: number, z: number }} velocity
 * @param {{ x: number, y: number, z: number }} out unit, written
 * @param {{ x: number, y: number, z: number }} [fallback] when it is not moving
 * @returns {{ x: number, y: number, z: number }} out
 */
export function roamHeading(velocity, out, fallback = { x: 0, y: 0, z: 1 }) {
    out.x = velocity.x;
    out.y = velocity.y * OCEAN_ROAM_MOTION.pitch;
    out.z = velocity.z;
    const l = Math.hypot(out.x, out.y, out.z);
    if (l < 1e-6) {
        out.x = fallback.x;
        out.y = fallback.y;
        out.z = fallback.z;
        return out;
    }
    out.x /= l;
    out.y /= l;
    out.z /= l;
    return out;
}
