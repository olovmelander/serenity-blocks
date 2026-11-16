/**
 * Winter — the arctic fox's own life. Three-free and renderer-free.
 *
 * What every fox does is the mind the themes share (../shared/fox-mind.js) and how it wanders
 * (../shared/fox-wander.js). This is what is the arctic fox's own, on whatever course it is given,
 * so the fox on its round (winter-fox-mind.js) and the visitor (winter-fox-visitor.js) are both
 * this animal:
 *
 *  - its paces. It does not only trot: it walks slowly with its nose to the snow, lopes, and
 *    bounds through the snow in arcs, a spell of each, more of the quick ones when it is restless;
 *  - what it does when it stops. Beside every fox's acts it has its own (winter-fox-rig.js): it
 *    scratches behind an ear, rolls in the snow, lies like a sphinx, stands up on its hind legs,
 *    goes round after its tail, leaps high for a mouse and misses, bows and tears round in a
 *    circle. What it chooses leans on the night: under a strong aurora it sits and watches more,
 *    after a chain it lies down;
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

const TAU = Math.PI * 2;

/** Its paces (m/s). */
export const FOX_TROT = 1.5;
export const foxRunSpeed = (power, surge = 0) => 2.7 + 4.1 * clamp01(power) + 1.4 * Math.min(1.4, Math.max(0, surge));

/**
 * Its paces at rest: how fast each is (m/s), how likely it is to fall into it when it is calm and
 * when it is restless, how long a spell of it lasts (s, shortest and longest), and how much
 * further than its trot's each cycle of it carries it.
 */
export const FOX_PACES = Object.freeze({
    walk: Object.freeze({
        speed: 0.58, calm: 1.1, restless: 0.25, spell: Object.freeze([7, 16]), stretch: 1,
    }),
    trot: Object.freeze({
        speed: FOX_TROT, calm: 1.3, restless: 1, spell: Object.freeze([8, 22]), stretch: 1,
    }),
    lope: Object.freeze({
        speed: 2.7, calm: 0.25, restless: 1, spell: Object.freeze([5, 11]), stretch: 1.3,
    }),
    bound: Object.freeze({
        speed: 2.05, calm: 0.2, restless: 0.7, spell: Object.freeze([4, 9]), stretch: 1.5,
    }),
});
const PACE_NAMES = Object.freeze(Object.keys(FOX_PACES));

/** How it wanders when it is let. */
export const FOX_WANDER = Object.freeze({
    /** Metres it strays either side of its round (where its round is drawn as planned: less nearer the eye). */
    stray: 0.9,
    /** Metres it keeps from a framing tree where its round lets it (it never strays nearer than its round goes). */
    treeRoom: 2.4,
    /** Its trot, as a share of FOX_TROT, slowest and quickest. */
    pace: Object.freeze([0.8, 1.22]),
    /** Seconds before it next stops (drawn skewed toward short). */
    rest: Object.freeze([4, 26]),
    /** Odds it stops where it is (on an open side) rather than going on to one of its places. */
    anywhere: 0.55,
    /** Odds it turns back the way it came as it pulls up (never twice within this many seconds). */
    turnBack: 0.3,
    turnGap: 20,
    /** Where it may stop: fractions of the half width either side of the board, the open snow. */
    open: Object.freeze([0.4, 0.86]),
    /** Metres ahead it looks for a place to stop. */
    reach: 26,
    /** How slowly its restlessness drifts (seconds), and how far. */
    restlessTime: 70,
    restlessSpread: 0.32,
});

/** The high leap of its hunt, and what follows a miss. */
export const MOUSE_MISS = Object.freeze(['Listen', 'MouseLeap', 'HeadTilt']);
export const MOUSE_HIT = Object.freeze(['Listen', 'MouseLeap', 'Dig', 'Shake']);

/**
 * What it may do when it stops, as it wanders: [acts, how likely, what sways that].
 *  sky     more likely by this much under a strong aurora (it watches the sky)
 *  rest    more likely by this much when it has just run with a chain (it rests)
 *  lively  1: likelier when it is restless, −1: when it is calm
 *  then    'zoom': when it has done it, it tears round in a circle and skids to a stop
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

/** How much less likely what it did at its last stops is now: the last, the one before, and so on. */
const SEEN_BEFORE = Object.freeze([0.05, 0.3, 0.55, 0.8]);
/** What it does once it has skidded to a stop out of its circle (one of these, by chance). */
export const AFTER_ZOOM = Object.freeze([
    Object.freeze(['Shake']), Object.freeze(['LookAround']), Object.freeze(['Sit']),
]);
/** How fast it tears round its circle (m/s), how hard it brakes out of it (m/s²), and the circles it tries (m). */
export const ZOOM = Object.freeze({ speed: 4.4, brake: 6.5, radii: Object.freeze([2.3, 1.9, 1.5]) });

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
 * Let a walk take a circle on its way: from a distance run, once or twice round a circle that
 * touches its way there, and on from where it left. A distance run inside a circle is a place on
 * it; the distances beyond are that much further on along its course.
 */
