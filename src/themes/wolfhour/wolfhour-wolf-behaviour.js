/**
 * What each of Wolfhour's wolves is doing, moment by moment (CPU only, three-free).
 *
 * Every wolf lives through a sequence of slots of its own length. Each slot draws one action from
 * the wolf's repertoire with a deterministic hash of the slot's index, so the behaviour is a pure
 * function of time: a seek or a capture lands on the same frame. An action returns pose
 * parameters for wolfhour-wolf-rig.js (head, turn, jaw, crouch, lift, pitch, reach, tail...), its
 * posture (`sit` and `down`, carried from the last slot's posture into this one's the way a wolf
 * moves: haunches first to sit, forequarters first to get up, forepaws walking out to lie down),
 * an offset along the ridge with a facing and gait for actions that move, a turn (`yaw`) whenever
 * it changes direction (it turns round through a view of its face, stepping, rather than
 * flipping), and bursts of snow for the moments that throw it (a shake, a pounce, digging).
 *
 * Actions: idle, look (the head turns toward the viewer, sometimes with a curious tilt), yawn,
 * shake (snow flies off the coat), stretch (a play bow, then the hind legs stretched out behind),
 * sit, lie (and rest the head), rise, scratch (sitting, a hind paw at the neck), lookBack (over
 * the shoulder), alert (ears up, a forepaw raised), circle (round once, then lie down), pace (a
 * little way along the ridge and back), pounce (turn, stalk, leap, dive nose-first into the snow,
 * shake it off, turn and walk back), dig (snow thrown back between the legs) and play (a bow, a
 * wagging tail, hops and a spin).
 */

const smooth = (t) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
};
const mix = (a, b, w) => a + (b - a) * w;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

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

/**
 * The distance covered `t` seconds into a walk of `distance` at `speed` that speeds up and slows
 * down over `ramp` seconds at each end (it takes distance / speed + ramp seconds in all).
 */
export function glide(t, distance, speed, ramp = 0.45) {
    const total = distance / speed + ramp;
    if (t <= 0) return 0;
    if (t >= total) return distance;
    if (t < ramp) return (speed * t * t) / (2 * ramp);
    if (t > total - ramp) return distance - (speed * (total - t) ** 2) / (2 * ramp);
    return speed * (t - ramp / 2);
}

/**
 * How fast that walk is going `t` seconds in, as a share of `speed` (0 standing, 1 at speed). A
 * wolf speeding up or slowing down keeps its cadence and shortens its stride, so the gait reads
 * its phase from the time walked (`walked`, distance at full speed) and its stride from this.
 */
export function glidePace(t, distance, speed, ramp = 0.45) {
    const total = distance / speed + ramp;
    if (t <= 0 || t >= total) return 0;
    return Math.min(1, t / ramp, (total - t) / ramp);
}

/** The young wolf's walks (pack units, seconds): pacing and the walk home after a pounce. */
export const YOUNG_MOVES = Object.freeze({
    pace: 18, walkSpeed: 7.5, leap: 26, leapHeight: 22,
});

/** A turn round on the spot (seconds); a wolf steps twice as it goes. */
export const TURN = 0.9;

/** The pounce's timing (seconds from the start of the action): turn, stalk, leap, dive, turn home. */
export const POUNCE = Object.freeze({
    stalk: TURN, leap: 2.4, land: 3.3, up: 5.1, home: 5.3, creep: 2,
});

/**
 * Each wolf's slot length (seconds), the posture it returns to, the way it faces at home (+1
 * along the ridge, -1 back) and its repertoire: action names with weights. The lead is dignified,
 * the sitter and the far wolf restful, the young one busy.
 */
