/**
 * Verdant Hills — the flock's mind: where every ewe and lamb goes and what it does.
 *
 * Three-free and renderer-free. Each frame it steps the flock and resolves a pose for every sheep
 * (verdant-hills-sheep-rig.js turns the pose into bone rotations; verdant-hills-sheep.js draws them).
 * A sheep has a body that cannot jump about: it turns at the rate its legs allow, speeds up and
 * slows down as an animal does, and its gait's phase is the ground it has covered over its stride,
 * so a planted hoof never slides. What it does is one act at a time, cross-faded from wherever the
 * last one had got to.
 *
 * What a group does together:
 *  - grazes: the group's ground drifts slowly over the pasture and each ewe crops her way after
 *    her own place in it, head down, stepping on a stride or two at a time; she lifts her head to
 *    chew and look about, and puts it down again; one shakes her fleece, one scratches;
 *  - moves on: one ewe sets off for fresh grass and the rest string out behind her in single file
 *    along the line she walked, the lambs trotting at their mothers' heels;
 *  - takes fright: bunches and gallops away down the wind, then pulls up, wheels round and stands
 *    staring back the way the fright came, a forefoot stamped, until one by one they graze again;
 *  - rests: in the warm of the afternoon they go down on their knees and lie chewing the cud, and
 *    get up again hind end first, with a stretch;
 *  - shelters: as the showers come up they bunch and stand with their backs to the wind.
 * The lambs keep to their mothers, suckle (she stands for it and turns her head to smell them),
 * lie down at her side, and play: they spring straight up off all four feet, twist in the air and
 * kick, butt each other, dash off and back, and now and then the lambs of a group race away
 * together over the hill and come galloping home.
 *
 * What the game does to them: a front of wind crossing the valley reaches each group in turn, so
 * heads come up group by group as it passes and the lambs frisk in it; the four-line gale sends
 * whole groups galloping off down the wind; the kite festival sets every group's lambs racing; a
 * pool of sunlight sets the lambs it crosses gambolling; the end of a run lays them all down to
 * rest; a new level sends a group or two on to fresh grass; the weather of the day (rest in the
 * honey afternoon, play in the long gold, backs to the wind before the showers, a shake after
 * the rain) and how hot play runs (livelier lambs, warier ewes) colour the rest. Reduce motion
 * keeps them from bolting and racing.
 *
 * Deterministic: one seeded generator, stepped in a fixed order, so a seek replays the same flock.
 */
import {
    EWE_RIG, LAMB_RIG, SHEEP_ACTS, SHEEP_LIE_HOLD, SHEEP_LOOPS, SHEEP_SCALE, createSheepSpec, sheepGaitAt,
    sheepLeapHeight, sheepStride,
} from './verdant-hills-sheep-rig.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (lo, hi, v) => {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
};
/** An angle wrapped to (-π, π]. */
const wrap = (a) => a - TAU * Math.round(a / TAU);

