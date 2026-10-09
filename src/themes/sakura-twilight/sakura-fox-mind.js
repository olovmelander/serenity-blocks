/**
 * Sakura Twilight — what the two foxes do. Three-free and renderer-free: each is a fox mind
 * (../shared/fox-mind.js) on these foxes' own rig (sakura-fox-rig.js), given the garden's
 * ground to go over; sakura-foxes.js draws the poses this resolves.
 *
 * They keep to the stepping-stone path across the knoll, out along the water's side of it and
 * back along the near side, and they stop where the stone lanterns stand: to sit in the
 * lantern's light and look up at the moon, to look about, to stretch — or, having heard
 * something in the grass, to listen with a paw raised, leap on it nose first, dig it out and
 * shake themselves off. They are a pair: when one is near the other it looks round at it, and
 * when one settles the other soon does.
 *
 * The garden moves them too: the stream of petals a chain winds up sets them running, a hard
 * gust or a big clear startles them into a dash, four lines sends them leaping high over the
 * grass one after the other, and when the wind dies and the lanterns burn low they curl up and
 * sleep.
 */

import { FoxMind, MOUSING, foxCourse } from '../shared/fox-mind.js';
import { createSakuraFoxRig } from './sakura-fox-rig.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (lo, hi, v) => {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
};

/** How far to either side of the middle the path is walked (m), and the pair: its scale, where it starts. */
export const SAKURA_FOX_REACH = 9.6;
export const SAKURA_FOX_PAIR = Object.freeze([
    Object.freeze({ scale: 1.12, start: 0.06, seed: 0x5a17 }),
    Object.freeze({ scale: 0.98, start: 0.56, seed: 0x1c3b }),
]);
/**
 * Where the stone lanterns by the path stand (x, z): the foxes stop beside them, and go round
 * them (sakura-composition.js places them; a test holds the two to each other).
 */
export const SAKURA_FOX_LANTERNS = Object.freeze([Object.freeze([-6.4, 2.1]), Object.freeze([7.8, 2.2])]);

/** How far the two lanes lie from the middle of the path: wider toward its ends, where they join. */
const laneOff = (x) => 0.5 + 0.6 * smooth(SAKURA_FOX_REACH - 3, SAKURA_FOX_REACH, Math.abs(x));

/** How near the course passes a lantern (m): its foot, and a fox turned side-on to the path. */
const CLEAR = 1.1;
/** How far apart the lanes are by a lantern (m): one fox sits there while the other goes by. */
const APART = 0.9;
/** How far along the path, either way, a lane takes to go round a lantern (m). */
const DETOUR = 4;
/** A lane keeps to ground this far above the water (m): off the steep of the bank. */
const BANK = 0.5;
/**
 * A fox stops this far short of a lantern (m along its lane): turned side-on it is clear of the
 * stone, and the stops on the way out and on the way back are not side by side.
 */
const SHORT = 0.9;
/** How far the corners of the round are eased (passes of a three-point mean over its points). */
const EASE = 12;
/** A lantern within this of the middle of the path stands by it (m); the garden's others do not concern a fox. */
const BESIDE = 2.5;

