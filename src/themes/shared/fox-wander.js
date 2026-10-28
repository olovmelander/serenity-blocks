/**
 * How a fox wanders its course, for the themes that let it (Winter's arctic fox, the Sakura
 * garden's red fox). Three-free and renderer-free, on the fox mind they share (fox-mind.js).
 *
 * It strays a little either side of its course, and never the same way twice, for its stray runs
 * on with the ground it covers; its trot drifts quicker and slower; it stops where it likes where
 * it can be seen, not only at its places, and does a different thing each time (what it has just
 * done is less likely); now and then, as it pulls up, it turns right round on the spot and goes
 * back the way it came. How restless it is drifts slowly, so it has spells of trotting on and
 * spells of stopping often. Its own seed deals all of it, so a seek replays it.
 *
 * What is each theme's own is where it may go and where it may stop: `foxWalk` takes a test of
 * each place it might stray to (`allowed`) and of each place on its course it may stop at (`open`).
 */

import { FoxMind, mulberry32 } from './fox-mind.js';

const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.round(a / TAU);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** A normal deviate (Box-Muller, two draws). */
const gauss = (rand) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(TAU * rand());

/**
 * How far it may stray each side of its course (metres, at each sample of it: [right, left]):
 * as far as `allowed(i, x, z, sx, sz)` lets it go from the course's sample (x, z) toward (sx, sz),
 * up to `most`, and inside a bend no further than half its radius (or its way would double back
 * on itself). Its stray is different every lap, so this holds whatever it is. Eased along the
 * course so its path stays smooth (held low further than it is eased, so easing never gives any
 * back).
 */
export function strayRoom(base, most, allowed) {
    const { count, length, points } = base;
    const step = length / count;
    const hold = Math.ceil(3.5 / step);
    const ease = Math.ceil(3 / step);
    return [1, -1].map((side) => {
        const raw = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const x = points[i * 3];
            const z = points[i * 3 + 1];
            const h = points[i * 3 + 2];
            const ahead = points[((i + 1) % count) * 3 + 2];
            const behind = points[((i + count - 1) % count) * 3 + 2];
            const bend = wrap(ahead - behind) / (2 * step);
            const inside = bend * side > 0 ? 0.5 / Math.abs(bend) : Infinity;
            let room = 0;
            while (room < Math.min(most, inside)) {
                const o = side * Math.min(most, inside, room + 0.05);
                if (!allowed(i, x, z, x + Math.cos(h) * o, z - Math.sin(h) * o)) break;
                room = Math.abs(o);
            }
            raw[i] = room;
        }
        const held = raw.map((_, i) => {
            let m = most;
            for (let k = -hold; k <= hold; k++) m = Math.min(m, raw[(i + k + count) % count]);
            return m;
        });
        return held.map((_, i) => {
            let sum = 0;
            for (let k = -ease; k <= ease; k++) sum += held[(i + k + count) % count];
            return sum / (2 * ease + 1);
        });
    });
}

/**
 * Its way over its course as it wanders: which way round it goes (it may turn back), and how far it
 * strays either side. A distance its mind has run maps to a place on the course and a direction.
 * @param {object} base  its course as laid out: { points (x, z, heading a sample), count, length,
 *     stations, at(distance, out) }
 * @param {object} plan  { reach (m it strays at most), allowed(i, x, z, sx, sz), open(i, x, z) }
 */
