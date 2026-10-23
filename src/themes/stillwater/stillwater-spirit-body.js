/**
 * Stillwater — the spirit's body: how she stands, drifts, kneels on the water and uses her hands.
 *
 * She does not walk: she drifts. Her body is carried along her path out over the water by a slow
 * spring, leaning a little into the way she goes, and everything that hangs from her answers it:
 * the gown's four panels (skirt bones) trail after her, spread on the water when she kneels and
 * stir in the air; her hair always hangs with the weight of hair whatever her head does, and
 * streams behind her when she moves. Her hands are placed by a two-bone solve for what she does
 * with them: folded before her, cupped for light coming home, held out to the troll, opened wide
 * for the heart, crossed on her breast when she has it, or trailing in the water as she kneels.
 * Under it all she stands in a soft S (her weight on one hip, moving to the other now and then),
 * breathes, and looks: the head first, the chest after, a turn gathering speed and settling and
 * never faster than a calm head turns. Over all of it she may be making a gesture (a wave, a
 * curtsy, a twirl on the water: stillwater-gestures.js), in and out on its own envelope.
 *
 * Where she drifts to is approached at her own pace: the place she makes for moves toward where she
 * is asked to be no faster than that, and she follows it on a spring, so a long way is a glide.
 *
 * Frames as for the troll (stillwater-troll-body.js): the walk frame in true metres; the model is
 * one unit tall (her hem at 0, crown at 1), y up, facing +z, x her left, scaled by SPIRIT.height.
 */

import * as THREE from 'three/webgpu';
import {
    Spring3, clamp, follower, followTo, smoothstep, solveTwoBone, spring, springAngle, springTo, rotationBetweenFrames,
    wrapAngle,
} from './stillwater-motion.js';
import {
    GestureSlots, SPIRIT_GESTURES, emptyPose, slotWeight,
} from './stillwater-gestures.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Seconds kneeling down and rising take. */
export const SPIRIT_ACT = Object.freeze({ kneel: 2.2, rise: 1.8 });

/** Metres a second she drifts at most, unless asked to go slower. */
export const SPIRIT_PACE = 0.6;

/** How her look moves (as the troll's, TROLL_LOOK, a little lighter). */
export const SPIRIT_LOOK = Object.freeze({
    head: Object.freeze({ share: 0.45, halfLife: 0.2, speed: 1.4 }),
    neck: Object.freeze({ share: 0.3, halfLife: 0.3, speed: 1.0 }),
    chest: Object.freeze({ share: 0.25, halfLife: 0.5, speed: 0.65 }),
    pitch: Object.freeze({ halfLife: 0.26, speed: 1.3 }),
});

const hump = (a, b, v) => smoothstep(a, a + (b - a) / 3, v) * (1 - smoothstep(b - (b - a) / 3, b, v));

export class SpiritBody {
    /**
     * @param {Record<string, THREE.Vector3>} rest
     * @param {object} opts
     * @param {number} opts.height   metres per model unit
     * @param {Record<string, string|null>} opts.parents
     * @param {Record<string, THREE.Vector3>} [opts.tails]
     */
    constructor(rest, {
        height = 1.72, parents = {}, tails = {}, sole = 0,
    } = {}) {
        this.rest = rest;
        this.tails = tails;
        this.H = height;
        /** Her hem's height in the model frame (the root stands there). */
        this.sole = sole;
        this.parentOf = parents;
        this.local = {};
        this.global = {};
        this.globalPos = {};
        Object.keys(rest).forEach((name) => {
            this.local[name] = new THREE.Quaternion();
            this.global[name] = new THREE.Quaternion();
            this.globalPos[name] = new THREE.Vector3();
        });
        this.order = [];
        const seen = new Set();
        const visit = (n) => {
            if (seen.has(n)) return;
            if (parents[n]) visit(parents[n]);
            seen.add(n);
            this.order.push(n);
        };
        Object.keys(rest).forEach(visit);
        this.arms = {
            L: this.limb('upperL', 'foreL', 'handL'),
            R: this.limb('upperR', 'foreR', 'handR'),
        };
        this.hipsOffset = new THREE.Vector3();
        this.root = new THREE.Vector3();
        this._q = new THREE.Quaternion();
        this._q2 = new THREE.Quaternion();
        this._v = new THREE.Vector3();
        this._v2 = new THREE.Vector3();
        this._v3 = new THREE.Vector3();
        this._mid = new THREE.Vector3();
        this._end = new THREE.Vector3();
        this._pole = new THREE.Vector3();
        this._e = new THREE.Euler();
        this.events = [];
        this.reset(0, 0, 0, 0);
    }