/** A closed line of [x, z] as `count` points evenly spaced along it. */
function evenly(line, count) {
    const n = line.length;
    const run = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
        const a = line[i];
        const b = line[(i + 1) % n];
        run[i + 1] = run[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const length = run[n];
    const out = [];
    let j = 0;
    for (let i = 0; i < count; i++) {
        const d = (i / count) * length;
        while (j < n - 1 && run[j + 1] < d) j += 1;
        const t = (d - run[j]) / Math.max(1e-6, run[j + 1] - run[j]);
        const a = line[j];
        const b = line[(j + 1) % n];
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return { points: out, length };
}

/** A closed line of [x, z] with every point moved toward the middle of its two neighbours. */
function eased(line) {
    const n = line.length;
    return line.map((point, i) => {
        const a = line[(i + n - 1) % n];
        const b = line[(i + 1) % n];
        return [(a[0] + 2 * point[0] + b[0]) / 4, (a[1] + 2 * point[1] + b[1]) / 4];
    });
}

/** How near a line of [x, z] comes to a place, and where on it. */
function nearest(line, x, z, from = 0, to = line.length) {
    let best = from;
    let least = Infinity;
    for (let i = from; i < to; i++) {
        const d = Math.hypot(line[i][0] - x, line[i][1] - z);
        if (d < least) {
            least = d;
            best = i;
        }
    }
    return { index: best, distance: least };
}

/**
 * The foxes' course: out (toward +x) along the water's side of the path, round, and back along
 * the near side. Where a stone lantern stands in a lane's way the lanes go round it, whichever
 * way is least out of their way and keeps them off the water: both to one side, or one to
 * either side of it.
 * @param {object} o
 * @param {(x: number) => number} o.pathZ          z of the path's middle at x
 * @param {(x: number, z: number) => number} o.height  the ground's
 * @param {number[]} [o.viewer]  where the viewer stands (x, z)
 * @param {number} [o.count]
 * @param {ArrayLike<ArrayLike<number>>} [o.lanterns]  where the stone lanterns stand (x, z);
 *     those that are not by the path are passed over
 */
export function sakuraFoxCourse({
    pathZ, height, viewer = [0, 16], count = 400, lanterns: all = SAKURA_FOX_LANTERNS,
}) {
    const R = SAKURA_FOX_REACH;
    const straight = 320;
    const round = 40;
    // The middle of the path, and how far along it each point is.
    const middle = [];
    const along = new Float64Array(straight + 1);
    for (let i = 0; i <= straight; i++) {
        const x = -R + (2 * R * i) / straight;
        middle.push([x, pathZ(x)]);
        if (i > 0) along[i] = along[i - 1] + Math.hypot(x - middle[i - 1][0], middle[i][1] - middle[i - 1][1]);
    }
    const lanterns = Array.from(all).filter(([x, z]) => nearest(middle, x, z).distance < BESIDE);
    // The lanes: [0] the water's side (the water is toward −z), [1] the near side. A lantern
    // moves a lane across the path (`across`, toward the near side) by `by` metres where it
    // stands, and by less either way along it.
    const detours = [];
    const lane = (side) => middle.map(([x, z], i) => {
        const point = [x, z + (side ? 1 : -1) * laneOff(x)];
        detours.forEach((detour) => {
            const u = (along[i] - detour.at) / DETOUR;
            if (Math.abs(u) >= 1 || !detour.by[side]) return;
            const bell = Math.cos((Math.PI / 2) * u) ** 2;
            point[0] += detour.across[0] * detour.by[side] * bell;
            point[1] += detour.across[1] * detour.by[side] * bell;
        });
        return point;
    });
    for (let l = 0; l < lanterns.length; l++) {
        const [lx, lz] = lanterns[l];
        const foot = nearest(middle, lx, lz).index;
        const a = middle[Math.max(0, foot - 1)];
        const b = middle[Math.min(straight, foot + 1)];
        const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const across = [-(b[1] - a[1]) / span, (b[0] - a[0]) / span];
        // Where each lane passes it: metres to the near side of it (negative: the water's side).
        const passes = [0, 1].map((side) => {
            const line = lane(side);
            const hit = nearest(line, lx, lz);
            const point = line[hit.index];
            return Math.sign((point[0] - lx) * across[0] + (point[1] - lz) * across[1]) * hit.distance || hit.distance;
        });
        if (Math.abs(passes[0]) >= CLEAR && Math.abs(passes[1]) >= CLEAR) continue;
        // Both on the near side of it, one on either side, or both on the water's.
        const apart = Math.max(APART, passes[1] - passes[0]);
        const ways = [
            [Math.max(passes[0], CLEAR), Math.max(passes[1], Math.max(passes[0], CLEAR) + apart)],
            [Math.min(passes[0], -CLEAR), Math.max(passes[1], CLEAR)],
            [Math.min(passes[0], Math.min(passes[1], -CLEAR) - apart), Math.min(passes[1], -CLEAR)],
        ].map((to) => {
            const by = [to[0] - passes[0], to[1] - passes[1]];
            const dry = to.every((m) => height(lx + across[0] * m, lz + across[1] * m) >= BANK);
            return { by, dry, far: Math.max(Math.abs(by[0]), Math.abs(by[1])) };
        });
        const open = ways.filter((way) => way.dry);
        const way = (open.length ? open : ways).reduce((best, next) => (next.far < best.far ? next : best));
        const detour = { at: along[foot], across, by: way.by };
        detours.push(detour);
        // (A lane bends, so a move across the path where the lantern stands is not quite a
        // move away from it: make up what is short.)
        for (let pass = 0; pass < 4; pass++) {
            [0, 1].forEach((side) => {
                const short = CLEAR - nearest(lane(side), lx, lz).distance;
                if (short > 0.005) detour.by[side] += Math.sign(passes[side] + detour.by[side]) * (short + 0.01);
            });
        }
    }
    const lanes = [lane(0), lane(1)];
    // Out along the water's side, round at the far end, back along the near side, round again.
    const raw = [];
    const turn = (from, to) => {
        const cx = (from[0] + to[0]) / 2;
        const cz = (from[1] + to[1]) / 2;
        const radius = Math.hypot(to[0] - from[0], to[1] - from[1]) / 2;
        const start = Math.atan2(from[1] - cz, from[0] - cx);
        for (let i = 1; i < round; i++) {
            const angle = start + (Math.PI * i) / round;
            raw.push([cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius]);
        }
    };
    lanes[0].forEach((point) => raw.push(point));
    turn(lanes[0][straight], lanes[1][straight]);
    for (let i = straight; i >= 0; i--) raw.push(lanes[1][i]);
    turn(lanes[1][0], lanes[0][0]);
    // Evenly spaced, its corners eased (where a lane meets a round it would turn on the spot),
    // and evenly spaced again.
    let line = evenly(raw, count).points;
    for (let pass = 0; pass < EASE; pass++) line = eased(line);
    const even = evenly(line, count);
    const { length } = even;
    const points = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        points[i * 3] = even.points[i][0];
        points[i * 3 + 1] = even.points[i][1];
    }
    for (let i = 0; i < count; i++) {
        const a = ((i + count - 1) % count) * 3;
        const b = ((i + 1) % count) * 3;
        points[i * 3 + 2] = Math.atan2(points[b] - points[a], points[b + 1] - points[a + 1]);
    }
    // Its stopping places: a little short of each lantern, on the way out and on the way back.
    const stations = [];
    const half = count / 2;
    for (let l = 0; l < lanterns.length; l++) {
        [[0, half], [half, count]].forEach(([from, to]) => {
            const beside = nearest(even.points, lanterns[l][0], lanterns[l][1], from, to).index;
            stations.push(((((beside / count) * length - SHORT) % length) + length) % length);
        });
    }
    stations.sort((a, b) => a - b);
    return foxCourse({
        points, count, length, stations, height, viewer,
    });
}

/** What a garden fox may do when it stops: it sits by the lantern more than anything. */
const STOPS = Object.freeze([
    ['Sit'], MOUSING, ['LookAround'], ['Sit'], ['Stretch', 'LookAround'], MOUSING, ['Greet'], ['Sit'],
    ['Listen', 'LookAround'],
]);

/** How near the other has to be for one to look round at it (m). */
const NOTICE = 4.5;
/** How much of the course a fox leaves the one ahead of it (m): a fox, and a little grass. */
const ROOM = 2.6;

export class SakuraFoxMind {
    /**
     * @param {object} [o]
     * @param {(x: number) => number} [o.pathZ]   the path's z at x (flat ground when not given)
     * @param {(x: number, z: number) => number} [o.height]
     * @param {number[]} [o.viewer]  where the viewer stands (x, z)
     * @param {ArrayLike<ArrayLike<number>>} [o.lanterns]  where the stone lanterns stand (x, z)
     */
    constructor({
        pathZ = () => 0, height = () => 0, viewer = [0, 16], lanterns = SAKURA_FOX_LANTERNS,
    } = {}) {
        this.course = sakuraFoxCourse({
            pathZ, height, viewer, lanterns,
        });
        this.foxes = SAKURA_FOX_PAIR.map((plan) => {
            const rig = createSakuraFoxRig(plan.scale);
            return new FoxMind({
                rig,
                course: this.course,
                seed: plan.seed,
                start: plan.start * this.course.length,
                firstStop: 2 + plan.start * 6,
                stops: STOPS,
                paces: {
                    trot: 1.0,
                    run: (power, surge = 0) => 2.2 + 2.4 * clamp01(power) + 1.2 * Math.min(1.2, Math.max(0, surge)),
                    dash: 2.2,
                    pounce: 3.0,
                    mouse: 1.4,
                    leapHigh: 1.05 * plan.scale,
                    leapLow: 0.62 * plan.scale,
                    // (The grass keeps no prints.)
                    printStep: 0,
                    eye: 0.66 * plan.scale,
                    room: ROOM,
                },
            });
        });
        /** Each fox's pose, for whoever draws them. */
        this.poses = this.foxes.map((fox) => fox.pose);
        this.reset(0);
    }

    reset(time = 0) {
        this.foxes.forEach((fox) => fox.reset(time));
        this.leaps = [];
        this.asleep = false;
    }

    /** Where the viewer stands (the camera's place on the ground): they turn to face it. */
    setViewer(x, z) {
        this.course.viewer[0] = x;
        this.course.viewer[1] = z;
    }

    /** A hard gust, a big clear: both dash. */
    startle(strength = 1) {
        this.foxes.forEach((fox) => fox.startle(strength));
    }

    /** Four lines: they leap, one a moment after the other. */
    pounce(time) {
        this.asleep = false;
        this.leaps = this.foxes.map((fox, i) => ({ fox, at: time + i * 0.32 }));
    }

    /** The wind dies: they curl up where they are. */
    sleep(time) {
        this.asleep = true;
        this.leaps = [];
        this.foxes.forEach((fox, i) => {
            // (One settles first; the other a little after.)
            if (i === 0) fox.sleep(time);
            else this.leaps.push({ fox, at: time + 0.7, sleep: true });
        });
    }

    wake(time) {
        this.asleep = false;
        this.leaps = this.leaps.filter((leap) => !leap.sleep);
        this.foxes.forEach((fox) => fox.wake(time));
    }

    /** Stop the first fox (or both) and have it do these acts (captures, tuning). */
    rehearse(clips, time, which = 0) {
        this.foxes[which]?.rehearse(clips, time);
    }

    /** Something worth a look, for both. */
    attend(x, y, z, until, weight = 1) {
        this.foxes.forEach((fox) => fox.attend(x, y, z, until, weight));
    }

    /**
     * @param {number} dt
     * @param {number} time
     * @param {{ power: number, surge: number }} env
     */
    step(dt, time, env) {
        // What was put off a moment (the second leap, the second fox lying down).
        this.leaps = this.leaps.filter((leap) => {
            if (time < leap.at) return true;
            if (leap.sleep) leap.fox.sleep(time);
            else leap.fox.pounce(time);
            return false;
        });
        const [a, b] = this.foxes;
        // They are a pair: near each other and not asked to look elsewhere, each looks round at
        // the other; and when one has settled at a stop the other is soon minded to as well.
        const far = Math.hypot(a.pose.x - b.pose.x, a.pose.z - b.pose.z);
        if (far < NOTICE && far > 0.4) {
            this.foxes.forEach((fox, i) => {
                const other = this.foxes[1 - i];
                if (fox.attending && time < fox.attending.until && fox.attending.pair !== true) return;
                const weight = 0.75 * (1 - far / NOTICE) + 0.25;
                fox.attend(other.pose.x, other.pose.y + other.paces.eye, other.pose.z, time + 0.4, weight);
                fox.attending.pair = true;
            });
        }
        const { length } = this.course;
        this.foxes.forEach((fox, i) => {
            const other = this.foxes[1 - i];
            if (other.mode === 'idle' && other.act && fox.mode === 'gait' && fox.nextStop > time + 3) {
                fox.nextStop = time + 1.5 + i;
            }
            // They go the same way round the one course: each leaves the other room ahead of it.
            fox.ahead = (((other.s - fox.s) % length) + length) % length;
            fox.aheadSpeed = other.speed;
            fox.step(dt, time, env);
        });
    }
}