export function foxWalk(base, plan) {
    const walk = {
        turns: [],

        /** Its course or what it may do on it changed (the frame did). */
        setBase(nextBase, nextPlan) {
            this.base = nextBase;
            this.plan = nextPlan;
            const { count, points } = nextBase;
            this.open = new Uint8Array(count);
            for (let i = 0; i < count; i++) this.open[i] = nextPlan.open(i, points[i * 3], points[i * 3 + 1]) ? 1 : 0;
            this.reach = nextPlan.reach;
            [this.roomRight, this.roomLeft] = strayRoom(nextBase, this.reach, nextPlan.allowed);
        },

        /** Where along its course (metres) a distance run takes it, and which way it is going (±1). */
        along(distance) {
            for (let i = this.turns.length - 1; i >= 0; i--) {
                const t = this.turns[i];
                if (distance >= t.at) return [t.q + t.dir * (distance - t.at), t.dir];
            }
            return [distance, 1];
        },

        /** Which way it is straying at a place along its course, and how far: -1 (left) .. 1 (right). */
        strayShape(q) {
            return 0.62 * Math.sin(q / 7.3 + 1.7) + 0.38 * Math.sin(q / 3.4 + 0.4);
        },

        /**
         * How far it strays from its course at a place along it (metres, + to its right going round):
         * its swing laid over the room it has there, so where something stands close it keeps to the
         * far side of its course and swings less.
         */
        stray(q) {
            const { length, count } = this.base;
            const f = ((((q % length) + length) % length) / length) * count;
            const i = Math.floor(f) % count;
            const t = f - Math.floor(f);
            const j = (i + 1) % count;
            const right = this.roomRight[i] + (this.roomRight[j] - this.roomRight[i]) * t;
            const left = this.roomLeft[i] + (this.roomLeft[j] - this.roomLeft[i]) * t;
            return (right - left) / 2 + ((right + left) / 2) * this.strayShape(q);
        },

        /** Its place a distance run: (x, z, heading). */
        at(distance, out = [0, 0, 0]) {
            const [q, dir] = this.along(distance);
            this.base.at(q, out);
            const h = out[2];
            const o = this.stray(q);
            const slope = (this.stray(q + 0.2) - this.stray(q - 0.2)) / 0.4;
            out[0] += Math.cos(h) * o;
            out[1] -= Math.sin(h) * o;
            out[2] = wrap(h + Math.atan(slope) + (dir < 0 ? Math.PI : 0));
            return out;
        },

        /** Whether it may stop a distance run from here. */
        openAt(distance) {
            const { length, count } = this.base;
            const [q] = this.along(distance);
            const i = Math.floor(((((q % length) + length) % length) / length) * count) % count;
            return this.open[i] === 1;
        },

        /** Whether a distance run puts it on one of its places. */
        stationAt(distance, near = 0.4) {
            const { length, stations } = this.base;
            const [q] = this.along(distance);
            return stations.some((st) => Math.abs(wrap(((q - st) / length) * TAU)) * (length / TAU) < near);
        },

        /** From here on it goes the other way round. */
        turn(distance) {
            const [q, dir] = this.along(distance);
            this.turns.push({ at: distance, q, dir: -dir });
            if (this.turns.length > 48) this.turns.splice(0, this.turns.length - 48);
        },
    };
    walk.setBase(base, plan);
    return walk;
}

/** Its course as its mind goes it: the walk when it wanders, else the course as laid out. */
export const wanderingCourse = (base, walk, { height, viewer }) => ({
    length: base.length,
    stations: base.stations,
    height,
    viewer,
    at: walk ? (distance, out) => walk.at(distance, out) : (distance, out) => base.at(distance, out),
});

/**
 * A fox mind that wanders when it is given a walk; with none it is the fox mind the themes share,
 * as it was.
 *
 * `wander`: { walk: foxWalk(...), stops: [[acts, odds, odds at one of its places]], and its ways:
 * pace [slowest, quickest] (shares of its trot), rest [shortest, longest] (s between stops),
 * anywhere (odds it stops where it is rather than at one of its places), turnBack and turnGap
 * (odds it turns back as it pulls up; never twice within so many seconds), reach (m ahead it looks
 * for somewhere to stop), restlessTime and restlessSpread (how slowly its restlessness drifts, and
 * how far) }.
 */
export class WanderingFoxMind extends FoxMind {
    constructor(options, wander = null) {
        super({
            ...options,
            ...(wander ? { stops: wander.stops.map(([acts]) => acts) } : {}),
        });
        this.wander = wander;
        this.walk = wander?.walk ?? null;
        // (The shared constructor set it going before it knew how it wanders.)
        if (this.walk) this.reset(0);
    }

    reset(time = 0) {
        if (this.walk) {
            this.walk.turns.length = 0;
            this.wanderRand = mulberry32((this.seed ^ 0x51ed) >>> 0);
            this.restless = 0.45;
            this.restlessAt = time;
            this.stopAt = null;
            this.stopAtStation = false;
            this.recentStops = [];
            this.turnedAt = -Infinity;
            this.turnNext = false;
        }
        super.reset(time);
    }

    /** Its course changed shape (the frame did): keep its place along it, and its way round. */
    setBase(base, plan, course) {
        if (this.walk) {
            const k = base.length / this.walk.base.length;
            this.walk.turns.forEach((t) => {
                // eslint-disable-next-line no-param-reassign
                t.at *= k;
                // eslint-disable-next-line no-param-reassign
                t.q *= k;
            });
            this.walk.setBase(base, plan);
            this.stopAt = null;
        }
        this.setCourse(course);
    }

    /**
     * How restless it is now (0 still .. 1 restless): a slow random drift (Ornstein-Uhlenbeck), so it
     * has spells of trotting on and spells of stopping often.
     */
    restlessNow(time) {
        const { restlessTime, restlessSpread } = this.wander;
        const span = Math.max(0, time - this.restlessAt);
        this.restlessAt = time;
        const keep = Math.exp(-span / restlessTime);
        const drift = restlessSpread * Math.sqrt(1 - keep * keep) * gauss(this.wanderRand);
        this.restless = Math.max(0.02, Math.min(0.98, 0.45 + (this.restless - 0.45) * keep + drift));
        return this.restless;
    }

