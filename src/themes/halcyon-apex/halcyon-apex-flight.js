/**
 * Halcyon Apex — how the skyfarers fly (CPU only, three-free).
 *
 * The sanctuary's light draws craft from elsewhere, and the sky over it is never empty for long.
 * Three streams of traffic run at once, each a pure function of the world clock (so a seek shows
 * the same sky a replay does):
 *
 *   far    high and a kilometre or two out: couriers drawing thin trails across the dawn, convoys
 *          of barges nose to tail, the ark under its sails with an escort about it
 *   mid    a few hundred metres off: formations crossing, a flight circling the Apex, two swifts
 *          chasing each other through a weave, mantas gliding, a string of orbs running the
 *          causeway
 *   hero   close enough to fill a hand's width of sky: swifts skimming the lagoon and pulling
 *          straight up out of it, a loop over the pyramid, a manta's long pass with its lamps
 *          lit, a ring-ship come to commune with a great crystal, three saucers turning round
 *          each other, a barge unloading its cargo of light at the causeway, and the visitors
 *          the sanctuary has always had (the saucer, the beam on the Halcyon, the capsule that
 *          hops, the orbs' dance)
 *
 * A sortie is a leader's path and the ships that fly it. The path is a cubic through keys, each a
 * place at a time: as seen from the rest camera (`az` degrees right of where it looks, `el`
 * degrees over the horizon, `d` metres off), as metres in the camera's frame (`x` right, `y` up,
 * `z` toward the view, negative), or round one of the sanctuary's anchors (`at`: the Apex, the
 * Halcyon). A `stop` key is a standstill. Every ship of a formation flies the leader's path a
 * moment behind it, set off to the side, above and astern in the leader's own frame, so a
 * formation banks and climbs as one; a break sends each ship its own way. What a ship points
 * along, and how far it leans into a turn, comes from the path itself (its velocity and the lift
 * that would bend it), so a loop is flown upside down over the top and a hard turn on a wing tip.
 *
 * Every sortie's numbers (which side it comes from, how high, how near, how fast, how many, in
 * what formation, with what flourish) are drawn from its slot's seed: the same kind of pass never
 * looks the same twice.
 */

import {
    DEG, SITE, TAU, clamp01, lerp, mulberry32, smooth,
} from './halcyon-apex-core.js';

/** Hulls the sky can hold at once (the renderer's instance table). */
export const SHIP_SLOTS = 24;
/** Seconds a called sortie may start in the future and still be kept. */
const CALL_LEAD = 30;

// ── Small vector maths ──────────────────────────────────────────────────────────

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b, out = [0, 0, 0]) => {
    const x = a[1] * b[2] - a[2] * b[1];
    const y = a[2] * b[0] - a[0] * b[2];
    const z = a[0] * b[1] - a[1] * b[0];
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
};
const norm = (a, out = a) => {
    const l = Math.hypot(a[0], a[1], a[2]);
    if (l < 1e-9) return null;
    out[0] = a[0] / l;
    out[1] = a[1] / l;
    out[2] = a[2] / l;
    return out;
};

/** The quaternion [x, y, z, w] that turns the hull's frame (x nose, y up, z starboard) onto (f, u, f × u). */
export function quatFromBasis(f, u, out = [0, 0, 0, 1]) {
    const r = cross(f, u, [0, 0, 0]);
    const m00 = f[0];
    const m10 = f[1];
    const m20 = f[2];
    const m01 = u[0];
    const m11 = u[1];
    const m21 = u[2];
    const m02 = r[0];
    const m12 = r[1];
    const m22 = r[2];
    const trace = m00 + m11 + m22;
    if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1);
        out[3] = 0.25 / s;
        out[0] = (m21 - m12) * s;
        out[1] = (m02 - m20) * s;
        out[2] = (m10 - m01) * s;
    } else if (m00 > m11 && m00 > m22) {
        const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
        out[3] = (m21 - m12) / s;
        out[0] = 0.25 * s;
        out[1] = (m01 + m10) / s;
        out[2] = (m02 + m20) / s;
    } else if (m11 > m22) {
        const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
        out[3] = (m02 - m20) / s;
        out[0] = (m01 + m10) / s;
        out[1] = 0.25 * s;
        out[2] = (m12 + m21) / s;
    } else {
        const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
        out[3] = (m10 - m01) / s;
        out[0] = (m02 + m20) / s;
        out[1] = (m12 + m21) / s;
        out[2] = 0.25 * s;
    }
    return out;
}

/** Turn vector `v` by quaternion `q` ([x, y, z, w]). CPU twin of the hull shader's turn. */
export function quatTurn(q, v, out = [0, 0, 0]) {
    const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
    const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
    const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
    out[0] = v[0] + q[3] * tx + (q[1] * tz - q[2] * ty);
    out[1] = v[1] + q[3] * ty + (q[2] * tx - q[0] * tz);
    out[2] = v[2] + q[3] * tz + (q[0] * ty - q[1] * tx);
    return out;
}

const quatAxis = (ax, ay, az, angle, out = [0, 0, 0, 1]) => {
    const s = Math.sin(angle / 2);
    out[0] = ax * s;
    out[1] = ay * s;
    out[2] = az * s;
    out[3] = Math.cos(angle / 2);
    return out;
};
const quatMul = (a, b, out = [0, 0, 0, 1]) => {
    const x = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1];
    const y = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0];
    const z = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3];
    const w = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2];
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
    return out;
};

// ── Keys → the world ────────────────────────────────────────────────────────────

/**
 * @typedef {object} FlightFrame
 * @property {number} [yaw]      radians the rest camera is turned left of −Z
 * @property {number} [eye]      its height over the water
 * @property {number} [upright]  0 for a wide screen, 1 for a phone held upright
 * @property {number[]} [halcyonTop]  the Halcyon's upper point
 * @property {number[]} [halcyon]     its centre
 * @property {number[]} [apex]        the Apex crystal's centre
 */

const DEFAULT_APEX = [SITE.pyramid.x, 104, SITE.pyramid.z];
const DEFAULT_HALCYON = [70, SITE.halcyon.height, -135];

function anchorOf(name, frame) {
    if (name === 'apex') return frame.apex || DEFAULT_APEX;
    if (name === 'halcyonTop') {
        return frame.halcyonTop || [DEFAULT_HALCYON[0], SITE.halcyon.height + SITE.halcyon.half, DEFAULT_HALCYON[2]];
    }
    return frame.halcyon || DEFAULT_HALCYON;
}

/**
 * Where each key of `sortie` lies in the world for `frame`.
 * @param {{ keys: object[] }} sortie
 * @param {FlightFrame} frame
 */
export function keyPoints(sortie, frame) {
    const yaw = frame.yaw || 0;
    const eye = frame.eye ?? 3.2;
    const upright = clamp01(frame.upright || 0);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    return sortie.keys.map((k) => {
        if (k.at !== undefined) {
            const a = anchorOf(k.at, frame);
            if (k.r !== undefined) {
                // Round the anchor: `ang` 0 is its near side (toward the eye), turning left to right.
                const toEye = Math.atan2(-a[0], -a[2]);
                const ang = toEye + (k.ang || 0) * DEG;
                return [a[0] + Math.sin(ang) * k.r, a[1] + (k.h || 0), a[2] + Math.cos(ang) * k.r];
            }
            return [
                a[0] + rx * (k.dx || 0) + fx * (k.dz || 0),
                a[1] + (k.dy || 0),
                a[2] + rz * (k.dx || 0) + fz * (k.dz || 0),
            ];
        }
        let { az } = k;
        let { el } = k;
        let { d } = k;
        if (k.x !== undefined) {
            d = Math.hypot(k.x, k.z);
            az = Math.atan2(k.x, -k.z) / DEG;
            el = Math.atan2(k.y - eye, d) / DEG;
        }
        // An upright screen is too narrow for the sky round the card, and its card covers the
        // middle: the routes close in toward the view and rise into the band of sky over the card.
        if (upright > 0 && el < 40 && Math.abs(az) < 90) {
            az *= 1 - 0.45 * upright;
            el += (15.5 + el * 0.27 - el) * upright;
        }
        const a = az * DEG;
        const h = [fx * Math.cos(a) + rx * Math.sin(a), fz * Math.cos(a) + rz * Math.sin(a)];
        return [h[0] * d, eye + Math.tan(el * DEG) * d, h[1] * d];
    });
}

