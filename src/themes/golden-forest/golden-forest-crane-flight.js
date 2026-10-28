/**
 * Golden Forest — how the cranes fly (three-free: the vertex stage in golden-forest-birds.js only
 * folds each bird's wings by the hinge angles written here and sets it where this module puts it).
 *
 * Common cranes gathering at the lake to roost, in two kinds of flight:
 *  - THE KETTLE: a column of cranes circling over the far shore, each on a circle of its own at
 *    its own height, all turning the same way, wings spread flat and still with the fingers
 *    curled up, banked into the turn; now and then a bird beats a few strokes. The column drifts
 *    slowly to and fro over the far water. A big clear startles it: the circles burst wide, the
 *    column lifts and every bird beats hard until it settles.
 *  - THE SKEIN: a V of cranes crossing the sky on a long lane through the low sun, beating
 *    slowly and steadily (a wave of strokes running down each arm), each bird a little loose in
 *    its slot; each pass is a different skein (its V, its height, its distance, its line).
 *
 * Where a bird is is a function of the clock (and the startle as the world eases it); only the
 * wingbeat's phase is integrated, so a startle quickens the beat without a jump. Each frame
 * `write()` poses every bird into one of two instance arrays (near and far: the two levels of
 * detail): place and drawn size, heading and the wingbeat's heave, up (the bank leaning into a
 * turn) and the five hinge angles of the wing (lift, sweep, bend, fold, curl), built from the
 * poses the Blender script authored (scripts/blender/golden_forest/crane.py) and wrote into the
 * manifest.
 */
import manifest from './assets/asset-manifest.json';

const TAU = Math.PI * 2;
const GRAVITY = 9.81;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
};

const record = manifest.assets.find((entry) => entry.kind === 'crane');

/** The rig the model was built on: hinge pivots, the bands they take hold over, the poses. */
export const CRANE_RIG = Object.freeze(record?.rig ?? {
    span: 2.2,
    length: 1.21,
    shoulder: [0.08, 0.04, 0.08],
    wrist: [0.54, 0.04, 0.15],
    downstroke: 0.6,
    poses: {},
});
/** A common crane's span (m); the model is real size. */
export const CRANE_SPAN = CRANE_RIG.span;

/** Floats a bird in the instance array: place + size, forward + heave, up + lift, sweep bend fold curl. */
export const CRANE_STRIDE = 16;

/**
 * Wingbeats a second: a crane's slow cruise beat and each bird's own spread about it; how much
 * faster a fully startled bird beats.
 */
export const CRANE_BEAT = Object.freeze({ cruise: 2.3, spread: 0.05, startled: 0.55 });

/**
 * The smallest a bird is drawn, as the angle its span fills (rad): far skeins stay a readable
 * size (about 10 px at 1080p), drawn larger than life and as far off as their size says.
 */
export const CRANE_MIN_SPAN_ANGLE = 0.0088;
/** A bird whose span fills more than this angle (rad, about 22 px at 1080p) gets the near mesh. */
export const CRANE_NEAR_SPAN_ANGLE = 0.019;

/**
 * The kettle (metres, seconds): its column's centre drifts round a slow loop over the far
 * water (centre x/z, the loop's half widths, its height and how far that rises and falls, the
 * period, how much longer it lingers at either end and how much longer still over the open sky
 * right of the board than in the gap above the sun, between the board and the old spruce); each bird circles at `radius` m, `speed` m/s round its circle, `layers` m above or
 * below the column's centre; the share of the time a bird beats instead of soaring; and what a
 * full startle does (the circles widened by `burst`, the column lifted `lift` m).
 */
export const KETTLE = Object.freeze({
    x: 8,
    ax: 56,
    z: -122,
    az: 20,
    y: 41,
    ay: 4,
    period: 170,
    phase: 0.1,
    linger: 0.25,
    favour: 0.3,
    radius: Object.freeze([8, 25]),
    speed: Object.freeze([9, 11.5]),
    layers: Object.freeze([-10, 11]),
    beating: 0.14,
    burst: 1.4,
    lift: 14,
});

