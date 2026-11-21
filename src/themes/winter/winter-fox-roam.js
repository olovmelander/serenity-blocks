/**
 * Winter — how the arctic fox roams the snowfield. Three-free and renderer-free.
 *
 * It goes round no ring. What it does from one minute to the next it does for a reason of its
 * own: hungry, it casts to and fro with its nose to the snow until it hears something, then stalks
 * it and leaps — a miss, and it tries again a step on; a catch, and it trots off and digs it in.
 * It works one side of the board for a while and then crosses to the other for fresh snow; it goes
 * up to where it sees far and sits under the aurora; it scratches, rolls, lies down when the
 * chains have tired it, bows and tears about in a romp; it goes over to watch the other fox, or
 * the bear out on the ice. How hungry, weary, restless it is drifts and is answered, so its night
 * has spells: a long hunt, a lazy while, a restless one.
 *
 * Where it goes is laid as it goes (FoxTrail): a walker steered toward each place it has in mind,
 * turning no tighter than a fox turns at that pace, wavering a little, kept clear of the framing
 * trees and inside the frame. Its way is never laid far ahead, so what it does next is decided
 * when it gets there; when it stops it turns on the spot to wherever it means to go next.
 *
 * Everything else — its paces, its acts, its answers to the board, its prints — is the arctic
 * fox's own life (winter-fox-life.js), on the fox mind the themes share (../shared/fox-mind.js).
 * Its own seed deals all of it, so a seek replays it.
 */

import {
    bearingFor, foxRoundPull, groundHeight, landDistance, mulberry32, smooth,
} from './winter-core.js';
import { FOX_RIG } from './winter-fox-rig.js';
import {
    AFTER_ZOOM, ArcticFoxMind, FOX_WANDER, FOX_WANDER_STOPS, ZOOM, arcticPaces, treesFor,
} from './winter-fox-life.js';
import { FoxTrail } from './winter-fox-trail.js';

export { FoxTrail };

const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.round(a / TAU);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const key = (acts) => acts.join('+');

/** Metres between the samples of its way. */
const SAMPLE = 0.1;
/** How near the place it means to reach a stretch of its way ends (m). */
const ARRIVE = 0.25;
/** Metres of way it keeps laid ahead of it: at a stand, and for every m/s it goes. */
const LOOK = 5.5;
const LOOK_PER_SPEED = 0.9;
/** Beyond a place it means to stop at it lays only this much (m): what then is decided there. */
const BEYOND = 6;

/** The snow the fox roams (metres from the eye as planned; an upright screen draws it nearer). */
export const FOX_RANGE = Object.freeze({
    near: 9.3,
    far: 20.8,
    /** The furthest across the frame it goes (fraction of the half width); it turns in before. */
    edge: 0.9,
    /** How much further in it keeps on an upright screen, near the eye (fraction of the half width). */
    narrow: 0.12,
    /** Metres from a framing tree where it steers off, and nearer than which it never goes. */
    treeRoom: 2.6,
    treeMost: 1.6,
    /** Where it stops: fractions of the half width either side of the board (the open snow). */
    open: Object.freeze([0.4, 0.86]),
    /** Metres inland it keeps (null: the snowfield's own band keeps it off the ice). */
    shore: null,
    /** Whether the band is drawn nearer the eye on an upright screen (foxRoundPull). */
    pull: true,
});

/**
 * How it steers at each pace: the tightest it turns (rad/m), how hard it turns toward where it is
 * going (rad/m for each radian it is off), and how much it wavers (rad/m).
 */
export const FOX_STEER = Object.freeze({
    walk: Object.freeze({ turn: 1.1, gain: 1.3, waver: 0.3 }),
    cast: Object.freeze({ turn: 1.2, gain: 1.5, waver: 0.12 }),
    trot: Object.freeze({ turn: 0.75, gain: 0.9, waver: 0.22 }),
    lope: Object.freeze({ turn: 0.45, gain: 0.6, waver: 0.12 }),
    bound: Object.freeze({ turn: 0.55, gain: 0.7, waver: 0.2 }),
    romp: Object.freeze({ turn: 0.62, gain: 1.3, waver: 0.08 }),
    run: Object.freeze({ turn: 0.3, gain: 0.42, waver: 0.05 }),
});

/**
 * What it may set out to do, and what makes it want to: `odds` how much it wants to at all, and
 * how much more it wants to when hungry (`hunger`), tired by a chain (`tired`), long on its feet
 * (`weary`), under a strong aurora (`sky`), restless (`lively`), or long on one side (`stay`).
 * Distances are metres as planned (an upright screen's are drawn nearer).
 */
export const FOX_ERRANDS = Object.freeze({
    /** Nose to the snow, casting to and fro across a stretch of it, until it hears something. */
    forage: Object.freeze({
        odds: 1,
        hunger: 1.5,
        far: Object.freeze([5, 11]),
        leg: Object.freeze([2.3, 3.4]),
        cast: Object.freeze([0.7, 1.5]),
    }),
    /** Something heard further off: it goes near, creeps the last of the way, and leaps. */
    hunt: Object.freeze({
        odds: 0.6, hunger: 1.2, far: Object.freeze([3.5, 9]), creep: 2.4,
    }),
    /** Over to the other side of the board, for fresh snow. */
    cross: Object.freeze({ odds: 0.38, stay: 0.55 }),
    /** Up to where it sees far, to sit and watch. */
    lookout: Object.freeze({ odds: 0.3, sky: 3 }),
    /** A few steps, and down. */
    rest: Object.freeze({ odds: 0.2, tired: 6, weary: 2.5 }),
    /** A few steps, and it sees to its coat. */
    groom: Object.freeze({ odds: 0.32 }),
    /** A bow and a romp. */
    play: Object.freeze({ odds: 0.2, lively: 1.6 }),
    /** Over toward something it has noticed, to watch it (only with something to watch). */
    watch: Object.freeze({ odds: 0.7 }),
});

/**
 * What follows what, by chance: after a miss it tries again a step on (`retry`); after a catch it
 * carries it off and digs it in (`cache`); having listened, it heard something and stalks it
 * (`heard`); crossing, it goes straight on into what it does next without a stop (`through`).
 */
export const FOX_FOLLOW = Object.freeze({
    retry: 0.55, cache: 0.4, heard: 0.45, through: 0.4,
});

/** How it tears about in a romp: legs (fewest, most) and the metres each runs (shortest, longest). */
export const FOX_ROMP = Object.freeze({ legs: Object.freeze([3, 5]), reach: Object.freeze([2.4, 5.2]) });

/** What it may do when it stops, by what it stopped for: keys of its stops (FOX_WANDER_STOPS). */
export const STOP_GROUPS = Object.freeze({
    scent: Object.freeze([
        'Listen', 'Listen+LookAround', 'HeadTilt+Listen', 'LookAround+Listen+LookAround', 'Dig+Shake',
        'Listen+Pounce+Dig+Shake', 'Listen+MouseLeap+HeadTilt',
    ]),
    hunt: Object.freeze(['Listen+Pounce+Dig+Shake', 'Listen+MouseLeap+HeadTilt', 'Listen+MouseLeap+Dig+Shake']),
    cache: Object.freeze(['Dig+Shake']),
    alert: Object.freeze([
        'LookAround', 'StandTall', 'StandTall+LookAround', 'Listen+LookAround', 'Greet', 'Greet+LookAround',
    ]),
    sky: Object.freeze(['Sit', 'Sit+LookAround', 'LookAround+Sit', 'SkyGaze', 'StandTall+LookAround']),
    rest: Object.freeze(['Sphinx', 'Stretch', 'Stretch+LookAround', 'Sit']),
    groom: Object.freeze(['Scratch', 'Scratch+Shake', 'SnowBath+Shake', 'TailChase', 'TailChase+Shake']),
    play: Object.freeze(['PlayBow']),
    watch: Object.freeze(['StandTall+LookAround', 'Sit', 'Sit+LookAround', 'Greet', 'PlayBow']),
});

