// @ts-check
/**
 * @fileoverview THE OCEAN'S ESCORT — every animal with the traveller through chapter 2 (2026-10-23).
 *
 * Olov: "i want all of them to be visible and swimming around when entering the chapter and while
 * drifting in the chapter."
 *
 * Measured in the live journey's own idle drift up the ocean (~50 s once the steam clears): the
 * animals had one stretch each (2026-10-22, eye-height windows keyed to the orbs' parks), so the
 * whale shark kept company for ~20 s, the mother and calf were in frame for ~4 s, the manta for
 * ~7 s just under the surface, and for long stretches nothing but fish was in the water.
 *
 * Now every animal escorts the eye through the whole chapter. Each has a SLOT in the journey's
 * view — the rail camera, where the follow camera stands at the eye's progress whatever an orb
 * close-up or a free look is doing — a direction on screen and a distance, kept clear of the rail
 * (the middle of the frame) and the orb (low in the middle) and of each other. Its anchor swims
 * after that point (critically damped, so it trails the drift and catches up when the eye parks),
 * and it swims loops round the anchor. It stays in the water: where its slot's ray leaves the
 * water before its distance it comes nearer along the ray, and failing that it sits lower in the
 * view, so near the surface the animals gather under it, ahead of the eye.
 *
 * Arrival: they swim in from the blue the first time they can be seen (from `reach` times their
 * distance), as the steam clears on the way up from chapter 1, or after a jump to the ocean.
 *
 * Pure: no three.js (vectors are anything with x, y, z).
 */

/**
 * Slots: `x`, `y` on screen (NDC of the rail camera); `distance` from the eye; `nearest` the
 * closest it may come to keep its slot in the water; `under` how far under the surface it swims
 * at most (its body clear of it); `loop` its swim round the anchor (radius and lift in world
 * units, period s, phase rad).
 */
export const OCEAN_ESCORT = Object.freeze({
    whaleShark: Object.freeze({
        x: -0.62,
        y: 0.1,
        distance: 125,
        nearest: 62,
        under: 9,
        keep: 0.68,
        loop: Object.freeze({
            radius: 18, period: 34, phase: 0.6, lift: 4,
        }),
    }),
    // The mother whale's anchor; the calf rides an inner lane beside her (odyssey-whale-pass.js).
    whales: Object.freeze({
        x: 0.55,
        y: 0.22,
        distance: 150,
        nearest: 72,
        under: 9,
        keep: 0.62,
        loop: Object.freeze({
            radius: 20, period: 44, phase: 2.1, lift: 3,
        }),
    }),
    manta: Object.freeze({
        x: -0.3,
        y: 0.66,
        distance: 80,
        nearest: 32,
        under: 4,
        keep: 0.3,
        loop: Object.freeze({
            radius: 10, period: 22, phase: 2.4, lift: 2,
        }),
    }),
});

export const OCEAN_ESCORT_MOTION = Object.freeze({
    /** The anchor's spring (rad/s): it settles in ~4 s and trails the drift by a few units. */
    omega: 3,
    /** A jump farther than this (the eye cut to another orb or chapter) re-seats it: it arrives again. */
    snap: 140,
    /** It arrives over this many seconds... */
    arriveS: 5,
    /** ...from this many times its slot's distance, out along the same line of sight. */
    reach: 1.9,
    /** It swims mostly level: the vertical share of its heading is scaled by this. */
    pitch: 0.35,
    /** How strongly an animal sliding down the frame also slides outward on its own side. */
    spread: 0.8,
    /** The formation's view frame follows where the camera looks at this rate (rad/s)... */
    frameOmega: 6,
    /** ...but its turn ABOUT that line of sight only at this rate: when the rail bends while the
     * eye looks up, the camera spins about its view and the animals keep their places in the
     * water (the formation turns round the frame's centre, in view, together) instead of being
     * swung across the frame and scattered. */
    spinOmega: 0.6,
});

const len = (a) => Math.hypot(a.x, a.y, a.z);

/**
 * @typedef {{ x: number, y: number, z: number }} Vec
 * @typedef {object} EscortView the journey's view (the rail camera)
 * @property {Vec} position
 * @property {Vec} forward unit, into the screen
 * @property {Vec} right unit
 * @property {Vec} up unit
 * @property {number} tanHalf tan(vertical fov / 2)
 * @property {number} aspect width / height
 */

/**
 * Where an animal's slot is in the world for this view: along its line of sight at its distance,
 * or nearer (down to `keep` of its distance), or further down the frame (toward the world's down),
 * so that it is in the water (`seaLevel - slot.under` and below).
 * @param {EscortView} view
 * @param {{ x: number, y: number, distance: number, nearest: number, under: number, keep?: number }} slot
 * @param {number} seaLevel world y of the surface
 * @param {Vec} out written
 * @returns {Vec} out
 */