/**
 * The skein (metres, seconds): a pass along a lane from `from` to `to` (x, z) at `speed` m/s, one
 * pass every `period` seconds (`phase` where the clock starts). Each pass crosses the low sun:
 * its height is set so the line runs `over` degrees above the sun's centre where it crosses its
 * bearing (the disc is about 3° across), wherever its own distance (±`vary[0]` m) and tilt
 * (±`vary[1]` rad) put it. The line sways across its heading (amplitude, wavelength m). At most
 * `birds` in a V.
 */
export const SKEIN = Object.freeze({
    from: Object.freeze([-300, -106]),
    to: Object.freeze([300, -150]),
    over: Object.freeze([-1.2, 2.6]),
    speed: 14,
    period: 118,
    phase: 0,
    vary: Object.freeze([14, 0.06]),
    sway: Object.freeze([3, 420]),
    birds: 21,
});
/**
 * The landscape eye (golden-forest-composition.js: goldenForestEye) and the sun's bearing and
 * height in degrees (golden-forest-light.js), kept here so this module stays three-free; the
 * tests hold them equal.
 */
export const CRANE_EYE = Object.freeze([0, 3.8, 14.5]);
export const CRANE_SUN = Object.freeze({ azimuth: -21, elevation: 11.5 });
/** The V, in spans: each rank this far out to the side and back from the one ahead. */
const V_SHAPE = Object.freeze({ out: 0.78, back: 1.1, rise: 0.04 });
/** How far a bird leans into its turns, as a share of a coordinated turn's bank (and at most). */
const BANK = Object.freeze({ share: 1, most: 0.75 });

const POSE_KEYS = Object.freeze(['lift', 'sweep', 'bend', 'fold', 'curl']);
const ZERO_POSE = Object.freeze({
    lift: 0, sweep: 0, bend: 0, fold: 0, curl: 0,
});
const poseOf = (name) => ({ ...ZERO_POSE, ...(CRANE_RIG.poses?.[name] || {}) });

/**
 * A beat from four authored poses: X(φ) = A + B cos φ + C sin φ + D sin² φ hits `top` at φ = 0,
 * `down` at π/2 (mid downstroke), `bottom` at π and `up` at 3π/2 (mid upstroke), smooth round.
 */
function fitCycle(top, down, bottom, up) {
    return Object.freeze(Object.fromEntries(POSE_KEYS.map((key) => {
        const A = 0.5 * (top[key] + bottom[key]);
        const B = 0.5 * (top[key] - bottom[key]);
        const C = 0.5 * (down[key] - up[key]);
        const D = 0.5 * (down[key] + up[key]) - A;
        return [key, Object.freeze([A, B, C, D])];
    })));
}

export const CRUISE_BEAT = fitCycle(poseOf('top'), poseOf('down'), poseOf('bottom'), poseOf('up'));
export const HARD_BEAT = fitCycle(poseOf('hardTop'), poseOf('hardDown'), poseOf('hardBottom'), poseOf('hardUp'));
export const SOAR_POSE = Object.freeze(poseOf('soar'));
export const GLIDE_POSE = Object.freeze(poseOf('glide'));

/**
 * A crane's downstroke is slow and its upstroke quick: the beat's phase θ (uniform in time) is
 * warped to the poses' φ = θ + w (1 − cos θ), monotonic, with the downstroke (φ from 0 to π)
 * taking the rig's share of the beat.
 */
const DOWNSTROKE = clamp(CRANE_RIG.downstroke ?? 0.6, 0.5, 0.7);
const STROKE_WARP = (Math.PI - TAU * DOWNSTROKE) / (1 - Math.cos(TAU * DOWNSTROKE));
export const strokePhase = (theta) => theta + STROKE_WARP * (1 - Math.cos(theta));

/**
 * The wing's hinge angles at beat phase `theta`: the cruise beat blended toward the hard one by
 * `effort` (0..1), then from the resting pose `rest` (soar or glide) by `flap` (0 still … 1
 * beating). Also the body's heave (m): up on the downstroke, down on the upstroke.
 */