/** Velocity at each key: zero at a stop, else the chord across its neighbours over their time. */
function keyVelocities(keys, points) {
    const n = keys.length;
    return points.map((p, i) => {
        if (keys[i].stop || n < 2) return [0, 0, 0];
        const a = Math.max(0, i - 1);
        const b = Math.min(n - 1, i + 1);
        const dt = keys[b].t - keys[a].t || 1;
        return [0, 1, 2].map((c) => (points[b][c] - points[a][c]) / dt);
    });
}

/**
 * The leader's place on the cubic at `age`. Before the first key and after the last it flies on
 * along its end velocity (a follower a moment behind the leader, and a trail, need the path there).
 */
export function pathPoint(keys, points, velocities, age, out = [0, 0, 0]) {
    const n = keys.length;
    const t0 = keys[0].t;
    const t1 = keys[n - 1].t;
    if (age <= t0) {
        const dt = age - t0;
        for (let c = 0; c < 3; c++) out[c] = points[0][c] + velocities[0][c] * dt;
        return out;
    }
    if (age >= t1) {
        const dt = age - t1;
        for (let c = 0; c < 3; c++) out[c] = points[n - 1][c] + velocities[n - 1][c] * dt;
        return out;
    }
    let i = 0;
    while (i < n - 2 && age > keys[i + 1].t) i += 1;
    const h = Math.max(1e-6, keys[i + 1].t - keys[i].t);
    const s = clamp01((age - keys[i].t) / h);
    const s2 = s * s;
    const s3 = s2 * s;
    const P0 = points[i];
    const P1 = points[i + 1];
    const V0 = velocities[i];
    const V1 = velocities[i + 1];
    for (let c = 0; c < 3; c++) {
        out[c] = (2 * s3 - 3 * s2 + 1) * P0[c] + (s3 - 2 * s2 + s) * h * V0[c] + (-2 * s3 + 3 * s2) * P1[c] + (s3 - s2) * h * V1[c];
    }
    return out;
}

/** The key segment `age` lies in, and how far through it (eased), for keys that carry a `yaw`. */
function keyYaw(keys, age) {
    const n = keys.length;
    const t = Math.max(keys[0].t, Math.min(keys[n - 1].t, age));
    let i = 0;
    while (i < n - 2 && t > keys[i + 1].t) i += 1;
    const h = Math.max(1e-6, keys[i + 1].t - keys[i].t);
    const s = clamp01((t - keys[i].t) / h);
    const e = s * s * (3 - 2 * s);
    const y0 = keys[i].yaw ?? 0;
    const y1 = keys[i + 1].yaw ?? y0;
    return y0 + (y1 - y0) * e;
}

// ── A sortie in the world ───────────────────────────────────────────────────────

/** How each hull kind carries itself. */
const ATTITUDE = Object.freeze({
    swift: { mode: 'aero', bank: 1, pitch: 90 },
    manta: { mode: 'aero', bank: 0.5, pitch: 24 },
    barge: { mode: 'aero', bank: 0.16, pitch: 12 },
    ark: { mode: 'aero', bank: 0.05, pitch: 6 },
    saucer: { mode: 'disc' },
    hoop: { mode: 'level' },
    capsule: { mode: 'level' },
    orb: { mode: 'orb' },
});

/** Gravity as the bank sees it (m/s²): a turn of this much sideways pull flies at 45°. */
const BANK_G = 16;

const hum = (t, a, b, phase) => Math.sin(t * a + phase) * 0.6 + Math.sin(t * b + phase * 1.7) * 0.4;

/**
 * A sortie resolved for one frame of the world: its keys in the world, and every ship's place and
 * bearing as functions of its age.
 */
export class Flight {
    /**
     * @param {object} sortie
     * @param {FlightFrame} frame
     */
    constructor(sortie, frame) {
        this.sortie = sortie;
        /** Scratch for pose() ... */
        this._a = [0, 0, 0];
        this._b = [0, 0, 0];
        this._f = [0, 0, 0];
        this._u = [0, 0, 0];
        this._q = [0, 0, 0, 1];
        /** ... and for shipPoint(), which pose() calls with the arrays above as its `out`. */
        this._p0 = [0, 0, 0];
        this._p1 = [0, 0, 0];
        this._lf = [0, 0, 0];
        this.resolve(frame);
    }

    /** Re-read the keys for a frame (the aspect changed, the Halcyon was hung elsewhere). */
    resolve(frame) {
        this.frame = frame;
        this.yaw = frame.yaw || 0;
        this.points = keyPoints(this.sortie, frame);
        this.velocities = keyVelocities(this.sortie.keys, this.points);
        this.signature = Flight.signatureOf(frame);
    }

    static signatureOf(frame) {
        const h = frame.halcyonTop || DEFAULT_HALCYON;
        const a = frame.apex || DEFAULT_APEX;
        return `${(frame.yaw || 0).toFixed(4)}|${(frame.upright || 0).toFixed(3)}|${h[0].toFixed(1)},${h[2].toFixed(1)}|${a[0].toFixed(1)}`;
    }

    /** The leader's place at `age`. */
    leader(age, out = [0, 0, 0]) {
        const { sortie } = this;
        pathPoint(sortie.keys, this.points, this.velocities, age, out);
        const { weave } = sortie;
        if (weave) {
            // A weave across the path: the leader swings from side to side (and whoever follows it
            // a moment behind swings after it).
            const k = smooth(weave.from, weave.from + 0.8, age) * (1 - smooth(weave.to - 0.8, weave.to, age));
            if (k > 0) {
                const s = Math.sin((age - weave.from) * (TAU / weave.period)) * weave.reach * k;
                const lift = Math.sin((age - weave.from) * (TAU / weave.period) * 2 + 0.6) * weave.reach * 0.22 * k;
                // Across = square to the chord from the first key to the last, level.
                const n = this.points.length - 1;
                const cx = this.points[n][0] - this.points[0][0];
                const cz = this.points[n][2] - this.points[0][2];
                const cl = Math.hypot(cx, cz) || 1;
                out[0] += (-cz / cl) * s;
                out[1] += lift;
                out[2] += (cx / cl) * s;
            }
        }
        return out;
    }

    /** Ship `i`'s place at `age`. */
    shipPoint(i, age, out = [0, 0, 0]) {
        const { sortie } = this;
        const ship = sortie.ships[i];
        let t = age - (ship.lag || 0);
        // A ship that leaves after the others hangs where it is until its own moment.
        if (ship.leave && sortie.warp !== undefined && t > sortie.warp) t = sortie.warp + Math.max(0, t - sortie.warp - ship.leave);
        this.leader(t, out);
        if (ship.bearing) {
            // Its own bearing from the eye: the leader's path, turned about the viewer (a fan of ships).
            // (An upright screen is narrow: the fan closes to what it shows.)
            const b = ship.bearing * DEG * (1 - 0.55 * clamp01(this.frame.upright || 0));
            const x = out[0];
            const z = out[2];
            out[0] = x * Math.cos(b) - z * Math.sin(b);
            out[2] = z * Math.cos(b) + x * Math.sin(b);
        }
        const cy = Math.cos(this.yaw);
        const sy = Math.sin(this.yaw);
        let ox = 0;
        let oy = 0;
        let oz = 0;
        if (ship.right || ship.up || ship.back) {
            // The leader's own frame there: forward along its flight, right level, up square to both.
            const h = 0.16;
            const p0 = this.leader(t - h, this._p0);
            const p1 = this.leader(t + h, this._p1);
            const f = this._lf;
            f[0] = p1[0] - p0[0];
            f[1] = p1[1] - p0[1];
            f[2] = p1[2] - p0[2];
            if (!norm(f)) {
                f[0] = cy;
                f[1] = 0;
                f[2] = -sy;
            }
            let rx = -f[2];
            let rz = f[0];
            const rl = Math.hypot(rx, rz);
            if (rl < 1e-4) {
                rx = -sy;
                rz = -cy;
            } else {
                rx /= rl;
                rz /= rl;
            }
            // up = right × forward
            const ux = -rz * f[1];
            const uy = rz * f[0] - rx * f[2];
            const uz = rx * f[1];
            const right = ship.right || 0;
            const up = ship.up || 0;
            const back = ship.back || 0;
            ox = rx * right + ux * up - f[0] * back;
            oy = uy * up - f[1] * back;
            oz = rz * right + uz * up - f[2] * back;
        }
        const { ring } = sortie;
        if (ring) {
            // A ring that turns, as the eye sees it: across the view, up, and toward the eye.
            const k = smooth(ring.from, ring.from + (ring.gather ?? 1), age);
            if (k > 0) {
                const a = (i / sortie.ships.length) * TAU + age * ring.rate;
                const r = ring.radius * (1 + (ring.breathe ?? 0.2) * Math.sin(age * 1.7 + i * 2.1));
                const across = Math.cos(a) * r;
                const up = Math.sin(a) * r * (ring.tip ?? 0.82) + (ring.lift ?? 0);
                const toward = Math.sin(a) * r * (ring.depth ?? 0.57);
                const wx = cy * across + sy * toward;
                const wz = -sy * across + cy * toward;
                ox += (wx - ox) * k;
                oy += (up - oy) * k;
                oz += (wz - oz) * k;
            }
        }
        out[0] += ox;
        out[1] += oy;
        out[2] += oz;
        if (sortie.breakAt !== undefined && ship.exit) {
            // The break: each ship peels off its own way, gathering speed.
            const s = Math.max(0, age - sortie.breakAt - (ship.breakLag || 0));
            if (s > 0) {
                const reach = sortie.breakPull * s * s * (1 + s * (sortie.breakRush ?? 0));
                const ex = ship.exit;
                // Exits are given in the camera's frame (x right, y up, z toward the eye).
                out[0] += (ex[0] * cy + ex[2] * sy) * reach;
                out[1] += ex[1] * reach;
                out[2] += (ex[2] * cy - ex[0] * sy) * reach;
            }
        }
        if (ship.drift) {
            out[0] += hum(age, 0.9, 1.7, ship.phase || 0) * ship.drift;
            out[1] += hum(age, 1.1, 0.7, (ship.phase || 0) + 2) * ship.drift * 0.7;
            out[2] += hum(age, 0.8, 1.3, (ship.phase || 0) + 4) * ship.drift;
        }
        return out;
    }

