// @ts-check
/**
 * THE MEADOW'S WILD HORSES, ALIVE — the band's life on the CPU, without three.js
 * (odyssey-horses.js draws it). Chapters 3-4 (2026-11-02), built the way the glade's red deer
 * were (odyssey-deer-herd.js): the same rig conventions, the same planted-feet planner idea, the
 * same closed-form clock. The deer code is not imported (its module is the deer's own), so the
 * small maths helpers are repeated here.
 *
 * WHERE. A band of wild horses (five adults, two foals) on the open meadow EAST of the rail
 * between the chapter-3 glade and the tarn. Scouted on the REAL rail camera
 * (docs/ODYSSEY_GROUND_ANIMALS_2026-11.md, "Wild horses"): a long open band of grass at
 * z -345..-315 from x -140 to x 0, seen from L11-L18, and a second open corridor at z -430..-415
 * further south, seen from L15-L18. Together they make an oval round a copse: the gallop loop.
 *
 * SIZE. Drawn at three times life, like the act's other life: a mare's withers are 21-49 px tall
 * at 1440p from the chapter-3 parks.
 *
 * HOW IT LIVES. Everything is a function of the board clock (world-anchored, deterministic):
 *  - GRAZING. Most of the loop each horse grazes near its own spots in one of the two grazing
 *    places (W: the band's west end, E: its east end): head down, slow steps along short curves,
 *    a look round now and then, a walk to its next spot. The foals keep to spots at their mothers'
 *    sides, and now and then trot a little curve and buck.
 *  - THE GALLOP. Twice a loop the band runs: the heads come up, each horse turns toward the way
 *    out, and the band canters off in a loose file behind the lead mare, the foals at their
 *    mothers' flanks. One run takes the long way round the copse (W to E by the south corridor),
 *    the other comes back along the open band (E to W). Each run speeds up through walk, trot and
 *    canter to a gallop and slows the same way, then the band grazes again where it stopped.
 *  - GAITS. The gait follows the speed: a four-beat walk, a two-beat trot (diagonal pairs), a
 *    three-beat canter and a four-beat gallop, blended through their footfall timings, stride
 *    rates and stance shares (`ODYSSEY_HORSES.gaits`).
 *  - THE FEET. A footstep planner (`planFootfalls`), run once at load, walks every horse through
 *    its loop and decides when each hoof lifts and where it lands (half a stance ahead of where it
 *    would stand), so a planted hoof never moves. It also records the stride phase and the speed,
 *    which the pose reads (the canter's rocking, the head's nod).
 *  - THE LEGS, THE BODY, THE HEAD as the deer's: two-segment leg solves, the body riding on its
 *    feet, the neck down three bones; plus the gaits' own motion (the trot's bounce, the canter's
 *    rocking and the neck's pump, the tail streaming in a run, swishing at flies while grazing).
 *
 * OUTPUT. `poseHorse` writes, per bone, its world rotation (a quaternion) and where its rest frame
 * lands (`at - k * q * rest`), the table odyssey-horses.js uploads, plus the hooves (for tests)
 * and the ground plane under the horse (its shadow).
 */

/** The band and its clock. Places are world (x, z); `size` scales the model (1 = as built). */
export const ODYSSEY_HORSES = Object.freeze({
    /** Drawn larger than life, like the act's other life. */
    scale: 3.0,
    /**
     * [first, last] journey progress the band is drawn at. The first is deep in chapter 2's water
     * (the deer's); the last is after L21 has turned the eye away from the meadow:
     * odyssey-wild-horses.test.js holds the camera to that, at every moment of the loop.
     */
    window: Object.freeze([0.08, 0.29]),
    /** Every schedule repeats after exactly this many seconds of the board clock. */
    loop: 300,
    /**
     * The gaits (adult life size: speed m/s, stride rate Hz, the share of a stride a hoof stands,
     * and when each hoof lifts within the stride: left hind, left fore, right hind, right fore).
     * Between two rows everything blends with the speed (the timings unwrapped so they move
     * smoothly from one gait's to the next's). The canter and gallop lead with the left fore.
     */
    gaits: Object.freeze([
        Object.freeze({
            name: 'walk', v: 1.2, rate: 1.04, duty: 0.62, lift: Object.freeze([0, 0.25, 0.5, 0.75]),
        }),
        Object.freeze({
            name: 'trot', v: 3.0, rate: 1.7, duty: 0.42, lift: Object.freeze([0, 0.5, 0.5, 1.0]),
        }),
        Object.freeze({
            name: 'canter', v: 5.0, rate: 2.1, duty: 0.33, lift: Object.freeze([0, 0.2, 0.75, 1.0]),
        }),
        Object.freeze({
            name: 'gallop', v: 7.0, rate: 2.35, duty: 0.27, lift: Object.freeze([0, 0.38, 0.88, 1.26]),
        }),
    ]),
    /** A run's top speed (adult life size, m/s; a slow gallop) and its speeding up / slowing (s). */
    runSpeed: 7.0,
    runRamp: 4.6,
    /** A walk between spots (life m/s); a grazing step's share of it; a foal's play trot. */
    walkSpeed: 1.2,
    stepShare: 0.42,
    playSpeed: 2.6,
    /** Seconds to reach walking speed from standing, and to stop. */
    accel: 1.1,
    /** The fastest a turn on the spot turns (rad/s), and its pivot behind the middle (share of size). */
    turnRate: 0.6,
    pivotBack: 0.36,
    /** How far a swinging hoof lifts (share of size) and how much more at speed. */
    lift: 0.08,
    liftRun: 0.14,
    /** Once the body has stood still this long (s), hooves this far (share of a stride) off settle. */
    settleAfter: 0.45,
    settleAt: 0.07,
    /**
     * Local rotations of a grazing head per model (the neck swung down its three bones, the face to
     * the grass): found on the rest skeleton in Blender (scripts/blender/odyssey/wild_horse.py).
     */
    graze: Object.freeze({
        horse: Object.freeze({
            neck0: 1.12, neck1: 0.336, neck2: 0.246, head: -1.4, dip: 0.06,
        }),
        foal: Object.freeze({
            neck0: 1.45, neck1: 0.44, neck2: 0.33, head: -1.9, dip: 0.08, splay: 0.12,
        }),
    }),
    /** The coats (linear albedo): body, points (mane, tail, legs), pale (the mealy muzzle and belly). */
    coats: Object.freeze({
        bay: Object.freeze({ body: [0.2, 0.085, 0.035], points: [0.02, 0.016, 0.014], pale: [0.42, 0.3, 0.18] }),
        dun: Object.freeze({ body: [0.42, 0.32, 0.18], points: [0.05, 0.035, 0.025], pale: [0.7, 0.62, 0.48] }),
        grey: Object.freeze({ body: [0.5, 0.5, 0.49], points: [0.16, 0.16, 0.17], pale: [0.68, 0.68, 0.66] }),
    }),
    /**
     * The runs: when the lead mare sets off (loop seconds), from which place to which, and the
     * band's way between them (world x, z), round the copse or along the open band.
     */
    runs: Object.freeze([
        Object.freeze({
            at: 118,
            from: 'W',
            to: 'E',
            /** The long way round the copse: down the west side, along the south, up the east. */
            round: true,
            way: Object.freeze([
                Object.freeze([-100, -332]), Object.freeze([-127, -341]), Object.freeze([-125, -354]),
                Object.freeze([-121, -362]), Object.freeze([-113, -372]), Object.freeze([-114, -384]),
                Object.freeze([-119, -397]), Object.freeze([-115, -416]), Object.freeze([-90, -426]),
                Object.freeze([-40, -427]), Object.freeze([-5, -425]), Object.freeze([14, -410]),
                Object.freeze([26, -396]), Object.freeze([33, -380]), Object.freeze([32, -360]),
                Object.freeze([28, -346]), Object.freeze([18, -331]),
            ]),
        }),
        Object.freeze({
            at: 262,
            from: 'E',
            to: 'W',
            /** Straight back along the open band (each horse keeps the way points between it and its spot). */
            round: false,
            way: Object.freeze([
                Object.freeze([-20, -331]), Object.freeze([-60, -333]), Object.freeze([-100, -335]),
            ]),
        }),
    ]),
    /**
     * The band. `slot`: [seconds after the lead mare it sets off, metres to its left of the
     * band's way]; a foal's `mother` is her index and `play` where it trots out to play (per place).
     * Spots: its own places to graze, per place. The horses keep one order from west to east in
     * both places and set off in that order, so no one overtakes another in a run.
     */
    members: Object.freeze([
        Object.freeze({
            name: 'lead mare',
            model: 'horse',
            size: 1.0,
            seed: 13,
            coat: 'dun',
            tone: 0.5,
            slot: Object.freeze([0, 0]),
            spots: Object.freeze({
                W: Object.freeze([[-137, -348], [-133, -352]]),
                E: Object.freeze([[-62, -322], [-66, -327]]),
            }),
        }),
        Object.freeze({
            name: 'mare',
            model: 'horse',
            size: 0.97,
            seed: 29,
            coat: 'grey',
            tone: 0.4,
            slot: Object.freeze([1.1, -1.5]),
            spots: Object.freeze({
                W: Object.freeze([[-122, -344], [-117, -340]]),
                E: Object.freeze([[-40, -322], [-36, -316]]),
            }),
        }),
        Object.freeze({
            name: 'mare',
            model: 'horse',
            size: 0.95,
            seed: 41,
            coat: 'bay',
            tone: 0.6,
            slot: Object.freeze([2.2, 0.4]),
            spots: Object.freeze({
                W: Object.freeze([[-104, -336], [-99, -341]]),
                E: Object.freeze([[-26, -330], [-22, -326]]),
            }),
        }),
        Object.freeze({
            name: 'mare',
            model: 'horse',
            size: 0.98,
            seed: 53,
            coat: 'dun',
            tone: 0.25,
            slot: Object.freeze([3.2, 1.5]),
            spots: Object.freeze({
                W: Object.freeze([[-76, -334], [-69, -330]]),
                E: Object.freeze([[-4, -330], [0, -325]]),
            }),
        }),
        Object.freeze({
            name: 'stallion',
            model: 'horse',
            size: 1.04,
            seed: 67,
            coat: 'bay',
            tone: 0.2,
            slot: Object.freeze([4.3, -0.5]),
            spots: Object.freeze({
                W: Object.freeze([[-58, -326], [-54, -333]]),
                E: Object.freeze([[8, -322], [3, -315]]),
            }),
        }),
        Object.freeze({
            name: 'foal',
            model: 'foal',
            size: 1.0,
            seed: 79,
            coat: 'dun',
            tone: 0.55,
            mother: 0,
            slot: Object.freeze([0.35, 3.2]),
            spots: Object.freeze({
                W: Object.freeze([[-132, -335], [-129, -337]]),
                E: Object.freeze([[-52, -330], [-49, -325]]),
            }),
            play: Object.freeze({ W: Object.freeze([-143, -333]), E: Object.freeze([-42, -337]) }),
        }),
        Object.freeze({
            name: 'foal',
            model: 'foal',
            size: 1.0,
            seed: 97,
            coat: 'bay',
            tone: 0.45,
            mother: 2,
            slot: Object.freeze([2.45, 3.6]),
            spots: Object.freeze({
                W: Object.freeze([[-99, -328], [-96, -326]]),
                E: Object.freeze([[-14, -321], [-10, -316]]),
            }),
            play: Object.freeze({ W: Object.freeze([-90, -321]), E: Object.freeze([-8, -309]) }),
        }),
    ]),
});

