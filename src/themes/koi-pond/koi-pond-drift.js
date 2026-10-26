/**
 * Koi Pond — what floats, as bodies on the water (CPU only, three-free, deterministic).
 *
 * The lily pads, the lilies standing on them and the fallen leaves and petals do not keep fixed
 * places: what happens in the pond moves them.
 *
 *   rings      every plunge (a locked piece, a pebble, a koi's breach and its splash, a clear)
 *              sends a front across the pond at the waves' own speed. As it passes, what floats
 *              is shoved outward and set turning; what lies where it struck is pushed under for a
 *              moment, rocked and left wet.
 *   koi        a fish near the surface parts what floats over its back and carries it a little
 *              way along; one passing just under a pad lifts and rocks it. A koi coming up to
 *              kiss the surface goes for a leaf or the rim of a pad (koi-pond-school.js steers it)
 *              and mouths it: the leaf is tugged under and spun, the pad's edge dips.
 *   the chain  the koi circling the board draw the water round with them: leaves near the ring
 *              are carried round it, pads lean into it on their stalks. A fever whirls them.
 *   the breeze a gust (a level, a hard drop, a clear) blows the leaves downwind and spins them;
 *              the hush before a four-line clear stills it.
 *
 * A pad is held by its stalk: it swings about where it grows and comes back. A leaf drifts free
 * but its resting place wanders a slow loop and creeps back to where it fell, so a long game
 * keeps the picture's shape. A lily rides its pad.
 *
 * Fixed steps, its own clock: seek plus the same steps reproduces a frame. It only produces
 * numbers: where each thing floats, how it is turned, rocked, dipped and how wet it is
 * (writePads, writeLeaves, writeLilies).
 */
import {
    POND, approach, clamp, clamp01, groundHeight, hash2, waterDepth,
} from './koi-pond-core.js';

export const KIND_PAD = 0;
export const KIND_LEAF = 1;
/** Plunges whose fronts are followed at once. */
export const PULSE_SLOTS = 16;
/** Seconds a front is followed (it has crossed the pond and faded by then). */
export const PULSE_LIFE = 7;
/** The waves' speed, m/s (koi-pond-light.js WAVE_SPEED; the world passes it in). */
const DEFAULT_WAVE_SPEED = 1.25;
/** How hard a front shoves what it passes, per unit of a plunge's power. */
const PULSE_GAIN = 30;
/** Half-width of a front (m). */
const FRONT = 0.3;
/** A plunge weaker than this moves nothing (a koi's kiss): it does not take a slot. */
const LEAST_POWER = 0.004;

/** How each kind of floating thing answers. */
const FEEL = Object.freeze([
    // A pad: heavy, held by its stalk, barely caught by the breeze.
    Object.freeze({
        pull: 0.9,
        drag: 1.6,
        windage: 0.12,
        carry: 0.55,
        heft: 0.38,
        top: 0.4,
        depth: 0.1,
        dipLow: -0.007,
        dipHigh: 0.009,
        tilt: 0.12,
        wetFor: 6,
    }),
    // A leaf or a petal: light, free, turned by every breath of air.
    Object.freeze({
        pull: 0.08,
        drag: 0.9,
        windage: 1,
        carry: 1,
        heft: 1,
        top: 0.8,
        depth: 0.04,
        dipLow: -0.022,
        dipHigh: 0.01,
        tilt: 0.2,
        wetFor: 4,
    }),
]);
/** A pad's stalk lets it swing this far (plus a share of its radius) before it pulls hard. */
const TETHER = 0.12;
const TETHER_SHARE = 0.6;
const TETHER_STIFF = 14;
/**
 * The most the water can shallow per metre moved (the bed's steepest slope is about 1.5): how
 * fast a thing's spare depth is used up between askings.
 */
const BED_SLOPE = 2;
/** Seconds a leaf's resting place takes to creep back to where it fell. */
const HOME_RETURN = 40;
/** The slow loop a leaf's resting place wanders (m, and rad/s at rate 1). */
const LOOP_RADIUS = 0.28;
const LOOP_RATE = 0.045;
/** The rock (a slope) and the dip are damped springs: a jolt rocks a couple of times. */
const TILT_K = 30;
const TILT_DAMP = 4.5;
const DIP_K = 45;
const DIP_DAMP = 5;
/** The chain's current at its full charge (m/s) and how wide its band is (in ring radii). */
const SWIRL_SPEED = 0.32;
const SWIRL_BAND = 0.42;
/** A koi near the surface: how it carries what lies over it, parts it, and turns it. */
const CARRY_K = 6;
const PART_K = 1.4;
const TWIST_K = 3;