    /** When ship `i` is done (seconds into the sortie). */
    shipEnd(i) {
        const { sortie } = this;
        const ship = sortie.ships[i];
        return sortie.keys[sortie.keys.length - 1].t + (ship.lag || 0) + (ship.leave || 0);
    }

    /** How much of ship `i` is here at `age` (0..1): it comes and goes out of thin air or the distance. */
    presence(age, i = 0) {
        const { sortie } = this;
        const T = sortie.warp !== undefined ? this.shipEnd(i) : sortie.duration;
        // A ship that follows a moment behind is not there before its own start (the path before
        // the first key is only the way a trail runs back).
        const from = sortie.ships[i].lag || 0;
        if (age < from || age > T) return 0;
        return (sortie.fadeIn > 0 ? smooth(from, from + sortie.fadeIn, age) : 1)
            * (sortie.fadeOut > 0 ? 1 - smooth(T - sortie.fadeOut, T, age) : 1);
    }

    /**
     * Everything the renderer needs for ship `i` at `age`: its place, its bearing as a quaternion,
     * its speed and how hard its engines burn.
     * @returns {{ p: number[], q: number[], speed: number, throttle: number, presence: number, flash: number, spin: number, up: number[] }}
     */
    pose(i, age, out = {
        p: [0, 0, 0], q: [0, 0, 0, 1], speed: 0, throttle: 0, presence: 1, flash: 0, spin: 0, up: [0, 1, 0],
    }) {
        const { sortie } = this;
        const ship = sortie.ships[i];
        const att = ATTITUDE[ship.kind || sortie.kind] || ATTITUDE.orb;
        const p = this.shipPoint(i, age, out.p);
        // Velocity over a short step, lift over a longer one (the cubic's curvature jumps at a key:
        // the longer step is what keeps a bank from snapping there).
        const hv = 0.1;
        const a0 = this.shipPoint(i, age - hv, this._a);
        const a1 = this.shipPoint(i, age + hv, this._b);
        const vx = (a1[0] - a0[0]) / (2 * hv);
        const vy = (a1[1] - a0[1]) / (2 * hv);
        const vz = (a1[2] - a0[2]) / (2 * hv);
        const speed = Math.hypot(vx, vy, vz);
        out.speed = speed;
        out.presence = this.presence(age, i);
        out.flash = 0;
        if (sortie.warp !== undefined) {
            const x = (age - sortie.warp - (ship.leave || 0)) / 0.14;
            out.flash = Math.exp(-x * x);
        }
        out.spin = 0;
        const { q } = out;
        const hover = Math.exp(-speed / 4);
        const ph = ship.phase || 0;
        const named = sortie.keys[0].yaw !== undefined;
        if (att.mode === 'aero') {
            const ha = 0.32;
            const b0 = this.shipPoint(i, age - ha, this._a);
            const b1 = this.shipPoint(i, age + ha, this._b);
            const ax = (b1[0] - 2 * p[0] + b0[0]) / (ha * ha);
            const ay = (b1[1] - 2 * p[1] + b0[1]) / (ha * ha);
            const az = (b1[2] - 2 * p[2] + b0[2]) / (ha * ha);
            const f = this._f;
            f[0] = vx;
            f[1] = vy;
            f[2] = vz;
            const yawK = this.yaw + (named ? keyYaw(sortie.keys, age) * DEG : 0);
            if (speed < 0.5 || !norm(f)) {
                f[0] = Math.cos(yawK);
                f[1] = 0;
                f[2] = -Math.sin(yawK);
            } else if (named) {
                // A path that names its own heading (a hull that turns in place while it hangs).
                f[0] = lerp(f[0], Math.cos(yawK), hover);
                f[1] = lerp(f[1], 0, hover);
                f[2] = lerp(f[2], -Math.sin(yawK), hover);
                if (!norm(f)) {
                    f[0] = Math.cos(yawK);
                    f[1] = 0;
                    f[2] = -Math.sin(yawK);
                }
            }
            // A big hull keeps its nose near the horizon however its path climbs.
            const maxPitch = Math.sin((att.pitch || 90) * DEG);
            if (Math.abs(f[1]) > maxPitch) {
                const flat = Math.hypot(f[0], f[2]) || 1;
                const keep = Math.sqrt(Math.max(0, 1 - maxPitch * maxPitch)) / flat;
                f[0] *= keep;
                f[2] *= keep;
                f[1] = Math.sign(f[1]) * maxPitch;
            }
            // The lift that bends the path: what is left of the pull once the part along the
            // flight is taken out, plus what holds it up. Up is along it.
            const along = ax * f[0] + ay * f[1] + az * f[2];
            const u = this._u;
            u[0] = (ax - f[0] * along) * att.bank;
            u[1] = (ay - f[1] * along) * att.bank + BANK_G;
            u[2] = (az - f[2] * along) * att.bank;
            const lean = dot(u, f);
            u[0] -= f[0] * lean;
            u[1] -= f[1] * lean;
            u[2] -= f[2] * lean;
            if (!norm(u)) {
                // Straight up with nothing bending it: keep the belly toward the far side.
                u[0] = Math.sin(this.yaw);
                u[1] = 0;
                u[2] = Math.cos(this.yaw);
                const l2 = dot(u, f);
                u[0] -= f[0] * l2;
                u[1] -= f[1] * l2;
                u[2] -= f[2] * l2;
                if (!norm(u)) {
                    u[0] = 0;
                    u[1] = 1;
                    u[2] = 0;
                }
            }
            quatFromBasis(f, u, q);
            // Rolls: about the nose, a full turn or several, a moment later for each ship behind.
            const { rolls } = sortie;
            if (rolls) {
                let turn = 0;
                for (let r = 0; r < rolls.length; r++) {
                    const roll = rolls[r];
                    const s = clamp01((age - roll.at - i * (roll.stagger || 0)) / roll.span);
                    turn += (s * s * (3 - 2 * s)) * roll.turns * TAU * (ship.rollSign || 1);
                }
                if (turn !== 0) quatMul(q, quatAxis(1, 0, 0, turn, this._q), q);
            }
            // The engines burn harder the harder the hull is driven.
            out.throttle = clamp01(0.45 + speed / 260 + Math.max(0, along) / 60);
            out.up[0] = u[0];
            out.up[1] = u[1];
            out.up[2] = u[2];
        } else if (att.mode === 'disc') {
            // A saucer leans the way it flies and into its turns; hanging still, it rocks and bobs,
            // and it turns on its axis all the while (spinning up as it leaves).
            const ha = 0.2;
            const b0 = this.shipPoint(i, age - ha, this._a);
            const b1 = this.shipPoint(i, age + ha, this._b);
            const ax = (b1[0] - 2 * p[0] + b0[0]) / (ha * ha);
            const az = (b1[2] - 2 * p[2] + b0[2]) / (ha * ha);
            let tx = vx * 0.009 + Math.max(-12, Math.min(12, ax)) * 0.02;
            let tz = vz * 0.009 + Math.max(-12, Math.min(12, az)) * 0.02;
            const lean = Math.hypot(tx, tz);
            if (lean > 0.36) {
                tx *= 0.36 / lean;
                tz *= 0.36 / lean;
            }
            tx += Math.sin(age * 1.9 + ph) * 0.05 * hover;
            tz += Math.cos(age * 1.37 + ph) * 0.05 * hover;
            p[1] += Math.sin(age * 1.3 + ph) * 0.45 * hover;
            const { leaf } = sortie;
            if (leaf) {
                // The falling leaf: it swings from side to side as it comes down, tipping with the swing.
                const k = smooth(leaf.from, leaf.from + 0.6, age) * (1 - smooth(leaf.to - 0.8, leaf.to, age));
                const w = TAU / leaf.period;
                const sw = Math.sin((age - leaf.from) * w + ph);
                const cw = Math.cos((age - leaf.from) * w + ph);
                const cy = Math.cos(this.yaw);
                const sy = Math.sin(this.yaw);
                p[0] += cy * sw * leaf.reach * k;
                p[2] += -sy * sw * leaf.reach * k;
                p[1] += Math.abs(cw) * leaf.reach * 0.16 * k;
                tx += cy * cw * 0.32 * k;
                tz += -sy * cw * 0.32 * k;
            }
            const tilt = Math.hypot(tx, tz);
            const lift = sortie.warp !== undefined ? Math.max(0, age - sortie.warp - (ship.leave || 0)) : 0;
            out.spin = age * 0.9 + lift * lift * 14 + ph;
            if (tilt > 1e-6) quatAxis(tz / tilt, 0, -tx / tilt, tilt, q);
            else {
                q[0] = 0;
                q[1] = 0;
                q[2] = 0;
                q[3] = 1;
            }
            quatMul(q, quatAxis(0, 1, 0, out.spin, this._q), q);
            out.throttle = clamp01(0.5 + speed / 120);
            out.up[0] = tx;
            out.up[1] = 1;
            out.up[2] = tz;
        } else if (att.mode === 'level') {
            // It names its own heading and hangs humming between its moves.
            const yawK = this.yaw + (named ? keyYaw(sortie.keys, age) * DEG : 0);
            const jitter = (ship.kind || sortie.kind) === 'capsule' ? 1 : 0.3;
            p[0] += hum(age, 7.1, 11.3, 0.4 + ph) * 0.22 * hover * jitter;
            p[1] += hum(age, 6.3, 9.7, 1.9 + ph) * 0.18 * hover * jitter + Math.sin(age * 0.8 + ph) * 0.5 * hover * (1 - jitter);
            p[2] += hum(age, 5.7, 12.9, 3.1 + ph) * 0.22 * hover * jitter;
            const tx = hum(age, 4.3, 8.9, 2.2 + ph) * 0.03 * hover + vx * 0.004;
            const tz = hum(age, 3.9, 7.7, 0.7 + ph) * 0.03 * hover + vz * 0.004;
            const tilt = Math.hypot(tx, tz);
            if (tilt > 1e-6) quatAxis(tz / tilt, 0, -tx / tilt, Math.min(0.3, tilt), q);
            else {
                q[0] = 0;
                q[1] = 0;
                q[2] = 0;
                q[3] = 1;
            }
            quatMul(q, quatAxis(0, 1, 0, yawK, this._q), q);
            out.throttle = clamp01(0.4 + speed / 80);
            out.up[0] = tx;
            out.up[1] = 1;
            out.up[2] = tz;
        } else {
            q[0] = 0;
            q[1] = 0;
            q[2] = 0;
            q[3] = 1;
            out.throttle = 1;
            out.up[0] = 0;
            out.up[1] = 1;
            out.up[2] = 0;
        }
        return out;
    }

