/* eslint-disable max-lines, max-classes-per-file -- one book of small scenes, and the run and the life that play them */
/**
 * Stillwater — the life the two live between the moments play gives them (CPU only, three-free).
 *
 * The story (stillwater-story.js) answers play: a chain draws them out, four lines raise her heart.
 * Between those moments they are not statues. Each has a life of small things: he scratches behind
 * his ear, strokes his beard, stretches, trims his lantern, looks over his shoulder at a sound in
 * the wood, shades his eyes to the moon, wanders off into the wood a while and comes back, goes
 * down to the water to drink; she smooths her hair back, sings, catches a firefly and lets it go,
 * dances on the water, kneels among the lilies, drifts away into the mist and back.
 *
 * And they have each other, across the water. At first they are strangers who steal glances: when
 * their eyes meet she looks away, and he scratches his head. The longer the night goes on, and the
 * more the player gives them (lines, chains, hearts), the nearer they grow (`kin`, 0..1), and the
 * more they do together: a wave across the water and one back; a bow and a curtsy; he knocks his
 * staff on the water and she answers with her fingertips, the two rings meeting in the middle;
 * he skips a stone across to her and she claps; she catches a firefly and blows it across to his
 * lantern, and later he sends one back; she sings and he sways along; she dances on the water and
 * he tries a turn of his own and staggers, and she laughs; they watch the moon together; and at the
 * last he goes into the wood and comes back with a little light, and sets it afloat on the water
 * for her, and it drifts all the way across to her hands.
 *
 * A scene is a list of beats. A beat lasts a set time, or until something is so (he has arrived,
 * he is on his feet) and no longer than its `max`; for its length it says what each of them means
 * to do (an intent: where to stand, what to face, a gesture, what to look at and how much it is
 * worth to them), and when it begins it may set things in motion on the water (`events`: a stone
 * skipping, a light carried, a little boat). Play comes first: anything the story is doing with
 * them (a chain, the heart, a parting) or a quick run of play ends a scene where it stands, and the
 * story takes them from there. Everything is chosen by a seeded draw stepped with the clock, so a
 * replay of the same events meets the same night.
 */

import {
    EYE, HEART, MOON, SPIRIT, TROLL, clamp01, lerp, mulberry32, skyDirection,
} from './stillwater-core.js';

/** How near the two have grown (0..1): where a night begins, and what moves it on. */
export const KIN = Object.freeze({
    start: 0.1,
    /** A second of calm together (ten quiet minutes alone bring them about half the way). */
    calm: 0.0008,
    /** A line cleared, a step of a chain, a heart she takes, a second the path of light runs. */
    line: 0.0015,
    chain: 0.004,
    heart: 0.04,
    path: 0.0015,
    /** Their eyes meeting, and a scene the two of them see through. */
    meet: 0.006,
    duet: 0.025,
});

/** Seconds one of them, free and due for a scene of their own, waits for the other to be free for one of theirs. */
export const DUET_WAIT = 14;

/** Below this they are shy of each other's eyes; from this they are fond. */
export const SHY_BELOW = 0.3;
export const FOND_FROM = 0.5;

/** How much calm (seconds since play last did anything) a scene needs before it may begin. */
export const SCENE_CALM = 2.5;
/** Play this quick (the story's `busy`, 0..1) ends a scene; a scene waits for less. */
export const SCENE_BUSY = 0.45;

const LOOK = 0.9;
const FAR = 200;
const moonDir = skyDirection(MOON.azimuth, MOON.elevation);

/** Where they go (the stage's coordinates: the troll's [x, z], the spirit's [x, y, z]). */
export const PLACES = Object.freeze({
    trollHome: Object.freeze([TROLL.home[0], TROLL.home[2]]),
    trollEdge: Object.freeze([TROLL.reach[0], TROLL.reach[2]]),
    /** Into the wood: between his boulders, past the young spruce, out of the picture. */
    wood: Object.freeze([
        Object.freeze([10.3, -10.75]), Object.freeze([12.2, -10.6]), Object.freeze([14.6, -10.4]),
    ]),
    /** Along the bank a little, where the tarn opens before him. */
    stroll: Object.freeze([10.0, -10.15]),
    /** Behind her stone, among the flowering lilies. */
    lilies: Object.freeze([-6.85, 0.04, -14.0]),
    /** Back along her shore, far into the mist. */
    mist: Object.freeze([-9.2, 0.05, -22.5]),
    /** A slow round out over the water before her stone. */
    round: Object.freeze([
        Object.freeze([-5.2, 0.04, -8.8]), Object.freeze([-4.4, 0.04, -10.5]), Object.freeze([-5.5, 0.04, -11.6]),
    ]),
    /** A little way out on the water, where she dances. */
    dance: Object.freeze([-4.9, 0.04, -9.5]),
    /** Where she kneels on the water off her stone (the story's kneeling place). */
    kneel: Object.freeze([
        lerp(SPIRIT.home[0], SPIRIT.reach[0], 0.28), 0.04, lerp(SPIRIT.home[2], SPIRIT.reach[2], 0.28),
    ]),
    /** The moon, far up over her bank, and the wood behind him. */
    moon: Object.freeze([EYE.x + moonDir[0] * FAR, EYE.y + moonDir[1] * FAR, EYE.z + moonDir[2] * FAR]),
    behind: Object.freeze([TROLL.home[0] + 3.2, 1.6, TROLL.home[2] - 3.4]),
    tarn: Object.freeze([HEART[0], 0.3, HEART[2]]),
});

// ── Small helpers for scenes ────────────────────────────────────────────────────

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const ease = (k) => {
    const t = clamp01(k);
    return t * t * (3 - 2 * t);
};

/** He has arrived at `p` ([x, z]) and stopped. */
const trollAt = (p, near = 0.32) => (c) => dist2(c.troll, p) < near && c.trollSpeed < 0.12;
/** She has arrived at `p` ([x, y, z]). */
const spiritAt = (p, near = 0.16) => (c) => dist3(c.spirit, p) < near;
const trollUp = (c) => c.trollMode === 'standing';
const spiritUp = (c) => c.spiritMode === 'standing';
const spiritDown = (c) => c.spiritMode === 'kneeling';
const all = (...gates) => (c, run, t) => gates.every((g) => g(c, run, t));

/** Look at something, worth `weight` to them. */
function look(o, key, at, weight = LOOK) {
    o.look = o.lookBox || (o.lookBox = { key: '', at: null, weight: 0 });
    o.look.key = key;
    o.look.at = at;
    o.look.weight = weight;
    return o;
}
const atPartnerT = (o, c, w = LOOK) => look(o, 'partner', c.spiritHeart, w);
const atPartnerS = (o, c, w = LOOK) => look(o, 'partner', c.lantern, w);

/** A point `ahead` metres before the troll on his way to `p`, at eye height. */
function ahead(c, p, out) {
    const dx = p[0] - c.troll[0];
    const dz = p[1] - c.troll[1];
    const d = Math.hypot(dx, dz) || 1;
    out[0] = c.troll[0] + (dx / d) * 4;
    out[1] = 1.4;
    out[2] = c.troll[1] + (dz / d) * 4;
    return out;
}