/** How much less likely what it did at its last stops is now: the last, the one before, and so on. */
const SEEN_BEFORE = Object.freeze([0.05, 0.3, 0.55, 0.8]);
/** Metres of its way it lays straight on from where it hunts: its leap carries it along them. */
const LEAP_ROOM = 1.5;
/** Metres more than its tree room that a place it hunts (and leaps) keeps from a tree. */
const HUNT_ROOM = 1;
/** How much of a turn on the spot it steps round at once (rad): a half turn takes it two seconds and more. */
const TURN_STEP = 0.55;
/** How hard it can corner at a run (m/s² across its way): it slows to take a tighter turn. */
const CORNER_GRIP = 16;
/** The ways (radians off its heading) a running fox looks for room, nearest first. */
const RUN_RAYS = Object.freeze([0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2, -2, 2.6, -2.6]);
/** Acts that carry it forward off the snow: it does them along its way, not turned to the next. */
const LEAPS = new Set(['Pounce', 'MouseLeap']);

/**
 * The snow a fox may roam at an aspect: a band of the snowfield `near`..`far` metres from the eye,
 * inside the frame, clear of the framing trees (and, with `shore`, that far inland).
 */
export function snowRange(aspect, o = FOX_RANGE) {
    const pull = o.pull ? foxRoundPull(aspect) : 1;
    const near = o.near * pull;
    const far = o.far * pull;
    const across = Math.tan(bearingFor(1, aspect));
    const trees = treesFor(aspect).filter(([x, z]) => Math.hypot(x, z) < far + 8);
    const { treeRoom, treeMost, shore } = o;
    // (Its fraction across the frame is reckoned flat; on an upright screen a place near the eye and
    // below the view's tilt shows further out than that says, so it keeps further in there.)
    const edge = o.edge - (o.narrow ?? 0) * smooth(1.25, 0.7, aspect);
    const open0 = o.open[0];
    const open1 = Math.min(o.open[1], edge - 0.04);
    const fraction = (x, z) => (z < -0.5 ? x / -z / across : Math.sign(x || 1) * 9);
    const clearance = (x, z) => {
        let most = Infinity;
        for (let i = 0; i < trees.length; i++) most = Math.min(most, Math.hypot(trees[i][0] - x, trees[i][1] - z));
        return most;
    };
    const place = (f, d) => {
        const az = Math.atan(f * across);
        return [Math.sin(az) * d, -Math.cos(az) * d];
    };
    const centre = place(0, (near + far) / 2);
    const range = {
        aspect,
        pull,
        near,
        far,
        edge,
        /** Where across the frame it stops (fractions of the half width): beside the board. */
        band: [open0, open1],
        trees,
        centre,
        fraction,
        clearance,
        place,
        /**
         * How far outside its snow a place is (0 inside): metres nearer a tree, out of the band or
         * off the shore, and fractions past the edge (unless `free`, as one comes or goes).
         */
        outside(x, z, free = false) {
            return range.crowded(x, z) + range.astray(x, z, free);
        },
        /** How much nearer a framing tree than it ever goes a place is (m). */
        crowded(x, z) {
            return Math.max(0, treeMost - clearance(x, z));
        },
        /** How far a place is out of its band, off the shore, or (unless `free`) past the frame's edge. */
        astray(x, z, free = false) {
            const r = Math.hypot(x, z);
            let out = Math.max(0, near - r) + Math.max(0, r - far);
            if (!free) out += 10 * Math.max(0, Math.abs(fraction(x, z)) - edge);
            if (shore !== null) out += Math.max(0, shore - landDistance(x, z));
            return out;
        },
        /** Whether it may be at a place, with `margin` metres to spare from the band and the trees. */
        inside(x, z, margin = 0, free = false) {
            const r = Math.hypot(x, z);
            if (r < near + margin || r > far - margin) return false;
            if (clearance(x, z) < treeMost + margin) return false;
            if (!free && Math.abs(fraction(x, z)) > edge - margin * 0.03) return false;
            return shore === null || landDistance(x, z) >= shore + margin;
        },
        /** Whether it would be seen stopping there: on the open snow beside the board. */
        open(x, z) {
            const f = Math.abs(fraction(x, z));
            const r = Math.hypot(x, z);
            return f >= open0 && f <= open1 && r >= near + 0.4 && r <= far - 0.4
                && clearance(x, z) >= treeRoom && (shore === null || landDistance(x, z) >= shore + 0.5);
        },
        /**
         * How it would turn at (x, z) heading h to keep to its snow (rad/m, + to its left): off a tree
         * ahead of it, and in toward the middle as it nears the frame's edge or the band's.
         */
        steer(x, z, h, free = false) {
            let turn = 0;
            const reach = treeRoom + 1.5;
            for (let i = 0; i < trees.length; i++) {
                const dx = trees[i][0] - x;
                const dz = trees[i][1] - z;
                const d = Math.hypot(dx, dz);
                if (d > reach) continue;
                const off = wrap(Math.atan2(dx, dz) - h);
                if (Math.abs(off) > 1.8) continue;
                const close = clamp01((reach - d) / (reach - treeMost));
                turn -= (off >= 0 ? 1 : -1) * close * close * 2.4 * (1 - Math.abs(off) / 3.6);
            }
            const r = Math.hypot(x, z);
            let press = Math.max(smooth(near + 1, near, r), smooth(far - 1, far, r));
            if (!free) press = Math.max(press, smooth(edge - 0.14, edge, Math.abs(fraction(x, z))));
            if (shore !== null) press = Math.max(press, smooth(shore + 2, shore, landDistance(x, z)));
            if (press > 0) turn += wrap(Math.atan2(centre[0] - x, centre[1] - z) - h) * 2 * press;
            return turn;
        },
    };
    return range;
}

/** Its stops, by group: [acts, odds, sways] from FOX_WANDER_STOPS, for the acts a fox may do. */
export function stopGroups(stops = FOX_WANDER_STOPS, allowed = () => true) {
    const byKey = new Map(stops.map((stop) => [key(stop[0]), stop]));
    const groups = {};
    Object.entries(STOP_GROUPS).forEach(([name, keys]) => {
        groups[name] = Object.freeze(keys.map((k) => byKey.get(k)).filter((stop) => stop && allowed(stop)));
    });
    return Object.freeze(groups);
}

/**
 * The arctic fox as it roams: it sets out to do something, goes there by a way it lays as it goes,
 * does it, and decides what next. `range` is the snow it roams (snowRange); `errands` what it may
 * set out to do and how much it wants to (FOX_ERRANDS); `groups` what it may do when it stops.
 */
export class RoamingFoxMind extends ArcticFoxMind {
    /**
     * @param {object} [o]
     * @param {number} [o.aspect]
     * @param {number} [o.seed]
     * @param {object} [o.rig]
     * @param {object} [o.paces]   added to the arctic fox's (arcticPaces)
     * @param {object} [o.range]   how the snow it roams is laid out (FOX_RANGE)
     * @param {object} [o.errands] what it sets out to do (FOX_ERRANDS)
     * @param {object} [o.groups]  what it does when it stops (stopGroups())
     */
    constructor({
        aspect = 16 / 9, seed = 0xf0c5, rig = FOX_RIG, paces = {}, range = FOX_RANGE, errands = FOX_ERRANDS,
        groups = stopGroups(),
    } = {}) {
        const trail = new FoxTrail();
        const stops = [];
        Object.values(groups).forEach((list) => list.forEach((stop) => {
            if (!stops.includes(stop)) stops.push(stop);
        }));
        super({
            rig,
            course: {
                length: Infinity,
                stations: [],
                height: groundHeight,
                viewer: [0, 0],
                at: (distance, out) => trail.at(distance, out),
            },
            seed,
            start: 0,
            firstStop: 0,
            paces: arcticPaces(rig, paces),
        }, { ...FOX_WANDER, walk: trail, stops });
        this.trail = trail;
        // At a run it slows for a turn too tight to take at speed.
        const { run } = this.paces;
        this.paces.run = (power, surge) => Math.min(run(power, surge), this.range ? this.cornerSpeed() : Infinity);
        this.layout = range;
        this.errandTable = errands;
        this.groups = groups;
        this.aspect = aspect;
        this.range = snowRange(aspect, range);
        this._tip = [0, 0, 0];
        this._here = [0, 0, 0];
        this.reset(0);
    }