export const REPERTOIRES = Object.freeze({
    lead: Object.freeze({
        slot: 12,
        home: 'standing',
        facing: -1,
        seed: 11,
        actions: Object.freeze([
            ['idle', 2.6], ['look', 2.2], ['yawn', 1], ['shake', 1], ['sit', 1.3], ['stretch', 1.1],
            ['alert', 1.2], ['lookBack', 1], ['circle', 0.8], ['scratch', 0.7],
        ]),
    }),
    sitter: Object.freeze({
        slot: 14,
        home: 'sitting',
        facing: -1,
        seed: 23,
        actions: Object.freeze([
            ['idle', 2.6], ['lie', 3.2], ['look', 1.6], ['yawn', 1], ['rise', 1], ['scratch', 1],
        ]),
    }),
    young: Object.freeze({
        slot: 11,
        home: 'standing',
        facing: -1,
        seed: 37,
        actions: Object.freeze([
            ['pace', 3], ['pounce', 3], ['play', 2], ['dig', 1.6], ['look', 1], ['shake', 1],
            ['lookBack', 0.8], ['scratch', 0.6],
        ]),
    }),
    answer: Object.freeze({
        slot: 15,
        home: 'sitting',
        facing: 1,
        seed: 53,
        actions: Object.freeze([['idle', 3.2], ['lie', 3], ['look', 2], ['yawn', 1], ['scratch', 0.8]]),
    }),
});

/** Under Reduce motion these actions do not play: the wolves still look, yawn, sit, lie and howl. */
export const LIVELY = Object.freeze([
    'pace', 'pounce', 'play', 'shake', 'stretch', 'rise', 'scratch', 'circle', 'dig',
]);

/** The action a wolf draws for slot `index` (`still`: Reduce motion, the lively ones are idle). */
export function actionFor(role, index, still = false) {
    const book = REPERTOIRES[role];
    if (!book) return 'idle';
    // A wolf's first slot after the theme starts is always calm.
    if (index <= 0) return 'idle';
    const total = book.actions.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = draw(index, book.seed) * total;
    let name = book.actions[0][0];
    for (const [action, weight] of book.actions) {
        roll -= weight;
        if (roll < 0) {
            name = action;
            break;
        }
    }
    return still && LIVELY.includes(name) ? 'idle' : name;
}

/** The posture an action holds for its slot. */
function postureOf(role, action) {
    const { home } = REPERTOIRES[role];
    if (action === 'sit' || action === 'scratch') return 'sitting';
    if (action === 'lie' || action === 'circle') return 'lying';
    if (action === 'rise') return 'standing';
    return home;
}

/** Postures as (sit, down); as in wolfhour-wolf-rig.js. */
const POSTURE = Object.freeze({
    standing: Object.freeze({ sit: 0, down: 0 }),
    sitting: Object.freeze({ sit: 1, down: 0 }),
    lying: Object.freeze({ sit: 1, down: 1 }),
});

/**
 * How a wolf moves from one posture to another (seconds): when the haunches (`sit`) and the
 * forequarters (`down`) start to move and for how long. It sits down haunches first; it lies down
 * from standing by sitting and then walking its forepaws out; it gets up forequarters first.
 */
export function postureMove(from, to) {
    const a = POSTURE[from] ?? POSTURE.standing;
    const b = POSTURE[to] ?? POSTURE.standing;
    const sitDown = b.sit > a.sit;
    const getUp = b.down < a.down;
    const sit = { at: b.sit < a.sit && getUp ? 0.7 : 0, dur: sitDown ? 1 : 0.8 };
    const down = { at: b.down > a.down && sitDown ? 0.7 : 0, dur: b.down > a.down ? 1.6 : 1 };
    const end = Math.max(
        a.sit !== b.sit ? sit.at + sit.dur : 0,
        a.down !== b.down ? down.at + down.dur : 0,
    );
    return {
        a, b, sit, down, end,
    };
}

/**
 * Posture `u` seconds into a move from `from` to `to`, into `pose`: `sit`, `down`, and while the
 * forequarters go down or up, each forepaw's own progress and lift (two steps each, the far paw a
 * little after the near one). Returns the move's length.
 */
