// @ts-check
/**
 * THE DOLPHINS IN THE BAY (Odyssey masterpiece pass, follow-up 2026-11-17) — a new sight at the
 * breach.
 *
 * A small pod porpoises round the bay between the breach and the shore. From below, on the way
 * up, they are dark shapes crossing the bright water ahead; after the breach they are arcs out of
 * the sea in front of the island, each leaving a small splash where it left the water and where
 * it went back in.
 *
 * THEIR OWN SEA, as every animal here (odyssey-ocean-roam.js): a dolphin's place is a function of
 * the clock alone. The camera passes them; they are never attached to the view.
 *
 * THE ROUTE is a loop along the shore, dead ahead of the eye as it breaks the surface (an ellipse
 * walked at a steady pace by arc length, so they do not sprint the long sides and crawl the
 * ends). It lies beyond the manta's loop and the kelp tower and short of the shelf's kelp (the
 * reef's keep-out knows it), 95 to 150 u from the crossing: the whole loop is inside the frame
 * there and from orb 11's close-up. Two groups swim it half a lap apart, so at every clock phase
 * one is on the near side. Two scouts swim a smaller loop east of the column, where the climb
 * looks up at them near the window's rim.
 *
 * PORPOISING. Each dolphin's height is two parabolas joined without a corner: an arc through the
 * air (`leap` of its cycle, `height` high) and a dive under (the rest of the cycle, as deep as
 * the same take-off speed carries it). Its body pitches along its own path, arches with the
 * path's curve, and beats its flukes while it is in the water (it holds nearly still in the air).
 *
 * Pure: no three.js.
 */

const TAU = Math.PI * 2;

export const DOLPHIN_POD = Object.freeze({
    /** The loop: centre (world xz), half its length along the shore (x) and half its breadth (z). */
    centre: Object.freeze([-75, -128]),
    along: 40,
    across: 26,
    /** Pace along the loop (u/s) and which way round. */
    speed: 11,
    turn: 1,
    /** The share of a cycle spent in the air. */
    leap: 0.3,
    /**
     * The dolphins: where on the loop (`lag` u behind the group's lead, `side` u off the line),
     * `group` (0 or 1: the second swims half a loop away), body `length` (u), cycle `period` (s),
     * its `phase` in the cycle (0..1) and its leap's `height` (u).
     */
    dolphins: Object.freeze([
        Object.freeze({
            group: 0, lag: 0, side: 0, length: 11.5, period: 5.6, phase: 0.00, height: 3.8,
        }),
        Object.freeze({
            group: 0, lag: 9, side: 4.5, length: 10.4, period: 5.6, phase: 0.16, height: 3.5,
        }),
        Object.freeze({
            group: 0, lag: 16, side: -4.0, length: 8.4, period: 5.2, phase: 0.47, height: 3.0,
        }),
        Object.freeze({
            group: 1, lag: 0, side: 0, length: 11.0, period: 5.9, phase: 0.31, height: 3.7,
        }),
        Object.freeze({
            group: 1, lag: 10, side: -4.5, length: 10.0, period: 5.9, phase: 0.52, height: 3.3,
        }),
        // The scouts: two on their own smaller loop over the column's east side, where the climb
        // looks up at them crossing the window's bright rim.
        Object.freeze({
            scout: true, group: 0, lag: 0, side: 0, length: 10.6, period: 5.4, phase: 0.08, height: 2.7,
        }),
        Object.freeze({
            scout: true, group: 0, lag: 11, side: 3.5, length: 9.2, period: 5.4, phase: 0.36, height: 2.5,
        }),
    ]),
    /** The scouts' loop (the same fields as the pod's own). */
    scouts: Object.freeze({
        centre: Object.freeze([22, -46]), along: 30, across: 22, speed: 8.5, turn: -1,
    }),
    /** The low tier's pod: the first group alone. */
    lowCount: 3,
    /** Tail beats per second in the water, and how much of the beat it keeps in the air. */
    beatHz: 1.5,
    airBeat: 0.2,
    /** A splash's life (s). */
    splashLife: 1.5,
});

const TABLE = 512;
/** @type {Map<string, { key: string, length: number, s: Float64Array }>} */
const tables = new Map();