// ── The scenes ──────────────────────────────────────────────────────────────────

/**
 * He walks a list of places in turn (beats), at `pace`, looking where he goes. He walks on through
 * the places on the way (within a stride of them) and stops at the last.
 */
function walkBeats(points, { pace = 0.5, gesture = null } = {}) {
    return points.map((p, i) => ({
        until: i < points.length - 1 ? (c) => dist2(c.troll, p) < 0.9 : trollAt(p),
        max: 14,
        troll: (t, c, o, run) => {
            o.at = p;
            o.sit = false;
            o.pace = pace;
            look(o, 'path', ahead(c, p, run.scratch(3)), 0.6);
            if (gesture) o.gesture = run.gesture('troll', gesture, 60);
        },
    }));
}

/** She drifts to a place (one beat), at `pace`, standing (`through`: on past it, not stopping). */
function driftBeat(p, { pace = 0.45, lookAt = null, through = false } = {}) {
    return {
        until: spiritAt(p, through ? 0.6 : 0.16),
        max: 16,
        spirit: (t, c, o) => {
            o.at = p;
            o.kneel = false;
            o.pace = pace;
            if (lookAt) look(o, 'path', lookAt, 0.55);
        },
    };
}

/** Get him onto his feet where he is (a beat; a no-op when he is up). */
const trollRises = {
    until: trollUp,
    max: 3.5,
    troll: (t, c, o) => {
        o.sit = false;
    },
};
/** Get her up off the water where she is. */
const spiritRises = {
    until: spiritUp,
    max: 3.5,
    spirit: (t, c, o) => {
        o.kneel = false;
    },
};

/** One gesture of one of them for a beat's length, watching something. */
function gestureBeat(who, name, len, {
    lookKey = null, lookAt = null, weight = LOOK, staff = null, hands = null,
} = {}) {
    return {
        len,
        [who]: (t, c, o, run) => {
            o.gesture = run.gesture(who, name, len);
            if (staff) o.staff = staff;
            if (hands) o.hands = hands;
            if (lookKey === 'partner') (who === 'troll' ? atPartnerT : atPartnerS)(o, c, weight);
            else if (lookKey) look(o, lookKey, typeof lookAt === 'function' ? lookAt(c) : lookAt, weight);
        },
    };
}

/** The stone's skips across the water from where he throws (stage [x, z]) toward her. */
export function skipPath(from, toward) {
    const dx = toward[0] - from[0];
    const dz = toward[1] - from[1];
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d;
    const uz = dz / d;
    const gaps = [1.3, 2.2, 1.9, 1.6, 1.3, 1.0, 0.72, 0.48];
    const times = [0.34, 0.33, 0.3, 0.27, 0.25, 0.22, 0.2, 0.17];
    const out = [];
    let s = 0;
    let t = 0;
    for (let i = 0; i < gaps.length; i++) {
        s += gaps[i];
        t += times[i];
        out.push({
            x: from[0] + ux * s, z: from[1] + uz * s, t, strength: 1 - i / gaps.length,
        });
    }
    return out;
}

/** Where the skipping stone is `t` seconds after it leaves his hand (stage [x, y, z]), or null once it has sunk. */
export function skipAt(path, from, t, out = [0, 0, 0]) {
    if (!path || t < 0) return null;
    let px = from[0];
    let pz = from[1];
    let pt = 0;
    let py = 1.0;
    for (let i = 0; i < path.length; i++) {
        const b = path[i];
        if (t <= b.t) {
            const k = (t - pt) / Math.max(1e-3, b.t - pt);
            out[0] = lerp(px, b.x, k);
            out[2] = lerp(pz, b.z, k);
            out[1] = lerp(py, 0, k) + Math.sin(k * Math.PI) * (0.35 * b.strength + 0.05);
            return out;
        }
        px = b.x;
        pz = b.z;
        pt = b.t;
        py = 0;
    }
    if (t >= pt + 0.4) return null;
    out[0] = px;
    out[1] = 0;
    out[2] = pz;
    return out;
}

/** Seconds a light takes to cross the water from one of them to the other. */
export const GIFT_FLIGHT = 4.6;

/**
 * A light crossing from `from` to `to` ([x, y, z]), `k` of the way (0..1): slow to leave, slow to
 * arrive, over a bow `lift` metres high, wavering a little as a firefly does.
 */
export function arcAt(from, to, k, lift = 1.3, out = [0, 0, 0]) {
    const t = clamp01(k);
    const e = t * t * (3 - 2 * t);
    const waver = Math.sin(t * Math.PI * 5) * 0.12 * Math.sin(t * Math.PI);
    out[0] = lerp(from[0], to[0], e);
    out[1] = lerp(from[1], to[1], e) + Math.sin(Math.PI * t) * lift + waver;
    out[2] = lerp(from[2], to[2], e) + waver * 0.6;
    return out;
}

/** Where a light floating on the water is `t` seconds into its crossing (stage [x, y, z]). */
export function boatAt(from, to, t, length, out = [0, 0, 0]) {
    const k = clamp01(t / length);
    const e = k * k * (3 - 2 * k) * 0.35 + k * 0.65;
    // (A gentle bow in its course: it drifts, it is not sent.)
    const bow = Math.sin(k * Math.PI) * 1.1;
    out[0] = lerp(from[0], to[0], e);
    out[2] = lerp(from[2], to[2], e) + bow;
    out[1] = 0.07 + Math.sin(t * 2.1) * 0.015;
    return out;
}

/**
 * Every scene: who is in it (`who`: troll | spirit | both), from what nearness on (`kin`), how
 * often it comes up against the others (`weight`), when it may (`may(ctx)`), and its beats.
 * `vars(rand)` draws a scene's own choices when it begins (how long he stays away...).
 */