function postureAt(pose, from, to, u) {
    const move = postureMove(from, to);
    const { a, b } = move;
    pose.sit = mix(a.sit, b.sit, smooth((u - move.sit.at) / move.sit.dur));
    const pd = (u - move.down.at) / move.down.dur;
    pose.down = mix(a.down, b.down, smooth(pd));
    if (a.down !== b.down) {
        pose.foreDown = [];
        pose.foreLift = [];
        for (const lag of [0, 0.2]) {
            let done = 0;
            let lift = 0;
            for (const k of [0, 0.5]) {
                const local = (pd - k - lag) / 0.3;
                done += smooth(local) / 2;
                if (local > 0 && local < 1) lift = Math.sin(local * Math.PI) * 1.6;
            }
            pose.foreDown.push(mix(a.down, b.down, done));
            pose.foreLift.push(lift);
        }
    }
    pose.blend = move.end > 0 ? clamp01(u / move.end) : 1;
    return move.end;
}

/** A pose with nothing happening: the rest values every action starts from. */
function restPose(role) {
    const book = REPERTOIRES[role];
    const home = book?.home ?? 'standing';
    return {
        posture: home,
        from: home,
        blend: 1,
        sit: POSTURE[home].sit,
        down: POSTURE[home].down,
        foreDown: null,
        foreLift: null,
        dx: 0,
        facing: null,
        yaw: 0,
        step: 0,
        stepHeight: 0,
        travel: 0,
        walked: 0,
        pace: 0,
        moving: false,
        head: 0,
        turn: 0,
        headYaw: 0,
        neckYaw: 0,
        roll: 0,
        jaw: 0,
        ears: 0,
        earA: 0,
        earB: 0,
        crouch: 0,
        lift: 0,
        pitch: 0,
        tuck: 0,
        reach: 0,
        hindReach: 0,
        pawUp: 0,
        scratch: 0,
        scratchPhase: 0,
        dig: 0,
        digPhase: 0,
        tail: null,
        tailUp: 0,
        eyesClosed: 0,
        wag: 0,
        shake: 0,
        busy: false,
        bursts: [],
    };
}

/**
 * A turn round on the spot, `at` seconds in, from facing `from` to facing `-from`: the yaw swings
 * through half a circle (`dir` +1 through a view of its face, -1 of its back) as it steps twice.
 */
function turnRound(pose, u, at, from, dir = 1) {
    if (u < at) {
        pose.facing = from;
        return;
    }
    if (u >= at + TURN) {
        pose.facing = -from;
        return;
    }
    const f = (u - at) / TURN;
    pose.facing = from;
    pose.yaw = dir * Math.PI * smooth(f);
    pose.step = f * 2;
    pose.stepHeight = 1.8 * Math.sin(f * Math.PI);
    pose.head -= 5 * Math.sin(f * Math.PI);
}