    limb(a, b, c) {
        const r = this.rest;
        if (!r[a] || !r[b] || !r[c]) return null;
        return {
            names: [a, b, c],
            l1: r[b].distanceTo(r[a]),
            l2: r[c].distanceTo(r[b]),
            dir1: r[b].clone().sub(r[a]).normalize(),
            dir2: r[c].clone().sub(r[b]).normalize(),
        };
    }

    reset(x, y, z, heading) {
        this.root.set(x, y, z);
        this.pos = new Spring3(x, y, z);
        /** The place she makes for, moving toward where she is asked at her pace. */
        this.carrot = [x, y, z];
        if (!this.gestures) this.gestures = new GestureSlots();
        this.gestures.reset();
        /** Her turn about herself in a twirl (radians). */
        this.spin = 0;
        this.spinRate = 0;
        this.heading = heading;
        this.headingS = spring(heading);
        this.velocity = new THREE.Vector3();
        this.kneelK = 0;
        this.kneelS = spring(0);
        this.mode = 'standing';
        this.act = null;
        this.look = {
            yaw: follower(), pitch: follower(), neck: follower(), chest: follower(),
        };
        this.lean = spring();
        this.hipShift = spring();
        this.breath = 0;
        this.hands = { L: new Spring3(0.03, 0.6, 0.07), R: new Spring3(-0.03, 0.6, 0.07) };
        this.skirt = new Spring3();
        this.hair = new Spring3();
        this.hair2 = new Spring3();
        this.glow = spring();
        this.time = 0;
        this.lastTouch = -10;
        Object.values(this.local).forEach((q) => q.identity());
        this.hipsOffset.set(0, 0, 0);
    }

    toWalk(p, out = new THREE.Vector3()) {
        out.set(p.x, p.y - this.sole, p.z).multiplyScalar(this.H).applyAxisAngle(UP, this.heading);
        return out.add(this.root);
    }

    toModel(w, out = new THREE.Vector3()) {
        out.copy(w).sub(this.root).applyAxisAngle(UP, -this.heading).divideScalar(this.H);
        out.y += this.sole;
        return out;
    }

    /**
     * @param {number} dt
     * @param {object} want
     * @param {number[]} want.at       [x, y, z] walk frame: where she should be
     * @param {number} want.face       heading to turn to
     * @param {boolean} want.kneel     kneel there (on the water)
     * @param {string} want.hands      'rest' | 'receive' | 'reach' | 'open' | 'heart' | 'touch'
     * @param {number[]|null} want.look [x, y, z]: what she watches
     * @param {boolean} want.gazeDown  looking down into the water before her
     * @param {number} want.wind       how hard the air moves
     * @param {number} time
     */
    update(dt, want, time) {
        this.time = time;
        this.events.length = 0;
        const h = Math.min(Math.max(0, dt), 0.1);
        this.updateActs(h, want);
        this.updateDrift(h, want);
        this.solve(h, want);
        return this;
    }

    updateActs(dt, want) {
        if (this.act) {
            this.act.t += dt;
            this.act.k = clamp(this.act.t / this.act.time, 0, 1);
            if (this.act.k >= 1) {
                this.mode = this.act.name === 'kneel' ? 'kneeling' : 'standing';
                this.act = null;
            }
        }
        const there = Math.hypot(want.at[0] - this.root.x, want.at[2] - this.root.z) < 0.12;
        if (this.act) {
            // Called while she is going down to the water, she rises from where she has got to.
            if (this.act.name === 'kneel' && (!want.kneel || !there)) this.begin('rise', 1 - this.act.k);
            return;
        }
        if (this.mode === 'standing' && want.kneel && there && this.velocity.length() < 0.05) this.begin('kneel');
        else if (this.mode === 'kneeling' && (!want.kneel || !there)) this.begin('rise');
    }

