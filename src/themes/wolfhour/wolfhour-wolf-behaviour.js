/**
 * What each of Wolfhour's wolves is doing, moment by moment (CPU only, three-free).
 *
 * Every wolf lives through a sequence of slots of its own length. Each slot draws one action from
 * the wolf's repertoire with a deterministic hash of the slot's index, so the behaviour is a pure
 * function of time: a seek or a capture lands on the same frame. An action returns pose
 * parameters for wolfhour-wolf-rig.js (head, turn, jaw, crouch, lift, pitch, reach, tail...), a
 * posture (standing, sitting, lying) that the wolf blends into at the start of the slot, an offset
 * along the ridge with a facing and gait for actions that move, and bursts of snow for the moments
 * that throw it (a shake, a pounce's landing).
 *
 * Actions: idle, look (the head turns toward the viewer), yawn, shake (snow flies off the coat),
 * stretch (a play bow), sit, lie (and rest the head), pace (a little way along the ridge and back),
 * pounce (stalk, leap, dive nose-first into the snow, shake it off, walk back), and play (a bow,
 * a wagging tail and two little hops).
 */

const smooth = (t) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
};

/** 1 between `from` and `to`, easing in and out over `ramp` seconds at each end. */
function span(u, from, to, ramp) {
    return Math.min(smooth((u - from) / ramp), 1 - smooth((u - (to - ramp)) / ramp));
}

