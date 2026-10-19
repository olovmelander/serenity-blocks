/**
 * Grainfields — how a horse moves its legs (CPU, three-free).
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
 * A hoof on the ground stays put: the leg turns about its shoulder or hip so the hoof slides back
 * under the body exactly as fast as the body moves over it. In the air the leg swings forward
 * with its knee (in front) or hock (behind) and fetlock folded. A leg is rigid from the shoulder
 * to the hoof only in name: where a planted leg leans, the body over it sinks
 * (its length times one minus the cosine of the lean), so the withers and the croup rise and fall
 * with the legs under them, and the body pitches when the fores and the hinds disagree. In the
 * canter's and the gallop's moment in the air nothing holds the body down: it rises.
 *
 * The gait is a continuous coordinate (0 stand, 1 walk, 2 trot, 3 canter, 4 gallop) eased toward
 * the one the speed asks for, and every number of the pose blends between the two gaits on
 * either side of it, so a horse breaks from a trot into a canter over a stride, not in a frame.
 */
import { TAU, clamp, smooth } from './grainfields-core.js';

/** The legs, in the order every per-leg array keeps: front left, front right, hind left, hind right. */
export const LEGS = Object.freeze(['frontLeft', 'frontRight', 'hindLeft', 'hindRight']);

/**
 * The gaits. `speed` (m/s) is where the gait is at home; `freq` its strides a second (a small,
 * quick-footed breed); `duty` the share of a stride each hoof is down; `offsets` when each leg's
 * stance begins in the stride (right lead); `knee`, `hock`, `fetlock` how far the joints fold
 * mid-swing (radians); `reach` how far the fore reaches past its stance; `nod` the neck's swing
 * (radians) and `nods` how many per stride; `carry` how high the tail is carried (radians).
 */
const GAIT_ROWS = [
    // name, speed, freq, duty, offsets [FL, FR, HL, HR], knee, hock, fetlock, reach, nod, nods, carry
    ['stand', 0, 0.9, 1, [0.25, 0.75, 0, 0.5], 0, 0, 0, 0, 0, 2, 0],
    ['walk', 1.5, 0.95, 0.64, [0.25, 0.75, 0, 0.5], 0.6, 0.32, 0.6, 0.04, 0.07, 2, 0.05],
    ['trot', 3.6, 1.45, 0.44, [0.5, 0, 0, 0.5], 1.0, 0.45, 0.95, 0.06, 0.03, 2, 0.3],
    ['canter', 6.5, 1.85, 0.4, [0.3, 0.55, 0, 0.3], 1.2, 0.55, 1.1, 0.16, 0.12, 1, 0.55],
    ['gallop', 11, 2.3, 0.27, [0.42, 0.52, 0, 0.1], 1.4, 0.62, 1.25, 0.24, 0.16, 1, 0.85],
];
export const GAITS = Object.freeze(GAIT_ROWS.map(([
    name, speed, freq, duty, offsets, knee, hock, fetlock, reach, nod, nods, carry,
]) => Object.freeze({
    name, speed, freq, duty, offsets: Object.freeze(offsets), knee, hock, fetlock, reach, nod, nods, carry,
})));

/** The speeds (m/s) between which one gait hands over to the next. */
export const GAIT_BREAKS = Object.freeze([[0.08, 0.3], [2.3, 2.7], [4.8, 5.3], [8.2, 8.9]]);

/** The leg (m): from the shoulder or the hip to the ground; the wheelbase between them. */
export const LEG_LENGTH = 1.0;
export const WHEELBASE = 0.98;
/** How far a planted leg may lean (radians): beyond it the hoof slides rather than the body dropping. */
const MAX_LEAN = 0.78;
/**
 * How much of a leaning leg's lost height the body really loses: the leg is not a stilt, its
 * joints and the fetlock's spring take most of it up.
 */
const SINK = 0.35;

/** The gait coordinate the speed asks for (0 stand .. 4 gallop, continuous across each break). */
export function gaitFor(speed) {
    const v = Math.max(0, Number.isFinite(speed) ? speed : 0);
    let g = 0;
    GAIT_BREAKS.forEach(([lo, hi]) => { g += smooth(lo, hi, v); });
    return g;
}

const wrap = (x) => x - Math.floor(x);
/** The shortest signed difference between two phases (cycles). */
const phaseDelta = (a, b) => wrap(b - a + 0.5) - 0.5;

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
    const mix = (key) => a[key] + (b[key] - a[key]) * t;
    out.g = gg;
    out.freq = mix('freq');
    out.duty = mix('duty');
    out.knee = mix('knee');
    out.hock = mix('hock');
    out.fetlock = mix('fetlock');
    out.reach = mix('reach');
    out.nod = mix('nod');
    out.nods = t < 0.5 ? a.nods : b.nods;
    out.carry = mix('carry');
    const offsets = out.offsets || (out.offsets = [0, 0, 0, 0]);
    for (let leg = 0; leg < 4; leg++) {
        // A left lead mirrors the legs: front left takes front right's beat, and so on.
        const from = lead < 0 ? leg ^ 1 : leg;
        const oa = a.offsets[from];
        offsets[leg] = wrap(oa + phaseDelta(oa, b.offsets[from]) * t);
    }
    return out;
}