    begin(name, from = 0) {
        const time = SPIRIT_ACT[name];
        this.act = {
            name, t: from * time, k: from, time,
        };
        this.mode = name;
    }

    /** She drifts: a slow spring along to where she should be, never while kneeling. */
    updateDrift(dt, want) {
        const held = this.mode !== 'standing';
        const c = this.carrot;
        if (held) {
            c[0] = this.pos.x[0];
            c[1] = this.pos.x[1];
            c[2] = this.pos.x[2];
        } else if (dt > 0) {
            // The place she makes for moves on at her pace, slowing as it comes to where she is asked.
            const dx = want.at[0] - c[0];
            const dy = want.at[1] - c[1];
            const dz = want.at[2] - c[2];
            const d = Math.hypot(dx, dy, dz);
            const pace = Math.min(SPIRIT_PACE, want.pace || SPIRIT_PACE) * clamp(d / 0.7, 0.3, 1);
            const step = Math.min(d, pace * dt);
            if (d > 1e-6) {
                c[0] += (dx / d) * step;
                c[1] += (dy / d) * step;
                c[2] += (dz / d) * step;
            }
        }
        const px = this.pos.x[0];
        const pz = this.pos.x[2];
        this.pos.step(c[0], c[1], c[2], 0.45, dt);
        if (dt > 0) {
            this.velocity.set((this.pos.x[0] - px) / dt, 0, (this.pos.x[2] - pz) / dt);
        }
        // A spirit floats: the faintest rise and fall once she is off her stone.
        // (By where she is, not where she is going: off her stone, low over the water, she floats.)
        const off = smoothstep(0.26, 0.1, this.pos.x[1]);
        const float = Math.sin(this.time * 1.7) * 0.012 * off;
        this.root.set(this.pos.x[0], this.pos.x[1] + float, this.pos.x[2]);
        springAngle(this.headingS, want.face, 0.9, dt);
        this.heading = wrapAngle(this.headingS.x + this.spin);
        this.breath += (dt * Math.PI * 2) / 5.2;
        if (this.breath > Math.PI * 200) this.breath -= Math.PI * 200;
    }

    forward() {
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

    /** Set a bone's local rotation so its global one is `g`. */
    setGlobal(name, g) {
        const parent = this.parentOf[name];
        if (parent) this.local[name].copy(this._q2.copy(this.global[parent]).invert().multiply(g));
        else this.local[name].copy(g);
        this.global[name].copy(g);
    }

    /**
     * What the gestures under way do to her this frame, each by how much of it shows. A twirl's turn
     * is not faded: while it runs it turns her, and if it is cut short what it had turned is kept
     * (her heading takes it), so she never swings back.
     */
    gesturePose(dt, want) {
        const slots = this.gestures.step(want.gesture || null, this.time, dt);
        const acc = emptyPose(this._gp || (this._gp = {}));
        acc.hands = acc.hands || { L: [], R: [] };
        acc.hands.L.length = 0;
        acc.hands.R.length = 0;
        acc.marked = false;
        const one = this._gpOne || (this._gpOne = {});
        let spin = 0;
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            const fn = SPIRIT_GESTURES[s.name];
            if (fn) {
                const t = this.time - s.start;
                const k = clamp(t / Math.max(1e-3, s.length), 0, 1);
                const p = emptyPose(one);
                fn(k, t, s.length, p);
                if (s.live) {
                    spin += p.spin;
                    s.spinNow = p.spin;
                } else if (s.spinNow && !s.spinKept) {
                    s.spinKept = true;
                    this.headingS.x = wrapAngle(this.headingS.x + s.spinNow);
                }
                const w = slotWeight(s);
                if (w > 0) {
                    for (let j = 0; j < 3; j++) {
                        acc.spine[j] += p.spine[j] * w;
                        acc.chest[j] += p.chest[j] * w;
                        acc.neck[j] += p.neck[j] * w;
                        acc.head[j] += p.head[j] * w;
                        acc.hips[j] += p.hips[j] * w;
                    }
                    acc.clav += p.clav * w;
                    acc.flare += p.flare * w;
                    acc.look *= 1 - (1 - p.look) * w;
                    if (p.L && p.L.w > 0) {
                        p.L.w *= w;
                        acc.hands.L.push(p.L);
                    }
                    if (p.R && p.R.w > 0) {
                        p.R.w *= w;
                        acc.hands.R.push(p.R);
                    }
                    if (p.marks && s.live) {
                        for (let m = 0; m < p.marks.length; m++) {
                            const bit = 1 << m;
                            if (k >= p.marks[m] && !(s.fired & bit)) {
                                s.fired |= bit;
                                acc.marked = true;
                            }
                        }
                    }
                }
            }
        }
        // (A whole turn is no turn: the twirl's last frame and the next agree.)
        const was = this.spin;
        this.spin = Math.abs(spin - Math.PI * 2) < 1e-9 ? 0 : spin;
        if (dt > 0) this.spinRate = wrapAngle(this.spin - was) / dt;
        this.heading = wrapAngle(this.headingS.x + this.spin);
        return acc;
    }

