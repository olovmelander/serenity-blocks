/**
 * Winter — the arctic fox's own life. Three-free and renderer-free.
 *
 * What every fox does is the mind the themes share (../shared/fox-mind.js). This is what is the
 * arctic fox's own, on whatever course it is given, so the plain fox on its round (FoxMind in
 * winter-fox-mind.js), the fox that roams the snowfield (winter-fox-roam.js) and the visitor
 * (winter-fox-visitor.js) are all this animal:
 *
 *  - its paces. It does not only trot: it walks slowly with its nose to the snow, lopes, and
 *    bounds through the snow in arcs (which it is in is the roaming fox's to say);
 *  - what it does when it stops. Beside every fox's acts it has its own (winter-fox-rig.js): it
 *    scratches behind an ear, rolls in the snow, lies like a sphinx, stands up on its hind legs,
 *    goes round after its tail, leaps high for a mouse and misses, bows and tears about. Which
 *    it does, and why, is the roaming fox's (FOX_WANDER_STOPS is the table it draws on);
 *  - what it answers the board with, beside its dash and its pounce: a leap with a turn in it
 *    (`twirl`), a long look at the sky (`gaze`), three bounces on stiff legs (`rejoice`);
 *  - its prints, pressed where its paws are put down.
 */

import {
    FRAME_TREES, approach, bearingFor, clamp01, smooth,
} from './winter-core.js';
import {
    BATH_WRIGGLE, FOX_RIG, MOUSE_AIR, PRONK_AIRS, SPEC, SPEC_SIZE, TWIRL_AIR, WINTER_MIRRORED, createFoxPace,
} from './winter-fox-rig.js';
import { MOUSING } from '../shared/fox-mind.js';
import { WanderingFoxMind } from '../shared/fox-wander.js';

/** Its paces (m/s). */
export const FOX_TROT = 1.5;
export const foxRunSpeed = (power, surge = 0) => 2.7 + 4.1 * clamp01(power) + 1.4 * Math.min(1.4, Math.max(0, surge));

/**
 * Its paces at rest: how fast each is (m/s), and how much further than its trot's each cycle of it
 * carries it.
 */
export const FOX_PACES = Object.freeze({
    walk: Object.freeze({ speed: 0.58, stretch: 1 }),
    trot: Object.freeze({ speed: FOX_TROT, stretch: 1 }),
    lope: Object.freeze({ speed: 2.7, stretch: 1.3 }),
    bound: Object.freeze({ speed: 2.05, stretch: 1.5 }),
});

/** How its trot and its mood drift as it roams (the shared wandering mind's own numbers). */
export const FOX_WANDER = Object.freeze({
    /** Its trot, as a share of FOX_TROT, slowest and quickest. */
    pace: Object.freeze([0.8, 1.22]),
    /** How slowly its restlessness drifts (seconds), and how far. */
    restlessTime: 70,
    restlessSpread: 0.32,
});

/** The high leap of its hunt, and what follows a miss. */
export const MOUSE_MISS = Object.freeze(['Listen', 'MouseLeap', 'HeadTilt']);
export const MOUSE_HIT = Object.freeze(['Listen', 'MouseLeap', 'Dig', 'Shake']);

/**
 * What it may do when it stops, as it roams: [acts, how likely, what sways that]. Which of them
 * it may do at a stop is what it stopped for (STOP_GROUPS in winter-fox-roam.js).
 *  sky     more likely by this much under a strong aurora (it watches the sky)
 *  rest    more likely by this much when it has just run with a chain (it rests)
 *  lively  1: likelier when it is restless, −1: when it is calm
 *  then    'zoom': when it has done it, it tears about this way and that and skids to a stop
 */
export const FOX_WANDER_STOPS = Object.freeze([
    [['LookAround'], 0.8],
    [MOUSING, 0.8],
    [MOUSE_MISS, 0.9],
    [MOUSE_HIT, 0.5],
    [['Sit'], 0.5, { sky: 3, rest: 2 }],
    [['Sit', 'LookAround'], 0.4, { sky: 2 }],
    [['LookAround', 'Sit'], 0.35, { sky: 2 }],
    [['SkyGaze'], 0.3, { sky: 4 }],
    [['Listen', 'LookAround'], 0.6],
    [['Stretch', 'LookAround'], 0.45, { rest: 1 }],
    [['Dig', 'Shake'], 0.5],
    [['Greet'], 0.4],
    [['Greet', 'LookAround'], 0.3],
    [['Listen'], 0.4],
    [['Stretch'], 0.3, { rest: 1 }],
    [['LookAround', 'Listen', 'LookAround'], 0.3],
    [['Sphinx'], 0.6, { rest: 12, lively: -1 }],
    [['Scratch'], 0.7],
    [['Scratch', 'Shake'], 0.4],
    [['SnowBath', 'Shake'], 0.7, { lively: 1 }],
    [['PlayBow'], 0.7, { lively: 1, then: 'zoom' }],
    [['TailChase'], 0.45, { lively: 1 }],
    [['TailChase', 'Shake'], 0.2, { lively: 1 }],
    [['StandTall'], 0.6],
    [['StandTall', 'LookAround'], 0.3],
    [['HeadTilt', 'Listen'], 0.25],
].map(([acts, odds, sways = {}]) => Object.freeze([Object.freeze([...acts]), odds, Object.freeze({ ...sways })])));