export const SCENES = Object.freeze({
    // ── His own ──
    scratch: {
        who: 'troll',
        weight: 1,
        beats: [gestureBeat('troll', 'scratch', 2.8, {
            lookKey: 'water', lookAt: (c) => [c.troll[0] - 3, 0, c.troll[1] + 1.2], weight: 0.5,
        })],
    },
    beard: {
        who: 'troll',
        weight: 1,
        beats: [gestureBeat('troll', 'beard', 3.6, { lookKey: 'tarn', lookAt: PLACES.tarn, weight: 0.6 })],
    },
    stretch: {
        who: 'troll',
        weight: 0.8,
        beats: [gestureBeat('troll', 'stretch', 3.6, {
            lookKey: 'up', lookAt: (c) => [c.troll[0] - 1, 9, c.troll[1] - 2], weight: 0.7,
        })],
    },
    tend: {
        who: 'troll',
        weight: 0.9,
        beats: [{
            len: 4.4,
            enter: (run, c, life, time) => life.emit({ type: 'tend', start: time, length: 4.4 }),
            troll: (t, c, o, run) => {
                o.gesture = run.gesture('troll', 'tend', 4.4);
                o.staff = 'tend';
                look(o, 'lantern', c.lantern, 0.9);
            },
        }],
    },
    listen: {
        who: 'troll',
        weight: 0.7,
        beats: [gestureBeat('troll', 'listen', 3.8, { lookKey: 'wood', lookAt: PLACES.behind, weight: 0.95 })],
    },
    moonward: {
        who: 'troll',
        weight: 0.6,
        beats: [gestureBeat('troll', 'lookout', 4.6, { lookKey: 'moon', lookAt: PLACES.moon, weight: 0.9 })],
    },
    wood: {
        who: 'troll',
        weight: 0.55,
        may: (c) => dist2(c.troll, PLACES.trollHome) < 0.6,
        vars: (rand) => ({ away: 3 + rand() * 6 }),
        beats: [
            trollRises,
            gestureBeat('troll', 'listen', 2.2, { lookKey: 'wood', lookAt: [13.5, 1.4, -10.5], weight: 0.95 }),
            ...walkBeats(PLACES.wood, { pace: 0.55 }),
            {
                len: 8,
                lenOf: (run) => run.vars.away,
                troll: (t, c, o) => {
                    o.at = PLACES.wood[2];
                    o.sit = false;
                    look(o, 'wood', [17, 1.2, -12], 0.6);
                },
            },
            ...walkBeats([PLACES.wood[1], PLACES.wood[0], PLACES.trollHome], { pace: 0.5 }),
        ],
    },
    stroll: {
        who: 'troll',
        weight: 0.6,
        may: (c) => dist2(c.troll, PLACES.trollHome) < 0.6,
        beats: [
            trollRises,
            ...walkBeats([PLACES.stroll], { pace: 0.42 }),
            gestureBeat('troll', 'beard', 4.2, { lookKey: 'tarn', lookAt: PLACES.tarn, weight: 0.8 }),
            ...walkBeats([PLACES.trollHome], { pace: 0.42 }),
        ],
    },
    drink: {
        who: 'troll',
        weight: 0.5,
        may: (c) => dist2(c.troll, PLACES.trollHome) < 0.6,
        beats: [
            trollRises,
            ...walkBeats([PLACES.trollEdge], { pace: 0.5 }),
            {
                until: (c) => c.trollMode === 'crouched',
                max: 3,
                troll: (t, c, o) => {
                    o.at = PLACES.trollEdge;
                    o.crouch = true;
                    look(o, 'water', [c.troll[0] - 1.2, 0, c.troll[1] + 0.3], 0.8);
                },
            },
            {
                len: 5.2,
                troll: (t, c, o, run) => {
                    o.at = PLACES.trollEdge;
                    o.crouch = true;
                    o.gesture = run.gesture('troll', 'drink', 5.2);
                    look(o, 'water', [c.troll[0] - 1.2, 0, c.troll[1] + 0.3], 0.8);
                },
            },
            ...walkBeats([PLACES.trollHome], { pace: 0.48 }),
        ],
    },

    // ── Hers ──
    brush: {
        who: 'spirit',
        weight: 1,
        beats: [gestureBeat('spirit', 'brush', 3.2)],
    },
    sing: {
        who: 'spirit',
        weight: 0.8,
        beats: [{
            len: 7.5,
            enter: (run, c, life, time) => life.emit({ type: 'song', start: time, length: 7.5 }),
            spirit: (t, c, o, run) => {
                o.gesture = run.gesture('spirit', 'sing', 7.5);
                look(o, 'moon', PLACES.moon, 0.7);
            },
        }],
    },
    firefly: {
        who: 'spirit',
        weight: 0.9,
        beats: [
            {
                len: 2.4,
                // (Held from the catch until she lets it go, two beats on.)
                enter: (run, c, life, time) => life.emit({
                    type: 'held', who: 'spirit', start: time + 1.3, length: 2.4 - 1.3 + 2.6 + 0.7,
                }),
                spirit: (t, c, o, run) => {
                    o.gesture = run.gesture('spirit', 'gather', 2.4);
                    look(o, 'firefly', [c.spirit[0] + 0.3, c.spirit[1] + 2.2, c.spirit[2] + 0.6], 0.9);
                },
            },
            {
                len: 2.6,
                spirit: (t, c, o) => {
                    o.hands = 'receive';
                    look(o, 'hands', [c.spirit[0] + 0.25, c.spirit[1] + 1.0, c.spirit[2] + 0.45], 0.9);
                },
            },
            {
                len: 2.6,
                enter: (run, c, life, time) => life.emit({ type: 'release', start: time + 0.7, length: 3 }),
                spirit: (t, c, o, run) => {
                    o.gesture = run.gesture('spirit', 'release', 2.6);
                    look(o, 'up', [c.spirit[0] + 0.4, c.spirit[1] + 6, c.spirit[2] + 1], 0.8);
                },
            },
        ],
    },
    twirl: {
        who: 'spirit',
        weight: 0.7,
        may: (c) => dist3(c.spirit, SPIRIT.home) < 1.2 || dist3(c.spirit, PLACES.kneel) < 0.6,
        vars: (rand) => ({ twice: rand() < 0.5 }),
        beats: [
            spiritRises,
            driftBeat(PLACES.dance, { pace: 0.5 }),
            {
                len: 3.6,
                enter: (run, c, life, time) => life.emit({ type: 'twirl', start: time, length: 3.6 }),
                spirit: (t, c, o, run) => {
                    o.at = PLACES.dance;
                    o.gesture = run.gesture('spirit', 'twirl', 3.6);
                },
            },
            {
                len: 3.6,
                lenOf: (run) => (run.vars.twice ? 3.6 : 0),
                enter: (run, c, life, time) => run.vars.twice && life.emit({ type: 'twirl', start: time, length: 3.6 }),
                spirit: (t, c, o, run) => {
                    o.at = PLACES.dance;
                    if (run.vars.twice) o.gesture = run.gesture('spirit', 'twirl', 3.6);
                },
            },
        ],
    },
    lilies: {
        who: 'spirit',
        weight: 0.6,
        may: (c) => dist3(c.spirit, SPIRIT.home) < 1.2 || dist3(c.spirit, PLACES.kneel) < 0.6,
        beats: [
            spiritRises,
            driftBeat(PLACES.lilies, { pace: 0.4, lookAt: [PLACES.lilies[0], 0, PLACES.lilies[2]] }),
            {
                until: spiritDown,
                max: 4,
                spirit: (t, c, o) => {
                    o.at = PLACES.lilies;
                    o.kneel = true;
                    o.face = 0.35;
                },
            },
            {
                len: 6.5,
                spirit: (t, c, o) => {
                    o.at = PLACES.lilies;
                    o.kneel = true;
                    o.face = 0.35;
                    look(o, 'down', null, 0.8);
                },
            },
            spiritRises,
        ],
    },
    mist: {
        who: 'spirit',
        weight: 0.5,
        may: (c) => dist3(c.spirit, SPIRIT.home) < 1.2 || dist3(c.spirit, PLACES.kneel) < 0.6,
        vars: (rand) => ({ stay: 4 + rand() * 5 }),
        beats: [
            spiritRises,
            driftBeat(PLACES.mist, { pace: 0.42, lookAt: [PLACES.mist[0] - 2, 1.4, PLACES.mist[2] - 6] }),
            {
                len: 6,
                lenOf: (run) => run.vars.stay,
                spirit: (t, c, o) => {
                    o.at = PLACES.mist;
                    look(o, 'far', [PLACES.mist[0] + Math.sin(t * 0.4) * 4, 1.6, PLACES.mist[2] - 8], 0.55);
                },
            },
        ],
    },
    round: {
        who: 'spirit',
        weight: 0.7,
        may: (c) => dist3(c.spirit, SPIRIT.home) < 1.2 || dist3(c.spirit, PLACES.kneel) < 0.6,
        beats: [
            spiritRises,
            ...PLACES.round.map((p, i) => driftBeat(p, {
                pace: 0.35, lookAt: [p[0] + 1.5, 0.2, p[2] - 1], through: i < PLACES.round.length - 1,
            })),
        ],
    },
    moongaze: {
        who: 'spirit',
        weight: 0.6,
        beats: [gestureBeat('spirit', 'clasp', 5.2, { lookKey: 'moon', lookAt: PLACES.moon, weight: 0.9 })],
    },

    // ── Theirs ──
    greet: {
        who: 'both',
        kin: [0, 1],
        weight: 1.2,
        vars: (rand) => ({ first: rand() < 0.5 ? 'troll' : 'spirit' }),
        beats: [
            {
                len: 1.8,
                troll: (t, c, o, run) => run.vars.first === 'troll' && atPartnerT(o, c),
                spirit: (t, c, o, run) => run.vars.first === 'spirit' && atPartnerS(o, c),
            },
            {
                len: 2.8,
                troll: (t, c, o, run) => {
                    atPartnerT(o, c, t > 0.5 || run.vars.first === 'troll' ? 0.95 : 0.3);
                    if (run.vars.first === 'troll') {
                        o.gesture = run.gesture('troll', 'wave', 2.8);
                        o.staff = 'raise';
                    }
                },
                spirit: (t, c, o, run) => {
                    atPartnerS(o, c, t > 0.5 || run.vars.first === 'spirit' ? 0.95 : 0.3);
                    if (run.vars.first === 'spirit') o.gesture = run.gesture('spirit', 'wave', 2.8);
                },
            },
            {
                len: 2.8,
                troll: (t, c, o, run) => {
                    atPartnerT(o, c, 0.95);
                    if (run.vars.first === 'spirit') {
                        o.gesture = run.gesture('troll', c.kin < SHY_BELOW ? 'scratch' : 'wave', 2.8);
                        if (c.kin >= SHY_BELOW) o.staff = 'raise';
                    }
                },
                spirit: (t, c, o, run) => {
                    if (run.vars.first === 'troll') {
                        const shy = c.kin < SHY_BELOW;
                        o.gesture = run.gesture('spirit', shy ? 'shy' : 'wave', 2.8);
                        if (shy) look(o, 'down', null, 0.95);
                        else atPartnerS(o, c, 0.95);
                    } else atPartnerS(o, c, 0.95);
                },
            },
            {
                len: 1.6,
                troll: (t, c, o) => atPartnerT(o, c, 0.95),
                spirit: (t, c, o) => atPartnerS(o, c, 0.95),
            },
        ],
    },
    bow: {
        who: 'both',
        kin: [0.15, 1],
        weight: 0.8,
        beats: [
            {
                until: all(trollUp, spiritUp),
                max: 4,
                troll: (t, c, o) => {
                    o.sit = false;
                    atPartnerT(o, c);
                },
                spirit: (t, c, o) => {
                    o.kneel = false;
                    atPartnerS(o, c);
                },
            },
            {
                len: 3.2,
                troll: (t, c, o, run) => {
                    o.sit = false;
                    o.gesture = run.gesture('troll', 'bow', 3.2);
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o) => atPartnerS(o, c, 0.95),
            },
            {
                len: 3,
                troll: (t, c, o) => {
                    o.sit = false;
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o, run) => {
                    o.gesture = run.gesture('spirit', 'curtsy', 3);
                    atPartnerS(o, c, 0.95);
                },
            },
        ],
    },
    call: {
        who: 'both',
        kin: [0.25, 1],
        weight: 0.9,
        may: (c) => dist2(c.troll, PLACES.trollHome) < 0.6,
        beats: [
            trollRises,
            {
                ...walkBeats([PLACES.trollEdge], { pace: 0.5 })[0],
                spirit: (t, c, o) => atPartnerS(o, c, 0.7),
            },
            {
                len: 2.6,
                troll: (t, c, o, run) => {
                    o.at = PLACES.trollEdge;
                    o.staff = 'thump';
                    o.gesture = run.gesture('troll', 'thump', 2.6);
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o) => atPartnerS(o, c, 0.9),
            },
            {
                until: spiritDown,
                max: 4.5,
                troll: (t, c, o) => {
                    o.at = PLACES.trollEdge;
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o) => {
                    o.at = PLACES.kneel;
                    o.kneel = true;
                    atPartnerS(o, c, 0.8);
                },
            },
            {
                len: 2.4,
                enter: (run, c, life, time) => life.emit({ type: 'ripple', who: 'spirit', start: time + 0.9 }),
                troll: (t, c, o) => {
                    o.at = PLACES.trollEdge;
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o, run) => {
                    o.at = PLACES.kneel;
                    o.kneel = true;
                    o.gesture = run.gesture('spirit', 'dip', 2.4);
                    look(o, 'down', null, 0.9);
                },
            },
            {
                len: 2.6,
                troll: (t, c, o) => {
                    o.at = PLACES.trollEdge;
                    look(o, 'middle', [0.4, 0, -10.2], 0.95);
                },
                spirit: (t, c, o) => {
                    o.at = PLACES.kneel;
                    o.kneel = true;
                    look(o, 'middle', [0.4, 0, -10.2], 0.95);
                },
            },
            {
                len: 2,
                troll: (t, c, o) => {
                    o.at = PLACES.trollEdge;
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o) => {
                    o.at = PLACES.kneel;
                    o.kneel = true;
                    atPartnerS(o, c, 0.95);
                },
            },
            ...walkBeats([PLACES.trollHome], { pace: 0.46 }),
        ],
    },
    skip: {
        who: 'both',
        kin: [0.4, 1],
        weight: 1,
        may: (c) => dist2(c.troll, PLACES.trollHome) < 0.6,
        beats: [
            trollRises,
            {
                ...walkBeats([PLACES.trollEdge], { pace: 0.52 })[0],
                spirit: (t, c, o) => atPartnerS(o, c, 0.6),
            },
            {
                len: 1.8,
                troll: (t, c, o, run) => {
                    o.at = PLACES.trollEdge;
                    o.gesture = run.gesture('troll', 'pick', 1.8);
                    look(o, 'ground', [c.troll[0] - 0.6, 0.1, c.troll[1] + 0.5], 0.95);
                },
            },
            {
                len: 1.1,
                troll: (t, c, o) => {
                    o.at = PLACES.trollEdge;
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o) => atPartnerS(o, c, 0.8),
            },
            {
                len: 1.1,
                enter: (run, c, life, time) => {
                    const from = [c.troll[0] - 0.5, c.troll[1] + 0.2];
                    run.vars.skipFrom = from;
                    run.vars.skipPath = skipPath(from, [c.spirit[0], c.spirit[2]]);
                    run.vars.skipStart = time + 0.55;
                    life.emit({
                        type: 'skip', start: time + 0.55, from, path: run.vars.skipPath,
                    });
                },
                troll: (t, c, o, run) => {
                    o.at = PLACES.trollEdge;
                    o.gesture = run.gesture('troll', 'throw', 1.1);
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o) => atPartnerS(o, c, 0.9),
            },
            {
                len: 2.6,
                troll: (t, c, o, run) => {
                    o.at = PLACES.trollEdge;
                    const p = skipAt(run.vars.skipPath, run.vars.skipFrom, c.time - run.vars.skipStart, run.scratch(4));
                    look(o, 'skip', p || [run.vars.skipPath.at(-1).x, 0, run.vars.skipPath.at(-1).z], 0.97);
                },
                spirit: (t, c, o, run) => {
                    const p = skipAt(run.vars.skipPath, run.vars.skipFrom, c.time - run.vars.skipStart, run.scratch(5));
                    look(o, 'skip', p || [run.vars.skipPath.at(-1).x, 0, run.vars.skipPath.at(-1).z], 0.97);
                },
            },
            {
                len: 2.4,
                troll: (t, c, o) => {
                    o.at = PLACES.trollEdge;
                    o.staff = 'raise';
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o, run) => {
                    o.gesture = run.gesture('spirit', c.kin >= 0.55 ? 'clap' : 'laugh', 2.4);
                    atPartnerS(o, c, 0.95);
                },
            },
            ...walkBeats([PLACES.trollHome], { pace: 0.46 }),
        ],
    },
    gift: {
        who: 'both',
        kin: [0.35, 1],
        weight: 1,
        beats: [
            {
                ...spiritRises,
                troll: (t, c, o) => atPartnerT(o, c, 0.5),
            },
            {
                len: 2.4,
                // (Held from the catch until it leaves her hands, three beats on.)
                enter: (run, c, life, time) => life.emit({
                    type: 'held', who: 'spirit', start: time + 1.3, length: 2.4 - 1.3 + 1.8 + 0.75,
                }),
                spirit: (t, c, o, run) => {
                    o.gesture = run.gesture('spirit', 'gather', 2.4);
                    look(o, 'firefly', [c.spirit[0] + 0.3, c.spirit[1] + 2.2, c.spirit[2] + 0.6], 0.9);
                },
            },
            {
                len: 1.8,
                spirit: (t, c, o) => {
                    o.hands = 'receive';
                    look(o, 'hands', [c.spirit[0] + 0.25, c.spirit[1] + 1.0, c.spirit[2] + 0.45], 0.9);
                },
                troll: (t, c, o) => atPartnerT(o, c, 0.8),
            },
            {
                len: 1.6,
                enter: (run, c, life, time) => {
                    run.vars.giftStart = time + 0.75;
                    run.vars.giftFrom = [...c.spiritHeart];
                    life.emit({
                        type: 'gift', from: 'spirit', to: 'troll', start: time + 0.75, length: GIFT_FLIGHT,
                    });
                },
                spirit: (t, c, o, run) => {
                    o.gesture = run.gesture('spirit', 'send', 1.6);
                    atPartnerS(o, c, 0.95);
                },
                troll: (t, c, o) => atPartnerT(o, c, 0.95),
            },
            {
                len: GIFT_FLIGHT - 0.85 + 0.4,
                troll: (t, c, o, run) => {
                    const k = (c.time - run.vars.giftStart) / GIFT_FLIGHT;
                    look(o, 'gift', arcAt(run.vars.giftFrom, c.lantern, k, 1.3, run.scratch(8)), 0.97);
                },
                spirit: (t, c, o, run) => {
                    const k = (c.time - run.vars.giftStart) / GIFT_FLIGHT;
                    look(o, 'gift', arcAt(run.vars.giftFrom, c.lantern, k, 1.3, run.scratch(9)), t < 1.6 ? 0.95 : 0.5);
                },
            },
            {
                len: 2.2,
                troll: (t, c, o, run) => {
                    o.gesture = run.gesture('troll', 'nod', 2.2);
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o) => atPartnerS(o, c, 0.95),
            },
            {
                len: 2.2,
                lenOf: (run, c) => (c.kin >= 0.6 ? 2.2 : 0),
                enter: (run, c, life, time) => {
                    if (c.kin < 0.6) return;
                    run.vars.backStart = time + 1.2;
                    run.vars.backFrom = [...c.lantern];
                    life.emit({
                        type: 'gift', from: 'troll', to: 'spirit', start: time + 1.2, length: GIFT_FLIGHT,
                    });
                },
                troll: (t, c, o) => {
                    o.staff = 'offer';
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o) => atPartnerS(o, c, 0.95),
            },
            {
                len: GIFT_FLIGHT,
                lenOf: (run) => (run.vars.backStart ? GIFT_FLIGHT : 0),
                troll: (t, c, o, run) => {
                    const k = (c.time - run.vars.backStart) / GIFT_FLIGHT;
                    const at = arcAt(run.vars.backFrom, c.spiritHeart, k, 1.3, run.scratch(8));
                    look(o, 'gift', at, k < 0.4 ? 0.95 : 0.6);
                },
                spirit: (t, c, o, run) => {
                    const k = (c.time - run.vars.backStart) / GIFT_FLIGHT;
                    look(o, 'gift', arcAt(run.vars.backFrom, c.spiritHeart, k, 1.3, run.scratch(9)), 0.97);
                    if (k > 0.75) o.hands = 'receive';
                },
            },
            {
                len: 2.6,
                lenOf: (run) => (run.vars.backStart ? 2.6 : 0),
                troll: (t, c, o) => atPartnerT(o, c, 0.95),
                spirit: (t, c, o) => {
                    o.hands = 'heart';
                    atPartnerS(o, c, 0.95);
                },
            },
        ],
    },
    song: {
        who: 'both',
        kin: [0.5, 1],
        weight: 0.8,
        beats: [
            {
                len: 8.5,
                enter: (run, c, life, time) => life.emit({ type: 'song', start: time, length: 8.5 }),
                spirit: (t, c, o, run) => {
                    o.gesture = run.gesture('spirit', 'sing', 8.5);
                    look(o, 'moon', PLACES.moon, 0.8);
                },
                troll: (t, c, o, run) => {
                    o.gesture = run.gesture('troll', 'sway', 8.5);
                    atPartnerT(o, c, 0.95);
                },
            },
            {
                len: 2,
                troll: (t, c, o, run) => {
                    o.gesture = run.gesture('troll', 'nod', 2);
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o, run) => {
                    o.gesture = run.gesture('spirit', 'tilt', 2);
                    atPartnerS(o, c, 0.95);
                },
            },
        ],
    },
    dance: {
        who: 'both',
        kin: [0.55, 1],
        weight: 0.9,
        may: (c) => dist3(c.spirit, SPIRIT.home) < 1.2 || dist3(c.spirit, PLACES.kneel) < 0.6,
        beats: [
            {
                until: (c) => spiritUp(c) && spiritAt(PLACES.dance)(c),
                max: 9,
                spirit: (t, c, o) => {
                    o.at = PLACES.dance;
                    o.kneel = false;
                    o.pace = 0.5;
                },
                troll: (t, c, o) => {
                    o.sit = false;
                    atPartnerT(o, c, 0.8);
                },
            },
            {
                len: 3.6,
                enter: (run, c, life, time) => life.emit({ type: 'twirl', start: time, length: 3.6 }),
                spirit: (t, c, o, run) => {
                    o.at = PLACES.dance;
                    o.gesture = run.gesture('spirit', 'twirl', 3.6);
                },
                troll: (t, c, o) => {
                    o.sit = false;
                    atPartnerT(o, c, 0.95);
                },
            },
            {
                len: 3.6,
                enter: (run, c, life, time) => life.emit({ type: 'twirl', start: time, length: 3.6 }),
                spirit: (t, c, o, run) => {
                    o.at = PLACES.dance;
                    o.gesture = run.gesture('spirit', 'twirl', 3.6);
                },
                troll: (t, c, o, run) => {
                    o.sit = false;
                    o.gesture = run.gesture('troll', 'sway', 3.6);
                    atPartnerT(o, c, 0.95);
                },
            },
            {
                len: 5.4,
                enter: (run, c) => {
                    run.vars.face = Math.atan2(c.spiritHeart[0] - c.troll[0], c.spiritHeart[2] - c.troll[1]);
                },
                troll: (t, c, o, run) => {
                    o.sit = false;
                    o.face = run.vars.face + Math.PI * 2 * ease(t / 5.0);
                    o.gesture = run.gesture('troll', 'spin', 5.4);
                    atPartnerT(o, c, 0.6);
                },
                spirit: (t, c, o) => {
                    o.at = PLACES.dance;
                    atPartnerS(o, c, 0.95);
                },
            },
            {
                len: 1.4,
                troll: (t, c, o, run) => {
                    o.sit = false;
                    o.gesture = run.gesture('troll', 'stagger', 1.4);
                },
                spirit: (t, c, o) => {
                    o.at = PLACES.dance;
                    atPartnerS(o, c, 0.95);
                },
            },
            {
                len: 2.6,
                troll: (t, c, o, run) => {
                    o.sit = false;
                    o.gesture = run.gesture('troll', 'scratch', 2.6);
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o, run) => {
                    o.at = PLACES.dance;
                    o.gesture = run.gesture('spirit', 'laugh', 2.6);
                    atPartnerS(o, c, 0.95);
                },
            },
        ],
    },
    moon: {
        who: 'both',
        kin: [0.65, 1],
        weight: 0.7,
        beats: [
            {
                len: 5.4,
                troll: (t, c, o, run) => {
                    o.gesture = run.gesture('troll', 'lookout', 5.4);
                    look(o, 'moon', PLACES.moon, 0.95);
                },
                spirit: (t, c, o, run) => {
                    o.gesture = run.gesture('spirit', 'clasp', 5.4);
                    look(o, 'moon', PLACES.moon, 0.95);
                },
            },
            {
                len: 2.8,
                troll: (t, c, o) => atPartnerT(o, c, 0.95),
                spirit: (t, c, o) => atPartnerS(o, c, 0.95),
            },
            {
                len: 2,
                troll: (t, c, o, run) => {
                    o.gesture = run.gesture('troll', 'nod', 2);
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o, run) => {
                    o.gesture = run.gesture('spirit', 'tilt', 2);
                    atPartnerS(o, c, 0.95);
                },
            },
        ],
    },
    boat: {
        who: 'both',
        kin: [0.75, 1],
        weight: 0.9,
        may: (c) => dist2(c.troll, PLACES.trollHome) < 0.6,
        beats: [
            trollRises,
            gestureBeat('troll', 'listen', 2.0, { lookKey: 'wood', lookAt: [13.5, 1.4, -10.5], weight: 0.95 }),
            ...walkBeats(PLACES.wood, { pace: 0.55 }),
            {
                len: 5,
                troll: (t, c, o) => {
                    o.at = PLACES.wood[2];
                    o.sit = false;
                    look(o, 'wood', [17, 0.4, -12], 0.8);
                },
            },
            {
                len: 1.6,
                enter: (run, c, life, time) => {
                    run.vars.carry = life.emit({
                        type: 'held', who: 'troll', start: time + 0.6, length: 120,
                    });
                },
                troll: (t, c, o, run) => {
                    o.at = PLACES.wood[2];
                    o.sit = false;
                    o.gesture = run.gesture('troll', 'pick', 1.6);
                },
            },
            ...walkBeats([PLACES.wood[1], PLACES.wood[0], PLACES.trollEdge], { pace: 0.48, gesture: 'carry' }),
            {
                until: (c) => c.trollMode === 'crouched',
                max: 3,
                troll: (t, c, o, run) => {
                    o.at = PLACES.trollEdge;
                    o.crouch = true;
                    o.gesture = run.gesture('troll', 'carry', 3);
                    look(o, 'water', [c.troll[0] - 1, 0, c.troll[1] + 0.3], 0.9);
                },
                spirit: (t, c, o) => atPartnerS(o, c, 0.9),
            },
            {
                len: 2,
                enter: (run, c, life, time) => {
                    if (run.vars.carry) run.vars.carry.length = time + 1.1 - run.vars.carry.start;
                    const from = [c.troll[0] - 0.9, 0, c.troll[1] + 0.25];
                    const to = [PLACES.kneel[0] + 0.55, 0, PLACES.kneel[2] + 0.2];
                    run.vars.boat = {
                        from, to, start: time + 1.1, length: 15,
                    };
                    life.emit({
                        type: 'boat', from, to, start: time + 1.1, length: 15,
                    });
                },
                troll: (t, c, o, run) => {
                    o.at = PLACES.trollEdge;
                    o.crouch = true;
                    o.gesture = run.gesture('troll', 'set', 2);
                    look(o, 'water', [c.troll[0] - 1, 0, c.troll[1] + 0.3], 0.9);
                },
                spirit: (t, c, o) => atPartnerS(o, c, 0.9),
            },
            {
                len: 14,
                troll: (t, c, o, run) => {
                    o.at = PLACES.trollEdge;
                    const b = run.vars.boat;
                    look(o, 'boat', boatAt(b.from, b.to, c.time - b.start, b.length, run.scratch(6)), 0.95);
                },
                spirit: (t, c, o, run) => {
                    const b = run.vars.boat;
                    look(o, 'boat', boatAt(b.from, b.to, c.time - b.start, b.length, run.scratch(7)), 0.95);
                    if (t > 6) {
                        o.at = PLACES.kneel;
                        o.kneel = true;
                    }
                    if (t > 11.6) o.hands = 'receive';
                },
            },
            {
                len: 4,
                troll: (t, c, o, run) => {
                    o.at = PLACES.trollEdge;
                    o.gesture = run.gesture('troll', 'nod', 2.2);
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o) => {
                    o.at = PLACES.kneel;
                    o.kneel = true;
                    o.hands = 'heart';
                    atPartnerS(o, c, 0.95);
                },
            },
            ...walkBeats([PLACES.trollHome], { pace: 0.46 }),
        ],
    },

    // ── Reflexes: their eyes meet ──
    shy: {
        who: 'both',
        reflex: true,
        beats: [
            {
                len: 0.9,
                troll: (t, c, o) => atPartnerT(o, c, 0.95),
                spirit: (t, c, o) => atPartnerS(o, c, 0.95),
            },
            {
                len: 2.6,
                troll: (t, c, o, run) => {
                    o.gesture = run.gesture('troll', 'scratch', 2.6);
                    look(o, 'water', [c.troll[0] - 3, 0, c.troll[1] + 1.4], 0.95);
                },
                spirit: (t, c, o, run) => {
                    o.gesture = run.gesture('spirit', 'shy', 2.6);
                    look(o, 'down', null, 0.95);
                },
            },
        ],
    },
    fond: {
        who: 'both',
        reflex: true,
        beats: [
            {
                len: 1.3,
                troll: (t, c, o) => atPartnerT(o, c, 0.95),
                spirit: (t, c, o) => atPartnerS(o, c, 0.95),
            },
            {
                len: 2,
                troll: (t, c, o, run) => {
                    o.gesture = run.gesture('troll', 'nod', 2);
                    atPartnerT(o, c, 0.95);
                },
                spirit: (t, c, o, run) => {
                    o.gesture = run.gesture('spirit', 'tilt', 2);
                    atPartnerS(o, c, 0.95);
                },
            },
        ],
    },
});