export function wingPose(theta, effort = 0, flap = 1, rest = SOAR_POSE, out = {}) {
    const phi = strokePhase(theta);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const e = clamp(effort, 0, 1);
    const f = clamp(flap, 0, 1);
    for (const key of POSE_KEYS) {
        const [A, B, C, D] = CRUISE_BEAT[key];
        const [a, b, cc, d] = HARD_BEAT[key];
        const cruise = A + B * c + C * s + D * s * s;
        const hard = a + b * c + cc * s + d * s * s;
        const beat = cruise + (hard - cruise) * e;
        out[key] = rest[key] + (beat - rest[key]) * f;
    }
    out.heave = -(0.016 + 0.026 * e) * c * f;
    return out;
}

const rotate = (a, b, ang) => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return [a * c - b * s, a * s + b * c];
};

/**
 * Fold a rest-pose point `p` ([x, y, z], the bird's frame: x its left, y up, z forward) by its
 * hinge weights `w` ([arm, hand, tip]) into `pose`: about the wrist, then the shoulder. The
 * vertex stage's twin (and crane.py's fold()).
 */
export function foldPoint(p, w, pose, out = [0, 0, 0]) {
    const [Sx, Sy, Sz] = CRANE_RIG.shoulder;
    const [Wx, Wy, Wz] = CRANE_RIG.wrist;
    const side = p[0] >= 0 ? 1 : -1;
    let [du, dz] = rotate(Math.abs(p[0]) - Wx, p[2] - Wz, -pose.fold * w[1]);
    let dy;
    [du, dy] = rotate(du, p[1] - Wy, pose.bend * w[1] + pose.curl * w[2]);
    [du, dz] = rotate(du + Wx - Sx, dz + Wz - Sz, -pose.sweep * w[0]);
    [du, dy] = rotate(du, dy + Wy - Sy, pose.lift * w[0]);
    out[0] = side * (du + Sx);
    out[1] = dy + Sy;
    out[2] = dz + Sz;
    return out;
}

/** A small seeded generator (mulberry32, kept local so this module stays three-free). */
export function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** How a tier's budget of birds is shared: the skein first (a V of 3 to 21), the kettle the rest. */
export function craneFlockSizes(birds) {
    const pool = Math.max(0, Math.round(Number.isFinite(birds) ? birds : 0));
    if (pool === 0) return { pool, skein: 0, kettle: 0 };
    const skein = pool < 6 ? 0 : clamp(Math.round(pool * 0.25), 3, SKEIN.birds);
    return { pool, skein, kettle: pool - skein };
}

/** The V's slots for n birds (spans: x across, positive the leader's right; z along, negative behind; y up). */
function vSlots(n, random) {
    const others = n - 1;
    // Now and then an echelon (one long arm) instead of a V; otherwise arms seldom equal.
    const echelon = others >= 3 && random() < 0.22;
    const lean = others > 2 ? Math.round((random() - 0.5) * 2.4) : 0;
    let left = clamp(Math.ceil(others / 2) + lean, 0, others);
    if (echelon) left = random() < 0.5 ? others : 0;
    const slots = [[0, 0, 0]];
    let l = 0;
    let r = 0;
    for (let k = 0; k < others; k += 1) {
        const goLeft = (l < left && (k % 2 === 0 || r >= others - left));
        const rank = goLeft ? (l += 1) : (r += 1);
        const side = goLeft ? -1 : 1;
        slots.push([side * rank * V_SHAPE.out, rank * V_SHAPE.rise, -rank * V_SHAPE.back]);
    }
    return slots;
}

/**
 * The sky's cranes for a tier's budget. `seed` fixes every bird's own circle, rhythm and
 * looseness, so the same sky is drawn for the same clock.
 */