/** What it does once it has skidded to a stop out of its romp (one of these, by chance). */
export const AFTER_ZOOM = Object.freeze([
    Object.freeze(['Shake']), Object.freeze(['LookAround']), Object.freeze(['Sit']),
]);
/** How fast it tears about in a romp (m/s), and how hard it brakes out of it (m/s²). */
export const ZOOM = Object.freeze({ speed: 4.4, brake: 6.5 });

/** What it answers the board with: a twist, a new level, a perfect clear. */
const TWIRL = Object.freeze(['Twirl']);
const GAZE = Object.freeze(['SkyGaze']);
const REJOICE = Object.freeze(['Pronk']);

/** Its own acts that go to a side: done on the side whoever is watching is on. */
const SIDED = new Set(WINTER_MIRRORED);
/** How much of a turn of the head its own acts leave room for. */
const HEAD_FREE = Object.freeze({
    Sphinx: 0.6, StandTall: 0.5, PlayBow: 0.3, Pronk: 0.5, SkyGaze: 0.25, HeadTilt: 0.15,
});

/** How high an arc over an airtime [off, down] carries it `t` into the act: 0 outside it. */
const arc = (t, air, high) => {
    const k = (t - air[0]) / (air[1] - air[0]);
    return k > 0 && k < 1 ? Math.sin(k * Math.PI) * high : 0;
};

/** The framing trees near enough to matter to a fox, as places on the ground, for an aspect. */
export const treesFor = (aspect) => FRAME_TREES.filter(([, dist]) => dist < 31).map(([fraction, dist]) => {
    const az = bearingFor(fraction, aspect);
    return [Math.sin(az) * dist, -Math.cos(az) * dist];
});

/**
 * The arctic fox's own life, on whatever course it is given: its paces, its acts, what it answers
 * the board with, its prints. The fox on its round (FoxMind) and the visitor (VisitorMind) are
 * both this animal.
 */
export class ArcticFoxMind extends WanderingFoxMind {
    /**
     * @param {object} options  the shared mind's (course, seed, start, paces)
     * @param {object|null} wander  how it roams (winter-fox-roam.js), or null for the plain fox on its course
     */
    constructor(options, wander) {
        super({ rig: FOX_RIG, ...options }, wander);
        if (this.walk) {
            // (Its prints are pressed where its paws are put down, not counted off along its way.)
            this.paces.printStep = 0;
            this.reset(0);
        }
    }

    reset(time = 0) {
        const { pose } = this;
        if (!pose.pace) {
            /** Its pace as the rig lays it (createFoxPace), and what it lays over its whole pose. */
            pose.pace = createFoxPace();
            pose.over = new Float64Array(SPEC_SIZE);
            this._spot = [0, 0, 0];
            this._brake = this.paces.brake;
        }
        pose.pace.walk = 0;
        pose.pace.lope = 0;
        pose.pace.bound = 0;
        pose.pace.stretch = 1;
        pose.over.fill(0);
        this.paces.brake = this._brake;
        /** The pace it is in at rest, and until when; a pace it is held to (captures). */
        this.going = 'trot';
        this.goingUntil = time + 8;
        this.heldPace = null;
        /** How far its nose is down to the snow (0..1), how tired a chain has left it, how strong the aurora is. */
        this.nose = 0;
        this.tired = 0;
        this.sky = 0;
        this._running = false;
        /** Whether what it is doing is an answer to the board (it finishes it), and one waiting its turn. */
        this.stunting = false;
        this.queued = null;
        /** What follows this stop, and one it must make next. */
        this.then = null;
        this.forced = null;
        /** The romp it is tearing about in: { end (distance run where it skids to a stop) }. */
        this.zooming = null;
        super.reset(time);
    }

    /** Stop where it is, bow, and tear about (captures, tuning). */
    playZoom(time) {
        this.rehearse(['PlayBow'], time);
        this.then = 'zoom';
    }

    /** Hold it to one pace at rest (`walk`, `trot`, `lope`, `bound`), or let it choose again (null). */
    keepPace(name) {
        this.heldPace = FOX_PACES[name] ? name : null;
        if (this.heldPace) this.going = this.heldPace;
    }