/** A small integer hash to 0..1, for drawing a slot's action. */
function draw(index, seed) {
    let h = Math.imul(index + 0x9e37, 0x85ebca6b) ^ Math.imul(seed + 0x27d4, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** The young wolf's walks (pack units, seconds): pacing and the walk home after a pounce. */
export const YOUNG_MOVES = Object.freeze({
    pace: 18, walkSpeed: 7, leap: 26, leapHeight: 22,
});

/**
 * Each wolf's slot length (seconds), the posture it returns to, and its repertoire: action names
 * with weights. The lead is dignified, the sitter and the far wolf restful, the young one busy.
 */
export const REPERTOIRES = Object.freeze({
    lead: Object.freeze({
        slot: 12,
        home: 'standing',
        seed: 11,
        actions: Object.freeze([
            ['idle', 3], ['look', 2.2], ['yawn', 1.1], ['shake', 1.1], ['sit', 1.4], ['stretch', 1.2],
        ]),
    }),
    sitter: Object.freeze({
        slot: 14,
        home: 'sitting',
        seed: 23,
        actions: Object.freeze([['idle', 3], ['lie', 3.4], ['look', 1.6], ['yawn', 1], ['rise', 1]]),
    }),
    young: Object.freeze({
        slot: 10,
        home: 'standing',
        seed: 37,
        actions: Object.freeze([['pace', 3], ['pounce', 3], ['play', 2], ['look', 1], ['shake', 1]]),
    }),
    answer: Object.freeze({
        slot: 15,
        home: 'sitting',
        seed: 53,
        actions: Object.freeze([['idle', 3.5], ['lie', 3], ['look', 2], ['yawn', 1]]),
    }),
});

/** The action a wolf draws for slot `index`. */
export function actionFor(role, index) {
    const book = REPERTOIRES[role];
    if (!book) return 'idle';
    // A wolf's first slot after the theme starts is always calm.
    if (index <= 0) return 'idle';
    const total = book.actions.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = draw(index, book.seed) * total;
    for (const [name, weight] of book.actions) {
        roll -= weight;
        if (roll < 0) return name;
    }
    return book.actions[0][0];
}

/** The posture an action holds for its slot. */
function postureOf(role, action) {
    const { home } = REPERTOIRES[role];
    if (action === 'sit') return 'sitting';
    if (action === 'lie') return 'lying';
    if (action === 'rise') return 'standing';
    return home;
}

/** A pose with nothing happening: the rest values every action starts from. */
function restPose(role) {
    return {
        posture: REPERTOIRES[role]?.home ?? 'standing',
        from: REPERTOIRES[role]?.home ?? 'standing',
        blend: 1,
        dx: 0,
        facing: null,
        travel: 0,
        moving: false,
        head: 0,
        turn: 0,
        jaw: 0,
        ears: 0,
        crouch: 0,
        lift: 0,
        pitch: 0,
        tuck: 0,
        reach: 0,
        tail: null,
        tailUp: 0,
        eyesClosed: 0,
        wag: 0,
        shake: 0,
        busy: false,
        bursts: [],
    };
}

/** A shake: the coat shivers, the ears flap, snow flies off in a ring. */
function shakeAt(pose, u, at, x = -2, y = 18) {
    const s = span(u, at, at + 1.3, 0.18);
    pose.shake = s;
    pose.pitch += Math.sin(u * 46) * 0.07 * s;
    pose.crouch += 0.9 * s;
    pose.ears += 12 * s;
    pose.wag = Math.max(pose.wag, s);
    pose.bursts.push({
        at: at + 0.25, x, y, count: 12, kind: 'ring',
    });
}

/** A play bow: forequarters down, rump up, tail high and waving. */
function bowAt(pose, u, from, to) {
    const e = span(u, from, to, 0.7);
    pose.reach += 7 * e;
    pose.pitch -= 0.3 * e;
    pose.crouch += 2 * e;
    pose.tailUp = Math.max(pose.tailUp, e);
    pose.wag = Math.max(pose.wag, e);
    pose.head += 8 * e;
    return e;
}

/**
 * What `role` is doing at `clock` seconds of its own life. Returns pose parameters, the posture it
 * blends from and into, its offset along the ridge (pack units, in its walking direction), and
 * snow bursts (`at` in the same clock, `x`, `y` in its rig frame).
 */
export function behaviourAt(role, clock) {
    const book = REPERTOIRES[role];
    const pose = restPose(role);
    if (!book || !Number.isFinite(clock) || clock < 0) return pose;
    const index = Math.floor(clock / book.slot);
    const u = clock - index * book.slot;
    const action = actionFor(role, index);
    pose.action = action;
    pose.u = u;
    // Posture: blend from the last slot's into this one's over its first second and a bit.
    pose.from = postureOf(role, actionFor(role, index - 1));
    pose.posture = postureOf(role, action);
    pose.blend = pose.from === pose.posture ? 1 : smooth(u / 1.3);

    switch (action) {
    case 'look': {
        const e = span(u, 1.4, 5.6, 0.6);
        pose.turn = (book.home === 'sitting' ? 0.72 : 0.88) * e;
        pose.head += 4 * e;
        pose.ears -= 6 * e;
        break;
    }
    case 'yawn': {
        const e = span(u, 2, 3.9, 0.55);
        pose.jaw = 34 * e;
        pose.head += 22 * e;
        pose.ears += 14 * e;
        pose.eyesClosed = e;
        break;
    }
    case 'shake':
        shakeAt(pose, u, 2.6);
        break;
    case 'stretch':
        bowAt(pose, u, 1.6, 4.8);
        break;
    case 'rise':
        // Up from sitting, a shake, and down again at the next slot.
        shakeAt(pose, u, 4.2);
        break;
    case 'lie': {
        // Lying down, it rests its head on its forelegs for a while, then looks up again.
        const rest = span(u, 3.5, book.slot - 2.5, 1.2);
        pose.head -= 38 * rest;
        pose.eyesClosed = rest * 0.8;
        break;
    }
    case 'pace': {
        const { pace, walkSpeed } = YOUNG_MOVES;
        const walk = pace / walkSpeed;
        if (u < 0.5) break;
        const v = u - 0.5;
        if (v < walk) {
            const d = v * walkSpeed;
            Object.assign(pose, {
                dx: d, facing: 1, travel: d, moving: true,
            });
        } else if (v < walk + 2) {
            Object.assign(pose, { dx: pace, facing: 1 });
            pose.head += 6;
        } else if (v < walk * 2 + 2) {
            const d = (v - walk - 2) * walkSpeed;
            Object.assign(pose, {
                dx: pace - d, facing: -1, travel: d, moving: true,
            });
        }
        break;
    }
    case 'pounce': {
        const { leap, leapHeight, walkSpeed } = YOUNG_MOVES;
        pose.facing = 1;
        if (u < 2.2) {
            // Stalk: it has heard something under the snow. Low, still, ears forward.
            const e = span(u, 0.3, 2.6, 0.5);
            pose.crouch += 4.5 * e;
            pose.head -= 16 * e;
            pose.ears -= 10 * e;
            pose.busy = u > 1.6;
        } else if (u < 3.1) {
            // The leap: up in an arc, forelegs reaching, nose turning down for the dive.
            const f = (u - 2.2) / 0.9;
            const arc = Math.sin(Math.PI * f);
            pose.dx = leap * smooth(f) * 0.96 + leap * 0.04 * f;
            pose.lift = leapHeight * arc;
            pose.tuck = Math.sin(Math.PI * Math.min(1, f * 1.15));
            pose.pitch += 0.38 - 1.18 * f;
            pose.head += 8 - 46 * f;
            pose.crouch += 4.5 * (1 - smooth(f * 4));
            pose.tailUp = 0.6 * arc;
            pose.busy = true;
        } else if (u < 4.9) {
            // Nose in the snow, then up again, shaking it off.
            const g = smooth((u - 3.1) / 0.7);
            pose.dx = leap;
            pose.pitch -= 0.62 * (1 - g);
            pose.crouch += 3.5 * (1 - g);
            pose.head -= 40 * (1 - g);
            pose.busy = true;
            pose.bursts.push({
                at: 3.1, x: 14, y: 1, count: 16, kind: 'plume',
            });
            shakeAt(pose, u, 3.75);
        } else {
            // And back to its place.
            const d = Math.min(leap, (u - 4.9) * walkSpeed);
            Object.assign(pose, {
                dx: leap - d, facing: -1, travel: d, moving: d < leap,
            });
        }
        break;
    }
    case 'play': {
        const e = bowAt(pose, u, 0.5, 2.9);
        const hops = span(u, 2.7, 4.3, 0.15);
        pose.lift += hops * Math.abs(Math.sin((u - 2.7) * Math.PI * 1.25)) * 5;
        pose.tailUp = Math.max(pose.tailUp, hops);
        pose.wag = Math.max(pose.wag, hops, e);
        pose.facing = u > 0.4 && u < 4.4 ? 1 : null;
        break;
    }
    default:
        break;
    }
    return pose;
}

/** Whether `role` is too busy (in the air, mid-hunt) to join a howl that begins at `clock`. */
export function busyAt(role, clock) {
    return behaviourAt(role, clock).busy === true;
}
