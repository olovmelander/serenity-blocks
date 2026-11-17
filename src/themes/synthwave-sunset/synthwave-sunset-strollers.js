/**
 * Synthwave Sunset — the people out on the pier for the evening: who they are, where each one
 * walks or stands, and the pose of every bone at any moment. Three-free and renderer-free (the
 * draw is synthwave-sunset-people.js; the figures come from scripts/blender/synthwave_strollers.py).
 *
 * A handful of parties, each with a plan:
 *  - WALKERS stroll a loop of the deck: out along one side to the pier head, round, and back along
 *    the other into the first pavilion (its walls hide the turn), or up and down the far stretch.
 *    A couple walks hand in hand, a child beside a parent; some pause on the way to look at the
 *    sea. Where a walker is is a function of the clock alone (a seek lands right).
 *  - STANDERS lean on a rail or stand at the pier head's end, shift their weight, look about.
 *
 * And everyone looks up at a firework when it bursts.
 *
 * A walk is built the way people walk, not as a swing of two sticks: the gait's phase rides on the
 * distance walked (so the feet do not skate), the thigh moves back steadily while its foot is down
 * and swings through quickly, the knee takes the weight and folds to clear the ground, the foot
 * strikes heel first and rolls off the toe, the hips turn and drop over each step while the
 * shoulders turn against them and the arms swing with the opposite leg. The body is then set down
 * so its lowest heel or toe stands on the deck, which gives the rise and fall of every step for
 * free. A walker who stops slows over the last metre, its steps shortening to nothing, and turns
 * on the spot with a few small steps.
 *
 * Model frame (each figure): x its left, y up, z forward, metres; rest joints from the model.
 * Out: per person a row of STROLLER_ROW texels: two a bone, its rotation in the world (a unit
 * quaternion) and the translation that carries a rest-frame vertex there with the person's size
 * (world = turn(q, p) · size + t).
 */

import { qMul, qRotate, qTurn } from '../shared/fox-rig.js';

export const STROLLER_BONES = Object.freeze([
    'hips', 'chest', 'head', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'armL', 'forearmL', 'armR', 'forearmR',
]);
export const STROLLER_PARENTS = Object.freeze([-1, 0, 1, 0, 3, 4, 0, 6, 7, 1, 9, 1, 11]);
const BONE = Object.freeze(Object.fromEntries(STROLLER_BONES.map((name, i) => [name, i])));
/** Each side's bones: thigh, shin, foot, upper arm, forearm (left, then right). */
const LIMBS = Object.freeze([
    Object.freeze([BONE.thighL, BONE.shinL, BONE.footL, BONE.armL, BONE.forearmL]),
    Object.freeze([BONE.thighR, BONE.shinR, BONE.footR, BONE.armR, BONE.forearmR]),
]);
const BONES = STROLLER_BONES.length;
/** Texels a person's row holds: two a bone. */
export const STROLLER_ROW = BONES * 2;

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - 2 * t);
};
const mod = (a, n) => ((a % n) + n) % n;
const wrapAngle = (a) => mod(a + Math.PI, TAU) - Math.PI;

/** Deck height (m above the sea) and the rails (m across from the centre line, top above the deck). */
export const DECK = Object.freeze({ y: 4.5, rail: 4.35, railTop: 1.15 });

// ── The gait: one cycle of a leg, from its heel strike (0) round to the next (1) ────────────

/** Thigh swing as a share of the stride's amplitude (+ forward): back steadily, through quickly. */
const HIP = [[0, 1.0], [0.12, 0.62], [0.3, 0.03], [0.5, -0.62], [0.6, -0.3], [0.73, 0.72], [0.87, 1.08], [0.95, 1.05]];
/** The share of the cycle a foot is flat on the deck, and how far back the thigh is when it rolls off. */
const STANCE = Object.freeze({ flat: 0.5, back: 0.62 });
/** Knee bend (degrees): a give as the weight lands, folded to clear the deck in the swing. */
const KNEE = [[0, 4], [0.12, 15], [0.4, 5], [0.52, 16], [0.62, 42], [0.71, 60], [0.84, 30], [0.94, 6]];
/** The foot's pitch on the deck (degrees, + toes down): heel strike, flat, the roll off the toe. */
const FOOT = [[0, -14], [0.07, -1], [0.4, 1], [0.5, 8], [0.6, 28], [0.67, 16], [0.76, -2], [0.9, -10]];