/**
 * Which way the water deepens at (x, z), as a unit vector in `out`: down the ground's own slope,
 * which, unlike the depth, still points somewhere on dry land.
 */
function deeperAt(x, z, out) {
    const e = 0.15;
    const gx = groundHeight(x - e, z) - groundHeight(x + e, z);
    const gz = groundHeight(x, z - e) - groundHeight(x, z + e);
    const g = Math.hypot(gx, gz);
    out.x = g > 1e-6 ? gx / g : 0;
    out.z = g > 1e-6 ? gz / g : 0;
    return out;
}

/** A resting place on a leaf's slow loop, at time `t` (the loop the shader once drew). */
function loopAt(rate, phase, t, out) {
    const a = t * LOOP_RATE * rate + phase;
    out.x = (Math.cos(a) + Math.cos(a * 2.3) * 0.3) * LOOP_RADIUS;
    out.z = Math.sin(a * 0.8) * LOOP_RADIUS;
    return out;
}

export class FloatDrift {
    /**
     * @param {object} params
     * @param {Array} [params.pads]     planFlora().pads
     * @param {Array} [params.lilies]   planFlora().lilies (each names the pad it stands on)
     * @param {Array} [params.leaves]   planFloaters()
     * @param {Array} [params.rocks]    rocks standing in the water
     * @param {number} [params.waveSpeed]
     */
    constructor({
        pads = [], lilies = [], leaves = [], rocks = [], waveSpeed = DEFAULT_WAVE_SPEED,
    } = {}) {
        this.padCount = pads.length;
        this.leafCount = leaves.length;
        this.count = this.padCount + this.leafCount;
        this.rocks = rocks;
        this.waveSpeed = waveSpeed;
        const n = Math.max(1, this.count);
        const f32 = () => new Float32Array(n);
        // What each thing is.
        this.kind = new Uint8Array(n);
        this.radius = f32();
        this.anchorX = f32();
        this.anchorZ = f32();
        this.baseTurn = f32();
        this.rate = f32();
        this.phase = f32();
        // Where it is and how it moves.
        this.x = f32();
        this.z = f32();
        this.vx = f32();
        this.vz = f32();
        this.turn = f32();
        this.spin = f32();
        this.tiltX = f32();
        this.tiltZ = f32();
        this.tiltVX = f32();
        this.tiltVZ = f32();
        this.dip = f32();
        this.dipV = f32();
        this.wet = f32();
        this.homeX = f32();
        this.homeZ = f32();
        /** Water to spare under it (m) since the depth was last asked (see BED_SLOPE). */
        this.slack = f32();
        // What pushes it this step.
        this.ax = f32();
        this.az = f32();
        this.restTiltX = f32();
        this.restTiltZ = f32();
        this.restDip = f32();

        pads.forEach((pad, i) => {
            this.kind[i] = KIND_PAD;
            this.radius[i] = pad.radius;
            this.anchorX[i] = pad.x;
            this.anchorZ[i] = pad.z;
            this.baseTurn[i] = pad.turn;
        });
        leaves.forEach((leaf, k) => {
            const i = this.padCount + k;
            this.kind[i] = KIND_LEAF;
            this.radius[i] = leaf.size * 0.5;
            this.anchorX[i] = leaf.x;
            this.anchorZ[i] = leaf.z;
            this.baseTurn[i] = leaf.turn;
            this.rate[i] = leaf.rate;
            this.phase[i] = leaf.phase;
        });

        // Each lily rides its pad: where it stands on the pad, as planted.
        this.lilyCount = lilies.length;
        this.lilyPad = new Int16Array(Math.max(1, this.lilyCount)).fill(-1);
        this.lilyX = new Float32Array(Math.max(1, this.lilyCount));
        this.lilyZ = new Float32Array(Math.max(1, this.lilyCount));
        lilies.forEach((lily, k) => {
            this.lilyX[k] = lily.x;
            this.lilyZ[k] = lily.z;
            this.lilyPad[k] = Number.isInteger(lily.pad) && lily.pad >= 0 && lily.pad < this.padCount ? lily.pad : -1;
        });

        this.pulses = Array.from({ length: PULSE_SLOTS }, () => ({
            x: 0, z: 0, birth: -100, power: 0, radius: 0.2, seed: 0,
        }));
        this.pulseCursor = 0;
        /** What the world tells it each step (set in place; read by step()). */
        this.env = {
            school: null,
            ringX: 0,
            ringZ: 0,
            ringRX: 2.75,
            ringRZ: 2.05,
            swirl: 0,
            windX: 0,
            windZ: 0,
            stir: 1,
            still: 0,
        };
        /** 1 = full motion; reduced motion calms the jolts. */
        this.motion = 1;
        this._loop = { x: 0, z: 0 };
        this._flow = { x: 0, z: 0 };
        this._deeper = { x: 0, z: 0 };
        this.reset(0);
    }