    /** How strongly the sortie's beam burns at `age` (0..1). */
    beam(age) {
        const { beam } = this.sortie;
        if (!beam) return 0;
        return smooth(beam.on, beam.on + 0.6, age) * (1 - smooth(beam.off - 0.7, beam.off, age));
    }
}

// ── Formations ──────────────────────────────────────────────────────────────────

/**
 * Where each ship of a formation sits off its leader (metres right, up, astern), `gap` metres
 * between neighbours. The leader is always first.
 */
export function formation(shape, count, gap) {
    const ships = [{ right: 0, up: 0, back: 0 }];
    for (let k = 1; k < count; k++) {
        const side = k % 2 ? 1 : -1;
        const rank = Math.ceil(k / 2);
        if (shape === 'vee') ships.push({ right: side * rank * gap, up: -rank * gap * 0.08, back: rank * gap * 0.82 });
        else if (shape === 'echelon') ships.push({ right: k * gap * 0.9, up: k * gap * 0.12, back: k * gap * 0.7 });
        else if (shape === 'abreast') ships.push({ right: side * rank * gap * 1.15, up: 0, back: rank * gap * 0.06 });
        else if (shape === 'stack') ships.push({ right: side * rank * gap * 0.25, up: -k * gap * 0.5, back: k * gap * 0.75 });
        else if (shape === 'diamond') {
            const slots = [[1, 0, 1], [-1, 0, 1], [0, -0.1, 2], [0, 0.5, 1], [2, 0, 2], [-2, 0, 2]];
            const s = slots[(k - 1) % slots.length];
            ships.push({ right: s[0] * gap, up: s[1] * gap, back: s[2] * gap * 0.86 });
        } else ships.push({ right: 0, up: 0, back: k * gap }); // astern
    }
    return ships;
}

const FORMATIONS = ['vee', 'echelon', 'abreast', 'astern', 'diamond', 'stack'];

// ── The sorties ─────────────────────────────────────────────────────────────────

const pick = (rand, list) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
const between = (rand, lo, hi) => lo + (hi - lo) * rand();
const whole = (rand, lo, hi) => lo + Math.min(hi - lo, Math.floor(rand() * (hi - lo + 1)));

/** Keys timed by the distance between them: `speed` metres a second through places in the camera's frame. */
function timedKeys(places, speed, t0 = 0) {
    let t = t0;
    return places.map((p, i) => {
        if (i > 0) {
            const q = places[i - 1];
            const dist = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
            t += dist / (p.speed || speed);
        }
        const { speed: _own, ...rest } = p;
        return { ...rest, t };
    });
}

/** A place in the camera's frame from a bearing, an elevation and a distance (the eye 3.2 m up). */
const seen = (az, el, d) => ({
    x: Math.sin(az * DEG) * d, y: 3.2 + Math.tan(el * DEG) * d, z: -Math.cos(az * DEG) * d,
});

/** A place in the camera's frame from a bearing, a height over the water and a distance. */
const over = (az, y, d) => ({ x: Math.sin(az * DEG) * d, y, z: -Math.cos(az * DEG) * d });

const finish = (sortie) => {
    const last = sortie.keys[sortie.keys.length - 1].t;
    const lag = sortie.ships.reduce((m, s) => Math.max(m, (s.lag || 0) + (s.leave || 0)), 0);
    return Object.freeze({
        fadeIn: 0.6, fadeOut: 0.6, scale: 1, calm: false, tint: 'crystal', ...sortie, duration: last + lag,
    });
};