    reset(time = 0) {
        if (this.range) {
            /** Its own dealer for where it goes and what it does there. */
            this.roamRand = mulberry32((this.seed ^ 0x40a3) >>> 0);
            const [x, z, h] = this.startPlace();
            this.trail.start(x, z, h, 0);
            /** What it is about, what it was lately about, and what it has still to lay of it. */
            this.errand = null;
            this.recentErrands = [];
            this.steps = [];
            /** The stretches of its way laid so far: where each begins and at what pace. */
            this.legs = [{ from: 0, pace: 'trot' }];
            /** Where it means to stop (distance run), and what for. */
            this.stopAt = null;
            this.arrival = null;
            this._arrived = false;
            /** The stop it has laid the way beyond, and how often a way it meant to lay could not be had. */
            this.driftFor = null;
            this.misses = 0;
            this.recentStops = [];
            /** How hungry and how weary it is (0..1), and where it has lately stopped. */
            this.hunger = 0.35 + 0.4 * this.roamRand();
            this.weary = 0.15 * this.roamRand();
            this.visited = [];
            /** The side of the board it is working, and how many things it has done there. */
            this.side = Math.sign(this.range.fraction(x, z)) || 1;
            this.sideRun = 0;
            /** Something it has noticed and might go to watch, and when it last did. */
            this.interest = null;
            this.watchedAt = -Infinity;
            /** How far it had to turn on the spot at its last stop (rad). */
            this.turnSize = 0;
            this.roamRunning = false;
            /** Where it makes for at a run, and how much further before it makes for somewhere else. */
            this.runGoal = null;
            this.runFor = 0;
            /** Which way it is swinging off something at a run (+1 left, -1 right, 0 not). */
            this.runSwing = 0;
            this.now = time;
        }
        super.reset(time);
        if (this.range) {
            this.going = 'trot';
            this.goingUntil = Infinity;
            this.ensureAhead(time);
        }
    }

    /** Where it is when the night begins: under way on the open snow, either side, heading in. */
    startPlace() {
        const { range } = this;
        for (let i = 0; i < 40; i++) {
            const side = this.roamRand() < 0.5 ? -1 : 1;
            const f = side * lerp(0.45, 0.8, this.roamRand());
            const [x, z] = range.place(f, lerp(range.near + 1, range.far - 1, this.roamRand()));
            if (!this.openAt(x, z)) continue;
            const h = Math.atan2(range.centre[0] - x, range.centre[1] - z) + (this.roamRand() - 0.5) * 1.6;
            return [x, z, wrap(h)];
        }
        const [x, z] = range.place(0.6, (range.near + range.far) / 2);
        return [x, z, Math.atan2(range.centre[0] - x, range.centre[1] - z)];
    }

    /** The frame changed shape: its snow is laid out anew, and it goes on from where it is. */
    setAspect(aspect) {
        if (aspect === this.aspect && this.range) return;
        this.aspect = aspect;
        this.range = snowRange(aspect, this.layout);
        this.steps = [];
        if (this.zooming) {
            this.endZoom();
            this.forced = null;
        }
        this.reroute(this.now);
    }

    // ── Its needs ──

    /**
     * Where on its snow it is seen as the board sits now (`sight(x, z)`, from its world: not behind a
     * card or the HUD, not off the frame), or null to count all its open snow as seen.
     */
    setSight(sight) {
        this.sight = typeof sight === 'function' ? sight : null;
    }

    /** Whether it would be seen stopping at a place: on the open snow beside the board, and in sight. */
    openAt(x, z) {
        return this.range.open(x, z) && (!this.sight || this.sight(x, z));
    }

    /** Something worth going over to watch: the other fox, the bear out on the ice. */
    notice(x, z, time, kind = 'fox') {
        this.interest = {
            x, z, kind, at: time,
        };
    }

    /** How much it wants each thing it might set out to do now. */
    errandOdds(time) {
        const e = this.errandTable;
        const lively = clamp(((this.restless ?? 0.45) - 0.45) / 0.45, -1, 1);
        const odds = {};
        // (Tired by a chain, it has less mind to go far or hunt.)
        const spent = 1 - 0.6 * this.tired;
        if (e.forage) odds.forage = e.forage.odds * (0.35 + e.forage.hunger * this.hunger) * spent;
        if (e.hunt) odds.hunt = e.hunt.odds * (0.3 + e.hunt.hunger * this.hunger) * spent;
        if (e.cross) odds.cross = e.cross.odds * (0.35 + e.cross.stay * this.sideRun) * spent;
        if (e.lookout) odds.lookout = e.lookout.odds * (1 + e.lookout.sky * this.sky);
        if (e.rest) odds.rest = e.rest.odds * (1 + e.rest.tired * this.tired + e.rest.weary * this.weary);
        if (e.groom) odds.groom = e.groom.odds;
        if (e.play) odds.play = e.play.odds * Math.max(0.15, 1 + e.play.lively * lively) * (1 - 0.8 * this.tired);
        const fresh = this.interest && time - this.interest.at < 15 && time - this.watchedAt > 90;
        if (e.watch && fresh) odds.watch = e.watch.odds;
        // (Seldom what it has just done; forage and hunt go on in spells.)
        const [last, before] = this.recentErrands;
        if (last && odds[last] !== undefined) odds[last] *= last === 'forage' || last === 'hunt' ? 0.55 : 0.25;
        if (before && odds[before] !== undefined) odds[before] *= 0.7;
        return odds;
    }

    chooseErrand(time) {
        const odds = Object.entries(this.errandOdds(time)).filter(([, w]) => w > 0);
        let r = this.roamRand() * odds.reduce((sum, [, w]) => sum + w, 0);
        for (const [name, w] of odds) {
            r -= w;
            if (r <= 0) return name;
        }
        return odds.length ? odds[odds.length - 1][0] : 'forage';
    }

    /**
     * Decide what to do next, from the end of its way: an errand by its wants, laid out as stretches
     * of way to go (`moving`: it is under way there, so it rather goes on than back).
     */
    decide(time, moving = false, heading = null) {
        const tip = this.trail.tip(this._tip);
        // (Given a heading, it goes on that way: narrowly, as after a leap.)
        if (heading !== null) tip[2] = heading;
        const cone = moving ? [tip[2], heading !== null ? 0.7 : 1.15] : null;
        if (this.roamRunning) {
            this.planRun();
            return;
        }
        const side = Math.sign(this.range.fraction(tip[0], tip[1])) || this.side;
        if (side === this.side) this.sideRun += 1;
        else {
            this.side = side;
            this.sideRun = 0;
        }
        let name = this.chooseErrand(time);
        if (name === 'watch') this.watchedAt = time;
        for (let tries = 0; tries < 4 && !this.plan(name, tip, cone, time); tries++) name = this.chooseErrand(time);
        if (!this.steps.length) {
            name = 'wander';
            this.planWander(tip, cone);
        }
        const first = this.steps[0]?.target;
        const on = [tip[0] + Math.sin(tip[2]) * 1.2, tip[1] + Math.cos(tip[2]) * 1.2];
        if (moving && first && Math.abs(wrap(Math.atan2(first[0] - tip[0], first[1] - tip[1]) - tip[2])) > 1.75
            && this.openAt(on[0], on[1])) {
            // (Where it means to go lies behind it: where it is seen, it pulls up, looks about, and
            // turns there; elsewhere it swings round.)
            this.steps = [{ target: on, pace: 'walk', stop: 'alert' }];
            name = 'pause';
        }
        this.errand = name;
        this.recentErrands.unshift(name);
        this.recentErrands.length = Math.min(this.recentErrands.length, 4);
    }

    plan(name, tip, cone, time) {
        switch (name) {
        case 'forage': return this.planForage(tip, cone);
        case 'hunt': return this.planHunt(tip, cone);
        case 'cross': return this.planCross(tip);
        case 'lookout': return this.planLookout(tip, cone);
        case 'rest': return this.planNear(tip, cone, [1.5, 5], 'walk', 'rest');
        case 'groom': return this.planNear(tip, cone, [0.8, 3], 'walk', 'groom');
        case 'play': return this.planPlay(tip, cone);
        case 'watch': return this.planWatch(tip, time);
        default: return this.planWander(tip, cone);
        }
    }