    /** Still water at `time`: every pad at its stalk, every leaf on its loop, nothing in flight. */
    reset(time = 0) {
        this.time = time;
        for (let i = 0; i < this.count; i += 1) {
            if (this.kind[i] === KIND_LEAF) {
                const at = loopAt(this.rate[i], this.phase[i], time, this._loop);
                this.homeX[i] = this.anchorX[i];
                this.homeZ[i] = this.anchorZ[i];
                this.x[i] = this.anchorX[i] + at.x;
                this.z[i] = this.anchorZ[i] + at.z;
                // (The turn it had drifted to under the old clock-driven loop.)
                this.turn[i] = this.baseTurn[i] + time * 0.05 * (this.rate[i] - 0.85);
            } else {
                this.x[i] = this.anchorX[i];
                this.z[i] = this.anchorZ[i];
                this.turn[i] = this.baseTurn[i];
            }
            this.vx[i] = 0;
            this.vz[i] = 0;
            this.spin[i] = 0;
            this.tiltX[i] = 0;
            this.tiltZ[i] = 0;
            this.tiltVX[i] = 0;
            this.tiltVZ[i] = 0;
            this.dip[i] = 0;
            this.dipV[i] = 0;
            this.wet[i] = 0;
            this.slack[i] = 0;
        }
        this.pulses.forEach((p) => {
            p.birth = -100;
            p.power = 0;
        });
        this.pulseCursor = 0;
        this.counts = { pulses: 0, nibbles: 0 };
        // A leaf whose loop starts it under a pad or against a rock is settled at its rim now,
        // so the first frame after a seek shows nothing jump.
        for (let k = 0; k < 6; k += 1) this.keepApart(true);
        this.vx.fill(0);
        this.vz.fill(0);
    }

    /** Reduced motion calms every jolt (the drift itself is slow enough to keep). */
    setMotion(motion = 1) {
        this.motion = clamp01(Number.isFinite(motion) ? motion : 1);
    }

    /** The front of plunge `p` still carries this much push at `time` (0 once spent). */
    pulseLeft(p, time) {
        const age = time - p.birth;
        if (!(p.power > 0) || age < 0 || age >= PULSE_LIFE) return 0;
        return p.power * Math.exp(-0.5 * age);
    }

    /**
     * Something met the water at (x, z) (the same numbers as PondSurface.plunge): its front will
     * cross the pond, and what lies where it struck is pushed under, rocked and wetted now.
     */
    pulse(x, z, { amp = 0.02, radius = 0.22, foam = 0 } = {}) {
        const power = Math.abs(amp) * (0.6 + radius);
        if (!(power >= LEAST_POWER) || !Number.isFinite(x) || !Number.isFinite(z)) return;
        let pick = this.pulseCursor % PULSE_SLOTS;
        let least = Infinity;
        for (let k = 0; k < PULSE_SLOTS; k += 1) {
            const i = (this.pulseCursor + k) % PULSE_SLOTS;
            const left = this.pulseLeft(this.pulses[i], this.time);
            if (left < least) {
                least = left;
                pick = i;
                if (left <= 0) break;
            }
        }
        const slot = this.pulses[pick];
        this.pulseCursor = pick + 1;
        slot.x = x;
        slot.z = z;
        slot.birth = this.time;
        slot.power = power;
        slot.radius = radius;
        slot.seed = this.counts.pulses;
        this.counts.pulses += 1;

        // ── Where it struck ──
        const jolt = clamp01(power / 0.05) * (0.5 + 0.5 * this.motion);
        const wetted = clamp01(0.5 + foam);
        for (let i = 0; i < this.count; i += 1) {
            const dx = this.x[i] - x;
            const dz = this.z[i] - z;
            const reach = radius + this.radius[i] + 0.25;
            if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
            const d = Math.hypot(dx, dz);
            if (d >= reach) continue;
            const s = jolt * (1 - d / reach);
            const leaf = this.kind[i] === KIND_LEAF;
            this.dipV[i] -= (leaf ? 0.16 : 0.05) * s;
            this.wet[i] = Math.max(this.wet[i], s * wetted * 1.6);
            // The side toward the splash is struck down (the rock is a slope: height = rock · offset).
            const inv = d > 1e-3 ? 1 / d : 0;
            this.tiltVX[i] += dx * inv * (leaf ? 0.6 : 0.3) * s;
            this.tiltVZ[i] += dz * inv * (leaf ? 0.6 : 0.3) * s;
            if (leaf) this.spin[i] += (hash2(i, slot.seed) - 0.5) * 4 * s;
        }
    }