/** Smootherstep. */
const ease = (x) => {
    const t = clamp(x, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * One leg at its own phase of the stride (`psi`, cycles from the start of its stance): its angle
 * at the shoulder or hip (positive turns the hoof back), its knee or hock (positive folds the
 * lower leg back: a fore's knee folds that way, a hind's hock the other, so it comes out
 * negative), its fetlock (positive curls the hoof back), and how firmly it is planted (0..1).
 * `stride` is half the ground the body covers while the hoof is down (metres).
 */
export function legAt(gait, front, psi, stride, out = {}) {
    const duty = clamp(gait.duty, 0.05, 1);
    const lean = Math.asin(clamp(stride / LEG_LENGTH, 0, Math.sin(MAX_LEAN)));
    const p = wrap(psi);
    if (p < duty || duty >= 0.999) {
        // On the ground: from reaching forward to pushing back, the hoof still.
        const s = duty >= 0.999 ? 0.5 : p / duty;
        out.upper = Math.asin(clamp((stride * (2 * s - 1)) / LEG_LENGTH, -Math.sin(MAX_LEAN), Math.sin(MAX_LEAN)));
        out.lower = 0;
        out.fetlock = 0;
        // Planted, easing in and out at the ends of the stance (no jump in the body's height).
        out.planted = duty >= 0.999 ? 1 : smooth(0, 0.08, s) * (1 - smooth(0.9, 1, s));
    } else {
        // In the air: back to front, the joints folded most a little before mid-swing.
        const w = (p - duty) / (1 - duty);
        const reach = front ? gait.reach : gait.reach * 0.4;
        // ...reaching past its touchdown and drawing back onto it (the hoof meets the ground still).
        out.upper = lean - 2 * lean * ease(w) - reach * Math.sin(Math.PI * w ** 1.4);
        const fold = Math.sin(Math.PI * (w + 0.12 * Math.sin(Math.PI * w)));
        out.lower = front ? gait.knee * fold : -gait.hock * fold;
        out.fetlock = gait.fetlock * Math.sin(Math.PI * Math.min(1, w * 1.08)) * (front ? 1 : 0.8);
        out.planted = 0;
    }
    return out;
}

/** A fresh gait state for a horse (all four hooves down, standing square). */
export function createGaitState(phase = 0, lead = 1) {
    return {
        g: 0,
        phase: wrap(phase),
        lead: lead < 0 ? -1 : 1,
        front: 0,
        hind: 0,
        gait: gaitAt(0, lead),
        legs: LEGS.map(() => ({
            upper: 0, lower: 0, fetlock: 0, planted: 1,
        })),
        pitch: 0,
        bob: 0,
        nod: 0,
        carry: 0,
    };
}

/**
 * Advance a horse's gait by `dt` at `speed` (m/s) and pose its legs: writes each leg's angles, the
 * body's sink (`bob`, metres, negative down) and pitch (radians, positive nose down) from the
 * planted legs, the neck's nod and the tail's carriage.
 */
export function stepGait(state, speed, dt) {
    const v = Math.max(0, speed);
    const target = gaitFor(v);
    // Ease toward the asked gait over about a stride (faster up than down).
    const rate = target > state.g ? 3.2 : 2.2;
    state.g += (target - state.g) * (1 - Math.exp(-rate * dt));
    const gait = gaitAt(state.g, state.lead, state.gait);
    state.phase = wrap(state.phase + gait.freq * dt);
    // Half the ground the body covers while a hoof is down.
    const stride = (0.5 * v * gait.duty) / Math.max(0.3, gait.freq);
    let frontSink = 0;
    let frontHold = 0;
    let hindSink = 0;
    let hindHold = 0;
    state.legs.forEach((leg, i) => {
        const front = i < 2;
        legAt(gait, front, state.phase - gait.offsets[i], stride, leg);
        const sink = SINK * LEG_LENGTH * (1 - Math.cos(leg.upper)) * leg.planted;
        if (front) {
            frontSink += sink;
            frontHold += leg.planted;
        } else {
            hindSink += sink;
            hindHold += leg.planted;
        }
    });
    // Where legs are down the body rests on them; with none down it rises (the moment in the air).
    const air = 0.04 * smooth(2.5, 3.5, state.g);
    const front = frontHold > 0.01 ? frontSink / frontHold : -air;
    const hind = hindHold > 0.01 ? hindSink / hindHold : -air;
    const k = 1 - Math.exp(-dt * 30);
    state.front += (front * Math.min(1, frontHold) - air * (1 - Math.min(1, frontHold)) - state.front) * k;
    state.hind += (hind * Math.min(1, hindHold) - air * (1 - Math.min(1, hindHold)) - state.hind) * k;
    state.bob = -0.5 * (state.front + state.hind);
    state.pitch = Math.atan2(state.front - state.hind, WHEELBASE);
    state.nod = gait.nod * Math.cos(TAU * gait.nods * state.phase);
    state.carry = gait.carry * smooth(0.5, 1.5, state.g);
    return state;
}