const SORTIES = {
    // ── far ──
    /** Couriers high and far, drawing their trails across the dawn. */
    lane(rand) {
        const side = rand() < 0.5 ? 1 : -1;
        // A straight line square to the view (slanted a little), so it holds its height on screen:
        // a chord between two wide bearings would pass much nearer in the middle and bulge up out
        // of the frame.
        const d = between(rand, 1300, 2500);
        const y = 3.2 + Math.tan(between(rand, 14, 23) * DEG) * d;
        const slant = between(rand, -0.22, 0.22);
        const from = { x: -1.3 * d * side, y: y * between(rand, 0.94, 1.06), z: -d * (1 + slant) };
        const to = { x: 1.3 * d * side, y: y * between(rand, 0.94, 1.06), z: -d * (1 - slant) };
        const count = whole(rand, 1, 4);
        const scale = between(rand, 2.2, 3.4);
        return finish({
            name: 'lane',
            kind: 'swift',
            stream: 'far',
            calm: true,
            keys: timedKeys([from, to], between(rand, 190, 280)),
            ships: formation(pick(rand, ['vee', 'echelon', 'astern', 'abreast']), count, 26 * scale),
            scale,
            fadeIn: 2.5,
            fadeOut: 2.5,
            trail: {
                seconds: 7, width: 1.5 * scale, gain: 0.16, vapour: 0.7, pale: 0.7,
            },
        });
    },
    /** Barges nose to tail, a long way off. */
    convoy(rand) {
        const side = rand() < 0.5 ? 1 : -1;
        const d = between(rand, 640, 980);
        const el = between(rand, 16.5, 22);
        const from = seen(-58 * side, el, d * 1.25);
        const to = seen(58 * side, el + between(rand, -2, 2), d * 1.15);
        const mid = seen(between(rand, -8, 8), el + between(rand, -1, 1.5), d);
        const count = whole(rand, 2, 3);
        return finish({
            name: 'convoy',
            kind: 'barge',
            stream: 'far',
            calm: true,
            keys: timedKeys([from, mid, to], between(rand, 52, 70)),
            ships: formation('astern', count, between(rand, 64, 90)).map((s, i) => ({ ...s, up: (i % 2 ? 1 : -1) * 3 * i })),
            scale: 1.5,
            fadeIn: 3,
            fadeOut: 3,
            trail: {
                seconds: 2.4, width: 3.2, gain: 0.35, vapour: 0.12,
            },
        });
    },
    /** The ark, under its sails, with an escort about it. */
    ark(rand) {
        const side = rand() < 0.5 ? 1 : -1;
        const d = between(rand, 1150, 1600);
        const el = between(rand, 13.5, 20);
        const from = seen(-60 * side, el, d * 1.2);
        const to = seen(60 * side, el + between(rand, -1.5, 1.5), d * 1.2);
        const mid = seen(0, el + 0.6, d);
        const escort = pick(rand, [0, 2, 2, 4]);
        const ships = [{ right: 0, up: 0, back: 0 }];
        for (let k = 0; k < escort; k++) {
            const s = k % 2 ? 1 : -1;
            const rank = Math.floor(k / 2);
            ships.push({
                kind: 'swift', scale: 2.4, right: s * (70 + rank * 46), up: 26 - rank * 30, back: -40 + rank * 120, drift: 3, phase: k * 1.9,
            });
        }
        return finish({
            name: 'ark',
            kind: 'ark',
            stream: 'far',
            calm: true,
            keys: timedKeys([from, mid, to], between(rand, 62, 78)),
            ships,
            fadeIn: 4,
            fadeOut: 4,
            trail: {
                seconds: 3.2, width: 9, gain: 0.5, vapour: 0.1,
            },
        });
    },

    // ── mid ──
    /** A formation crossing a few hundred metres off, bending round the sanctuary as it goes. */
    flyby(rand) {
        const side = rand() < 0.5 ? 1 : -1;
        // By height, not elevation: over the pyramid's top and the Apex wherever it crosses them.
        const d0 = between(rand, 420, 640);
        const y0 = between(rand, 98, 140);
        const from = over(-54 * side, y0, d0);
        const near = over(between(rand, -14, 14), Math.max(98, y0 + between(rand, -12, 12)), d0 * between(rand, 0.66, 0.85));
        const to = over(54 * side, between(rand, 110, 200), d0 * between(rand, 1.0, 1.5));
        const count = whole(rand, 2, 5);
        const speed = between(rand, 84, 124);
        const keys = timedKeys([from, near, to], speed);
        const sortie = {
            name: 'flyby',
            kind: 'swift',
            stream: 'mid',
            keys,
            ships: formation(pick(rand, FORMATIONS), count, between(rand, 17, 26)),
            trail: {
                seconds: 1.5, width: 1.1, gain: 1.1, vapour: 0.22,
            },
        };
        const flourish = rand();
        if (flourish < 0.4) {
            // A roll that runs back through the formation, ship by ship.
            sortie.rolls = [{
                at: keys[1].t * between(rand, 0.35, 0.8), span: between(rand, 0.7, 1.1), turns: rand() < 0.3 ? 2 : 1, stagger: 0.16,
            }];
        } else if (flourish < 0.6) {
            // A break: they fan out of the formation and away.
            sortie.breakAt = keys[1].t * 1.05;
            sortie.breakPull = 16;
            sortie.breakRush = 0.5;
            sortie.ships = sortie.ships.map((s, i) => ({
                ...s, exit: [Math.sign(s.right || (i % 2 ? 1 : -1)) * (0.5 + 0.2 * i), 0.6 + 0.15 * (i % 3), -0.3], breakLag: i * 0.12,
            }));
        }
        return finish(sortie);
    },
    /** A flight that comes to see the Apex: once round the crystal, and away. */
    orbit(rand) {
        const turn = rand() < 0.5 ? 1 : -1;
        const r = between(rand, 46, 64);
        const h = between(rand, -7, 6);
        const count = whole(rand, 1, 3);
        const lap = between(rand, 6.2, 8.2);
        const keys = [{
            t: 0, az: -52, el: between(rand, 20, 26), d: 620,
        }];
        const start = -150 * turn;
        const steps = 7;
        const lead = 3.4;
        for (let k = 0; k <= steps; k++) {
            keys.push({
                t: lead + (k / steps) * lap * 0.92, at: 'apex', r: r * (1 + 0.12 * Math.sin(k * 1.3)), ang: start + turn * (k / steps) * 330, h: h + Math.sin(k * 0.9) * 5,
            });
        }
        keys.push({
            t: lead + lap + 3.6, az: 44 * (rand() < 0.5 ? 1 : -1), el: between(rand, 24, 30), d: 900,
        });
        return finish({
            name: 'orbit',
            kind: 'swift',
            stream: 'mid',
            keys,
            ships: formation(pick(rand, ['astern', 'echelon', 'vee']), count, between(rand, 18, 24)),
            trail: {
                seconds: 1.8, width: 1.1, gain: 1.2, vapour: 0.2,
            },
            fadeIn: 0.8,
            fadeOut: 0.8,
        });
    },
    /** Two swifts, one hard on the other's tail, through a weave. */
    chase(rand) {
        const side = rand() < 0.5 ? 1 : -1;
        const d = between(rand, 340, 460);
        const y = between(rand, 100, 135);
        const from = over(-54 * side, y, d * 1.2);
        const to = over(54 * side, y + between(rand, -10, 40), d * 1.1);
        const mid = over(0, y + between(rand, -4, 16), d * 0.8);
        const keys = timedKeys([from, mid, to], between(rand, 78, 104));
        const T = keys[2].t;
        return finish({
            name: 'chase',
            kind: 'swift',
            stream: 'mid',
            keys,
            ships: [{ right: 0, up: 0, back: 0 }, {
                right: 0, up: 1.5, back: 0, lag: between(rand, 0.55, 0.85),
            }],
            weave: {
                from: 0.4, to: T - 0.4, period: between(rand, 2.1, 2.9), reach: between(rand, 24, 38),
            },
            trail: {
                seconds: 1.7, width: 1.1, gain: 1.2, vapour: 0.2,
            },
        });
    },
    /** Mantas gliding by, slow and wide. */
    glide(rand) {
        const side = rand() < 0.5 ? 1 : -1;
        const d = between(rand, 290, 400);
        const y = between(rand, 100, 130);
        const from = over(-56 * side, y + 20, d * 1.3);
        const mid = over(between(rand, -10, 10), y, d);
        const to = over(56 * side, y + between(rand, 0, 50), d * 1.35);
        const count = whole(rand, 1, 2);
        return finish({
            name: 'glide',
            kind: 'manta',
            stream: 'mid',
            calm: true,
            keys: timedKeys([from, mid, to], between(rand, 40, 54)),
            ships: formation('echelon', count, 46),
            fadeIn: 1.5,
            fadeOut: 1.5,
            trail: {
                seconds: 1.4, width: 5, gain: 0.28, vapour: 0,
            },
        });
    },
    /** A barge on its own, near enough to count its cargo. */
    haul(rand) {
        const side = rand() < 0.5 ? 1 : -1;
        const d = between(rand, 290, 350);
        const y = between(rand, 98, 125);
        const from = over(-58 * side, y, d * 1.3);
        const mid = over(0, y + 6, d);
        const to = over(58 * side, y + between(rand, -6, 26), d * 1.25);
        return finish({
            name: 'haul',
            kind: 'barge',
            stream: 'mid',
            calm: true,
            keys: timedKeys([from, mid, to], between(rand, 34, 44)),
            ships: [{ right: 0, up: 0, back: 0 }],
            fadeIn: 1.5,
            fadeOut: 1.5,
            trail: {
                seconds: 1.6, width: 2.2, gain: 0.5, vapour: 0.1,
            },
        });
    },
    /** A string of orbs out of the heart gate's mouth, down the stair and the causeway, weaving, and off over the viewer's shoulder. */
    string(rand) {
        const count = whole(rand, 4, 6);
        const keys = [
            {
                t: 0, az: -23, el: 9.6, d: 198,
            },
            {
                t: 2.6, az: -25.5, el: 4.2, d: 120,
            },
            {
                t: 4.8, az: -31, el: 2.9, d: 62,
            },
            {
                t: 6.4, az: -47, el: between(rand, 6, 12), d: 44,
            },
            {
                t: 7.6, az: -78, el: 22, d: 70,
            },
        ];
        return finish({
            name: 'string',
            kind: 'orb',
            stream: 'mid',
            keys,
            ships: Array.from({ length: count }, (_, i) => ({ lag: i * 0.24, drift: 0.35, phase: i * 1.3 })),
            weave: {
                from: 0.2, to: 6.2, period: 1.5, reach: between(rand, 2.4, 4),
            },
            scale: 0.62,
            tint: 'sun',
            fadeIn: 0.5,
            fadeOut: 0.4,
            trail: {
                seconds: 0.55, width: 0.7, gain: 1.6, vapour: 0,
            },
        });
    },

    // ── hero ──
    /**
     * Swifts low over the lagoon, straight at the viewer: out of the distance beside the card,
     * skimming the water in a plume of spray, and past the viewer's shoulder.
     */
    skim(rand) {
        const count = whole(rand, 2, 3);
        // Over the pyramid's top, down its face in a dive, flat over the water where the lagoon
        // opens between the causeway and the card, and up past the viewer's shoulder.
        const places = [
            over(-13, between(rand, 230, 270), 430),
            over(-14, 108, 236),
            over(-14.5, 36, 178),
            { ...over(-15, 9, 150), speed: 84 },
            { ...seen(-19, 2.0, 108), speed: 64 },
            { ...seen(-27, 5, 80), speed: 58 },
            { ...seen(-52, 15, 72), speed: 70 },
            { ...seen(-100, 32, 150), speed: 130 },
        ];
        const keys = timedKeys(places, between(rand, 110, 130));
        return finish({
            name: 'skim',
            kind: 'swift',
            stream: 'hero',
            keys,
            ships: formation(pick(rand, ['echelon', 'astern', 'vee']), count, between(rand, 14, 18)).map((s, i) => ({
                ...s, right: (s.right || 0) * -0.6, up: Math.abs(s.up || 0) + i * 1.1, rollSign: i % 2 ? 1 : -1,
            })),
            rolls: [{
                at: keys[6].t - 0.1, span: 0.9, turns: 1, stagger: 0.12,
            }],
            spray: true,
            trail: {
                seconds: 1.5, width: 1.0, gain: 1.0, vapour: 0.22,
            },
            fadeIn: 1.4,
            fadeOut: 0.5,
        });
    },
    /**
     * One swift, or two wing to wing: in over the causeway, a loop before the pyramid's stair, half
     * a loop more, a roll upright at the top of it, and away the way it came (it never crosses to
     * the sun's side of the sky).
     */
    loop(rand) {
        const pair = rand() < 0.45;
        const R = between(rand, 25, 31);
        const z = -between(rand, 122, 138);
        const x0 = -between(rand, 46, 58);
        const y0 = between(rand, 15, 20);
        const speed = between(rand, 62, 74);
        const places = [{ x: x0 - 330, y: y0 + 90, z: z - 40 }, { x: x0 - 95, y: y0 + 6, z }];
        const steps = 8;
        const turns = 1.5;
        for (let k = 0; k <= steps * turns; k++) {
            const a = (k / steps) * TAU;
            places.push({ x: x0 + Math.sin(a) * R + Math.min(k, steps) * 2.5, y: y0 + (1 - Math.cos(a)) * R, z });
        }
        const top = places[places.length - 1];
        places.push({ x: top.x - 90, y: top.y + 6, z: z - 14 }, { x: top.x - 260, y: top.y + 70, z: z - 90 }, { x: top.x - 560, y: top.y + 300, z: z - 300 });
        const keys = timedKeys(places, speed);
        return finish({
            name: 'loop',
            kind: 'swift',
            stream: 'hero',
            keys,
            ships: pair ? [{ right: 0, up: 0, back: 0 }, { right: 12, up: 0, back: 3 }] : [{ right: 0, up: 0, back: 0 }],
            // (Over the top the lift itself turns it upright as the path straightens; the roll is the flourish after.)
            rolls: [{
                at: keys[15].t + 0.3, span: 1.1, turns: 1, stagger: 0.15,
            }],
            trail: {
                seconds: 3.0, width: 0.9, gain: 1.0, vapour: 0.3,
            },
            fadeIn: 0.8,
            fadeOut: 0.8,
        });
    },
    /** Swifts that climb the open sky beside the card in a helix, one after another, their trails wound together. */
    spire(rand) {
        const count = whole(rand, 2, 3);
        const turns = between(rand, 1.8, 2.4);
        const R = between(rand, 17, 22);
        const axis = seen(between(rand, -18, -16), 0, between(rand, 100, 112));
        const rise = between(rand, 84, 100);
        const sense = rand() < 0.5 ? 1 : -1;
        // In over the open lagoon to the right of the pyramid (behind the card), then the climb.
        const places = [seen(7, 3, 430), seen(-4, 2.4, 184)];
        const steps = Math.round(turns * 6);
        for (let k = 0; k <= steps; k++) {
            const a = (k / 6) * TAU * sense + Math.PI * 0.5;
            places.push({ x: axis.x + Math.cos(a) * R, y: 9 + (k / 6) * rise, z: axis.z + Math.sin(a) * R * 0.9 });
        }
        const top = places[places.length - 1];
        places.push({ x: top.x - 40 * sense, y: top.y + 130, z: top.z - 60 }, { x: top.x - 160 * sense, y: top.y + 420, z: top.z - 320 });
        const keys = timedKeys(places, between(rand, 44, 52));
        const lap = (keys[8].t - keys[2].t);
        return finish({
            name: 'spire',
            kind: 'swift',
            stream: 'hero',
            keys,
            ships: Array.from({ length: count }, (_, i) => ({ lag: (i * lap) / count, rollSign: sense })),
            trail: {
                seconds: 2.6, width: 0.9, gain: 1.1, vapour: 0.3,
            },
            fadeIn: 1.0,
            fadeOut: 0.8,
        });
    },
    /** A manta's long pass, low and near before the pyramid, its lamps lit; it climbs over the Halcyon as it leaves. */
    ray(rand) {
        const side = rand() < 0.3 ? -1 : 1;
        const el = between(rand, 12, 15.5);
        const d = between(rand, 118, 142);
        const places = side > 0
            ? [seen(-64, el + 6, d * 2.6), seen(-30, el, d * 1.05), seen(-4, el + 1, d), seen(28, el + 10, d * 1.3), seen(58, el + 17, d * 3)]
            : [seen(62, el + 18, d * 3), seen(30, el + 11, d * 1.35), seen(2, el + 2, d), seen(-28, el, d * 1.05), seen(-66, el + 5, d * 2.6)];
        return finish({
            name: 'ray',
            kind: 'manta',
            stream: 'hero',
            calm: true,
            keys: timedKeys(places, between(rand, 30, 38)),
            ships: [{ right: 0, up: 0, back: 0 }],
            fadeIn: 1.2,
            fadeOut: 1.2,
            trail: {
                seconds: 1.2, width: 5, gain: 0.22, vapour: 0,
            },
        });
    },
    /** The manta that stops: in from the right, high over the HUD, it hangs, turns a third of a turn, lifts away. */
    hang() {
        return finish({
            name: 'hang',
            kind: 'manta',
            stream: 'hero',
            calm: true,
            keys: [
                {
                    t: 0, x: 540, y: 150, z: -330, yaw: 180,
                },
                {
                    t: 7.5, x: 125, y: 132, z: -300, stop: true, yaw: 180,
                },
                {
                    t: 12.5, x: 118, y: 134, z: -298, stop: true, yaw: 300,
                },
                {
                    t: 21, x: 760, y: 560, z: -820, yaw: 330,
                },
            ],
            ships: [{ right: 0, up: 0, back: 0 }],
            fadeIn: 0.4,
            fadeOut: 0.5,
        });
    },
    /** A ring-ship come to commune with the Halcyon: it hangs over the diamond and lays its light on it. */
    rite(rand) {
        const high = between(rand, 15, 19);
        return finish({
            name: 'rite',
            kind: 'hoop',
            stream: 'hero',
            calm: true,
            keys: [
                // Its ring faces the eye at a heading of nothing: it comes face on, turns once
                // about itself while it communes, and leaves face on.
                {
                    t: 0, az: 56, el: 34, d: 640, yaw: -20,
                },
                {
                    t: 4.2, az: 40, el: 27, d: 330, yaw: -10,
                },
                {
                    t: 7.0, at: 'halcyonTop', dy: high, stop: true, yaw: 0,
                },
                {
                    t: 14.5, at: 'halcyonTop', dy: high + 1.5, stop: true, yaw: 360,
                },
                {
                    t: 16.4, at: 'halcyonTop', dy: high + 16, stop: true, yaw: 360,
                },
                {
                    t: 17.0, az: 24, el: 54, d: 4200, stop: true, yaw: 360,
                },
            ],
            ships: [{ right: 0, up: 0, back: 0 }],
            fadeIn: 0,
            fadeOut: 0.25,
            warp: 16.4,
            beam: { on: 7.6, off: 14.2, to: 'halcyonTop' },
            downwash: true,
        });
    },
    /** Three saucers that come down as a falling leaf, turn round each other over the lagoon, and go one by one. */
    trio(rand) {
        const side = rand() < 0.5 ? -1 : 1;
        const az = side < 0 ? between(rand, -31, -26) : between(rand, 30, 35);
        const el = side < 0 ? between(rand, 11, 14) : between(rand, 22, 25);
        const d = side < 0 ? between(rand, 118, 140) : between(rand, 150, 190);
        return finish({
            name: 'trio',
            kind: 'saucer',
            stream: 'hero',
            keys: [
                {
                    t: 0, az: az * 1.5, el: 42, d: 700,
                },
                {
                    t: 3.4, az: az * 1.1, el: el + 12, d: d * 1.5,
                },
                {
                    t: 6.4, az, el, d, stop: true,
                },
                {
                    t: 12.4, az: az + 0.6, el: el + 0.4, d, stop: true,
                },
                {
                    t: 13.0, az: az * 1.2, el: 58, d: 4200, stop: true,
                },
            ],
            ships: [0, 1, 2].map((i) => ({
                right: (i - 1) * 26, up: i === 1 ? 10 : 0, back: 0, phase: i * 2.1, leave: i * 0.45,
            })),
            ring: {
                from: 5.6, to: 12.4, gather: 1.6, rate: 0.9, radius: 17, tip: 0.5, depth: 0.85, hold: true,
            },
            leaf: {
                from: 1.2, to: 6.2, period: 2.2, reach: 9,
            },
            fadeIn: 0,
            fadeOut: 0.25,
            warp: 12.4,
            downwash: true,
        });
    },
    /** A barge comes to the causeway and unloads: it hangs low over the deck while its cargo of light pours out. */
    dock() {
        return finish({
            name: 'dock',
            kind: 'barge',
            stream: 'hero',
            calm: true,
            keys: [
                {
                    t: 0, az: -58, el: 17, d: 520, yaw: -24,
                },
                {
                    t: 6.5, az: -38, el: 12, d: 176, yaw: -20,
                },
                {
                    t: 11.0, az: -25.5, el: 6.8, d: 132, stop: true, yaw: -6,
                },
                {
                    t: 19.0, az: -25.2, el: 7.0, d: 132, stop: true, yaw: 4,
                },
                {
                    t: 24.0, az: -40, el: 15, d: 250, yaw: 150,
                },
                {
                    t: 30.0, az: -66, el: 24, d: 620, yaw: 160,
                },
            ],
            ships: [{ right: 0, up: 0, back: 0 }],
            unload: { from: 11.4, to: 18.6 },
            fadeIn: 1.2,
            fadeOut: 1.4,
            downwash: true,
            trail: {
                seconds: 1.2, width: 2.2, gain: 0.4, vapour: 0.08,
            },
        });
    },
    /** The saucer: over the pyramid's shoulder, down across its face to skim the lagoon, up to hang on the right, gone. */
    saucer() {
        return finish({
            name: 'saucer',
            kind: 'saucer',
            stream: 'hero',
            keys: [
                {
                    t: 0, az: -55, el: 26, d: 300,
                },
                {
                    t: 3, az: -36, el: 22, d: 200,
                },
                {
                    t: 6, az: -24, el: 6, d: 120,
                },
                {
                    t: 8.4, az: -6, el: 7, d: 140,
                },
                {
                    t: 10.6, az: 20, el: 13, d: 200,
                },
                {
                    t: 12.4, az: 35, el: 19, d: 260, stop: true,
                },
                {
                    t: 14.4, az: 36, el: 19.6, d: 260, stop: true,
                },
                {
                    t: 14.95, az: 42, el: 55, d: 3800, stop: true,
                },
            ],
            ships: [{ right: 0, up: 0, back: 0 }],
            fadeIn: 0,
            fadeOut: 0.25,
            warp: 14.4,
            downwash: true,
        });
    },
    /** A saucer that comes down out of the sky to the Halcyon, hangs over the diamond and lays a pale beam on it. */
    halcyon() {
        return finish({
            name: 'halcyon',
            kind: 'saucer',
            stream: 'hero',
            keys: [
                {
                    t: 0, az: 54, el: 30, d: 620,
                },
                {
                    t: 3.6, az: 38, el: 25, d: 320,
                },
                {
                    t: 5.6, at: 'halcyonTop', dy: 12, stop: true,
                },
                {
                    t: 11.4, at: 'halcyonTop', dy: 13.5, stop: true,
                },
                {
                    t: 12.8, at: 'halcyonTop', dy: 24, stop: true,
                },
                {
                    t: 13.35, az: 22, el: 52, d: 4200, stop: true,
                },
            ],
            ships: [{ right: 0, up: 0, back: 0 }],
            fadeIn: 0,
            fadeOut: 0.25,
            warp: 12.8,
            beam: { on: 6.0, off: 11.2, to: 'halcyonTop' },
        });
    },
    /** Three orbs that swoop to the water by the causeway, fall into a ring that turns, and scatter. */
    orbs() {
        const exits = [[-0.55, 0.8, -0.25], [0.35, 0.92, -0.2], [-0.15, 0.35, -0.92]];
        return finish({
            name: 'orbs',
            kind: 'orb',
            stream: 'hero',
            keys: [
                {
                    t: 0, az: -46, el: 30, d: 620,
                },
                {
                    t: 2.8, az: -27, el: 2.6, d: 105, stop: true,
                },
                {
                    t: 7.8, az: -24.5, el: 3.4, d: 110, stop: true,
                },
                {
                    t: 8.6, az: -24.5, el: 3.4, d: 110, stop: true,
                },
            ],
            ships: exits.map((exit, i) => ({ lag: i * 0.26, exit })),
            ring: {
                from: 2.7, to: 7.8, gather: 1.0, rate: 2.1, radius: 5.5, tip: 0.82, depth: 0.57, lift: 1.5, hold: true,
            },
            breakAt: 7.8,
            breakPull: 9000,
            breakRush: 0,
            tint: 'sun',
            fadeIn: 0,
            fadeOut: 0.3,
            warp: 7.8,
            trail: {
                seconds: 0.5, width: 0.7, gain: 1.5, vapour: 0,
            },
        });
    },
    /** A plain white capsule that hops between places in front of the pyramid and leaves straight up. */
    capsule() {
        return finish({
            name: 'capsule',
            kind: 'capsule',
            stream: 'hero',
            keys: [
                {
                    t: 0, az: -33, el: 9, d: 150, stop: true, yaw: 8,
                },
                {
                    t: 1.9, az: -33.3, el: 9.2, d: 150, stop: true, yaw: 8,
                },
                {
                    t: 2.08, az: -21, el: 13, d: 158, stop: true, yaw: -22,
                },
                {
                    t: 3.5, az: -21.2, el: 13.1, d: 158, stop: true, yaw: -22,
                },
                {
                    t: 3.68, az: -37, el: 15.5, d: 168, stop: true, yaw: 30,
                },
                {
                    t: 5.0, az: -36.7, el: 15.3, d: 168, stop: true, yaw: 30,
                },
                {
                    t: 5.16, az: -27, el: 6.5, d: 140, stop: true, yaw: -5,
                },
                {
                    t: 6.7, az: -27.2, el: 6.7, d: 140, stop: true, yaw: -5,
                },
                {
                    t: 7.1, az: -48, el: 64, d: 4600, stop: true, yaw: -5,
                },
            ],
            ships: [{ right: 0, up: 0, back: 0 }],
            fadeIn: 0.7,
            fadeOut: 0.2,
            warp: 6.7,
        });
    },

    // ── called by the board, never scheduled ──
    /**
     * The salute for four lines: swifts in over the viewer's head, fanned across the whole sky,
     * that run out toward the horizon drawing trails of sunfire, pull straight up and burst apart.
     * @param {() => number} rand
     * @param {{ count?: number }} [opts]
     */
    salute(rand, opts = {}) {
        const count = Math.max(1, Math.min(7, opts.count ?? 5));
        const keys = [
            {
                t: 0, x: 0, y: 150, z: 300,
            },
            {
                t: 1.5, x: 0, y: 112, z: -50,
            },
            {
                t: 3.5, x: 0, y: 96, z: -470,
            },
            {
                t: 5.0, x: 0, y: 150, z: -760,
            },
            {
                t: 6.3, x: 0, y: 470, z: -900,
            },
            {
                t: 7.8, x: 0, y: 1000, z: -930,
            },
        ];
        // Bearings the card and the HUD leave open (a wide frame), outermost first.
        const fan = [-30, 34, -14.5, 24.5, -38, 40, 0];
        const ships = [];
        for (let i = 0; i < count; i++) {
            const bearing = fan[i];
            const k = bearing / 40;
            ships.push({
                bearing, lag: Math.abs(k) * 0.32, up: -Math.abs(k) * 12, exit: [k * 0.9, 0.2, 0.25], breakLag: 0, rollSign: k < 0 ? -1 : 1,
            });
        }
        return finish({
            name: 'salute',
            kind: 'swift',
            stream: 'call',
            keys,
            ships,
            scale: 1.5,
            breakAt: 5.3,
            breakPull: 34,
            breakRush: 0.4,
            rolls: [{
                at: 5.2, span: 1.3, turns: 1.5, stagger: 0.04,
            }],
            tint: 'sunfire',
            trail: {
                seconds: 3.4, width: 1.6, gain: 2.0, vapour: 0.32,
            },
            fadeIn: 0.25,
            fadeOut: 1.4,
        });
    },
    /** The crown's ring of orbs: they rise round the Apex in a turning helix and burst outward. */
    crown() {
        const count = 8;
        return finish({
            name: 'crown',
            kind: 'orb',
            stream: 'call',
            keys: [
                {
                    t: 0, at: 'apex', dy: -16, stop: true,
                },
                {
                    t: 3.2, at: 'apex', dy: 6, stop: true,
                },
                {
                    t: 4.6, at: 'apex', dy: 30, stop: true,
                },
            ],
            ships: Array.from({ length: count }, (_, i) => {
                const a = (i / count) * TAU;
                return { exit: [Math.cos(a), 0.55, Math.sin(a) * 0.5], phase: i };
            }),
            ring: {
                from: -1, to: 3.4, gather: 0.01, rate: 2.6, radius: 26, tip: 0.12, depth: 1, hold: true,
            },
            breakAt: 3.4,
            breakPull: 420,
            breakRush: 0,
            tint: 'sunfire',
            fadeIn: 0.3,
            fadeOut: 0.5,
            trail: {
                seconds: 0.9, width: 1.3, gain: 2.2, vapour: 0,
            },
        });
    },
};

