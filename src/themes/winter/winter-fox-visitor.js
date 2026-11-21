/**
 * Winter — the visitor: a second arctic fox, of the other coat, with its own mind and seed.
 * Three-free and renderer-free.
 *
 * It is the same animal as the game's fox (winter-fox-life.js is the life they share) and roams
 * as it does (winter-fox-roam.js), at the back of the snowfield, between the fox's snow and the
 * small trees by the shore. Now and then it comes: in from beyond one side of the frame, it works
 * the back of the snowfield a while — casts about, hunts, crosses, sits and looks — and then
 * leaves, by the far side or back the way it came, and is away a while. So over a night one sees
 * one fox, then two, then one, and never the visitor twice by the same way. It keeps off the fox:
 * with the fox in its way it pulls up short, makes a stop of the wait, and turns back if it is
 * kept waiting.
 */

import { VISITOR_RIG } from './winter-fox-rig.js';
import {
    FOX_ERRANDS, FOX_STEER, RoamingFoxMind, snowRange, stopGroups,
} from './winter-fox-roam.js';
import { FOX_TROT, FOX_WANDER_STOPS } from './winter-fox-life.js';

const lerp = (a, b, t) => a + (b - a) * t;

/** The snow it roams: the back of the snowfield, inland of the shore (laid out alike on every screen). */
export const VISITOR_RANGE = Object.freeze({
    near: 18.5,
    far: 25,
    edge: 0.9,
    /** (Far out, a place shows where its fraction says on any screen.) */
    narrow: 0,
    treeRoom: 2.2,
    treeMost: 1.4,
    open: Object.freeze([0.3, 0.9]),
    shore: 3.5,
    pull: false,
});

/** What it sets out to do there: the fox's errands, less of them, and no romp (the trees stand close). */
export const VISITOR_ERRANDS = Object.freeze({
    forage: Object.freeze({ ...FOX_ERRANDS.forage, odds: 0.8 }),
    hunt: Object.freeze({ ...FOX_ERRANDS.hunt, odds: 0.45 }),
    cross: Object.freeze({ odds: 0.75, stay: 0.4 }),
    lookout: Object.freeze({ odds: 0.3, sky: 3 }),
    rest: Object.freeze({ odds: 0.1, tired: 2, weary: 1 }),
    groom: Object.freeze({ odds: 0.25 }),
});

/** Seconds it stays before it moves on (shortest, longest), and seconds it is away (shortest, longest). */
export const VISITOR_STAY = Object.freeze([18, 70]);
export const VISITOR_AWAY = Object.freeze([15, 90]);

/** Where it waits while it is away: behind the viewer, where nobody sees it. */
const AWAY_AT = Object.freeze([0, 8]);

/**
 * How the visitor keeps off the fox: how wide a way it wants clear ahead of it (m either side),
 * how far short of the fox it stops (m), how long it waits there before it turns back (s), and
 * what it does when it has pulled up before the fox (one of these, turn about).
 */
export const VISITOR_MEET = Object.freeze({
    wide: 1.7,
    room: 2.8,
    wait: 9,
    stops: Object.freeze([Object.freeze(['PlayBow']), Object.freeze(['Sit']), Object.freeze(['LookAround'])]),
});

/** What the visitor does when it stops: the fox's stops without those that need room or go far. */
export const VISITOR_STOPS = Object.freeze(FOX_WANDER_STOPS.filter(([acts, , sways]) => sways.then !== 'zoom'
    && !acts.includes('Pounce')));
const VISITOR_GROUPS = stopGroups(FOX_WANDER_STOPS, (stop) => VISITOR_STOPS.includes(stop));

/**
 * The visitor: a second arctic fox with its own mind and seed, roaming the back of the snowfield
 * now and then. `present` says whether it is anywhere it could be seen.
 */
export class VisitorMind extends RoamingFoxMind {
    /**
     * @param {number} [aspect]
     * @param {number} [seed]
     */
    constructor(aspect = 16 / 9, seed = 0xb1ce) {
        super({
            aspect,
            seed,
            rig: VISITOR_RIG,
            // (Its prints would take the fox's from the snow: the visitor leaves none.)
            paces: { pawPrints: 0, room: VISITOR_MEET.room },
            range: VISITOR_RANGE,
            errands: VISITOR_ERRANDS,
            groups: VISITOR_GROUPS,
        });
    }

    reset(time = 0) {
        /** Until when it is away, and whether it is; whether it is on its way out, and until when it stays. */
        this.awayUntil = time;
        this.away = false;
        this.leaving = false;
        this.leftAt = time;
        this.stayUntil = Infinity;
        /** Since when the fox has been in its way, how many times it has met it, and until when it pays it no mind. */
        this.blockedSince = null;
        this.meetings = 0;
        this.heedFrom = time;
        super.reset(time);
        // It begins away, and is a while coming.
        if (this.range) this.goAway(time, this.firstAway);
    }

    /** Seconds after a reset before it sets out. */
    get firstAway() {
        return this._firstAway ?? 6;
    }

