/**
 * Stillwater — the troll's body: how he sits, gets up, walks, stands, lifts his lantern.
 *
 * No clips. Every frame his skeleton is posed from what he means to do (`TrollBody.update`, fed by
 * the story in stillwater-story.js), in layers, the way a heavy body moves:
 *
 *   feet     planted where they landed. A step is taken only when a foot has fallen too far behind
 *            where it should be (he walks, or turns, or shifts his weight), one foot at a time, in
 *            an arc that lifts the heel first and lands it last; the knee is bent by a two-bone
 *            solve onto the real ground, so nothing slides and the slope is felt.
 *   hips     carried by the feet: they rise as a leg passes under them, sink as a foot lands, and
 *            roll over whichever leg bears the weight (a troll's rolling gait).
 *   staff    his walking staff is placed first, like a third foot, and his left hand takes it where
 *            it stands; lifted, it carries the lantern up or out over the water.
 *   look     the head finds what he watches first, the neck after, the chest last.
 *   acts     sitting down and getting up, crouching to the water, a start: short timelines that
 *            lean in before they move (anticipation) and settle after.
 *   breath   a slow rise and fall of the chest, deeper after walking.
 *
 * Frames: the "walk frame" is the stage in true metres (stage x times the squeeze), y up, the
 * water at 0; the model frame is the sculpt's unit frame (x his left, y up, z his front), scaled
 * by TROLL.height with the soles at `sole`. Every bone rests unrotated in the model frame.
 */

import * as THREE from 'three/webgpu';
import {
    Pendulum, Spring3, clamp, smoothstep, solveTwoBone, spring, springAngle, springTo, rotationBetweenFrames,
    wrapAngle,
} from './stillwater-motion.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Seconds a step's swing takes, how high the foot lifts (m), and how far one may reach (m). */
const STEP_TIME = 0.7;
const STEP_LIFT = 0.13;
const STEP_MAX = 0.62;

/** Seconds the acts take. */
export const ACT_TIME = Object.freeze({
    sitDown: 2.0,
    standUp: 1.7,
    crouch: 1.3,
    rise: 1.2,
});

/** The bones the body poses (the file's names). */
const SIDES = Object.freeze({ L: 1, R: -1 });

/** The staff: metres from its foot to where it is gripped, and its whole length. */
export const STAFF = Object.freeze({ grip: 0.66, length: 2.55, hook: 0.2 });

/** A smooth 0 → 1 → 0 over [a, b] with a plateau in the middle third. */
const hump = (a, b, v) => smoothstep(a, a + (b - a) / 3, v) * (1 - smoothstep(b - (b - a) / 3, b, v));

export class TrollBody {
    /**
     * @param {Record<string, THREE.Vector3>} rest  each bone's head in the model frame
     * @param {object} opts
     * @param {number} opts.sole       the soles' height in the model frame
     * @param {number} opts.height     metres per model unit
     * @param {(x: number, z: number) => number} opts.ground   ground height in the walk frame
     */
    constructor(rest, {
        sole = -0.503, height = 2.9, ground = () => 0, parents = {},
    } = {}) {
        this.rest = rest;
        this.parents = parents;
        this.sole = sole;
        this.H = height;
        this.ground = ground;
        /** The local rotations this frame, by bone name, and the hips' offset (model units). */
        this.local = {};
        Object.keys(rest).forEach((name) => {
            this.local[name] = new THREE.Quaternion();
        });
        this.hipsOffset = new THREE.Vector3();
        this.global = {};
        this.globalPos = {};
        Object.keys(rest).forEach((name) => {
            this.global[name] = new THREE.Quaternion();
            this.globalPos[name] = new THREE.Vector3();
        });
        this.parentOf = {};
        this.order = [];
        this.legs = {
            L: this.limb('thighL', 'shinL', 'footL', 'toeL'),
            R: this.limb('thighR', 'shinR', 'footR', 'toeR'),
        };
        this.arms = {
            L: this.limb('upperL', 'foreL', 'handL'),
            R: this.limb('upperR', 'foreR', 'handR'),
        };
        /** Height of the ankle over the sole (model units), and of the hips' joint. */
        this.ankleUp = rest.footL ? rest.footL.y - sole : 0.05;
        this.hipUp = rest.thighL ? rest.thighL.y - sole : 0.29;
        this.root = new THREE.Vector3();
        this.heading = 0;
        this._q = new THREE.Quaternion();
        this._q2 = new THREE.Quaternion();
        this._g1 = new THREE.Quaternion();
        this._g2 = new THREE.Quaternion();
        this._gf = new THREE.Quaternion();
        this._gt = new THREE.Quaternion();
        this._inv = new THREE.Quaternion();
        this._v = new THREE.Vector3();
        this._v2 = new THREE.Vector3();
        this._v3 = new THREE.Vector3();
        this._mid = new THREE.Vector3();
        this._end = new THREE.Vector3();
        this._pole = new THREE.Vector3();
        this._e = new THREE.Euler();
        this.events = [];
        this.reset(0, 0, 0);
    }

    /** One limb's bones and rest geometry. */
    limb(a, b, c, d = null) {
        const r = this.rest;
        if (!r[a] || !r[b] || !r[c]) return null;
        return {
            names: [a, b, c, d],
            l1: r[b].distanceTo(r[a]),
            l2: r[c].distanceTo(r[b]),
            dir1: r[b].clone().sub(r[a]).normalize(),
            dir2: r[c].clone().sub(r[b]).normalize(),
            toe: d && r[d] ? r[d].clone().sub(r[c]) : null,
        };
    }

