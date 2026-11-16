// @ts-check
/**
 * Wolfhour — the wolves that travel (CPU only, three-free, pure functions of the time).
 *
 * The pack's home is the right-hand spur; the rest of the night's wolves pass through:
 *
 *   - along the foreground ridge, every 48 seconds, a visit. Every other one is the scout's
 *     (wolfhour-wolves.js `scoutAt`: it walks in, looks out over the valley and trots away); the
 *     ones between are drawn from five kinds: a hunt (four or five wolves loping across the whole
 *     frame in file, behind the board and out the other side), a prowl (two wolves stalking in
 *     low, freezing with a paw raised, creeping, then breaking into a run), a pair trotting
 *     through (one stops to look at you and lopes to catch up), a chase (two young wolves running
 *     flat out with their tails up, bounding) and a lone wolf that walks in, sits down and howls
 *     by itself;
 *   - along the right-hand massif's skyline, now and then, a file of small far wolves trotting
 *     up to the summit and over it;
 *   - on the left-hand massif's summit, beside the moon, the white wolf: it comes up over the
 *     crest, stands, sits and howls on its own, and goes again.
 *
 * A traveller's journey is an itinerary of legs: go somewhere at a speed in a gait, stay a while
 * doing something, turn round. `follow()` reads where it is `u` seconds in: its place along the
 * ridge, which way it faces, its gait and how far it has gone in it (so planted paws stay planted)
 * and what it is doing (pose parameters for wolfhour-wolf-rig.js). Units are the traveller's own
 * rig units along its ridge from its anchor; +x is to the right.
 */
import { TURN, glide, glidePace } from './wolfhour-wolf-behaviour.js';

/** Speeds (units a second) and strides (the distance the body travels in one cycle) by gait. */
export const TRAVEL_GAITS = Object.freeze({
    prowl: Object.freeze({ speed: 9.5, stride: 13, ramp: 0.7 }),
    walk: Object.freeze({ speed: 16, stride: 15, ramp: 0.8 }),
    trot: Object.freeze({ speed: 30, stride: 22, ramp: 0.8 }),
    lope: Object.freeze({ speed: 74, stride: 38, ramp: 1.1 }),
    run: Object.freeze({ speed: 100, stride: 46, ramp: 1.2 }),
});

/** The most wolves the foreground ridge shows at once. */
export const ROVER_COUNT = 5;
/** The visits to the foreground ridge: the first (the scout's), and the seconds between them. */
export const VISITS = Object.freeze({ first: 18, period: 48 });
/** The kinds of visit between the scout's, with weights. */
export const VISIT_KINDS = Object.freeze([
    ['hunt', 3], ['prowl', 2.4], ['pair', 2], ['chase', 1.6], ['lone', 2],
]);

const smooth = (/** @type {number} */ t) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
};
/** 1 between `from` and `to`, easing in and out over `ramp` seconds at each end. */
/**
 * @param {number} u
 * @param {number} from
 * @param {number} to
 * @param {number} ramp
 */
function span(u, from, to, ramp) {
    return Math.min(smooth((u - from) / ramp), 1 - smooth((u - (to - ramp)) / ramp));
}