/** The loop's arc-length table: cumulative length at TABLE steps of its angle. */
function loopTable(spec) {
    const key = `${spec.along}:${spec.across}`;
    const known = tables.get(key);
    if (known) return known;
    const s = new Float64Array(TABLE + 1);
    let px = spec.along;
    let pz = 0;
    for (let i = 1; i <= TABLE; i += 1) {
        const a = (i / TABLE) * TAU;
        const x = Math.cos(a) * spec.along;
        const z = Math.sin(a) * spec.across;
        s[i] = s[i - 1] + Math.hypot(x - px, z - pz);
        px = x;
        pz = z;
    }
    const made = { key, length: s[TABLE], s };
    tables.set(key, made);
    return made;
}

/**
 * A closed swimming loop: the pod's own, or the scouts' smaller one.
 * @typedef {{ centre: readonly number[], along: number, across: number, speed: number, turn: number }} DolphinLoop
 */
/**
 * One dolphin's place in its group and the measure of its leap.
 * @typedef {{ group: number, lag: number, side: number, length: number, period: number, phase: number,
 *   height: number, scout?: boolean }} DolphinSpec
 */

/**
 * The loop's whole length (u).
 * @param {DolphinLoop} [spec]
 */
export function dolphinLoopLength(spec = DOLPHIN_POD) {
    return loopTable(spec).length;
}

/**
 * The point `arc` u along the loop (world xz), its unit tangent, and the loop's curvature there.
 * @param {number} arc
 * @param {{ x: number, z: number, tx: number, tz: number }} [out]
 * @param {DolphinLoop} [spec]
 */
export function dolphinLoopAt(arc, out = {
    x: 0, z: 0, tx: 1, tz: 0,
}, spec = DOLPHIN_POD) {
    const t = loopTable(spec);
    const wrapped = ((arc % t.length) + t.length) % t.length;
    let lo = 0;
    let hi = TABLE;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (t.s[mid] <= wrapped) lo = mid; else hi = mid;
    }
    const f = (wrapped - t.s[lo]) / Math.max(1e-9, t.s[hi] - t.s[lo]);
    const a = ((lo + f) / TABLE) * TAU * spec.turn;
    out.x = spec.centre[0] + (Math.cos(a) * spec.along);
    out.z = spec.centre[1] + (Math.sin(a) * spec.across);
    const dx = -Math.sin(a) * spec.along * spec.turn;
    const dz = Math.cos(a) * spec.across * spec.turn;
    const l = Math.hypot(dx, dz) || 1;
    out.tx = dx / l;
    out.tz = dz / l;
    return out;
}

/**
 * A dolphin's height over the sea at cycle position `c` (0..1) and its vertical speed per unit
 * of cycle: the leap's parabola, then the dive's, joined with one slope.
 * @param {number} c cycle position, 0 at take-off
 * @param {number} height the leap's height (u)
 * @returns {{ y: number, dy: number }} dy is per unit of cycle (divide by the period for u/s)
 */
export function porpoiseAt(c, height, out = { y: 0, dy: 0 }, spec = DOLPHIN_POD) {
    const f = spec.leap;
    const cc = ((c % 1) + 1) % 1;
    if (cc < f) {
        const u = cc / f;
        out.y = 4 * height * u * (1 - u);
        out.dy = (4 * height * (1 - (2 * u))) / f;
        return out;
    }
    // As deep as the take-off speed carries it over the longer span: depth = height (1 - f) / f.
    const depth = (height * (1 - f)) / f;
    const w = (cc - f) / (1 - f);
    out.y = -4 * depth * w * (1 - w);
    out.dy = (-4 * depth * (1 - (2 * w))) / (1 - f);
    return out;
}

/**
 * @typedef {object} DolphinPose
 * @property {number} x world
 * @property {number} y height over the sea (add the sea level)
 * @property {number} z world
 * @property {number} yaw heading in the xz plane (rad, atan2(tx, tz))
 * @property {number} pitch nose up (rad)
 * @property {number} bend how much the path curves over one body length (rad; negative arching over)
 * @property {number} beat the tail beat's phase (rad)
 * @property {number} beatAmp 1 in the water, DOLPHIN_POD.airBeat in the air
 * @property {number} cycle its cycle position 0..1 (0 at take-off, `leap` at re-entry)
 */

const _loop = {
    x: 0, z: 0, tx: 1, tz: 0,
};
const _p = { y: 0, dy: 0 };
const _q = { y: 0, dy: 0 };

/**
 * Where dolphin `d` is at world time `t`.
 * @param {DolphinSpec} d
 * @param {number} t seconds (the board's clock)
 * @param {DolphinPose} [out]
 * @returns {DolphinPose}
 */