    /** Put him somewhere at rest: standing (or seated) at (x, z), facing `heading`. */
    reset(x, z, heading, { seated = false, seat = null } = {}) {
        this.root.set(x, this.ground(x, z), z);
        this.heading = heading;
        this.velocity = new THREE.Vector3();
        this.speed = 0;
        this.feet = {};
        ['L', 'R'].forEach((side) => {
            const p = this.neutralFoot(side, this.root, heading, new THREE.Vector3());
            this.feet[side] = {
                side,
                pos: p,
                yaw: heading,
                swing: null,
                landed: -10,
            };
        });
        this.lastSide = 'R';
        this.lastStepEnd = -10;
        this.mode = seated ? 'seated' : 'standing';
        this.act = null;
        this.sitK = seated ? 1 : 0;
        this.crouchK = 0;
        this.seat = seat ? seat.slice() : null;
        this.look = {
            yaw: spring(), pitch: spring(), chest: spring(), neck: spring(),
        };
        this.lean = spring();
        this.actS = { dy: spring(seated ? -0.25 : 0), dz: spring(seated ? -0.4 : 0), lean: spring(seated ? 0.06 : 0) };
        this.bodyY = spring(this.root.y);
        this.sway = new Spring3();
        this.hipsYaw = spring();
        this.breath = 0;
        this.exertion = 0;
        this.doze = spring();
        this.startle = spring();
        this.lastStartle = -Infinity;
        this._vx = 0;
        this._vz = 0;
        this._hv = 0;
        this.armR = new Spring3();
        this.gaitPhase = 0;
        this.staff = {
            grip: new Spring3(),
            dir: new Spring3(0, 1, 0),
            tip: null,
            stepping: null,
            mode: 'planted',
        };
        /** The lantern on its cord (metres): long enough to hang below his face, and to swing slow. */
        this.lantern = new Pendulum(0.55, 1.2);
        this.lanternAt = new THREE.Vector3();
        this.hookAt = new THREE.Vector3();
        this.time = 0;
        this.initialised = false;
        Object.values(this.local).forEach((q) => q.identity());
        this.hipsOffset.set(0, 0, 0);
    }

    // ── Frames ──────────────────────────────────────────────────────────────────

    /** Model point → walk frame. */
    toWalk(p, out = new THREE.Vector3()) {
        out.set(p.x, p.y - this.sole, p.z).multiplyScalar(this.H);
        out.applyAxisAngle(UP, this.heading);
        return out.add(this.root);
    }

    /** Walk-frame point → model. */
    toModel(w, out = new THREE.Vector3()) {
        out.copy(w).sub(this.root).applyAxisAngle(UP, -this.heading).divideScalar(this.H);
        out.y += this.sole;
        return out;
    }

    /** Walk-frame direction → model (no scale). */
    dirToModel(d, out = new THREE.Vector3()) {
        return out.copy(d).applyAxisAngle(UP, -this.heading);
    }

    /** Where a foot rests (its ankle over the ground) when he stands still at `root` facing `heading`. */
    neutralFoot(side, root, heading, out) {
        const r = this.rest[side === 'L' ? 'footL' : 'footR'];
        const x = r ? r.x : SIDES[side] * 0.155;
        const z = r ? r.z : 0;
        out.set(x * this.H, 0, z * this.H).applyAxisAngle(UP, heading).add(root);
        out.y = this.ground(out.x, out.z);
        return out;
    }

    // ── The frame ───────────────────────────────────────────────────────────────

    /**
     * Advance him by `dt` toward what he means to do.
     * @param {number} dt
     * @param {object} want
     * @param {number[]} want.at        [x, z] walk frame: where he should stand
     * @param {number} want.face        heading to face once there (radians, 0 = +z)
     * @param {boolean} want.sit        sit on the seat (only from where he stands by it)
     * @param {string} want.staff       'walk' | 'raise' | 'offer' | 'dip'
     * @param {boolean} want.crouch     crouch low (to the water)
     * @param {number[]|null} want.look [x, y, z] walk frame: what he watches
     * @param {number} want.reach       0..1: his right hand held out toward `look`
     * @param {number} time
     */
    update(dt, want, time) {
        this.time = time;
        this.events.length = 0;
        const h = Math.min(Math.max(0, dt), 0.1);
        if (!this.initialised) {
            this.initialised = true;
            this.placeStaffAtRest();
        }
        this.updateActs(h, want);
        this.updateLocomotion(h, want);
        this.updateFeet(h);
        this.updateBody(h, want);
        this.solve(h, want);
        return this;
    }

