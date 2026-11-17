/**
 * Solar Eclipse — the flamingos on the CPU (three-free): where every bird is and how it is posed,
 * as a pure function of the clock and the layout, so a seek replays the same frame.
 *
 * As totality darkens the sky, greater flamingos come in to roost on the flooded salt flat:
 *
 *   FLIGHTS  now and then (one a slot of FLIGHT.period seconds, its start slipping within the
 *            slot by the flight's own hash) a loose line or shallow echelon of 5 to 12 birds
 *            crosses the whole frame low over the water in front of the band of light, necks
 *            stretched forward and legs trailing, each bird beating at its own pace and gliding
 *            now and then. A flight is a lane square to the view (gotcha #1707): one depth at the
 *            frame's middle, turned a little toward or away from the lens, one height over the
 *            water. Its birds enter beyond one edge of the frame and the flight ends once the
 *            last has left beyond the other, so no bird is ever switched on or off in view; on a
 *            very wide frame a flight flies faster rather than outstay its slot.
 *   FLOCK    a wading flock stands far out in the shallow water (FLOCK.distance), between the
 *            black sun's column and the card's left edge, so it never covers the sun's
 *            reflection. Each bird runs its own loop of acts, built once from its identity:
 *            feeding with its head swept to and fro in the water, standing, resting on one
 *            leg, now and then lifting its head or saluting with both wings, and walking slowly
 *            from one place of its own to the next (its stride follows the distance it covers).
 *            A bird's acts blend into each other joint by joint.
 *
 * Every bird's seed, phase and place come from its identity (a flight's slot number and the
 * bird's rank in it; a flock bird's own number), never from its place in a list, so nothing
 * re-randomises when another bird comes or goes (gotcha #1736).
 *
 * The bird is the theme's own (scripts/blender/solar_eclipse_flamingo.py writes
 * solar-eclipse-flamingo-model.js): sixteen bones, its poses as rows of Blender's evaluated rig.
 * Per bird per frame each joint's turn, offset and scale are blended between rows (two of the
 * wingbeat or the stride, a glide, a feeding sweep, a crossfade between acts), chained from the
 * body out, then turned to the bird's heading and carried to its place: sixteen finished bones,
 * two vec4 rows each, in the bird's block of the table the vertex stage reads.
 *
 * World: x east (right), y up, z south; the lens stands at the origin MIRROR.eye metres over the
 * water and looks north (−Z). A bird's frame: x its left, y up, z forward.
 */
import { SE_FLAMINGO } from './solar-eclipse-flamingo-model.js';
import {
    DEG, MIRROR, TAU, WORLD, clamp, mulberry32, smooth01, wrapAngle,
} from './solar-eclipse-core.js';
import { cardUnion } from './solar-eclipse-composition.js';

export const BONES = SE_FLAMINGO.bones.length;
/** vec4 rows a bird takes in the bone table: per bone its turn, then its place and scale. */
export const ROWS_PER_BIRD = BONES * 2;
const BIRD_FLOATS = ROWS_PER_BIRD * 4;
const POSE_FLOATS = BONES * 8;
const PARENTS = SE_FLAMINGO.parents;
const PIVOTS = SE_FLAMINGO.pivots;
const ROW = SE_FLAMINGO.rows;
const FLAP_ROWS = SE_FLAMINGO.flapRows;
const WALK_ROWS = SE_FLAMINGO.walkRows;
const SHANK_L = SE_FLAMINGO.bones.indexOf('shank.L');
const SHANK_R = SE_FLAMINGO.bones.indexOf('shank.R');

/**
 * The flights (metres, seconds, radians):
 *   period, jitter   one flight a slot of `period` s, starting up to `jitter` s into it
 *   depth            the lane's distance at the frame's middle
 *   slant            the most a lane turns toward or away from the lens
 *   height           over the water
 *   speed            along the lane (raised on a frame so wide the flight would outstay its slot)
 *   birds            how many in a line (the tier caps it)
 *   gap              metres between neighbours along the line; `echelon` the most the line
 *                    slants off the heading (toward or away from the lens)
 *   margin           how far beyond the frame's edge (radians) a bird appears and leaves: the
 *                    lens's sway and breath, the pointer's parallax and the bird's own size
 *   beat             wingbeats a second; `glide` how often a bird holds its wings out (rad/s)
 *   scale            the birds' size over a real greater flamingo's
 */