export class CraneSky {
    constructor(birds, seed = 0x6372) {
        const sizes = craneFlockSizes(birds);
        this.sizes = sizes;
        this.count = sizes.pool;
        this.seed = seed;
        const random = seeded(seed);
        // The kettle: each bird's circle, height, speed, rhythm and when it beats.
        this.kettle = Array.from({ length: sizes.kettle }, (_, i) => {
            const u = (i + random()) / Math.max(1, sizes.kettle);
            const radius = KETTLE.radius[0] + (KETTLE.radius[1] - KETTLE.radius[0]) * (0.15 + 0.85 * random()) ** 0.8;
            const speed = KETTLE.speed[0] + (KETTLE.speed[1] - KETTLE.speed[0]) * random();
            return {
                radius,
                omega: speed / radius,
                angle: random() * TAU,
                // Layered up the column, a little shuffled: the wider circles ride higher.
                height: KETTLE.layers[0]
                    + (KETTLE.layers[1] - KETTLE.layers[0]) * clamp(u * 0.7 + random() * 0.3, 0, 1),
                bob: [1.5 + random() * 2.5, random() * TAU],
                breathe: [0.08 + random() * 0.1, 0.05 + random() * 0.07, random() * TAU],
                rate: CRANE_BEAT.cruise * (1 + (random() * 2 - 1) * CRANE_BEAT.spread),
                beat: random(),
                bout: [0.05 + random() * 0.05, random() * TAU],
                size: 0.92 + random() * 0.16,
            };
        });
        // The skein: each bird's rhythm and looseness (its slot is laid per pass).
        this.skein = Array.from({ length: sizes.skein }, () => ({
            rate: CRANE_BEAT.cruise * (1 + (random() * 2 - 1) * CRANE_BEAT.spread * 0.6),
            beat: random() * 0.2,
            wander: [
                0.12, 0.04 + random() * 0.05, random() * TAU,
                0.08, 0.03 + random() * 0.04, random() * TAU,
                0.22, 0.02 + random() * 0.03, random() * TAU,
            ],
            glide: [0.03 + random() * 0.03, random() * TAU],
            size: 0.94 + random() * 0.12,
        }));
        this.passes = new Map();
        this.boost = 0;
        this.scratch = {
            p: [0, 0, 0], q: [0, 0, 0], r: [0, 0, 0], c: [0, 0, 0], pose: {}, slot: new Float32Array(CRANE_STRIDE),
        };
    }

    /** A startle quickens every beat; its phase gains that much more per second (integrated). */
    advance(dt, startle) {
        if (Number.isFinite(dt) && dt > 0) {
            this.boost = (this.boost + Math.min(dt, 0.25) * clamp(startle, 0, 1) * CRANE_BEAT.startled) % 1e4;
        }
    }

    reset() {
        this.boost = 0;
    }

    /**
     * The kettle's column centre at time t (x, y, z): it lingers over the open sky right of the
     * board, visits the gap above the sun and crosses behind the board quicker.
     */
    static kettleCentre(t, out = [0, 0, 0]) {
        const loop = (t / KETTLE.period + KETTLE.phase) * TAU;
        const s = loop - KETTLE.linger * Math.sin(2 * loop) - KETTLE.favour * Math.sin(loop);
        out[0] = KETTLE.x + KETTLE.ax * Math.cos(s);
        out[1] = KETTLE.y + KETTLE.ay * Math.sin(s * 2 + 0.7);
        out[2] = KETTLE.z + KETTLE.az * Math.sin(s);
        return out;
    }

    /** Where kettle bird `i` is at time t with the column startled by `startle` (0..1). */
    kettleAt(i, t, startle, out = [0, 0, 0]) {
        const b = this.kettle[i];
        const c = CraneSky.kettleCentre(t, this.scratch.c);
        const spread = 1 + KETTLE.burst * startle;
        const r = b.radius * spread * (1 + b.breathe[0] * Math.sin(t * b.breathe[1] + b.breathe[2]));
        // Every bird turns the same way (anticlockwise seen from above).
        const a = b.angle + b.omega * t;
        out[0] = c[0] + r * Math.cos(a);
        out[1] = c[1] + b.height + KETTLE.lift * startle + b.bob[0] * Math.sin(a + b.bob[1]);
        out[2] = c[2] - r * Math.sin(a);
        return out;
    }

    /** The skein pass under way at time t: its number and how far along (s), or null between passes. */
    static passAt(t) {
        const clock = t + SKEIN.phase;
        const index = Math.floor(clock / SKEIN.period);
        return { index, age: clock - index * SKEIN.period };
    }