    /** Sitting down, getting up and crouching are acts: timelines that cannot be cut short. */
    updateActs(dt, want) {
        if (this.act) {
            this.act.t += dt;
            const k = clamp(this.act.t / this.act.time, 0, 1);
            this.act.k = k;
            if (k >= 1) {
                const done = this.act.name;
                this.act = null;
                if (done === 'sitDown') this.mode = 'seated';
                else if (done === 'standUp') this.mode = 'standing';
                else if (done === 'crouch') this.mode = 'crouched';
                else if (done === 'rise') this.mode = 'standing';
            }
        }
        const atSpot = Math.hypot(want.at[0] - this.root.x, want.at[1] - this.root.z) < 0.2;
        const facing = Math.abs(wrapAngle(want.face - this.heading)) < 0.35;
        if (this.act) {
            // An act he no longer means turns back from where it has got to (he does not finish
            // sitting down to get up again).
            const a = this.act;
            if (a.name === 'sitDown' && (!want.sit || !atSpot)) this.begin('standUp', 1 - a.k);
            else if (a.name === 'standUp' && want.sit && atSpot && a.k < 0.5) this.begin('sitDown', 1 - a.k);
            else if (a.name === 'crouch' && (!want.crouch || !atSpot)) this.begin('rise', 1 - a.k);
            return;
        }
        if (this.mode === 'seated' && (!want.sit || !atSpot)) this.begin('standUp');
        else if (this.mode === 'crouched' && (!want.crouch || !atSpot)) this.begin('rise');
        else if (this.mode === 'standing' && this.speed < 0.05 && !this.anySwing()) {
            // (Only by his stone: the seat is behind where he stands at home.)
            const bySeat = this.seat && Math.hypot(this.seat[0] - this.root.x, this.seat[2] - this.root.z) < 1.2;
            if (want.sit && atSpot && facing && bySeat) this.begin('sitDown');
            else if (want.crouch && atSpot && facing) this.begin('crouch');
        }
    }

    /** Start an act (`from` 0..1: how far into it, when it turns back from its opposite). */
    begin(name, from = 0) {
        const time = ACT_TIME[name];
        this.act = {
            name, t: from * time, k: from, time,
        };
        this.mode = name;
    }

    anySwing() {
        return Boolean(this.feet.L.swing || this.feet.R.swing);
    }

    /** The body's travel: toward where he should stand, turning to the way he goes. */
    updateLocomotion(dt, want) {
        const free = this.mode === 'standing';
        const dx = want.at[0] - this.root.x;
        const dz = want.at[1] - this.root.z;
        const dist = Math.hypot(dx, dz);
        let vx = 0;
        let vz = 0;
        if (free && dist > 0.06) {
            // Slow to a stop over the last half metre; never faster than his pace.
            const pace = (want.pace || 0.55) * clamp(dist / 0.55, 0.25, 1);
            vx = (dx / dist) * pace;
            vz = (dz / dist) * pace;
            // He does not set off before he has turned most of the way.
            const way = Math.atan2(dx, dz);
            const off = Math.abs(wrapAngle(way - this.heading));
            const ready = 1 - smoothstep(0.5, 1.3, off);
            vx *= ready;
            vz *= ready;
        }
        // The body gathers speed and sheds it like something heavy.
        const s = { x: this.velocity.x, v: this._vx || 0 };
        springTo(s, vx, 0.32, dt);
        this.velocity.x = s.x;
        this._vx = s.v;
        const s2 = { x: this.velocity.z, v: this._vz || 0 };
        springTo(s2, vz, 0.32, dt);
        this.velocity.z = s2.x;
        this._vz = s2.v;
        if (!free) this.velocity.set(0, 0, 0);
        this.speed = Math.hypot(this.velocity.x, this.velocity.z);
        this.root.x += this.velocity.x * dt;
        this.root.z += this.velocity.z * dt;
        // Turning: to the way he walks while he walks, else to what he should face.
        let target = want.face;
        if (free && dist > 0.25) target = Math.atan2(dx, dz);
        if (free) {
            const hs = { x: this.heading, v: this._hv || 0 };
            springAngle(hs, target, this.speed > 0.1 ? 0.35 : 0.55, dt);
            // A heavy body turns no faster than this.
            const turn = clamp(wrapAngle(hs.x - this.heading), -1.6 * dt, 1.6 * dt);
            this.heading = wrapAngle(this.heading + turn);
            this._hv = hs.v;
        }
        this.exertion = clamp(this.exertion + (this.speed > 0.1 ? dt * 0.12 : -dt * 0.05), 0, 1);
    }

    /** The feet: planted until they must step. */
    updateFeet(dt) {
        const t = this.time;
        const lead = this._v.copy(this.velocity).multiplyScalar(STEP_TIME * 0.75);
        const futureRoot = this._v2.copy(this.root).add(lead);
        let worst = null;
        let worstErr = 0;
        ['L', 'R'].forEach((side) => {
            const foot = this.feet[side];
            if (foot.swing) {
                const sw = foot.swing;
                sw.t += dt;
                const s = clamp(sw.t / sw.time, 0, 1);
                // Keep aiming at where it should land as the body goes on moving.
                this.neutralFoot(side, futureRoot, this.heading, sw.to);
                this.clampReach(side, sw.to);
                const e = s * s * (3 - 2 * s);
                foot.pos.lerpVectors(sw.from, sw.to, e);
                const lift = STEP_LIFT * (sw.small ? 0.5 : 1);
                foot.pos.y = sw.from.y + (sw.to.y - sw.from.y) * e + Math.sin(Math.PI * s) ** 0.8 * lift;
                foot.yaw = sw.yaw0 + wrapAngle(this.heading - sw.yaw0) * e;
                // Heel off first, toes up before it lands.
                foot.roll = 0.42 * Math.sin(Math.PI * 2 * s) * (1 - s) * (sw.small ? 0.5 : 1);
                if (s >= 1) {
                    foot.pos.copy(sw.to);
                    foot.yaw = this.heading;
                    foot.roll = 0;
                    foot.swing = null;
                    foot.landed = t;
                    this.lastStepEnd = t;
                    this.events.push({
                        type: 'footfall', side, x: foot.pos.x, y: foot.pos.y, z: foot.pos.z, strength: sw.small ? 0.4 : 1,
                    });
                }
                return;
            }
            foot.roll = 0;
            const ideal = this.neutralFoot(side, futureRoot, this.heading, this._v3);
            const err = Math.hypot(ideal.x - foot.pos.x, ideal.z - foot.pos.z)
                + Math.abs(wrapAngle(this.heading - foot.yaw)) * 0.25;
            if (err > worstErr) {
                worstErr = err;
                worst = side;
            }
        });
        if (this.anySwing() || !worst) return;
        if (this.mode !== 'standing') return;
        const moving = this.speed > 0.08;
        const threshold = moving ? 0.12 : 0.1;
        if (worstErr < threshold) return;
        if (t - this.lastStepEnd < (moving ? 0.04 : 0.25)) return;
        // Walking, the feet take turns.
        let side = worst;
        if (moving && side === this.lastSide) {
            const other = side === 'L' ? 'R' : 'L';
            side = other;
        }
        const foot = this.feet[side];
        const to = this.neutralFoot(side, futureRoot, this.heading, new THREE.Vector3());
        this.clampReach(side, to);
        foot.swing = {
            from: foot.pos.clone(),
            to,
            t: 0,
            time: STEP_TIME * (moving ? 1 : 0.85),
            yaw0: foot.yaw,
            small: !moving,
        };
        this.lastSide = side;
    }