    /**
     * A koi's mouth broke the surface at (x, z): if a leaf or a pad's rim is within reach, it
     * is mouthed. Returns the index of what was taken, or -1.
     * @param {number} length    the koi's length (a big fish reaches further)
     * @param {number} heading   which way it was swimming
     */
    nibble(x, z, length = 1, heading = 0) {
        let best = -1;
        let bestGap = 0.12 + length * 0.06;
        for (let i = 0; i < this.count; i += 1) {
            const dx = this.x[i] - x;
            const dz = this.z[i] - z;
            if (Math.abs(dx) > 1 || Math.abs(dz) > 1) continue;
            const gap = Math.hypot(dx, dz) - this.radius[i];
            if (gap < bestGap) {
                bestGap = gap;
                best = i;
            }
        }
        if (best < 0) return -1;
        const i = best;
        const s = 0.5 + 0.5 * this.motion;
        let dx = x - this.x[i];
        let dz = z - this.z[i];
        const d = Math.hypot(dx, dz);
        if (d > 1e-3) {
            dx /= d;
            dz /= d;
        } else {
            // (Mouthed from straight below: toward where the fish came from.)
            dx = -Math.cos(heading);
            dz = -Math.sin(heading);
        }
        if (this.kind[i] === KIND_LEAF) {
            // Tugged toward the mouth, sucked under, spun.
            this.vx[i] += dx * 0.22 * s;
            this.vz[i] += dz * 0.22 * s;
            this.dipV[i] -= 0.3 * s;
            this.spin[i] += (hash2(i, this.counts.nibbles) < 0.5 ? -1 : 1) * 2.4 * s;
            this.wet[i] = 1;
        } else {
            // The rim toward the mouth is pulled down and the pad yanked toward it, twisting on
            // its stalk. (Seen from above a dipping rim hardly shows: the yank is what reads.)
            this.tiltVX[i] -= dx * 0.5 * s;
            this.tiltVZ[i] -= dz * 0.5 * s;
            this.dipV[i] -= 0.05 * s;
            this.vx[i] += dx * 0.17 * s;
            this.vz[i] += dz * 0.17 * s;
            const way = hash2(i, this.counts.nibbles) < 0.5 ? -1 : 1;
            this.spin[i] += way * (0.35 + 0.3 * hash2(i + 5, this.counts.nibbles)) * s;
            this.wet[i] = Math.max(this.wet[i], 0.8);
        }
        this.counts.nibbles += 1;
        return best;
    }

    /** The water's own flow at (x, z): the chain's current round the board. */
    flowAt(x, z, out = this._flow) {
        const { env } = this;
        out.x = 0;
        out.z = 0;
        if (!(env.swirl > 0.001)) return out;
        const qx = (x - env.ringX) / env.ringRX;
        const qz = (z - env.ringZ) / env.ringRZ;
        const rho = Math.hypot(qx, qz);
        if (rho < 1e-3) return out;
        const off = (rho - 1) / SWIRL_BAND;
        if (Math.abs(off) > 3) return out;
        // Round the ring the way the koi swim it (the angle on the ellipse increasing).
        let tx = -qz * env.ringRX;
        let tz = qx * env.ringRZ;
        const len = Math.hypot(tx, tz) || 1;
        tx /= len;
        tz /= len;
        const speed = env.swirl * SWIRL_SPEED * Math.exp(-off * off);
        out.x = tx * speed;
        out.z = tz * speed;
        return out;
    }