export function resolveEscortTarget(view, slot, seaLevel, out) {
    const eye = view.position;
    const top = seaLevel - slot.under;
    const ax = view.tanHalf * view.aspect;
    const ay = view.tanHalf;
    const dir = { x: 0, y: 0, z: 0 };
    // The line of sight through screen point (x, y) (into `dir`), and how far along it the water
    // reaches.
    const sight = (x, y) => {
        dir.x = view.forward.x + (view.right.x * x * ax) + (view.up.x * y * ay);
        dir.y = view.forward.y + (view.right.y * x * ax) + (view.up.y * y * ay);
        dir.z = view.forward.z + (view.right.z * x * ax) + (view.up.z * y * ay);
        const l = len(dir) || 1;
        dir.x /= l;
        dir.y /= l;
        dir.z /= l;
        if (eye.y > top) return dir.y < -1e-4 ? Math.min(slot.distance, 1e6) : -1;
        return dir.y > 1e-4 ? (top - eye.y) / dir.y : Infinity;
    };
    const place = (d) => {
        out.x = eye.x + (dir.x * d);
        out.y = eye.y + (dir.y * d);
        out.z = eye.z + (dir.z * d);
        return out;
    };
    // It holds its place on screen while it can stay `keep` of its distance away (coming nearer as
    // the water above runs out); below that it slides across the screen toward the world's down
    // (the frame may be rolled) just as far as it must. The slide is continuous in the view (found
    // by bisection), so a camera tilting from looking up to looking ahead moves it smoothly.
    const keepAt = Math.max(slot.nearest, slot.distance * (slot.keep ?? 1));
    if (sight(slot.x, slot.y) >= keepAt) return place(Math.min(slot.distance, sight(slot.x, slot.y)));
    // Which way it slides: outward from the frame's centre along its own line first (the formation
    // keeps its arrangement; looking up, every way out from the centre goes down in the water)...
    const EDGE = 0.92;
    const limit = (p, g) => {
        if (g > 1e-6) return (EDGE - p) / g;
        if (g < -1e-6) return (-EDGE - p) / g;
        return Infinity;
    };
    const slide = (gxIn, gyIn) => {
        const gl = Math.hypot(gxIn, gyIn) || 1;
        const gx = gxIn / gl;
        const gy = gyIn / gl;
        const sMax = Math.max(0, Math.min(limit(slot.x, gx), limit(slot.y, gy)));
        const at = (k) => sight(slot.x + (gx * k), slot.y + (gy * k));
        if (!(at(sMax) >= keepAt)) return { at, sMax, found: false };
        let lo = 0;
        let hi = sMax;
        for (let i = 0; i < 14; i += 1) {
            const mid = (lo + hi) / 2;
            if (at(mid) >= keepAt) hi = mid;
            else lo = mid;
        }
        place(Math.min(slot.distance, at(hi)));
        return { at, sMax, found: true };
    };
    const outward = slide(slot.x * view.aspect, slot.y);
    if (outward.found) return out;
    // ...then downhill on screen (the frame may be rolled), and outward on its own side.
    const gdx = -view.right.y * ax;
    const gdy = -view.up.y * ay;
    const gdl = Math.hypot(gdx, gdy) || 1;
    const downhill = slide((gdx / gdl) + (Math.sign(slot.x) * OCEAN_ESCORT_MOTION.spread), gdy / gdl);
    if (downhill.found) return out;
    // Not even the frame's edge has the room at that distance: a little inside the edge on its own
    // line it comes nearer instead, as near as the water above makes it (never nearer than
    // `nearest`), or failing that downhill...
    const outwardIn = outward.at(outward.sMax * 0.8);
    if (outwardIn >= slot.nearest) return place(Math.min(slot.distance, outwardIn));
    const downhillIn = downhill.at(downhill.sMax * 0.8);
    if (downhillIn >= slot.nearest) return place(Math.min(slot.distance, downhillIn));
    // ...and with no room at all, its nearest point, held under the surface.
    place(slot.nearest);
    out.y = Math.min(out.y, top);
    return out;
}

/**
 * The formation's own view frame: the journey's view (`view`), turned after by
 * OCEAN_ESCORT_MOTION.frameOmega, re-seated on a jump (a turn of more than ~70 degrees in one
 * step). `state` keeps it; returns a view (the eye where it is now) to resolve the slots in.
 * @param {{ forward?: Vec, up?: Vec }} state
 * @param {EscortView} view
 * @param {number} dt seconds
 * @param {number} [omega] its turn rate (rad/s)
 * @returns {EscortView}
 */
