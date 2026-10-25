/**
 * Grainfields — the horse's gaits (CPU, three-free): when each hoof is down, and how the legs,
 * the back and the neck move through a stride.
 *
 * The four gaits by their footfalls (the order the hooves strike the ground and how long each
 * stays down), slowest first, for a right lead (a left lead mirrors left and right):
 *
 *  - walk: four beats, left hind, left fore, right hind, right fore, a quarter of the stride
 *    apart; each hoof is down for two thirds of it;
 *  - trot: two beats, the diagonal pairs together, each down for under half the stride;
 *  - canter: three beats, the outside hind, then the inside hind with the outside fore, then the
 *    leading fore, then a moment in the air;
 *  - gallop: four beats, the hinds a tenth of the stride apart, then the fores, then the air.
 *
 * Each gait also carries how a leg folds in the air (the fore's elbow and knee, the hind's stifle
 * and hock, the fetlocks curling, how far a leg reaches past where it lands), how far the fetlock
 * sinks under the horse's weight, and how the body rides the stride: the withers and the croup
 * rising and falling each on its own beat (the walk vaults over its straight legs and is highest
 * over them; the trot and the faster gaits are springs, lowest over the legs and highest in the
 * air), the back rounding and stretching (the canter and the gallop), and the neck nodding (twice
 * a stride at a walk, as each fore lands; once at a canter or a gallop, down as the fores take the
 * weight). grainfields-horse-motion.js plants the hooves and solves the legs to them.
 *
 * The gait is a continuous coordinate (0 stand, 1 walk, 2 trot, 3 canter, 4 gallop) eased toward
 * the one the speed asks for, and every number blends between the two gaits on either side of it,
 * so a horse breaks from a trot into a canter over a stride, not in a frame.
 */
import { clamp, smooth } from './grainfields-core.js';

/** The legs, in the order every per-leg array keeps: front left, front right, hind left, hind right. */
export const LEGS = Object.freeze(['frontLeft', 'frontRight', 'hindLeft', 'hindRight']);

/**
 * The gaits. `speed` (m/s) is where the gait is at home; `freq` its strides a second (a small,
 * quick-footed breed: a big horse's, scaled up for legs three quarters as long, so its hooves
 * stay down for no more ground than its legs can reach); `duty` the share of a stride each hoof
 * is down; `offsets` when each leg's
 * stance begins in the stride (right lead).
 *
 * In the air (radians at the peak of the swing): `fold` the fore's shoulder and elbow lifting the
 * forearm, `elbow` the forearm swinging forward, `knee` the fore's knee folding back, `stifle` the
 * hind's stifle and hock folding together, `hock` the hind's cannon swinging forward under the
 * belly, `curl` the fetlocks curling, `reach` the fore reaching past its touchdown (the hind a
 * share of it). On the ground: `load` how far the fetlock sinks at mid-stance.
 *
 * The body (metres, radians): `drop` how much lower it rides than standing; `front` and `hind`
 * how far the withers and the croup rise and fall, `beats` how many times a stride, peaking at
 * `frontAt` and `hindAt` (stride phases); `flex` how far the back rounds (peaking at `flexAt`);
 * `nod` the neck's swing (positive down) peaking at `nodAt`; `carry` how high the tail is carried.
 */
const GAIT_ROWS = [
    {
        name: 'stand',
        speed: 0,
        freq: 0,
        duty: 1,
        offsets: [0.25, 0.75, 0, 0.5],
        fold: 0.22,
        elbow: 0.2,
        knee: 0.8,
        stifle: 0.22,
        hock: 0.3,
        curl: 0.55,
        reach: 0.04,
        load: 0.12,
        drop: 0,
        front: 0,
        hind: 0,
        beats: 2,
        frontAt: 0.07,
        hindAt: 0.32,
        flex: 0,
        flexAt: 0,
        nod: 0,
        nodAt: 0.35,
        carry: 0,
    },
    {
        name: 'walk',
        speed: 1.5,
        freq: 1.05,
        duty: 0.64,
        offsets: [0.25, 0.75, 0, 0.5],
        fold: 0.25,
        elbow: 0.25,
        knee: 0.95,
        stifle: 0.32,
        hock: 0.35,
        curl: 0.6,
        reach: 0.06,
        load: 0.22,
        drop: 0,
        front: 0.012,
        hind: 0.015,
        beats: 2,
        frontAt: 0.07,
        hindAt: 0.32,
        flex: 0.01,
        flexAt: 0.3,
        nod: 0.075,
        nodAt: 0.35,
        carry: 0.05,
    },
    {
        name: 'trot',
        speed: 3.6,
        freq: 1.65,
        duty: 0.42,
        offsets: [0.5, 0, 0, 0.5],
        fold: 0.32,
        elbow: 0.35,
        knee: 1.45,
        stifle: 0.46,
        hock: 0.5,
        curl: 0.95,
        reach: 0.12,
        load: 0.38,
        drop: 0.03,
        front: 0.024,
        hind: 0.024,
        beats: 2,
        frontAt: 0.47,
        hindAt: 0.47,
        flex: 0.01,
        flexAt: 0.22,
        nod: 0.025,
        nodAt: 0.22,
        carry: 0.3,
    },
    {
        name: 'canter',
        speed: 6.5,
        freq: 2.1,
        duty: 0.34,
        offsets: [0.3, 0.55, 0, 0.3],
        fold: 0.36,
        elbow: 0.42,
        knee: 1.65,
        stifle: 0.55,
        hock: 0.6,
        curl: 1.05,
        reach: 0.17,
        load: 0.5,
        drop: 0.04,
        front: 0.042,
        hind: 0.045,
        beats: 1,
        frontAt: 0.15,
        hindAt: 0.75,
        flex: 0.05,
        flexAt: 0.1,
        nod: 0.11,
        nodAt: 0.7,
        carry: 0.55,
    },
    {
        name: 'gallop',
        speed: 11,
        freq: 2.6,
        duty: 0.23,
        offsets: [0.42, 0.52, 0, 0.1],
        fold: 0.42,
        elbow: 0.48,
        knee: 1.85,
        stifle: 0.65,
        hock: 0.75,
        curl: 1.15,
        reach: 0.22,
        load: 0.6,
        drop: 0.06,
        front: 0.05,
        hind: 0.05,
        beats: 1,
        frontAt: 0.1,
        hindAt: 0.68,
        flex: 0.08,
        flexAt: 0.95,
        nod: 0.14,
        nodAt: 0.6,
        carry: 0.85,
    },
];
const BLENDED = Object.freeze(['freq', 'duty', 'fold', 'elbow', 'knee', 'stifle', 'hock', 'curl', 'reach', 'load',
    'drop', 'front', 'hind', 'flex', 'nod', 'carry']);