    /** A point given relative to one of her posed bones (or to the water before her), in the model frame. */
    boneRelative(spec, out) {
        const { bone, p } = spec;
        if (bone === 'model') return out.set(p[0], p[1], p[2]);
        if (bone === 'water') {
            const water = this.toModel(this._v3.set(this.root.x, 0, this.root.z), out).y;
            return out.set(p[0], Math.max(water + p[1], this.globalPos.chest.y - 0.38), p[2]);
        }
        const g = this.global[bone];
        const at = this.globalPos[bone];
        if (!g || !at) return out.set(p[0], p[1], p[2]);
        return out.set(p[0], p[1], p[2]).applyQuaternion(g).add(at);
    }

    solve(dt, want) {
        const L = this.local;
        Object.values(L).forEach((q) => q.identity());
        const gp = this.gesturePose(dt, want);
        // ── The act: kneeling down onto the water, rising ──
        let kneel = 0;
        let actLean = 0;
        if (this.mode === 'kneeling') kneel = 1;
        else if (this.mode === 'kneel') {
            const { k } = this.act;
            kneel = smoothstep(0.1, 0.9, k);
            actLean = 0.18 * hump(0, 0.7, k);
        } else if (this.mode === 'rise') {
            const { k } = this.act;
            kneel = 1 - smoothstep(0.15, 0.9, k);
            actLean = 0.12 * hump(0, 0.6, k);
        }
        // (Eased a hair, so a kneel turned back halfway does not jump.)
        springTo(this.kneelS, kneel, 0.06, dt);
        if (!(dt > 0)) this.kneelS.x = kneel;
        kneel = this.kneelS.x;
        this.kneelK = kneel;
        // Velocity in her own frame: she leans into it, everything that hangs trails it.
        const vm = this._v.copy(this.velocity).applyAxisAngle(UP, -this.heading);
        const speed = this.velocity.length();
        springTo(this.lean, clamp(vm.z * 0.25, -0.12, 0.16), 0.5, dt);
        // ── Hips: the S of her stance, lowered when she kneels ──
        const side = Math.sin(Math.floor(this.time / 8.5) * 2.3) > 0 ? 1 : -1;
        springTo(this.hipShift, side * (1 - kneel), 1.2, dt);
        const shift = this.hipShift.x;
        this.hipsOffset.set(shift * 0.012 + gp.hips[0], -0.26 * kneel + gp.hips[1], 0.02 * kneel + gp.hips[2]);
        this._e.set(this.lean.x * 0.3 + kneel * 0.1, 0, -shift * 0.045, 'YXZ');
        L.hips.setFromEuler(this._e);
        // ── Spine, chest: lean, breath, look; bowed over the water when she kneels ──
        this.updateLook(dt, want, kneel, gp.look);
        const breathe = Math.sin(this.breath);
        this._e.set(
            this.lean.x * 0.4 + kneel * 0.3 + actLean + gp.spine[0],
            this.look.chest.x * 0.4 + gp.spine[1],
            shift * 0.04 + gp.spine[2],
            'YXZ',
        );
        L.spine.setFromEuler(this._e);
        this._e.set(
            this.lean.x * 0.2 + kneel * 0.25 - breathe * 0.018 + gp.chest[0],
            this.look.chest.x * 0.6 + gp.chest[1],
            shift * 0.03 + gp.chest[2],
            'YXZ',
        );
        L.chest.setFromEuler(this._e);
        const bodyPitch = this.lean.x * 0.9 + kneel * 0.55;
        this._e.set(
            -bodyPitch * 0.3 + this.look.pitch.x * 0.35 + gp.neck[0],
            this.look.neck.x + gp.neck[1],
            gp.neck[2],
            'YXZ',
        );
        L.neck.setFromEuler(this._e);
        this._e.set(
            -bodyPitch * 0.25 + this.look.pitch.x * 0.65 + gp.head[0],
            this.look.yaw.x + gp.head[1],
            -shift * 0.06 + gp.head[2],
            'YXZ',
        );
        L.head.setFromEuler(this._e);
        const shrug = breathe * 0.015 + gp.clav;
        L.clavL.setFromAxisAngle(this._v2.set(0, 0, 1), shrug);
        L.clavR.setFromAxisAngle(this._v2.set(0, 0, 1), -shrug);
        this.forward();
        // ── Her hands ──
        this.solveHands(dt, want, kneel, gp);
        this.forward();
        // ── What hangs: the gown's panels and her hair ──
        this.solveHanging(dt, want, vm, speed, kneel, gp);
        this.forward();
        // A fingertip set down on the water by a gesture.
        if (gp.marked) {
            const tip = this.toWalk(this.globalPos.handR, new THREE.Vector3());
            this.events.push({
                type: 'touch', x: tip.x, y: 0, z: tip.z, strength: 0.8,
            });
        }
    }