/** The names of the scenes that can be chosen (not the reflexes), by who is in them. */
export const SCENE_NAMES = Object.freeze({
    troll: Object.freeze(Object.keys(SCENES).filter((n) => SCENES[n].who === 'troll')),
    spirit: Object.freeze(Object.keys(SCENES).filter((n) => SCENES[n].who === 'spirit')),
    both: Object.freeze(Object.keys(SCENES).filter((n) => SCENES[n].who === 'both' && !SCENES[n].reflex)),
});

/** A scene under way. */
class Run {
    constructor(name, time, rand, ctx) {
        this.name = name;
        this.def = SCENES[name];
        this.start = time;
        this.beat = -1;
        this.beatStart = time;
        this.beatLen = 0;
        this.vars = this.def.vars ? this.def.vars(rand) : {};
        this._gestures = new Map();
        this._scratch = [];
        this.ctx = ctx;
    }

    /** A gesture object for this beat (made once per beat, so its start is the beat's). */
    gesture(who, name, length) {
        const key = `${this.beat}:${who}:${name}`;
        let g = this._gestures.get(key);
        if (!g) {
            g = { name, start: this.beatStart, length };
            this._gestures.set(key, g);
        }
        return g;
    }

    /** A scratch [x, y, z] owned by this run. */
    scratch(i) {
        if (!this._scratch[i]) this._scratch[i] = [0, 0, 0];
        return this._scratch[i];
    }