    /** One step of `dt` seconds. */
    step(dt) {
        if (!(dt > 0) || this.count === 0) return;
        this.time += dt;
        const t = this.time;
        const { env } = this;
        const calm = 1 - clamp01(env.still);
        const jolt = 0.5 + 0.5 * this.motion;
        this.ax.fill(0);
        this.az.fill(0);
        this.restTiltX.fill(0);
        this.restTiltZ.fill(0);
        this.restDip.fill(0);

        if (env.school) this.feelKoi(env.school, dt);
        this.feelFronts(t, jolt);

        const flow = this._flow;
        const loop = this._loop;
        for (let i = 0; i < this.count; i += 1) {
            const leaf = this.kind[i] === KIND_LEAF;
            const feel = FEEL[this.kind[i]];
            let ax = this.ax[i];
            let az = this.az[i];
            if (leaf) {
                // Its resting place drifts with the water's current and creeps back to where it fell.
                this.flowAt(this.homeX[i], this.homeZ[i], flow);
                const hx = this.homeX[i] + flow.x * dt + (this.anchorX[i] - this.homeX[i]) * (dt / HOME_RETURN);
                const hz = this.homeZ[i] + flow.z * dt + (this.anchorZ[i] - this.homeZ[i]) * (dt / HOME_RETURN);
                // (Without a current it only creeps back toward where it fell, which is water.)
                const still = flow.x === 0 && flow.z === 0;
                if (still || waterDepth(hx, hz) >= feel.depth + 0.04) {
                    this.homeX[i] = hx;
                    this.homeZ[i] = hz;
                } else {
                    this.homeX[i] += (this.anchorX[i] - this.homeX[i]) * approach(0.5, dt);
                    this.homeZ[i] += (this.anchorZ[i] - this.homeZ[i]) * approach(0.5, dt);
                }
                const at = loopAt(this.rate[i], this.phase[i], t, loop);
                ax += (this.homeX[i] + at.x - this.x[i]) * feel.pull;
                az += (this.homeZ[i] + at.z - this.z[i]) * feel.pull;
            } else {
                // Held by its stalk: back toward where it grows, hard past the stalk's reach.
                const ox = this.x[i] - this.anchorX[i];
                const oz = this.z[i] - this.anchorZ[i];
                ax -= ox * feel.pull;
                az -= oz * feel.pull;
                const reach = TETHER + this.radius[i] * TETHER_SHARE;
                const d = Math.hypot(ox, oz);
                if (d > reach) {
                    const over = ((d - reach) * TETHER_STIFF) / d;
                    ax -= ox * over;
                    az -= oz * over;
                }
            }
            // The water drags it toward the way the water (and the breeze on it) goes.
            this.flowAt(this.x[i], this.z[i], flow);
            const wx = flow.x * feel.carry + env.windX * feel.windage * calm;
            const wz = flow.z * feel.carry + env.windZ * feel.windage * calm;
            ax += (wx - this.vx[i]) * feel.drag;
            az += (wz - this.vz[i]) * feel.drag;

            let vx = this.vx[i] + ax * dt;
            let vz = this.vz[i] + az * dt;
            const speed = Math.hypot(vx, vz);
            if (speed > feel.top) {
                vx *= feel.top / speed;
                vz *= feel.top / speed;
            }
            // It never runs aground: a step into water too shallow is not taken, it slides along.
            // (The depth is only asked again once it may have run short: `slack` is the water to
            // spare under it at the last asking, less what the bed could have risen since.)
            let nx = this.x[i] + vx * dt;
            let nz = this.z[i] + vz * dt;
            const rise = Math.hypot(vx, vz) * dt * BED_SLOPE;
            if (this.slack[i] - rise > 0.02) this.slack[i] -= rise;
            else {
                let depth = waterDepth(nx, nz);
                if (depth < feel.depth) {
                    const deeper = deeperAt(nx, nz, this._deeper);
                    const into = vx * deeper.x + vz * deeper.z;
                    if (into < 0) {
                        vx -= into * deeper.x;
                        vz -= into * deeper.z;
                    }
                    nx = this.x[i] + vx * dt;
                    nz = this.z[i] + vz * dt;
                    depth = waterDepth(nx, nz);
                    if (depth < feel.depth && depth <= waterDepth(this.x[i], this.z[i])) {
                        // Stuck in the shallows: ease it out toward deeper water.
                        deeperAt(this.x[i], this.z[i], deeper);
                        vx = deeper.x * 0.08;
                        vz = deeper.z * 0.08;
                        nx = this.x[i] + vx * dt;
                        nz = this.z[i] + vz * dt;
                    }
                }
                this.slack[i] = depth - feel.depth;
            }
            this.vx[i] = vx;
            this.vz[i] = vz;
            this.x[i] = clamp(nx, POND.minX + 0.3, POND.maxX - 0.3);
            this.z[i] = clamp(nz, POND.minZ + 0.3, POND.maxZ - 0.3);
        }

        this.keepApart();

        for (let i = 0; i < this.count; i += 1) {
            const leaf = this.kind[i] === KIND_LEAF;
            const feel = FEEL[this.kind[i]];
            // ── Turn: a leaf turns at its own lazy rate (faster as the air stirs); a pad back to rest ──
            if (leaf) {
                const lazy = 0.05 * (this.rate[i] - 0.85) * env.stir * calm;
                this.spin[i] += (lazy - this.spin[i]) * approach(0.8, dt);
            } else {
                this.spin[i] += (-(this.turn[i] - this.baseTurn[i]) * 0.6 - this.spin[i] * 1.4) * dt;
            }
            this.spin[i] = clamp(this.spin[i], -4, 4);
            this.turn[i] += this.spin[i] * dt;
            // ── Rock and dip: damped springs about what the koi under it ask ──
            this.tiltVX[i] += ((this.restTiltX[i] - this.tiltX[i]) * TILT_K - this.tiltVX[i] * TILT_DAMP) * dt;
            this.tiltVZ[i] += ((this.restTiltZ[i] - this.tiltZ[i]) * TILT_K - this.tiltVZ[i] * TILT_DAMP) * dt;
            this.tiltX[i] = clamp(this.tiltX[i] + this.tiltVX[i] * dt, -feel.tilt, feel.tilt);
            this.tiltZ[i] = clamp(this.tiltZ[i] + this.tiltVZ[i] * dt, -feel.tilt, feel.tilt);
            this.dipV[i] += ((this.restDip[i] - this.dip[i]) * DIP_K - this.dipV[i] * DIP_DAMP) * dt;
            this.dip[i] = clamp(this.dip[i] + this.dipV[i] * dt, feel.dipLow, feel.dipHigh);
            if (this.dip[i] === feel.dipLow || this.dip[i] === feel.dipHigh) this.dipV[i] *= 0.5;
            this.wet[i] *= Math.exp(-dt / feel.wetFor);
        }
    }

