/**
 * Winter — what the fox does. Three-free and renderer-free: the model (winter-fox.js) only
 * draws the pose this resolves, so the fox behaves the same with or without it.
 *
 * At rest it trots its round over the snowfield and stops now and then to look about, listen,
 * dig, scratch or stretch. When the chain grows it runs, faster the longer the chain; a clear
 * makes it dash; four lines make it pounce; when the run ends it curls up and sleeps. A ring of
 * powder reaching it flicks its tail. Stepped with the world's fixed step, so a seek replays it.
 */

import {
    FOX_SCALE, TAU, approach, clamp01, foxAt, groundHeight, mulberry32,
} from './winter-core.js';

/** Seconds each clip of the model runs (assets/arctic-fox.glb). */
export const FOX_CLIPS = Object.freeze({
    CurlSleep: 2.6667,
    Dig: 1.6667,
    Greet: 1.8667,
    Listen: 2.3333,
    LookAround: 3,
    Pounce: 1.5333,
    Run: 0.8,
    Scratch: 1.6667,
    Shake: 0.9333,
    Stretch: 2,
});

/** What it may do when it stops: each a short run of clips. */
const ACTS = Object.freeze([
    ['LookAround'], ['Listen', 'Scratch'], ['Dig', 'Dig', 'Shake'], ['Stretch', 'LookAround'], ['Listen'], ['Greet'],
]);

/** Its paces (m/s) and how far one cycle of its gait carries it at a speed. */
export const FOX_TROT = 1.5;
export const foxRunSpeed = (power, surge = 0) => 2.7 + 4.1 * clamp01(power) + 1.4 * Math.min(1.4, Math.max(0, surge));
export const foxStride = (speed) => (0.62 + 0.21 * speed) * FOX_SCALE;

/** Seconds a change of clip takes to cross-fade. */
export const FOX_BLEND = 0.26;
/** The pounce: when it leaves the snow and lands (seconds into the clip), and how far it carries. */
export const POUNCE_AIR = Object.freeze([0.42, 1.08]);
const POUNCE_SPEED = 3.6;
/** Seconds into `CurlSleep` at which the fox lies curled (it lies from about 0.8 s to 2.1 s). */
export const SLEEP_HOLD = 1.5;
/** Metres between prints. */
const PRINT_STEP = 0.33 * FOX_SCALE;

export class FoxMind {
    /**
     * @param {object} round  foxRound(aspect)
     * @param {number} [seed]
     */
    constructor(round, seed = 0xf0c5) {
        this.round = round;
        this.seed = seed;
        /** What the model draws. */
        this.pose = {
            x: 0, y: 0, z: 0, heading: 0, lift: 0, clip: 'Run', clipTime: 0, from: 'Run', fromTime: 0, blend: 1, flick: 0, glow: 0, speed: 0,
        };
        /** Things that happened this step, for the world: prints and landings. */
        this.events = [];
        this._at = [0, 0, 0];
        this.reset(0);
    }

    reset(time = 0) {
        this.rand = mulberry32(this.seed);
        // It starts on its way to its stopping place under the moon, already under way.
        this.s = this.round.stations[1] - 11;
        this.speed = FOX_TROT;
        this.phase = 0;
        this.mode = 'gait';
        this.modeAt = time;
        this.act = null;
        this.actIndex = 0;
        this.nextStop = time + 5;
        this.flick = 0;
        this.dash = 0;
        this.glow = 0;
        this.asleep = false;
        this.printRun = 0;
        this.printSide = 1;
        this.events.length = 0;
        this.clip = 'Run';
        this.from = 'Run';
        this.fromTime = 0;
        this.blendAt = time - 10;
        this.clipTime = 0;
        this.resolve(time);
    }

    /** The round changed shape (the frame did): keep its place along it. */
    setRound(round) {
        const k = this.s / this.round.length;
        this.round = round;
        this.s = k * round.length;
    }

    switchClip(name, time) {
        if (name === this.clip) return;
        this.from = this.clip;
        this.fromTime = this.clipTime;
        this.clip = name;
        this.clipTime = 0;
        this.blendAt = time;
    }

    /** A ring of powder reached it: the tail flicks, and it pricks its ears if it was idle. */
    flickTail(strength = 1) {
        this.flick = Math.max(this.flick, strength);
    }

    /** A clear: it springs forward. */
    startle(strength = 1) {
        this.dash = Math.max(this.dash, strength);
        if (this.asleep) return;
        if (this.mode === 'idle') this.leaveIdle();
    }

    /** Four lines: the pounce. */
    pounce(time) {
        if (this.asleep) this.wake(time);
        this.mode = 'pounce';
        this.modeAt = time;
        this.switchClip('Pounce', time);
    }