    has(who) {
        return this.def.who === 'both' || this.def.who === who;
    }
}

/** What a scene asks of one of them this frame (null fields: the story's own wish stands). */
function emptyIntent(o) {
    o.at = null;
    o.face = null;
    o.sit = null;
    o.crouch = null;
    o.kneel = null;
    o.staff = null;
    o.hands = null;
    o.gesture = null;
    o.look = null;
    o.pace = null;
    o.scene = null;
    return o;
}

export class StillwaterLife {
    constructor(seed = 0x5717) {
        this.seed = seed;
        this.troll = emptyIntent({});
        this.spirit = emptyIntent({});
        this.reset(0);
    }

    reset(time = 0, kin = KIN.start) {
        this.time = time;
        this.kin = kin;
        this.draws = 0;
        this.runs = { troll: null, spirit: null };
        this.next = { troll: time + 7, spirit: time + 9, both: time + 16 };
        /** A scene of theirs is due: whoever is free waits (until `until`) for the other. */
        this.waiting = null;
        this.lastScene = { troll: [], spirit: [], both: [] };
        this.lastReflex = time - 100;
        this.wasMeeting = false;
        /** What the scenes set in motion, for the world to take (`drain`). */
        this.events = [];
        /** Every scene begun and how it ended: { name, start, end, how } (the last 32). */
        this.log = [];
        /** Scenes asked for at set times (captures): { name, at }. */
        this.cues = [];
        emptyIntent(this.troll);
        emptyIntent(this.spirit);
    }