/** @typedef {{name: string, parent: number, head: number[]}} HorseBone */

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** Smootherstep: C2, no jump in speed or acceleration at either end. */
const s5 = (v) => {
    const t = clamp01(v);
    return t * t * t * ((t * ((t * 6) - 15)) + 10);
};
const smooth = (a, b, v) => {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - (2 * t));
};
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dir = (h) => [Math.sin(h), Math.cos(h)];

/** Seeded uniform [0, 1) (mulberry32). */
function seeded(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Smooth value noise in [-1, 1] over time (deterministic; `seed` picks the stream). */
function noise(t, seed) {
    const i = Math.floor(t);
    const f = t - i;
    const h = (n) => {
        const v = Math.sin((n * 127.1) + (seed * 311.7)) * 43758.5453;
        return ((v - Math.floor(v)) * 2) - 1;
    };
    const u = f * f * (3 - (2 * f));
    return h(i) + ((h(i + 1) - h(i)) * u);
}

/** Distance travelled along a move after a share `u` of its time: a smooth start and stop. */
function moveProfile(u, a) {
    // Speed rises over [0, a] (smoothstep), holds, falls over [1 - a, 1]; its integral, normalised.
    const ramp = (x) => (x * x * x) - (0.5 * x * x * x * x);
    const total = 1 - a;
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    if (u < a) return (a * ramp(u / a)) / total;
    if (u > 1 - a) return (total - (a * ramp((1 - u) / a))) / total;
    return ((0.5 * a) + (u - a)) / total;
}

/**
 * A smooth path through `points` (world x, z), leaving the first along `startDir` (a unit
 * [x, z]): cubic Hermite pieces with Catmull-Rom tangents, sampled into an arc-length table.
 * @param {number[][]} points
 * @param {number[]} startDir
 */
export function smoothPath(points, startDir) {
    const n = points.length;
    const tangents = points.map((p, i) => {
        if (i === 0) {
            const d = Math.hypot(points[1][0] - p[0], points[1][1] - p[1]);
            return [startDir[0] * d, startDir[1] * d];
        }
        if (i === n - 1) return [p[0] - points[i - 1][0], p[1] - points[i - 1][1]];
        return [0.5 * (points[i + 1][0] - points[i - 1][0]), 0.5 * (points[i + 1][1] - points[i - 1][1])];
    });
    const per = 16;
    const count = ((n - 1) * per) + 1;
    const xs = new Float64Array(count);
    const zs = new Float64Array(count);
    const lengths = new Float64Array(count);
    for (let s = 0; s < n - 1; s += 1) {
        const [ax, az] = points[s];
        const [bx, bz] = points[s + 1];
        const [mx, mz] = tangents[s];
        const [nx, nz] = tangents[s + 1];
        for (let j = s === 0 ? 0 : 1; j <= per; j += 1) {
            const t = j / per;
            const t2 = t * t;
            const t3 = t2 * t;
            const h00 = (2 * t3) - (3 * t2) + 1;
            const h10 = t3 - (2 * t2) + t;
            const h01 = (-2 * t3) + (3 * t2);
            const h11 = t3 - t2;
            const i = (s * per) + j;
            xs[i] = (h00 * ax) + (h10 * mx) + (h01 * bx) + (h11 * nx);
            zs[i] = (h00 * az) + (h10 * mz) + (h01 * bz) + (h11 * nz);
            if (i > 0) lengths[i] = lengths[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
        }
    }
    return {
        xs, zs, lengths, length: lengths[count - 1],
    };
}

/** Position and heading at a share `a` of a smooth path's length. */
function pathAt(c, a, out) {
    const n = c.lengths.length - 1;
    const target = clamp01(a) * c.length;
    let lo = 1;
    let hi = n;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (c.lengths[mid] < target) lo = mid + 1; else hi = mid;
    }
    const i = lo;
    const l0 = c.lengths[i - 1];
    const f = (target - l0) / Math.max(1e-9, c.lengths[i] - l0);
    out.x = c.xs[i - 1] + ((c.xs[i] - c.xs[i - 1]) * f);
    out.z = c.zs[i - 1] + ((c.zs[i] - c.zs[i - 1]) * f);
    // The heading blends between the neighbouring chords (no corner at a sample).
    const chord = (j) => Math.atan2(c.xs[j] - c.xs[j - 1], c.zs[j] - c.zs[j - 1]);
    const h1 = chord(i);
    const h0 = i > 1 ? chord(i - 1) : h1;
    const h2 = i < n ? chord(i + 1) : h1;
    out.heading = f < 0.5
        ? h1 + (wrapAngle(h0 - h1) * (0.5 - f))
        : h1 + (wrapAngle(h2 - h1) * (f - 0.5));
    return out;
}

/**
 * One horse's way for a run: the band's way points offset to its side, trimmed so its path never
 * doubles back. A run round the copse drops the leading points the horse is already past; a run
 * straight along the band keeps only the points between the horse and its spot.
 * @param {(typeof ODYSSEY_HORSES)['runs'][number]} run
 * @param {(typeof ODYSSEY_HORSES)['members'][number]} member
 * @param {number[]} from where the horse stands when it sets off
 */
export function wayFor(run, member, from) {
    const side = member.slot[1];
    const shifted = run.way.map((p, i, all) => {
        const a = all[Math.max(0, i - 1)];
        const b = all[Math.min(all.length - 1, i + 1)];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        // Its left (facing along the way) is +x when facing +z: (fz, -fx).
        return [p[0] + (((b[1] - a[1]) / len) * side), p[1] - (((b[0] - a[0]) / len) * side)];
    });
    const dest = member.spots[run.to][0];
    if (run.round) {
        let i = 0;
        while (i < shifted.length - 1) {
            const next = shifted[i + 1];
            const past = Math.hypot(next[0] - from[0], next[1] - from[1])
                < Math.hypot(next[0] - shifted[i][0], next[1] - shifted[i][1])
                || Math.hypot(shifted[i][0] - from[0], shifted[i][1] - from[1]) < 14;
            if (!past) break;
            i += 1;
        }
        return shifted.slice(i);
    }
    const ax = dest[0] - from[0];
    const az = dest[1] - from[1];
    const len2 = (ax * ax) + (az * az) || 1;
    return shifted.filter((p) => {
        const u = (((p[0] - from[0]) * ax) + ((p[1] - from[1]) * az)) / len2;
        return u > 0.15 && u < 0.85;
    });
}

/** The model's leg reach relative to the adult's (gaits scale with it). */
const LEG_SCALE = Object.freeze({ horse: 1, foal: 0.8 });

/**
 * One horse's schedule: segments back to back over the loop: `graze` and `look` (standing),
 * `step` (a slow grazing step), `turn` (on the spot, pivoting round the hind legs), `walk`, `trot`
 * (a foal's play), `run` (a gallop along the band's way) and `buck` (a foal's kick, standing).
 * Each carries the channels the pose reads (`head`: 1 down grazing .. 0 up; `look`: the look's
 * yaw; `alert`: attention).
 * @param {(typeof ODYSSEY_HORSES)['members'][number]} member
 * @param {typeof ODYSSEY_HORSES} [cfg]
 */
export function buildHorseSchedule(member, cfg = ODYSSEY_HORSES) {
    const k = cfg.scale * member.size;
    const legScale = LEG_SCALE[member.model];
    const life = k * legScale;
    const walkSpeed = cfg.walkSpeed * life;
    const strideW = 1.15 * life;
    const pivot = cfg.pivotBack * k * (member.model === 'foal' ? 0.6 : 1);
    const L = cfg.loop;
    const foal = member.model === 'foal';
    const build = (h0) => {
        const rand = seeded(member.seed * 7919);
        const segs = [];
        let t = 0;
        let place = 'W';
        let [x, z] = member.spots.W[0];
        let h = h0;
        let spotIndex = 0;
        let atSpotSince = 0;
        const push = (seg) => {
            segs.push({
                t0: t, x0: x, z0: z, h0: h, look: 0, alert: 0, ...seg,
            });
            t += seg.dur;
        };
        const still = (kind, dur, head, look = 0, alert = 0) => push({
            kind, dur, head, look, alert, x1: x, z1: z, h1: h,
        });
        const turnDur = (by) => 0.6 + ((1.875 * Math.abs(by)) / cfg.turnRate);
        /** Turn on the spot by `by` (radians), pivoting round a point behind the middle. */
        const turn = (by, about = pivot, head = 0.2) => {
            const [fx, fz] = dir(h);
            const px = x - (fx * about);
            const pz = z - (fz * about);
            const h1 = h + by;
            const [gx, gz] = dir(h1);
            push({
                kind: 'turn', dur: turnDur(by), head, alert: 0.4, px, pz, about, x1: px + (gx * about), z1: pz + (gz * about), h1,
            });
            x = px + (gx * about);
            z = pz + (gz * about);
            h = h1;
        };
        /** Move along a smooth path leaving the way it faces: through `via`, ending at `to`. */
        const moveDur = (kind, length, speed) => {
            const ramp = kind === 'run' ? cfg.runRamp : cfg.accel * (kind === 'step' ? 0.8 : 1);
            return { dur: (length / speed) + ramp, ramp };
        };
        const move = (kind, via, to, speed, head, alert) => {
            const pts = [[x, z]];
            const d0 = Math.hypot((via[0] ?? to)[0] - x, (via[0] ?? to)[1] - z);
            const [fx, fz] = dir(h);
            pts.push([x + (fx * Math.min(d0 * 0.3, 15)), z + (fz * Math.min(d0 * 0.3, 15))]);
            via.forEach((p) => pts.push([p[0], p[1]]));
            pts.push([to[0], to[1]]);
            const path = smoothPath(pts, [fx, fz]);
            const { dur, ramp } = moveDur(kind, path.length, speed);
            const end = pathAt(path, 1, { x: 0, z: 0, heading: 0 });
            push({
                kind, dur, head, alert, path, ramp: Math.min(0.45, ramp / dur), x1: to[0], z1: to[1], h1: end.heading,
            });
            x = to[0];
            z = to[1];
            h = end.heading;
        };
        /** The time a walk to `to` would take, with the turn it needs first. */
        const walkCost = (to) => {
            const want = wrapAngle(Math.atan2(to[0] - x, to[1] - z) - h);
            const d = Math.hypot(to[0] - x, to[1] - z);
            return (Math.abs(want) > 0.5 ? turnDur(want - (Math.sign(want) * 0.3)) : 1.2) + ((d * 1.25) / walkSpeed)
                + cfg.accel;
        };
        const walkTo = (to, kind = 'walk', speed = walkSpeed, head = 0.2) => {
            const want = wrapAngle(Math.atan2(to[0] - x, to[1] - z) - h);
            if (Math.abs(want) > 0.5) turn(want - (Math.sign(want) * 0.3));
            else still('look', 1.2, 0.2, want * 0.6, 0.6);
            move(kind, [], to, speed, head, 0.5);
        };
        /** A foal's play trot to `to` (a turn first if it must). */
        const trotTo = (to) => {
            const want = wrapAngle(Math.atan2(to[0] - x, to[1] - z) - h);
            if (Math.abs(want) > 0.5) turn(want - (Math.sign(want) * 0.3), pivot, 0.1);
            move('trot', [], to, cfg.playSpeed * life, 0.1, 0.8);
        };
        /** Graze round the current place's spots until `until` (never past it). */
        const grazeUntil = (until) => {
            const spots = member.spots[place];
            for (let guard = 0; guard < 400 && until - t > 6; guard += 1) {
                const spot = spots[spotIndex];
                const left = until - t;
                // Time to move to the next spot?
                if (spots.length > 1 && t - atSpotSince > 34 + (rand() * 30)) {
                    const next = spots[(spotIndex + 1) % spots.length];
                    if (walkCost(next) < left - 5) {
                        walkTo(next);
                        spotIndex = (spotIndex + 1) % spots.length;
                        atSpotSince = t;
                        continue;
                    }
                }
                // A foal's play: a little trot round a curve near its spot, and sometimes a buck.
                // (Out to its open playground, a little different each time, then back to its spot.)
                if (foal && rand() < 0.16 && left > 30) {
                    const [px, pz] = member.play[place];
                    const out = [px + ((rand() - 0.5) * 4), pz + ((rand() - 0.5) * 4)];
                    const cost = (2 * walkCost(out) * 0.6) + 6;
                    if (cost < left - 8) {
                        trotTo(out);
                        if (rand() < 0.65) still('buck', 1.3, 0.35, 0, 0.8);
                        still('look', 1.5, 0.1, (rand() - 0.5), 0.9);
                        trotTo(spot);
                        continue;
                    }
                }
                const bite = Math.min(left - 2, 5 + (rand() * 9));
                still('graze', bite, 1);
                if (until - t < 6) break;
                if (rand() < 0.3) {
                    const dur = Math.min(until - t - 2, 3 + (rand() * 4));
                    still('look', dur, 0, (rand() - 0.5) * 1.6, 1);
                    if (until - t < 6) break;
                }
                // A grazing step, drawn back toward the spot when it has wandered.
                const away = Math.hypot(x - spot[0], z - spot[1]);
                const home = Math.atan2(spot[0] - x, spot[1] - z);
                const wander = h + ((rand() - 0.5) * 0.8);
                const pull = clamp01((away - (0.25 * k)) / (0.7 * k));
                const aim = wrapAngle(wander + (wrapAngle(home - wander) * pull));
                const dist = (0.3 + (rand() * 0.4)) * strideW;
                const [ax, az] = dir(aim);
                const turnNeed = Math.abs(wrapAngle(aim - h)) > 0.6 ? turnDur(wrapAngle(aim - h) * 0.75) : 0;
                if (turnNeed + (dist / (walkSpeed * cfg.stepShare)) + 2 > until - t - 2) break;
                if (turnNeed) turn(wrapAngle(aim - h) * 0.75);
                move('step', [], [x + (ax * dist), z + (az * dist)], walkSpeed * cfg.stepShare, 0.85, 0);
            }
            if (until - t > 1e-6) still('graze', until - t, 1);
        };
        for (const run of cfg.runs) {
            // The band's way, offset to this horse's side of it and trimmed to it (wayFor).
            const way = wayFor(run, member, [x, z]);
            const setOff = run.at + member.slot[0];
            grazeUntil(setOff - 14);
            // Heads up, then a turn toward the way out, timed to set off on the moment.
            const out = way[0] ?? member.spots[run.to][0];
            const want = wrapAngle(Math.atan2(out[0] - x, out[1] - z) - h);
            const by = Math.abs(want) > 0.12 ? want : 0;
            const need = (by ? turnDur(by) : 0) + 1.6;
            if (setOff - need - t > 1e-6) still('graze', setOff - need - t, 1);
            still('look', 1.6, 0, 0, 1);
            if (by) turn(by, pivot, 0);
            place = run.to;
            spotIndex = 0;
            const dest = member.spots[place][0];
            move('run', way, dest, cfg.runSpeed * cfg.scale, 0.05, 1);
            atSpotSince = t;
        }
        // Back to the first spot facing the way it began, so the loop's seam does not jump.
        grazeUntil(L - 26);
        const home = member.spots.W[0];
        if (Math.hypot(home[0] - x, home[1] - z) > 0.3) walkTo(home);
        const close = wrapAngle(h0 - h);
        if (Math.abs(close) > 1e-3) turn(close, 0);
        if (L - 3.2 - t > 0) still('graze', L - 3.2 - t, 1);
        still('graze', 3.2, 1);
        return { segs, loop: t, hEnd: h };
    };
    const first = member.spots.W;
    let h0 = Math.atan2(first[0][0] - first[1][0], first[0][1] - first[1][1]);
    let built = build(h0);
    for (let i = 0; i < 3; i += 1) {
        h0 = built.hEnd;
        built = build(h0);
    }
    return {
        segments: built.segs, loop: built.loop, k, life, legScale, strideW, walkSpeed,
    };
}

/** The schedules of the whole band (built once; pure). Feet come later (`planFootfalls`). */
export function buildBand(cfg = ODYSSEY_HORSES) {
    return cfg.members.map((member) => ({ member, ...buildHorseSchedule(member, cfg), plan: null }));
}

/** The segment index active at time `t` (already within [0, loop)). */
function segmentAt(segs, t) {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (segs[mid].t0 <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
}

const wrapTime = (horse, t) => (((t % horse.loop) + horse.loop) % horse.loop);

/** The segment a horse is in at board time `time` (and the share of it done). */
export function horseSegmentAt(horse, time) {
    const t = wrapTime(horse, time);
    const s = horse.segments[segmentAt(horse.segments, t)];
    return { segment: s, u: clamp01((t - s.t0) / s.dur) };
}

/** The body's path at time `t`: where it stands and the way it faces (closed-form in the clock). */
export function horsePathAt(horse, time, out = { x: 0, z: 0, heading: 0 }) {
    const t = wrapTime(horse, time);
    const s = horse.segments[segmentAt(horse.segments, t)];
    const u = clamp01((t - s.t0) / s.dur);
    if (s.kind === 'turn') {
        const h = s.h0 + (wrapAngle(s.h1 - s.h0) * s5(u));
        const [fx, fz] = dir(h);
        out.x = s.px + (fx * s.about);
        out.z = s.pz + (fz * s.about);
        out.heading = h;
    } else if (s.path) {
        pathAt(s.path, moveProfile(u, s.ramp), out);
    } else {
        out.x = s.x0;
        out.z = s.z0;
        out.heading = s.h0;
    }
    return out;
}

/**
 * A channel of the schedule (`head`, `look`, `alert`) at time `t`, its steps smoothed over `width`
 * seconds (each change eases in along smootherstep from the moment it begins: no jump, however
 * short the segments).
 */
export function horseChannel(horse, key, time, width) {
    const segs = horse.segments;
    const t = wrapTime(horse, time);
    let i = segmentAt(segs, wrapTime(horse, t - width));
    let base = (t - width) < 0 ? -horse.loop : 0;
    let value = segs[i][key];
    for (let guard = 0; guard < segs.length; guard += 1) {
        const j = (i + 1) % segs.length;
        if (j === 0) base += horse.loop;
        const tb = base + segs[j].t0;
        if (tb > t) break;
        value += (segs[j][key] - segs[i][key]) * s5((t - tb) / width);
        i = j;
    }
    return value;
}

/** Where a horse is and what it is doing at board time `time`. */
export function horseStateAt(horse, time, out = {
    x: 0, z: 0, heading: 0, speed: 0, turning: 0, head: 0, alert: 0,
}) {
    horsePathAt(horse, time, out);
    const a = horsePathAt(horse, time - 0.05, { x: 0, z: 0, heading: 0 });
    const b = horsePathAt(horse, time + 0.05, { x: 0, z: 0, heading: 0 });
    out.speed = Math.hypot(b.x - a.x, b.z - a.z) / 0.1;
    out.turning = wrapAngle(b.heading - a.heading) / 0.1;
    out.head = horseChannel(horse, 'head', time, 1.8);
    out.alert = horseChannel(horse, 'alert', time, 0.8);
    return out;
}

// -- the gaits ---------------------------------------------------------------------------------

/**
 * The gait at adult life speed `v` (m/s): stride rate, stance share and each hoof's lift timing,
 * blended between the table's rows. Below a walk the strides shorten (a grazing step is two or
 * three short paces); standing, the rate is 0.
 * @param {number} v
 * @param {{rate: number, duty: number, lift: number[]}} out
 */
export function gaitAt(v, out = { rate: 0, duty: 0, lift: [0, 0, 0, 0] }, cfg = ODYSSEY_HORSES) {
    const G = cfg.gaits;
    if (v <= G[0].v) {
        const w = G[0];
        const stride = (w.v / w.rate) * (0.42 + (0.58 * clamp01(v / w.v)));
        out.rate = v / stride;
        out.duty = w.duty + (0.06 * (1 - clamp01(v / w.v)));
        for (let l = 0; l < 4; l += 1) out.lift[l] = w.lift[l];
        return out;
    }
    const last = G[G.length - 1];
    if (v > last.v) {
        // Faster than the table (a foal keeping up with the band): quicker, lighter strides.
        out.rate = last.rate + ((v - last.v) * 0.15);
        out.duty = Math.max(0.2, last.duty - ((v - last.v) * 0.02));
        for (let l = 0; l < 4; l += 1) out.lift[l] = last.lift[l];
        return out;
    }
    let i = 0;
    while (i < G.length - 2 && v > G[i + 1].v) i += 1;
    const a = G[i];
    const b = G[i + 1];
    const f = clamp01((v - a.v) / (b.v - a.v));
    const e = f * f * (3 - (2 * f));
    out.rate = a.rate + ((b.rate - a.rate) * e);
    out.duty = a.duty + ((b.duty - a.duty) * e);
    for (let l = 0; l < 4; l += 1) out.lift[l] = a.lift[l] + ((b.lift[l] - a.lift[l]) * e);
    return out;
}

// -- the feet --------------------------------------------------------------------------------

/** @type {ReadonlyArray<[string, string, string[], boolean]>} */
const LEGS = Object.freeze([
    // [leg, top bone, the chain below it, front?]: left hind, left fore, right hind, right fore
    ['hindL', 'femurL', ['tibiaL', 'hindCannonL', 'hindHoofL'], false],
    ['foreL', 'humerusL', ['forearmL', 'foreCannonL', 'foreHoofL'], true],
    ['hindR', 'femurR', ['tibiaR', 'hindCannonR', 'hindHoofR'], false],
    ['foreR', 'humerusR', ['forearmR', 'foreCannonR', 'foreHoofR'], true],
]);

/** How often the plan samples the stride phase and the speed (per second). */
const PLAN_RATE = 30;

/**
 * Plan every hoof's steps through each horse's loop (run once, at load): per hoof a list of
 * [lift time, land time, from x, from z, to x, to z, kind], where each hoof stands at the loop's
 * start, and the stride phase and adult-life speed sampled at PLAN_RATE.
 * @param {ReturnType<typeof buildBand>} band
 * @param {{horse: ReturnType<typeof createHorseRig>, foal: ReturnType<typeof createHorseRig>}} rigs
 */
export function planFootfalls(band, rigs, cfg = ODYSSEY_HORSES) {
    band.forEach((horse) => { horse.plan = planHorse(horse, rigs[horse.member.model], cfg); });
    return band;
}

function planHorse(horse, rig, cfg) {
    const { k, life } = horse;
    const dt = 1 / 60;
    const offsets = rig.legs.map((leg) => rig.footOffset[leg.leg]);
    const reach = 0.4 * life;
    const path = { x: 0, z: 0, heading: 0 };
    const footUnder = (p, l, out) => {
        const [ox, oz] = offsets[l];
        const ch = Math.cos(p.heading);
        const sh = Math.sin(p.heading);
        out[0] = p.x + (((ch * ox) + (sh * oz)) * k);
        out[1] = p.z + (((-sh * ox) + (ch * oz)) * k);
        return out;
    };
    const ideal = (l, t, out) => footUnder(horsePathAt(horse, t, path), l, out);
    const pNow = { x: 0, z: 0, heading: 0 };
    const pSoon = { x: 0, z: 0, heading: 0 };
    const pBefore = { x: 0, z: 0, heading: 0 };
    const now = [0, 0];
    const soon = [0, 0];
    const gait = { rate: 0, duty: 0, lift: [0, 0, 0, 0] };
    const planted = offsets.map((_, l) => ideal(l, 0, [0, 0]));
    const start = planted.map((p) => [...p]);
    const swinging = offsets.map(() => null);
    const steps = offsets.map(() => []);
    const landedAt = [-Infinity, -Infinity, -Infinity, -Infinity];
    let stillFor = 0;
    let phase = 0;
    let lastLift = -Infinity;
    const samples = Math.ceil(horse.loop * PLAN_RATE) + 2;
    const phases = new Float32Array(samples);
    const speeds = new Float32Array(samples);
    const total = horse.loop;
    for (let tick = 0; tick * dt < total; tick += 1) {
        const t = tick * dt;
        swinging.forEach((s, l) => {
            if (s && s[1] <= t) {
                planted[l] = [s[4], s[5]];
                swinging[l] = null;
                landedAt[l] = t;
            }
        });
        horsePathAt(horse, t - dt, pBefore);
        horsePathAt(horse, t, pNow);
        const moving = Math.hypot(pNow.x - pBefore.x, pNow.z - pBefore.z) / dt > 0.03 * k
            || Math.abs(wrapAngle(pNow.heading - pBefore.heading)) / dt > 0.03;
        stillFor = moving ? 0 : stillFor + dt;
        // THE RHYTHM: the stride phase advances at the gait's rate for the ground the hooves cover
        // (the body's travel and its turning, in adult-life metres a second).
        horsePathAt(horse, t + 0.1, pSoon);
        let pace = 0;
        for (let l = 0; l < 4; l += 1) {
            footUnder(pSoon, l, soon);
            footUnder(pNow, l, now);
            pace = Math.max(pace, Math.hypot(soon[0] - now[0], soon[1] - now[1]) / 0.1);
        }
        const v = pace / life;
        gaitAt(v, gait, cfg);
        const prevPhase = phase;
        phase += gait.rate * dt;
        const sample = Math.round(t * PLAN_RATE);
        if (sample < samples) {
            phases[sample] = phase;
            speeds[sample] = v;
        }
        const stance = gait.rate > 1e-3 ? gait.duty / gait.rate : 1;
        const swingT = Math.max(0.16, Math.min(0.5, gait.rate > 1e-3 ? (1 - gait.duty) / gait.rate : 0.4));
        const lead = Math.min(0.6, 0.5 * stance);
        const walking = v < 2.0;
        let swingCount = swinging.filter(Boolean).length;
        for (let l = 0; l < 4; l += 1) {
            if (swinging[l]) continue;
            footUnder(pNow, l, now);
            const off = Math.hypot(planted[l][0] - now[0], planted[l][1] - now[1]);
            const rested = t - landedAt[l] > Math.max(0.12, 0.45 * stance);
            const due = Math.floor(phase - gait.lift[l]) > Math.floor(prevPhase - gait.lift[l]);
            let kind = -1;
            if (off > reach) kind = 0;
            else if (due && pace > 0.04 * horse.walkSpeed && rested) {
                // (A hoof already where it would land stays put.)
                const land = ideal(l, t + swingT + lead, soon);
                if (Math.hypot(planted[l][0] - land[0], planted[l][1] - land[1]) > 0.08 * horse.strideW) kind = 0;
            } else if (stillFor > cfg.settleAfter && swingCount < 2 && rested && t - lastLift > 0.18) {
                // In the loop's closing seconds every hoof settles exactly (the seam).
                const closing = t > total - 2.6;
                if (off > (closing ? 0.002 : cfg.settleAt) * horse.strideW) kind = 1;
            }
            if (kind < 0) continue;
            // At a walk a hoof never lifts with its partner (the other hind or fore) in the air.
            if (walking && kind === 0 && off <= reach && (swinging[l ^ 2] || swingCount >= 2)) continue;
            const settle = kind === 1;
            const dur = settle ? 0.32 : swingT;
            const land = settle ? ideal(l, t + dur, [0, 0]) : ideal(l, t + dur + lead, [0, 0]);
            swinging[l] = [t, t + dur, planted[l][0], planted[l][1], land[0], land[1], settle ? 1 : 0];
            steps[l].push([...swinging[l]]);
            swingCount += 1;
            lastLift = t;
        }
    }
    // The loop ends standing, every hoof settled under the body where it began (the closing
    // graze), so the plan's last state is its first: no seam.
    const lists = steps.map((list) => list.filter((s) => s[0] < total));
    return {
        steps: lists, start, phases, speeds,
    };
}

/**
 * Where hoof `l` of a planned horse is at `time` (world x, z, the share of its swing done, its
 * stride's length, and whether it is planted). Planted hooves never move.
 */
export function horseFootAt(horse, l, time, out = {
    x: 0, z: 0, swing: 0, planted: true, length: 0, ground: 0,
}) {
    const t = wrapTime(horse, time);
    const list = horse.plan.steps[l];
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid][0] <= t) {
            found = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    if (found < 0) {
        const [x, z] = horse.plan.start[l];
        out.x = x;
        out.z = z;
        out.swing = 0;
        out.planted = true;
        out.length = 0;
        return out;
    }
    const s = list[found];
    if (t < s[1]) {
        const u = (t - s[0]) / (s[1] - s[0]);
        const e = s5(u);
        out.x = s[2] + ((s[4] - s[2]) * e);
        out.z = s[3] + ((s[5] - s[3]) * e);
        out.swing = u;
        out.planted = false;
        out.length = Math.hypot(s[4] - s[2], s[5] - s[3]);
        return out;
    }
    out.x = s[4];
    out.z = s[5];
    out.swing = 0;
    out.planted = true;
    out.length = 0;
    return out;
}

/** The planned stride phase and adult-life speed at `time` (interpolated). */
export function horseRhythmAt(horse, time, out = { phase: 0, speed: 0 }) {
    const t = wrapTime(horse, time) * PLAN_RATE;
    const i = Math.min(horse.plan.phases.length - 2, Math.floor(t));
    const f = t - i;
    const { phases, speeds } = horse.plan;
    out.phase = phases[i] + ((phases[i + 1] - phases[i]) * f);
    // (The loop's last sample is not written: hold the one before it.)
    if (phases[i + 1] === 0 && i > 0) out.phase = phases[i];
    out.speed = speeds[i] + (((speeds[i + 1] || speeds[i]) - speeds[i]) * f);
    return out;
}

// -- the pose --------------------------------------------------------------------------------

/** Row-major 3x3 multiply into `out` (out may not alias a or b). */
function mul3(a, b, out) {
    for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 3; c += 1) {
            out[(r * 3) + c] = (a[r * 3] * b[c]) + (a[(r * 3) + 1] * b[3 + c]) + (a[(r * 3) + 2] * b[6 + c]);
        }
    }
    return out;
}