/** Every sortie by name (captures and tests fly them on demand). */
export const SORTIE_NAMES = Object.freeze(Object.keys(SORTIES));

/** The streams: seconds a slot, the share of slots that fly, who flies them, and the longest a sortie lasts. */
export const STREAMS = Object.freeze({
    far: Object.freeze({
        slot: 24, chance: 0.9, reach: 3, seed: 0x7a11, names: ['lane', 'convoy', 'lane', 'lane', 'convoy', 'lane', 'ark', 'lane', 'lane', 'convoy', 'lane', 'lane'],
    }),
    mid: Object.freeze({
        slot: 31, chance: 0.86, reach: 2, seed: 0x3b19, names: ['flyby', 'orbit', 'chase', 'glide', 'haul', 'string'],
    }),
    hero: Object.freeze({
        slot: 47, chance: 0.9, reach: 2, seed: 0x51ce, names: ['saucer', 'skim', 'ray', 'halcyon', 'loop', 'trio', 'rite', 'spire', 'orbs', 'dock', 'capsule', 'hang'],
    }),
});

/** A sortie keeps this far from either end of its slot. */
const SLOT_MARGIN = 2;
/** When the first hero of a session flies (seconds of world time), and which. */
export const FIRST_VISIT = 14;
const FIRST_HERO = 'skim';
const FIRST_HERO_CALM = 'ray';