    // ── Places it might go ──

    /**
     * A place lo..hi metres (as planned) from `from`: on the open snow (`open`) or anywhere on its
     * snow, on one side of the board (`side`), within a cone [heading, half-angle] (`cone`; if none
     * can be had there, anywhere, unless `strict`), and if it can be had not where it has lately
     * stopped.
     */
    spot(from, lo, hi, {
        open = false, side = 0, cone = null, margin = 0.4, strict = false, room = 0,
    } = {}) {
        const { range } = this;
        const k = range.pull;
        for (let tries = 0; tries < 60; tries++) {
            const useCone = cone && (strict || tries < 40);
            const a = useCone ? cone[0] + (2 * this.roamRand() - 1) * cone[1] : this.roamRand() * TAU;
            const d = lerp(lo, hi, this.roamRand()) * k;
            const x = from[0] + Math.sin(a) * d;
            const z = from[1] + Math.cos(a) * d;
            if (open ? !this.openAt(x, z) : !range.inside(x, z, margin)) continue;
            if (room && range.clearance(x, z) < this.layout.treeRoom + room) continue;
            if (side && Math.sign(range.fraction(x, z)) !== side && tries < 50) continue;
            if (tries < 30 && this.visitedNear(x, z)) continue;
            return [x, z];
        }
        return null;
    }

    /** A place on the open snow on one side of the board, anywhere along it. */
    spotOn(side) {
        const { range } = this;
        const [open0, open1] = range.band;
        for (let tries = 0; tries < 50; tries++) {
            const f = side * lerp(open0, open1, this.roamRand());
            const [x, z] = range.place(f, lerp(range.near, range.far, this.roamRand()));
            if (!this.openAt(x, z)) continue;
            if (tries < 30 && this.visitedNear(x, z)) continue;
            return [x, z];
        }
        return null;
    }

    visitedNear(x, z) {
        const room = 2.3 * this.range.pull;
        return this.visited.some(([vx, vz]) => Math.hypot(vx - x, vz - z) < room);
    }

    /** The side it would rather stay on while it works one (now and then the other). */
    keepSide() {
        return this.roamRand() < 0.75 ? this.side : 0;
    }

    /** A pace for getting somewhere: a trot mostly, quicker when it is restless. */
    travelPace() {
        const restless = this.restless ?? 0.45;
        const r = this.roamRand();
        if (r < 0.15 + 0.2 * restless) return 'bound';
        if (r < 0.38 + 0.35 * restless) return 'lope';
        return 'trot';
    }

    /** A pace for a trip: what it would go at near by, a travelling pace when it goes further. */
    tripPace(from, to, near) {
        return Math.hypot(to[0] - from[0], to[1] - from[1]) > 7.5 * this.range.pull ? this.travelPace() : near;
    }

    // ── What it sets out to do ──

    /** Nose to the snow, to and fro across its way to a place, and it stops to listen there. */
    planForage(tip, cone) {
        const E = this.errandTable.forage;
        const goal = this.spot(tip, E.far[0], E.far[1], {
            open: true, side: this.keepSide(), cone, room: HUNT_ROOM,
        });
        if (!goal) return false;
        const k = this.range.pull;
        const dx = goal[0] - tip[0];
        const dz = goal[1] - tip[1];
        const dist = Math.hypot(dx, dz);
        const legs = Math.max(1, Math.round(dist / (lerp(E.leg[0], E.leg[1], this.roamRand()) * k)));
        const nx = dz / dist;
        const nz = -dx / dist;
        let sway = this.roamRand() < 0.5 ? 1 : -1;
        for (let i = 1; i < legs; i++) {
            const off = sway * lerp(E.cast[0], E.cast[1], this.roamRand()) * k;
            sway = -sway;
            let px = tip[0] + dx * (i / legs) + nx * off;
            let pz = tip[1] + dz * (i / legs) + nz * off;
            if (!this.range.inside(px, pz, 0.4)) {
                px = tip[0] + dx * (i / legs);
                pz = tip[1] + dz * (i / legs);
            }
            this.steps.push({ target: [px, pz], pace: 'walk', style: 'cast' });
        }
        this.steps.push({
            target: goal, pace: 'walk', style: 'cast', stop: 'scent',
        });
        return true;
    }

    /** It heard something further off: it goes near, creeps the last of the way and leaps on it. */
    planHunt(tip, cone) {
        const E = this.errandTable.hunt;
        const goal = this.spot(tip, E.far[0], E.far[1], {
            open: true, side: this.keepSide(), cone, room: HUNT_ROOM,
        });
        if (!goal) return false;
        this.stalk(tip, goal, this.tripPace(tip, goal, this.roamRand() < 0.25 ? 'bound' : 'trot'));
        return true;
    }

    /** Go near a place at a pace, creep the last of the way, and hunt there. */
    stalk(tip, goal, pace) {
        const creep = this.errandTable.hunt?.creep ?? 2.4;
        const k = this.range.pull;
        const dx = goal[0] - tip[0];
        const dz = goal[1] - tip[1];
        const dist = Math.hypot(dx, dz);
        if (dist > (creep + 1) * k) {
            const back = (creep * k) / dist;
            this.steps.push({ target: [goal[0] - dx * back, goal[1] - dz * back], pace });
        }
        this.steps.push({ target: goal, pace: 'walk', stop: 'hunt' });
    }

    /** Over to the other side of the board, a little out of its way, at a travelling pace. */
    planCross(tip) {
        const side = -(Math.sign(this.range.fraction(tip[0], tip[1])) || this.side);
        const goal = this.spotOn(side);
        if (!goal) return false;
        const pace = this.travelPace();
        const k = this.range.pull;
        const mx = (tip[0] + goal[0]) / 2;
        const mz = (tip[1] + goal[1]) / 2;
        const off = (this.roamRand() * 2 - 1) * 2.4 * k;
        const len = Math.hypot(goal[0] - tip[0], goal[1] - tip[1]) || 1;
        const bend = [mx + ((goal[1] - tip[1]) / len) * off, mz - ((goal[0] - tip[0]) / len) * off];
        if (this.range.inside(bend[0], bend[1], 0.5)) this.steps.push({ target: bend, pace });
        const through = this.roamRand() < this.followOdds('through');
        this.steps.push({ target: goal, pace, stop: through ? null : 'alert' });
        return true;
    }

    /** Up to where it sees furthest, near enough, to sit and watch. */
    planLookout(tip, cone) {
        let best = null;
        let score = -Infinity;
        for (let i = 0; i < 8; i++) {
            const p = this.spot(tip, 3, 13, { open: true, cone: i < 4 ? cone : null });
            if (!p) continue;
            // (High ground, further out over the snowfield, and not far to go.)
            const s = groundHeight(p[0], p[1]) + 0.06 * Math.hypot(p[0], p[1])
                - 0.03 * Math.hypot(p[0] - tip[0], p[1] - tip[1]);
            if (s > score) {
                score = s;
                best = p;
            }
        }
        if (!best) return false;
        const pace = this.tripPace(tip, best, this.roamRand() < 0.3 ? 'walk' : 'trot');
        this.steps.push({ target: best, pace, stop: 'sky' });
        return true;
    }

    /** A few steps to a place on the open snow (trotting if it is further), and it stops there for something. */
    planNear(tip, cone, [lo, hi], pace, stop) {
        const goal = this.spot(tip, lo, hi, { open: true, cone }) || this.spot(tip, lo, hi * 2.5, { open: true });
        if (!goal) return false;
        const far = Math.hypot(goal[0] - tip[0], goal[1] - tip[1]) > 2.6 * this.range.pull;
        this.steps.push({ target: goal, pace: far && pace === 'walk' ? 'trot' : pace, stop });
        return true;
    }

    /** To a roomy place on the open snow, to bow there — and tear about. */
    planPlay(tip, cone) {
        const { range } = this;
        let goal = null;
        for (let i = 0; i < 6 && !goal; i++) {
            const p = this.spot(tip, 1.5, 6, { open: true, cone: i < 3 ? cone : null });
            if (p && range.inside(p[0], p[1], 1.2) && range.clearance(p[0], p[1]) > this.layout.treeRoom + 1) goal = p;
        }
        if (!goal) return false;
        this.steps.push({ target: goal, pace: 'trot', stop: 'play' });
        return true;
    }