export const FLIGHT = Object.freeze({
    period: 66,
    jitter: 18,
    depth: Object.freeze([110, 200]),
    slant: 22 * DEG,
    height: Object.freeze([3.2, 7.2]),
    speed: Object.freeze([9.0, 11.0]),
    birds: Object.freeze([5, 12]),
    gap: Object.freeze([2.1, 3.0]),
    echelon: 34 * DEG,
    margin: 0.035,
    beat: Object.freeze([2.55, 3.05]),
    glide: Object.freeze([0.22, 0.38]),
    scale: 1.15,
    seed: 7121,
});
/** The longest a flight may take: it must be home before the next slot's earliest start. */
export const FLIGHT_LONGEST = FLIGHT.period - FLIGHT.jitter - 2;

/**
 * The wading flock (metres, seconds, radians):
 *   birds       the most the flock holds (the tier takes the first of them)
 *   distance    how far out they stand
 *   spread      the most bearing they stand over either side of the flock's centre
 *   roam        how far a bird's places lie from its home (across the view, along it)
 *   stops       how many places a bird keeps
 *   walk        walking speed; `stride` metres a whole stride (two steps) covers
 *   fade        seconds an act takes to blend into the next
 *   sweep       the feeding head's sweeps a second (rad/s)
 *   scale       the birds' size over a real greater flamingo's
 */
export const FLOCK = Object.freeze({
    birds: 20,
    distance: Object.freeze([150, 330]),
    spread: 4.2 * DEG,
    roam: Object.freeze([4, 1.6]),
    stops: Object.freeze([4, 6]),
    walk: 0.32,
    stride: 0.72,
    fade: 1.6,
    sweep: Object.freeze([2.0, 2.9]),
    scale: 1.18,
    seed: 4243,
});

// ── The model ─────────────────────────────────────────────────────────────────────────────

function decode(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

// Quaternions as [x, y, z, w].
function qMul(a, b, out) {
    const x = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1];
    const y = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0];
    const z = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3];
    const w = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2];
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
    return out;
}

/** v turned by q: v + 2 q.xyz × (q.xyz × v + w v). */
export function rotate(q, v, out = [0, 0, 0]) {
    const [x, y, z, w] = q;
    const cx = y * v[2] - z * v[1] + w * v[0];
    const cy = z * v[0] - x * v[2] + w * v[1];
    const cz = x * v[1] - y * v[0] + w * v[2];
    const rx = v[0] + 2 * (y * cz - z * cy);
    const ry = v[1] + 2 * (z * cx - x * cz);
    const rz = v[2] + 2 * (x * cy - y * cx);
    out[0] = rx;
    out[1] = ry;
    out[2] = rz;
    return out;
}

/**
 * Blender's rows (each bone's deform, rest to pose: turn, move, scale) as each joint's own turn
 * about its pivot relative to its parent, its scale relative to the parent's, and how far the
 * joint moved besides (`e`); the body's rows stay whole. Blending these, joint by joint, keeps
 * every joint where its parent holds it in any blend of rows.
 */
function jointRows(poses, rowCount) {
    const out = new Float32Array(poses.length);
    const qp = [0, 0, 0, 1];
    const q = [0, 0, 0, 1];
    const ql = [0, 0, 0, 1];
    const v = [0, 0, 0];
    for (let r = 0; r < rowCount; r += 1) {
        for (let b = 0; b < BONES; b += 1) {
            const o = (r * BONES + b) * 8;
            const p = PARENTS[b];
            if (p < 0) {
                out.set(poses.subarray(o, o + 8), o);
                continue;
            }
            const op = (r * BONES + p) * 8;
            for (let k = 0; k < 4; k += 1) q[k] = poses[o + k];
            qp[0] = -poses[op];
            qp[1] = -poses[op + 1];
            qp[2] = -poses[op + 2];
            qp[3] = poses[op + 3];
            qMul(qp, q, ql);
            const sign = ql[3] < 0 ? -1 : 1;
            const sp = poses[op + 7];
            const sc = poses[o + 7];
            // e = (the parent's deform)⁻¹(the child's deform(h)) − h
            const h = PIVOTS[b];
            rotate(q, h, v);
            for (let k = 0; k < 3; k += 1) v[k] = v[k] * sc + poses[o + 4 + k] - poses[op + 4 + k];
            rotate(qp, v, v);
            out[o] = ql[0] * sign;
            out[o + 1] = ql[1] * sign;
            out[o + 2] = ql[2] * sign;
            out[o + 3] = ql[3] * sign;
            out[o + 4] = v[0] / sp - h[0];
            out[o + 5] = v[1] / sp - h[1];
            out[o + 6] = v[2] / sp - h[2];
            out[o + 7] = sc / sp;
        }
    }
    return out;
}

let decoded = null;