/** A smooth periodic curve through (phase, value) keys (Catmull-Rom on uneven spacing). */
export function cycleCurve(keys, phase) {
    const n = keys.length;
    const p = mod(phase, 1);
    let i = n - 1;
    for (let k = 0; k < n; k += 1) {
        if (keys[k][0] > p) {
            i = k - 1;
            break;
        }
    }
    const at = (k) => {
        const m = mod(k, n);
        return [keys[m][0] + Math.floor(k / n), keys[m][1]];
    };
    const [x0, y0] = at(i - 1);
    const [x1, y1] = at(i);
    const [x2, y2] = at(i + 1);
    const [x3, y3] = at(i + 2);
    const h = x2 - x1;
    const t = (p - x1 + (p < x1 ? 1 : 0)) / h;
    const m1 = ((y2 - y0) / (x2 - x0)) * h;
    const m2 = ((y3 - y1) / (x3 - x1)) * h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * y2 + (t3 - t2) * m2;
}

/** A person's stride (two steps, m) at a walking speed (m/s), by their height (m). */
export const strideOf = (height, speed) => 2 * height * (0.24 + 0.11 * Math.min(speed, 1.5));

/**
 * The thigh's swing (rad) for a stride on a leg: while its foot is flat the body passes over it
 * by half a stride, from the thigh `amplitude` forward to STANCE.back of it behind, so the foot
 * keeps still on the deck: leg · (sin A + sin(back · A)) = stride / 2.
 */
export function swingOf(stride, leg) {
    const goal = Math.min(1.6, (STANCE.flat * stride) / leg);
    let A = goal / (1 + STANCE.back);
    for (let k = 0; k < 4; k += 1) {
        const f = Math.sin(A) + Math.sin(STANCE.back * A) - goal;
        A -= f / (Math.cos(A) + STANCE.back * Math.cos(STANCE.back * A));
    }
    return Math.max(0, Math.min(0.75, A));
}

// ── Where they go (pier coordinates: s m from the wheel's end, c m across, + to the beach side) ──

/**
 * The loops walkers stroll: straight out from `s0` to `s1` on one lane, round, straight back on
 * the other. `long` starts inside the first pavilion (its walls hide the turn there) and passes
 * through the other two as through arcades; `far` keeps to the open stretch beyond them; `near`
 * steps out of the first pavilion to the rail beside it and back in.
 */
export const STROLL_ROUTES = Object.freeze({
    long: Object.freeze({ s0: 144, s1: 13.5 }),
    far: Object.freeze({ s0: 84, s1: 14 }),
    near: Object.freeze({ s0: 145, s1: 136.5 }),
});

/** What a stop or a stander faces: the beach side's rail, the sunset side's, the sea off the end. */
const FACING = Object.freeze({ bay: 1, sun: -1, end: 0 });

/** The heading (about +y, from +z) that faces `face` on the pier. */
function facingHeading(plane, face) {
    const f = FACING[face];
    return f === 0 ? Math.atan2(-plane.ax, -plane.az) : Math.atan2(plane.cx * f, plane.cz * f);
}

/**
 * The cast, the most telling first (a tier takes parties from the top while they fit its count).
 * Walkers: route, lanes [out, back] (m across), speed (m/s), where they are at time 0 (share of
 * the loop), stops ({at: share of the loop, hold s, face}), members (figure, offset m to the left
 * of the party's line, the hand they hold with). Standers: spot {s, c}, face, pose (lean | stand).
 */
export const STROLLER_PARTIES = Object.freeze([
    {
        name: 'couple',
        route: 'long',
        lanes: [1.9, -1.4],
        speed: 0.92,
        start: 0.13,
        stops: [{ at: 0.3, hold: 16, face: 'sun' }],
        members: [{ figure: 'sundress', offset: 0.29, hand: 'R' }, { figure: 'chinos', offset: -0.29, hand: 'L' }],
    },
    // Beside the first pavilion, right of the HUD: the nearest anyone stands in the game's view.
    {
        name: 'bay-rail', spot: { s: 137, c: 3.97 }, face: 'bay', pose: 'lean', members: [{ figure: 'boater' }],
    },
    // Out of the pavilion's door to the rail beside it for a while, and back inside (where they
    // linger, out of sight, before they come out again).
    {
        name: 'near',
        route: 'near',
        lanes: [3.55, 1.5],
        speed: 0.85,
        start: 0.2,
        stops: [{
            at: 0.22, hold: 26, face: 'bay', lean: true,
        }, { at: 0.86, hold: 30, face: 'end' }],
        members: [{ figure: 'midi', offset: 0.3 }, { figure: 'chinos', offset: -0.3 }],
    },
    {
        name: 'capped',
        route: 'far',
        lanes: [2.3, -0.9],
        speed: 1.18,
        start: 0.55,
        stops: [],
        members: [{ figure: 'shorts', offset: 0 }],
    },
    {
        name: 'family',
        route: 'long',
        lanes: [1.2, -2.2],
        speed: 0.86,
        start: 0.62,
        stops: [{ at: 0.7, hold: 11, face: 'bay' }],
        members: [{ figure: 'slacks', offset: -0.24, hand: 'L' }, { figure: 'girl', offset: 0.24, hand: 'R' }],
    },
    {
        name: 'sun-rail', spot: { s: 44, c: -3.97 }, face: 'sun', pose: 'lean', members: [{ figure: 'midi' }],
    },
    {
        name: 'end',
        spot: { s: -7.6, c: -4.2 },
        face: 'end',
        pose: 'stand',
        members: [{ figure: 'chinos', offset: 0.32 }, { figure: 'sundress', offset: -0.32 }],
    },
    {
        name: 'pauser',
        route: 'far',
        lanes: [-1.7, 1.0],
        speed: 1.02,
        start: 0.08,
        stops: [{ at: 0.62, hold: 13, face: 'bay' }],
        members: [{ figure: 'slacks', offset: 0 }],
    },
    {
        name: 'boater',
        route: 'long',
        lanes: [2.4, -0.8],
        speed: 1.08,
        start: 0.86,
        stops: [{ at: 0.03, hold: 9, face: 'sun' }],
        members: [{ figure: 'boater', offset: 0 }],
    },
    {
        name: 'far-rail', spot: { s: 66, c: 3.97 }, face: 'bay', pose: 'lean', members: [{ figure: 'midi' }],
    },
    {
        name: 'pair',
        route: 'far',
        lanes: [0.9, -2.3],
        speed: 0.98,
        start: 0.36,
        stops: [],
        members: [{ figure: 'shorts', offset: 0.3 }, { figure: 'boy', offset: -0.3 }],
    },
]);