/**
 * Build sortie `name` from `seed`: the same name and seed are the same flight.
 * @param {string} name
 * @param {number} [seed]
 * @param {object} [opts]
 */
export function makeSortie(name, seed = 1, opts = undefined) {
    const build = SORTIES[name];
    if (!build) return null;
    return build(mulberry32((seed >>> 0) || 1), opts);
}

function shuffled(count, seed) {
    const rand = mulberry32(seed);
    const order = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

const calmNames = (names) => {
    const calm = names.filter((n) => makeSortie(n, 1).calm);
    return calm.length ? calm : names.slice(0, 1);
};
const CALM = {};

/** The names a stream draws from: all of them, or under reduced motion only the slow ones. */
export function streamNames(stream, reduced = false) {
    const { names } = STREAMS[stream];
    if (!reduced) return names;
    if (!CALM[stream]) CALM[stream] = Object.freeze(calmNames(names));
    return CALM[stream];
}

/** Which name slot `k` of a stream flies: every name once per cycle, shuffled, never the same twice running. */
function nameForSlot(stream, k, reduced) {
    const names = streamNames(stream, reduced);
    const n = names.length;
    const { seed } = STREAMS[stream];
    if (n <= 2) return names[k % n];
    const cycle = Math.floor(k / n);
    const order = shuffled(n, seed + cycle * 7919);
    if (cycle > 0) {
        const before = shuffled(n, seed + (cycle - 1) * 7919)[n - 1];
        if (names[before] === names[order[0]]) [order[0], order[1]] = [order[1], order[0]];
    }
    // The same name twice in a stream's list may still fall side by side: step past it.
    let name = names[order[k % n]];
    if (k % n > 0 && name === names[order[(k % n) - 1]]) name = names[order[((k % n) + 1) % n]];
    return name;
}

const SORTIE_CACHE = new Map();
const CACHE_MAX = 48;

/**
 * The sortie planned for slot `k` of `stream`, or null: { sortie, start }.
 * @param {'far' | 'mid' | 'hero'} stream
 * @param {number} k
 * @param {boolean} [reduced]
 */
export function slotSortie(stream, k, reduced = false) {
    if (!(k >= 0)) return null;
    const key = `${stream}:${k}:${reduced ? 1 : 0}`;
    if (SORTIE_CACHE.has(key)) return SORTIE_CACHE.get(key);
    const spec = STREAMS[stream];
    const slotSeed = (spec.seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
    const rand = mulberry32(slotSeed);
    let plan = null;
    const first = stream === 'hero' && k === 0;
    if (first || rand() <= spec.chance) {
        let name = nameForSlot(stream, k, reduced);
        if (first) name = reduced ? FIRST_HERO_CALM : FIRST_HERO;
        const sortie = makeSortie(name, slotSeed ^ 0x5bd1e995);
        // It keeps to its own slot where it fits (one hero at a time); a long one runs on into the next.
        const room = Math.max(0, spec.slot - 2 * SLOT_MARGIN - sortie.duration);
        const start = first ? FIRST_VISIT : k * spec.slot + SLOT_MARGIN + rand() * room;
        plan = { sortie, start };
    }
    if (SORTIE_CACHE.size >= CACHE_MAX) SORTIE_CACHE.delete(SORTIE_CACHE.keys().next().value);
    SORTIE_CACHE.set(key, plan);
    return plan;
}

/**
 * Every scheduled sortie in the sky at world time `t`: [{ sortie, start, age, stream }], hero first.
 * @param {number} t
 * @param {boolean} [reduced]
 * @param {object[]} [out]
 */
export function sortiesAt(t, reduced = false, out = []) {
    out.length = 0;
    if (!(t >= 0)) return out;
    ['hero', 'mid', 'far'].forEach((stream) => {
        const spec = STREAMS[stream];
        const k = Math.floor(t / spec.slot);
        for (let back = 0; back <= spec.reach; back++) {
            const plan = slotSortie(stream, k - back, reduced);
            if (!plan) continue;
            const age = t - plan.start;
            if (age < 0 || age > plan.sortie.duration) continue;
            out.push({
                sortie: plan.sortie, start: plan.start, age, stream,
            });
        }
    });
    return out;
}

/** The sortie a stream flies at `t`, if any (the first found): what "the visitor" used to be. */
export function visitAt(t, reduced = false, stream = 'hero') {
    const all = sortiesAt(t, reduced);
    const hit = all.find((s) => s.stream === stream);
    return hit ? { route: hit.sortie, start: hit.start, age: hit.age } : null;
}

export { CALL_LEAD };