    /** A step lands no further than a stride from the other foot. */
    clampReach(side, to) {
        const other = this.feet[side === 'L' ? 'R' : 'L'].pos;
        const dx = to.x - other.x;
        const dz = to.z - other.z;
        const d = Math.hypot(dx, dz);
        if (d > STEP_MAX * 1.6) {
            const k = (STEP_MAX * 1.6) / d;
            to.x = other.x + dx * k;
            to.z = other.z + dz * k;
        }
        to.y = this.ground(to.x, to.z);
    }

    /** The trunk: carried by the legs, leaning into its acts, breathing. */
    updateBody(dt, want) {
        // Where the root stands: the ground under the feet, eased.
        const gy = (this.feet.L.pos.y + this.feet.R.pos.y) * 0.5;
        springTo(this.bodyY, gy, 0.18, dt);
        this.root.y = this.bodyY.x;
        // How far into a step (the swinging foot's progress), and over which leg the weight is.
        let s = 0;
        let stance = 0;
        let swingSide = 0;
        ['L', 'R'].forEach((side) => {
            const sw = this.feet[side].swing;
            if (sw && !sw.small) {
                s = clamp(sw.t / sw.time, 0, 1);
                swingSide = SIDES[side];
                stance = -SIDES[side];
            }
        });
        const gait = clamp(this.speed / 0.4, 0, 1);
        // Rise as the leg passes under, sink as the foot lands; roll over the bearing leg.
        const bob = (Math.sin(Math.PI * s) - 0.35) * 0.045 * gait;
        const roll = stance * Math.sin(Math.PI * s) * 0.075 * gait;
        // Standing still he rests on one leg, then the other, every few seconds.
        const still = this.mode === 'standing' && this.speed < 0.05 && !this.anySwing() ? 1 : 0;
        const leg = Math.sin(Math.floor(this.time / 7.3) * 2.71 + 0.4) > 0 ? 1 : -1;
        const shift = stance * Math.sin(Math.PI * s) * 0.06 * gait + leg * 0.035 * still;
        this.sway.step(shift, bob, 0, 0.09, dt);
        springTo(this.hipsYaw, swingSide * (s - 0.5) * 0.16 * gait, 0.12, dt);
        this._roll = roll;
        // Leaning: into the walk, into an act, nodding off.
        const idle = this.mode === 'seated' ? 1 : 0;
        springTo(this.doze, want.doze ? idle : 0, want.doze ? 3.5 : 0.25, dt);
        springTo(this.startle, 0, 0.18, dt);
        // A start is taken once, whenever the frame after it comes.
        const startleAt = Number.isFinite(want.startleAt) ? want.startleAt : -Infinity;
        if (want.startle !== false && startleAt > this.lastStartle && this.time - startleAt < 0.6 && this.time >= startleAt) {
            this.lastStartle = startleAt;
            this.startle.x = 1;
            this.startle.v = 0;
        }
        // (Going home after a parting he walks bowed a little.)
        const lean = 0.12 * gait + 0.06 * this.exertion + this.doze.x * 0.12 + (want.heavy ? 0.08 : 0);
        springTo(this.lean, lean, 0.4, dt);
        // Breath: slower seated and dozing, quicker and deeper after a walk.
        const rate = (1 / 4.4) * (1 + this.exertion * 0.5) * (1 - this.doze.x * 0.25);
        this.breath += dt * rate * Math.PI * 2;
        if (this.breath > Math.PI * 200) this.breath -= Math.PI * 200;
    }

    // ── Posing ──────────────────────────────────────────────────────────────────