    /** Over toward what it has noticed, to a place on the open snow where it sees it, to watch it. */
    planWatch(tip, time) {
        const { interest } = this;
        if (!interest) return false;
        const keep = (interest.kind === 'fox' ? 5 : 0) * this.range.pull;
        let best = null;
        let score = Infinity;
        for (let i = 0; i < 10; i++) {
            const p = this.spot(tip, 2, 16, { open: true });
            if (!p) continue;
            const d = Math.hypot(p[0] - interest.x, p[1] - interest.z);
            const s = Math.abs(d - keep) + (d < keep ? 10 : 0);
            if (s < score) {
                score = s;
                best = p;
            }
        }
        if (!best) return false;
        this.watching = { ...interest, until: time + 60 };
        this.steps.push({ target: best, pace: this.tripPace(tip, best, 'trot'), stop: 'watch' });
        return true;
    }

    /** Nowhere it meant to go could be had: a little way on, and a look about. */
    planWander(tip, cone) {
        const goal = this.spot(tip, 2, 7, { cone }) || this.range.centre;
        this.steps.push({ target: goal, pace: 'trot', stop: this.openAt(goal[0], goal[1]) ? 'alert' : null });
        return true;
    }

    /** At a run it goes nowhere in particular: it races about its snow (runOn). */
    planRun() {
        this.steps.push({ run: true, pace: 'trot' });
    }

    /**
     * At a run: wide sweeps over its snow, swerving as it likes. It looks a turn ahead of itself and
     * swings away from the frame's edge, the band's and the trees before it reaches them, toward
     * whichever side has room — so it never runs at them, and never round a ring. On an upright
     * screen its snow is drawn smaller, and it turns as much tighter.
     */
    runOn(tip, length = 8) {
        const { range } = this;
        const style = FOX_STEER.run;
        const most = style.turn / range.pull;
        const escape = FOX_STEER.trot.turn / range.pull;
        const far = 1.6 / most + 1;
        const near = 2 / escape + 0.8;
        const p1 = this.roamRand() * TAU;
        const p2 = this.roamRand() * TAU;
        // (At a run it keeps further in from the frame's edge, where the tall trees stand.)
        const edge = range.edge - 0.08;
        const bad = (x, z) => range.outside(x, z) + (range.inside(x, z, 0.8) ? 0 : 0.4)
            + 10 * Math.max(0, Math.abs(range.fraction(x, z)) - edge);
        let [x, z, h] = tip;
        /** How much of a ray `a` off its heading, `look` metres long, leaves its snow. */
        const ray = (a, look) => bad(x + Math.sin(h + a) * look * 0.45, z + Math.cos(h + a) * look * 0.45) * 2
            + bad(x + Math.sin(h + a) * look * 0.75, z + Math.cos(h + a) * look * 0.75)
            + bad(x + Math.sin(h + a) * look, z + Math.cos(h + a) * look) * 0.6;
        /**
         * The open way nearest the way it is going — and, swinging away from something, it keeps
         * swinging the way it began (it does not dither between two ways into a corner), leaning
         * toward the open middle of its snow.
         */
        const openWay = (look) => {
            const middle = Math.atan2(range.centre[0] - x, range.centre[1] - z) - h;
            let best = 0;
            let score = Infinity;
            for (let i = 0; i < RUN_RAYS.length; i++) {
                const a = RUN_RAYS[i];
                const sc = ray(a, look) * 10 + Math.abs(a) * 0.3 + Math.abs(wrap(middle - a)) * 0.08
                    + (this.runSwing && a * this.runSwing < 0 ? 1.5 : 0);
                if (sc < score) {
                    score = sc;
                    best = a;
                }
            }
            if (best) this.runSwing = Math.sign(best);
            return best;
        };
        const out = [];
        for (let u = SAMPLE; u <= length + 1e-9; u += SAMPLE) {
            // It makes for somewhere across its snow, and somewhere else once it is near it (or
            // has gone a while): so it cuts across the middle and back, never round the edge.
            this.runFor -= SAMPLE;
            const reached = this.runGoal && Math.hypot(this.runGoal[0] - x, this.runGoal[1] - z) < 2.5 * range.pull;
            if (!this.runGoal || this.runFor <= 0 || reached) {
                this.runGoal = this.spot([x, z, h], 5, 15, { margin: 1.2 }) || range.centre;
                this.runFor = lerp(7, 13, this.roamRand());
            }
            let rate = wrap(Math.atan2(this.runGoal[0] - x, this.runGoal[1] - z) - h) * style.gain
                + style.waver * (0.6 * Math.sin(u / 3.1 + p1) + 0.4 * Math.sin(u / 1.3 + p2));
            let turn = most;
            // Something close ahead — a tree on its line, the edge of its snow — it swings hard for
            // the open way (and slows for it: cornerSpeed). Further off: gently.
            if (this.treeAhead(x, z, h, near + 1) || ray(0, near) > 0) {
                rate = openWay(near) * 4;
                turn = escape;
            } else if (ray(0, far) > 0) rate = openWay(far) * 3;
            else this.runSwing = 0;
            // (A tree close beside it, or the edge pressing, it swings off as hard as it must, and
            // makes for nothing else until it is clear.)
            const push = range.steer(x, z, h);
            if (Math.abs(push) > most) {
                turn = escape;
                if (rate * push < 0) rate = 0;
            }
            rate = clamp(rate + push, -turn, turn);
            h = wrap(h + rate * SAMPLE);
            x += Math.sin(h) * SAMPLE;
            z += Math.cos(h) * SAMPLE;
            out.push(x, z, h);
        }
        return out;
    }

    /**
     * A tree on its line within `reach` metres, nearer its line than it keeps from one: which side of
     * its line it stands (+ the side it would turn toward by turning left), or 0.
     */
    treeAhead(x, z, h, reach) {
        const { trees } = this.range;
        const room = this.layout.treeRoom;
        const sin = Math.sin(h);
        const cos = Math.cos(h);
        let side = 0;
        let nearest = Infinity;
        for (let i = 0; i < trees.length; i++) {
            const dx = trees[i][0] - x;
            const dz = trees[i][1] - z;
            const along = dx * sin + dz * cos;
            const across = dx * cos - dz * sin;
            if (along > -0.3 && along < reach && Math.abs(across) < room && along < nearest) {
                nearest = along;
                side = across >= 0 ? 1 : -1;
            }
        }
        return side;
    }

    /**
     * How fast it can take its way just ahead (m/s): a fox slows to turn tight, and leans into what
     * it can take at speed.
     */
    cornerSpeed() {
        const ahead = Math.max(2, this.speed * 0.7);
        let bend = 0;
        let last = this.trail.at(this.s, this._here)[2];
        for (let d = 0.3; d <= ahead + 1e-9; d += 0.3) {
            const h = this.trail.at(this.s + d, this._here)[2];
            bend = Math.max(bend, Math.abs(wrap(h - last)) / 0.3);
            last = h;
        }
        return Math.sqrt(CORNER_GRIP / Math.max(bend, 1e-3));
    }

    /** It heard something a step or two on: it creeps there and hunts. */
    planHuntNear(tip) {
        // (Only where it is seen: with no room for it there, it goes on to something else.)
        const goal = this.spot(tip, 1.4, 3.5, { open: true, cone: [tip[2], 0.8], room: HUNT_ROOM })
            || this.spot(tip, 1.4, 3.5, { open: true, cone: [tip[2], 1.4], room: HUNT_ROOM });
        if (!goal) return false;
        this.steps.push({ target: goal, pace: 'walk', stop: 'hunt' });
        return true;
    }

    /** It carries off what it caught, and digs it in a little way off (on the way it leapt, after a leap). */
    planCache(tip, onward = false) {
        const goal = this.spot(tip, 2.5, 6, { open: true, cone: onward ? [tip[2], 0.7] : null });
        if (!goal) return false;
        this.steps.push({ target: goal, pace: 'trot', stop: 'cache' });
        return true;
    }