    /** The fronts of the plunges in flight shove what they pass outward and set leaves turning. */
    feelFronts(t, jolt) {
        for (let k = 0; k < PULSE_SLOTS; k += 1) {
            const p = this.pulses[k];
            const left = this.pulseLeft(p, t);
            if (!(left > 1e-4)) continue;
            const age = t - p.birth;
            const front = p.radius + this.waveSpeed * age;
            for (let i = 0; i < this.count; i += 1) {
                const dx = this.x[i] - p.x;
                const dz = this.z[i] - p.z;
                if (Math.abs(dx) > front + FRONT * 3 || Math.abs(dz) > front + FRONT * 3) continue;
                const d = Math.hypot(dx, dz);
                const off = (d - front) / FRONT;
                if (Math.abs(off) > 3) continue;
                const leaf = this.kind[i] === KIND_LEAF;
                const push = ((PULSE_GAIN * left * Math.exp(-off * off)) / (0.4 + d)) * FEEL[this.kind[i]].heft * jolt;
                let ux = dx;
                let uz = dz;
                if (d > 1e-3) {
                    ux /= d;
                    uz /= d;
                } else {
                    const a = hash2(i, p.seed) * Math.PI * 2;
                    ux = Math.cos(a);
                    uz = Math.sin(a);
                }
                this.ax[i] += ux * push;
                this.az[i] += uz * push;
                // A front catches a leaf off-centre: each turns its own way.
                if (leaf) this.spin[i] += (hash2(i + 17, p.seed) - 0.5) * push * 0.12;
            }
        }
    }

    /**
     * The koi near the surface (a KoiSchool, read only): each parts what floats over its back,
     * carries it a little way and turns it; one just under a pad lifts and rocks it.
     */
    feelKoi(school, dt) {
        const reachMax = 1.6;
        for (let f = 0; f < school.count; f += 1) {
            if (school.airborne(f)) continue;
            const depth = -school.y[f];
            const near = clamp01(1 - (depth - 0.03) / 0.36);
            if (near < 0.04) continue;
            const fishX = school.x[f];
            const fishZ = school.z[f];
            const { length } = school.fish[f];
            const hx = Math.cos(school.heading[f]);
            const hz = Math.sin(school.heading[f]);
            const speed = school.speed[f];
            const fvx = hx * speed;
            const fvz = hz * speed;
            // The fish as a segment from its tail to its nose.
            const tailX = fishX - hx * length * 0.5;
            const tailZ = fishZ - hz * length * 0.5;
            const span = length * 0.95;
            const girth = length * 0.2 + 0.1;
            const near2 = near * near;
            for (let i = 0; i < this.count; i += 1) {
                const r = this.radius[i];
                const px = this.x[i] - tailX;
                const pz = this.z[i] - tailZ;
                if (Math.abs(this.x[i] - fishX) > reachMax || Math.abs(this.z[i] - fishZ) > reachMax) continue;
                const s = clamp((px * hx + pz * hz) / span, 0, 1);
                const cx = tailX + hx * s * span;
                const cz = tailZ + hz * s * span;
                const ox = this.x[i] - cx;
                const oz = this.z[i] - cz;
                const d = Math.hypot(ox, oz);
                const reach = r + girth;
                if (d >= reach) continue;
                const w = near2 * (1 - d / reach);
                const { heft } = FEEL[this.kind[i]];
                let awayX = -hz;
                let awayZ = hx;
                if (d > 1e-4) {
                    awayX = ox / d;
                    awayZ = oz / d;
                } else if (hash2(i, f) < 0.5) {
                    awayX = hz;
                    awayZ = -hx;
                }
                // Carried along with the fish, and parted to either side of its back.
                this.ax[i] += w * heft * (CARRY_K * (fvx * 0.55 - this.vx[i]) + awayX * PART_K * (0.4 + speed * 1.5));
                this.az[i] += w * heft * (CARRY_K * (fvz * 0.55 - this.vz[i]) + awayZ * PART_K * (0.4 + speed * 1.5));
                // Brushed off-centre, it turns. (A positive turn carries +x toward +z, as the
                // shaders' rotateY does: the torque of the fish's push at the point it touches.)
                const twist = ((cx - this.x[i]) * fvz - (cz - this.z[i]) * fvx) / Math.max(r, 0.06);
                this.spin[i] += w * TWIST_K * twist * dt;
                // A back just under it lifts it, the side over the fish highest.
                if (near > 0.45 && d < r + girth * 0.5) {
                    const lift = ((near - 0.45) / 0.55) * (1 - d / reach);
                    const leaf = this.kind[i] === KIND_LEAF;
                    this.restDip[i] = Math.max(this.restDip[i], (leaf ? 0.004 : 0.0075) * lift);
                    const bx = cx - this.x[i];
                    const bz = cz - this.z[i];
                    const b = Math.hypot(bx, bz);
                    const ux = b > 1e-3 ? bx / b : hx;
                    const uz = b > 1e-3 ? bz / b : hz;
                    this.restTiltX[i] += ux * 0.06 * lift;
                    this.restTiltZ[i] += uz * 0.06 * lift;
                }
            }
        }
    }