/** The flock's own generator (mulberry32): a seek replays it from its seed. */
function generator(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Speeds (world m/s), distances (world metres) and times (seconds) the flock lives by.
 */
export const FLOCK = Object.freeze({
    /** Cropping on a stride at a time; walking; hurrying after the flock; a trot; a bolt. */
    creep: 0.2,
    walk: 0.85,
    hurry: 1.3,
    trot: 2.1,
    run: 4.9,
    /** A lamb's trot to catch its mother up, and its gallop. */
    lambTrot: 1.7,
    lambRun: 4.3,
    /** How close a sheep lets another stand (from centre to centre, ewe to ewe). */
    space: 1.25,
    lambSpace: 0.6,
    /** How far a grazing group spreads (metres from its middle, before the size of the group). */
    spread: 4.5,
    /** How far apart sheep walk in single file. */
    file: 2.1,
    /** How fast the group's ground drifts over the pasture while it grazes. */
    drift: 0.035,
    /** Where a group moving on looks for grass (metres off), and where a bolting one runs to. */
    moveReach: [28, 70],
    fleeReach: [22, 38],
    /** How far apart two groups keep their grazing grounds. */
    apart: 30,
    /** How far the lambs race out from their mothers before they come home. */
    raceReach: [18, 34],
    /** Seconds from one change of act to the next being complete. */
    blend: 0.55,
    quickBlend: 0.22,
    /** How quickly it turns (rad/s): stepping round on the spot, walking, galloping. */
    turnStill: 1.5,
    turnWalk: 1.0,
    turnRun: 0.75,
    /** How quickly it gets going and pulls up (m/s²): at a walk, at a run. */
    accelWalk: 0.9,
    accelRun: 5.5,
    brakeWalk: 1.6,
    brakeRun: 4.5,
});

/** What a sheep can be doing (its "mode"); the act it shows follows from the mode and its pace. */
const MODES = Object.freeze([
    'graze', 'look', 'walk', 'lie', 'rise', 'stretch', 'shake', 'scratch', 'nurse', 'suckle', 'play', 'stare',
    'flee', 'follow', 'heel', 'race',
]);

/** The weathers of the day in order (verdant-hills-moods.js), and how each colours the flock. */
const WEATHER = Object.freeze([
    // kite day: an ordinary bright day
    Object.freeze({
        rest: 0.05, play: 1, shake: 0.4, shelter: 0, look: 1,
    }),
    // honey afternoon: the warm of the day, a third of the groups lying chewing the cud
    Object.freeze({
        rest: 0.4, play: 0.7, shake: 0.3, shelter: 0, look: 0.8,
    }),
    // long gold: the evening lamb races; the ewes graze hard
    Object.freeze({
        rest: 0.12, play: 2.2, shake: 0.4, shelter: 0, look: 0.9,
    }),
    // showers coming: bunched, backs to the wind, no play
    Object.freeze({
        rest: 0, play: 0.25, shake: 0.6, shelter: 1, look: 1.5,
    }),
    // after the rain: shaking the wet out of their fleeces, grazing spread out
    Object.freeze({
        rest: 0.02, play: 1.3, shake: 3.5, shelter: 0, look: 1,
    }),
]);

/** The day's weather `phase` as a blend of WEATHER rows (filled into `out`). */
function weatherAt(phase, out) {
    const n = WEATHER.length;
    const p = Number.isFinite(phase) ? phase : 0;
    const base = Math.floor(p);
    const t = smooth(0, 1, p - base);
    const a = WEATHER[((base % n) + n) % n];
    const b = WEATHER[(((base + 1) % n) + n) % n];
    for (const key of Object.keys(a)) out[key] = a[key] + (b[key] - a[key]) * t;
    out.index = ((Math.round(p) % n) + n) % n;
    return out;
}

/**
 * The ground the flock lives on. `ground(x, z)` its height; `allowed(x, z)` whether a sheep may
 * stand there (open grass: no water, hedge, tree, wall or cliff); `seen(x, z)` whether the lens
 * can see a sheep standing there (the flock prefers to graze where it can be seen).
 * @typedef {{ ground: Function, allowed: Function, seen?: Function }} FlockLand
 */

/**
 * @typedef {object} SheepPose  what the rig and the renderer read for one sheep each frame
 * @property {number} x
 * @property {number} y   the ground under it (its root is lifted by `lift` on top)
 * @property {number} z
 * @property {number} heading  radians: its nose toward (sin, cos) on (x, z)
 * @property {number} scale    world metres to a model metre
 * @property {number} lift     metres it is off the ground (a lamb's leap)
 */

export class VerdantHillsFlock {
    /**
     * @param {object} o
     * @param {Array} o.entries  the layout: { x, z, yaw, scale, lamb, mother, group } per sheep
     * @param {FlockLand} o.land
     * @param {number} [o.seed]
     * @param {{x: number, z: number}} [o.wind]  the way the wind blows (unit, on the ground)
     */
    constructor({
        entries, land, seed = 0x5eed, wind = { x: 0.5, z: -0.866 },
    }) {
        this.entries = entries.map((entry) => ({ ...entry }));
        this.land = land;
        this.seed = seed >>> 0;
        const w = Math.hypot(wind.x, wind.z) || 1;
        this.wind = { x: wind.x / w, z: wind.z / w };
        this.weather = {
            rest: 0, play: 1, shake: 0, shelter: 0, look: 1, index: 0,
        };
        this.reset();
    }

    /** Back to where a session starts: every sheep where the layout put it. */
    reset() {
        this.rand = generator(this.seed);
        this.time = 0;
        this.festivalWas = 0;
        this.settledWas = false;
        this.restWas = false;
        this.weatherWas = -1;
        this.frontsWas = [];
        const { rand } = this;
        this.sheep = this.entries.map((entry, index) => this.createSheep(entry, index));
        this.sheep.forEach((s) => {
            if (s.lamb && s.mother >= 0) this.sheep[s.mother].lambs.push(s.index);
        });
        const groups = new Map();
        this.sheep.forEach((s) => {
            if (!groups.has(s.group)) groups.set(s.group, []);
            groups.get(s.group).push(s);
        });
        this.groups = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([id, members], index) => {
            members.forEach((s) => {
                // eslint-disable-next-line no-param-reassign
                s.team = index;
            });
            const cx = members.reduce((sum, s) => sum + s.x, 0) / members.length;
            const cz = members.reduce((sum, s) => sum + s.z, 0) / members.length;
            return {
                id,
                index,
                members,
                ewes: members.filter((s) => !s.lamb),
                lambs: members.filter((s) => s.lamb),
                home: { x: cx, z: cz },
                cx,
                cz,
                drift: rand() * TAU,
                driftUntil: 10 + rand() * 30,
                mode: 'graze',
                modeTime: 0,
                until: 0,
                targetX: cx,
                targetZ: cz,
                leader: -1,
                trail: new Float64Array(2048),
                trailLength: 0,
                trailS: new Float64Array(1024),
                fleeX: cx,
                fleeZ: cz,
                alarmX: cx,
                alarmZ: cz,
                restUntil: 0,
                nextMove: 150 + rand() * 260,
                nextRace: 60 + rand() * 120,
                raceX: cx,
                raceZ: cz,
                frontAlong: [],
            };
        });
        // A flock caught in the middle of its day: most grazing, a few looking about, the odd lamb lying.
        this.sheep.forEach((s) => {
            const roll = rand();
            if (s.lamb) {
                if (roll < 0.25) this.setMode(s, 'lie', 40 + rand() * 80, true);
                else this.setMode(s, 'heel', 0, true);
            } else if (roll < 0.18) this.setMode(s, 'look', 2 + rand() * 6, true);
            else this.setMode(s, 'graze', 0, true);
            s.actTime = rand() * 4;
        });
        this.groups.forEach((g) => this.placeSpots(g));
        this.solve();
        return this;
    }

    createSheep(entry, index) {
        const { rand } = this;
        const lamb = entry.lamb === true;
        const { x } = entry;
        const { z } = entry;
        return {
            index,
            lamb,
            rig: lamb ? LAMB_RIG : EWE_RIG,
            mother: Number.isInteger(entry.mother) ? entry.mother : -1,
            lambs: [],
            group: entry.group ?? 0,
            team: 0,
            scale: Number.isFinite(entry.scale) ? entry.scale : SHEEP_SCALE,
            look: Number.isFinite(entry.look) ? entry.look : rand(),
            x,
            z,
            y: this.land.ground(x, z),
            heading: Number.isFinite(entry.yaw) ? entry.yaw : rand() * TAU,
            speed: 0,
            turning: 0,
            phase: rand(),
            gait: 0,
            // what it shows
            act: 'Stand',
            actTime: 0,
            blend: 1,
            blendRate: 1 / FLOCK.blend,
            fromSpec: createSheepSpec(),
            lift: 0,
            lookYaw: 0,
            lookPitch: 0,
            lookYawGoal: 0,
            lookPitchGoal: 0,
            wag: 0,
            // what it means to do
            mode: 'graze',
            modeTime: 0,
            until: 0,
            next: 0,
            goalX: x,
            goalZ: z,
            goalSpeed: 0,
            faceHeading: null,
            creepUntil: 0,
            spotAngle: rand() * TAU,
            spotRadius: Math.sqrt(rand()),
            spotUntil: 0,
            play: [],
            playStep: null,
            partner: -1,
            queue: 0,
            // who it is: bold ones lead and look about, lazy ones lie down, playful lambs play
            bold: rand(),
            lazy: rand(),
            playful: rand(),
            gradX: 0,
            gradZ: 0,
            gradAt: -1,
            feet: [0, 0, 0, 0],
            pose: {
                act: 'Stand',
                actTime: 0,
                fromSpec: null,
                blend: 1,
                phase: 0,
                speed: 0,
                amp: 0,
                gait: 0,
                step: 0,
                lookYaw: 0,
                lookPitch: 0,
                tailWag: 0,
                breath: 0,
                feet: [0, 0, 0, 0],
            },
            spec: createSheepSpec(),
            posture: (lamb ? LAMB_RIG : EWE_RIG).createPosture(),
        };
    }

    // ── Choosing ────────────────────────────────────────────────────────────────

    /** Begin a mode for `seconds` (0: until the mode itself decides). */
    setMode(s, mode, seconds = 0, quiet = false) {
        if (!MODES.includes(mode)) throw new Error(`no such mode: ${mode}`);
        /* eslint-disable no-param-reassign */
        s.mode = mode;
        s.modeTime = 0;
        s.until = seconds > 0 ? this.time + seconds : 0;
        s.next = this.time + (quiet ? this.rand() * 3 : 0);
        s.creepUntil = 0;
        s.faceHeading = null;
        s.walkSpeed = 0;
        s.walkX = undefined;
        s.walkZ = undefined;
        if (mode !== 'play') {
            s.play.length = 0;
            s.playStep = null;
        }
        if (quiet) {
            s.act = this.actFor(s);
            s.blend = 1;
        }
        /* eslint-enable no-param-reassign */
    }

    /** Pick each ewe a new place in its group's grazing ground (and keep the lambs' as they are). */
    placeSpots(g) {
        const { rand } = this;
        g.ewes.forEach((s) => {
            /* eslint-disable no-param-reassign */
            s.spotAngle = rand() * TAU;
            s.spotRadius = Math.sqrt(rand());
            s.spotUntil = this.time + 25 + rand() * 50;
            /* eslint-enable no-param-reassign */
        });
    }

    /** How far a group spreads while it grazes (sheltering, it bunches). */
    spread(g) {
        const base = FLOCK.spread + 1.6 * Math.sqrt(g.ewes.length);
        return base * (1 - 0.45 * this.weather.shelter);
    }

    /** Where in its group's ground a ewe means to graze. */
    spotOf(s, out) {
        const g = this.groups[s.team];
        const r = this.spread(g) * (0.25 + 0.75 * s.spotRadius);
        // eslint-disable-next-line no-param-reassign
        out.x = g.cx + Math.cos(s.spotAngle) * r;
        // eslint-disable-next-line no-param-reassign
        out.z = g.cz + Math.sin(s.spotAngle) * r * 0.8;
        return out;
    }

    /** A place in the pasture near (x, z), as near the asked-for one as the ground allows. */
    nearestAllowed(x, z, out, reach = 12) {
        const { land } = this;
        if (land.allowed(x, z)) {
            out.x = x;
            out.z = z;
            return true;
        }
        for (let r = 1.5; r <= reach; r += 1.5) {
            for (let k = 0; k < 12; k++) {
                const a = (k / 12) * TAU;
                const px = x + Math.cos(a) * r;
                const pz = z + Math.sin(a) * r;
                if (land.allowed(px, pz)) {
                    out.x = px;
                    out.z = pz;
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * A place `reach` metres or so from a group, in its pasture and (when it can be) in sight,
     * roughly toward `bearing` (or anywhere): where it moves on to, or where its lambs race.
     */
    pickPlace(g, [near, far], bearing = null, out = { x: 0, z: 0 }) {
        const { land, rand } = this;
        let best = null;
        let bestScore = -Infinity;
        for (let k = 0; k < 32; k++) {
            // Toward the bearing first, the fan opening as the near ones fail (to all round).
            const fan = Math.min(TAU, 1.4 * (1 + Math.floor(k / 8)));
            const a = bearing === null ? rand() * TAU : bearing + (rand() - 0.5) * fan;
            const r = near + rand() * (far - near);
            const x = g.cx + Math.cos(a) * r;
            const z = g.cz + Math.sin(a) * r;
            if (!land.allowed(x, z)) continue;
            // The way there must be grass too.
            let clear = true;
            for (let t = 0.2; t < 1; t += 0.2) {
                if (!land.allowed(g.cx + (x - g.cx) * t, g.cz + (z - g.cz) * t)) clear = false;
            }
            // Near enough its own ground to keep the flock where it lives, and in sight. (The sight
            // line is the dear question: asked only of a place that passes the rest, and the first
            // that passes them all is taken.)
            const homeward = Math.hypot(x - g.home.x, z - g.home.z);
            const apart = this.apart(g, x, z);
            if (clear && apart && homeward < 60 && (!land.seen || land.seen(x, z))) {
                out.x = x;
                out.z = z;
                return out;
            }
            const score = (clear ? 2 : 0) + (apart ? 2 : 0) - homeward / 40 + rand() * 0.5;
            if (score > bestScore) {
                bestScore = score;
                best = { x, z };
            }
        }
        if (!best) return null;
        out.x = best.x;
        out.z = best.z;
        return out;
    }

    /** Whether (x, z) keeps clear of every other group's ground (they graze apart, not as one). */
    apart(g, x, z, room = FLOCK.apart) {
        return this.groups.every((o) => o === g || Math.hypot(x - o.cx, z - o.cz) > room);
    }

    // ── What the groups do ──────────────────────────────────────────────────────

    /** A group sets off for fresh grass: a ewe leads and the rest file after her. */
    moveOn(g, bearing = null) {
        if (g.ewes.length === 0 || g.mode === 'flee') return false;
        const target = this.pickPlace(g, FLOCK.moveReach, bearing);
        if (!target) return false;
        g.mode = 'move';
        g.modeTime = 0;
        g.targetX = target.x;
        g.targetZ = target.z;
        // The boldest of those nearest the way it goes leads.
        const dirX = target.x - g.cx;
        const dirZ = target.z - g.cz;
        const dir = Math.hypot(dirX, dirZ) || 1;
        let leader = null;
        let best = -Infinity;
        g.ewes.forEach((s) => {
            if (s.mode === 'lie') return;
            const ahead = ((s.x - g.cx) * dirX + (s.z - g.cz) * dirZ) / dir;
            const score = ahead + 6 * s.bold;
            if (score > best) {
                best = score;
                leader = s;
            }
        });
        if (!leader) [leader] = g.ewes;
        g.leader = leader.index;
        g.trailLength = 0;
        this.extendTrail(g, leader.x, leader.z);
        // The rest join the file in the order they are nearest her.
        const others = g.ewes.filter((s) => s !== leader)
            .sort((a, b) => Math.hypot(a.x - leader.x, a.z - leader.z) - Math.hypot(b.x - leader.x, b.z - leader.z));
        leader.queue = 0;
        leader.followAt = this.time;
        leader.risingAt = leader.mode === 'lie' ? this.time : undefined;
        if (leader.mode === 'lie') leader.followAt = this.time + SHEEP_ACTS.Rise;
        this.setMode(leader, 'follow');
        others.forEach((s, i) => {
            /* eslint-disable no-param-reassign */
            s.queue = i + 1;
            // Each looks up and goes a moment after the one before her, as they notice; one lying
            // gets up first.
            const delay = 0.6 + i * (0.7 + this.rand() * 0.8);
            s.risingAt = s.mode === 'lie' ? this.time : undefined;
            s.followAt = this.time + delay + (s.mode === 'lie' ? SHEEP_ACTS.Rise : 0);
            /* eslint-enable no-param-reassign */
            this.setMode(s, 'follow');
        });
        g.lambs.forEach((s) => {
            if (s.mode === 'lie') this.setMode(s, 'rise', SHEEP_ACTS.Rise);
            else if (s.mode === 'suckle' || s.mode === 'play' || s.mode === 'race') this.setMode(s, 'heel');
        });
        return true;
    }

    /** Note where the leader has walked (every half metre), so the file can follow the same line. */
    extendTrail(g, x, z) {
        const n = g.trailLength;
        if (n > 0) {
            const lx = g.trail[(n - 1) * 2];
            const lz = g.trail[(n - 1) * 2 + 1];
            const d = Math.hypot(x - lx, z - lz);
            if (d < 0.5) return;
            if (n >= g.trailS.length) return;
            g.trailS[n] = g.trailS[n - 1] + d;
        } else g.trailS[0] = 0;
        g.trail[n * 2] = x;
        g.trail[n * 2 + 1] = z;
        g.trailLength = n + 1;
    }

    /** How far along a group's trail (metres) the point of it nearest (x, z) is. */
    nearestOnTrail(g, x, z) {
        let best = 0;
        let near = Infinity;
        for (let k = 0; k < g.trailLength; k++) {
            const d = (g.trail[k * 2] - x) ** 2 + (g.trail[k * 2 + 1] - z) ** 2;
            if (d < near) {
                near = d;
                best = g.trailS[k];
            }
        }
        return best;
    }

    /** The point `s` metres along a group's trail (clamped to its ends). */
    trailAt(g, s, out) {
        const n = g.trailLength;
        if (n === 0) {
            out.x = g.cx;
            out.z = g.cz;
            return out;
        }
        if (s <= 0 || n === 1) {
            out.x = g.trail[0];
            out.z = g.trail[1];
            return out;
        }
        const end = g.trailS[n - 1];
        if (s >= end) {
            out.x = g.trail[(n - 1) * 2];
            out.z = g.trail[(n - 1) * 2 + 1];
            return out;
        }
        let lo = 0;
        let hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (g.trailS[mid] <= s) lo = mid;
            else hi = mid;
        }
        const t = (s - g.trailS[lo]) / Math.max(1e-6, g.trailS[hi] - g.trailS[lo]);
        out.x = g.trail[lo * 2] + (g.trail[hi * 2] - g.trail[lo * 2]) * t;
        out.z = g.trail[lo * 2 + 1] + (g.trail[hi * 2 + 1] - g.trail[lo * 2 + 1]) * t;
        return out;
    }

    /**
     * A fright: the group bunches and gallops off away from (x, z) (or down the wind), then pulls
     * up and stands staring back. Under Reduce motion it only stares.
     */
    fright(g, fromX, fromZ, motion = 1) {
        g.alarmX = fromX;
        g.alarmZ = fromZ;
        if (motion < 0.6 || g.ewes.length === 0) {
            this.stare(g, 0.4);
            return;
        }
        let ax = g.cx - fromX;
        let az = g.cz - fromZ;
        const al = Math.hypot(ax, az) || 1;
        ax /= al;
        az /= al;
        const away = Math.atan2(az, ax);
        const place = this.pickPlace(g, FLOCK.fleeReach, away);
        if (!place) {
            this.stare(g, 0.3);
            return;
        }
        g.mode = 'flee';
        g.modeTime = 0;
        g.fleeX = place.x;
        g.fleeZ = place.z;
        g.until = this.time + 12;
        g.members.forEach((s) => {
            // A beat to take it in (the nearer and bolder, the sooner), and they are off.
            s.followAt = this.time + 0.08 + this.rand() * 0.35;
            this.setMode(s, 'flee');
        });
    }

    /** The group stands and stares at its alarm (a gust, a fright), heads high. */
    stare(g, strength = 1) {
        g.members.forEach((s) => {
            if (s.mode === 'lie' && strength < 0.8) {
                // Lying, it only lifts its head and looks.
                /* eslint-disable no-param-reassign */
                s.lookYawGoal = wrap(Math.atan2(g.alarmX - s.x, g.alarmZ - s.z) - s.heading) * 0.6;
                s.lookPitchGoal = 0.25;
                s.next = this.time + 2 + this.rand() * 3;
                /* eslint-enable no-param-reassign */
                return;
            }
            if (s.mode === 'suckle' || s.mode === 'nurse') return;
            this.setMode(s, 'stare', (2.5 + this.rand() * 4) * (0.6 + 0.6 * strength));
        });
    }

    /** The lambs of a group race away over the hill together and come galloping home. */
    race(g, motion = 1) {
        const runners = g.lambs.filter((s) => s.mode !== 'suckle' && s.mode !== 'lie');
        if (runners.length < 1 || motion < 0.6) {
            // Too few up to race, or Reduce motion: each plays where it is.
            g.lambs.forEach((s) => this.startPlay(s, true));
            return false;
        }
        const place = this.pickPlace(g, FLOCK.raceReach);
        if (!place) return false;
        g.raceX = place.x;
        g.raceZ = place.z;
        runners.forEach((s, i) => {
            this.setMode(s, 'race', 30);
            /* eslint-disable no-param-reassign */
            s.raceLeg = 0;
            s.followAt = this.time + i * 0.25 + this.rand() * 0.3;
            /* eslint-enable no-param-reassign */
        });
        return true;
    }

    /** Lay the group down to rest (each in its own time), or get it up again. */
    rest(g, down) {
        g.members.forEach((s) => {
            if (down) {
                if (s.mode === 'lie' || s.mode === 'flee') return;
                // In the warm of the day one or two stay up grazing; when the run ends they all lie.
                if (!this.settledRest && this.rand() < 0.2) return;
                // eslint-disable-next-line no-param-reassign
                s.lieAt = this.time + 1 + this.rand() * (s.lamb ? 8 : 20) * (1.2 - s.lazy);
            } else if (s.mode === 'lie') {
                // eslint-disable-next-line no-param-reassign
                s.until = this.time + this.rand() * 10;
                // eslint-disable-next-line no-param-reassign
                s.lieAt = Infinity;
            } else {
                // eslint-disable-next-line no-param-reassign
                s.lieAt = Infinity;
            }
        });
        // eslint-disable-next-line no-param-reassign
        g.resting = down;
    }

    /** A gust of the front reaches a group: heads come up, the lambs frisk in it. */
    gust(g, strength, motion = 1) {
        const { rand } = this;
        // It came from up the wind.
        g.alarmX = g.cx - this.wind.x * 60;
        g.alarmZ = g.cz - this.wind.z * 60;
        g.members.forEach((s) => {
            if (s.lamb) {
                if (s.mode === 'suckle' || s.mode === 'race' || s.mode === 'flee') return;
                if (rand() < 0.35 + 0.5 * strength) this.startPlay(s, false, true, motion);
                return;
            }
            if (s.mode === 'lie') {
                /* eslint-disable no-param-reassign */
                s.lookYawGoal = (rand() - 0.5) * 0.8;
                s.lookPitchGoal = 0.2;
                s.next = this.time + 2 + rand() * 3;
                /* eslint-enable no-param-reassign */
                return;
            }
            if (s.mode === 'follow' || s.mode === 'flee' || s.mode === 'nurse') return;
            // Heads up, and the flightier ones trot a few steps with it.
            if (strength > 0.7 && motion > 0.6 && rand() < 0.3 * (1 - s.bold)) {
                this.setMode(s, 'walk', 4);
                /* eslint-disable no-param-reassign */
                s.walkX = s.x + this.wind.x * (3 + rand() * 5);
                s.walkZ = s.z + this.wind.z * (3 + rand() * 5);
                s.walkSpeed = FLOCK.trot * 0.8;
                /* eslint-enable no-param-reassign */
            } else this.setMode(s, 'look', 2.5 + rand() * 3 + strength * 2);
            // eslint-disable-next-line no-param-reassign
            s.lookYawGoal = wrap(Math.atan2(-this.wind.x, -this.wind.z) - s.heading) * 0.5;
        });
    }

    // ── What a lamb does ────────────────────────────────────────────────────────

    /**
     * Start a lamb playing: springs, twists, a butt at a playmate, a dash off and back. `burst` is a
     * short frisk (a gust); `still` keeps it on the spot.
     */
    startPlay(s, still = false, burst = false, motion = 1) {
        if (!s.lamb) return;
        const { rand } = this;
        this.setMode(s, 'play', 0);
        const moves = [];
        const count = burst ? 1 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 4);
        for (let i = 0; i < count; i++) {
            const roll = rand();
            if (roll < 0.42) moves.push('Pronk');
            else if (roll < 0.66) moves.push('Twist');
            else if (roll < 0.8 && !still && motion > 0.6) moves.push('dash');
            else if (roll < 0.92) moves.push('butt');
            else moves.push('Pronk');
        }
        s.play.push(...moves);
    }

    /** The lamb's next move of play, or back to its mother when it has played itself out. */
    nextPlay(s) {
        const move = s.play.shift();
        /* eslint-disable no-param-reassign */
        s.playStep = move ? { move, start: this.time, partner: -1 } : null;
        if (!move) {
            this.setMode(s, 'heel');
            return;
        }
        if (move === 'dash') {
            const a = this.rand() * TAU;
            const r = 6 + this.rand() * 9;
            const out = { x: 0, z: 0 };
            if (this.nearestAllowed(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, out, 6)) {
                s.playStep.toX = out.x;
                s.playStep.toZ = out.z;
                s.playStep.back = false;
            } else s.playStep = { move: 'Pronk', start: this.time, partner: -1 };
        } else if (move === 'butt') {
            // A playmate near enough, or a spring on its own.
            const g = this.groups[s.team];
            let mate = null;
            let near = 6;
            g.lambs.forEach((o) => {
                if (o === s || o.mode === 'suckle' || o.mode === 'lie' || o.mode === 'race') return;
                const d = Math.hypot(o.x - s.x, o.z - s.z);
                if (d < near) {
                    near = d;
                    mate = o;
                }
            });
            if (mate) {
                s.playStep.partner = mate.index;
                if (mate.mode !== 'play' || !mate.playStep || mate.playStep.move !== 'butt') {
                    this.setMode(mate, 'play');
                    mate.playStep = { move: 'butt', start: this.time, partner: s.index };
                }
            } else s.playStep = { move: 'Twist', start: this.time, partner: -1 };
        }
        /* eslint-enable no-param-reassign */
    }

    // ── Stepping ────────────────────────────────────────────────────────────────

    /**
     * Step the flock `dt` seconds.
     * @param {number} dt
     * @param {object} [env]  { fronts: [{ along, width, strength }], pool: { x, z, radius, strength },
     *                         festival, settled, motion, level, fever, mood }
     */
    step(dt, env = {}) {
        let left = Number.isFinite(dt) ? Math.max(0, Math.min(1, dt)) : 0;
        // (Substeps of at most a twentieth of a second: the steering stays smooth at any frame rate.)
        while (left > 1e-6) {
            const h = Math.min(left, 0.05);
            this.tick(h, env);
            left -= h;
        }
        this.solve();
    }

    tick(dt, env) {
        this.time += dt;
        const motion = Number.isFinite(env.motion) ? clamp01(env.motion) : 1;
        const level = clamp01(env.level ?? 0);
        const fever = clamp01(env.fever ?? 0);
        weatherAt(env.mood ?? 0, this.weather);
        this.hot = level;
        this.liveliness = (1 + 1.6 * level + 2.4 * fever) * this.weather.play;
        this.motion = motion;
        this.react(env, motion);
        this.groups.forEach((g) => this.stepGroup(g, dt, env));
        this.sheep.forEach((s) => this.think(s, dt, env));
        this.sheep.forEach((s) => this.move(s, dt));
        this.sheep.forEach((s) => this.show(s, dt));
    }

    /** What the game and the day do to the flock this step. */
    react(env, motion) {
        const { wind } = this;
        // Fronts of wind: each group reacts as one passes over it (the slot's front crosses its line).
        const fronts = Array.isArray(env.fronts) ? env.fronts : [];
        this.groups.forEach((g) => {
            const along = g.cx * wind.x + g.cz * wind.z;
            for (let k = 0; k < fronts.length; k++) {
                const f = fronts[k];
                const was = g.frontAlong[k];
                if (!f || !(f.strength > 0.05) || !Number.isFinite(f.along)) {
                    g.frontAlong[k] = undefined;
                    continue;
                }
                if (was !== undefined && was < along && f.along >= along) {
                    if (f.strength >= 0.94) this.fright(g, g.cx - wind.x * 80, g.cz - wind.z * 80, motion);
                    else this.gust(g, f.strength, motion);
                }
                g.frontAlong[k] = f.along;
            }
        });
        // The kite festival: every group's lambs race.
        const festival = clamp01(env.festival ?? 0);
        if (festival > 0.6 && this.festivalWas <= 0.6) this.groups.forEach((g) => this.race(g, motion));
        this.festivalWas = festival;
        // A pool of sunlight: the lambs it crosses gambol in it.
        const { pool } = env;
        if (pool && pool.strength > 0.3) {
            this.groups.forEach((g) => {
                if (Math.hypot(g.cx - pool.x, g.cz - pool.z) > pool.radius) return;
                g.lambs.forEach((s) => {
                    if (s.mode === 'heel' && this.rand() < 0.02 * pool.strength) {
                        this.startPlay(s, false, false, motion);
                    }
                });
            });
        }
        // The run is over: they lie down; a new one gets them up.
        const settled = env.settled === true;
        const resting = settled || this.weather.rest > 0.35;
        if (resting !== this.restWas) {
            this.settledRest = settled;
            this.groups.forEach((g) => {
                // Some groups lie in the afternoon's warm, all of them when the run ends.
                const share = settled ? 1 : this.weather.rest;
                // (The golden ratio spreads them, so one of the two near groups keeps grazing.)
                const lies = settled || (g.index * 0.618 + 0.7) % 1 < share;
                this.rest(g, resting && lies);
            });
            this.restWas = resting;
        }
        this.settledWas = settled;
        // After the rain they shake the wet out of their fleeces.
        if (this.weather.index !== this.weatherWas) {
            if (this.weather.index === 4 && this.weatherWas >= 0) {
                this.sheep.forEach((s) => {
                    // eslint-disable-next-line no-param-reassign
                    s.shakeAt = this.time + 2 + this.rand() * 40;
                });
            }
            this.weatherWas = this.weather.index;
        }
    }

    stepGroup(g, dt) {
        /* eslint-disable no-param-reassign */
        g.modeTime += dt;
        const { land, rand } = this;
        if (g.mode === 'graze') {
            // The grazing ground drifts over the pasture, and turns from what is not grass.
            if (this.time > g.driftUntil) {
                g.drift += (rand() - 0.5) * 1.6;
                g.driftUntil = this.time + 20 + rand() * 40;
            }
            const speed = FLOCK.drift * (1 - 0.8 * this.weather.shelter) * (g.resting ? 0.1 : 1);
            const lookX = g.cx + Math.cos(g.drift) * 14;
            const lookZ = g.cz + Math.sin(g.drift) * 14;
            const homeward = Math.hypot(lookX - g.home.x, lookZ - g.home.z) > 55;
            if (!land.allowed(lookX, lookZ) || (land.seen && !land.seen(lookX, lookZ)) || homeward
                || !this.apart(g, lookX, lookZ)) {
                // Turn toward home, a little either side.
                g.drift = Math.atan2(g.home.z - g.cz, g.home.x - g.cx) + (rand() - 0.5) * 1.2;
            }
            g.cx += Math.cos(g.drift) * speed * dt;
            g.cz += Math.sin(g.drift) * speed * dt;
            // A group that has got out of sight (over a crest, after a fright) walks back into it.
            g.unseen = land.seen && !land.seen(g.cx, g.cz) ? (g.unseen || 0) + dt : 0;
            if (g.unseen > 25 && !g.resting) {
                g.unseen = 0;
                this.moveOn(g, Math.atan2(g.home.z - g.cz, g.home.x - g.cx));
            }
            // Now and then the group moves on to fresh grass.
            if (this.time > g.nextMove && !g.resting) {
                g.nextMove = this.time + 200 + rand() * 320;
                this.moveOn(g);
            }
            // The lambs race now and then, more in the evening light and when play runs hot.
            if (this.time > g.nextRace) {
                g.nextRace = this.time + (90 + rand() * 200) / Math.max(0.3, this.liveliness);
                const races = rand() < 0.35 * Math.min(2, this.liveliness);
                if (g.lambs.length >= 2 && !g.resting && races) this.race(g, this.motion);
            }
        } else if (g.mode === 'move') {
            const leader = this.sheep[g.leader];
            this.extendTrail(g, leader.x, leader.z);
            const arrived = Math.hypot(leader.x - g.targetX, leader.z - g.targetZ) < 2;
            if (arrived || g.modeTime > 150) {
                g.mode = 'graze';
                g.cx = g.targetX;
                g.cz = g.targetZ;
                g.modeTime = 0;
                this.placeSpots(g);
                // The file spreads out to graze as each comes up.
                g.ewes.forEach((s) => {
                    if (s.mode === 'follow') {
                        s.until = this.time + s.queue * 1.2 + rand() * 2;
                    }
                });
            }
        } else if (g.mode === 'flee') {
            // Where the bunch is now.
            let x = 0;
            let z = 0;
            g.members.forEach((s) => {
                x += s.x;
                z += s.z;
            });
            x /= g.members.length;
            z /= g.members.length;
            const still = g.members.every((s) => s.mode !== 'flee');
            if (still || this.time > g.until) {
                g.mode = 'graze';
                g.modeTime = 0;
                g.cx = x;
                g.cz = z;
                this.placeSpots(g);
            }
        }
        /* eslint-enable no-param-reassign */
    }

    /** What a sheep means to do this step: its goal, its pace, the way it faces, where it looks. */
    think(s, dt) {
        /* eslint-disable no-param-reassign */
        s.modeTime += dt;
        const g = this.groups[s.team];
        const { rand, time } = this;
        const spot = this.spotScratch || (this.spotScratch = { x: 0, z: 0 });
        // Things that come on in their own time: lying down to rest, a shake after the rain.
        if (s.lieAt !== undefined && time > s.lieAt && s.mode !== 'lie' && s.mode !== 'flee' && s.mode !== 'follow'
            && s.mode !== 'suckle' && s.mode !== 'race') {
            s.lieAt = undefined;
            this.setMode(s, 'lie', 0);
        }
        const still = s.mode === 'graze' || s.mode === 'look' || s.mode === 'heel';
        if (s.shakeAt !== undefined && time > s.shakeAt && still) {
            s.shakeAt = undefined;
            this.setMode(s, 'shake', SHEEP_ACTS.Shake);
        }
        s.goalSpeed = 0;
        s.faceHeading = null;
        switch (s.mode) {
        case 'graze': {
            if (time > s.spotUntil) {
                s.spotAngle = rand() * TAU;
                s.spotRadius = Math.sqrt(rand());
                s.spotUntil = time + 25 + rand() * 50;
            }
            this.spotOf(s, spot);
            const far = Math.hypot(spot.x - s.x, spot.z - s.z);
            if (far > 10) {
                // Left behind: up with its head and after them.
                this.setMode(s, 'walk', 0);
                s.goalX = spot.x;
                s.goalZ = spot.z;
                break;
            }
            if (time > s.next) {
                s.next = time + 2.5 + rand() * 4.5;
                const roll = rand();
                const looks = 0.1 * this.weather.look * (1 + this.hot);
                if (roll < looks) {
                    this.setMode(s, 'look', 3 + rand() * 8);
                    break;
                }
                if (roll < looks + 0.006 * this.weather.shake) {
                    this.setMode(s, 'shake', SHEEP_ACTS.Shake);
                    break;
                }
                if (roll < looks + 0.006 * this.weather.shake + 0.008) {
                    this.setMode(s, 'scratch', SHEEP_ACTS.Scratch);
                    break;
                }
                // A stride or two on, toward its place or wherever the grass looks good.
                s.creepUntil = time + 0.8 + rand() * 2.4;
                if (this.weather.shelter > 0.5 && far < 5) {
                    // Before the showers it grazes on down the wind, its back to it.
                    const a = Math.atan2(this.wind.x, this.wind.z) + (rand() - 0.5) * 0.7;
                    s.creepX = s.x + Math.sin(a) * 2;
                    s.creepZ = s.z + Math.cos(a) * 2;
                } else if (far > 1.8) {
                    s.creepX = spot.x;
                    s.creepZ = spot.z;
                } else {
                    const a = s.heading + (rand() - 0.5) * 1.6;
                    s.creepX = s.x + Math.sin(a) * 2;
                    s.creepZ = s.z + Math.cos(a) * 2;
                }
            }
            if (time < s.creepUntil) {
                s.goalX = s.creepX;
                s.goalZ = s.creepZ;
                s.goalSpeed = FLOCK.creep * (0.8 + 0.4 * s.lazy);
            } else {
                s.goalX = s.x;
                s.goalZ = s.z;
            }
            // Before the showers they stand with their backs to the wind.
            if (this.weather.shelter > 0.5) s.faceHeading = Math.atan2(this.wind.x, this.wind.z);
            break;
        }
        case 'look': {
            if (time > s.next) {
                s.next = time + 1.2 + rand() * 2.8;
                s.lookYawGoal = (rand() - 0.5) * 1.6;
                s.lookPitchGoal = (rand() - 0.3) * 0.15;
            }
            s.goalX = s.x;
            s.goalZ = s.z;
            if (s.until && time > s.until) this.setMode(s, s.lamb ? 'heel' : 'graze');
            break;
        }
        case 'walk': {
            if (s.walkX !== undefined) {
                s.goalX = s.walkX;
                s.goalZ = s.walkZ;
            } else {
                this.spotOf(s, spot);
                s.goalX = spot.x;
                s.goalZ = spot.z;
            }
            const far = Math.hypot(s.goalX - s.x, s.goalZ - s.z);
            s.goalSpeed = s.walkSpeed || Math.min(far > 14 ? FLOCK.hurry : FLOCK.walk, 0.35 + far * 0.5);
            if (far < 1.2 || (s.until && time > s.until)) this.setMode(s, 'graze');
            break;
        }
        case 'lie': {
            s.goalX = s.x;
            s.goalZ = s.z;
            if (time > s.next) {
                s.next = time + 3 + rand() * 9;
                s.lookYawGoal = (rand() - 0.5) * 1.1;
                s.lookPitchGoal = 0.05 + rand() * 0.1;
            }
            // A lamb gets up when its mother does and goes after her.
            const mother = s.lamb && s.mother >= 0 ? this.sheep[s.mother] : null;
            const left = mother && Math.hypot(mother.x - s.x, mother.z - s.z) > 6 && mother.mode !== 'lie';
            const restOver = !g.resting && (!s.until || time > s.until);
            if (!s.until && !g.resting) s.until = time + 60 + rand() * 120 * (0.5 + s.lazy);
            if (left || (restOver && s.until && time > s.until)) this.setMode(s, 'rise', SHEEP_ACTS.Rise);
            break;
        }
        case 'rise': {
            s.goalX = s.x;
            s.goalZ = s.z;
            if (time > s.until) {
                if (!s.lamb && rand() < 0.55) this.setMode(s, 'stretch', SHEEP_ACTS.Stretch);
                else this.setMode(s, s.lamb ? 'heel' : 'graze');
            }
            break;
        }
        case 'stretch':
        case 'shake':
        case 'scratch': {
            s.goalX = s.x;
            s.goalZ = s.z;
            if (time > s.until) this.setMode(s, s.lamb ? 'heel' : 'graze');
            break;
        }
        case 'nurse': {
            s.goalX = s.x;
            s.goalZ = s.z;
            const lambStill = s.lambs.some((i) => this.sheep[i].mode === 'suckle');
            if (!lambStill && s.modeTime > 1) this.setMode(s, 'graze');
            break;
        }
        case 'stare': {
            s.goalX = s.x;
            s.goalZ = s.z;
            s.faceHeading = Math.atan2(g.alarmX - s.x, g.alarmZ - s.z);
            s.lookYawGoal = 0;
            s.lookPitchGoal = 0;
            if (!s.lamb && !s.stamped && s.modeTime > 1 && rand() < 0.01 * (1 - s.bold) * 10 * dt) {
                s.stamped = true;
                s.stampAt = time;
            }
            if (s.until && time > s.until) {
                s.stamped = false;
                this.setMode(s, s.lamb ? 'heel' : 'look', s.lamb ? 0 : 2 + rand() * 4);
            }
            break;
        }
        case 'flee': {
            if (time < (s.followAt ?? 0)) {
                s.goalX = s.x;
                s.goalZ = s.z;
                s.faceHeading = Math.atan2(g.alarmX - s.x, g.alarmZ - s.z);
                break;
            }
            if (s.lamb && s.mother >= 0) {
                const m = this.sheep[s.mother];
                s.goalX = m.x - Math.sin(m.heading) * 1.1 + Math.cos(m.heading) * 0.6;
                s.goalZ = m.z - Math.cos(m.heading) * 1.1 - Math.sin(m.heading) * 0.6;
            } else {
                const a = s.spotAngle;
                const r = 2.5 * s.spotRadius;
                s.goalX = g.fleeX + Math.cos(a) * r;
                s.goalZ = g.fleeZ + Math.sin(a) * r;
            }
            const far = Math.hypot(s.goalX - s.x, s.goalZ - s.z);
            const top = s.lamb ? FLOCK.lambRun : FLOCK.run * (0.92 + 0.12 * s.bold);
            s.goalSpeed = Math.min(top, 0.25 + far * 0.55);
            const motherStill = s.lamb && s.mother >= 0 && this.sheep[s.mother].mode !== 'flee';
            if ((!s.lamb && far < 1.6 && s.speed < 1.2) || (motherStill && far < 2) || s.modeTime > 14) {
                this.setMode(s, 'stare', 3 + rand() * 6);
            }
            break;
        }
        case 'follow': {
            if (g.mode !== 'move') {
                if (!s.until || time > s.until) this.setMode(s, 'graze');
                this.spotOf(s, spot);
                s.goalX = spot.x;
                s.goalZ = spot.z;
                s.goalSpeed = FLOCK.walk * 0.7;
                break;
            }
            if (time < (s.followAt ?? 0)) {
                // Not off yet: still grazing, the head coming up (or getting up off the grass).
                s.goalX = s.x;
                s.goalZ = s.z;
                break;
            }
            if (s.index === g.leader) {
                s.goalX = g.targetX;
                s.goalZ = g.targetZ;
                s.goalSpeed = FLOCK.walk * 0.95;
                break;
            }
            const leader = this.sheep[g.leader];
            const along = g.trailS[Math.max(0, g.trailLength - 1)] + Math.hypot(
                leader.x - g.trail[(g.trailLength - 1) * 2],
                leader.z - g.trail[(g.trailLength - 1) * 2 + 1],
            );
            // Its place in the file; it joins the line where it is nearest it, and walks on along it.
            const want = along - s.queue * FLOCK.file;
            const onto = this.nearestOnTrail(g, s.x, s.z);
            if (want < onto - 1.5) {
                // Ahead of its place: it waits for the ones before it to go by.
                s.goalX = s.x;
                s.goalZ = s.z;
                break;
            }
            this.trailAt(g, Math.min(want, onto + 2), spot);
            s.goalX = spot.x;
            s.goalZ = spot.z;
            const far = Math.hypot(spot.x - s.x, spot.z - s.z) + Math.max(0, want - onto - 2);
            // Catching up the file at a trot, then walking in it at the leader's pace.
            s.goalSpeed = far > 6 ? FLOCK.trot * 0.8 : Math.min(FLOCK.hurry, FLOCK.walk * 0.6 + far * 0.25);
            if (far < 0.4) s.goalSpeed = FLOCK.walk * 0.5;
            break;
        }
        case 'heel': {
            this.thinkLamb(s, g, spot);
            break;
        }
        case 'suckle': {
            const m = this.sheep[s.mother];
            // Alongside her, head to her tail, its muzzle at her udder.
            const side = s.suckleSide || 1;
            const fx = Math.sin(m.heading);
            const fz = Math.cos(m.heading);
            const lx = Math.cos(m.heading);
            const lz = -Math.sin(m.heading);
            const k = m.scale;
            s.goalX = m.x + lx * side * 0.42 * k + fx * 0.2 * k;
            s.goalZ = m.z + lz * side * 0.42 * k + fz * 0.2 * k;
            const far = Math.hypot(s.goalX - s.x, s.goalZ - s.z);
            s.goalSpeed = far > 3 ? FLOCK.lambTrot : Math.min(0.9, 0.15 + far * 0.8);
            s.faceHeading = far < 1.2 ? m.heading + Math.PI - side * 0.35 : null;
            s.suckling = far < 0.35;
            if (s.suckling && m.mode !== 'nurse' && m.mode !== 'lie' && m.mode !== 'flee') this.setMode(m, 'nurse');
            if ((s.until && time > s.until) || m.mode === 'lie' || m.mode === 'flee' || m.mode === 'follow') {
                s.suckling = false;
                if (rand() < 0.4 * this.liveliness) this.startPlay(s, false, false, this.motion);
                else this.setMode(s, 'heel');
            }
            break;
        }
        case 'play': {
            this.thinkPlay(s, g);
            break;
        }
        case 'race': {
            const out = s.raceLeg === 0;
            if (time < (s.followAt ?? 0)) {
                s.goalX = s.x;
                s.goalZ = s.z;
                break;
            }
            const m = s.mother >= 0 ? this.sheep[s.mother] : null;
            const homeX = m ? m.x : g.cx;
            const homeZ = m ? m.z : g.cz;
            s.goalX = out ? g.raceX + (s.playful - 0.5) * 4 : homeX;
            s.goalZ = out ? g.raceZ + (s.look - 0.5) * 4 : homeZ;
            const far = Math.hypot(s.goalX - s.x, s.goalZ - s.z);
            s.goalSpeed = Math.min(FLOCK.lambRun * (0.8 + 0.25 * s.playful), 0.6 + far * 0.6);
            if (out && far < 2.5) {
                s.raceLeg = 1;
                // A spring for joy at the turn.
                s.raceLeap = time;
            }
            if (!out && far < 2.5) {
                if (rand() < 0.5) this.startPlay(s, true, true, this.motion);
                else this.setMode(s, 'heel');
            }
            if (s.until && time > s.until) this.setMode(s, 'heel');
            break;
        }
        default:
            break;
        }
        // Where it looks drifts toward where it means to look.
        const ease = 1 - Math.exp(-dt * 2.2);
        s.lookYaw += (s.lookYawGoal - s.lookYaw) * ease;
        s.lookPitch += (s.lookPitchGoal - s.lookPitch) * ease;
        if (s.mode !== 'look' && s.mode !== 'lie') {
            s.lookYawGoal *= 1 - Math.min(1, dt * 1.5);
            s.lookPitchGoal *= 1 - Math.min(1, dt * 1.5);
        }
        /* eslint-enable no-param-reassign */
    }

    /** A lamb about its mother: at heel, nibbling, lying by her, off to suckle or to play. */
    thinkLamb(s, g, spot) {
        /* eslint-disable no-param-reassign */
        const { rand, time } = this;
        const m = s.mother >= 0 ? this.sheep[s.mother] : null;
        if (!m) {
            this.spotOf(s, spot);
            s.goalX = spot.x;
            s.goalZ = spot.z;
            s.goalSpeed = Math.min(FLOCK.walk, Math.hypot(spot.x - s.x, spot.z - s.z) * 0.4);
            return;
        }
        if (time > s.spotUntil) {
            // Beside or behind her, a little way off.
            s.spotAngle = Math.PI + (rand() - 0.5) * 2.6;
            s.spotRadius = 0.9 + rand() * 1.8;
            s.spotUntil = time + 8 + rand() * 14;
        }
        const a = m.heading + s.spotAngle;
        s.goalX = m.x + Math.sin(a) * s.spotRadius * m.scale;
        s.goalZ = m.z + Math.cos(a) * s.spotRadius * m.scale;
        const far = Math.hypot(s.goalX - s.x, s.goalZ - s.z);
        if (far > 4) s.goalSpeed = Math.min(FLOCK.lambTrot * (far > 10 ? 1.6 : 1), 0.4 + far * 0.4);
        else if (far > 1.2) s.goalSpeed = Math.min(FLOCK.walk * 0.8, 0.2 + far * 0.3);
        else s.goalSpeed = 0;
        if (m.mode === 'lie' && far < 3 && rand() < 0.02) {
            this.setMode(s, 'lie', 0);
            return;
        }
        if (time > s.next) {
            s.next = time + 3 + rand() * 6;
            const roll = rand();
            const lively = this.liveliness * (0.4 + s.playful);
            if (roll < 0.06 * lively) {
                this.startPlay(s, false, false, this.motion);
                return;
            }
            const hungry = m.mode === 'graze' || m.mode === 'look' || m.mode === 'walk';
            if (roll < 0.06 * lively + 0.035 && hungry && far < 6) {
                this.setMode(s, 'suckle', 15 + rand() * 25);
                s.suckleSide = rand() < 0.5 ? 1 : -1;
                return;
            }
            if (roll > 0.94 && !g.resting) this.setMode(s, 'lie', 25 + rand() * 60);
            // Nibbling, or standing about chewing.
            s.nibbles = rand() < 0.6;
        }
        /* eslint-enable no-param-reassign */
    }

    /** A lamb at play: each move in turn. */
    thinkPlay(s) {
        /* eslint-disable no-param-reassign */
        const { time } = this;
        if (!s.playStep) this.nextPlay(s);
        const step = s.playStep;
        if (!step) return;
        const t = time - step.start;
        s.goalX = s.x;
        s.goalZ = s.z;
        switch (step.move) {
        case 'Pronk':
        case 'Twist':
            // Springing on the spot, or carried on by the speed it had.
            if (t > SHEEP_ACTS[step.move] + 0.1) this.nextPlay(s);
            break;
        case 'dash': {
            // Off at a gallop, and straight back to its mother.
            const m = s.mother >= 0 ? this.sheep[s.mother] : null;
            if (step.back && m) {
                s.goalX = m.x - Math.sin(m.heading) * 1.2;
                s.goalZ = m.z - Math.cos(m.heading) * 1.2;
            } else {
                s.goalX = step.toX;
                s.goalZ = step.toZ;
            }
            const far = Math.hypot(s.goalX - s.x, s.goalZ - s.z);
            s.goalSpeed = Math.min(FLOCK.lambRun * 0.85, 0.8 + far * 0.7);
            if (!step.back && far < 1.5) step.back = true;
            if ((step.back && far < 2) || t > 9) this.nextPlay(s);
            break;
        }
        case 'butt': {
            const mate = step.partner >= 0 ? this.sheep[step.partner] : null;
            if (!mate || t > 3.2) {
                this.nextPlay(s);
                break;
            }
            // Face each other a body's length apart, then the butt.
            const dx = mate.x - s.x;
            const dz = mate.z - s.z;
            const d = Math.hypot(dx, dz) || 1;
            s.faceHeading = Math.atan2(dx, dz);
            const want = 0.75 * s.scale;
            s.goalX = s.x + (dx / d) * (d - want);
            s.goalZ = s.z + (dz / d) * (d - want);
            s.goalSpeed = Math.min(FLOCK.lambTrot, Math.abs(d - want) * 1.2);
            break;
        }
        default:
            this.nextPlay(s);
        }
        /* eslint-enable no-param-reassign */
    }

    /** Steer and carry a sheep a step: turning as its legs let it, speeding up and slowing down. */
    move(s, dt) {
        /* eslint-disable no-param-reassign */
        const { land } = this;
        const dx = s.goalX - s.x;
        const dz = s.goalZ - s.z;
        const far = Math.hypot(dx, dz);
        let want = s.goalSpeed;
        let face = s.faceHeading;
        if (want > 0 && far > 0.05) face = Math.atan2(dx, dz);
        else want = 0;
        // Room: it keeps its distance from the others of its group (a lamb at the udder excepted).
        const g = this.groups[s.team];
        let px = 0;
        let pz = 0;
        const mine = s.lamb ? FLOCK.lambSpace : FLOCK.space;
        for (const o of g.members) {
            if (o === s) continue;
            const room = (mine + (o.lamb ? FLOCK.lambSpace : FLOCK.space)) * 0.5 * (s.scale / SHEEP_SCALE);
            const ox = s.x - o.x;
            const oz = s.z - o.z;
            const d = Math.hypot(ox, oz);
            if (d > room || d < 1e-4) continue;
            const suckling = (s.mode === 'suckle' && o.index === s.mother)
                || (o.mode === 'suckle' && o.mother === s.index);
            if (suckling) continue;
            if (s.mode === 'play' && s.playStep?.move === 'butt' && o.index === s.playStep.partner) continue;
            const push = (room - d) / room;
            px += (ox / d) * push;
            pz += (oz / d) * push;
        }
        // (Standing to face something, it bears a neighbour close by rather than turn away.)
        const bears = want === 0 && s.faceHeading !== null && px * px + pz * pz < 0.25;
        if ((px !== 0 || pz !== 0) && !bears) {
            // Crowded: a step aside (a standing sheep shuffles; a moving one steers off).
            const vx = (want > 0 ? Math.sin(face) * want : 0) + px * 1.1;
            const vz = (want > 0 ? Math.cos(face) * want : 0) + pz * 1.1;
            const v = Math.hypot(vx, vz);
            if (v > 0.05) {
                want = Math.max(want, Math.min(0.45, v));
                face = Math.atan2(vx, vz);
            }
        }
        // The ground: it turns from what is not grass.
        if (want > 0 && face !== null) {
            const look = 0.9 + s.speed * 0.7;
            if (!land.allowed(s.x + Math.sin(face) * look, s.z + Math.cos(face) * look)) {
                let found = null;
                for (let k = 1; k <= 6 && found === null; k++) {
                    for (const side of [1, -1]) {
                        const a = face + side * k * 0.45;
                        if (land.allowed(s.x + Math.sin(a) * look, s.z + Math.cos(a) * look)) {
                            found = a;
                            break;
                        }
                    }
                }
                if (found === null) want = 0;
                else face = found;
            }
        }
        // Turning: quick on the spot, wider at speed.
        let turn = 0;
        if (face !== null) {
            const off = wrap(face - s.heading);
            const fast = clamp01(s.speed / FLOCK.run);
            const rate = s.speed < 0.3 ? FLOCK.turnStill : FLOCK.turnWalk + (FLOCK.turnRun - FLOCK.turnWalk) * fast;
            const lamb = s.lamb ? 1.5 : 1;
            turn = Math.max(-rate * lamb * dt, Math.min(rate * lamb * dt, off * Math.min(1, dt * 4)));
            // Facing well away from where it means to go, it turns before it goes.
            want *= smooth(1.4, 0.5, Math.abs(off));
        }
        s.heading = wrap(s.heading + turn);
        s.turning = dt > 0 ? turn / dt : 0;
        // Speeding up and pulling up.
        const running = Math.max(want, s.speed) > FLOCK.trot;
        const accel = running ? FLOCK.accelRun : FLOCK.accelWalk;
        const brake = running ? FLOCK.brakeRun : FLOCK.brakeWalk;
        const dv = want - s.speed;
        s.speed += Math.max(-brake * dt, Math.min(accel * dt, dv));
        if (s.speed < 0.01 && want === 0) s.speed = 0;
        // (Leaping, it carries on with the speed it had; on the grass it goes where its feet go.)
        const step = s.speed * dt;
        const nx = s.x + Math.sin(s.heading) * step;
        const nz = s.z + Math.cos(s.heading) * step;
        if (land.allowed(nx, nz) || !land.allowed(s.x, s.z)) {
            s.x = nx;
            s.z = nz;
        } else s.speed *= 0.5;
        s.y = land.ground(s.x, s.z);
        // The gait: its phase is the ground covered over its stride (turning on the spot steps too).
        const model = s.speed / s.scale;
        const { size } = s.rig;
        const stride = sheepStride(model, size) * s.scale;
        s.phase += (step + Math.abs(turn) * 0.35 * s.scale * size) / Math.max(0.05, stride);
        // The gait eases (a lamb's quicker), so the legs fall into a new step over a stride.
        const gaitWant = sheepGaitAt(model, size);
        s.gait += (gaitWant - s.gait) * (1 - Math.exp(-dt * (s.lamb ? 5 : 3)));
        /* eslint-enable no-param-reassign */
    }

    /** The act a sheep shows for its mode and its pace. */
    actFor(s) {
        // (What it means to do, not how fast it is going yet: no act flickers at a threshold.)
        const moving = s.goalSpeed > 0.4;
        switch (s.mode) {
        case 'graze':
            return 'Graze';
        case 'look':
            return 'Chew';
        case 'walk':
        case 'flee':
            return 'Walk';
        case 'follow':
            if (s.risingAt !== undefined && this.time - s.risingAt < SHEEP_ACTS.Rise) return 'Rise';
            if (this.time < (s.followAt ?? 0)) return this.time > (s.followAt ?? 0) - 0.9 ? 'Chew' : 'Graze';
            return 'Walk';
        case 'lie':
            return 'Lie';
        case 'rise':
            return 'Rise';
        case 'stretch':
            return 'Stretch';
        case 'shake':
            return 'Shake';
        case 'scratch':
            return 'Scratch';
        case 'nurse':
            return 'Nurse';
        case 'suckle':
            return s.suckling ? 'Suckle' : 'Walk';
        case 'stare':
            return s.stamped && this.time - s.stampAt < SHEEP_ACTS.Stamp ? 'Stamp' : 'Stare';
        case 'play': {
            const move = s.playStep?.move;
            if (move === 'Pronk' || move === 'Twist') return move;
            if (move === 'butt') {
                const mate = s.playStep.partner >= 0 ? this.sheep[s.playStep.partner] : null;
                const near = mate && Math.hypot(mate.x - s.x, mate.z - s.z) < 1.1 * s.scale;
                return near ? 'Butt' : 'Walk';
            }
            return 'Walk';
        }
        case 'race':
            if (s.raceLeap !== undefined && this.time - s.raceLeap < SHEEP_ACTS.Pronk) return 'Pronk';
            if (this.time < (s.followAt ?? 0)) return 'Chew';
            return 'Walk';
        case 'heel':
            if (moving) return 'Walk';
            return s.nibbles ? 'Graze' : 'Chew';
        default:
            return moving ? 'Walk' : 'Stand';
        }
    }

    /** What it shows: the act (cross-faded from wherever the last had got to), its lift, its tail. */
    show(s, dt) {
        /* eslint-disable no-param-reassign */
        const act = this.actFor(s);
        if (act !== s.act) {
            // Start from the pose it is in this instant.
            const p = s.pose;
            p.act = s.act;
            p.actTime = s.actTime;
            p.blend = s.blend;
            p.fromSpec = s.blend < 1 ? s.fromSpec : null;
            s.rig.posture(p, s.fromSpec);
            const quick = s.mode === 'flee' || s.mode === 'stare' || act === 'Pronk' || act === 'Twist'
                || act === 'Butt'
                || s.mode === 'play' || s.mode === 'race';
            s.blendRate = 1 / (quick ? FLOCK.quickBlend : FLOCK.blend);
            s.blend = 0;
            s.act = act;
            // A loop it comes back to picks up where its rhythm was (it never restarts a chew).
            s.actTime = SHEEP_LOOPS.has(act) && act !== 'Graze' ? s.actTime : 0;
        }
        s.blend = Math.min(1, s.blend + dt * s.blendRate);
        s.actTime += dt;
        // A lying sheep stays down; a one-off act holds its last pose until the flock moves on.
        if (act === 'Lie') s.actTime = Math.min(s.actTime, SHEEP_LIE_HOLD + 0.4);
        else if (!SHEEP_LOOPS.has(act)) s.actTime = Math.min(s.actTime, SHEEP_ACTS[act] ?? 1);
        s.lift = (act === 'Pronk' || act === 'Twist') ? sheepLeapHeight(act, s.actTime, s.rig.size) * s.scale : 0;
        /* eslint-enable no-param-reassign */
    }

    /** The ground's slope under a sheep (refreshed every so often: it changes slowly). */
    gradient(s) {
        /* eslint-disable no-param-reassign */
        if (this.time - s.gradAt < 0.4 && s.gradAt >= 0) return;
        s.gradAt = this.time;
        const { ground } = this.land;
        const e = 0.6;
        s.gradX = (ground(s.x + e, s.z) - ground(s.x - e, s.z)) / (2 * e);
        s.gradZ = (ground(s.x, s.z + e) - ground(s.x, s.z - e)) / (2 * e);
        /* eslint-enable no-param-reassign */
    }

    /** Resolve every sheep's pose for the rig (and solve it: `s.posture`). */
    solve() {
        const { time } = this;
        this.sheep.forEach((s) => {
            this.gradient(s);
            const p = s.pose;
            p.act = s.act;
            p.actTime = s.actTime;
            p.fromSpec = s.blend < 1 ? s.fromSpec : null;
            p.from = null;
            p.blend = s.blend;
            p.phase = s.phase;
            p.speed = s.speed;
            p.gait = s.gait;
            // It strides when it moves, and steps round when it turns on the spot.
            const leaping = s.act === 'Pronk' || s.act === 'Twist';
            p.amp = leaping ? 0 : smooth(0.02, 0.25, s.speed);
            p.step = leaping ? 0 : clamp01(Math.abs(s.turning) * 0.8);
            // Chewing the cud lying down; looking about.
            const chew = s.act === 'Lie' ? 0.025 * Math.sin(TAU * 1.5 * (time + s.look * 3)) : 0;
            p.lookYaw = s.lookYaw;
            p.lookPitch = s.lookPitch + chew;
            // A lamb's tail goes when it is pleased (the suckle wags its own).
            const wag = s.mode === 'heel' ? 0.3 : 0.8;
            p.tailWag = s.lamb && s.act !== 'Suckle' ? 0.25 * Math.sin(TAU * 3.1 * time + s.look * 9) * wag : 0;
            p.breath = Math.sin(TAU * (s.act === 'Lie' ? 0.25 : 0.35) * time + s.look * 6.3)
                * (1 + 2 * clamp01((s.speed - 2) / 3));
            // The ground under each hoof, against the ground under its middle (model metres).
            const sin = Math.sin(s.heading);
            const cos = Math.cos(s.heading);
            const { marks } = s.rig;
            ['pawFL', 'pawFR', 'pawBL', 'pawBR'].forEach((name, i) => {
                const m = marks[name];
                // The mark (model: x left, z ahead) on the ground: world offset = R(heading)·(x, z).
                const wx = (m[0] * cos + m[2] * sin) * s.scale;
                const wz = (-m[0] * sin + m[2] * cos) * s.scale;
                p.feet[i] = (s.gradX * wx + s.gradZ * wz) / s.scale;
            });
            s.rig.spec(p, s.spec);
            s.rig.solve(s.spec, s.posture);
        });
    }

    // ── Asking ──────────────────────────────────────────────────────────────────

    /** The playground's (and a test's) way to make something happen now. */
    force(kind, groupIndex = -1) {
        const groups = groupIndex >= 0 && this.groups[groupIndex] ? [this.groups[groupIndex]] : this.groups;
        groups.forEach((g) => {
            const { wind } = this;
            if (kind === 'move') this.moveOn(g);
            else if (kind === 'flee') this.fright(g, g.cx - wind.x * 80, g.cz - wind.z * 80, 1);
            else if (kind === 'gust') this.gust(g, 0.8, 1);
            else if (kind === 'race') this.race(g, 1);
            else if (kind === 'rest') this.rest(g, true);
            else if (kind === 'rise') this.rest(g, false);
            else if (kind === 'play') g.lambs.forEach((s) => this.startPlay(s));
            else if (kind === 'shake') {
                g.members.forEach((s) => {
                    // eslint-disable-next-line no-param-reassign
                    s.shakeAt = this.time + this.rand() * 6;
                });
            } else if (kind === 'stare') {
                // eslint-disable-next-line no-param-reassign
                g.alarmX = 0;
                // eslint-disable-next-line no-param-reassign
                g.alarmZ = 0;
                this.stare(g, 1);
            }
        });
    }

    /** A new level: a group or two (the nearest that are grazing) move on to fresh grass. */
    onLevel() {
        const grazing = this.groups.filter((g) => g.mode === 'graze' && !g.resting && g.ewes.length > 1);
        grazing.slice(0, 2).forEach((g) => this.moveOn(g));
    }

    /** How many are doing what (for diagnostics and tests). */
    census() {
        const out = {};
        this.sheep.forEach((s) => {
            out[s.mode] = (out[s.mode] || 0) + 1;
        });
        return out;
    }
}