    /** A seeded draw, stepped once per call (the n-th draw of a night is always the same). */
    rand() {
        this.draws += 1;
        return mulberry32((this.seed + this.draws * 2654435761) >>> 0)();
    }

    /** They grow nearer by `amount` (never further: the night does not unmake what it made). */
    grow(amount) {
        if (amount > 0) this.kin = Math.min(1, this.kin + amount);
    }

    /** Hand the world something to set in motion. Returns it (a scene may change its length later). */
    emit(event) {
        this.events.push(event);
        return event;
    }

    /** The events set in motion since the world last took them. */
    drain() {
        if (!this.events.length) return null;
        const out = this.events;
        this.events = [];
        return out;
    }

    /** Begin scene `name` at `time` whatever they are doing (captures; a reset forgets it). */
    cue(name, time) {
        if (SCENES[name]) this.cues.push({ name, at: time, done: false });
    }

    /** The scene one of them is in (its name), or null. */
    sceneOf(who) {
        const run = this.runs[who];
        return run ? run.name : null;
    }

    /**
     * Step the life on. `ctx` (the stage's coordinates): { calm, busy, engaged, meet,
     * troll: [x, z], trollMode, trollSpeed, spirit: [x, y, z], spiritMode, lantern, spiritHeart }.
     */
    update(time, dt, ctx) {
        this.time = time;
        ctx.time = time;
        ctx.kin = this.kin;
        if (!ctx.engaged && ctx.calm > SCENE_CALM) this.grow(KIN.calm * Math.max(0, dt));
        // Play takes them: whatever they were doing ends where it stands.
        const stop = ctx.engaged || ctx.busy > SCENE_BUSY;
        if (stop) {
            ['troll', 'spirit'].forEach((who) => {
                if (this.runs[who]) this.end(this.runs[who], time, 'play');
                this.next[who] = Math.max(this.next[who], time + (ctx.engaged ? 8 : 4));
            });
        }
        // Their eyes meet: a reflex, shy or fond by how near they have grown.
        const meeting = Boolean(ctx.meet);
        if (meeting && !this.wasMeeting) {
            this.grow(KIN.meet);
            if (!stop && !this.runs.troll && !this.runs.spirit && time - this.lastReflex > 18) {
                if (this.kin < SHY_BELOW) this.begin('shy', time, ctx);
                else if (this.kin >= FOND_FROM) this.begin('fond', time, ctx);
                this.lastReflex = time;
            }
        }
        this.wasMeeting = meeting;
        for (let i = 0; i < this.cues.length; i++) {
            const cue = this.cues[i];
            if (cue.done || time < cue.at) continue;
            cue.done = true;
            ['troll', 'spirit'].forEach((who) => {
                const other = who === 'troll' ? 'spirit' : 'troll';
                if (this.runs[who] && SCENES[cue.name].who !== other) this.end(this.runs[who], time, 'cued');
            });
            this.begin(cue.name, time, ctx);
        }
        if (!stop && ctx.calm > SCENE_CALM) this.choose(time, ctx);
        this.step(time, ctx);
    }