/** R = Ry * Rz * Rx (pitch about x first, then roll, then yaw): the GLB's convention. */
function rotation(rx, ry, rz, out) {
    const cx = Math.cos(rx);
    const sx = Math.sin(rx);
    const cy = Math.cos(ry);
    const sy = Math.sin(ry);
    const cz = Math.cos(rz);
    const sz = Math.sin(rz);
    const a00 = cz;
    const a01 = sz * cx;
    const a02 = -sz * sx;
    const a10 = -sz;
    const a11 = cz * cx;
    const a12 = cz * -sx;
    const a20 = 0;
    const a21 = sx;
    const a22 = cx;
    out[0] = (cy * a00) + (sy * a20);
    out[1] = (cy * a01) + (sy * a21);
    out[2] = (cy * a02) + (sy * a22);
    out[3] = a10;
    out[4] = a11;
    out[5] = a12;
    out[6] = (-sy * a00) + (cy * a20);
    out[7] = (-sy * a01) + (cy * a21);
    out[8] = (-sy * a02) + (cy * a22);
    return out;
}

/** A unit quaternion [x, y, z, w] from a row-major rotation matrix, written at `o`. */
function quatFrom(m, out, o) {
    const tr = m[0] + m[4] + m[8];
    let x;
    let y;
    let z;
    let w;
    if (tr > 0) {
        const s = 0.5 / Math.sqrt(tr + 1);
        w = 0.25 / s;
        x = (m[7] - m[5]) * s;
        y = (m[2] - m[6]) * s;
        z = (m[3] - m[1]) * s;
    } else if (m[0] > m[4] && m[0] > m[8]) {
        const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);
        w = (m[7] - m[5]) / s;
        x = 0.25 * s;
        y = (m[1] + m[3]) / s;
        z = (m[2] + m[6]) / s;
    } else if (m[4] > m[8]) {
        const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]);
        w = (m[2] - m[6]) / s;
        x = (m[1] + m[3]) / s;
        y = 0.25 * s;
        z = (m[5] + m[7]) / s;
    } else {
        const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]);
        w = (m[3] - m[1]) / s;
        x = (m[2] + m[6]) / s;
        y = (m[5] + m[7]) / s;
        z = 0.25 * s;
    }
    const sign = w < 0 ? -1 : 1;
    out[o] = x * sign;
    out[o + 1] = y * sign;
    out[o + 2] = z * sign;
    out[o + 3] = w * sign;
}