/**
 * The flamingo, decoded once: rest positions (metres, its own frame), triangles, per vertex its
 * two bones, the first one's weight and its half-thickness (mm, 255 never widened), its plumage
 * and kind (255 solid, 128 a wing, 0 a thin tube), Blender's pose rows and the same rows joint by
 * joint.
 */
export function flamingoModel() {
    if (decoded) return decoded;
    const { quant } = SE_FLAMINGO;
    const poses = decode(SE_FLAMINGO.poses, Float32Array);
    decoded = Object.freeze({
        positions: Float32Array.from(decode(SE_FLAMINGO.positions, Int16Array), (v) => v * quant),
        index: decode(SE_FLAMINGO.index, Uint16Array),
        skin: decode(SE_FLAMINGO.skin, Uint8Array),
        colours: decode(SE_FLAMINGO.colours, Uint8Array),
        poses,
        joints: jointRows(poses, SE_FLAMINGO.rowCount),
        vertexCount: SE_FLAMINGO.vertexCount,
        triangleCount: SE_FLAMINGO.triangleCount,
        rows: SE_FLAMINGO.rowCount,
        checks: SE_FLAMINGO.checks,
    });
    return decoded;
}

// ── The pose ──────────────────────────────────────────────────────────────────────────────

const scratch = {
    q: [0, 0, 0, 1], q0: [0, 0, 0, 1], qp: [0, 0, 0, 1], qd: [0, 0, 0, 1], e: [0, 0, 0], v: [0, 0, 0], tl: [0, 0, 0],
};

/**
 * The bird's sixteen bones for a blend of rows: `weights` is a flat list of (row, weight) pairs
 * (`n` of them). Each joint's turn, offset and scale are blended between the rows, then chained
 * from the body out. Writes each bone's deform (qx, qy, qz, qw, tx, ty, tz, s) into `out`.
 */
export function flamingoPose(weights, n, out = new Float32Array(POSE_FLOATS)) {
    const { joints } = flamingoModel();
    const {
        q, q0, qp, qd, e, v, tl,
    } = scratch;
    for (let b = 0; b < BONES; b += 1) {
        q[0] = 0;
        q[1] = 0;
        q[2] = 0;
        q[3] = 0;
        e[0] = 0;
        e[1] = 0;
        e[2] = 0;
        let s = 0;
        let total = 0;
        for (let k = 0; k < n; k += 1) {
            const w = weights[k * 2 + 1];
            if (!(w > 0)) continue;
            const o = (weights[k * 2] * BONES + b) * 8;
            if (total === 0) {
                for (let c = 0; c < 4; c += 1) q0[c] = joints[o + c];
            }
            const dot = joints[o] * q0[0] + joints[o + 1] * q0[1] + joints[o + 2] * q0[2] + joints[o + 3] * q0[3];
            const sw = dot < 0 ? -w : w;
            for (let c = 0; c < 4; c += 1) q[c] += joints[o + c] * sw;
            for (let c = 0; c < 3; c += 1) e[c] += joints[o + 4 + c] * w;
            s += joints[o + 7] * w;
            total += w;
        }
        const inv = total > 0 ? 1 / total : 0;
        let len = Math.hypot(q[0], q[1], q[2], q[3]);
        if (!(len > 1e-9)) {
            q[3] = 1;
            len = 1;
        }
        for (let c = 0; c < 4; c += 1) q[c] /= len;
        for (let c = 0; c < 3; c += 1) e[c] *= inv;
        s = total > 0 ? s * inv : 1;
        const ob = b * 8;
        const p = PARENTS[b];
        if (p < 0) {
            for (let c = 0; c < 4; c += 1) out[ob + c] = q[c];
            for (let c = 0; c < 3; c += 1) out[ob + 4 + c] = e[c];
            out[ob + 7] = s;
            continue;
        }
        // L(x) = s R (x − h) + h + e; D = Dparent ∘ L.
        const h = PIVOTS[b];
        rotate(q, h, v);
        for (let c = 0; c < 3; c += 1) tl[c] = h[c] + e[c] - v[c] * s;
        const op = p * 8;
        for (let c = 0; c < 4; c += 1) qp[c] = out[op + c];
        const sp = out[op + 7];
        qMul(qp, q, qd);
        rotate(qp, tl, v);
        for (let c = 0; c < 4; c += 1) out[ob + c] = qd[c];
        for (let c = 0; c < 3; c += 1) out[ob + 4 + c] = v[c] * sp + out[op + 4 + c];
        out[ob + 7] = sp * s;
    }
    return out;
}