    /** Its trot drifts quicker and slower with no beat to it, and quicker when it is restless. */
    trotAt(time) {
        if (!this.walk) return super.trotAt(time);
        const [slow, quick] = this.wander.pace;
        const drift = 0.5 + 0.3 * Math.sin(time / 17.3 + 0.7) + 0.2 * Math.sin(time / 6.9 + 2.1);
        return this.paces.trot * (slow + (quick - slow) * clamp01(0.55 * drift + 0.45 * this.restless));
    }

    /** Seconds before it stops again: mostly short, now and then long, shorter when it is restless. */
    restFor(time) {
        if (!this.walk) return super.restFor(time);
        const restless = this.restlessNow(time);
        const [a, b] = this.wander.rest;
        return (a + (b - a) * this.wanderRand() ** 1.8) * (1.4 - 0.8 * restless);
    }

    /** What it stops for: by its odds (where it is), and not what it has just done. */
    chooseStop() {
        if (!this.walk) return super.chooseStop();
        const options = this.wander.stops.map(([acts, odds, atStation = odds]) => [
            acts, (this.stopAtStation ? atStation : odds) * (this.recentStops.includes(acts) ? 0.3 : 1),
        ]);
        let r = this.wanderRand() * options.reduce((sum, [, odds]) => sum + odds, 0);
        let pick = options[options.length - 1][0];
        for (const [acts, odds] of options) {
            r -= odds;
            if (r <= 0) {
                pick = acts;
                break;
            }
        }
        this.recentStops = [pick, ...this.recentStops].slice(0, 2);
        // (Its stops are the shared mind's own list, so a hunt with no room swaps to one of them.)
        return this.stops.find((stop) => stop.join() === pick.join()) || pick;
    }

    /** Metres ahead to where it will stop: one of its places, or by chance anywhere it may. */
    placeToStop() {
        const { walk } = this;
        const open = [];
        for (let d = this.paces.brakeFrom + 0.5; d <= this.wander.reach; d += 0.5) {
            if (walk.openAt(this.s + d)) open.push(d);
        }
        const stations = open.filter((d) => walk.stationAt(this.s + d));
        if (!open.length) return null;
        if (!stations.length || this.wanderRand() < this.wander.anywhere) {
            const d = open[Math.floor(this.wanderRand() ** 1.4 * open.length) % open.length];
            return { d, station: walk.stationAt(this.s + d) };
        }
        return { d: stations[0], station: true };
    }

    toStation() {
        if (!this.walk) return super.toStation();
        if (this.stopAt === null || this.stopAt < this.s - 0.05) {
            const ahead = this.placeToStop();
            // (Nowhere open within reach: it trots on and looks again further round.)
            if (ahead === null) return Infinity;
            this.stopAt = this.s + ahead.d;
            this.stopAtStation = ahead.station;
        }
        return Math.max(0, this.stopAt - this.s);
    }

    passedStation(before, after) {
        if (!this.walk) return super.passedStation(before, after);
        return this.stopAt !== null && before < this.stopAt && after >= this.stopAt;
    }

    /** It has pulled up: now and then it turns right round on the spot, to go back the way it came. */
    stopped(time) {
        if (!this.walk) return;
        this.stopAt = null;
        const restless = this.restlessNow(time);
        const turn = time - this.turnedAt > this.wander.turnGap
            && this.wanderRand() < this.wander.turnBack * (0.6 + 0.8 * restless);
        if (turn || this.turnNext) this.turnBack(time);
        this.turnNext = false;
    }

    /** Pull up just ahead and turn back the way it came (captures, the playground). */
    turnHere(time) {
        if (!this.walk || this.mode !== 'gait') return false;
        this.nextStop = time;
        this.stopAt = this.s + Math.max(0.6, (this.speed * this.speed) / (2 * this.paces.brake) + 0.2);
        this.stopAtStation = false;
        this.turnNext = true;
        return true;
    }

    /**
     * Its way turns round under it; it stands as it stood, so it has a half turn to step round (toward
     * whoever is watching first) before it faces the way it now goes.
     */
    turnBack(time) {
        const side = this.viewerSide();
        this.walk.turn(this.s);
        this.face -= side * Math.PI;
        this._pathHeading = wrap(this._pathHeading + Math.PI);
        this.turnedAt = time;
    }

    /** A half turn round takes longer to step than a turn toward the viewer. */
    faceTime(time) {
        return this.walk && time - this.turnedAt < 4 ? 3.4 : super.faceTime(time);
    }
}