    /** Back the way it came. */
    planBack(tip) {
        const back = tip[2] + Math.PI;
        const goal = this.spot(tip, 4, 9, { cone: [back, 0.5], strict: true })
            || this.spot(tip, 3, 9, { cone: [back, 1.2], strict: true })
            || this.spot(tip, 2, 9, { cone: [back, 1.6], strict: true, margin: 0.2 });
        if (!goal) return false;
        this.steps.push({ target: goal, pace: 'trot', stop: this.roamRand() < 0.5 ? 'alert' : null });
        return true;
    }

    /** Odds of what follows what (a theme's fox may change them). */
    followOdds(name) {
        return FOX_FOLLOW[name];
    }

    // ── Laying its way ──

    /**
     * Steer from `from` (x, z, heading) toward a place, at a pace's way of turning: a flat list of
     * samples, or null where it cannot get there on its snow (it would go round and round, or off it).
     */
    steerTo(from, goal, style, free = false, check = true) {
        const { range } = this;
        let [x, z, h] = from;
        const [gx, gz] = goal;
        const most = Math.hypot(gx - x, gz - z) * 2.4 + 8;
        const p1 = this.roamRand() * TAU;
        const p2 = this.roamRand() * TAU;
        // (From wherever it is it may go no nearer a tree than it is, and no further astray.)
        const crowded = range.crowded(x, z) + 0.05;
        const astray = range.astray(x, z, free) + 0.05;
        const out = [];
        let turned = 0;
        let closest = Infinity;
        for (let u = 0; u < most; u += SAMPLE) {
            const dx = gx - x;
            const dz = gz - z;
            const dist = Math.hypot(dx, dz);
            const err = wrap(Math.atan2(dx, dz) - h);
            // (There, or it has come close by it and is going past: it does not go round again for
            // the last step.)
            if (dist < ARRIVE || (dist < 0.8 * range.pull && dist > closest + 0.05 && Math.abs(err) > 1.7)) return out;
            closest = Math.min(closest, dist);
            const waver = style.waver * (0.62 * Math.sin(u / 2.3 + p1) + 0.38 * Math.sin(u / 0.95 + p2));
            let rate = err * style.gain + waver * smooth(0.4, 2.5, dist) + range.steer(x, z, h, free);
            rate = clamp(rate, -style.turn, style.turn);
            // (Never round in a ring: a place it could only circle is no place to go.)
            turned += rate * SAMPLE;
            if (Math.abs(turned) > 1.6 * Math.PI) return null;
            h = wrap(h + rate * SAMPLE);
            x += Math.sin(h) * SAMPLE;
            z += Math.cos(h) * SAMPLE;
            if (check && (range.crowded(x, z) > crowded || range.astray(x, z, free) > astray)) return null;
            out.push(x, z, h);
        }
        return null;
    }

    /**
     * A place too near beside it to steer to straight (inside its turn): it bears off first, a few
     * metres away from that side, and comes round to it.
     */
    detour(tip, goal, style, free = false) {
        const [x, z, h] = tip;
        const side = wrap(Math.atan2(goal[0] - x, goal[1] - z) - h) >= 0 ? 1 : -1;
        const k = this.range.pull;
        for (const [bear, far] of [[-0.7, 2.6], [-0.2, 3.4], [0.4, 3], [-1.2, 2.2]]) {
            const a = h + side * bear;
            const via = [x + Math.sin(a) * far * k, z + Math.cos(a) * far * k];
            if (!this.range.inside(via[0], via[1], 0.3, free)) continue;
            const first = this.steerTo(tip, via, style, free);
            if (!first || first.length < 3) continue;
            const n = first.length;
            const then = this.steerTo([first[n - 3], first[n - 2], first[n - 1]], goal, style, free);
            if (then) return first.concat(then);
        }
        return null;
    }

    /** Lay the next stretch of what it means to do. */
    layNext() {
        const step = this.steps.shift();
        const tip = this.trail.tip(this._tip);
        if (step.run || step.points) {
            // (At a run it races about; a way already found is laid as it was found.)
            const from = this.trail.end;
            this.trail.extend(step.points ?? this.runOn(tip));
            this.legs.push({ from, pace: step.pace });
            return;
        }
        let style = FOX_STEER[step.style ?? step.pace] ?? FOX_STEER.trot;
        // (Held to a pace, it turns no tighter than that pace turns.)
        const held = step.style !== 'romp' && this.heldPace ? FOX_STEER[this.heldPace] : null;
        if (held && held.turn < style.turn) style = held;
        let points = null;
        // (Somewhere else that would do as well, if it can be had: a few tries.)
        for (let i = 0; i < (step.pick ? 8 : 1) && !points; i++) {
            if (step.pick && (i > 0 || !step.target)) step.target = step.pick(tip);
            if (step.target) points = this.steerTo(tip, step.target, style, step.free);
            if (points && step.accept && !step.accept(points)) points = null;
        }
        if (!points && step.target) {
            // (Tighter than its pace turns if it must, no tighter than a trot at a run; round about.)
            const tighter = this.roamRunning ? [FOX_STEER.trot] : [FOX_STEER.trot, FOX_STEER.walk];
            for (let i = 0; i < tighter.length && !points; i++) {
                if (tighter[i].turn > style.turn) points = this.steerTo(tip, step.target, tighter[i], step.free);
            }
            if (!this.roamRunning) points ||= this.detour(tip, step.target, FOX_STEER.walk, step.free);
        }
        let { stop } = step;
        if (!points) {
            // No way there on its snow.
            this.misses += 1;
            if (step.drift) {
                // (Beyond a stop it always lays something, should it run on through: in toward the middle.)
                points = this.swing(tip, FOX_STEER.walk);
            } else if (this.steps.length || this.stopAt !== null) {
                // (A stretch on the way somewhere: on to the next. Beyond a stop: it means to stop there.)
                return;
            } else if (this.roamRunning) {
                // (At a run it swings in off the trees.)
                const { centre } = this.range;
                points = this.steerTo(tip, centre, FOX_STEER.trot) || this.detour(tip, centre, FOX_STEER.trot)
                    || this.swing(tip, FOX_STEER.walk);
            } else if (this.range.astray(tip[0], tip[1]) < 0.3) {
                // (Hemmed in: it pulls up where it is and looks about, and then turns where it stands.)
                points = this.stub(tip);
                stop = 'alert';
            } else {
                // (Out of its snow — the frame changed shape under it — it swings back in.)
                points = this.swing(tip, FOX_STEER.walk);
            }
        }
        const from = this.trail.end;
        this.trail.extend(points);
        this.legs.push({ from, pace: step.pace });
        if (stop && stop === step.stop && step.style !== 'romp' && !step.follow) {
            // (Where its way there ended short of the place, out of sight: it does not stop there,
            // but goes on and decides again.)
            const n = points.length;
            if (!this.openAt(points[n - 3], points[n - 2])) stop = null;
        }
        if (stop) {
            this.stopAt = this.trail.end;
            this.arrival = step;
            if (this.zooming && step.style === 'romp') this.zooming.end = this.trail.end;
        }
    }

    /** Hemmed in: straight on as far as it may, up to most of a metre (and no less than a stride). */
    stub(tip) {
        const [x, z, h] = tip;
        const worst = this.range.outside(x, z) + 0.05;
        const out = [];
        for (let u = SAMPLE; u <= 0.8 + 1e-9; u += SAMPLE) {
            const px = x + Math.sin(h) * u;
            const pz = z + Math.cos(h) * u;
            if (out.length >= 2 && this.range.outside(px, pz) > worst) break;
            out.push(px, pz, h);
        }
        return out;
    }

    /**
     * Last of all: up to three metres turning in toward the middle of its snow as tight as it turns,
     * and off the trees — no nearer one than it is (it stops short rather).
     */
    swing(tip, style) {
        let [x, z, h] = tip;
        const crowded = this.range.crowded(x, z) + 0.05;
        const out = [];
        for (let u = 0; u < 3; u += SAMPLE) {
            const want = wrap(Math.atan2(this.range.centre[0] - x, this.range.centre[1] - z) - h);
            const nh = wrap(h + clamp(want * style.gain + this.range.steer(x, z, h), -style.turn, style.turn) * SAMPLE);
            const nx = x + Math.sin(nh) * SAMPLE;
            const nz = z + Math.cos(nh) * SAMPLE;
            if (out.length >= 2 && this.range.crowded(nx, nz) > crowded) break;
            [x, z, h] = [nx, nz, nh];
            out.push(x, z, h);
        }
        return out;
    }