    /** The act's own curves: hips offset (m, model axes), spine lean (rad). */
    actPose(dt = 0) {
        const out = {
            dx: 0, dy: 0, dz: 0, lean: 0, sit: 0, crouch: 0,
        };
        const m = this.mode;
        const k = this.act ? this.act.k : 1;
        // Where his hips go on the seat, in the model frame (behind and below standing).
        const seatDrop = this.seatDrop();
        if (m === 'seated') out.sit = 1;
        else if (m === 'sitDown') {
            // Lean forward over the feet, lower back onto the stone, settle upright.
            out.lean = 0.42 * hump(0, 0.75, k) + 0.08 * smoothstep(0.6, 1, k);
            out.sit = smoothstep(0.12, 0.85, k);
        } else if (m === 'standUp') {
            // Lean well forward to bring the weight over the feet, push up, straighten.
            out.lean = 0.55 * hump(0, 0.8, k);
            out.sit = 1 - smoothstep(0.25, 0.85, k);
        } else if (m === 'crouched') out.crouch = 1;
        else if (m === 'crouch') {
            out.crouch = smoothstep(0.05, 0.9, k);
            out.lean = 0.12 * hump(0, 0.6, k);
        } else if (m === 'rise') {
            out.crouch = 1 - smoothstep(0.15, 0.95, k);
            out.lean = 0.2 * hump(0, 0.7, k);
        }
        out.dy = -seatDrop.dy * out.sit - 0.36 * out.crouch;
        out.dz = -seatDrop.dz * out.sit + 0.1 * out.crouch;
        out.lean += 0.06 * out.sit + 0.42 * out.crouch;
        // (Eased a hair, so an act turned back halfway does not jump.)
        const s = this.actS;
        springTo(s.dy, out.dy, 0.06, dt);
        springTo(s.dz, out.dz, 0.06, dt);
        springTo(s.lean, out.lean, 0.06, dt);
        if (!(dt > 0)) {
            s.dy.x = out.dy;
            s.dz.x = out.dz;
            s.lean.x = out.lean;
        }
        out.dy = s.dy.x;
        out.dz = s.dz.x;
        out.lean = s.lean.x;
        this.sitK = out.sit;
        this.crouchK = out.crouch;
        return out;
    }

    /** How far down and back his hips sit on the stone (metres, model axes). */
    seatDrop() {
        if (!this.seat) return { dy: 0.26, dz: 0.38 };
        const standHip = this.root.y + this.hipUp * this.H;
        const seatHip = this.seat[1] + 0.2;
        return { dy: Math.max(0, standHip - seatHip), dz: 0.4 };
    }

    /** Pose every bone from the layers above and the solves. */
    solve(dt, want) {
        const L = this.local;
        Object.values(L).forEach((q) => q.identity());
        const act = this.actPose(dt);
        const { H } = this;
        const breathe = Math.sin(this.breath);
        const deep = 1 + this.exertion * 0.8;

        // ── Hips ──
        this.hipsOffset.set(this.sway.x[0] / H, (this.sway.x[1] + act.dy) / H, act.dz / H);
        this._e.set(this.lean.x * 0.35 + act.lean * 0.25, this.hipsYaw.x, this._roll || 0, 'YXZ');
        L.hips.setFromEuler(this._e);

        // ── Spine and chest: lean, breathe, start, look ──
        const startle = this.startle.x;
        this.updateLook(dt, want);
        const spineLean = this.lean.x * 0.45 + act.lean * 0.45 - startle * 0.1;
        this._e.set(spineLean, this.look.chest.x * 0.4 - this.hipsYaw.x * 0.7, 0, 'YXZ');
        L.spine.setFromEuler(this._e);
        const chestLean = this.lean.x * 0.25 + act.lean * 0.3 - breathe * 0.022 * deep - startle * 0.14;
        this._e.set(chestLean, this.look.chest.x * 0.6, 0, 'YXZ');
        L.chest.setFromEuler(this._e);
        // The head stays level as the body leans (he watches, not the floor).
        const bodyPitch = this.lean.x * 1.05 + act.lean - startle * 0.24;
        const doze = this.doze.x;
        this._e.set(-bodyPitch * 0.35 + this.look.pitch.x * 0.4 + doze * 0.2, this.look.neck.x, 0, 'YXZ');
        L.neck.setFromEuler(this._e);
        this._e.set(
            -bodyPitch * 0.4 + this.look.pitch.x * 0.6 + doze * 0.42 + breathe * 0.012 - startle * 0.2,
            this.look.yaw.x,
            Math.sin(this.time * 0.37) * 0.025 * (1 - doze),
            'YXZ',
        );
        L.head.setFromEuler(this._e);
        // Shoulders rise with the breath.
        const shrug = breathe * 0.025 * deep + startle * 0.12;
        L.clavL.setFromAxisAngle(this._v.set(0, 0, 1), shrug);
        L.clavR.setFromAxisAngle(this._v.set(0, 0, 1), -shrug);

        this.forward();

        // ── Legs onto the feet ──
        ['L', 'R'].forEach((side) => this.solveLeg(side, act));

        // ── The staff, then the left hand on it ──
        this.updateStaff(dt, want, act);
        this.solveArm('L', this.staffGripModel());
        // ── The right hand: swinging, on the knee, or held out ──
        this.solveArm('R', this.rightHand(dt, want, act));
        this.forward();
        this.updateLantern(dt, want);
    }

    /** Forward kinematics of the posed skeleton into `global` / `globalPos` (model frame). */
    forward() {
        if (!this.order.length) this.buildOrder();
        for (let i = 0; i < this.order.length; i++) {
            const name = this.order[i];
            const parent = this.parentOf[name];
            const g = this.global[name];
            const p = this.globalPos[name];
            if (!parent) {
                g.copy(this.local[name]);
                p.copy(this.rest[name]);
                if (name === 'hips') p.add(this.hipsOffset);
            } else {
                g.copy(this.global[parent]).multiply(this.local[name]);
                p.copy(this.rest[name]).sub(this.rest[parent]).applyQuaternion(this.global[parent]).add(this.globalPos[parent]);
            }
        }
    }

