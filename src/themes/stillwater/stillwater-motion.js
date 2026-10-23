/* eslint-disable max-classes-per-file -- a spring on a vector and a pendulum: two small tools of one kit */
/**
 * Stillwater — how the two figures move (three's math classes only; nothing here touches the GPU).
 *
 * The troll and the spirit are not played from clips: they are posed every frame from what they
 * mean to do, and this is the small toolkit that makes that motion read as a body's. Springs that
 * settle exactly (critically damped, stepped in closed form, so a long frame never overshoots and
 * a replay at another step lands on the same pose), a two-bone solver that puts a foot or a hand
 * where it must be with the knee or the elbow bent the right way, a look that the eyes lead and the
 * chest follows, and a pendulum for whatever hangs.
 *
 * Bones in the figures' files rest unrotated (their frames are the model's), so a bone's global
 * rotation is the product of its own and its parents' local ones, and the "rest direction" of a
 * bone is simply the offset of its child's head from its own.
 */

import * as THREE from 'three/webgpu';

const LN2 = Math.log(2);

/** Clamp to [lo, hi]. */
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Wrap an angle into (−π, π]. */
export function wrapAngle(a) {
    let x = a;
    while (x > Math.PI) x -= Math.PI * 2;
    while (x <= -Math.PI) x += Math.PI * 2;
    return x;
}

/**
 * One step of a critically damped spring (Holden's closed form): `s = { x, v }` moves toward
 * `target`, its damping set by `halfLife` (from rest it covers about 40% of the way in that time),
 * and lands on the same value whatever `dt` the time is cut into.
 */
export function springTo(s, target, halfLife, dt) {
    if (!(dt > 0)) return s;
    const y = (2 * LN2) / Math.max(1e-4, halfLife);
    const j0 = s.x - target;
    const j1 = s.v + j0 * y;
    const e = Math.exp(-y * dt);
    s.x = e * (j0 + j1 * dt) + target;
    s.v = e * (s.v - j1 * y * dt);
    return s;
}

/** A scalar spring state. */
export const spring = (x = 0) => ({ x, v: 0 });

/**
 * A head's turn: a spring that follows a spring (`s = { x, v, lead: { x, v } }`). The lead takes
 * the target and the second follows the lead, so a turn gathers speed, peaks and settles with no
 * jolt at either end; `maxSpeed` (units a second) caps how fast the second may go, so a sudden
 * far look is a sweep, never a snap. Together the two settle about as one spring of `halfLife`.
 */
export function followTo(s, target, halfLife, dt, maxSpeed = Infinity) {
    if (!(dt > 0)) return s;
    springTo(s.lead, target, halfLife * 0.6, dt);
    const was = s.x;
    springTo(s, s.lead.x, halfLife * 0.6, dt);
    const limit = maxSpeed * dt;
    if (s.x - was > limit) {
        s.x = was + limit;
        s.v = Math.min(s.v, maxSpeed);
    } else if (s.x - was < -limit) {
        s.x = was - limit;
        s.v = Math.max(s.v, -maxSpeed);
    }
    return s;
}

/** A follower's state (see followTo). */
export const follower = (x = 0) => ({ x, v: 0, lead: { x, v: 0 } });

/** The same spring on an angle: it goes the short way round. */
export function springAngle(s, target, halfLife, dt) {
    const goal = s.x + wrapAngle(target - s.x);
    springTo(s, goal, halfLife, dt);
    s.x = wrapAngle(s.x);
    return s;
}

/** A spring on a 3-vector (three independent springs). */
export class Spring3 {
    constructor(x = 0, y = 0, z = 0) {
        this.x = [x, y, z];
        this.v = [0, 0, 0];
        this._s = { x: 0, v: 0 };
    }

    set(x, y, z) {
        this.x[0] = x;
        this.x[1] = y;
        this.x[2] = z;
        this.v[0] = 0;
        this.v[1] = 0;
        this.v[2] = 0;
        return this;
    }

    step(tx, ty, tz, halfLife, dt) {
        const target = [tx, ty, tz];
        for (let i = 0; i < 3; i++) {
            this._s.x = this.x[i];
            this._s.v = this.v[i];
            springTo(this._s, target[i], halfLife, dt);
            this.x[i] = this._s.x;
            this.v[i] = this._s.v;
        }
        return this;
    }
}

/**
 * Something hanging from a point that moves (a lantern on its bail, a lock of hair): a damped
 * pendulum in two angles about the vertical, driven by how its pivot accelerates. `length` in
 * metres; the swing is integrated in a few sub-steps so a long frame stays stable.
 */
export class Pendulum {
    constructor(length = 0.3, damping = 1.6) {
        this.length = length;
        this.damping = damping;
        /** Swing angles: ax about x (toward ±z), az about z (toward ±x). */
        this.ax = 0;
        this.az = 0;
        this.vx = 0;
        this.vz = 0;
        this._last = null;
        this._vel = [0, 0, 0];
    }

    reset() {
        this.ax = 0;
        this.az = 0;
        this.vx = 0;
        this.vz = 0;
        this._last = null;
    }