    /** The run is over: it curls up where it is. */
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
        this.actIndex = 0;
        this.switchClip('Stretch', time);
    }

    leaveIdle() {
        this.mode = 'gait';
        this.act = null;
    }

    /**
     * @param {number} dt
     * @param {number} time
     * @param {{ power: number, surge: number }} env
     */
    step(dt, time, env) {
        this.events.length = 0;
        const power = env?.power ?? 0;
        const surge = env?.surge ?? 0;
        this.flick *= Math.exp(-dt / 0.28);
        this.dash *= Math.exp(-dt / 1.1);
        const burning = clamp01(power * 0.95 + surge * 0.5);
        this.glow += (burning - this.glow) * approach(burning > this.glow ? 3 : 1.2, dt);

        if (this.mode === 'gait') {
            const wantsRun = power > 0.1 || this.dash > 0.25;
            const target = (wantsRun ? foxRunSpeed(power, surge) : FOX_TROT) + this.dash * 2.6;
            this.speed += (target - this.speed) * approach(2.6, dt);
            const before = this.s;
            this.advance(this.speed * dt, time);
            this.switchClip('Run', time);
            this.clipTime = (this.phase % 1) * FOX_CLIPS.Run;
            // At rest it stops where it likes to stop.
            if (!wantsRun && time >= this.nextStop && this.passedStation(before, this.s)) {
                this.mode = 'idle';
                this.modeAt = time;
                this.act = ACTS[Math.floor(this.rand() * ACTS.length) % ACTS.length];
                this.actIndex = 0;
                this.switchClip(this.act[0], time);
            }
        } else if (this.mode === 'idle') {
            this.speed *= Math.exp(-dt / 0.18);
            this.advance(this.speed * dt, time);
            this.clipTime += dt;
            const length = FOX_CLIPS[this.clip] || 1;
            if (this.clipTime >= length - 1e-6) {
                this.actIndex += 1;
                if (this.act && this.actIndex < this.act.length) {
                    const next = this.act[this.actIndex];
                    if (next === this.clip) this.clipTime -= length;
                    else this.switchClip(next, time);
                } else {
                    this.leaveIdle();
                    this.nextStop = time + 9 + this.rand() * 9;
                }
            }
            if (power > 0.1) this.leaveIdle();
        } else if (this.mode === 'pounce') {
            const t = time - this.modeAt;
            this.clipTime = Math.min(t, FOX_CLIPS.Pounce - 1e-3);
            const airborne = t > POUNCE_AIR[0] && t < POUNCE_AIR[1];
            const wasAir = t - dt > POUNCE_AIR[0] && t - dt < POUNCE_AIR[1];
            this.speed = airborne ? POUNCE_SPEED : this.speed * Math.exp(-dt / 0.12);
            this.s += this.speed * dt;
            if (wasAir && !airborne) this.events.push({ type: 'land' });
            if (t >= FOX_CLIPS.Pounce) {
                this.mode = 'gait';
                this.speed = FOX_TROT;
                this.dash = Math.max(this.dash, 1);
            }
        } else if (this.mode === 'sleep') {
            const t = time - this.modeAt;
            this.speed *= Math.exp(-dt / 0.25);
            if (t < 0.9) {
                this.advance(this.speed * dt, time);
                this.clipTime = (this.phase % 1) * FOX_CLIPS.Run;
            } else {
                // The clip curls down, lies, and gets up again: it is played once into its
                // lying stretch and held there.
                this.switchClip('CurlSleep', time);
                this.clipTime = Math.min(this.clipTime + dt, SLEEP_HOLD);
            }
        }
        this.resolve(time);
    }

    /** Move along the round, turn the gait over and leave prints. */
    advance(distance, time) {
        if (distance <= 0) return;
        this.s += distance;
        this.phase += distance / foxStride(Math.max(this.speed, 0.4));
        this.printRun += distance;
        while (this.printRun >= PRINT_STEP) {
            this.printRun -= PRINT_STEP;
            this.printSide = -this.printSide;
            const at = foxAt(this.round, this.s - this.printRun, this._at);
            // Left and right of its line, a hand apart.
            const side = this.printSide * 0.07 * FOX_SCALE;
            const x = at[0] + Math.cos(at[2]) * side;
            const z = at[1] - Math.sin(at[2]) * side;
            this.events.push({
                type: 'print', x, y: groundHeight(x, z), z, heading: at[2], time,
            });
        }
    }

    passedStation(before, after) {
        const { length, stations } = this.round;
        for (let i = 0; i < stations.length; i++) {
            const lapBefore = Math.floor((before - stations[i]) / length);
            const lapAfter = Math.floor((after - stations[i]) / length);
            if (lapAfter > lapBefore) return true;
        }
        return false;
    }

    /** Fill in the pose for `time`. */
    resolve(time) {
        const p = this.pose;
        const at = foxAt(this.round, this.s, this._at);
        p.x = at[0];
        p.z = at[1];
        p.y = groundHeight(at[0], at[1]);
        p.heading = at[2];
        // The pounce carries it up: an arc over its airtime.
        p.lift = 0;
        if (this.mode === 'pounce') {
            const k = (time - this.modeAt - POUNCE_AIR[0]) / (POUNCE_AIR[1] - POUNCE_AIR[0]);
            if (k > 0 && k < 1) p.lift = Math.sin(k * Math.PI) * 0.75 * FOX_SCALE;
        }
        p.clip = this.clip;
        p.clipTime = this.clipTime;
        p.from = this.from;
        p.fromTime = this.fromTime;
        p.blend = clamp01((time - this.blendAt) / FOX_BLEND);
        p.flick = this.flick;
        p.glow = this.glow;
        p.speed = this.speed;
        return p;
    }

    /** Where the tip of its tail is (the sparks leave from there). */
    tail(out = [0, 0, 0]) {
        const p = this.pose;
        out[0] = p.x - Math.sin(p.heading) * 0.46 * FOX_SCALE;
        out[1] = p.y + p.lift + 0.34 * FOX_SCALE;
        out[2] = p.z - Math.cos(p.heading) * 0.46 * FOX_SCALE;
        return out;
    }

    /** A turn of the tail for the model (radians), from the flick and the gait. */
    tailSwing(time) {
        return Math.sin(time * 26) * this.flick * 0.9 + Math.sin(this.phase * TAU) * 0.12 * clamp01(this.speed / 3);
    }
}