    set firstAway(seconds) {
        this._firstAway = Math.max(0, seconds);
    }

    /** Whether it is anywhere it could be seen: ahead of the viewer, not far outside the frame. */
    get present() {
        const { x, z } = this.pose;
        if (!(z < -3)) return false;
        return Math.abs(this.range.fraction(x, z)) < 1.45;
    }

    /** It is gone: out of sight, it waits behind the viewer until it comes again. */
    goAway(time, seconds) {
        this.away = true;
        this.leaving = false;
        this.awayUntil = time + seconds;
        this.trail.start(AWAY_AT[0], AWAY_AT[1], 0, this.s);
        this.legs = [{ from: this.s, pace: 'trot' }];
        this.steps = [];
        this.stopAt = null;
        this.arrival = null;
        this.speed = 0;
        this.face = 0;
        this.mode = 'gait';
        this.act = null;
        this.next = null;
        this._pathHeading = 0;
        this._planted.fill(0);
        this.events.length = 0;
        this.resolve(time);
    }

    /** A place out of sight beyond one side of the frame, on the snow and clear of the trees. */
    beyond(side) {
        const { range } = this;
        for (let tries = 0; tries < 40; tries++) {
            const f = side * lerp(1.3, 1.6, this.roamRand());
            const [x, z] = range.place(f, lerp(range.near + 0.5, range.far - 0.5, this.roamRand()));
            if (range.outside(x, z, true) === 0 && range.clearance(x, z) >= VISITOR_RANGE.treeRoom) return [x, z];
        }
        return range.place(side * 1.4, (range.near + range.far) / 2);
    }

    /**
     * It comes: in from beyond one side of the frame, between the trees, to somewhere on the open
     * snow on that side (or, with no way in there, on the other).
     */
    setOut(time, wanted) {
        this.away = false;
        this.leaving = false;
        let side = wanted;
        let entry = null;
        let goal = null;
        let way = null;
        for (let tries = 0; tries < 10 && !way; tries++) {
            const from = tries < 6 ? wanted : -wanted;
            entry = this.beyond(from);
            goal = this.spotOn(from);
            if (!goal) continue;
            const facing = Math.atan2(goal[0] - entry[0], goal[1] - entry[1]);
            way = this.steerTo([entry[0], entry[1], facing], goal, FOX_STEER.trot, true);
            if (way) side = from;
        }
        goal ??= this.range.place(side * 0.6, (this.range.near + this.range.far) / 2);
        const h = Math.atan2(goal[0] - entry[0], goal[1] - entry[1]);
        this.trail.start(entry[0], entry[1], h, this.s);
        this.legs = [{ from: this.s, pace: 'trot' }];
        this.steps = [];
        this.stopAt = null;
        this.arrival = null;
        const stop = this.roamRand() < 0.5 ? 'alert' : null;
        if (way) {
            this.trail.extend(way);
            if (stop) {
                this.stopAt = this.trail.end;
                this.arrival = { target: goal, pace: 'trot', stop };
            }
        } else {
            this.steps.push({
                target: goal, pace: 'trot', free: true, stop,
            });
        }
        this.speed = FOX_TROT;
        this.face = 0;
        this.mode = 'gait';
        this._pathHeading = h;
        this._planted.fill(0);
        this.nextStop = time;
        this.side = side;
        this.sideRun = 0;
        this.stayUntil = time + lerp(VISITOR_STAY[0], VISITOR_STAY[1], this.roamRand());
        this.errand = 'arrive';
        this.ensureAhead(time);
        this.resolve(time);
    }

    /**
     * It moves on: out beyond one side of the frame, between the trees, on past where it came in
     * more often than not. Only by a way it can be seen to take all the way out: with none on either
     * side from here, it stays a while longer (false).
     */
    planLeave(tip, by = 0, standing = false) {
        const { range } = this;
        const here = Math.sign(range.fraction(tip[0], tip[1])) || 1;
        const first = by || (this.roamRand() < 0.55 ? -this.side || -here : here);
        const pace = this.roamRand() < 0.7 ? 'trot' : 'lope';
        for (let tries = 0; tries < 12; tries++) {
            const side = tries < 7 ? first : -first;
            const exit = this.beyond(side);
            // (Standing, it turns where it stands to face its way out first.)
            const from = standing ? [tip[0], tip[1], Math.atan2(exit[0] - tip[0], exit[1] - tip[1])] : tip;
            const way = this.steerTo(from, exit, FOX_STEER[pace], true)
                || this.steerTo(from, exit, FOX_STEER.trot, true);
            if (!way) continue;
            const n = way.length;
            const out = range.place(side * 2.4, Math.hypot(exit[0], exit[1]));
            const on = this.steerTo([way[n - 3], way[n - 2], way[n - 1]], out, FOX_STEER.trot, true);
            if (!on) continue;
            this.steps.push({ points: way.concat(on), pace, target: standing ? exit : undefined });
            this.leaving = true;
            this.leftAt = this.now;
            this.errand = 'leave';
            return true;
        }
        return false;
    }