/**
 * A rig for one skeleton (the mare's or the foal's): scratch, lookups and each leg's rest
 * geometry, built once.
 * @param {HorseBone[]} skeleton
 */
export function createHorseRig(skeleton) {
    const count = skeleton.length;
    const index = Object.fromEntries(skeleton.map((b, i) => [b.name, i]));
    const missing = ['root', 'pelvis', 'chest', 'neck0', 'neck1', 'neck2', 'head', 'jaw', 'earL', 'earR', 'tail0',
        'tail1', 'tail2', ...LEGS.flatMap(([, top, chain]) => [top, ...chain])].filter((name) => index[name] == null);
    if (missing.length) throw new Error(`[Odyssey horses] the skeleton lacks ${missing.join(', ')}`);
    const head = (name) => skeleton[index[name]].head;
    const legs = LEGS.map(([leg, top, chain, front]) => {
        const A = head(top);
        const B = head(chain[1]);
        const C = head(chain[2]);
        const u1 = [B[1] - A[1], B[2] - A[2]];
        const u2 = [C[1] - B[1], C[2] - B[2]];
        return {
            leg,
            front,
            top: index[top],
            chain: chain.map((name) => index[name]),
            u1,
            u2,
            fetlock: C[1],
            restX: C[0] - A[0],
            reach: Math.hypot(...u1) + Math.hypot(...u2),
        };
    });
    const footOffset = Object.fromEntries(LEGS.map(([leg, , chain]) => {
        const C = head(chain[2]);
        return [leg, [C[0], C[2] + 0.02]];
    }));
    return {
        skeleton,
        count,
        index,
        legs,
        footOffset,
        local: Array.from({ length: count }, () => [0, 0, 0]),
        R: Array.from({ length: count }, () => new Float64Array(9)),
        J: Array.from({ length: count }, () => new Float64Array(3)),
        L: new Float64Array(9),
        T: new Float64Array(9),
        legBones: new Set(legs.flatMap((leg) => leg.chain)),
        rhythm: { phase: 0, speed: 0 },
        state: {
            x: 0, z: 0, heading: 0, speed: 0, turning: 0, head: 0, alert: 0,
        },
        feet: LEGS.map(() => ({
            x: 0, z: 0, swing: 0, planted: true, length: 0, ground: 0,
        })),
        hooves: LEGS.map(() => ({
            x: 0, y: 0, z: 0, ground: 0, stance: 0, planX: 0, planZ: 0,
        })),
    };
}