    /** A pass's own skein: its V, its height, distance and tilt (cached per pass). */
    pass(index) {
        let pass = this.passes.get(index);
        if (pass) return pass;
        const random = seeded((this.seed * 31 + index * 7919) >>> 0);
        const n = this.skein.length;
        pass = {
            slots: vSlots(n, random),
            dz: (random() * 2 - 1) * SKEIN.vary[0],
            tilt: (random() * 2 - 1) * SKEIN.vary[1],
            over: SKEIN.over[0] + (SKEIN.over[1] - SKEIN.over[0]) * random(),
            sway: random() * TAU,
        };
        // Where the lane crosses the sun's bearing, and so how high it must fly to cross the sun.
        const lane = CraneSky.lane(pass);
        const az = CRANE_SUN.azimuth * (Math.PI / 180);
        const sx = Math.sin(az);
        const sz = -Math.cos(az);
        const bx = CRANE_EYE[0] - lane.fx;
        const bz = CRANE_EYE[2] - lane.fz;
        const det = sx * lane.uz - lane.ux * sz;
        const reach = Math.abs(det) > 1e-6 ? (lane.ux * bz - lane.uz * bx) / det : 140;
        pass.y = CRANE_EYE[1] + Math.max(60, reach) * Math.tan((CRANE_SUN.elevation + pass.over) * (Math.PI / 180));
        if (this.passes.size > 8) this.passes.clear();
        this.passes.set(index, pass);
        return pass;
    }

    /** A pass's lane: where it starts (x, z), its unit heading and its length. */
    static lane(pass) {
        const [fx, fz] = SKEIN.from;
        const [tx, tz] = SKEIN.to;
        const lx = tx - fx;
        const lz = tz - fz + pass.tilt * (tx - fx);
        const length = Math.hypot(lx, lz);
        return {
            fx, fz: fz + pass.dz, ux: lx / length, uz: lz / length, length,
        };
    }

    /** Where skein bird `i` is at time t (null when no skein is in the sky). */
    skeinAt(i, t, out = [0, 0, 0]) {
        const { index, age } = CraneSky.passAt(t);
        const pass = this.pass(index);
        const {
            fx, fz, ux, uz, length,
        } = pass.lane ?? (pass.lane = CraneSky.lane(pass));
        const run = age * SKEIN.speed;
        if (run > length + 140) return null;
        const [sx, sy, sz] = pass.slots[i];
        const bird = this.skein[i];
        const w = bird.wander;
        const span = CRANE_SPAN;
        const across = (sx + w[0] * Math.sin(t * w[1] * TAU + w[2])) * span;
        const up = (sy + w[3] * Math.sin(t * w[4] * TAU + w[5])) * span;
        const along = (sz + w[6] * Math.sin(t * w[7] * TAU + w[8])) * span;
        // The lane sways gently across its heading.
        const d = run + along - 70;
        const sway = SKEIN.sway[0] * Math.sin((d / SKEIN.sway[1]) * TAU + pass.sway);
        // The leader's right is (−uz, ux) turned: across + sway along the lane's normal.
        const nx = -uz;
        const nz = ux;
        out[0] = fx + ux * d + nx * (across + sway);
        out[1] = pass.y + up + 1.2 * Math.sin(t * 0.21 + pass.sway);
        out[2] = fz + uz * d + nz * (across + sway);
        return out;
    }

    /** Where bird `i` of the kettle (`kettle` true) or the skein is at time t (null: not in the sky). */
    at(kettle, i, time, startle, out) {
        return kettle ? this.kettleAt(i, time, startle, out) : this.skeinAt(i, time, out);
    }