export function withLoops(walk) {
    const along = walk.along.bind(walk);
    const at = walk.at.bind(walk);
    /** The circles it has taken and not yet forgotten: { at, length, radius, side (+1 to its left) }. */
    walk.loops = [];
    /** Metres of circles behind it that it has forgotten. */
    walk.looped = 0;
    /** How much of a distance run was circles. */
    walk.circled = (distance) => {
        let sum = walk.looped;
        for (let i = 0; i < walk.loops.length; i++) {
            const loop = walk.loops[i];
            sum += Math.max(0, Math.min(loop.length, distance - loop.at));
        }
        return sum;
    };
    walk.along = (distance) => along(distance - walk.circled(distance));
    walk.turn = (distance) => {
        const on = distance - walk.circled(distance);
        const [q, dir] = along(on);
        walk.turns.push({ at: on, q, dir: -dir });
        if (walk.turns.length > 48) walk.turns.splice(0, walk.turns.length - 48);
    };
    walk.at = (distance, out = [0, 0, 0]) => {
        at(distance, out);
        for (let i = 0; i < walk.loops.length; i++) {
            const loop = walk.loops[i];
            const into = distance - loop.at;
            if (into > 0 && into < loop.length) {
                const a = into / loop.radius;
                const sin = Math.sin(out[2]);
                const cos = Math.cos(out[2]);
                const aside = loop.side * loop.radius * (1 - Math.cos(a));
                const ahead = loop.radius * Math.sin(a);
                out[0] += cos * aside + sin * ahead;
                out[1] += -sin * aside + cos * ahead;
                out[2] += loop.side * a;
                break;
            }
        }
        return out;
    };
    return walk;
}

/**
 * The arctic fox's own life, on whatever course it is given: its paces, its acts, what it answers
 * the board with, its prints. The fox on its round (FoxMind) and the visitor (VisitorMind) are
 * both this animal.
 */
export class ArcticFoxMind extends WanderingFoxMind {
    /**
     * @param {object} options  the shared mind's (course, seed, start, paces)
     * @param {object|null} wander  how it wanders, or null for the plain fox on its course
     * @param {object} [plan]   where it may go: { roam(x, z), centre [x, z] }
     */
    constructor(options, wander, plan = null) {
        super({ rig: FOX_RIG, ...options }, wander);
        this.plan = plan;
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
        /** What its last stops were (indices into its stops), what follows this one, and one it must make next. */
        this.recent = [];
        this.then = null;
        this.forced = null;
        /** The circle it is tearing round: { end (distance run where it is round) }. */
        this.zooming = null;
        if (this.walk?.loops) {
            this.walk.loops.length = 0;
            this.walk.looped = 0;
        }
        super.reset(time);
    }

    /** Stop where it is, bow, and tear round in a circle (captures, tuning). */
    playZoom(time) {
        this.rehearse(['PlayBow'], time);
        this.then = 'zoom';
    }

    /** Hold it to one pace at rest (`walk`, `trot`, `lope`, `bound`), or let it choose again (null). */
    keepPace(name) {
        this.heldPace = FOX_PACES[name] ? name : null;
        if (this.heldPace) this.going = this.heldPace;
    }

    /** Fall into another pace for a spell: by its odds, calm or restless, and not the one it is in. */
    choosePace(time) {
        if (this.heldPace) {
            this.going = this.heldPace;
            this.goingUntil = Infinity;
            return;
        }
        const restless = this.restless ?? 0.45;
        let total = 0;
        for (let i = 0; i < PACE_NAMES.length; i++) total += this.paceOdds(PACE_NAMES[i], restless);
        let r = this.wanderRand() * total;
        let pick = 'trot';
        for (let i = 0; i < PACE_NAMES.length; i++) {
            r -= this.paceOdds(PACE_NAMES[i], restless);
            if (r <= 0) {
                pick = PACE_NAMES[i];
                break;
            }
        }
        const [least, most] = FOX_PACES[pick].spell;
        this.going = pick;
        this.goingUntil = time + least + (most - least) * this.wanderRand();
    }

    paceOdds(name, restless) {
        const pace = FOX_PACES[name];
        let odds = pace.calm + (pace.restless - pace.calm) * restless;
        if (name === this.going) odds *= 0.35;
        // (Tired, it walks more and bounds less.)
        if (name === 'walk') odds *= 1 + this.tired;
        else if (name !== 'trot') odds *= 1 - 0.7 * this.tired;
        return odds;
    }