// ── Dress: each person's own colours (sRGB), picked from what suits the figure ───────────

const SKIN = ['#f1c7a5', '#e3b08a', '#c98d66', '#a8714d', '#7d4e35', '#5c3a28'];
const HAIR = ['#1d1512', '#2f2018', '#4a3020', '#6e4428', '#b48a55', '#d6bf8c', '#8c8783', '#5c2a1a'];
const LOOKS = Object.freeze({
    sundress: {
        top: ['#f4ebe0', '#f08a7a', '#f2c24c', '#93cbbd', '#c7a2dc', '#e65c78'],
        shoes: ['#c8935f', '#efe6d8'],
        hat: ['#e3cb92', '#f1e7d2'],
        band: ['#c0304a', '#25365e', '#1c1c1c'],
    },
    midi: {
        top: ['#f6f1e8', '#f5c4c4', '#b6d6ee', '#1f2a44'],
        bottom: ['#273a68', '#bb3a30', '#e5ad46', '#467455', '#efe0d0'],
        shoes: ['#2a2a2a', '#e8e0d4'],
    },
    slacks: {
        top: ['#ffffff', '#ffb0a3', '#a5e0d2', '#ffd36c', '#2b2b3a'],
        bottom: ['#e8e2d6', '#3a4a6c', '#1f1f28', '#c7b288'],
        shoes: ['#f2f2ee', '#dedede'],
    },
    shorts: {
        top: ['#ffffff', '#e64a5e', '#355c7d', '#f3d35b', '#3aaa9f', '#20232a'],
        bottom: ['#c7b288', '#3a4a6c', '#e8e2d6', '#5a6b4a'],
        shoes: ['#f2f2ee', '#2c2c30'],
        hat: ['#c0392b', '#1f2a44', '#f2f2ee', '#2a9d8f'],
    },
    chinos: {
        top: ['#a6c6e6', '#ffffff', '#f0cfa8', '#e8c3d3', '#4a5a7a'],
        bottom: ['#c7b288', '#2a3045', '#d6d0c2', '#556070'],
        shoes: ['#5a3a22', '#2a2a2a'],
    },
    boater: {
        top: ['#efe9dd', '#2a3a5a', '#c6ae88', '#7a8a9a'],
        bottom: ['#efe9dd', '#2a3045', '#c7b288'],
        shoes: ['#3a2a1c', '#2a2a2a'],
        hat: ['#e6d197'],
        band: ['#1f2a44', '#c0392b', '#2a6a4a'],
    },
    boy: {
        top: ['#f3d35b', '#3aaa9f', '#e9533b', '#20639b'], bottom: ['#3a4a6c', '#c7b288', '#e8e2d6'], shoes: ['#f2f2ee', '#e9533b'],
    },
    girl: { top: ['#ffb3c6', '#f3d35b', '#a5e0d2', '#ffffff', '#c7a2dc'], shoes: ['#efe6d8', '#e65c78'] },
});

/** sRGB hex → linear [r, g, b]. */
function linear(hex) {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
}