    /** Begin something new for whoever is free and due. */
    choose(time, ctx) {
        // A scene of theirs comes due now and then (more often as they grow near): from then on
        // whoever is free waits for the other, a while, rather than begin something alone.
        if (!this.waiting && time >= this.next.both) {
            if (this.rand() < 0.4 + 0.45 * this.kin) this.waiting = { until: time + DUET_WAIT };
            else this.next.both = time + 6 + this.rand() * 6;
        }
        if (this.waiting) {
            if (!this.runs.troll && !this.runs.spirit) {
                const name = this.pick('both', ctx);
                this.waiting = null;
                if (name) {
                    this.begin(name, time, ctx);
                    return;
                }
                this.next.both = time + 6 + this.rand() * 6;
            } else if (time > this.waiting.until) {
                this.waiting = null;
                this.next.both = time + 4 + this.rand() * 4;
            } else return;
        }
        const trollFree = !this.runs.troll && time >= this.next.troll;
        const spiritFree = !this.runs.spirit && time >= this.next.spirit;
        if (!trollFree && !spiritFree) return;
        if (trollFree) {
            const name = this.pick('troll', ctx);
            if (name) this.begin(name, time, ctx);
            else this.next.troll = time + 3;
        }
        if (spiritFree && !this.runs.spirit) {
            const name = this.pick('spirit', ctx);
            if (name) this.begin(name, time, ctx);
            else this.next.spirit = time + 3;
        }
    }