/** Walking from `from` to `to` (pack units along the ridge) from `at`; true while it walks. */
function walkAlong(pose, u, at, from, to, speed) {
    const distance = Math.abs(to - from);
    const d = glide(u - at, distance, speed);
    const total = distance / speed + 0.45;
    pose.dx = from + Math.sign(to - from) * d;
    if (u < at || u > at + total) return false;
    Object.assign(pose, {
        facing: Math.sign(to - from),
        travel: d,
        walked: speed * (u - at),
        pace: glidePace(u - at, distance, speed),
        moving: true,
    });
    // A walking wolf carries its head a little low and level.
    pose.head -= 5;
    return true;
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

/** A look at the viewer, with a curious tilt one way and then the other when `curious`. */
function lookAt(pose, u, from, to, amount, curious) {
    const e = span(u, from, to, 0.6);
    pose.turn = Math.max(pose.turn, amount * e);
    pose.head += 4 * e;
    pose.ears -= 6 * e;
    if (curious) {
        const mid = (from + to) / 2;
        pose.roll += 0.38 * span(u, from + 0.8, mid, 0.3) - 0.3 * span(u, mid + 0.2, to - 0.6, 0.3);
        pose.ears -= 4 * e;
    }
    return e;
}

/**
 * The actions, each `(pose, u, ctx)` with `u` the seconds since the action could begin (once the
 * slot's posture move is done) and `ctx` the slot (`index`, `slot`, `home`, `facing`, `t`: the
 * seconds since the slot began, `from`).
 */
const ACTIONS = {
    idle() {},
    sit() {},
    look(pose, u, { index, book }) {
        lookAt(pose, u, 0.6, 4.8, book.home === 'sitting' ? 0.72 : 0.88, draw(index, book.seed + 9) < 0.55);
    },
    yawn(pose, u) {
        const e = span(u, 1.2, 3.1, 0.55);
        pose.jaw = 34 * e;
        pose.head += 22 * e;
        pose.ears += 14 * e;
        pose.eyesClosed = e;
    },
    shake(pose, u) {
        shakeAt(pose, u, 1.8);
    },
    stretch(pose, u) {
        // A bow, then the weight comes forward and the hind legs stretch out behind.
        bowAt(pose, u, 0.6, 3);
        const e = span(u, 2.8, 5.2, 0.6);
        pose.hindReach += 6.5 * e;
        pose.pitch += 0.12 * e;
        pose.crouch += 2.4 * e;
        pose.head += 14 * e;
        pose.reach -= 1 * e;
        pose.jaw += 5 * e;
    },
    rise(pose, u) {
        // Up from sitting, a shake, and down again at the next slot.
        shakeAt(pose, u, 3.4);
    },
    lie(pose, u, { book, t }) {
        // Lying down, it rests its head on its forelegs for a while, then looks up again.
        const rest = span(t, 3.5, book.slot - 2.5, 1.2);
        pose.head -= 38 * rest;
        pose.eyesClosed = rest * 0.8;
    },
    circle(pose, u, ctx) {
        const { book, from, t } = ctx;
        if (from !== 'standing') {
            ACTIONS.lie(pose, u, ctx);
            return;
        }
        // Round once on the spot, nose to the ground, then down.
        const home = book.facing;
        turnRound(pose, u, 0.3, home, 1);
        if (u >= 0.3 + TURN) turnRound(pose, u, 0.3 + TURN, -home, -1);
        pose.head -= 18 * span(u, 0.2, 2.3, 0.4);
        const rest = span(t, 5.5, book.slot - 2.5, 1.2);
        pose.head -= 38 * rest;
        pose.eyesClosed = rest * 0.8;
    },
    scratch(pose, u) {
        // Sitting, the near hind paw comes up to the neck and scratches in three bursts, the head
        // turned and tilted into it, eyes half shut.
        const e = span(u, 0.3, 4.6, 0.4);
        const bursts = [[0.7, 1.7], [2, 2.9], [3.2, 4.1]];
        const scratching = bursts.reduce((sum, [a, b]) => sum + Math.min(Math.max(u - a, 0), b - a), 0);
        const on = bursts.some(([a, b]) => u > a && u < b) ? 1 : 0;
        pose.scratch = e;
        pose.scratchPhase = scratching * Math.PI * 2 * 6.5;
        pose.head -= 30 * e;
        pose.turn = Math.max(pose.turn, 0.5 * e);
        pose.roll += 0.7 * e;
        pose.eyesClosed = Math.max(pose.eyesClosed, 0.75 * e);
        pose.jaw += 3 * e * on;
        pose.ears += 8 * e;
        pose.pitch -= 0.06 * e;
    },
    lookBack(pose, u, { index, book }) {
        // Something behind it: the head swings round over the shoulder, ears turned to the sound.
        const e = span(u, 0.8, 4, 0.7);
        const side = draw(index, book.seed + 5) < 0.6 ? 1 : -1;
        pose.headYaw += 2.9 * side * e;
        pose.neckYaw += 1.2 * side * e;
        pose.head += 30 * e;
        pose.ears += 6 * e;
        pose.earA -= 10 * e;
    },
    alert(pose, u) {
        // Ears up, head high, a forepaw raised, listening; a glance to one side.
        const e = span(u, 0.6, 4.8, 0.5);
        pose.head += 10 * e;
        pose.ears -= 10 * e;
        pose.tailUp = Math.max(pose.tailUp, 0.25 * e);
        pose.pawUp = span(u, 1.2, 4.2, 0.35);
        pose.turn = Math.max(pose.turn, 0.3 * span(u, 2.2, 3.4, 0.3));
    },
    pace(pose, u, { book }) {
        // Turn, a little way along the ridge, a sniff at something, turn and back.
        const { pace, walkSpeed } = YOUNG_MOVES;
        const home = book.facing;
        const walk = pace / walkSpeed + 0.45;
        const back = 1.1 + walk + 1.3;
        turnRound(pose, u, 0.2, home, 1);
        if (walkAlong(pose, u, 1.1, 0, pace, walkSpeed)) return;
        if (u < back) {
            if (u > 1.1) {
                pose.facing = -home;
                pose.dx = pace;
                pose.head -= 24 * span(u, 1.1 + walk, back, 0.4);
            }
            return;
        }
        turnRound(pose, u, back, -home, 1);
        if (u >= back + TURN) walkAlong(pose, u, back + TURN, pace, 0, walkSpeed);
        else pose.dx = pace;
    },
    pounce(pose, u, { book }) {
        const { leap, leapHeight, walkSpeed } = YOUNG_MOVES;
        const home = book.facing;
        const {
            stalk, leap: jump, land, up, home: back, creep,
        } = POUNCE;
        turnRound(pose, u, 0, home, 1);
        if (u < stalk) return;
        if (u < jump) {
            // Stalk: it has heard something under the snow. Low, still, ears forward, creeping;
            // then the spring: the forequarters rise and the head comes up into the leap.
            const e = smooth((u - stalk) / 0.5);
            const spring = smooth((u - (jump - 0.3)) / 0.3);
            pose.dx = creep * smooth((u - stalk) / (jump - stalk));
            pose.crouch += 4.5 * e;
            pose.head += mix(-16 * e, 8, spring);
            pose.ears -= 10 * e * (1 - spring);
            pose.pitch += 0.38 * spring;
            pose.busy = u > jump - 0.6;
        } else if (u < land) {
            // The leap: up in an arc, forelegs reaching, nose turning down for the dive.
            const f = (u - jump) / (land - jump);
            const arc = Math.sin(Math.PI * f);
            const far = leap - creep;
            pose.dx = creep + far * smooth(f) * 0.96 + far * 0.04 * f;
            pose.lift = leapHeight * arc;
            pose.tuck = Math.sin(Math.PI * Math.min(1, f * 1.15));
            pose.pitch += 0.38 - 1.18 * f;
            pose.head += 8 - 46 * f;
            pose.crouch += 4.5 * (1 - smooth(f * 4));
            pose.tailUp = 0.6 * arc;
            pose.busy = true;
        } else if (u < up) {
            // Nose in the snow (the legs take the landing), then up again, shaking it off.
            const g = smooth((u - land) / 0.7);
            pose.dx = leap;
            pose.pitch -= 0.8 * (1 - g);
            pose.crouch += 3.5 * smooth((u - land) / 0.15) * (1 - g);
            pose.head -= 40 * (1 - g);
            pose.busy = true;
            pose.bursts.push({
                at: land, x: 14, y: 1, count: 16, kind: 'plume',
            });
            shakeAt(pose, u, land + 0.65);
        } else if (u < back + TURN) {
            pose.dx = leap;
            turnRound(pose, u, back, -home, 1);
        } else {
            // And back to its place.
            pose.facing = home;
            walkAlong(pose, u, back + TURN, leap, 0, walkSpeed);
        }
    },
    dig(pose, u) {
        // A scent in the snow: a sniff, a burst of digging (snow flies back between the legs),
        // the nose down the hole, nothing there, a shake.
        pose.head -= 28 * span(u, 0.2, 1.2, 0.3);
        const e = span(u, 1, 3.6, 0.25);
        pose.dig = e;
        pose.digPhase = Math.max(0, u - 1) * Math.PI * 2 * 3.2;
        pose.crouch += 1.5 * e;
        pose.pitch -= 0.12 * e;
        pose.head -= 22 * e;
        pose.ears -= 6 * e;
        pose.tailUp = Math.max(pose.tailUp, 0.4 * e);
        pose.wag = Math.max(pose.wag, 0.3 * e);
        for (let k = 0; k < 5; k++) {
            pose.bursts.push({
                at: 1.2 + k * 0.5, x: -2, y: 3, count: 6, kind: 'spray',
            });
        }
        const nose = span(u, 3.6, 4.6, 0.3);
        pose.head -= 40 * nose;
        pose.pitch -= 0.3 * nose;
        pose.crouch += 2.5 * nose;
        shakeAt(pose, u, 5);
    },
    play(pose, u, { book }) {
        // A bow to the pack, a wagging tail, two little hops and a spin.
        const e = bowAt(pose, u, 0.3, 2.7);
        const hops = span(u, 2.5, 4.1, 0.15);
        pose.lift += hops * Math.abs(Math.sin((u - 2.5) * Math.PI * 1.25)) * 5;
        pose.tailUp = Math.max(pose.tailUp, hops);
        pose.wag = Math.max(pose.wag, hops, e);
        const home = book.facing;
        if (u > 4.2) {
            const spin = 0.8;
            const f = Math.min(1, (u - 4.2) / (spin * 2));
            pose.facing = f < 0.5 ? home : -home;
            const half = f < 0.5 ? f * 2 : f * 2 - 1;
            pose.yaw = (f < 0.5 ? 1 : -1) * Math.PI * smooth(half);
            if (f >= 1) {
                pose.facing = home;
                pose.yaw = 0;
            }
            pose.step = f * 3;
            pose.stepHeight = 2.4 * Math.sin(f * Math.PI);
            pose.lift += Math.abs(Math.sin(f * Math.PI * 2)) * 2.5;
        }
        const spun = span(u, 4, 5.8, 0.3);
        pose.tailUp = Math.max(pose.tailUp, spun);
        pose.wag = Math.max(pose.wag, spun);
    },
};

/**
 * What `role` is doing at `clock` seconds of its own life. Returns pose parameters, the posture
 * (`sit`, `down`; `from` and `posture` name the move it is in), its offset along the ridge (pack
 * units), its facing (+1 along the ridge, -1 back; null at home) and turn (`yaw`), and snow bursts
 * (`at` in seconds since the slot began, `x`, `y` in its rig frame). `still` (Reduce motion)
 * leaves the lively actions out.
 */
export function behaviourAt(role, clock, { still = false } = {}) {
    const book = REPERTOIRES[role];
    const pose = restPose(role);
    if (!book || !Number.isFinite(clock) || clock < 0) return pose;
    const index = Math.floor(clock / book.slot);
    const t = clock - index * book.slot;
    const action = actionFor(role, index, still);
    pose.action = action;
    pose.u = t;
    // Posture: from the last slot's into this one's at the start of the slot (circling first
    // turns round, then lies down).
    const from = postureOf(role, actionFor(role, index - 1, still));
    const to = postureOf(role, action);
    pose.from = from;
    pose.posture = to;
    const delay = action === 'circle' && from === 'standing' ? 0.3 + TURN * 2 : 0;
    const ready = postureAt(pose, from, to, t - delay);
    const begin = delay > 0 ? 0 : ready;
    ACTIONS[action]?.(pose, t - begin, {
        book, index, from, t,
    });
    // Burst times are kept in the slot's clock.
    if (begin > 0) for (const burst of pose.bursts) burst.at += begin;
    return pose;
}

/** Whether `role` is too busy (in the air, mid-hunt) to join a howl that begins at `clock`. */
export function busyAt(role, clock) {
    return behaviourAt(role, clock).busy === true;
}