/** Stride phases that blend as phases (the shortest way round). */
const PHASED = Object.freeze(['frontAt', 'hindAt', 'flexAt', 'nodAt']);
export const GAITS = Object.freeze(GAIT_ROWS.map((row) => Object.freeze({ ...row, offsets: Object.freeze(row.offsets) })));

/** The speeds (m/s) between which one gait hands over to the next. */
export const GAIT_BREAKS = Object.freeze([[0.08, 0.3], [2.3, 2.7], [4.8, 5.3], [8.2, 8.9]]);

/** The gait coordinate the speed asks for (0 stand .. 4 gallop, continuous across each break). */
export function gaitFor(speed) {
    const v = Math.max(0, Number.isFinite(speed) ? speed : 0);
    let g = 0;
    GAIT_BREAKS.forEach(([lo, hi]) => { g += smooth(lo, hi, v); });
    return g;
}

export const wrap = (x) => x - Math.floor(x);
/** The shortest signed difference between two phases (cycles). */
export const phaseDelta = (a, b) => wrap(b - a + 0.5) - 0.5;

/**
 * The gait's numbers at coordinate `g`, blended between the gaits on either side, for a lead
 * (+1 right, -1 left: the left lead swaps the left and right legs' offsets). Writes into `out`.
 */
export function gaitAt(g, lead = 1, out = {}) {
    const gg = clamp(g, 0, GAITS.length - 1);
    const i = Math.min(GAITS.length - 2, Math.floor(gg));
    const t = gg - i;
    const a = GAITS[i];
    const b = GAITS[i + 1];
    out.g = gg;
    BLENDED.forEach((key) => { out[key] = a[key] + (b[key] - a[key]) * t; });
    PHASED.forEach((key) => { out[key] = wrap(a[key] + phaseDelta(a[key], b[key]) * t); });
    // Twice a stride gives way to once over the trot-canter break.
    out.beats = t < 0.5 ? a.beats : b.beats;
    out.beatMix = a.beats === b.beats ? 0 : t;
    const offsets = out.offsets || (out.offsets = [0, 0, 0, 0]);
    for (let leg = 0; leg < 4; leg++) {
        // A left lead mirrors the legs: front left takes front right's beat, and so on.
        const from = lead < 0 ? leg ^ 1 : leg;
        const oa = a.offsets[from];
        offsets[leg] = wrap(oa + phaseDelta(oa, b.offsets[from]) * t);
    }
    return out;
}

/** A wave over the stride: peaks of 1 at `at`, `beats` times a stride (blended across a change of beats). */
function wave(gait, phase, at) {
    const two = Math.cos(2 * Math.PI * 2 * (phase - at));
    const one = Math.cos(2 * Math.PI * (phase - at));
    if (!gait.beatMix) return gait.beats === 2 ? two : one;
    return two + (one - two) * gait.beatMix;
}

/**
 * How the body rides the stride at `phase`: the withers' and the croup's height over standing
 * (metres), the back's rounding (radians: positive rounds it) and the neck's nod (positive down).
 */
export function bodyAt(gait, phase, out = {}) {
    out.front = -gait.drop + gait.front * wave(gait, phase, gait.frontAt);
    out.hind = -gait.drop + gait.hind * wave(gait, phase, gait.hindAt);
    out.flex = gait.flex * Math.cos(2 * Math.PI * (phase - gait.flexAt));
    out.nod = gait.nod * wave(gait, phase, gait.nodAt);
    return out;
}

/** Smootherstep. */
export const ease = (x) => {
    const t = clamp(x, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * How far a leg folds through its swing (`w`, 0 lift-off .. 1 touchdown): the main fold (0..1,
 * most a little before mid-swing), the knee's (earlier, and open again before the hoof reaches
 * forward), the fetlock's curl, and the reach past the touchdown (most late in the swing).
 */
export function swingShape(w, out = {}) {
    const x = clamp(w, 0, 1);
    out.fold = Math.sin(Math.PI * (x + 0.12 * Math.sin(Math.PI * x)));
    out.knee = Math.sin(Math.PI * Math.min(1, x / 0.82)) ** 1.15;
    out.curl = Math.sin(Math.PI * Math.min(1, x * 1.1));
    out.reach = Math.sin(Math.PI * x ** 1.6);
    return out;
}