    /** Draw a scene for `who` among those that may begin now (never one of the last two again). */
    pick(who, ctx) {
        const names = SCENE_NAMES[who];
        const recent = this.lastScene[who];
        let total = 0;
        const weights = names.map((n) => {
            const s = SCENES[n];
            const [lo, hi] = s.kin || [0, 1];
            const ok = this.kin >= lo && this.kin <= hi && !recent.includes(n) && (!s.may || s.may(ctx));
            const w = ok ? s.weight : 0;
            total += w;
            return w;
        });
        if (!(total > 0)) return null;
        let r = this.rand() * total;
        for (let i = 0; i < names.length; i++) {
            r -= weights[i];
            if (r <= 0 && weights[i] > 0) return names[i];
        }
        return names[weights.findLastIndex((w) => w > 0)];
    }

    begin(name, time, ctx) {
        const run = new Run(name, time, () => this.rand(), ctx);
        const { who } = run.def;
        if (who === 'both' || who === 'troll') this.runs.troll = run;
        if (who === 'both' || who === 'spirit') this.runs.spirit = run;
        if (!run.def.reflex) {
            const recent = this.lastScene[who];
            recent.push(name);
            if (recent.length > 2) recent.shift();
        }
        this.enterBeat(run, 0, time, ctx);
        return run;
    }

    enterBeat(run, index, time, ctx) {
        run.beat = index;
        run.beatStart = time;
        const b = run.def.beats[index];
        if (!b) return;
        run.beatLen = b.lenOf ? b.lenOf(run, ctx) : (b.len ?? 0);
        if (b.enter) b.enter(run, ctx, this, time);
    }

    end(run, time, how = 'done') {
        if (this.runs.troll === run) this.runs.troll = null;
        if (this.runs.spirit === run) this.runs.spirit = null;
        this.log.push({
            name: run.name, start: run.start, end: time, how,
        });
        if (this.log.length > 32) this.log.shift();
        // Every held light a scene began goes out with it.
        if (how !== 'done' && run.vars.carry) run.vars.carry.length = Math.max(0, time - run.vars.carry.start);
        if (how === 'done' && run.def.who === 'both' && !run.def.reflex) this.grow(KIN.duet);
        // A rest after it before the next (a little sooner as they grow near).
        const rest = (who) => time + (who === 'troll' ? 4 : 3) + this.rand() * (who === 'troll' ? 8 : 7);
        if (run.has('troll')) this.next.troll = Math.max(this.next.troll, rest('troll'));
        if (run.has('spirit')) this.next.spirit = Math.max(this.next.spirit, rest('spirit'));
        if (run.def.who === 'both' && !run.def.reflex) {
            this.next.both = Math.max(this.next.both, time + 16 + this.rand() * 18 - this.kin * 8);
        }
    }

    /** Walk each run's beats on and write what it asks of each of them. */
    step(time, ctx) {
        emptyIntent(this.troll);
        emptyIntent(this.spirit);
        const seen = new Set();
        ['troll', 'spirit'].forEach((who) => {
            const run = this.runs[who];
            if (!run || seen.has(run)) return;
            seen.add(run);
            // Beats that are over give way to the next (several in one long frame, if need be).
            for (let guard = 0; guard < 16; guard++) {
                const b = run.def.beats[run.beat];
                if (!b) break;
                const t = time - run.beatStart;
                let over;
                if (b.until) over = b.until(ctx, run, t) || t >= (b.max ?? 8);
                else over = t >= run.beatLen;
                if (!over) break;
                const next = run.beatStart + (b.until ? t : run.beatLen);
                this.enterBeat(run, run.beat + 1, Math.min(time, next), ctx);
            }
            if (run.beat >= run.def.beats.length) {
                this.end(run, time, 'done');
                return;
            }
            const b = run.def.beats[run.beat];
            const t = time - run.beatStart;
            const duet = run.def.who === 'both';
            if (run.has('troll')) {
                this.troll.scene = run.name;
                // (In a scene of theirs, one with nothing to do this beat watches the other.)
                if (b.troll) b.troll(t, ctx, this.troll, run);
                else if (duet) atPartnerT(this.troll, ctx, 0.7);
            }
            if (run.has('spirit')) {
                this.spirit.scene = run.name;
                if (b.spirit) b.spirit(t, ctx, this.spirit, run);
                else if (duet) atPartnerS(this.spirit, ctx, 0.7);
            }
            // Sent somewhere, they go on their feet unless the scene says otherwise; and once a
            // scene has them up, they stay up for the rest of it until it says otherwise.
            if (this.troll.at && this.troll.sit === null) this.troll.sit = false;
            if (this.spirit.at && this.spirit.kneel === null) this.spirit.kneel = false;
            if (run.has('troll')) {
                if (this.troll.sit === null && run.up?.troll) this.troll.sit = false;
                if (this.troll.sit !== null) (run.up || (run.up = {})).troll = this.troll.sit === false;
            }
            if (run.has('spirit')) {
                if (this.spirit.kneel === null && run.up?.spirit) this.spirit.kneel = false;
                if (this.spirit.kneel !== null) (run.up || (run.up = {})).spirit = this.spirit.kneel === false;
            }
        });
    }
}