export function stepEscortFrame(state, view, dt, omega = OCEAN_ESCORT_MOTION.frameOmega) {
    const norm = (v) => {
        const l = len(v) || 1;
        return { x: v.x / l, y: v.y / l, z: v.z / l };
    };
    const jump = state.forward && ((state.forward.x * view.forward.x) + (state.forward.y * view.forward.y)
        + (state.forward.z * view.forward.z)) < 0.34;
    if (!state.forward || !state.up || jump) {
        state.forward = { ...view.forward };
        state.up = { ...view.up };
    } else {
        const h = Math.min(Math.max(dt || 0, 0), 0.1);
        const mix = (a, b, k) => ({
            x: a.x + ((b.x - a.x) * k), y: a.y + ((b.y - a.y) * k), z: a.z + ((b.z - a.z) * k),
        });
        state.forward = norm(mix(state.forward, view.forward, 1 - Math.exp(-omega * h)));
        // The slow spin only while the eye looks up (there a spin turns the formation round the
        // frame's centre); looking ahead, a lagging spin would tip it, so it follows.
        const upness = Math.min(1, Math.max(0, (Math.abs(view.forward.y) - 0.85) / 0.13));
        const spin = omega + ((OCEAN_ESCORT_MOTION.spinOmega - omega) * upness);
        state.up = norm(mix(state.up, view.up, 1 - Math.exp(-spin * h)));
    }
    // Orthonormal again: up square to forward, right = forward x up.
    const f = state.forward;
    const d = (state.up.x * f.x) + (state.up.y * f.y) + (state.up.z * f.z);
    const up = norm({ x: state.up.x - (f.x * d), y: state.up.y - (f.y * d), z: state.up.z - (f.z * d) });
    state.up = up;
    const right = {
        x: (f.y * up.z) - (f.z * up.y),
        y: (f.z * up.x) - (f.x * up.z),
        z: (f.x * up.y) - (f.y * up.x),
    };
    return {
        position: view.position, forward: f, up, right, tanHalf: view.tanHalf, aspect: view.aspect,
    };
}

/**
 * One step of an anchor swimming after its target: critically damped (exact for any dt), re-seated
 * on a jump. `state.pos` / `state.vel` are written; returns true when it was re-seated (it must
 * arrive again).
 * @param {{ pos?: Vec|null, vel?: Vec }} state
 * @param {Vec} target
 * @param {number} dt seconds
 * @returns {boolean}
 */
export function stepEscortAnchor(state, target, dt) {
    const M = OCEAN_ESCORT_MOTION;
    if (!state.pos || Math.hypot(state.pos.x - target.x, state.pos.y - target.y, state.pos.z - target.z) > M.snap) {
        state.pos = { x: target.x, y: target.y, z: target.z };
        state.vel = { x: 0, y: 0, z: 0 };
        return true;
    }
    const h = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.1);
    const e = Math.exp(-M.omega * h);
    const vel = state.vel || (state.vel = { x: 0, y: 0, z: 0 });
    ['x', 'y', 'z'].forEach((k) => {
        const x = state.pos[k] - target[k];
        const temp = (vel[k] + (M.omega * x)) * h;
        vel[k] = (vel[k] - (M.omega * temp)) * e;
        state.pos[k] = target[k] + ((x + temp) * e);
    });
    return false;
}

/**
 * An animal's swim round its anchor at time `t` (world offset), and its velocity there.
 * @param {{ radius: number, period: number, phase: number, lift: number }} loop
 * @param {number} t seconds
 * @param {Vec} out offset, written
 * @param {Vec} [velocity] written when given
 * @returns {Vec} out
 */
export function escortLoop(loop, t, out, velocity) {
    const w = (Math.PI * 2) / loop.period;
    const a = (t * w) + loop.phase;
    // A slightly squashed circle with a figure-of-eight swell, so the swim never reads as a turntable.
    const r = loop.radius * (1 + (0.18 * Math.sin((2 * a) + (loop.phase * 3))));
    out.x = Math.cos(a) * r;
    out.y = Math.sin((1.5 * a) + loop.phase) * loop.lift;
    out.z = Math.sin(a) * r * 0.8;
    if (velocity) {
        const dr = loop.radius * 0.36 * Math.cos((2 * a) + (loop.phase * 3)) * w;
        velocity.x = (-Math.sin(a) * r * w) + (Math.cos(a) * dr);
        velocity.y = Math.cos((1.5 * a) + loop.phase) * loop.lift * 1.5 * w;
        velocity.z = ((Math.cos(a) * r * w) + (Math.sin(a) * dr)) * 0.8;
    }
    return out;
}

/**
 * How much of its loop an animal swims where it is: the share of its slot's distance its target
 * has had to come in to (its loop scales with it, so a nearer animal does not swing out of frame).
 * @param {Vec} eye
 * @param {Vec} target
 * @param {{ distance: number }} slot
 * @returns {number} 0.35..1
 */
export function escortLoopScale(eye, target, slot) {
    const d = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z);
    return Math.min(1, Math.max(0.35, d / slot.distance));
}

/**
 * How far into its arrival an animal is drawn from: 1 at the start (out at `reach` times its
 * distance along the eye's line of sight to it), 0 once arrived.
 * @param {number} arrive 0..1
 * @returns {number}
 */
export function escortArrivalOut(arrive) {
    const t = Math.min(1, Math.max(0, arrive));
    const s = t * t * (3 - (2 * t));
    return 1 - s;
}

/**
 * The heading an animal swims along from its velocity: mostly level (OCEAN_ESCORT_MOTION.pitch).
 * @param {Vec} velocity
 * @param {Vec} out unit, written
 * @param {Vec} [fallback] when it is not moving
 * @returns {Vec} out
 */
export function escortHeading(velocity, out, fallback = { x: 0, y: 0, z: 1 }) {
    out.x = velocity.x;
    out.y = velocity.y * OCEAN_ESCORT_MOTION.pitch;
    out.z = velocity.z;
    const l = len(out);
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