/**
 * Pose one horse at board time `time`: its bones in the world for the shader table, its hooves,
 * the ground plane under it.
 * @param {ReturnType<typeof createHorseRig>} rig
 * @param {object} horse one of buildBand()'s, its feet planned (planFootfalls)
 * @param {number} time board clock (s)
 * @param {(x: number, z: number) => number} heightAt the drawn ground
 * @param {Float32Array} [table] shader table, written at `offset` (8 floats a bone)
 * @param {number} [offset]
 * @param {typeof ODYSSEY_HORSES} [cfg]
 */
export function poseHorse(rig, horse, time, heightAt, table = null, offset = 0, cfg = ODYSSEY_HORSES) {
    const {
        skeleton, index, local, R, J, L,
    } = rig;
    const { k, life } = horse;
    const { seed, model } = horse.member;
    const foal = model === 'foal';
    const state = horseStateAt(horse, time, rig.state);
    const rhythm = horseRhythmAt(horse, time, rig.rhythm);
    const { segment, u: segU } = horseSegmentAt(horse, time);
    const buck = segment.kind === 'buck' ? Math.sin(Math.PI * segU) ** 2 : 0;
    for (const l of local) { l[0] = 0; l[1] = 0; l[2] = 0; }
    const set = (name, rx, ry = 0, rz = 0) => {
        const l = local[index[name]];
        l[0] += rx; l[1] += ry; l[2] += rz;
    };
    const { feet } = rig;
    rig.legs.forEach((leg, l) => {
        const f = horseFootAt(horse, l, time, feet[l]);
        f.ground = heightAt(f.x, f.z);
    });
    const sh = Math.sin(state.heading);
    const ch = Math.cos(state.heading);
    const g = state.head;
    const v = rhythm.speed;
    const walk = clamp01(state.speed / horse.walkSpeed);
    const trot = smooth(1.8, 3.0, v) * (1 - smooth(4.0, 5.0, v));
    const canter = smooth(4.0, 5.2, v);
    const ph = rhythm.phase * TAU;
    const fore = 0.5 * (feet[1].ground + feet[3].ground);
    const hind = 0.5 * (feet[0].ground + feet[2].ground);
    const left = 0.5 * (feet[0].ground + feet[1].ground);
    const right = 0.5 * (feet[2].ground + feet[3].ground);
    const G = cfg.graze[model];
    // The canter's rocking: the forehand rises as the hinds land and dips as the leading fore does.
    const rock = canter * 0.07 * Math.sin(ph + 0.6);
    const pitch = (-Math.atan2(fore - hind, 1.14 * k) * 0.9) + (G.dip * g) + rock + (0.3 * buck);
    const roll = -Math.atan2(left - right, 0.3 * k) * 0.12;
    const swingOf = (l) => (feet[l].planted ? 0 : Math.sin(Math.PI * feet[l].swing));
    const breathe = Math.sin(((time / (foal ? 2.6 : 3.8)) + (seed * 0.37)) * TAU);
    const sway = noise((time * 0.19) + seed, seed) * (1 - walk);
    set('root', 0, 0, (sway * 0.015) + (0.02 * (swingOf(1) - swingOf(3)) * walk * (1 - canter)));
    set('pelvis', (0.01 * breathe) - (0.06 * canter * Math.sin(ph + 2.2)), 0, 0.04 * (swingOf(0) - swingOf(2)) * (1 - canter));
    set('chest', -0.01 * breathe, 0, 0.03 * (swingOf(1) - swingOf(3)) * (1 - canter));
    // THE HEAD AND NECK: grazing down the three neck bones; the walk's nod with the fore feet; the
    // trot's steady head; the canter's pump (the neck swings down as the forehand lands); a run
    // stretches the neck forward; a look turns through the chain (ears first).
    const lookAt = (lag) => horseChannel(horse, 'look', time - lag, 1.1);
    const crop = g * (1 - walk);
    const nod = 0.05 * (swingOf(1) + swingOf(3)) * walk * (1 - trot) * (1 - canter);
    const pump = canter * 0.13 * Math.sin(ph - 0.4);
    const stretch = canter * 0.22;
    const grazeT = (time * 0.43) + seed;
    set('neck0', (G.neck0 * g) + (0.12 * walk * (1 - g)) + stretch + nod + pump - (0.05 * (1 - g) * (1 - canter))
        + (0.35 * buck), lookAt(0.42) * 0.2);
    set('neck1', (G.neck1 * g) - (0.5 * pump), lookAt(0.32) * 0.26);
    set('neck2', (G.neck2 * g) - (0.06 * (1 - g) * state.alert) - (0.1 * stretch), lookAt(0.22) * 0.26);
    set(
        'head',
        (G.head * g) + (0.05 * crop * Math.sin(time * TAU * 1.2)) + (0.04 * (1 - g) * noise(time * 0.6, seed + 3))
            - (0.35 * stretch) - (0.4 * pump),
        (lookAt(0.12) * 0.18) + (0.12 * crop * noise(grazeT, seed + 5)),
    );
    const cud = (1 - g) * (1 - walk) * Math.max(0, noise(time * 0.15, seed + 9)) * 0.5;
    set('jaw', 0.09 * Math.max(0, Math.sin(time * TAU * 1.6)) * Math.min(1, crop + cud));
    const look0 = lookAt(0);
    const listen = (s) => noise((time * 0.35) + s, s) * 0.55 * (1 - state.alert);
    const flick = (s) => Math.max(0, Math.sin((time * 1.7) + (s * 3.1))) ** 14;
    set('earL', 0.1 * g, (look0 * 0.6) + listen(seed + 11), (-0.2 * (1 - state.alert)) + (0.35 * flick(seed)));
    set('earR', 0.1 * g, (look0 * 0.6) + listen(seed + 13), (0.2 * (1 - state.alert)) - (0.35 * flick(seed + 2)));
    // THE TAIL: hanging, swished at flies now and then while it grazes (a wave down its three
    // bones), lifted and streaming in a run, flagged up in a foal's buck.
    const swish = Math.max(0, noise(time * 0.27, seed + 17) - 0.35) / 0.65;
    const flies = swish * (1 - canter);
    const swishAt = (lag) => 0.5 * flies * Math.sin((time - lag) * 7.5);
    const stream = (0.75 * canter) + (0.25 * trot) + (0.9 * buck);
    set('tail0', 0.06 + stream + (0.1 * flies), swishAt(0) * 0.6);
    set('tail1', (-0.1 * stream) + (0.05 * canter * Math.sin(ph * 2)), swishAt(0.08));
    set('tail2', (-0.15 * stream) + (0.08 * canter * Math.sin((ph * 2) - 0.6)), swishAt(0.16) * 1.2);
    // FORWARD KINEMATICS of the body and head (the legs after).
    const rootIndex = index.root;
    const lr = local[rootIndex];
    rotation(pitch + lr[0], state.heading, roll + lr[2], R[rootIndex]);
    // Height: over the mean of the ground under the hooves, carried lower the faster it goes (the
    // legs need the give), the trot's bounce twice a stride, the canter's rise and fall once.
    const groundMean = 0.25 * (feet[0].ground + feet[1].ground + feet[2].ground + feet[3].ground);
    const carry = (0.012 + (0.03 * walk) + (0.035 * trot) + (0.06 * canter)) * life;
    const bounce = ((0.012 * trot * Math.cos(2 * ph)) + (0.03 * canter * Math.sin(ph + 1.4))) * life;
    J[rootIndex][0] = state.x;
    J[rootIndex][1] = groundMean + (skeleton[rootIndex].head[1] * k) - carry + bounce + (0.003 * k * breathe);
    J[rootIndex][2] = state.z;
    const fkBone = (b) => {
        const { parent, head } = skeleton[b];
        const pr = R[parent];
        const ph2 = skeleton[parent].head;
        const dx = (head[0] - ph2[0]) * k;
        const dy = (head[1] - ph2[1]) * k;
        const dz = (head[2] - ph2[2]) * k;
        J[b][0] = J[parent][0] + (pr[0] * dx) + (pr[1] * dy) + (pr[2] * dz);
        J[b][1] = J[parent][1] + (pr[3] * dx) + (pr[4] * dy) + (pr[5] * dz);
        J[b][2] = J[parent][2] + (pr[6] * dx) + (pr[7] * dy) + (pr[8] * dz);
        const l = local[b];
        mul3(pr, rotation(l[0], l[1], l[2], L), R[b]);
    };
    const { legBones } = rig;
    const bodyFk = () => {
        for (let b = 0; b < skeleton.length; b += 1) {
            if (b !== rootIndex && !legBones.has(b)) fkBone(b);
        }
    };
    bodyFk();
    // A buck kicks both hind hooves up and back off the ground (the foal plants its fores).
    const kickOf = (l) => (rig.legs[l].front ? 0 : buck);
    // Lower the body if a hoof bearing weight would be out of its leg's reach (each hoof's say
    // fading over the start of its swing and back before it lands, so nothing jumps).
    let drop = 0;
    rig.legs.forEach((leg, l) => {
        const f = feet[l];
        const say = (f.planted ? 1 : 1 - (s5(f.swing / 0.3) * s5((1 - f.swing) / 0.3))) * (1 - kickOf(l));
        if (say <= 0) return;
        const A = J[leg.top];
        const reach = leg.reach * k * 0.985;
        const dx = f.x - A[0];
        const dz = f.z - A[2];
        const horiz = (dx * dx) + (dz * dz);
        const tY = f.ground + (leg.fetlock * k);
        const needY = tY + Math.sqrt(Math.max(0, (reach * reach) - horiz));
        drop = Math.max(drop, (A[1] - needY) * say);
    });
    if (drop > 0) {
        const most = 0.18 * k;
        J[rootIndex][1] -= most * (1 - Math.exp(-drop / most));
        bodyFk();
    }
    // THE LEGS: each reaches its hoof (two segments in the leg's plane), the hoof flat on the
    // ground while planted, folded in the swing (more at speed).
    const { hooves } = rig;
    const liftShare = cfg.lift + ((cfg.liftRun - cfg.lift) * clamp01((v - 1.5) / 4));
    rig.legs.forEach((leg, l) => {
        const f = feet[l];
        const { parent } = skeleton[leg.top];
        const P = R[parent];
        const A = J[leg.top];
        const kick = kickOf(l);
        const lift = (f.planted ? 0
            : liftShare * k * Math.min(1, 0.35 + (f.length / horse.strideW)) * Math.sin(Math.PI * f.swing))
            + (0.32 * k * kick);
        const tx = f.x - (sh * 0.3 * k * kick);
        const ty = f.ground + (leg.fetlock * k) + lift;
        const tz = f.z - (ch * 0.3 * k * kick);
        const wx = (tx - A[0]) / k;
        const wy = (ty - A[1]) / k;
        const wz = (tz - A[2]) / k;
        const vx = (P[0] * wx) + (P[3] * wy) + (P[6] * wz);
        const vy = (P[1] * wx) + (P[4] * wy) + (P[7] * wz);
        const vz = (P[2] * wx) + (P[5] * wy) + (P[8] * wz);
        const [u1y, u1z] = leg.u1;
        const [u2y, u2z] = leg.u2;
        const l1 = Math.hypot(u1y, u1z);
        const l2 = Math.hypot(u2y, u2z);
        // A grazing foal splays its fores a little (its legs are long for its neck).
        const splay = foal && leg.front ? (G.splay ?? 0) * g * (leg.restX >= 0 ? 1 : -1) : 0;
        const side = vx - leg.restX - splay;
        const down = -Math.hypot(vy, side);
        const d = Math.min(Math.max(Math.hypot(down, vz), Math.abs(l1 - l2) * 1.05), (l1 + l2) * 0.999);
        const Pdot = (u1y * u2y) + (u1z * u2z);
        const Q = (u1z * u2y) - (u1y * u2z);
        const m = (((d * d) - ((l1 * l1) + (l2 * l2))) / 2);
        const Rm = Math.hypot(Pdot, Q) || 1e-9;
        const phi0 = Math.atan2(Q, Pdot);
        const spread = Math.acos(Math.max(-1, Math.min(1, m / Rm)));
        const bend = leg.front
            ? Math.min(wrapAngle(phi0 + spread), phi0 + 1.9)
            : Math.max(wrapAngle(phi0 - spread), phi0 - 1.9);
        const cb = Math.cos(bend);
        const sb = Math.sin(bend);
        const cy = u1y + ((u2y * cb) - (u2z * sb));
        const cz = u1z + ((u2y * sb) + (u2z * cb));
        const swingAngle = Math.atan2(vz, down) - Math.atan2(cz, cy);
        const abduct = -Math.atan2(side + splay, Math.max(0.2, -vy)) + (splay * 0.6);
        const [c0, c1, c2] = leg.chain;
        local[leg.top][0] = wrapAngle(swingAngle);
        local[leg.top][2] = abduct;
        local[c0][0] = 0;
        local[c1][0] = bend;
        fkBone(leg.top);
        fkBone(c0);
        fkBone(c1);
        const along = 0.3 * k;
        const ahead = heightAt(f.x + (sh * along), f.z + (ch * along));
        const slope = (ahead - heightAt(f.x - (sh * along), f.z - (ch * along))) / (0.6 * k);
        const curl = (f.planted ? 0 : (leg.front ? 1.2 : 0.9) * Math.sin(Math.PI * Math.min(1, f.swing * 1.15)))
            + (0.6 * kick);
        rotation(-Math.atan(slope) + curl, state.heading, 0, rig.T);
        const rc = R[c1];
        const t = rig.T;
        const m21 = (rc[2] * t[1]) + (rc[5] * t[4]) + (rc[8] * t[7]);
        const m22 = (rc[2] * t[2]) + (rc[5] * t[5]) + (rc[8] * t[8]);
        local[c2][0] = Math.atan2(m21, m22);
        fkBone(c2);
        const o = hooves[l];
        const hb = skeleton[c2].head;
        const tip = rig.footOffset[leg.leg];
        const r = R[c2];
        const ddx = (tip[0] - hb[0]) * k;
        const ddy = (0 - hb[1]) * k;
        const ddz = (tip[1] - hb[2]) * k;
        o.x = J[c2][0] + (r[0] * ddx) + (r[1] * ddy) + (r[2] * ddz);
        o.y = J[c2][1] + (r[3] * ddx) + (r[4] * ddy) + (r[5] * ddz);
        o.z = J[c2][2] + (r[6] * ddx) + (r[7] * ddy) + (r[8] * ddz);
        o.ground = heightAt(o.x, o.z);
        o.stance = f.planted && kick < 0.01 ? 1 : 0;
        o.planX = f.x;
        o.planZ = f.z;
    });
    if (table) {
        for (let b = 0; b < skeleton.length; b += 1) {
            const o = offset + (b * 8);
            const r = R[b];
            const [hx, hy, hz] = skeleton[b].head;
            quatFrom(r, table, o);
            table[o + 4] = J[b][0] - (k * ((r[0] * hx) + (r[1] * hy) + (r[2] * hz)));
            table[o + 5] = J[b][1] - (k * ((r[3] * hx) + (r[4] * hy) + (r[5] * hz)));
            table[o + 6] = J[b][2] - (k * ((r[6] * hx) + (r[7] * hy) + (r[8] * hz)));
            table[o + 7] = k;
        }
    }
    const e = 0.6 * k;
    const gx = (heightAt(state.x + e, state.z) - heightAt(state.x - e, state.z)) / (2 * e);
    const gz = (heightAt(state.x, state.z + e) - heightAt(state.x, state.z - e)) / (2 * e);
    return {
        hooves, ground: heightAt(state.x, state.z), gx, gz, state, rhythm,
    };
}

/** Reveal (0 or 1) at journey progress `p`: drawn through the window, never faded in view. */
export function horseRevealAt(p, cfg = ODYSSEY_HORSES) {
    return p >= cfg.window[0] && p <= cfg.window[1] ? 1 : 0;
}

/**
 * Where the band runs (for captures and tests): the loop seconds each run sets off and arrives,
 * over the whole band.
 * @param {ReturnType<typeof buildBand>} band
 */
export function bandRunTimes(band) {
    const runs = [];
    band.forEach((horse) => {
        horse.segments.forEach((s) => {
            if (s.kind !== 'run') return;
            const r = runs.find((q) => Math.abs(q.from - s.t0) < 30);
            if (r) {
                r.from = Math.min(r.from, s.t0);
                r.to = Math.max(r.to, s.t0 + s.dur);
            } else runs.push({ from: s.t0, to: s.t0 + s.dur });
        });
    });
    return runs.sort((a, b) => a.from - b.from);
}