export function dolphinAt(d, t, out = /** @type {DolphinPose} */ ({}), spec = DOLPHIN_POD) {
    const time = Number.isFinite(t) ? t : 0;
    /** @type {DolphinLoop} */
    const lp = d.scout ? spec.scouts : spec;
    const length = dolphinLoopLength(lp);
    const arc = (lp.speed * time) + (d.group * length * 0.5) - d.lag;
    dolphinLoopAt(arc, _loop, lp);
    // Off the line to its own side (the line's left is (-tz, tx)).
    out.x = _loop.x - (_loop.tz * d.side);
    out.z = _loop.z + (_loop.tx * d.side);
    out.yaw = Math.atan2(_loop.tx, _loop.tz);
    const c = ((((time / d.period) + d.phase) % 1) + 1) % 1;
    porpoiseAt(c, d.height, _p, spec);
    out.y = _p.y;
    out.pitch = Math.atan2(_p.dy / d.period, lp.speed);
    // The path's turn over one body length, from the pitch a moment before and after.
    const h = 0.04;
    porpoiseAt(c + (h / d.period), d.height, _q, spec);
    const ahead = Math.atan2(_q.dy / d.period, lp.speed);
    porpoiseAt(c - (h / d.period), d.height, _q, spec);
    const behind = Math.atan2(_q.dy / d.period, lp.speed);
    out.bend = ((ahead - behind) / (2 * h)) * (d.length / lp.speed);
    out.beat = TAU * spec.beatHz * time + (d.phase * 9);
    // In the water it beats; out of it, it holds (eased across the surface, over ~a body's depth).
    const wet = Math.max(0, Math.min(1, 0.5 - (out.y / (d.length * 0.25))));
    out.beatAmp = spec.airBeat + ((1 - spec.airBeat) * wet * wet * (3 - (2 * wet)));
    out.cycle = c;
    return out;
}

/**
 * A surface mark: where (world xz), how long ago (s), and which way the dolphin was swimming there
 * (the loop's unit tangent).
 * @typedef {{ x: number, z: number, age: number, tx?: number, tz?: number }} DolphinMark
 */
/**
 * The two marks a dolphin leaves on the surface: where it last left the water and where it last
 * went back in, with the age of each (s) and its heading there. The splashes are drawn there
 * until `splashLife`; from below, the air it took down follows its heading into the dive.
 * @param {DolphinSpec} d
 * @param {number} t
 * @param {{ exit: DolphinMark, entry: DolphinMark }} [out]
 */
export function dolphinSplashes(d, t, out = { exit: { x: 0, z: 0, age: 0 }, entry: { x: 0, z: 0, age: 0 } }, spec = DOLPHIN_POD) {
    const time = Number.isFinite(t) ? t : 0;
    const c = ((((time / d.period) + d.phase) % 1) + 1) % 1;
    /** @type {DolphinLoop} */
    const lp = d.scout ? spec.scouts : spec;
    const length = dolphinLoopLength(lp);
    const mark = (age, into) => {
        const arc = (lp.speed * (time - age)) + (d.group * length * 0.5) - d.lag;
        dolphinLoopAt(arc, _loop, lp);
        into.x = _loop.x - (_loop.tz * d.side);
        into.z = _loop.z + (_loop.tx * d.side);
        into.age = age;
        into.tx = _loop.tx;
        into.tz = _loop.tz;
    };
    mark(c * d.period, out.exit);
    mark((c >= spec.leap ? c - spec.leap : c + 1 - spec.leap) * d.period, out.entry);
    return out;
}

/**
 * A dolphin's dive under the surface: how deep its middle goes (u) and how long it is under (s).
 * The same take-off speed that carries it `height` up carries it `depth` down, over the longer
 * span of its cycle (porpoiseAt).
 * @param {DolphinSpec} d
 * @returns {{ depth: number, time: number, speed: number }} speed: its pace along the loop (u/s)
 */
export function dolphinDive(d, spec = DOLPHIN_POD) {
    const lp = d.scout ? spec.scouts : spec;
    return { depth: (d.height * (1 - spec.leap)) / spec.leap, time: (1 - spec.leap) * d.period, speed: lp.speed };
}

/**
 * The loop sampled as points (world xz), for what must keep clear of it.
 * @param {number} [step]
 * @param {DolphinLoop} [spec]
 */
export function dolphinLoopPoints(step = 6, spec = DOLPHIN_POD) {
    const pts = [];
    const length = dolphinLoopLength(spec);
    for (let arc = 0; arc < length; arc += step) {
        dolphinLoopAt(arc, _loop, spec);
        pts.push({ x: _loop.x, z: _loop.z });
    }
    return pts;
}
