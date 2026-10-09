/**
 * What a fox does. Three-free and renderer-free: its body (fox-rig.js, beside this file) solves
 * the pose this resolves and a theme's model draws it, so a fox behaves the same with or
 * without either. Shared by the themes that keep a fox; each brings its own rig, its own course
 * over its own ground and its own paces.
 *
 * At rest it trots its course and stops now and then: it brakes to a halt, steps round to face
 * the viewer, and then looks about, sits down to watch the sky, stretches, bows — or hears
 * something under the snow or the grass, listens with a paw raised, leaps on it nose first, digs
 * it out and shakes itself off. Given power it runs, faster the more of it, its trot opening
 * into a gallop; startled it dashes; told to, it pounces; put to sleep it curls up where it is.
 *
 * What it does is one thing; how its body carries it is laid over that here as plain numbers
 * the rig adds to whatever act plays: how far its gait has run (the rig plants its paws from
 * that), its lean into a turn, its nod on the brakes, where its head is turned (into the turn,
 * or toward whatever it was told to attend to), a tail that follows on a spring, its breath,
 * its blink. Stepped by its world's clock: the same steps give the same fox, so a seek replays it.
 */

import { POUNCE_AIR, SLEEP_HOLD } from './fox-rig.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** Hermite step between two edges (either order). */
const smooth = (lo, hi, v) => {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach: fraction of the gap closed in `dt`. */
const approach = (rate, dt) => 1 - Math.exp(-rate * dt);
const wrap = (a) => {
    let v = a % TAU;
    if (v > Math.PI) v -= TAU;
    if (v < -Math.PI) v += TAU;
    return v;
};
/** mulberry32: a tiny seeded [0, 1) generator. */
function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The hunt of a fox: it listens, leaps, digs and shakes itself off. */
export const MOUSING = Object.freeze(['Listen', 'Pounce', 'Dig', 'Shake']);

/** What a fox may do when it stops, unless its theme says otherwise: each a short run of acts. */
export const FOX_STOPS = Object.freeze([
    Object.freeze(['LookAround']), MOUSING, Object.freeze(['Sit']), Object.freeze(['Listen', 'LookAround']),
    Object.freeze(['Stretch', 'LookAround']), MOUSING, Object.freeze(['Dig', 'Shake']), Object.freeze(['Greet']),
    Object.freeze(['Sit']),
]);

/**
 * How much of a turn of the head each act leaves room for (the others move the head themselves,
 * and a second hand on it would fight them).
 */
const HEAD_FREE = Object.freeze({
    Run: 1, Listen: 0.25, LookAround: 0.3, Greet: 0.5, Sit: 0.6,
});

/** How much of its stride a speed takes (0 standing .. 1): it shortens its steps to a halt. */
export const foxGaitAmp = (speed) => clamp01(speed / 0.3);

/** Seconds a change of act takes to cross-fade; lying down, sitting and getting up take longer. */
export const FOX_BLEND = 0.26;
const BLEND_SLOW = Object.freeze({ CurlSleep: 0.85, Sit: 0.45, Dig: 0.36 });
/** Scrapes a second it throws out while it digs, and until when in the act (s). */
const DIG_SCRAPES = 4.5;
const DIG_UNTIL = 1.5;
/** The furthest it turns from its path to face what it stops for (radians). */
const FACE_MOST = 1.05;
/** Cycles of its gait it steps for every radian it turns on the spot. */
const STEPS_A_TURN = 0.6;
/** It blinks once in every stretch of this many seconds. */
const BLINK_EVERY = 3.4;
/** The tail's spring: stiffness and damping (it lags a turn and overshoots a little). */
const TAIL_SPRING = 55;
const TAIL_DAMP = 7.5;

/**
 * A course over the ground from points sampled evenly along a closed line.
 * @param {object} o
 * @param {ArrayLike<number>} o.points  count × (x, z, heading)
 * @param {number} o.count
 * @param {number} o.length    metres round
 * @param {number[]} o.stations  metres along it where a fox likes to stop
 * @param {(x: number, z: number) => number} o.height  the ground's
 * @param {number[]} [o.viewer]  where the viewer stands (x, z)
 */
export function foxCourse({
    points, count, length, stations, height, viewer = [0, 0],
}) {
    return {
        length,
        stations,
        height,
        viewer,
        /** Its place `distance` metres along: (x, z, heading). */
        at(distance, out = [0, 0, 0]) {
            const f = ((((distance % length) + length) % length) / length) * count;
            const i = Math.floor(f) % count;
            const k = (i + 1) % count;
            const t = f - Math.floor(f);
            out[0] = points[i * 3] + (points[k * 3] - points[i * 3]) * t;
            out[1] = points[i * 3 + 1] + (points[k * 3 + 1] - points[i * 3 + 1]) * t;
            // (Headings wrap: take the short way round.)
            let dh = points[k * 3 + 2] - points[i * 3 + 2];
            if (dh > Math.PI) dh -= TAU;
            if (dh < -Math.PI) dh += TAU;
            out[2] = points[i * 3 + 2] + dh * t;
            return out;
        },
    };
}

export class FoxMind {
    /**
     * @param {object} o
     * @param {object} o.rig     the fox's body: createFoxRig(...) (fox-rig.js)
     * @param {object} o.course  where it goes: foxCourse(...)
     * @param {number} [o.seed]
     * @param {number} [o.start]  metres along its course it starts at (its first station when not given)
     * @param {number} [o.firstStop=5]  seconds before it first stops
     * @param {Array} [o.stops]   what it may do when it stops (FOX_STOPS)
     * @param {object} [o.paces]  trot and run(power, surge) (m/s); dash, pounce, mouse (m/s added
     *     or flown); leapHigh, leapLow (m); fall (m/s); brake (m/s²) and brakeFrom (m);
     *     printStep and printSide (m; 0 leaves no prints); eye (m above the ground its eyes are);
     *     room (m of its course it leaves whatever is `ahead` of it)
     */
    constructor({
        rig, course, seed = 0xf0c5, start, firstStop = 5, stops = FOX_STOPS, paces = {},
    }) {
        this.rig = rig;
        this.course = course;
        this.seed = seed;
        this.start = start;
        this.firstStop = firstStop;
        this.stops = stops;
        const { scale } = rig;
        this.paces = {
            trot: 1.5,
            run: (power, surge = 0) => 2.7 + 4.1 * clamp01(power) + 1.4 * Math.min(1.4, Math.max(0, surge)),
            dash: 2.6,
            pounce: 3.6,
            mouse: 1.5,
            leapHigh: 0.75 * scale,
            leapLow: 0.4 * scale,
            fall: 7,
            brake: 1.5,
            brakeFrom: 5,
            printStep: 0.33 * scale,
            printSide: 0.07 * scale,
            eye: 0.5 * scale,
            room: 0,
            ...paces,
        };
        /**
         * Another on its course: how many metres ahead of it that is, and how fast it goes. Whoever
         * keeps two foxes on one course sets these before each step; a fox alone has all the room
         * there is. It slows for what is ahead, stops short of it, and makes a stop of the wait.
         */
        this.ahead = Infinity;
        this.aheadSpeed = 0;
        // Scratch for asking the body where the tip of its tail is.
        this._tailSpec = rig.createSpec();
        this._tailPosture = rig.createPosture();
        this._tailTip = [0, 0, 0];
        this._tailBone = rig.bones.map((bone) => bone[0]).filter((name) => /^tail\d+$/.test(name)).pop();
        /**
         * What the rig solves. Beyond place and act: `phase` how many cycles its gait has run,
         * `amp` how much of its stride it takes (0..1), `gallop` how much of a gallop its gait
         * is (0..1), `step` how much it lifts its feet even standing (0..1: turning on the
         * spot), `side` which way it curls (+1 its left),
         * `lean` (rad) its roll into a turn, `nod` (rad) its pitch from braking and springing,
         * `lookYaw` / `lookPitch` (rad, from its own heading) where its head is turned,
         * `tailYaw` / `tailLift` (rad) the tail's swing and carriage, `breath` (about −1..1),
         * `eyes` how far its eyes are shut (0..1).
         */
        this.pose = {
            x: 0,
            y: 0,
            z: 0,
            heading: 0,
            lift: 0,
            clip: 'Run',
            clipTime: 0,
            from: 'Run',
            fromTime: 0,
            blend: 1,
            was: null,
            wasTime: 0,
            hold: 1,
            flick: 0,
            glow: 0,
            speed: 0,
            phase: 0,
            amp: 1,
            gallop: 0,
            step: 0,
            side: 1,
            lean: 0,
            nod: 0,
            lookYaw: 0,
            lookPitch: 0,
            tailYaw: 0,
            tailLift: 0,
            breath: 0,
            eyes: 0,
        };
        /** Things that happened this step, for the world: prints, landings, a shake, a scrape of its paws. */
        this.events = [];
        this._at = [0, 0, 0];
        this.reset(0);
    }

    reset(time = 0) {
        this.rand = mulberry32(this.seed);
        // It starts already under way.
        this.s = this.start ?? this.course.stations[0] ?? 0;
        this.speed = this.paces.trot;
        this.phase = 0;
        this.mode = 'gait';
        this.modeAt = time;
        this.act = null;
        this.next = null;
        this.actIndex = 0;
        this.nextStop = time + this.firstStop;
        this.flick = 0;
        this.dash = 0;
        this.glow = 0;
        this.asleep = false;
        this.printRun = 0;
        this.printSide = 1;
        this.events.length = 0;
        this.pending = [];
        this._stepping = false;
        this.lift = 0;
        this.clip = 'Run';
        this.from = 'Run';
        this.fromTime = 0;
        this.blendAt = time - 10;
        this.blendTime = FOX_BLEND;
        this.was = null;
        this.wasTime = 0;
        this.hold = 1;
        this.clipTime = 0;
        // The body's own life.
        this.face = 0;
        this.gallop = this.rig.gallop(this.speed);
        this.stepping = 0;
        this.side = 1;
        this.turn = 0;
        this.lean = 0;
        this.nod = 0;
        this.lookYaw = 0;
        this.lookPitch = 0;
        this.tailYaw = 0;
        this.tailVel = 0;
        this.tailLift = 0.1;
        this.attending = null;
        this._pathHeading = this.course.at(this.s, this._at)[2];
        this._speedBefore = this.speed;
        this.resolve(time);
    }

    /** Its course changed shape (the frame did): keep its place along it. */
    setCourse(course) {
        const k = this.s / this.course.length;
        this.course = course;
        this.s = k * course.length;
        this._pathHeading = this.course.at(this.s, this._at)[2];
    }

    /** The bearing from a place (x, z, …) toward the viewer. */
    toViewer(at) {
        return Math.atan2(this.course.viewer[0] - at[0], this.course.viewer[1] - at[1]);
    }

    /**
     * Begin a change: what it shows at this instant is what the change starts from. Half-way
     * through another change that is two acts at once, so the one it had been leaving stays in
     * the pose (`was`), held at the share of the way from it that it had reached.
     */
    fade(time, seconds) {
        const k = clamp01((time - this.blendAt) / this.blendTime);
        const mix = k * k * (3 - 2 * k);
        this.was = mix < 1 ? this.from : null;
        this.wasTime = this.fromTime;
        this.hold = mix;
        this.from = this.clip;
        this.fromTime = this.clipTime;
        this.clipTime = 0;
        this.blendAt = time;
        this.blendTime = seconds;
    }

    switchClip(name, time) {
        if (name === this.clip) return;
        this.fade(time, Math.max(FOX_BLEND, BLEND_SLOW[name] ?? 0, BLEND_SLOW[this.clip] ?? 0));
        this.clip = name;
        // It shakes: whatever was in its coat flies from it.
        if (name === 'Shake') this.emit({ type: 'shake' });
        // What curls to a side curls toward whoever is watching.
        if (name === 'Sit' || name === 'CurlSleep') this.side = this.viewerSide();
    }

    /** Begin the act it is in over again, cross-fading from where it had got to in it. */
    restartClip(time) {
        this.fade(time, FOX_BLEND);
    }

    /** Which side of it the viewer is on: +1 its left, −1 its right. */
    viewerSide() {
        const at = this.course.at(this.s, this._at);
        return wrap(this.toViewer(at) - (at[2] + this.face)) >= 0 ? 1 : -1;
    }

    /** Something brushed it: the tail flicks. */
    flickTail(strength = 1) {
        this.flick = Math.max(this.flick, strength);
    }

    /**
     * Something worth a look: until `until` its head turns toward the point (world metres), as
     * far as the act it is in leaves its head free.
     */
    attend(x, y, z, until, weight = 1) {
        this.attending = {
            x, y, z, until, weight,
        };
    }

    /** Startled: it springs forward. */
    startle(strength = 1) {
        this.dash = Math.max(this.dash, strength);
        if (this.asleep) return;
        if (this.mode === 'idle') this.leaveIdle();
    }

    /** The great leap. */
    pounce(time) {
        // (Asleep, it is up and away in one move: no stretch first.)
        this.asleep = false;
        this.mode = 'pounce';
        this.modeAt = time;
        this.act = null;
        this.next = null;
        // (Again before it has landed: it gathers itself over again from where it is.)
        if (this.clip === 'Pounce') this.restartClip(time);
        else this.switchClip('Pounce', time);
        this.blendTime = Math.min(this.blendTime, 0.3);
    }

    /** Something for the world to answer: at once inside a step, else with the next one. */
    emit(event) {
        (this._stepping ? this.events : this.pending).push(event);
    }

    /** How high a leap carries it `time` being now: an arc over its airtime (its hunt's is lower). */
    leap(time) {
        if (this.clip !== 'Pounce') return 0;
        const into = this.mode === 'pounce' ? time - this.modeAt : this.clipTime;
        const k = (into - POUNCE_AIR[0]) / (POUNCE_AIR[1] - POUNCE_AIR[0]);
        const high = this.mode === 'pounce' ? this.paces.leapHigh : this.paces.leapLow;
        return k > 0 && k < 1 ? Math.sin(k * Math.PI) * high : 0;
    }

    /** It curls up where it is. */
    sleep(time) {
        if (this.asleep) return;
        this.asleep = true;
        this.mode = 'sleep';
        this.modeAt = time;
    }

    wake(time) {
        if (!this.asleep) return;
        this.asleep = false;
        this.mode = 'idle';
        this.modeAt = time;
        this.act = ['Stretch'];
        this.next = null;
        this.actIndex = 0;
        this.switchClip('Stretch', time);
    }

    leaveIdle() {
        this.mode = 'gait';
        this.act = null;
        this.next = null;
    }

    /** Stop where it is and do these acts, as it would at a stopping place (captures, tuning). */
    rehearse(clips, time) {
        if (this.asleep) this.wake(time);
        this.mode = 'idle';
        this.modeAt = time;
        this.speed = 0;
        this.act = [...clips];
        this.next = null;
        this.actIndex = 0;
        if (this.act[0] === this.clip) this.restartClip(time);
        else this.switchClip(this.act[0], time);
    }

    /** Metres along its course to its next stopping place. */
    toStation() {
        const { length, stations } = this.course;
        let best = Infinity;
        for (let i = 0; i < stations.length; i++) {
            const ahead = (((stations[i] - this.s) % length) + length) % length;
            if (ahead < best) best = ahead;
        }
        return best;
    }

    /**
     * Radians its facing still has to turn before it does what it stopped for (0 under way and
     * once it has begun). For most things it turns part of the way toward the viewer; a hunt it
     * begins as it stands, along its path — the leap carries it the way it is facing.
     */
    toFace() {
        if (this.mode !== 'idle' || this.act) return 0;
        if (this.next?.includes('Pounce')) return -this.face;
        const at = this.course.at(this.s, this._at);
        return clamp(wrap(this.toViewer(at) - at[2]) * 0.62, -FACE_MOST, FACE_MOST) - this.face;
    }

    /**
     * @param {number} dt
     * @param {number} time
     * @param {{ power: number, surge: number }} env
     */
    step(dt, time, env) {
        const { paces } = this;
        const { lengths } = this.rig;
        // (What happened between steps — a rehearsal that began with a shake — is told now.)
        this.events.length = 0;
        if (this.pending.length) this.events.push(...this.pending);
        this.pending.length = 0;
        this._stepping = true;
        const power = env?.power ?? 0;
        const surge = env?.surge ?? 0;
        this.flick *= Math.exp(-dt / 0.28);
        this.dash *= Math.exp(-dt / 1.1);
        const burning = clamp01(power * 0.95 + surge * 0.5);
        this.glow += (burning - this.glow) * approach(burning > this.glow ? 3 : 1.2, dt);

        if (this.mode === 'gait') {
            const wantsRun = power > 0.1 || this.dash > 0.25;
            let target = (wantsRun ? paces.run(power, surge) : paces.trot) + this.dash * paces.dash;
            // It keeps off the heels of whoever is ahead of it, at any pace.
            const room = this.ahead - paces.room;
            if (room < paces.brakeFrom) {
                target = Math.min(target, this.aheadSpeed + Math.sqrt(2 * paces.brake * Math.max(0, room)));
            }
            // At rest it stops where it likes to stop: it brakes for the place, and halts on it.
            const stopping = !wantsRun && time >= this.nextStop;
            const ahead = stopping ? this.toStation() : Infinity;
            if (ahead < paces.brakeFrom) {
                target = Math.min(target, Math.sqrt(2 * paces.brake * Math.max(0, ahead - 0.1)) + 0.12);
            }
            this.speed += (target - this.speed) * approach(target < this.speed ? 5 : 2.6, dt);
            const before = this.s;
            this.advance(this.speed * dt, time);
            this.switchClip('Run', time);
            this.clipTime = (((this.phase % 1) + 1) % 1) * lengths.Run;
            // (Brought to a stand behind another, it makes a stop of the wait.)
            const waiting = !wantsRun && room < 0.12 && this.speed < 0.3;
            if ((stopping && (ahead < 0.12 || this.passedStation(before, this.s))) || waiting) {
                // It has stopped, and knows what for: first it steps round to face the viewer
                // (unless it has heard something under its feet), then it does it.
                this.mode = 'idle';
                this.modeAt = time;
                this.act = null;
                this.next = this.stops[Math.floor(this.rand() * this.stops.length) % this.stops.length];
                // (Its hunt ends in a leap along its course: not with another where it would land.)
                if (this.next.includes('Pounce') && room < paces.mouse * (POUNCE_AIR[1] - POUNCE_AIR[0]) + 0.4) {
                    this.next = this.stops.find((stop) => !stop.includes('Pounce')) || this.next;
                }
                this.actIndex = 0;
            }
        } else if (this.mode === 'idle') {
            this.speed *= Math.exp(-dt / 0.18);
            this.advance(this.speed * dt, time);
            if (!this.act) {
                this.clipTime = (((this.phase % 1) + 1) % 1) * lengths.Run;
                // (Faced, and stood still: a hunt needs no turn, but it does not begin on the move.)
                if ((Math.abs(this.toFace()) < 0.09 && this.speed < 0.3) || time - this.modeAt > 1.8) {
                    this.act = this.next || this.stops[0];
                    this.next = null;
                    this.actIndex = 0;
                    this.switchClip(this.act[0], time);
                }
            } else {
                const was = this.clipTime;
                this.clipTime += dt;
                // The leap of its hunt carries it a little way, and it comes down in a puff.
                if (this.clip === 'Pounce') {
                    if (this.clipTime > POUNCE_AIR[0] && this.clipTime < POUNCE_AIR[1]) this.s += paces.mouse * dt;
                    if (was < POUNCE_AIR[1] && this.clipTime >= POUNCE_AIR[1]) {
                        this.emit({ type: 'land', soft: true });
                    }
                }
                // Digging, its forepaws throw the ground out behind it, a few scrapes a second.
                if (this.clip === 'Dig' && this.clipTime < DIG_UNTIL
                    && Math.floor(this.clipTime * DIG_SCRAPES) !== Math.floor(was * DIG_SCRAPES)) {
                    this.emit({ type: 'dig' });
                }
                const length = lengths[this.clip] || 1;
                if (this.clipTime >= length - 1e-6) {
                    this.actIndex += 1;
                    if (this.actIndex < this.act.length) {
                        const next = this.act[this.actIndex];
                        if (next === this.clip) this.restartClip(time);
                        else this.switchClip(next, time);
                    } else {
                        this.leaveIdle();
                        this.nextStop = time + 9 + this.rand() * 9;
                    }
                }
            }
            if (power > 0.1) this.leaveIdle();
        } else if (this.mode === 'pounce') {
            const t = time - this.modeAt;
            this.clipTime = Math.min(t, lengths.Pounce - 1e-3);
            const airborne = t > POUNCE_AIR[0] && t < POUNCE_AIR[1];
            const wasAir = t - dt > POUNCE_AIR[0] && t - dt < POUNCE_AIR[1];
            this.speed = airborne ? paces.pounce : this.speed * Math.exp(-dt / 0.12);
            this.s += this.speed * dt;
            if (wasAir && !airborne) this.emit({ type: 'land', soft: false });
            if (t >= lengths.Pounce) {
                this.mode = 'gait';
                this.speed = paces.trot;
                this.dash = Math.max(this.dash, 1);
            }
        } else if (this.mode === 'sleep') {
            const t = time - this.modeAt;
            this.speed *= Math.exp(-dt / 0.25);
            if (this.clip === 'Run' && t < 0.9) {
                // (Under way it slows to a stop first; in the middle of something it lies down from that.)
                this.advance(this.speed * dt, time);
                this.clipTime = (((this.phase % 1) + 1) % 1) * lengths.Run;
            } else {
                // It lies down and curls up, and stays curled. (Caught in the air, it comes down
                // where its leap was taking it.)
                if (this.lift > 0) this.s += this.speed * dt;
                this.switchClip('CurlSleep', time);
                this.clipTime = Math.min(this.clipTime + dt, SLEEP_HOLD);
            }
        }
        // A leap carries it up; cut short in the air, it comes down as fast as it would fall, no
        // faster.
        this.lift = Math.max(this.leap(time), this.lift - paces.fall * Math.max(0, dt));
        this.animate(dt, time);
        this.resolve(time);
        this._stepping = false;
    }

    /** Move along its course, turn the gait over and leave prints. */
    advance(distance, time) {
        if (distance <= 0) return;
        const { printStep, printSide } = this.paces;
        this.s += distance;
        this.phase += distance / this.rig.stride(this.speed);
        if (!(printStep > 0)) return;
        this.printRun += distance;
        while (this.printRun >= printStep) {
            this.printRun -= printStep;
            this.printSide = -this.printSide;
            const at = this.course.at(this.s - this.printRun, this._at);
            // Left and right of its line, a hand apart.
            const side = this.printSide * printSide;
            const x = at[0] + Math.cos(at[2]) * side;
            const z = at[1] - Math.sin(at[2]) * side;
            this.events.push({
                type: 'print', x, y: this.course.height(x, z), z, heading: at[2], time, speed: this.speed,
            });
        }
    }

    passedStation(before, after) {
        const { length, stations } = this.course;
        for (let i = 0; i < stations.length; i++) {
            const lapBefore = Math.floor((before - stations[i]) / length);
            const lapAfter = Math.floor((after - stations[i]) / length);
            if (lapAfter > lapBefore) return true;
        }
        return false;
    }

    /**
     * The body's own life for this step: what the acts do not give it. All of it eases or
     * springs, so nothing snaps when an act or a pace changes.
     */
    animate(dt, time) {
        if (!(dt > 0)) return;
        const at = this.course.at(this.s, this._at);
        const moving = this.mode === 'gait' || this.mode === 'pounce';
        // How fast its path is turning (rad/s, + to its left).
        const rate = wrap(at[2] - this._pathHeading) / dt;
        this._pathHeading = at[2];
        this.turn += (clamp(rate, -3, 3) - this.turn) * approach(7, dt);
        const run = smooth(1.3, 5.5, this.speed);
        // Its trot opens into a gallop, and closes again, over a stride or two — not at the
        // instant its speed crosses a line.
        this.gallop += (this.rig.gallop(this.speed) - this.gallop) * approach(3.2, dt);

        // Stopped, it turns part of the way toward the viewer — stepping round on the spot, a
        // few steps to the turn — and under way it turns back to its path. Asleep it stays put.
        if (this.mode !== 'sleep') {
            const faced = this.face;
            const wantFace = this.mode === 'idle' ? this.face + this.toFace() : 0;
            // (Once it has begun what it stopped for it stays as it stands: toFace() is 0 then.)
            this.face += (wantFace - this.face) * approach(moving ? 3.2 : 2.6, dt);
            const turned = Math.abs(this.face - faced);
            if (!moving) this.phase += turned * STEPS_A_TURN;
            const wantStep = moving ? 0 : clamp01(turned / dt / 0.3);
            this.stepping += (wantStep - this.stepping) * approach(wantStep > this.stepping ? 16 : 7, dt);
        } else {
            this.stepping += (0 - this.stepping) * approach(7, dt);
        }

        // It leans into a turn, the more the faster it goes; and it dips its nose as it brakes.
        const wantLean = moving ? clamp(this.turn * this.speed * 0.045, -0.32, 0.32) : 0;
        this.lean += (wantLean - this.lean) * approach(6, dt);
        const accel = (this.speed - this._speedBefore) / dt;
        this._speedBefore = this.speed;
        const wantNod = moving ? clamp(-accel * 0.045, -0.1, 0.14) : 0;
        this.nod += (wantNod - this.nod) * approach(5, dt);

        // Where its head is turned: toward what it was told to attend to, else into the turn.
        let yaw = 0;
        let pitch = 0;
        if (this.attending && time < this.attending.until) {
            const a = this.attending;
            const dx = a.x - at[0];
            const dz = a.z - at[1];
            const flat = Math.hypot(dx, dz) || 1;
            yaw = clamp(wrap(Math.atan2(dx, dz) - (at[2] + this.face)), -1.25, 1.25) * a.weight;
            pitch = clamp(Math.atan2(a.y - (this.course.height(at[0], at[1]) + this.paces.eye), flat), -0.45, 0.85)
                * a.weight;
        } else if (moving) {
            yaw = clamp(this.turn * 0.42, -0.55, 0.55);
        }
        const blend = clamp01((time - this.blendAt) / this.blendTime);
        const free = (HEAD_FREE[this.clip] ?? 0) * blend + (HEAD_FREE[this.from] ?? 0) * (1 - blend);
        this.lookYaw += (yaw * free - this.lookYaw) * approach(6.5, dt);
        this.lookPitch += (pitch * free - this.lookPitch) * approach(6.5, dt);

        // The tail follows on a spring: it lags a turn, swings past and settles; it streams out
        // level behind a running fox and hangs behind a standing one.
        const tailRest = this.turn * (0.16 + 0.2 * run) + this.lookYaw * 0.18;
        const steps = Math.max(1, Math.ceil(dt / 0.02));
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
            this.tailVel += (TAIL_SPRING * (tailRest - this.tailYaw) - TAIL_DAMP * this.tailVel) * h;
            this.tailYaw += this.tailVel * h;
        }
        this.tailYaw = clamp(this.tailYaw, -0.9, 0.9);
        const wantLift = this.mode === 'sleep' ? 0 : 0.08 + 0.5 * run + Math.min(0.2, this.dash * 0.2);
        this.tailLift += (wantLift - this.tailLift) * approach(3.5, dt);
    }

    /** Fill in the pose for `time`. */
    resolve(time) {
        const p = this.pose;
        const at = this.course.at(this.s, this._at);
        p.x = at[0];
        p.z = at[1];
        p.y = this.course.height(at[0], at[1]);
        p.heading = at[2] + this.face;
        p.lift = this.lift;
        p.clip = this.clip;
        p.clipTime = this.clipTime;
        p.from = this.from;
        p.fromTime = this.fromTime;
        p.blend = clamp01((time - this.blendAt) / this.blendTime);
        p.was = this.was;
        p.wasTime = this.wasTime;
        p.hold = this.hold;
        p.flick = this.flick;
        p.glow = this.glow;
        p.speed = this.speed;
        p.phase = this.phase;
        p.amp = foxGaitAmp(this.speed);
        p.gallop = this.gallop;
        p.step = this.stepping;
        p.side = this.side;
        p.lean = this.lean;
        p.nod = this.nod;
        p.lookYaw = this.lookYaw;
        p.lookPitch = this.lookPitch;
        const gait = this.clip === 'Run' || (this.from === 'Run' && p.blend < 1);
        p.tailYaw = this.tailYaw + Math.sin(time * 26) * this.flick * 0.9
            + (gait ? Math.sin(this.phase * TAU) * 0.1 * p.amp : 0);
        p.tailLift = this.tailLift;
        // It blinks now and then (when is read off the clock, so a seek blinks the same), and
        // asleep its eyes are shut.
        const slot = Math.floor(time / BLINK_EVERY);
        const blinkAt = (slot + 0.15 + 0.7 * mulberry32(this.seed + slot * 7919)()) * BLINK_EVERY;
        const blink = Math.sin(clamp01((time - blinkAt) / 0.17) * Math.PI);
        p.eyes = this.mode === 'sleep' ? Math.max(blink, smooth(1.1, 2.1, time - this.modeAt)) : blink;
        if (p.eyes < 1e-6) p.eyes = 0;
        // Asleep it breathes slow and deep; under way its gait hides its breath.
        if (this.mode === 'sleep') p.breath = Math.sin(time * 1.15) * 1.6;
        else p.breath = Math.sin(time * 1.7 + 1.1) * (this.speed < 0.3 ? 1 : 0.35);
        return p;
    }

    /** Where the tip of its tail is, as its body carries it now (world metres). */
    tail(out = [0, 0, 0]) {
        const p = this.pose;
        const { rig } = this;
        const posture = rig.solve(rig.spec(p, this._tailSpec), this._tailPosture);
        const tip = rig.point(posture, this._tailBone, rig.marks.tailTip, this._tailTip);
        const sin = Math.sin(p.heading);
        const cos = Math.cos(p.heading);
        out[0] = p.x + (tip[0] * cos + tip[2] * sin) * rig.scale;
        out[1] = p.y + p.lift + tip[1] * rig.scale;
        out[2] = p.z + (tip[2] * cos - tip[0] * sin) * rig.scale;
        return out;
    }

    /** The tail's swing as the pose has it (radians): its spring, its flick and its gait. */
    tailSwing() {
        return this.pose.tailYaw;
    }
}