/** A small generator of the cast's own: dressing them must not shift the world's random sequence. */
function seeded(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/**
 * The people a tier puts out: parties from the top of the cast while they fit `count`, each member
 * with its colours by slot (skin, hair, top, bottom, shoes, hat, band: linear RGB), its size and
 * its party. Pure, for the tests.
 * @param {number} count
 */
export function strollerCast(count) {
    const rand = seeded(0x5eed1e);
    const people = [];
    const parties = [];
    for (const party of STROLLER_PARTIES) {
        // A party that does not fit is passed over for a smaller one further down.
        if (people.length + party.members.length > count) continue;
        const index = parties.length;
        parties.push(party);
        party.members.forEach((member, k) => {
            const look = LOOKS[member.figure];
            const pick = (list) => list[Math.floor(rand() * list.length)];
            const top = pick(look.top);
            const slots = [
                pick(SKIN), pick(HAIR), top, look.bottom ? pick(look.bottom) : top, pick(look.shoes),
                look.hat ? pick(look.hat) : top, look.band ? pick(look.band) : top,
            ];
            people.push({
                party: index,
                member: k,
                figure: member.figure,
                offset: member.offset ?? 0,
                hand: member.hand ?? null,
                size: 0.95 + rand() * 0.09,
                seed: rand(),
                colours: slots.map(linear),
            });
        });
    }
    return { people, parties };
}

// ── Routes in time ──────────────────────────────────────────────────────────

/** The loop a walking party follows (a stadium on the deck). */
export function strollLoop(party) {
    const route = STROLL_ROUTES[party.route];
    const [cA, cB] = party.lanes;
    const dir = Math.sign(route.s1 - route.s0);
    const D = Math.abs(route.s1 - route.s0);
    const cm = (cA + cB) / 2;
    const r = Math.abs(cA - cB) / 2;
    const arc = Math.PI * r;
    return {
        s0: route.s0, s1: route.s1, dir, D, cA, cB, cm, r, arc, length: 2 * D + 2 * arc,
    };
}

/** Where on its loop `u` metres round is (pier s, c) and which way it runs (unit ds, dc). */
export function loopPoint(loop, u, out = {
    s: 0, c: 0, ds: 0, dc: 0,
}) {
    const {
        s0, s1, dir, D, cA, cB, cm, r, arc,
    } = loop;
    const v = mod(u, loop.length);
    if (v < D) {
        out.s = s0 + dir * v;
        out.c = cA;
        out.ds = dir;
        out.dc = 0;
    } else if (v < D + arc) {
        const a = (v - D) / r;
        const k = (cA - cm) / r;
        out.s = s1 + dir * r * Math.sin(a);
        out.c = cm + (cA - cm) * Math.cos(a);
        out.ds = dir * Math.cos(a);
        out.dc = -k * Math.sin(a);
    } else if (v < 2 * D + arc) {
        out.s = s1 - dir * (v - D - arc);
        out.c = cB;
        out.ds = -dir;
        out.dc = 0;
    } else {
        const a = (v - 2 * D - arc) / r;
        const k = (cB - cm) / r;
        out.s = s0 - dir * r * Math.sin(a);
        out.c = cm + (cB - cm) * Math.cos(a);
        out.ds = -dir * Math.cos(a);
        out.dc = -k * Math.sin(a);
    }
    return out;
}

/** How far a walker takes to stop, and to get going again (m). */
const RAMP = 0.9;
/** Seconds to turn to the view at a stop, and back. */
const TURN = 1.3;

/**
 * A walking party's day, as a timeline round its loop: walks between the stops (each easing out
 * of the stop before it and into the one after) and the holds at them. Repeats every `period` s.
 */
export function strollTimeline(party) {
    const loop = strollLoop(party);
    const v = party.speed;
    const L = loop.length;
    const stops = (party.stops ?? []).map((st) => ({ ...st, u: st.at * L })).sort((a, b) => a.u - b.u);
    const legs = [];
    let t = 0;
    if (!stops.length) {
        legs.push({
            kind: 'walk', t0: 0, dur: L / v, u0: 0, len: L, d0: 0, ramps: false,
        });
        return {
            loop, legs, period: L / v, speed: v,
        };
    }
    let walked = 0;
    stops.forEach((stop, i) => {
        legs.push({
            kind: 'hold', t0: t, dur: stop.hold, u0: stop.u, len: 0, d0: walked, stop,
        });
        t += stop.hold;
        const next = stops[(i + 1) % stops.length];
        const len = mod(next.u - stop.u, L) || L;
        const dur = len / v + (2 * RAMP) / v;
        legs.push({
            kind: 'walk', t0: t, dur, u0: stop.u, len, d0: walked, ramps: true, from: stop, to: next,
        });
        walked += len;
        t += dur;
    });
    return {
        loop, legs, period: t, speed: v,
    };
}

/**
 * Where a walking party is at `time`: u round the loop, the distance walked in all (for the gait),
 * the pace as a share of its cruise, and at a stop how far it has turned to the view (0..1).
 */
export function strollAt(timeline, party, time, out = {}) {
    const {
        loop, legs, period, speed: v,
    } = timeline;
    const cycle = Math.floor((time + party.start * period) / period);
    const tau = time + party.start * period - cycle * period;
    let leg = legs[legs.length - 1];
    for (const l of legs) {
        if (tau < l.t0 + l.dur) {
            leg = l;
            break;
        }
    }
    const local = tau - leg.t0;
    let d = 0;
    let pace = 1;
    let view = 0;
    let face = null;
    if (leg.kind === 'hold') {
        d = 0;
        pace = 0;
        ({ face } = leg.stop);
        view = smooth(0, TURN, local) * (1 - smooth(leg.dur - TURN, leg.dur, local));
    } else if (!leg.ramps) {
        d = v * local;
    } else {
        const tr = (2 * RAMP) / v;
        if (local < tr) {
            d = (v * local * local) / (2 * tr);
            pace = local / tr;
        } else if (local > leg.dur - tr) {
            const left = leg.dur - local;
            d = leg.len - (v * left * left) / (2 * tr);
            pace = left / tr;
        } else {
            d = RAMP + v * (local - tr);
        }
    }
    out.u = mod(leg.u0 + d, loop.length);
    out.walked = cycle * loop.length + leg.d0 + d;
    out.pace = pace;
    out.view = view;
    out.face = face;
    out.lean = leg.kind === 'hold' && leg.stop.lean === true;
    return out;
}

// ── The rig ─────────────────────────────────────────────────────────────────

/**
 * A figure's skeleton from the model's rest joints (13 × 3 numbers, BONES order), its height and
 * foot length: what the poser needs about it.
 */
export function strollerRig(joints, height, foot) {
    const rest = [];
    for (let b = 0; b < BONES; b += 1) rest.push([joints[b * 3], joints[b * 3 + 1], joints[b * 3 + 2]]);
    const offset = rest.map((p, b) => {
        const parent = STROLLER_PARENTS[b];
        return parent < 0 ? [0, 0, 0] : [p[0] - rest[parent][0], p[1] - rest[parent][1], p[2] - rest[parent][2]];
    });
    const hip = rest[BONE.thighL];
    const knee = rest[BONE.shinL];
    const ankle = rest[BONE.footL];
    const shoulder = rest[BONE.armL];
    return {
        rest,
        offset,
        height,
        foot,
        leg: hip[1] - ankle[1],
        shoulder: shoulder[1],
        child: height < 1.4,
        woman: false,
        thigh: hip[1] - knee[1],
        // The sole's heel and toe below the ankle joint, in the foot's frame.
        heel: [0, -ankle[1], -0.22 * foot - ankle[2]],
        toe: [0, -ankle[1] * 0.55, 0.7 * foot - ankle[2]],
    };
}

// ── Posing ──────────────────────────────────────────────────────────────────

/** The world frame of the pier, as plain numbers: far end (x, z), along and across (unit x, z). */
export function pierPlane(frame) {
    return {
        fx: frame.far.x, fz: frame.far.z, ax: frame.along.x, az: frame.along.z, cx: frame.across.x, cz: frame.across.z,
    };
}

/**
 * Everyone on the pier, posed by the clock.
 */
export class StrollerLife {
    /**
     * @param {object} o
     * @param {object} o.plane   pierPlane(pierFrame())
     * @param {number} o.count   how many people (a tier's count)
     * @param {Record<string, object>} o.rigs  strollerRig() by figure name
     */
    constructor({ plane, count, rigs }) {
        this.plane = plane;
        this.rigs = rigs;
        const { people, parties } = strollerCast(count);
        this.people = people;
        this.parties = parties;
        this.timelines = parties.map((party) => (party.route ? strollTimeline(party) : null));
        this.looks = people.map(() => ({
            at: -1e9, x: 0, y: 0, z: 0, weight: 0,
        }));
        // Scratch.
        this._at = {};
        this._pt = {
            s: 0, c: 0, ds: 0, dc: 0,
        };
        this._local = Array.from({ length: BONES }, () => [0, 0, 0, 1]);
        this._wq = Array.from({ length: BONES }, () => [0, 0, 0, 1]);
        this._wj = Array.from({ length: BONES }, () => [0, 0, 0]);
        this._v = [0, 0, 0];
        this._q = [0, 0, 0, 1];
        this.state = people.map(() => ({}));
    }

    /** A firework burst (world position, time on this clock, scale): heads turn up to it. */
    notice(x, y, z, at, scale = 1) {
        this.people.forEach((person, i) => {
            const look = this.looks[i];
            // A new burst takes the eye unless the last, bigger one is still fresh.
            const fresh = at - look.at < 2.2 && look.weight > scale * 1.2;
            if (fresh) return;
            look.at = at + 0.15 + person.seed * 0.45;
            look.x = x;
            look.y = y;
            look.z = z;
            look.weight = scale;
        });
    }

    /** Forget the bursts (a seek). */
    reset() {
        this.looks.forEach((look) => {
            look.at = -1e9;
            look.weight = 0;
        });
    }

    /** Where a person is and what they are doing at `time` (world x, z, heading, gait), in `st`. */
    place(i, time) {
        const person = this.people[i];
        const party = this.parties[person.party];
        const rig = this.rigs[person.figure];
        const st = this.state[i];
        const P = this.plane;
        if (party.route) {
            const at = strollAt(this.timelines[person.party], party, time, this._at);
            const pt = loopPoint(this.timelines[person.party].loop, at.u, this._pt);
            const dx = P.ax * pt.ds + P.cx * pt.dc;
            const dz = P.az * pt.ds + P.cz * pt.dc;
            let heading = Math.atan2(dx, dz);
            let turned = 0;
            if (at.face) {
                turned = wrapAngle(facingHeading(P, at.face) - heading) * at.view;
                heading += turned;
            }
            // The party's line, and this member beside it (to its left by `offset`): turning at
            // a stop, a pair turns together and ends side by side facing the view.
            const lx = Math.cos(heading);
            const lz = -Math.sin(heading);
            st.x = P.fx + P.ax * pt.s + P.cx * pt.c + lx * person.offset;
            st.z = P.fz + P.az * pt.s + P.cz * pt.c + lz * person.offset;
            st.heading = heading;
            st.pace = at.pace;
            st.view = at.view;
            st.stride = strideOf(rig.height * person.size, party.speed);
            // Turning on the spot takes small steps: the gait runs on the turn as well as the way.
            st.walked = at.walked + Math.abs(turned) * 0.32;
            st.stepping = at.face ? Math.sin(at.view * Math.PI) * 0.35 : 0;
            st.walking = true;
            // A stop at the rail ends leaning on it.
            st.lean = at.lean ? at.view : 0;
        } else {
            const { spot } = party;
            const heading = facingHeading(P, party.face);
            const lx = Math.cos(heading);
            const lz = -Math.sin(heading);
            st.x = P.fx + P.ax * spot.s + P.cx * spot.c + lx * person.offset;
            st.z = P.fz + P.az * spot.s + P.cz * spot.c + lz * person.offset;
            st.heading = heading;
            st.pace = 0;
            st.view = 1;
            st.walked = 0;
            st.stride = 1;
            st.stepping = 0;
            st.walking = false;
            st.lean = party.pose === 'lean' ? 1 : 0;
        }
        // How far the rail is ahead (m): from where the person stands across the deck.
        const across = (st.x - P.fx) * P.cx + (st.z - P.fz) * P.cz;
        st.railGap = DECK.rail - Math.abs(across);
        return st;
    }

    /**
     * Pose everyone at `time` into `data` (a Float32Array of count × STROLLER_ROW × 4 floats).
     * @param {number} time
     * @param {Float32Array} data
     */
    write(time, data) {
        for (let i = 0; i < this.people.length; i += 1) {
            this.pose(i, time, data, i * STROLLER_ROW * 4);
        }
    }

    /** One person's bones. */
    pose(i, time, data, at) {
        const person = this.people[i];
        const rig = this.rigs[person.figure];
        const st = this.place(i, time);
        const { size } = person;
        const L = this._local;
        const { seed } = person;
        const woman = person.figure === 'sundress' || person.figure === 'midi' || person.figure === 'slacks' || person.figure === 'girl';

        // The gait's phase rides on the distance walked; its size on the pace.
        const phase = st.walked / st.stride + seed * 0.37;
        const pR = phase;
        const pL = phase + 0.5;
        const pace = st.walking ? Math.max(st.pace, st.stepping) : 0;
        const g = pace > 0 ? pace ** 0.7 : 0;
        const A = swingOf(st.stride, rig.leg * size * 0.97);
        const hipR = A * g * cycleCurve(HIP, pR);
        const hipL = A * g * cycleCurve(HIP, pL);
        const kneeR = (4 + (cycleCurve(KNEE, pR) - 4) * g) * DEG;
        const kneeL = (4 + (cycleCurve(KNEE, pL) - 4) * g) * DEG;
        const footR = cycleCurve(FOOT, pR) * g * DEG;
        const footL = cycleCurve(FOOT, pL) * g * DEG;
        const sR = Math.sin(TAU * pR);
        const cR = Math.cos(TAU * pR);
        const sway = woman ? 1.35 : 1;

        // Standing: the weight on one leg and then the other, now and then; breathing.
        const still = 1 - g;
        const shift = Math.tanh(3 * Math.sin((time * TAU) / (9 + seed * 6) + seed * 40)) * still;
        const breath = Math.sin(time * 1.6 + seed * 20) * still;

        let pelvisYaw = 6 * DEG * g * cR;
        const pelvisRoll = -3.5 * DEG * g * sR * sway - 3 * DEG * shift;
        let pelvisPitch = 2 * DEG;
        let swayX = -0.018 * g * sR * sway - 0.035 * shift;
        let chestPitch = (3 * g + 1.5 + breath * 0.6) * DEG;
        const { lean } = st;
        // On the rail: leaning in over the forearms folded on the top rail, the elbows on it. The
        // taller the shoulders stand over the rail, the further the lean; the upper arms reach
        // from the shoulders down to the rail.
        const upper = (rig.rest[BONE.armL][1] - rig.rest[BONE.forearmL][1]) * size;
        const torso = (rig.shoulder - rig.rest[BONE.hips][1]) * size;
        const bend = (8 + 40 * clamp01((rig.shoulder * size - 1.3) / 0.2)) * DEG;
        const shoulderOver = rig.rest[BONE.hips][1] * size + torso * Math.cos(bend) - (DECK.railTop + 0.1);
        const reach = Math.acos(Math.max(0.05, Math.min(0.98, shoulderOver / upper)));
        if (lean > 0) {
            pelvisPitch += bend * 0.3 * lean;
            chestPitch += bend * 0.7 * lean;
            swayX *= 0.5;
        }
        const chestYaw = -1.7 * pelvisYaw;
        const chestRoll = -0.7 * pelvisRoll;

        // Where they look: ahead, now and then aside at the sea; standers at the view and about;
        // and up at a burst.
        const glance = smooth(0.55, 0.9, Math.sin(time * 0.21 + seed * 31) * Math.sin(time * 0.083 + seed * 17));
        const about = (24 * Math.sin(time * 0.11 + seed * 9) + 12 * Math.sin(time * 0.047 + seed * 5)) * DEG;
        let lookYaw = st.walking ? 38 * DEG * glance * (seed > 0.5 ? 1 : -1) : about;
        let lookPitch = 2 * DEG;
        if (!st.walking) lookPitch = lean > 0 ? 6 * DEG : 0;
        const look = this.looks[i];
        const up = smooth(look.at, look.at + 0.5, time) * (1 - smooth(look.at + 3.2 + seed, look.at + 4.6 + seed, time));
        if (up > 0) {
            const dx = look.x - st.x;
            const dz = look.z - st.z;
            const dy = look.y - (DECK.y + rig.height * size * 0.93);
            const toward = wrapAngle(Math.atan2(dx, dz) - st.heading);
            const yaw = Math.max(-100 * DEG, Math.min(100 * DEG, toward));
            const pitch = -Math.atan2(dy, Math.hypot(dx, dz));
            lookYaw += (yaw - lookYaw) * up;
            lookPitch += (Math.max(-50 * DEG, pitch) - lookPitch) * up;
        }
        // The neck turns so far; past it, the shoulders turn too.
        const neck = 70 * DEG;
        const bodyTurn = Math.sign(lookYaw) * Math.min(40 * DEG, Math.max(0, Math.abs(lookYaw) - neck));
        const pelvisTurn = bodyTurn * 0.3;
        pelvisYaw += pelvisTurn;
        const chestTurn = bodyTurn * 0.7;

        // ── Local rotations ──
        qTurn(st.heading + pelvisYaw, pelvisPitch, pelvisRoll, L[BONE.hips]);
        qTurn(chestYaw + chestTurn, chestPitch, chestRoll, L[BONE.chest]);
        const headYaw = lookYaw - pelvisYaw - chestYaw - chestTurn;
        qTurn(headYaw, lookPitch - chestPitch - pelvisPitch + (lean > 0 ? 4 * DEG : 0), -chestRoll - pelvisRoll * 0.5, L[BONE.head]);

        // Legs: the thigh's swing (+ forward is pitch −), the knee's bend, the foot kept to its
        // pitch on the deck. Standing, the free leg's knee eases.
        for (let k = 0; k < 2; k += 1) {
            const side = k === 0 ? 1 : -1;
            const [th, sh, ft] = LIMBS[k];
            const free = Math.max(0, side * shift);
            const hip = (k === 0 ? hipL : hipR) + 4 * DEG * free;
            const knee = (k === 0 ? kneeL : kneeR) + 12 * DEG * free;
            const foot = k === 0 ? footL : footR;
            // Toes out a little; the legs keep under the body as the hips roll.
            qTurn(side * 5 * DEG, -hip - pelvisPitch, -pelvisRoll * 0.85, L[th]);
            qTurn(0, knee, 0, L[sh]);
            qTurn(-side * 2 * DEG, foot - (-hip + knee), 0, L[ft]);
        }

        // Arms: each swings with the opposite leg; one held in a partner's hand reaches to them.
        for (let k = 0; k < 2; k += 1) {
            const side = k === 0 ? 1 : -1;
            const up1 = LIMBS[k][3];
            const fo = LIMBS[k][4];
            const holding = person.hand === (k === 0 ? 'L' : 'R') && st.walking ? 1 : 0;
            // The swing: as far back as forward, timed by the opposite leg's thigh.
            const swing = Math.cos(TAU * ((side > 0 ? pR : pL) - 0.03));
            let flex = (0.62 * A * g * swing - 1.5 * DEG * g) * (1 - 0.75 * holding) + breath * 0.5 * DEG;
            let elbow = (10 + 14 * g * Math.max(0, swing)) * DEG;
            let twist = 0;
            let abduct = (6 + 3 * still) * DEG;
            if (holding) {
                const child = person.figure === 'girl' || person.figure === 'boy';
                abduct = (child ? 28 : 11) * DEG;
                elbow = (child ? 12 : 18) * DEG;
                flex += (child ? 6 : 4) * DEG;
            }
            if (lean > 0) {
                // The upper arm reaches down to the rail; turned in, the forearm folds along it.
                flex = (reach + chestPitch + pelvisPitch) * lean + flex * (1 - lean);
                elbow = 96 * DEG * lean + elbow * (1 - lean);
                abduct = 12 * DEG * lean + abduct * (1 - lean);
                // Turned fully in, the bent forearm lies level across the rail whatever the
                // upper arm's angle.
                twist = -side * 88 * DEG * lean;
            } else {
                // The arms hang plumb whatever the chest's lean.
                flex += chestPitch + pelvisPitch;
            }
            // Turned about its own length first, then swung forward and out.
            qMul(qTurn(0, -flex, side * abduct, this._q), qTurn(twist, 0, 0, L[fo]), L[up1]);
            qTurn(0, -elbow, -side * 4 * DEG, L[fo]);
        }

        // ── Forward kinematics, the root at the walker's place ──
        const Wq = this._wq;
        const Wj = this._wj;
        const v = this._v;
        const lx = Math.cos(st.heading);
        const lz = -Math.sin(st.heading);
        // Leaning on a rail, the body stands where the elbows reach it (the root's spot is 0.38 m
        // in from the rail).
        const toElbow = upper * Math.sin(reach) + (rig.shoulder - rig.rest[BONE.hips][1]) * size * Math.sin(chestPitch + pelvisPitch);
        const back = lean > 0 ? (st.railGap - toElbow - 0.02) * lean : 0;
        const fx = Math.sin(st.heading);
        const fz = Math.cos(st.heading);
        for (let b = 0; b < BONES; b += 1) {
            const parent = STROLLER_PARENTS[b];
            if (parent < 0) {
                Wq[b][0] = L[b][0];
                Wq[b][1] = L[b][1];
                Wq[b][2] = L[b][2];
                Wq[b][3] = L[b][3];
                Wj[b][0] = st.x + lx * swayX + fx * back;
                Wj[b][1] = rig.rest[b][1] * size;
                Wj[b][2] = st.z + lz * swayX + fz * back;
                continue;
            }
            qMul(Wq[parent], L[b], Wq[b]);
            const o = rig.offset[b];
            v[0] = o[0] * size;
            v[1] = o[1] * size;
            v[2] = o[2] * size;
            qRotate(Wq[parent], v, v);
            Wj[b][0] = Wj[parent][0] + v[0];
            Wj[b][1] = Wj[parent][1] + v[1];
            Wj[b][2] = Wj[parent][2] + v[2];
        }
        // Set down on the deck: the lowest heel or toe stands on it.
        let low = Infinity;
        for (let k = 0; k < 4; k += 1) {
            const ft = LIMBS[k < 2 ? 0 : 1][2];
            const p = k % 2 ? rig.toe : rig.heel;
            v[0] = p[0] * size;
            v[1] = p[1] * size;
            v[2] = p[2] * size;
            qRotate(Wq[ft], v, v);
            low = Math.min(low, Wj[ft][1] + v[1]);
        }
        const lift = DECK.y - low;

        // ── The row: per bone its rotation, and where the rest frame's origin goes ──
        for (let b = 0; b < BONES; b += 1) {
            const q = Wq[b];
            const o = at + b * 8;
            data[o] = q[0];
            data[o + 1] = q[1];
            data[o + 2] = q[2];
            data[o + 3] = q[3];
            const r = rig.rest[b];
            v[0] = r[0] * size;
            v[1] = r[1] * size;
            v[2] = r[2] * size;
            qRotate(q, v, v);
            data[o + 4] = Wj[b][0] - v[0];
            data[o + 5] = Wj[b][1] + lift - v[1];
            data[o + 6] = Wj[b][2] - v[2];
            data[o + 7] = size;
        }
        st.lift = lift;
        return st;
    }
}