    /** Keep its way laid a little ahead of it (beyond a stop, only a little: it decides there). */
    ensureAhead(time) {
        const want = this.s + LOOK + LOOK_PER_SPEED * Math.max(0, this.speed);
        for (let guard = 0; guard < 16 && this.trail.end < want; guard++) {
            if (!this.steps.length) {
                if (this.stopAt !== null) {
                    // (One stretch beyond it at most, laid or not.)
                    if (this.trail.end >= this.stopAt + BEYOND || this.driftFor === this.stopAt) return;
                    this.driftFor = this.stopAt;
                    this.steps.push(this.driftStep());
                } else this.decide(time, true);
            }
            this.layNext();
        }
    }

    /** Beyond where it means to stop, its way goes gently on (should it not stop there after all). */
    driftStep() {
        const tip = this.trail.tip(this._tip);
        const pace = this.legs[this.legs.length - 1]?.pace ?? 'trot';
        return { target: this.spot(tip, 6, 9, { cone: [tip[2], 0.7] }) || this.range.centre, pace, drift: true };
    }

    /**
     * Cut its way where it is (or `lead` metres on, under way) and lay it anew from there. With
     * `turn` it turns on the spot first to where it now means to go.
     */
    reroute(time, { turn = false, lead = 0 } = {}) {
        const at = this.s + lead;
        this.trail.cut(at);
        while (this.legs.length > 1 && this.legs[this.legs.length - 1].from >= at) this.legs.pop();
        this.stopAt = null;
        this.arrival = null;
        if (turn && this.steps.length) {
            const tip = this.trail.tip(this._tip);
            const step = this.steps[0];
            if (step.target && Math.hypot(step.target[0] - tip[0], step.target[1] - tip[1]) > 0.3) {
                this.turnTo(tip, Math.atan2(step.target[0] - tip[0], step.target[1] - tip[1]), time);
            }
        }
        this.ensureAhead(time);
    }

    /**
     * Its way sets off from where it stands on another heading: it stands as it stood, so the turn is
     * what it has to step round — the short way to where it will face.
     */
    turnTo(tip, heading, time) {
        const turned = wrap(tip[2] - heading);
        this.trail.turnEnd(heading);
        let want = 0;
        if (this.mode === 'idle' && !this.act && !this.next?.some((name) => LEAPS.has(name))) {
            const toViewer = Math.atan2(this.course.viewer[0] - tip[0], this.course.viewer[1] - tip[1]);
            want = clamp(wrap(toViewer - heading) * 0.62, -1.05, 1.05);
        }
        let face = this.face + turned;
        if (face - want > Math.PI) face -= TAU;
        else if (face - want < -Math.PI) face += TAU;
        this.face = face;
        this._pathHeading = heading;
        this.turnSize = Math.abs(face - want);
        if (Math.abs(turned) > 1) this.turnedAt = time;
    }

    /**
     * How far it still has to turn where it stands: it pulls up first, and only then steps round —
     * a big turn no faster than a few steps carry it round, so its paws keep their hold.
     */
    toFace() {
        const want = super.toFace();
        if (!this.range || this.mode !== 'idle' || this.act) return want;
        if (this.speed >= 0.3) return 0;
        return clamp(want, -TURN_STEP, TURN_STEP);
    }

    /** The longest it takes to step round before it does what it stopped for (s): more for a bigger turn. */
    faceTime(time) {
        if (!this.range) return super.faceTime(time);
        return 2 + 1.1 * (this.turnSize ?? 0);
    }

    // ── Its stops ──

    toStation() {
        if (!this.range) return super.toStation();
        return this.stopAt === null ? Infinity : Math.max(0, this.stopAt - this.s);
    }

    passedStation(before, after) {
        if (!this.range) return super.passedStation(before, after);
        return this.stopAt !== null && before < this.stopAt && after >= this.stopAt;
    }

    /** It never puts off a stop it means to make. */
    restFor(time) {
        if (!this.range) return super.restFor(time);
        this.restlessNow(time);
        return 0;
    }

    /** What it does where it has stopped: what it stopped for, by its odds (and seldom what it has just done). */
    chooseStop() {
        if (!this.range) return super.chooseStop();
        this._arrived = this.arrival !== null && this.stopAt !== null && this.s >= this.stopAt - 0.6;
        if (this.forced) {
            const { forced } = this;
            this.forced = null;
            this.then = null;
            return forced;
        }
        const name = this._arrived ? this.arrival.stop : 'alert';
        const pick = this.pickStop(this.groups[name]?.length ? this.groups[name] : this.groups.alert);
        this.then = pick[2].then ?? null;
        return pick[0];
    }

    pickStop(group) {
        const lively = clamp(((this.restless ?? 0.45) - 0.45) / 0.45, -1, 1);
        const lead = this.recentStops[0]?.split('+')[0];
        const weights = group.map(([acts, odds, sways]) => {
            let w = odds * (1 + (sways.sky ?? 0) * this.sky + (sways.rest ?? 0) * this.tired);
            if (sways.lively) w *= 1 + 0.8 * sways.lively * lively;
            const seen = this.recentStops.indexOf(key(acts));
            if (seen >= 0) w *= SEEN_BEFORE[seen];
            else if (acts[0] === lead) w *= 0.35;
            return Math.max(1e-4, w);
        });
        let r = this.roamRand() * weights.reduce((sum, w) => sum + w, 0);
        let pick = group[group.length - 1];
        for (let i = 0; i < group.length; i++) {
            r -= weights[i];
            if (r <= 0) {
                pick = group[i];
                break;
            }
        }
        this.recentStops.unshift(key(pick[0]));
        this.recentStops.length = Math.min(this.recentStops.length, SEEN_BEFORE.length);
        return pick;
    }

    /** It has pulled up: what it did there tells it what next, and it turns to go there. */
    stopped(time) {
        if (!this.range) return;
        this.restlessNow(time);
        if (this.zooming) {
            // It skids to a stop out of its romp.
            this.endZoom();
            this.emit({ type: 'skid' });
        }
        const arrived = this._arrived;
        this._arrived = false;
        if (!arrived) return; // (Brought up short on its way: it goes on with it after.)
        const step = this.arrival;
        this.stopAt = null;
        this.arrival = null;
        this.visited.unshift([this.pose.x, this.pose.z]);
        this.visited.length = Math.min(this.visited.length, 6);
        if (step.stop === 'watch' && this.watching) {
            const w = this.watching;
            this.attend(w.x, groundHeight(w.x, w.z) + 0.6, w.z, time + 9, 0.9);
        }
        this.steps = [];
        // (What it decides is laid from where it stands: nothing it had laid beyond holds now.)
        this.trail.cut(this.s);
        // It turns where it stands to where it means to go next. A leap goes that way too (it heard
        // something there), so for a hunt it would rather go on than back.
        const leap = Boolean(this.next?.some((name) => LEAPS.has(name)));
        this.afterStop(step, time, leap);
        this.reroute(time, { turn: true });
    }

    /** What follows a stop: a hunt tried again, a catch dug in, a sound stalked — or something new. */
    afterStop(step, time, leap = false) {
        const tip = this.trail.tip(this._here);
        // A hunt's leap goes the way it goes on from there: across the viewer's sight, so the leap
        // is seen side on, not from behind.
        if (leap) tip[2] = this.acrossView(tip[0], tip[1], tip[2]);
        const did = this.next ? key(this.next) : '';
        const caught = did.includes('Dig') && (did.includes('Pounce') || did.includes('MouseLeap'));
        const missed = did.includes('MouseLeap') && did.includes('HeadTilt');
        if (step.stop === 'rest') this.weary = Math.max(0, this.weary - 0.6);
        if (caught) this.hunger = Math.max(0, this.hunger - 0.55);
        let planned = false;
        if (step.follow === 'back') planned = this.planBack(tip);
        else if (missed && this.roamRand() < this.followOdds('retry')) planned = this.planHuntNear(tip);
        else if (caught && this.roamRand() < this.followOdds('cache')) planned = this.planCache(tip, leap);
        else if (step.stop === 'scent' && did.startsWith('Listen') && !caught && !missed
            && this.roamRand() < this.followOdds('heard')) planned = this.planHuntNear(tip);
        if (planned) {
            this.errand = step.follow === 'back' ? 'back' : 'hunt';
            this.recentErrands.unshift(this.errand);
            this.recentErrands.length = Math.min(this.recentErrands.length, 4);
        } else this.decide(time, leap, leap ? tip[2] : null);
        if (leap) {
            // (Its leap carries it a little way along that line first; from there it goes on. A leap
            // is as long on any screen: the fox is drawn no smaller.)
            const reach = LEAP_ROOM;
            const along = [tip[0] + Math.sin(tip[2]) * reach, tip[1] + Math.cos(tip[2]) * reach];
            this.steps.unshift({ target: along, pace: 'walk' });
        }
    }