    /**
     * Pose one bird into `target` at `offset`: heading and bank from its path a step either side,
     * its wings by `pose`, its drawn size from the eye. Returns the angle its span fills (0: not
     * in the sky).
     */
    place(target, offset, kettle, i, t, startle, pose, size, eye) {
        const { p, q, r } = this.scratch;
        const h = 0.2;
        if (!this.at(kettle, i, t - h, startle, p) || !this.at(kettle, i, t + h, startle, r)
            || !this.at(kettle, i, t, startle, q)) return 0;
        const vx = (r[0] - p[0]) / (2 * h);
        const vy = (r[1] - p[1]) / (2 * h);
        const vz = (r[2] - p[2]) / (2 * h);
        const speed = Math.hypot(vx, vy, vz) || 1;
        const fx = vx / speed;
        const fy = vy / speed;
        const fz = vz / speed;
        // The bank: the lift leans into the sideways acceleration (a coordinated turn).
        const ax = (r[0] - 2 * q[0] + p[0]) / (h * h);
        const az = (r[2] - 2 * q[2] + p[2]) / (h * h);
        // The level left (up x forward) and the sideways pull along it.
        const level = Math.hypot(fx, fz) || 1;
        const lx = fz / level;
        const lz = -fx / level;
        const pull = ax * lx + az * lz;
        const bank = clamp(Math.atan2(pull, GRAVITY) * BANK.share, -BANK.most, BANK.most);
        // Up: the world's up made square to forward, then tilted toward the left by the bank.
        const cb = Math.cos(bank) / level;
        const sb = Math.sin(bank);
        const ux = lx * sb - fx * fy * cb;
        const uy = (1 - fy * fy) * cb;
        const uz = lz * sb - fz * fy * cb;
        // Drawn size: real, but never smaller than the least angle (and then as far as it looks).
        const dist = Math.max(Math.hypot(q[0] - eye[0], q[1] - eye[1], q[2] - eye[2]), 1e-3);
        const drawn = Math.max(size, (CRANE_MIN_SPAN_ANGLE * dist) / CRANE_SPAN);
        const o = offset;
        target[o] = q[0];
        target[o + 1] = q[1];
        target[o + 2] = q[2];
        target[o + 3] = drawn;
        target[o + 4] = fx;
        target[o + 5] = fy;
        target[o + 6] = fz;
        target[o + 7] = pose.heave;
        target[o + 8] = ux;
        target[o + 9] = uy;
        target[o + 10] = uz;
        target[o + 11] = pose.lift;
        target[o + 12] = pose.sweep;
        target[o + 13] = pose.bend;
        target[o + 14] = pose.fold;
        target[o + 15] = pose.curl;
        return (CRANE_SPAN * drawn) / dist;
    }

    /**
     * Pose every bird at time t into the two arrays (`near`, `far`: CRANE_STRIDE floats a bird)
     * and return how many went into each. `startle` (0..1) is the world's eased startle, `eye`
     * the camera ([x, y, z]).
     */
    write(t, startle, eye, near, far) {
        const s = clamp(Number.isFinite(startle) ? startle : 0, 0, 1);
        const { pose, slot } = this.scratch;
        let n = 0;
        let f = 0;
        const put = (spanAngle) => {
            if (!spanAngle) return;
            const nearOne = spanAngle > CRANE_NEAR_SPAN_ANGLE;
            const target = nearOne ? near : far;
            const k = nearOne ? n : f;
            if ((k + 1) * CRANE_STRIDE > target.length) return;
            target.set(slot, k * CRANE_STRIDE);
            if (nearOne) n += 1;
            else f += 1;
        };
        const beatTime = t + this.boost;
        for (let i = 0; i < this.kettle.length; i += 1) {
            const bird = this.kettle[i];
            // A bird soars, and now and then beats a few strokes; a startled one beats hard.
            const wave = 0.5 + 0.5 * Math.sin(t * bird.bout[0] * TAU + bird.bout[1]);
            const bout = smooth(1 - KETTLE.beating, 1 - KETTLE.beating * 0.25, wave);
            const theta = (beatTime * bird.rate + bird.beat) * TAU;
            wingPose(theta, s, Math.max(bout, s), SOAR_POSE, pose);
            put(this.place(slot, 0, true, i, t, s, pose, bird.size, eye));
        }
        if (this.skein.length) {
            const pass = this.pass(CraneSky.passAt(t).index);
            for (let i = 0; i < this.skein.length; i += 1) {
                const bird = this.skein[i];
                // A wave of strokes runs down each arm (the birds behind a little later).
                const rank = Math.abs(pass.slots[i][2]) / V_SHAPE.back;
                const theta = (beatTime * bird.rate + bird.beat - rank * 0.16) * TAU;
                // Now and then a bird sets its wings for a short glide.
                const glide = smooth(0.82, 0.97, 0.5 + 0.5 * Math.sin(t * bird.glide[0] * TAU + bird.glide[1]));
                wingPose(theta, s * 0.6, Math.max(1 - glide * 0.85, s), GLIDE_POSE, pose);
                put(this.place(slot, 0, false, i, t, s, pose, bird.size, eye));
            }
        }
        return { near: n, far: f };
    }
}