    /** Parents and an order in which every parent comes first (from the rest heads' file order). */
    buildOrder(parents = this.parents) {
        const names = Object.keys(this.rest);
        this.parentOf = parents || {};
        const seen = new Set();
        const visit = (n) => {
            if (seen.has(n)) return;
            const p = this.parentOf[n];
            if (p) visit(p);
            seen.add(n);
            this.order.push(n);
        };
        names.forEach(visit);
    }

    /** The two-bone solve of a leg onto its foot (and the foot onto the ground). */
    solveLeg(side, act) {
        const leg = this.legs[side];
        if (!leg) return;
        const [thigh, shin, foot, toe] = leg.names;
        const foot0 = this.feet[side];
        // The ankle over the foot's point, lifted by the heel's roll about the ball of the foot.
        const ankleW = this._v.copy(foot0.pos);
        ankleW.y += this.ankleUp * this.H;
        const roll = foot0.roll || 0;
        if (roll > 0 && leg.toe) {
            const ball = leg.toe.z * this.H;
            ankleW.y += Math.sin(roll) * ball;
        }
        const target = this.toModel(ankleW, this._v2);
        const a = this.globalPos[thigh];
        // Knees go forward with the hips, and a little out (a troll stands wide).
        const pole = this._pole.set(SIDES[side] * 0.35, 0.05, 1).applyQuaternion(this.global.hips);
        if (act.sit > 0) pole.y += act.sit * 0.6;
        solveTwoBone(a, target, leg.l1, leg.l2, pole, this._mid, this._end);
        // (Each rotation in a quaternion of its own: the shin's is taken relative to the thigh's.)
        const parentG = this.global[this.parentOf[thigh]];
        const g1 = rotationBetweenFrames(leg.dir1, this._v3.set(0, 0, 1), this._v.copy(this._mid).sub(a), pole, this._g1);
        this.local[thigh].copy(this._inv.copy(parentG).invert().multiply(g1));
        this.global[thigh].copy(g1);
        const g2 = rotationBetweenFrames(leg.dir2, this._v3.set(0, 0, 1), this._v.copy(this._end).sub(this._mid), pole, this._g2);
        this.local[shin].copy(this._inv.copy(g1).invert().multiply(g2));
        this.global[shin].copy(g2);
        // The foot lies along its own yaw (planted feet keep theirs while the body turns), pitched by its roll.
        this._e.set(roll, wrapAngle(foot0.yaw - this.heading), 0, 'YXZ');
        const gf = this._gf.setFromEuler(this._e);
        this.local[foot].copy(this._inv.copy(g2).invert().multiply(gf));
        this.global[foot].copy(gf);
        if (toe && this.local[toe]) {
            this._e.set(0, wrapAngle(foot0.yaw - this.heading), 0, 'YXZ');
            const gt = this._gt.setFromEuler(this._e);
            this.local[toe].copy(this._inv.copy(gf).invert().multiply(gt));
            this.global[toe].copy(gt);
        }
    }

    /** Two-bone solve of an arm so its wrist is at `target` (model frame). */
    solveArm(side, target) {
        const arm = this.arms[side];
        if (!arm || !target) return;
        const [upper, fore, hand] = arm.names;
        this.forward();
        const a = this.globalPos[upper];
        // Elbows bend back and out.
        const pole = this._pole.set(SIDES[side] * 0.55, -0.25, -1).applyQuaternion(this.global.chest);
        solveTwoBone(a, target, arm.l1, arm.l2, pole, this._mid, this._end);
        const parentG = this.global[this.parentOf[upper]];
        const restPole = this._v3.set(SIDES[side] * 0.55, -0.25, -1);
        const g1 = rotationBetweenFrames(arm.dir1, restPole, this._v.copy(this._mid).sub(a), pole, this._g1);
        this.local[upper].copy(this._inv.copy(parentG).invert().multiply(g1));
        this.global[upper].copy(g1);
        const g2 = rotationBetweenFrames(arm.dir2, restPole, this._v.copy(this._end).sub(this._mid), pole, this._g2);
        this.local[fore].copy(this._inv.copy(g1).invert().multiply(g2));
        this.global[fore].copy(g2);
        if (this.local[hand]) this.local[hand].identity();
    }

    /** The look: yaw and pitch toward what he watches, the head first and the chest last. */
    updateLook(dt, want) {
        let yaw = 0;
        let pitch = 0;
        if (want.look) {
            const eye = this.toWalk(this.rest.head, this._v);
            eye.y += 0.25;
            const dx = want.look[0] - eye.x;
            const dy = want.look[1] - eye.y;
            const dz = want.look[2] - eye.z;
            yaw = wrapAngle(Math.atan2(dx, dz) - this.heading);
            pitch = -Math.atan2(dy, Math.hypot(dx, dz));
        }
        yaw = clamp(yaw, -1.7, 1.7);
        pitch = clamp(pitch, -0.6, 0.5);
        const share = { chest: 0.25, neck: 0.3, head: 0.45 };
        springTo(this.look.yaw, yaw * share.head, 0.11, dt);
        springTo(this.look.neck, yaw * share.neck, 0.2, dt);
        springTo(this.look.chest, yaw * share.chest, 0.42, dt);
        springTo(this.look.pitch, pitch, 0.16, dt);
    }