    /**
     * Pads keep apart; a leaf that drifts against a pad comes to rest at its rim; rocks stand.
     * `settling` (a reset): only the leaves give way, every pad stays at its stalk.
     */
    keepApart(settling = false) {
        const P = this.padCount;
        for (let i = 0; i < P; i += 1) {
            for (let j = i + 1; j < P; j += 1) {
                const dx = this.x[j] - this.x[i];
                const dz = this.z[j] - this.z[i];
                const room = (this.radius[i] + this.radius[j]) * 0.88;
                if (Math.abs(dx) > room || Math.abs(dz) > room) continue;
                const d = Math.hypot(dx, dz);
                if (d >= room || d < 1e-5) continue;
                const half = ((room - d) * 0.5) / d;
                this.x[i] -= dx * half;
                this.z[i] -= dz * half;
                this.x[j] += dx * half;
                this.z[j] += dz * half;
                // (Shouldered aside: their depth is asked again on the next step.)
                this.slack[i] = 0;
                this.slack[j] = 0;
                // (They share their motion along the line between them.)
                const rel = ((this.vx[j] - this.vx[i]) * dx + (this.vz[j] - this.vz[i]) * dz) / d;
                if (rel < 0) {
                    const ux = dx / d;
                    const uz = dz / d;
                    this.vx[i] += ux * rel * 0.5;
                    this.vz[i] += uz * rel * 0.5;
                    this.vx[j] -= ux * rel * 0.5;
                    this.vz[j] -= uz * rel * 0.5;
                }
            }
        }
        for (let i = P; i < this.count; i += 1) {
            for (let p = 0; p < P; p += 1) {
                const dx = this.x[i] - this.x[p];
                const dz = this.z[i] - this.z[p];
                const room = this.radius[p] * 0.95 + this.radius[i];
                if (Math.abs(dx) > room || Math.abs(dz) > room) continue;
                const d = Math.hypot(dx, dz);
                if (d >= room) continue;
                const ux = d > 1e-5 ? dx / d : 1;
                const uz = d > 1e-5 ? dz / d : 0;
                const out = room - d;
                // (Never shouldered out of the water: it may lie under the rim instead.)
                if (waterDepth(this.x[i] + ux * out, this.z[i] + uz * out) < FEEL[KIND_LEAF].depth) continue;
                this.x[i] += ux * out * 0.92;
                this.z[i] += uz * out * 0.92;
                if (!settling) {
                    this.x[p] -= ux * out * 0.08;
                    this.z[p] -= uz * out * 0.08;
                }
                this.slack[i] = 0;
                this.slack[p] = 0;
                const into = this.vx[i] * ux + this.vz[i] * uz;
                if (into < 0) {
                    this.vx[i] -= into * ux;
                    this.vz[i] -= into * uz;
                }
            }
        }
        for (let r = 0; r < this.rocks.length; r += 1) {
            const rock = this.rocks[r];
            for (let i = 0; i < this.count; i += 1) {
                const dx = this.x[i] - rock.x;
                const dz = this.z[i] - rock.z;
                const room = rock.radius + this.radius[i] * 0.8;
                if (Math.abs(dx) > room || Math.abs(dz) > room) continue;
                const d = Math.hypot(dx, dz);
                if (d >= room) continue;
                const ux = d > 1e-5 ? dx / d : 1;
                const uz = d > 1e-5 ? dz / d : 0;
                if (waterDepth(rock.x + ux * room, rock.z + uz * room) < FEEL[this.kind[i]].depth * 0.5) continue;
                this.x[i] = rock.x + ux * room;
                this.z[i] = rock.z + uz * room;
                this.slack[i] = 0;
                const into = this.vx[i] * ux + this.vz[i] * uz;
                if (into < 0) {
                    this.vx[i] -= into * ux;
                    this.vz[i] -= into * uz;
                }
            }
        }
    }