    /** Its pace at rest is the roaming fox's to choose (winter-fox-roam.js): the plain fox only trots. */
    choosePace() {}

    /**
     * Its pace now (m/s): the pace it is in, drifting a little; flat out in a romp. It
     * does not set off at speed while it still stands turned to whoever was watching: it comes
     * round to its way first.
     */
    trotAt(time) {
        if (!this.walk) return super.trotAt(time);
        const round = 1 - 0.85 * smooth(0.15, 0.6, Math.abs(this.face));
        if (this.zooming) return ZOOM.speed * round;
        if (this.going === 'trot') return super.trotAt(time);
        const drift = 0.5 + 0.3 * Math.sin(time / 17.3 + 0.7) + 0.2 * Math.sin(time / 6.9 + 2.1);
        return FOX_PACES[this.going].speed * (0.92 + 0.16 * drift) * (this.going === 'walk' ? 1 : round);
    }

    /** A hunt it begins as it stands, along its way: its leap carries it the way it is facing. */
    toFace() {
        if (this.mode === 'idle' && !this.act && this.next?.includes('MouseLeap')) return -this.face;
        return super.toFace();
    }

    headFree(clip) {
        return HEAD_FREE[clip] ?? super.headFree(clip);
    }

    switchClip(name, time) {
        const before = this.clip;
        super.switchClip(name, time);
        // What it does to a side it does on the side whoever is watching is on.
        if (this.clip !== before && SIDED.has(name)) this.side = this.viewerSide();
    }

    /** How high it is off the snow: every fox's leaps, and its own. */
    leap(time) {
        const { clip, clipTime, paces } = this;
        if (clip === 'MouseLeap') return arc(clipTime, MOUSE_AIR, paces.leapMouse);
        if (clip === 'Twirl') return arc(clipTime, TWIRL_AIR, paces.leapTwirl);
        if (clip === 'Pronk') {
            return arc(clipTime, PRONK_AIRS[0], paces.leapPronk) + arc(clipTime, PRONK_AIRS[1], paces.leapPronk * 1.35)
                + arc(clipTime, PRONK_AIRS[2], paces.leapPronk);
        }
        return super.leap(time);
    }

    /** Its own acts as they go: a leap carries it a little way and it lands; in its bath the snow flies. */
    acting(dt, time, was) {
        const { clip, clipTime } = this;
        if (clip === 'MouseLeap') {
            if (clipTime > MOUSE_AIR[0] && clipTime < MOUSE_AIR[1]) this.s += this.paces.mouseHigh * dt;
            if (was < MOUSE_AIR[1] && clipTime >= MOUSE_AIR[1]) this.emit({ type: 'land', soft: true });
        } else if (clip === 'SnowBath') {
            const [from, to, rate] = BATH_WRIGGLE;
            if (clipTime > from && clipTime < to && Math.floor(clipTime * rate * 2) !== Math.floor(was * rate * 2)) {
                this.emit({ type: 'roll' });
            }
        } else if (clip === 'Twirl') {
            if (was < TWIRL_AIR[1] && clipTime >= TWIRL_AIR[1]) this.emit({ type: 'land', soft: true });
        } else if (clip === 'Pronk') {
            for (let i = 0; i < PRONK_AIRS.length; i++) {
                if (was < PRONK_AIRS[i][1] && clipTime >= PRONK_AIRS[i][1]) this.emit({ type: 'hop' });
            }
        }
    }

    // ── What it answers the board with ──

    /**
     * Stop and do these acts as an answer to the board: it finishes them though the fires burn
     * and a clear startles it. Not asleep, and not in the middle of its great leap.
     */
    stunt(acts, time) {
        if (this.asleep || this.mode === 'sleep' || this.mode === 'pounce') return false;
        this.mode = 'idle';
        this.modeAt = time;
        this.act = acts;
        this.next = null;
        this.actIndex = 0;
        if (acts[0] === this.clip) this.restartClip(time);
        else this.switchClip(acts[0], time);
        this.stunting = true;
        return true;
    }

    /** A twist: it leaps and turns once round in the air. */
    twirl(time) {
        return this.stunt(TWIRL, time);
    }

    /** A new level: it stops and looks up at the sky. */
    gaze(time) {
        return this.stunt(GAZE, time);
    }

    /** A perfect clear: three bounces on stiff legs (once its great leap, if it is in one, is over). */
    rejoice(time) {
        if (this.asleep) return false;
        if (this.mode === 'pounce') {
            this.queued = REJOICE;
            return true;
        }
        return this.stunt(REJOICE, time);
    }

    keeps() {
        return this.stunting;
    }

    leaveIdle() {
        this.stunting = false;
        super.leaveIdle();
    }

    startle(strength = 1) {
        if (this.stunting) {
            this.dash = Math.max(this.dash, strength);
            return;
        }
        super.startle(strength);
    }