    /**
     * Its pace now (m/s): the pace it is in, drifting a little; flat out round its circle. It
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

    /**
     * What it stops for: by its odds, swayed by the night (under a strong aurora it watches the
     * sky; after a chain it rests; restless, it plays), and seldom what it has lately done.
     */
    chooseStop() {
        if (!this.walk) return super.chooseStop();
        if (this.forced) {
            const { forced } = this;
            this.forced = null;
            this.then = null;
            return forced;
        }
        const { stops } = this.wander;
        const lead = this.recent.length ? stops[this.recent[0]][0][0] : null;
        let total = 0;
        for (let i = 0; i < stops.length; i++) total += this.stopOdds(i, lead);
        let r = this.wanderRand() * total;
        let pick = stops.length - 1;
        for (let i = 0; i < stops.length; i++) {
            r -= this.stopOdds(i, lead);
            if (r <= 0) {
                pick = i;
                break;
            }
        }
        this.recent.unshift(pick);
        if (this.recent.length > SEEN_BEFORE.length) this.recent.length = SEEN_BEFORE.length;
        this.then = stops[pick][2].then ?? null;
        return this.stops[pick];
    }

    stopOdds(i, lead) {
        const [acts, odds, sways] = this.wander.stops[i];
        let k = odds * (1 + (sways.sky ?? 0) * this.sky + (sways.rest ?? 0) * this.tired);
        if (sways.lively) k *= 1 + 0.8 * sways.lively * (((this.restless ?? 0.45) - 0.45) / 0.45);
        const seen = this.recent.indexOf(i);
        if (seen >= 0) k *= SEEN_BEFORE[seen];
        // (Nor what begins as its last stop began: two stops that open alike look alike.)
        else if (acts[0] === lead) k *= 0.35;
        return Math.max(0, k);
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

    // ── Its circle ──

    /** It has done what it stopped for: it falls into a pace — or tears round in a circle first. */
    onward(time) {
        if (!this.walk) return;
        const { then } = this;
        this.then = null;
        if (then === 'zoom' && this.zoom(time)) return;
        this.choosePace(time);
        // (Standing, no step shows which pace it is in: it sets off in the new one from its first.)
        if (this.speed < 0.05) this.pose.pace.walk = this.going === 'walk' ? 1 : 0;
    }

    /** A circle it has room for here: once or twice round, to the side its round lies on. */
    circleHere() {
        const laps = this.wanderRand() < 0.4 ? 2 : 1;
        if (!this.plan?.roam) return null;
        const [x, z, heading] = this.course.at(this.s, this._spot);
        const sin = Math.sin(heading);
        const cos = Math.cos(heading);
        const [cx, cz] = this.plan.centre;
        const inner = (cx - x) * cos - (cz - z) * sin >= 0 ? 1 : -1;
        for (let r = 0; r < ZOOM.radii.length; r++) {
            const radius = ZOOM.radii[r];
            for (let k = 0; k < 2; k++) {
                const side = k === 0 ? inner : -inner;
                let fits = true;
                for (let i = 1; i < 24 && fits; i++) {
                    const a = (i / 24) * TAU;
                    const aside = side * radius * (1 - Math.cos(a));
                    const ahead = radius * Math.sin(a);
                    fits = this.plan.roam(x + cos * aside + sin * ahead, z - sin * aside + cos * ahead);
                }
                if (fits) {
                    return {
                        at: this.s, length: TAU * radius * laps, radius, side,
                    };
                }
            }
        }
        return null;
    }

    /** Tear round in a circle from here and skid to a stop where it began. False when there is no room. */
    zoom(time) {
        if (!this.walk?.loops) return false;
        const { walk } = this;
        // (Circles behind it are forgotten: only how far they took it is kept.)
        for (let i = walk.loops.length - 1; i >= 0; i--) {
            if (this.s >= walk.loops[i].at + walk.loops[i].length) {
                walk.looped += walk.loops[i].length;
                walk.loops.splice(i, 1);
            }
        }
        const loop = this.circleHere();
        if (!loop) return false;
        walk.loops.push(loop);
        this.zooming = { end: loop.at + loop.length };
        this.paces.brake = ZOOM.brake;
        this.nextStop = time;
        this.stopAt = this.zooming.end + 0.45;
        this.stopAtStation = false;
        this.forced = AFTER_ZOOM[Math.floor(this.wanderRand() * AFTER_ZOOM.length) % AFTER_ZOOM.length];
        return true;
    }

    endZoom() {
        this.zooming = null;
        this.paces.brake = this._brake;
    }

    stopped(time) {
        if (this.zooming) {
            // It skids to a stop where it began (and does not turn back there: it has just been round).
            this.endZoom();
            this.stopAt = null;
            this.emit({ type: 'skid' });
            return;
        }
        super.stopped(time);
    }

    setBase(base, plan, course) {
        if (this.walk?.loops) {
            // (Its circles are not part of its course: its place along it is kept without them.)
            this.s -= this.walk.circled(this.s);
            this.walk.loops.length = 0;
            this.walk.looped = 0;
            if (this.zooming) this.endZoom();
        }
        this.plan = plan;
        super.setBase(base, plan, course);
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