    // ── For the renderer ────────────────────────────────────────────────────────────────────

    /** Each pad: x, z, turn, dip, rock x, rock z, wetness, 0 (`stride` floats). */
    writePads(out, stride = 8) {
        for (let i = 0; i < this.padCount; i += 1) this.writeBody(out, i * stride, i);
    }

    /** Each fallen leaf or petal, the same eight numbers. */
    writeLeaves(out, stride = 8) {
        for (let k = 0; k < this.leafCount; k += 1) this.writeBody(out, k * stride, this.padCount + k);
    }

    writeBody(out, o, i) {
        out[o] = this.x[i];
        out[o + 1] = this.z[i];
        out[o + 2] = this.turn[i];
        out[o + 3] = this.dip[i];
        out[o + 4] = this.tiltX[i];
        out[o + 5] = this.tiltZ[i];
        out[o + 6] = this.wet[i];
        out[o + 7] = 0;
    }

    /** Where lily `k` stands now (its pad carries and turns it). */
    lilyAt(k, out = { x: 0, z: 0, turn: 0 }) {
        const p = this.lilyPad[k];
        if (p < 0) {
            out.x = this.lilyX[k];
            out.z = this.lilyZ[k];
            out.turn = 0;
            return out;
        }
        const turn = this.turn[p] - this.baseTurn[p];
        const ox = this.lilyX[k] - this.anchorX[p];
        const oz = this.lilyZ[k] - this.anchorZ[p];
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        // (The shaders' rotateY: x' = x cos - z sin, z' = x sin + z cos.)
        out.x = this.x[p] + ox * c - oz * s;
        out.z = this.z[p] + ox * s + oz * c;
        out.turn = turn;
        return out;
    }

    /**
     * The lilies' motion rows (koi-pond-flora.js LILY_MOTION_ROWS = 2 a flower): how far each
     * stands from where it was planted and how far it is turned, its pad's dip; its pad's rock
     * and wetness. `rows` holds objects with x, y, z, w (THREE.Vector4).
     */
    writeLilies(rows) {
        const at = this._lily || (this._lily = { x: 0, z: 0, turn: 0 });
        for (let k = 0; k < this.lilyCount; k += 1) {
            const a = rows[k * 2];
            const b = rows[k * 2 + 1];
            if (!a || !b) break;
            this.lilyAt(k, at);
            const p = this.lilyPad[k];
            a.x = at.x - this.lilyX[k];
            a.y = at.z - this.lilyZ[k];
            a.z = at.turn;
            a.w = p >= 0 ? this.dip[p] : 0;
            b.x = p >= 0 ? this.tiltX[p] : 0;
            b.y = p >= 0 ? this.tiltZ[p] : 0;
            b.z = p >= 0 ? this.wet[p] : 0;
            b.w = 0;
        }
    }

    /** What the drift has done (diagnostics, tests). */
    state() {
        let swing = 0;
        let stray = 0;
        let wet = 0;
        let fastest = 0;
        const loop = this._loop;
        for (let i = 0; i < this.count; i += 1) {
            if (this.kind[i] === KIND_PAD) {
                swing = Math.max(swing, Math.hypot(this.x[i] - this.anchorX[i], this.z[i] - this.anchorZ[i]));
            } else {
                const at = loopAt(this.rate[i], this.phase[i], this.time, loop);
                const off = Math.hypot(this.x[i] - this.homeX[i] - at.x, this.z[i] - this.homeZ[i] - at.z);
                stray = Math.max(stray, off);
            }
            if (this.wet[i] > 0.3) wet += 1;
            fastest = Math.max(fastest, Math.hypot(this.vx[i], this.vz[i]));
        }
        const round = (v) => Math.round(v * 1000) / 1000;
        return {
            pulses: this.counts.pulses,
            nibbles: this.counts.nibbles,
            padSwing: round(swing),
            leafStray: round(stray),
            wet,
            fastest: round(fastest),
        };
    }
}