    pounce(time) {
        this.stunting = false;
        super.pounce(time);
    }

    sleep(time) {
        this.stunting = false;
        this.queued = null;
        super.sleep(time);
    }

    // ── Its romp ──

    /** Tear about from here and skid to a stop. The roaming fox does (winter-fox-roam.js): no room here. */
    zoom() {
        return false;
    }

    endZoom() {
        this.zooming = null;
        this.paces.brake = this._brake;
    }

    // ── Its prints ──

    /**
     * A paw is put down: it leaves a print there. At a walk and a trot a hind paw is set down in
     * its forepaw's print; bounding and galloping every paw leaves its own.
     */
    pawDown(i, x, z, time) {
        if (!this.walk || !(this.paces.pawPrints > 0)) return;
        if (i >= 2 && this.pose.pace.bound < 0.5 && this.gallop < 0.5) return;
        this.events.push({
            type: 'print', x, y: this.course.height(x, z), z, heading: this.pose.heading, time, speed: this.speed,
        });
    }

    // ── A step ──

    /**
     * @param {number} dt
     * @param {number} time
     * @param {{ power: number, surge: number, aurora?: number }} env  `aurora`: how strong the
     *     aurora is (0 at rest .. 1)
     */
    step(dt, time, env) {
        const power = env?.power ?? 0;
        this._running = power > 0.1 || this.dash > 0.25;
        if (dt > 0) {
            this.sky += (clamp01(env?.aurora ?? 0) - this.sky) * approach(0.5, dt);
            if (power > 0.1) this.tired = Math.min(1, this.tired + dt * 0.05 * (0.4 + power));
            else this.tired *= Math.exp(-dt / 80);
            const off = this._running || this.mode !== 'gait' || this.s > (this.zooming?.end ?? 0) + 4;
            if (this.zooming && off) this.endZoom();
            if (this.walk && !this.zooming && this.mode === 'gait' && !this._running && time >= this.goingUntil) {
                this.choosePace(time);
            }
            if (this.queued && this.mode === 'gait') {
                const { queued } = this;
                this.queued = null;
                this.stunt(queued, time);
            }
        }
        super.step(dt, time, env);
    }

    animate(dt, time) {
        super.animate(dt, time);
        if (!(dt > 0)) return;
        // Its pace eases in and out: its legs fall into the new step over a stride or two. A lope
        // and a bound want speed under them: it trots up to them and trots down out of them.
        const { pace } = this.pose;
        const resting = !this._running && !this.zooming && this.mode !== 'pounce' && this.mode !== 'sleep';
        const going = resting ? this.going : 'trot';
        const k = approach(2.4, dt);
        pace.walk += ((going === 'walk' ? 1 : 0) - pace.walk) * k;
        pace.lope += ((going === 'lope' ? smooth(1.7, 2.35, this.speed) : 0) - pace.lope) * k;
        pace.bound += ((going === 'bound' ? smooth(1.25, 1.85, this.speed) : 0) - pace.bound) * k;
        pace.stretch = 1 + (FOX_PACES.lope.stretch - 1) * pace.lope + (FOX_PACES.bound.stretch - 1) * pace.bound;
        // At a walk its nose goes down to the snow.
        const nosing = going === 'walk' && this.mode === 'gait' ? smooth(0.15, 0.45, this.speed) : 0;
        this.nose += (nosing - this.nose) * approach(1.8, dt);
    }

    resolve(time) {
        const p = super.resolve(time);
        const { over } = p;
        if (!over) return p;
        over.fill(0);
        const n = this.nose;
        if (n > 1e-4) {
            // Nose down along a scent, casting to one side and the other as it goes.
            const cast = Math.sin(this.s * 1.9);
            over[SPEC.headPitch] = -0.5 * n;
            over[SPEC.reach] = 0.55 * n;
            over[SPEC.headYaw] = 0.32 * n * cast;
            over[SPEC.headRoll] = 0.08 * n * cast;
            over[SPEC.fore] = 0.012 * n;
            over[SPEC.tailLift] = -0.06 * n;
        }
        return p;
    }
}

/** What the arctic fox adds to the shared mind's paces: its own leaps (m) and its prints. */
export const arcticPaces = (rig, more = {}) => ({
    trot: FOX_TROT,
    run: foxRunSpeed,
    /** How high its mousing leap, its leap with a turn and its bounces carry it (m). */
    leapMouse: 0.62 * rig.scale,
    leapTwirl: 0.42 * rig.scale,
    leapPronk: 0.2 * rig.scale,
    /** How fast its mousing leap carries it forward (m/s): it goes up more than along. */
    mouseHigh: 0.55,
    /** 1: its paws leave prints where they are put down (as it wanders). */
    pawPrints: 1,
    ...more,
});