    updateLook(dt, want, kneel, keep = 1) {
        let yaw = 0;
        let pitch = 0;
        if (want.look) {
            const eye = this.toWalk(this.rest.head, this._v2);
            eye.y += 0.12;
            const dx = want.look[0] - eye.x;
            const dy = want.look[1] - eye.y;
            const dz = want.look[2] - eye.z;
            yaw = wrapAngle(Math.atan2(dx, dz) - this.heading);
            pitch = -Math.atan2(dy, Math.hypot(dx, dz));
        } else if (want.gazeDown || kneel > 0.5) {
            // Down into the water before her.
            pitch = 0.55;
            yaw = Math.sin(this.time * 0.13) * 0.25;
        }
        yaw = clamp(yaw, -1.5, 1.5) * keep;
        pitch = clamp(pitch, -0.55, 0.75) * keep;
        const S = SPIRIT_LOOK;
        followTo(this.look.yaw, yaw * S.head.share, S.head.halfLife, dt, S.head.speed);
        followTo(this.look.neck, yaw * S.neck.share, S.neck.halfLife, dt, S.neck.speed);
        followTo(this.look.chest, yaw * S.chest.share, S.chest.halfLife, dt, S.chest.speed);
        followTo(this.look.pitch, pitch, S.pitch.halfLife, dt, S.pitch.speed);
    }