    /**
     * Advance with the pivot now at `p` ([x, y, z]); `wind` ([x, z], m/s²) pushes it.
     * Returns the bob's offset from the pivot in `out`.
     */
    step(p, dt, out = [0, 0, 0], wind = null) {
        if (dt > 0 && this._last) {
            const g = 9.81;
            const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
            const h = dt / steps;
            const vx = (p[0] - this._last[0]) / dt;
            const vy = (p[1] - this._last[1]) / dt;
            const vz = (p[2] - this._last[2]) / dt;
            // The pivot's acceleration over the frame (the bob feels its opposite).
            const accX = (vx - this._vel[0]) / dt;
            const accZ = (vz - this._vel[2]) / dt;
            const accY = (vy - this._vel[1]) / dt;
            this._vel[0] = vx;
            this._vel[1] = vy;
            this._vel[2] = vz;
            const fx = clamp(-accX + (wind ? wind[0] : 0), -40, 40);
            const fz = clamp(-accZ + (wind ? wind[1] : 0), -40, 40);
            const geff = Math.max(2, g + clamp(accY, -6, 30));
            for (let i = 0; i < steps; i++) {
                // Small-angle swing in two planes, each with its own restoring force and drag.
                const kx = (geff * Math.sin(this.az) - fx * Math.cos(this.az)) / this.length;
                const kz = (geff * Math.sin(this.ax) - fz * Math.cos(this.ax)) / this.length;
                this.vz += (-kx - this.damping * this.vz) * h;
                this.vx += (-kz - this.damping * this.vx) * h;
                this.az = clamp(this.az + this.vz * h, -1.2, 1.2);
                this.ax = clamp(this.ax + this.vx * h, -1.2, 1.2);
            }
        }
        if (!this._last) this._last = [0, 0, 0];
        this._last[0] = p[0];
        this._last[1] = p[1];
        this._last[2] = p[2];
        // (A point on the sphere of the cord's length, whatever the two angles.)
        out[0] = Math.sin(this.az) * Math.cos(this.ax) * this.length;
        out[2] = Math.sin(this.ax) * this.length;
        out[1] = -Math.cos(this.az) * Math.cos(this.ax) * this.length;
        return out;
    }
}

// ── Rotations ───────────────────────────────────────────────────────────────────

const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _x2 = new THREE.Vector3();
const _y2 = new THREE.Vector3();
const _z2 = new THREE.Vector3();

/** An orthonormal frame with x along `dir` and y toward `pole` (written into a matrix). */
function frameOf(dir, pole, out, x, y, z) {
    x.copy(dir).normalize();
    y.copy(pole).addScaledVector(x, -pole.dot(x));
    if (y.lengthSq() < 1e-10) {
        // The pole lies along the direction: any perpendicular will do.
        z.set(0, 1, 0);
        if (Math.abs(x.y) > 0.9) z.set(1, 0, 0);
        y.crossVectors(z, x);
    }
    y.normalize();
    z.crossVectors(x, y);
    return out.makeBasis(x, y, z);
}

/**
 * The rotation that takes a bone lying along `fromDir` with its bend toward `fromPole` to one
 * lying along `toDir` bending toward `toPole` (both pairs in the same space).
 */
export function rotationBetweenFrames(fromDir, fromPole, toDir, toPole, out = new THREE.Quaternion()) {
    frameOf(fromDir, fromPole, _m1, _x, _y, _z);
    frameOf(toDir, toPole, _m2, _x2, _y2, _z2);
    _m2.multiply(_m1.transpose());
    return out.setFromRotationMatrix(_m2);
}

/**
 * Where the middle joint of a two-bone limb goes: root `a`, target `t` (clamped to the reach),
 * lengths `l1`, `l2`, bending toward `pole`. Writes the joint into `mid` and the reached end into
 * `end`; returns how far beyond the reach the target lay (0 when it was within it, or too near).
 */
export function solveTwoBone(a, t, l1, l2, pole, mid, end) {
    const d = _x.copy(t).sub(a);
    const full = d.length();
    const reach = clamp(full, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
    const u = d.lengthSq() > 1e-12 ? d.divideScalar(full || 1) : d.set(0, -1, 0);
    const along = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
    const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const p = _y.copy(pole).addScaledVector(u, -pole.dot(u));
    if (p.lengthSq() < 1e-10) p.set(0, 0, 1).addScaledVector(u, -u.z);
    p.normalize();
    mid.copy(a).addScaledVector(u, along).addScaledVector(p, h);
    end.copy(a).addScaledVector(u, reach);
    return Math.max(0, full - reach);
}

/** Exponential ease toward a target: the share of the way covered in `dt` at `rate`. */
export const ease = (rate, dt) => 1 - Math.exp(-rate * dt);

/** Smoothstep. */
export function smoothstep(lo, hi, v) {
    const t = clamp((v - lo) / (hi - lo || 1e-6), 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * A seeded schedule of moments (idle glances, a shift of weight): the n-th moment of a stream
 * falls in its own slot of `period` seconds at a place the seed decides, so the moments are a
 * function of the clock and a replay meets them again.
 */
export function momentNear(time, period, seed, jitter = 0.7) {
    const slot = Math.floor(time / period);
    const fract = (v) => v - Math.floor(v);
    const frac = fract(Math.sin((slot + 1) * 12.9898 + seed * 78.233) * 43758.5453);
    return {
        slot,
        at: (slot + 0.5 + (frac - 0.5) * jitter) * period,
        roll: fract(Math.sin((slot + 7) * 3.1 + seed * 11.7) * 43758.5453),
    };
}