    /** Back the way it came — and with no room for that on its snow, out of the frame the way it came. */
    planBack(tip) {
        if (super.planBack(tip)) return true;
        const behind = Math.sign(Math.sin(tip[2] + Math.PI)) || -1;
        return this.planLeave(tip, behind, true);
    }

    decide(time, moving = false, heading = null) {
        if (this.leaving) {
            // On its way out: on out beyond the frame (it is as good as gone).
            const tip = this.trail.tip(this._tip);
            const side = Math.sign(this.range.fraction(tip[0], tip[1])) || 1;
            const out = this.range.place(side * 2.4, Math.hypot(tip[0], tip[1]));
            this.steps.push({
                points: this.steerTo(tip, out, FOX_STEER.trot, true)
                    || this.steerTo(tip, out, FOX_STEER.trot, true, false) || this.swing(tip, FOX_STEER.trot),
                pace: 'trot',
            });
            return;
        }
        if (time >= this.stayUntil && !this.roamRunning) {
            if (this.planLeave(this.trail.tip(this._tip), 0, !moving)) {
                this.recentErrands.unshift('leave');
                return;
            }
            // (No way out from here: it stays a little longer, and tries again from elsewhere.)
            this.leaving = false;
            this.stayUntil = time + 12;
        }
        super.decide(time, moving, heading);
    }

    /** The frame changed shape: its snow is laid out anew, its way kept going. */
    setAspect(aspect) {
        if (this.away) {
            // (Away, it has no way to keep: it comes in over the new snow when it comes.)
            this.aspect = aspect;
            this.range = snowRange(aspect, this.layout);
            return;
        }
        super.setAspect(aspect);
    }

    reroute(time, o) {
        if (this.away) return;
        super.reroute(time, o);
    }

    /**
     * The fox is at (x, z): the visitor keeps off it. It slows for a fox in its way ahead, pulls up
     * short of it and makes a stop of the wait — a bow, a look, a sit; kept waiting, it turns round
     * and goes back the way it came. Call before each step while the visitor is in sight (with no
     * fox to mind, `clearWay()`).
     * @returns {boolean} whether the fox is in its way
     */
    keepOff(x, z, time) {
        const { pose } = this;
        const sin = Math.sin(pose.heading);
        const cos = Math.cos(pose.heading);
        const along = (x - pose.x) * sin + (z - pose.z) * cos;
        const across = Math.abs((x - pose.x) * cos - (z - pose.z) * sin);
        const inWay = time >= this.heedFrom && along > 0 && along < 9 && across < VISITOR_MEET.wide;
        if (!inWay) {
            this.clearWay();
            return false;
        }
        this.ahead = along;
        this.aheadSpeed = 0;
        if (along < VISITOR_MEET.room + 1) {
            if (this.blockedSince === null) {
                this.blockedSince = time;
                // (What it pulls up to do before the fox: turn about, so two meetings differ.)
                if (this.mode === 'gait') this.forced = VISITOR_MEET.stops[this.meetings % VISITOR_MEET.stops.length];
                this.meetings += 1;
            } else if (time - this.blockedSince > VISITOR_MEET.wait && this.mode === 'gait') {
                this.forced = null;
                this.clearWay();
                this.turnHere(time);
                this.heedFrom = time + 15;
            }
        }
        return true;
    }

    /** Nothing is in its way. */
    clearWay() {
        this.ahead = Infinity;
        this.aheadSpeed = 0;
        this.blockedSince = null;
    }

    /** Set it on its way in from the left as if it had set out `seconds` ago (captures). */
    arrive(time, seconds = 0) {
        const lead = Math.max(0, seconds);
        this.setOut(time - lead, -1);
        const steps = Math.ceil(lead * 30);
        for (let i = 1; i <= steps; i++) this.step(lead / steps, time - lead + (i * lead) / steps, null);
    }

    step(dt, time, env) {
        if (dt > 0 && this.range) {
            if (this.away) {
                if (time < this.awayUntil) {
                    // (Away it stands and waits: nothing of it is stepped.)
                    this.events.length = 0;
                    return;
                }
                this.setOut(time, this.roamRand() < 0.5 ? -1 : 1);
            } else if (this.leaving && this.mode === 'gait' && !this.inFrame()) {
                this.goAway(time, lerp(VISITOR_AWAY[0], VISITOR_AWAY[1], this.roamRand() ** 1.2));
                return;
            } else if (this.leaving && time - this.leftAt > 45) {
                // (Kept from going a long while: it stays, and goes later.)
                this.leaving = false;
                this.stayUntil = time + 15;
                this.steps = [];
                this.reroute(time, { lead: Math.min(0.6, Math.max(0, this.trail.end - this.s)) });
            }
        }
        super.step(dt, time, env);
    }

    /** Whether it is within the frame, or less than a body's length outside it. */
    inFrame() {
        const { x, z } = this.pose;
        return z < -3 && Math.abs(this.range.fraction(x, z)) < 1.25;
    }
}