/** A small integer hash to 0..1. */
export function travelHash(/** @type {number} */ index, /** @type {number} */ seed) {
    let h = Math.imul(Math.trunc(index) + 0x9e37, 0x85ebca6b) ^ Math.imul(Math.trunc(seed) + 0x27d4, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * @typedef {(u: number, length: number) => object} Act
 * @typedef {{ go: number, gait: keyof typeof TRAVEL_GAITS, speed?: number, act?: Act }
 *   | { stay: number, act?: Act, howls?: boolean }
 *   | { turn: true }} Leg
 */

/**
 * Where a traveller is `u` seconds into its itinerary, starting at `x0` facing `facing0`; null
 * once it is over (or before it began).
 * @param {readonly Leg[]} legs
 * @param {number} u
 * @param {number} x0
 * @param {number} [facing0]
 */
export function follow(legs, u, x0, facing0 = -1) {
    if (!Number.isFinite(u) || u < 0) return null;
    let x = x0;
    let at = 0;
    let facing = facing0;
    for (const leg of legs) {
        if ('go' in leg) {
            const gait = TRAVEL_GAITS[leg.gait] ?? TRAVEL_GAITS.walk;
            const speed = leg.speed ?? gait.speed;
            const distance = Math.abs(leg.go - x);
            const dir = leg.go >= x ? 1 : -1;
            const length = distance / speed + gait.ramp;
            if (u < at + length) {
                const local = u - at;
                const d = glide(local, distance, speed, gait.ramp);
                return {
                    x: x + dir * d,
                    facing: dir,
                    moving: true,
                    gaitKind: leg.gait,
                    stride: gait.stride,
                    speed,
                    travel: d,
                    walked: local * speed,
                    pace: glidePace(local, distance, speed, gait.ramp),
                    yaw: 0,
                    pause: 0,
                    howls: false,
                    act: leg.act ? leg.act(local, length) : null,
                };
            }
            x = leg.go;
            facing = dir;
            at += length;
        } else if ('stay' in leg) {
            if (u < at + leg.stay) {
                return {
                    x,
                    facing,
                    moving: false,
                    gaitKind: 'walk',
                    stride: TRAVEL_GAITS.walk.stride,
                    speed: 0,
                    travel: 0,
                    walked: 0,
                    pace: 0,
                    yaw: 0,
                    pause: u - at,
                    howls: leg.howls !== false,
                    act: leg.act ? leg.act(u - at, leg.stay) : null,
                };
            }
            at += leg.stay;
        } else {
            if (u < at + TURN) {
                const f = (u - at) / TURN;
                return {
                    x,
                    facing,
                    moving: false,
                    gaitKind: 'walk',
                    stride: TRAVEL_GAITS.walk.stride,
                    speed: 0,
                    travel: 0,
                    walked: 0,
                    pace: 0,
                    yaw: Math.PI * smooth(f),
                    pause: 0,
                    howls: false,
                    act: { step: f * 2, stepHeight: 1.8 * Math.sin(f * Math.PI), head: -5 * Math.sin(f * Math.PI) },
                };
            }
            facing = -facing;
            at += TURN;
        }
    }
    return null;
}

/** How long an itinerary takes from `x0` (seconds). */
export function itineraryLength(/** @type {readonly Leg[]} */ legs, /** @type {number} */ x0) {
    let x = x0;
    let total = 0;
    for (const leg of legs) {
        if ('go' in leg) {
            const gait = TRAVEL_GAITS[leg.gait] ?? TRAVEL_GAITS.walk;
            total += Math.abs(leg.go - x) / (leg.speed ?? gait.speed) + gait.ramp;
            x = leg.go;
        } else if ('stay' in leg) total += leg.stay;
        else total += TURN;
    }
    return total;
}

/* ── What a traveller does as it goes ─────────────────────────────────────────────── */

/** Loping: low and stretched out, ears back, the brush streaming behind. */
const lopeAct = () => ({
    crouch: 1.6, head: -8, ears: 10, tailUp: 0.55, tail: 6,
});
/** Flat out. */
const runAct = () => ({
    crouch: 2.4, head: -12, ears: 16, tailUp: 0.75, tail: 4,
});
/** Flat out for the fun of it: bounding, tail high. */
const romp = (phase = 0) => (/** @type {number} */ u) => ({
    crouch: 1.6,
    head: -4 + Math.sin(u * 3.1 + phase) * 6,
    ears: 8,
    tailUp: 0.95,
    wag: 0.4,
    lift: Math.max(0, Math.sin(u * 4.6 + phase)) * 3.2,
});
/** Prowling: the body low, the head lower and level, ears forward, the tail still. */
const prowlAct = (/** @type {number} */ u, /** @type {number} */ length) => {
    const e = span(u, 0, length, 0.9);
    return {
        crouch: 4.2 * e, head: -22 * e, ears: -8 * e, tail: -6 * e,
    };
};
/** Frozen mid-stalk: lower still, a forepaw raised, staring. */
const freezeAct = (/** @type {number} */ u, /** @type {number} */ length) => {
    const e = span(u, -1, length + 1, 0.9);
    return {
        crouch: 4.2 * e + 1.2 * span(u, 0.2, length, 0.4),
        head: -20 * e,
        ears: -12 * e,
        tail: -6 * e,
        pawUp: span(u, 0.3, length - 0.1, 0.35),
    };
};
/** A stop to look at you, the head tilted one way and the other. */
const lookAct = (/** @type {number} */ u, /** @type {number} */ length) => {
    const e = span(u, 0.1, length - 0.1, 0.5);
    const mid = length / 2;
    return {
        turn: 0.88 * e,
        head: 5 * e,
        ears: -8 * e,
        roll: 0.34 * span(u, 0.7, mid, 0.3) - 0.3 * span(u, mid + 0.1, length - 0.5, 0.3),
    };
};
/** Waiting for the other: a look back over the shoulder. */
const waitAct = (/** @type {number} */ u, /** @type {number} */ length) => {
    const e = span(u, 0.4, length - 0.2, 0.6);
    return {
        headYaw: 2.8 * e, neckYaw: 1.1 * e, head: 26 * e, ears: 5 * e,
    };
};
/**
 * Alone on the ridge: it sits down, lifts its muzzle and howls by itself, twice, listens for an
 * answer, and gets up again. (`howl` 0..1 is the howl's own lift: wolfhour-wolves.js adds the head,
 * the jaw and the breath.)
 */
export const LONE = Object.freeze({
    stay: 17, sit: [0.6, 1.6], howls: [[2.4, 6.4], [8, 12.2]], listen: [12.6, 15.4], rise: 15.6,
});
const loneAct = (/** @type {number} */ u) => {
    const sit = Math.min(smooth((u - LONE.sit[0]) / (LONE.sit[1] - LONE.sit[0])), 1 - smooth((u - LONE.rise) / 1.1));
    let howl = 0;
    for (const [from, to] of LONE.howls) howl = Math.max(howl, span(u, from, to, 0.75));
    const listen = span(u, LONE.listen[0], LONE.listen[1], 0.5);
    return {
        sit,
        howl,
        head: listen * 10,
        ears: -listen * 10,
        turn: 0.5 * span(u, LONE.listen[0] + 0.8, LONE.listen[1], 0.4),
    };
};

/* ── The foreground ridge's visits ─────────────────────────────────────────────────── */

/** The kinds drawn so far for the visits between the scout's (the 1st, the 3rd, ...), in order. */
const DRAWN = ['hunt'];

/**
 * The kind of visit `index`: even ones are the scout's; the first of the others is always the
 * hunt, the rest drawn by weight, never the same kind twice running.
 * @param {number} index
 */
export function visitKind(index) {
    const n = Math.max(0, Math.trunc(index));
    if (n % 2 === 0) return 'scout';
    const slot = (n - 1) / 2;
    const total = VISIT_KINDS.reduce((sum, [, weight]) => sum + Number(weight), 0);
    // Each depends on the one before, so they are drawn in order and kept.
    while (DRAWN.length <= slot) {
        const before = DRAWN[DRAWN.length - 1];
        let roll = travelHash(DRAWN.length * 2 + 1, 71) * total;
        let at = VISIT_KINDS.length - 1;
        for (let k = 0; k < VISIT_KINDS.length; k++) {
            roll -= Number(VISIT_KINDS[k][1]);
            if (roll < 0) {
                at = k;
                break;
            }
        }
        // The same again: take the next kind round instead.
        if (String(VISIT_KINDS[at][0]) === before) at = (at + 1) % VISIT_KINDS.length;
        DRAWN.push(String(VISIT_KINDS[at][0]));
    }
    return DRAWN[slot];
}

/**
 * The itineraries of visit `index` across a ridge that shows from `left` to `right` (the frame's
 * edges, a wolf's length beyond them): for each wolf where it starts, which way it faces, how long
 * after the visit begins it sets off, and its legs.
 * @param {number} index
 * @param {{ left: number, right: number }} ridge
 * @param {string | null} [forced]  the kind, whatever the index would draw
 */
export function visitPlan(index, ridge, forced = null) {
    const kind = forced ?? visitKind(index);
    const { left, right } = ridge;
    const width = right - left;
    // Which side it comes in from (+1: from the left, heading right).
    const dir = travelHash(index, 13) < 0.5 ? -1 : 1;
    const from = dir < 0 ? right : left;
    const to = dir < 0 ? left : right;
    const into = (/** @type {number} */ d) => from + dir * d;
    /** @type {{ x0: number, facing: number, delay: number, legs: Leg[], role: string }[]} */
    const wolves = [];
    if (kind === 'hunt') {
        const count = travelHash(index, 29) < 0.45 ? 4 : 5;
        let behind = 0;
        for (let i = 0; i < count; i++) {
            // Strung out in file, the gaps uneven; each keeps its own pace within a few percent.
            if (i > 0) behind += 40 + travelHash(index * 7 + i, 31) * 22;
            const speed = TRAVEL_GAITS.lope.speed * (1 - i * 0.012 + (travelHash(index * 7 + i, 37) - 0.5) * 0.03);
            wolves.push({
                x0: from - dir * behind,
                facing: dir,
                delay: 0,
                role: i === 0 ? 'leader' : 'runner',
                legs: [{
                    go: to + dir * 30, gait: 'lope', speed, act: lopeAct,
                }],
            });
        }
    } else if (kind === 'prowl') {
        const reach = Math.min(110, width * 0.14);
        for (let i = 0; i < 2; i++) {
            const back = i * 34;
            wolves.push({
                x0: from - dir * back,
                facing: dir,
                delay: i * 0.5,
                role: 'prowler',
                legs: [
                    { go: into(reach - back * 0.4), gait: 'prowl', act: prowlAct },
                    { stay: 2.8 + i * 0.4, act: freezeAct, howls: false },
                    { go: into(reach + 36 - back * 0.4), gait: 'prowl', act: prowlAct },
                    { stay: 1.5, act: freezeAct, howls: false },
                    {
                        go: to + dir * 30, gait: 'run', act: runAct,
                    },
                ],
            });
        }
    } else if (kind === 'pair') {
        const stop = Math.min(150, width * 0.19);
        wolves.push({
            x0: from,
            facing: dir,
            delay: 0,
            role: 'pair',
            legs: [
                { go: into(stop + 52), gait: 'trot' },
                { stay: 4.4, act: waitAct },
                { go: to + dir * 30, gait: 'trot' },
            ],
        }, {
            x0: from - dir * 46,
            facing: dir,
            delay: 0,
            role: 'pair',
            legs: [
                { go: into(stop), gait: 'trot' },
                { stay: 3.4, act: lookAct },
                { go: to + dir * 30, gait: 'lope', act: lopeAct },
            ],
        });
    } else if (kind === 'chase') {
        for (let i = 0; i < 2; i++) {
            wolves.push({
                x0: from - dir * i * 44,
                facing: dir,
                delay: 0,
                role: 'yearling',
                legs: [{
                    go: to + dir * 30,
                    gait: 'run',
                    speed: TRAVEL_GAITS.run.speed * (i === 0 ? 0.96 : 1),
                    act: romp(i * 1.7),
                }],
            });
        }
    } else if (kind === 'lone') {
        const spot = Math.min(120, width * 0.15);
        wolves.push({
            x0: from,
            facing: dir,
            delay: 0,
            role: 'lone',
            legs: [
                { go: into(spot), gait: 'walk' },
                { stay: LONE.stay, act: loneAct, howls: false },
                { turn: true },
                { go: from - dir * 10, gait: 'trot' },
            ],
        });
    }
    return {
        index, kind, dir, wolves,
    };
}

/**
 * The visit under way at `time` (null between visits, and during the scout's, which
 * wolfhour-wolves.js `scoutAt` plays): its kind and number, and each wolf's state from `follow()`
 * (null for a wolf that has not set off or has gone).
 * @param {number} time
 * @param {{ left: number, right: number }} ridge
 */
export function roversAt(time, ridge) {
    const t = time - VISITS.first;
    if (!Number.isFinite(t) || t < 0) return null;
    const index = Math.floor(t / VISITS.period);
    if (index % 2 === 0) return null;
    const plan = visitPlan(index, ridge);
    const u = t - index * VISITS.period;
    let any = false;
    const wolves = plan.wolves.map((wolf) => {
        const state = follow(wolf.legs, u - wolf.delay, wolf.x0, wolf.facing);
        if (state) any = true;
        return state;
    });
    if (!any) return null;
    return {
        index, kind: plan.kind, dir: plan.dir, u, wolves, plan,
    };
}

/* ── The far file on the skyline ───────────────────────────────────────────────────── */

/**
 * The far file: small wolves trotting along the right-hand massif's skyline from the frame's edge
 * up to the summit and over it (units: the file's own, from its anchor on the summit; +x right).
 */
export const FAR_FILE = Object.freeze({
    count: 4,
    first: 92,
    period: 168,
    /** Where it comes into view, the summit it climbs to, and where it goes over the crest. */
    from: 330,
    to: -150,
    gap: 44,
    /** How far below the crest it sinks, and over how many units, as it goes over. */
    sink: 16,
    fade: 60,
});

/**
 * The far file at `time`: each wolf's state (null when it is not on the skyline), with `fade`
 * (0..1) and `sink` (units below the crest) as it comes up and goes over.
 * @param {number} time
 */
export function farFileAt(time) {
    const t = time - FAR_FILE.first;
    if (!Number.isFinite(t) || t < 0) return null;
    const index = Math.floor(t / FAR_FILE.period);
    const u = t - index * FAR_FILE.period;
    const count = FAR_FILE.count + (travelHash(index, 97) < 0.4 ? 1 : 0);
    let any = false;
    const wolves = [];
    for (let i = 0; i < count; i++) {
        const x0 = FAR_FILE.from + i * (FAR_FILE.gap + travelHash(index * 5 + i, 101) * 16);
        /** @type {Leg[]} */
        const legs = [{ go: FAR_FILE.to, gait: 'trot', speed: 24 }];
        const state = follow(legs, u, x0, -1);
        if (state) {
            any = true;
            const into = smooth((FAR_FILE.from - state.x) / FAR_FILE.fade);
            const over = smooth((state.x - FAR_FILE.to) / FAR_FILE.fade);
            wolves.push({ ...state, fade: Math.min(into, over), sink: (1 - over) * FAR_FILE.sink });
        } else wolves.push(null);
    }
    return any ? { index, u, wolves } : null;
}

/* ── The white wolf of the summit ──────────────────────────────────────────────────── */

/**
 * The white wolf: it comes up over the left-hand summit, stands a while, sits, howls on its own,
 * and goes back over. `summon` brings it up at once (a perfect clear, a fever).
 */
export const MOON_WOLF = Object.freeze({
    first: 44,
    period: 132,
    /** Coming up over the crest and going back (seconds), and how long it stays between. */
    rise: 2.6,
    stay: 38,
    /** Its own howl: when in its stay, and for how long. */
    howl: [15, 20.5],
    sit: [6.5, 30],
});

/**
 * The white wolf at `time`: how far up it stands (0 behind the crest .. 1 on it), its posture and
 * its own howl; null when it is away. `summoned`: a time it was called up at (it stays its full
 * stay from then).
 * @param {number} time
 * @param {number} [summoned]
 */
export function moonWolfAt(time, summoned = -Infinity) {
    const { rise, stay } = MOON_WOLF;
    const total = rise * 2 + stay;
    const visit = (/** @type {number} */ u, /** @type {boolean} */ own) => {
        if (!(u >= 0 && u < total)) return null;
        const up = Math.min(smooth(u / rise), 1 - smooth((u - rise - stay) / rise));
        const s = u - rise;
        const sit = own ? span(s, MOON_WOLF.sit[0], MOON_WOLF.sit[1], 1.1) : 0;
        const howl = own ? span(s, MOON_WOLF.howl[0], MOON_WOLF.howl[1], 0.8) : 0;
        return {
            up,
            sit,
            howl,
            u: s,
            look: span(s, 1.2, 5, 0.6) + span(s, 31, 36, 0.6),
        };
    };
    const called = visit(time - summoned, false);
    const t = time - MOON_WOLF.first;
    const own = Number.isFinite(t) && t >= 0
        ? visit(t - Math.floor(t / MOON_WOLF.period) * MOON_WOLF.period, true) : null;
    if (called && own) return called.up >= own.up ? { ...own, up: Math.max(called.up, own.up) } : own;
    return called ?? own;
}