/** Vertex `i` of the bird under `pose` (its own frame, metres): the vertex stage's twin. */
export function flamingoVertex(i, pose) {
    const m = flamingoModel();
    const p = [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
    const out = [0, 0, 0];
    const r = [0, 0, 0];
    for (let k = 0; k < 2; k += 1) {
        const o = m.skin[i * 4 + k] * 8;
        const w = k === 0 ? m.skin[i * 4 + 2] / 255 : 1 - m.skin[i * 4 + 2] / 255;
        rotate([pose[o], pose[o + 1], pose[o + 2], pose[o + 3]], p, r);
        for (let c = 0; c < 3; c += 1) out[c] += (r[c] * pose[o + 7] + pose[o + 4 + c]) * w;
    }
    return out;
}

/** The lower of the two feet's tips under `pose` (its own frame, metres). */
export function lowestToe(pose) {
    let low = Infinity;
    const { v } = scratch;
    [[SHANK_L, SE_FLAMINGO.toes[0]], [SHANK_R, SE_FLAMINGO.toes[1]]].forEach(([b, toe]) => {
        const o = b * 8;
        rotate([pose[o], pose[o + 1], pose[o + 2], pose[o + 3]], toe, v);
        low = Math.min(low, v[1] * pose[o + 7] + pose[o + 5]);
    });
    return low;
}

/**
 * The turn that carries the bird's own frame (x its left, y up, z forward) into the world:
 * banked by `bank` about its body, then turned to `heading` (radians, as the world's bearings:
 * forward becomes (sin h, 0, −cos h)).
 */
export function headingTurn(heading, bank, out = [0, 0, 0, 1]) {
    const sy = Math.sin((Math.PI - heading) * 0.5);
    const cy = Math.cos((Math.PI - heading) * 0.5);
    const sr = Math.sin(bank * 0.5);
    const cr = Math.cos(bank * 0.5);
    out[0] = sy * sr;
    out[1] = sy * cr;
    out[2] = cy * sr;
    out[3] = cy * cr;
    return out;
}

/**
 * Carry a bird's bones (`pose`) into the world by `turnQ`, about `place` at `size`, into `out`
 * from float `at`: per bone a row (qx, qy, qz, qw) and a row (x, y, z, scale).
 */
export function placeBones(pose, turnQ, place, size, out, at) {
    const tq = scratch.qd;
    const tv = scratch.v;
    const pq = scratch.qp;
    for (let j = 0; j < BONES; j += 1) {
        const o = j * 8;
        for (let k = 0; k < 4; k += 1) pq[k] = pose[o + k];
        qMul(turnQ, pq, tq);
        tv[0] = pose[o + 4];
        tv[1] = pose[o + 5];
        tv[2] = pose[o + 6];
        rotate(turnQ, tv, tv);
        const ob = at + o;
        for (let k = 0; k < 4; k += 1) out[ob + k] = tq[k];
        for (let k = 0; k < 3; k += 1) out[ob + 4 + k] = place[k] + tv[k] * size;
        out[ob + 7] = size * pose[o + 7];
    }
}

// ── The view at rest ──────────────────────────────────────────────────────────────────────

/**
 * The lens at rest (no sway): vertical field of view `fov` (degrees), `aspect`, tilted up by
 * `pitch` (radians). The world's own composition (solar-eclipse-world.js restAngles).
 */
export function restView({ fov, aspect, pitch }) {
    const tanV = Math.tan((fov * DEG) / 2);
    return {
        fov, aspect, pitch, tanV, tanH: tanV * aspect, sp: Math.sin(pitch), cp: Math.cos(pitch),
    };
}

/** A world point (the lens at the origin) → the screen (fractions, y down) at rest, into `out`. */
export function projectRest(view, p, out = {
    x: 0, y: 0, depth: 0, front: false,
}) {
    const f = p[1] * view.sp - p[2] * view.cp;
    const up = p[1] * view.cp + p[2] * view.sp;
    const safe = Math.max(f, 1e-3);
    out.depth = f;
    out.front = f > 0.01;
    out.x = 0.5 + p[0] / safe / (2 * view.tanH);
    out.y = 0.5 - up / safe / (2 * view.tanV);
    return out;
}

/** The bearing (radians east of north) seen at screen x (y down) at rest. */
export function bearingAt(view, sx, sy) {
    const nx = (sx * 2 - 1) * view.tanH;
    const ny = (1 - sy * 2) * view.tanV;
    const z = -view.cp + ny * view.sp;
    return Math.atan2(nx, -z);
}

/**
 * Where the flock stands: the bearings (radians east of north) of its centre and half its width,
 * over the free space between the black sun's column (`sunX`, screen fractions) and the card's
 * left edge (a little of it behind the card), never wider than FLOCK.spread a side. With no free
 * space beside the card (a tall frame: the sun stands over it) it stands behind the card.
 */
export function flockSpan(view, layout, sunX, out = { centre: 0, half: 0 }) {
    const card = cardUnion(layout);
    let lo = sunX + 0.05;
    let hi = card ? card.x0 + 0.02 : 0.45;
    if (hi - lo < 0.06) {
        lo = 0.38;
        hi = 0.62;
    }
    const a = bearingAt(view, lo, WORLD.horizonY);
    const b = bearingAt(view, hi, WORLD.horizonY);
    out.centre = (a + b) * 0.5;
    out.half = Math.min(FLOCK.spread, Math.abs(b - a) * 0.5);
    return out;
}

// ── Identities ────────────────────────────────────────────────────────────────────────────

/** A seed from whole numbers (any sign): the same numbers, the same seed. */
export function seedOf(...parts) {
    let h = 0x9e3779b9;
    for (let i = 0; i < parts.length; i += 1) {
        h = Math.imul(h ^ (Math.round(parts[i]) | 0), 0x85ebca6b);
        h ^= h >>> 13;
        h = Math.imul(h, 0xc2b2ae35);
        h ^= h >>> 16;
    }
    return h >>> 0;
}

const between = (r, [a, b]) => a + (b - a) * r;

// ── The flights ───────────────────────────────────────────────────────────────────────────

/**
 * Flight `k` (its slot number) planned for `view`: when it leaves, which way it flies, its lane
 * and its line of birds (at most `most`). Pure: the same k, view and cap give the same flight.
 * `start` overrides when it leaves (a pinned flight).
 */
export function flightPlan(k, view, most = FLIGHT.birds[1], start = null) {
    const rand = mulberry32(seedOf(FLIGHT.seed, k));
    const at = start ?? (k * FLIGHT.period + rand() * FLIGHT.jitter);
    if (start !== null) rand();
    const dir = rand() < 0.5 ? 1 : -1;
    const depth = between(rand(), FLIGHT.depth);
    const slant = (rand() * 2 - 1) * FLIGHT.slant;
    const height = between(rand(), FLIGHT.height);
    let speed = between(rand(), FLIGHT.speed);
    const count = Math.min(most, FLIGHT.birds[0] + Math.floor(rand() * (FLIGHT.birds[1] - FLIGHT.birds[0] + 1)));
    const gap = between(rand(), FLIGHT.gap);
    // An echelon toward or away from the lens, or nearly a file.
    const echelon = (rand() < 0.35 ? rand() * 0.25 : 0.35 + rand() * 0.65) * FLIGHT.echelon * (rand() < 0.5 ? 1 : -1);
    const wave = rand() * TAU;
    const ts = Math.tan(slant);
    const travel = [dir * Math.cos(slant), 0, -dir * Math.sin(slant)];
    const side = [Math.sin(slant), 0, Math.cos(slant)];
    const birds = [];
    for (let i = 0; i < Math.max(0, count); i += 1) {
        const own = mulberry32(seedOf(FLIGHT.seed, k, i, 3));
        const back = i * gap * (0.85 + own() * 0.3) + (i > 0 ? (own() - 0.5) * 0.5 : 0);
        const aside = back * Math.tan(echelon) + (i > 0 ? (own() - 0.5) * 1.2 : 0);
        const up = i > 0 ? (own() - 0.5) * 0.7 : 0;
        birds.push({
            id: seedOf(FLIGHT.seed, k, i),
            rank: i,
            off: [
                -travel[0] * back + side[0] * aside,
                up,
                -travel[2] * back + side[2] * aside,
            ],
            size: FLIGHT.scale * (0.94 + own() * 0.14),
            beat: between(own(), FLIGHT.beat),
            phase: own(),
            glideRate: between(own(), FLIGHT.glide),
            glidePhase: own() * TAU,
            wander: own() * TAU,
        });
    }
    // Where the leader must be for each bird to stand at either edge of the frame (a little
    // beyond it): the flight starts with every bird outside and ends with every bird outside.
    const m = Math.tan(FLIGHT.margin);
    const tanH = (view.tanH + m) / (1 - view.tanH * m);
    const y = height - MIRROR.eye;
    let lo = Infinity;
    let hi = -Infinity;
    birds.forEach((b) => {
        const reach = tanH * ((y + b.off[1]) * view.sp + (depth - b.off[2]) * view.cp);
        const cs = tanH * ts * view.cp;
        const left = (-reach - b.off[0]) / (1 + cs);
        const right = (reach - b.off[0]) / (1 - cs);
        lo = Math.min(lo, left - 2.5);
        hi = Math.max(hi, right + 2.5);
    });
    const from = dir > 0 ? Math.min(lo, hi) : Math.max(lo, hi);
    const to = dir > 0 ? Math.max(lo, hi) : Math.min(lo, hi);
    const along = Math.abs(to - from) / Math.cos(slant);
    if (along / speed > FLIGHT_LONGEST) speed = along / FLIGHT_LONGEST;
    return {
        k,
        start: at,
        end: at + along / speed,
        dir,
        depth,
        slant,
        height,
        speed,
        wave,
        from,
        to,
        birds,
    };
}

/** The flights that may be in the air at `time`: the slot's own and the one before it. */
export function flightsAround(time) {
    const k = Math.floor(time / FLIGHT.period);
    return [k - 1, k];
}

/**
 * Bird `b` of flight `plan` at `time`: its place (world, metres), heading, bank, size, wingbeat
 * (turns) and glide (0..1), into `out`. Null when the flight is not in the air.
 */
export function flightBird(plan, b, time, out = {}) {
    const s = time - plan.start;
    if (s < 0 || time > plan.end) return null;
    const ts = Math.tan(plan.slant);
    const lead = plan.from + plan.dir * plan.speed * Math.cos(plan.slant) * s;
    // A loose line: each bird drifts a little in its place, and a slow wave runs down the line.
    const wx = Math.sin(time * 0.37 + b.wander) * 0.45;
    const wy = Math.sin(time * 0.71 - b.rank * 0.55 + plan.wave) * 0.28 + Math.sin(time * 0.29 + b.wander) * 0.12;
    const place = out.place || (out.place = [0, 0, 0]);
    place[0] = lead + b.off[0] + Math.sin(plan.slant) * wx;
    place[1] = plan.height - MIRROR.eye + b.off[1] + wy;
    place[2] = -(plan.depth + lead * ts) + b.off[2] + Math.cos(plan.slant) * wx;
    out.heading = Math.atan2(plan.dir * Math.cos(plan.slant), plan.dir * Math.sin(plan.slant))
        + Math.sin(time * 0.43 + b.wander * 1.7) * 0.03;
    out.bank = Math.sin(time * 0.5 + b.wander) * 0.05;
    out.size = b.size;
    out.beat = b.beat * s + b.phase;
    // Bursts of beats and short glides: a flamingo flaps far more than it glides.
    out.glide = smooth01((Math.sin(time * b.glideRate + b.glidePhase) - 0.62) / 0.3);
    out.id = b.id;
    return out;
}

/** The pose rows of a bird on the wing: two of the wingbeat, blended toward the glide. */
export function flightWeights(beat, glide, out = new Float32Array(6)) {
    const f = (beat - Math.floor(beat)) * FLAP_ROWS;
    const r0 = Math.min(FLAP_ROWS - 1, Math.floor(f));
    const a = f - r0;
    out[0] = ROW.Flap + r0;
    out[1] = (1 - a) * (1 - glide);
    out[2] = ROW.Flap + ((r0 + 1) % FLAP_ROWS);
    out[3] = a * (1 - glide);
    out[4] = ROW.Glide;
    out[5] = glide;
    return out;
}

// ── The wading flock ──────────────────────────────────────────────────────────────────────

export const ACT = Object.freeze({
    feed: 0, stand: 1, rest: 2, alert: 3, stretch: 4, walk: 5,
});
const STILL_ACTS = Object.freeze([
    // kind, share, shortest, longest (seconds)
    [ACT.feed, 0.44, 7, 16],
    [ACT.stand, 0.2, 4, 9],
    [ACT.rest, 0.16, 10, 22],
    [ACT.alert, 0.15, 2.5, 5],
    [ACT.stretch, 0.05, 2.6, 3.2],
]);
/** Seconds a walk spends getting up to speed and slowing down (its trapezoid's ramps). */
const WALK_RAMP = 0.9;

function pickStill(r) {
    let acc = 0;
    for (let i = 0; i < STILL_ACTS.length; i += 1) {
        acc += STILL_ACTS[i][1];
        if (r < acc) return STILL_ACTS[i];
    }
    return STILL_ACTS[0];
}

/** Metres a walk of `dur` seconds over `length` metres has covered `t` seconds in (trapezoid). */
function walked(t, dur, length) {
    if (!(length > 0)) return 0;
    const a = Math.min(WALK_RAMP, dur * 0.5);
    const v = length / (dur - a);
    const c = clamp(t, 0, dur);
    if (c < a) return (v * c * c) / (2 * a);
    if (c < dur - a) return v * (c - a * 0.5);
    const left = dur - c;
    return length - (v * left * left) / (2 * a);
}

/**
 * Flock bird `i`, built once from its identity: its home (where across the flock's width, -1 to
 * 1, and a distance), its size, and its loop of acts (each { kind, start, dur, x0, z0, x1, z1, h0, h1 }
 * in metres off its home and radians; a walk's length).
 */
export function flockBird(i) {
    const rand = mulberry32(seedOf(FLOCK.seed, i));
    const across = rand() * 2 - 1;
    const distance = between(rand() ** 0.85, FLOCK.distance);
    const size = FLOCK.scale * (0.92 + rand() * 0.14);
    const stops = FLOCK.stops[0] + Math.floor(rand() * (FLOCK.stops[1] - FLOCK.stops[0] + 1));
    const places = [];
    for (let j = 0; j < stops; j += 1) {
        places.push([(rand() * 2 - 1) * FLOCK.roam[0], (rand() * 2 - 1) * FLOCK.roam[1]]);
    }
    // Seen side on most of the time: a heading across the view, either way, a little off.
    let heading = (rand() < 0.5 ? 1 : -1) * (Math.PI / 2 + (rand() - 0.5) * 0.9);
    const acts = [];
    let t = 0;
    for (let j = 0; j < stops; j += 1) {
        const [x, z] = places[j];
        const still = 3 + Math.floor(rand() * 3);
        for (let a = 0; a < still; a += 1) {
            const [kind, , shortest, longest] = pickStill(rand());
            const dur = shortest + rand() * (longest - shortest);
            const turn = (rand() - 0.5) * 0.7;
            acts.push({
                kind, start: t, dur, x0: x, z0: z, x1: x, z1: z, h0: heading, h1: heading + turn, length: 0,
            });
            heading += turn;
            t += dur;
        }
        const [nx, nz] = places[(j + 1) % stops];
        const length = Math.hypot(nx - x, nz - z);
        const towards = Math.atan2(nx - x, -(nz - z));
        const dur = length / FLOCK.walk + WALK_RAMP;
        acts.push({
            kind: ACT.walk,
            start: t,
            dur,
            x0: x,
            z0: z,
            x1: nx,
            z1: nz,
            h0: heading,
            h1: heading + wrapAngle(towards - heading),
            length,
        });
        heading = acts[acts.length - 1].h1;
        t += dur;
    }
    // The loop closes: the first act turns on from the heading the last walk left it at.
    const settle = acts[0].h1;
    acts[0].h0 = heading;
    acts[0].h1 = heading + wrapAngle(settle - heading);
    return {
        id: seedOf(FLOCK.seed, i),
        index: i,
        across,
        distance,
        size,
        loop: t,
        offset: rand() * t,
        gait: rand(),
        sweep: between(rand(), FLOCK.sweep),
        sweepPhase: rand() * TAU,
        acts,
    };
}

/** The act a flock bird is in at loop time `lt` (binary search). */
function actAt(bird, lt) {
    const { acts } = bird;
    let lo = 0;
    let hi = acts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (acts[mid].start <= lt) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

/** Push an act's pose rows at its own time `tau` (seconds in) onto `w` scaled by `share`. */
function actRows(bird, act, tau, time, share, w, n) {
    let m = n;
    const push = (row, weight) => {
        if (weight <= 0) return;
        w[m * 2] = row;
        w[m * 2 + 1] = weight * share;
        m += 1;
    };
    if (act.kind === ACT.walk) {
        const cycle = bird.gait + walked(tau, act.dur, act.length) / FLOCK.stride;
        const f = (cycle - Math.floor(cycle)) * WALK_ROWS;
        const r0 = Math.min(WALK_ROWS - 1, Math.floor(f));
        const a = f - r0;
        push(ROW.Walk + r0, 1 - a);
        push(ROW.Walk + ((r0 + 1) % WALK_ROWS), a);
    } else if (act.kind === ACT.feed) {
        const side = 0.5 + 0.5 * Math.sin(time * bird.sweep + bird.sweepPhase);
        push(ROW.FeedL, side);
        push(ROW.FeedR, 1 - side);
    } else if (act.kind === ACT.stand) push(ROW.Stand, 1);
    else if (act.kind === ACT.rest) push(ROW.Rest, 1);
    else if (act.kind === ACT.alert) push(ROW.Alert, 1);
    else push(ROW.Stretch, 1);
    return m;
}

/**
 * Flock bird `bird` at `time` in the flock's `span` (flockSpan): its place (world, the water's
 * surface under it), heading, size and pose rows (`weights`, `n` of them), into `out`.
 */
export function flockBirdAt(bird, time, span, out = {}) {
    const lt = (((time + bird.offset) % bird.loop) + bird.loop) % bird.loop;
    const j = actAt(bird, lt);
    const act = bird.acts[j];
    const tau = lt - act.start;
    const prev = bird.acts[(j + bird.acts.length - 1) % bird.acts.length];
    // Where it is: walking between its places, else standing at one.
    const along = act.kind === ACT.walk && act.length > 0 ? walked(tau, act.dur, act.length) / act.length : 1;
    const lx = act.x0 + (act.x1 - act.x0) * along;
    const lz = act.z0 + (act.z1 - act.z0) * along;
    // Its heading: a walk turns toward where it goes over its first second and a half; a still
    // act drifts round slowly.
    const turn = act.kind === ACT.walk ? smooth01(tau / 1.5) : smooth01(tau / act.dur);
    const heading = act.h0 + (act.h1 - act.h0) * turn;
    const az = span.centre + bird.across * span.half;
    const place = out.place || (out.place = [0, 0, 0]);
    const ex = Math.sin(az);
    const ez = -Math.cos(az);
    // Its places lie across and along the line of sight from its home.
    place[0] = ex * bird.distance + (-ez) * lx + ex * -lz;
    place[1] = -MIRROR.eye;
    place[2] = ez * bird.distance + ex * lx + ez * -lz;
    out.heading = heading + az;
    out.size = bird.size;
    // The act it is in, blended in from the one before.
    const weights = out.weights || (out.weights = new Float32Array(8));
    const x = smooth01(tau / Math.min(FLOCK.fade, act.dur * 0.5));
    let n = 0;
    if (x < 1) n = actRows(bird, prev, prev.dur + tau, time, 1 - x, weights, n);
    n = actRows(bird, act, tau, time, x, weights, n);
    out.n = n;
    out.kind = act.kind;
    out.id = bird.id;
    return out;
}

// ── The table ─────────────────────────────────────────────────────────────────────────────

/**
 * Every bird this frame into `table` (Float32Array, BIRD_FLOATS a bird): the flock first (its
 * birds keep their slots), then the flight in the air (its bird of rank i in slot flock + i).
 * `scene`: { time, view, span (the flock's: flockSpan), flightMost (the most in a line), pinned
 * ({ k, start } or null) }. Returns { count, birds } with every bird's place (the tests).
 */
export function writeBirds(scene, flock, table, report = null) {
    const {
        time, view, span, flightMost, pinned,
    } = scene;
    const pose = writeBirds.pose || (writeBirds.pose = new Float32Array(POSE_FLOATS));
    const turnQ = writeBirds.turn || (writeBirds.turn = [0, 0, 0, 1]);
    const where = writeBirds.where || (writeBirds.where = [0, 0, 0]);
    const state = writeBirds.state || (writeBirds.state = {});
    const fw = writeBirds.fw || (writeBirds.fw = new Float32Array(6));
    let count = 0;
    for (let i = 0; i < flock.length; i += 1) {
        const s = flockBirdAt(flock[i], time, span, state);
        flamingoPose(s.weights, s.n, pose);
        // Its feet on the water: the lower foot stands on it.
        const lift = -lowestToe(pose) * s.size;
        where[0] = s.place[0];
        where[1] = s.place[1] + lift;
        where[2] = s.place[2];
        placeBones(pose, headingTurn(s.heading, 0, turnQ), where, s.size, table, count * BIRD_FLOATS);
        report?.push({
            id: s.id, kind: 'flock', place: [...where], foot: s.place[1], size: s.size, heading: s.heading,
        });
        count += 1;
    }
    if (flightMost > 0) {
        const plans = pinned
            ? [flightPlan(pinned.k, view, flightMost, pinned.start)]
            : flightsAround(time).map((k) => flightPlan(k, view, flightMost));
        for (let p = 0; p < plans.length; p += 1) {
            const plan = plans[p];
            if (time < plan.start || time > plan.end) continue;
            for (let i = 0; i < plan.birds.length; i += 1) {
                const s = flightBird(plan, plan.birds[i], time, state);
                flamingoPose(flightWeights(s.beat, s.glide, fw), 3, pose);
                placeBones(
                    pose,
                    headingTurn(s.heading, s.bank, turnQ),
                    s.place,
                    s.size,
                    table,
                    count * BIRD_FLOATS,
                );
                report?.push({
                    id: s.id, kind: 'flight', k: plan.k, place: [...s.place], size: s.size, heading: s.heading,
                });
                count += 1;
            }
        }
    }
    return count;
}

export { BIRD_FLOATS };