    /** The hands' wrist targets (model frame) for what she does with them, eased; then the arms are solved. */
    solveHands(dt, want, kneel, gp = null) {
        const { chest } = this.globalPos;
        // (Kneeling she trails her fingers in the water, unless her hands have something to do.)
        const mode = kneel > 0.5 && (!want.hands || want.hands === 'rest') ? 'touch' : (want.hands || 'rest');
        const t = this.time;
        const targets = { L: this._v.set(0, 0, 0), R: this._v2.set(0, 0, 0) };
        const set = (s, x, y, z) => targets[s].set(x, y, z);
        if (mode === 'receive') {
            set('L', 0.045, chest.y - 0.07, chest.z + 0.17);
            set('R', -0.045, chest.y - 0.07, chest.z + 0.17);
        } else if (mode === 'open') {
            set('L', 0.29, chest.y + 0.06, chest.z + 0.09);
            set('R', -0.29, chest.y + 0.06, chest.z + 0.09);
        } else if (mode === 'heart') {
            set('L', -0.025, chest.y - 0.005, chest.z + 0.075);
            set('R', 0.03, chest.y - 0.03, chest.z + 0.08);
        } else if (mode === 'reach' && want.look) {
            // Her right hand held out toward him, the left at her breast.
            const to = this.toModel(this._v3.set(want.look[0], want.look[1], want.look[2]), new THREE.Vector3());
            const sh = this.globalPos.upperR;
            const d = to.sub(sh).normalize();
            const reach = (this.arms.R.l1 + this.arms.R.l2) * 0.92;
            set('R', sh.x + d.x * reach, Math.min(sh.y + d.y * reach, sh.y - 0.02), sh.z + d.z * reach);
            set('L', 0.01, chest.y - 0.02, chest.z + 0.08);
        } else if (mode === 'touch') {
            // Kneeling: her right hand trails in the water before her, the left in her lap.
            const sweep = Math.sin(t * 0.45) * 0.05;
            const water = this.toModel(this._v3.set(0, 0.0, 0), new THREE.Vector3()).y;
            set('R', -0.05 + sweep, Math.max(water + 0.02, chest.y - 0.36), chest.z + 0.28);
            set('L', 0.04, chest.y - 0.22, chest.z + 0.12);
        } else {
            // At rest: hands folded loosely before her.
            set('L', 0.028, 0.6 + Math.sin(t * 0.21) * 0.004, 0.075);
            set('R', -0.028, 0.6, 0.07);
        }
        const k = mode === 'rest' ? 0.42 : 0.3;
        const point = this._gpPoint || (this._gpPoint = new THREE.Vector3());
        const poles = this._gpPoles || (this._gpPoles = { L: new THREE.Vector3(), R: new THREE.Vector3() });
        ['L', 'R'].forEach((s) => {
            const tg = targets[s];
            // A gesture's hand, over what she was doing with it by its weight.
            const sx = s === 'L' ? 1 : -1;
            const pole = poles[s].set(sx * 0.7, -0.15, -0.6);
            let busy = 0;
            const list = gp ? gp.hands[s] : [];
            for (let i = 0; i < list.length; i++) {
                const h = list[i];
                const w = clamp(h.w, 0, 1);
                this.boneRelative(h, point);
                tg.lerp(point, w);
                if (h.pole) pole.lerp(this._v3.set(h.pole[0], h.pole[1], h.pole[2]), w);
                busy = Math.max(busy, w);
            }
            this.hands[s].step(tg.x, tg.y, tg.z, k - 0.18 * busy, dt);
            const [hx, hy, hz] = this.hands[s].x;
            this.solveArm(s, this._v3.set(hx, hy, hz), busy > 0 ? pole : null);
        });
        // A fingertip in the water: a ring now and then.
        if (mode === 'touch' && kneel > 0.95 && t - this.lastTouch > 3.2) {
            this.lastTouch = t;
            this.forward();
            const p = this.toWalk(this.globalPos.handR, new THREE.Vector3());
            this.events.push({
                type: 'touch', x: p.x, y: 0, z: p.z, strength: 0.6,
            });
        }
    }

    solveArm(side, target, poleIn = null) {
        const arm = this.arms[side];
        if (!arm) return;
        const [upper, fore, hand] = arm.names;
        this.forward();
        const a = this.globalPos[upper];
        const sx = side === 'L' ? 1 : -1;
        // Elbows out and back, softly (or where a gesture bends them).
        const pole = this._pole.set(sx * 0.7, -0.15, -0.6);
        if (poleIn) pole.copy(poleIn);
        pole.applyQuaternion(this.global.chest);
        solveTwoBone(a, target, arm.l1, arm.l2, pole, this._mid, this._end);
        const restPole = new THREE.Vector3(sx * 0.7, -0.15, -0.6);
        const g1 = rotationBetweenFrames(arm.dir1, restPole, new THREE.Vector3().copy(this._mid).sub(a), pole, new THREE.Quaternion());
        this.setGlobal(upper, g1);
        const g2 = rotationBetweenFrames(arm.dir2, restPole, new THREE.Vector3().copy(this._end).sub(this._mid), pole, new THREE.Quaternion());
        this.setGlobal(fore, g2);
        // The hand follows the forearm, turned palm-up a little when cupping or reaching.
        this.local[hand].identity();
    }