    // ── The staff and the lantern ───────────────────────────────────────────────

    /** Where the staff stands by his left foot when he stands still (walk frame). */
    staffRestTip(out) {
        const fwd = this._v3.set(Math.sin(this.heading), 0, Math.cos(this.heading));
        const left = this._mid.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
        out.copy(this.root).addScaledVector(left, 0.74).addScaledVector(fwd, 0.26);
        out.y = this.ground(out.x, out.z);
        return out;
    }

    placeStaffAtRest() {
        const tip = this.staffRestTip(new THREE.Vector3());
        this.staff.tip = tip;
        const dir = this._v.set(Math.cos(this.heading) * -0.12, 1, Math.sin(this.heading) * 0.12).normalize();
        this.staff.dir.set(dir.x, dir.y, dir.z);
        const g = tip.clone().addScaledVector(dir, STAFF.grip);
        this.staff.grip.set(g.x, g.y, g.z);
    }

    /**
     * The staff: planted like a walking stick (a third foot that steps with his right foot), or
     * lifted to carry the lantern up ('raise'), out over the water ('offer') or down to it ('dip').
     */
    updateStaff(dt, want, act) {
        const st = this.staff;
        const wantMode = act.crouch > 0.3 ? 'dip' : (want.staff || 'walk');
        const lifted = wantMode !== 'walk' && act.sit < 0.5;
        const fwd = this._v3.set(Math.sin(this.heading), 0, Math.cos(this.heading));
        const left = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
        // (The chest as it is posed this frame: crouched or seated, the staff comes down with it.)
        const chest = this.toWalk(this.globalPos.chest, new THREE.Vector3());
        let grip;
        let dir;
        if (lifted) {
            st.mode = 'held';
            st.tip = null;
            if (wantMode === 'raise') {
                // High at his left, upright, the lantern above his head.
                grip = chest.clone().addScaledVector(left, 0.62).addScaledVector(fwd, 0.25);
                grip.y += 0.85;
                dir = fwd.clone().multiplyScalar(0.18).add(UP).normalize();
            } else if (wantMode === 'high') {
                // Walking home he carries it up, over his shoulder: seen from anywhere, it lights her way.
                grip = chest.clone().addScaledVector(left, 0.58).addScaledVector(fwd, 0.18);
                grip.y += 0.42;
                dir = fwd.clone().multiplyScalar(0.12).addScaledVector(left, 0.12).add(UP)
                    .normalize();
            } else if (wantMode === 'offer') {
                // Held out at chest height, leaning out toward what he watches. (The hand is out past
                // his shoulder: nearer his middle, the arm could only reach it through his belly.)
                grip = chest.clone().addScaledVector(left, 0.6).addScaledVector(fwd, 0.58);
                grip.y -= 0.05;
                dir = fwd.clone().multiplyScalar(0.55).add(this._mid.set(0, 0.95, 0)).normalize();
            } else {
                // Crouched at the water: the staff laid out over it, down to the surface.
                grip = chest.clone().addScaledVector(left, 0.5).addScaledVector(fwd, 0.55);
                grip.y -= 0.2;
                dir = fwd.clone().multiplyScalar(0.96).add(this._mid.set(0, -0.1, 0)).normalize();
            }
            const k = st.wasPlanted ? 0.32 : 0.22;
            st.grip.step(grip.x, grip.y, grip.z, k, dt);
            st.dir.step(dir.x, dir.y, dir.z, k, dt);
            st.wasPlanted = false;
        } else {
            st.mode = 'planted';
            if (!st.tip) {
                // Coming back down: plant it where it would rest.
                st.tip = this.staffRestTip(new THREE.Vector3());
            }
            // A step of the staff when it has fallen behind (with the right foot when walking).
            const restTip = this.staffRestTip(new THREE.Vector3());
            if (act.sit > 0.5 && this.seat) {
                // Seated, its foot stands before his left knee and it leans out from him: the lantern
                // hangs at his side, not before his face.
                restTip.addScaledVector(fwd, 0.2).addScaledVector(left, -0.22);
                restTip.y = this.ground(restTip.x, restTip.z);
            }
            const lag = Math.hypot(restTip.x - st.tip.x, restTip.z - st.tip.z);
            const rightSwing = this.feet.R.swing;
            if (!st.stepping && (lag > 0.32 || (rightSwing && !rightSwing.small && lag > 0.12))) {
                st.stepping = { from: st.tip.clone(), t: 0, time: 0.5 };
            }
            if (st.stepping) {
                const sp = st.stepping;
                sp.t += dt;
                const s = clamp(sp.t / sp.time, 0, 1);
                const e = s * s * (3 - 2 * s);
                st.tip.lerpVectors(sp.from, restTip, e);
                st.tip.y = sp.from.y + (restTip.y - sp.from.y) * e + Math.sin(Math.PI * s) * 0.16;
                if (s >= 1) {
                    st.stepping = null;
                    this.events.push({
                        type: 'staff', x: st.tip.x, y: st.tip.y, z: st.tip.z, strength: 0.5,
                    });
                }
            }
            // The hand is where it is comfortable; the staff leans from its foot up to the hand.
            // (Ahead of the staff's foot: it leans forward, and the lantern hangs out before him.)
            const hand = chest.clone().addScaledVector(left, 0.66).addScaledVector(fwd, 0.5);
            hand.y -= 0.72 * (1 - act.sit * 0.3);
            if (act.sit > 0) hand.addScaledVector(fwd, -act.sit * 0.05).addScaledVector(left, act.sit * 0.16);
            const d = hand.clone().sub(st.tip);
            d.y = Math.max(d.y, 0.3);
            d.normalize();
            const g = st.tip.clone().addScaledVector(d, STAFF.grip);
            const k = st.wasPlanted === false ? 0.25 : 0.06;
            st.grip.step(g.x, g.y, g.z, k, dt);
            st.dir.step(d.x, d.y, d.z, k, dt);
            st.wasPlanted = true;
        }
        const dl = Math.hypot(st.dir.x[0], st.dir.x[1], st.dir.x[2]) || 1;
        st.dirN = new THREE.Vector3(st.dir.x[0] / dl, st.dir.x[1] / dl, st.dir.x[2] / dl);
        st.gripAt = new THREE.Vector3(st.grip.x[0], st.grip.x[1], st.grip.x[2]);
        st.foot = st.gripAt.clone().addScaledVector(st.dirN, -STAFF.grip);
        st.top = st.gripAt.clone().addScaledVector(st.dirN, STAFF.length - STAFF.grip);
        // The crook bends forward off the top; the lantern's bail hangs from its end.
        // (Out to his left and forward: the lantern lights his face from the side, it does not hide it.)
        const way = this._v2.copy(fwd).multiplyScalar(0.9).addScaledVector(left, 0.38);
        const out = this._v.copy(way).addScaledVector(st.dirN, -way.dot(st.dirN));
        if (out.lengthSq() < 1e-6) out.copy(left);
        out.normalize();
        this.hookAt.copy(st.top).addScaledVector(out, STAFF.hook).addScaledVector(st.dirN, -0.1);
    }