    /**
     * A heading across the viewer's line of sight at (x, z) — of the two, the one nearer `h` — with
     * room for a leap ahead on its snow (else `h`).
     */
    acrossView(x, z, h) {
        const toEye = Math.atan2(this.course.viewer[0] - x, this.course.viewer[1] - z);
        const a = wrap(toEye + Math.PI / 2);
        const b = wrap(toEye - Math.PI / 2);
        const ways = Math.abs(wrap(a - h)) <= Math.abs(wrap(b - h)) ? [a, b] : [b, a];
        // (Room for its leap and the step after it, inside its snow.)
        const reach = LEAP_ROOM + 0.4;
        for (let i = 0; i < 2; i++) {
            if (this.range.inside(x + Math.sin(ways[i]) * reach, z + Math.cos(ways[i]) * reach, 0.3)) return ways[i];
        }
        // (No room across it: toward the open middle of its snow.)
        return Math.atan2(this.range.centre[0] - x, this.range.centre[1] - z);
    }

    /** It has done what it stopped for: on its way (or first, a romp). */
    onward(time) {
        if (!this.range) return;
        const { then } = this;
        this.then = null;
        if (then === 'zoom') this.zoom(time);
        this.choosePace(time);
        // (Standing, no step shows which pace it is in: it sets off in the new one from its first.)
        if (this.speed < 0.05) this.pose.pace.walk = this.going === 'walk' ? 1 : 0;
    }

    /** Its pace is the stretch of way it is on (or the one it is held to). */
    choosePace() {
        if (!this.range) return;
        if (this.heldPace) {
            this.going = this.heldPace;
        } else {
            let pace = this.legs[0]?.pace ?? 'trot';
            for (let i = 0; i < this.legs.length && this.legs[i].from <= this.s + 1e-6; i++) ({ pace } = this.legs[i]);
            this.going = pace;
        }
        this.goingUntil = Infinity;
    }

    /** Pull up just ahead, look about, and go back the way it came (captures, the visitor). */
    turnHere(time) {
        if (!this.range || this.mode !== 'gait') return false;
        this.nextStop = time;
        const ahead = Math.max(0.6, (this.speed * this.speed) / (2 * this.paces.brake) + 0.2);
        this.steps = [{
            target: this.trail.at(this.s + ahead + 0.4, [0, 0, 0]), pace: this.going, stop: 'alert', follow: 'back',
        }];
        if (this.zooming) {
            this.endZoom();
            this.forced = null;
        }
        this.reroute(time, { lead: Math.min(ahead, 0.3) });
        return true;
    }

    /** It bows and tears about: a few quick dashes this way and that, and it skids to a stop. */
    zoom(time) {
        if (!this.range) return false;
        const { range } = this;
        const here = this.trail.at(this.s, [0, 0, 0]);
        let h = here[2] + this.face;
        let at = [here[0], here[1]];
        const legs = FOX_ROMP.legs[0] + Math.floor(this.roamRand() * (FOX_ROMP.legs[1] - FOX_ROMP.legs[0] + 1));
        const steps = [];
        /** Which way it swerved last: it swerves back the other way more often than not (no ring). */
        let swerved = this.roamRand() < 0.5 ? -1 : 1;
        for (let i = 0; i < legs; i++) {
            let next = null;
            const last = i === legs - 1;
            for (let tries = 0; tries < (last ? 40 : 24) && !next; tries++) {
                // (The first way out of its bow is any; after that it swerves, back the other way
                // more often than not.)
                const way = this.roamRand() < 0.75 ? -swerved : swerved;
                const swerve = i === 0 ? (this.roamRand() * 2 - 1) * Math.PI : way * lerp(0.5, 1.7, this.roamRand());
                const a = h + swerve;
                const d = lerp(FOX_ROMP.reach[0], FOX_ROMP.reach[1], this.roamRand()) * range.pull;
                const p = [at[0] + Math.sin(a) * d, at[1] + Math.cos(a) * d];
                if (range.inside(p[0], p[1], 0.9) && range.clearance(p[0], p[1]) > this.layout.treeRoom
                    && (!last || this.openAt(p[0], p[1]))) {
                    next = p;
                    h = a;
                    if (i > 0) swerved = Math.sign(swerve);
                }
            }
            if (!next) break;
            steps.push({ target: next, pace: 'trot', style: 'romp' });
            at = next;
        }
        // (It skids to a stop where it is seen: on the open snow beside the board — one more dash
        // there if its last did not end there.)
        if (steps.length && !this.openAt(...steps[steps.length - 1].target)) {
            const end = steps[steps.length - 1].target;
            const out = this.spot([end[0], end[1], h], 1.8, 6, { open: true, cone: [h, 1.9] });
            if (out) steps.push({ target: out, pace: 'trot', style: 'romp' });
        }
        while (steps.length && !this.openAt(...steps[steps.length - 1].target)) steps.pop();
        if (steps.length < 2) return false;
        steps[steps.length - 1].stop = 'skid';
        this.steps = steps;
        this.zooming = { end: Infinity };
        this.paces.brake = ZOOM.brake;
        this.nextStop = time;
        this.forced = AFTER_ZOOM[Math.floor(this.roamRand() * AFTER_ZOOM.length) % AFTER_ZOOM.length];
        this.errand = 'romp';
        this.reroute(time, { turn: true });
        return true;
    }

    // ── A step ──

    step(dt, time, env) {
        if (this.range && dt > 0) this.live(dt, time, env);
        super.step(dt, time, env);
        if (this.range && this.s > this.trail.end) {
            // (A leap never carries it past the end of its way: it comes down there.)
            this.s = this.trail.end;
            this.resolve(time);
        }
    }

    /** Its needs drift, a run takes it over, a stop it ran past is let go, and its way is kept laid. */
    live(dt, time, env) {
        this.now = time;
        const power = env?.power ?? 0;
        const running = power > 0.1 || this.dash > 0.25;
        this.hunger = Math.min(1, this.hunger + dt / 260);
        this.weary = Math.min(1, this.weary + dt / 520);
        if (running !== this.roamRunning) {
            this.roamRunning = running;
            this.runGoal = null;
            this.steps = [];
            if (this.zooming) {
                this.endZoom();
                this.forced = null;
            }
            if (running && Math.abs(this.face) > 0.5) {
                // It sets off the way it faces.
                const here = this.trail.at(this.s, this._here);
                this.trail.cut(this.s);
                this.trail.turnEnd(wrap(here[2] + this.face));
                this._pathHeading = wrap(here[2] + this.face);
                this.face = 0;
                this.stopAt = null;
                this.arrival = null;
                this.ensureAhead(time);
            } else this.reroute(time, { lead: Math.min(0.6, Math.max(0, this.trail.end - this.s)) });
        }
        if (this.stopAt !== null && this.mode === 'gait' && this.s > this.stopAt + 0.3) {
            // (It ran on past where it meant to stop: that is let go.)
            this.stopAt = null;
            this.arrival = null;
        }
        if (this.zooming && this.mode !== 'gait') this.forced = null;
        this.ensureAhead(time);
        this.trail.forget(this.s - 30);
        while (this.legs.length > 1 && this.legs[1].from <= this.s - 1) this.legs.shift();
        if (!this.heldPace && !running && !this.zooming) this.choosePace(time);
    }
}