    /** The gown's panels and her hair: they hang, trail her motion and stir in the air. */
    solveHanging(dt, want, vm, speed, kneel, gp = null) {
        const wind = want.wind || 0.25;
        const t = this.time;
        // Trailing: opposite to her motion (her own frame), eased so it swings and settles.
        const tx = clamp(-vm.x * 0.5, -0.5, 0.5);
        const tz = clamp(-vm.z * 0.55, -0.6, 0.6);
        const stir = 0.04 + wind * 0.08;
        this.skirt.step(
            tx + Math.sin(t * 0.9) * stir * 0.5,
            0,
            tz + Math.sin(t * 0.7 + 1.3) * stir,
            0.35,
            dt,
        );
        // The panels: pitched/rolled by the trail, spread on the water by the kneel.
        // (Kneeling it lies spread on the water; a twirl or a curtsy flares it.)
        const spread = kneel * 0.95 + (gp ? gp.flare : 0);
        const sk = this.skirt.x;
        const panel = (name, axis, angle) => {
            if (!this.local[name]) return;
            this.local[name].setFromAxisAngle(axis, angle);
        };
        // Front panel: forward when kneeling (her knees), back with the trail.
        panel('skirtF', this._v3.set(1, 0, 0), -sk[2] * 0.8 - spread * 0.9);
        panel('skirtB', this._v3.set(1, 0, 0), -sk[2] * 1.1 + spread * 0.75);
        panel('skirtL', this._v3.set(0, 0, 1), sk[0] * 0.8 + spread * 0.75);
        panel('skirtR', this._v3.set(0, 0, 1), sk[0] * 0.8 - spread * 0.75);
        // Hair: two links that hang straight down (whatever the head does) and stream behind her.
        this.forward();
        const swayX = Math.sin(t * 0.8 + 0.4) * 0.03 * (0.5 + wind);
        const swayZ = Math.sin(t * 0.63) * 0.025 * (0.5 + wind);
        // (A twirl swings it out behind her and against the turn.)
        const whirl = clamp(this.spinRate / 4, -1, 1);
        this.hair.step(
            clamp(-vm.x * 0.35 - whirl * 0.35, -0.5, 0.5) + swayX,
            0,
            clamp(-vm.z * 0.5 - Math.abs(whirl) * 0.3, -0.6, 0.6) + swayZ - kneel * 0.05,
            0.3,
            dt,
        );
        this.hair2.step(this.hair.x[0] * 1.3, 0, this.hair.x[2] * 1.4, 0.45, dt);
        this.hangBone('hair1', this.hair.x, kneel);
        this.forward();
        this.hangBone('hair2', this.hair2.x, kneel);
    }

    /** Turn a hanging bone so it points down (plus a drift), whatever its parent did. */
    hangBone(name, drift, kneel) {
        if (!this.local[name] || !this.tails[name]) return;
        const restDir = this._v.copy(this.tails[name]).sub(this.rest[name]).normalize();
        // Down in HER frame (the model frame is upright), drifting with the trail; it rests on her back.
        const want = this._v2.set(restDir.x + drift[0], restDir.y, restDir.z + drift[2] - kneel * 0.1).normalize();
        const g = new THREE.Quaternion().setFromUnitVectors(restDir, want);
        this.setGlobal(name, g);
    }

    applyTo(bones) {
        Object.keys(this.local).forEach((name) => {
            const bone = bones[name];
            if (!bone) return;
            bone.quaternion.copy(this.local[name]);
            if (name === 'hips') bone.position.copy(this.rest.hips).add(this.hipsOffset);
        });
    }

    /** Her heart (walk frame): where the light she takes goes. */
    heartWalk(out = new THREE.Vector3()) {
        this.forward();
        const c = this.globalPos.chest;
        return this.toWalk(this._v.set(c.x, c.y + 0.03, c.z + 0.04), out);
    }

    /** Her hands' midpoint (walk frame). */
    handsWalk(out = new THREE.Vector3()) {
        const a = this.globalPos.handL;
        const b = this.globalPos.handR;
        return this.toWalk(this._v.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), out);
    }
}