    /** The left hand's wrist target (model frame): the grip, less the hand's own length. */
    staffGripModel() {
        const st = this.staff;
        if (!st.gripAt) return null;
        const wrist = st.gripAt.clone().addScaledVector(st.dirN, 0.05);
        wrist.y += 0.06;
        return this.toModel(wrist, new THREE.Vector3());
    }

    /** The right hand (model frame): it swings as he walks, rests on his knee, or is held out. */
    rightHand(dt, want, act) {
        if (!this.rest.handR) return null;
        // Hanging relaxed at his side (the sculpt holds it up and out: we let it down).
        let x = -0.29;
        let y = -0.24;
        let z = 0.1;
        // Swinging against the right leg.
        const swingL = this.feet.L.swing;
        const swingR = this.feet.R.swing;
        const gait = clamp(this.speed / 0.4, 0, 1);
        let swing = 0;
        if (swingL && !swingL.small) swing = Math.sin(Math.PI * clamp(swingL.t / swingL.time, 0, 1));
        if (swingR && !swingR.small) swing = -Math.sin(Math.PI * clamp(swingR.t / swingR.time, 0, 1));
        z += swing * 0.07 * gait;
        y += Math.abs(swing) * 0.015 * gait;
        // Seated: on his right knee.
        if (act.sit > 0) {
            x += (-0.2 - x) * act.sit;
            y += (-0.2 - y) * act.sit;
            z += (0.18 - z) * act.sit;
        }
        // Held out, palm up, toward what he watches.
        const reach = clamp(want.reach || 0, 0, 1) * (1 - act.sit);
        if (reach > 0 && want.look) {
            const to = this.toModel(this._v.set(want.look[0], want.look[1], want.look[2]), this._v2);
            const from = this.rest.upperR;
            const d = to.sub(from).normalize();
            const out = from.clone().addScaledVector(d, (this.arms.R.l1 + this.arms.R.l2) * 0.9);
            out.y = Math.min(out.y, from.y + 0.05);
            x += (out.x - x) * reach;
            y += (out.y - y) * reach;
            z += (out.z - z) * reach;
        }
        this.armR.step(x, y, z, 0.16, dt);
        // (Model units: the hand rides down with the hips when he sits or crouches.)
        return new THREE.Vector3(this.armR.x[0], this.armR.x[1] + this.hipsOffset.y * 0.6, this.armR.x[2]);
    }

    /** The lantern swings from the hook as the staff moves (and in the wind). */
    updateLantern(dt, want) {
        const p = [this.hookAt.x, this.hookAt.y, this.hookAt.z];
        const off = this.lantern.step(p, dt, [0, 0, 0], want.wind ? [want.wind * 0.6, want.wind * 0.2] : null);
        this.lanternAt.set(p[0] + off[0], p[1] + off[1], p[2] + off[2]);
    }

    /** Write the pose into THREE bones (by name). */
    applyTo(bones) {
        Object.keys(this.local).forEach((name) => {
            const bone = bones[name];
            if (!bone) return;
            bone.quaternion.copy(this.local[name]);
            if (name === 'hips') {
                bone.position.copy(this.rest.hips).add(this.hipsOffset);
            }
        });
    }
}

/** The parent of each bone from a figure file's bone list. */
export function parentsFromSpec(spec) {
    const out = {};
    (spec.bones || []).forEach((b) => {
        out[b.name] = b.parent >= 0 ? spec.bones[b.parent].name : null;
    });
    return out;
}

/** Each bone's head (model frame) from a figure file's bone list. */
export function restFromSpec(spec) {
    const out = {};
    (spec.bones || []).forEach((b) => {
        out[b.name] = new THREE.Vector3(b.head[0], b.head[1], b.head[2]);
    });
    return out;
}
