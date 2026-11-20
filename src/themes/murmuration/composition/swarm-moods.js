/**
 * Murmuration — the flock's moods and the things that happen by themselves (three-free).
 *
 * A murmuration is never one shape for long. The flock used to wheel round the board as the
 * same ring for ever, and only its colours drifted. It now turns through five MOODS on the
 * shared mood clock (src/themes/shared/mood-clock.js): the clock rests on a mood, then melts
 * into the next over a minute, in every mode; a level-up moves it one mood on.
 *
 *   wheel   the ring round the board, as the theme has always opened
 *   wings   the flock parts above and below the board and draws out into two great wings,
 *           each wearing a colour of its own
 *   drift   it gathers to one side as a dense bulb and trails a tail round the board; the
 *           side it favours wanders
 *   gale    fast, frayed and many-coloured: the gyre races, the eddies tear the ribbons
 *   veil    slow, wide and thin: long silk in two neighbouring hues under a bright sky
 *
 * A mood is numbers: the flock's FORM (the simulation's outer wall, see formRadius), how it
 * flows, how its motes are drawn, and what the sky does. `moodAt()` melts two neighbours.
 *
 * HAPPENINGS are what the sky and the flock do unasked: a shooting star (or a shower of them),
 * a GREAT TURN (one fold of light sweeping the whole flock from end to end, the murmuration's
 * own signature), a falcon's stoop through a wing. Their schedule is a pure function of the
 * clock (`happeningAt`), so a seek lands inside the same happening a run would show.
 */
import { easeStep, moodDrift, wheelAt } from '../../shared/mood-clock.js';

/** Seconds a mood lasts when only the clock is turning it, and the share of it the mood rests. */
export const MOOD_SECONDS = 105;
export const MOOD_HOLD = 0.4;

/**
 *   lean / wings   the form's one- and two-lobe weights (0 = a ring)
 *   gyre / turb    multipliers on the gyre's rate and the shear waves
 *   coarse / fine  the two octaves of the flow (the slow weather, the eddies)
 *   tiltX / tiltY  how the disc leans out of the screen plane
 *   stretch        multiplier on the motes' trails
 *   span           fraction of the palette the flock wears at once
 *   turn           how brightly the banking ripple folds
 *   nebula / stars / dusk / violet   the sky: gas, star light, a glow low in the frame, and
 *                  how far the wisps lean to violet
 */
export const MOODS = Object.freeze([
    Object.freeze({
        id: 'wheel',
        lean: 0,
        wings: 0,
        gyre: 1,
        turb: 1,
        coarse: 1,
        fine: 1,
        tiltX: 0.55,
        tiltY: 0.2,
        stretch: 1,
        span: 0.34,
        turn: 1,
        nebula: 1,
        stars: 1,
        dusk: 0.25,
        violet: 0.35,
    }),
    Object.freeze({
        id: 'wings',
        lean: 0.03,
        wings: 0.3,
        gyre: 0.82,
        turb: 0.9,
        coarse: 1.1,
        fine: 0.8,
        tiltX: 0.3,
        tiltY: 0.42,
        stretch: 1.2,
        span: 0.46,
        turn: 1.15,
        nebula: 0.78,
        stars: 1.35,
        dusk: 0.7,
        violet: 0.6,
    }),
    Object.freeze({
        id: 'drift',
        lean: 0.3,
        wings: 0.07,
        gyre: 0.9,
        turb: 1.05,
        coarse: 1.2,
        fine: 0.9,
        tiltX: 0.68,
        tiltY: 0.05,
        stretch: 1.05,
        span: 0.3,
        turn: 1,
        nebula: 1.0,
        stars: 0.9,
        dusk: 0.1,
        violet: 0.85,
    }),
    Object.freeze({
        id: 'gale',
        lean: 0.1,
        wings: 0.12,
        gyre: 1.5,
        turb: 1.3,
        coarse: 1.25,
        fine: 1.45,
        tiltX: 0.62,
        tiltY: -0.12,
        stretch: 1.4,
        span: 0.52,
        turn: 1.4,
        nebula: 0.82,
        stars: 1.1,
        dusk: 0.45,
        violet: 0.2,
    }),
    Object.freeze({
        id: 'veil',
        lean: 0.06,
        wings: 0.16,
        gyre: 0.62,
        turb: 0.8,
        coarse: 0.75,
        fine: 0.6,
        tiltX: 0.4,
        tiltY: 0.3,
        stretch: 1.55,
        span: 0.24,
        turn: 0.85,
        nebula: 1.15,
        stars: 1.5,
        dusk: 0.9,
        violet: 1,
    }),
]);

export const MOOD_KEYS = Object.freeze([
    'lean', 'wings', 'gyre', 'turb', 'coarse', 'fine', 'tiltX', 'tiltY', 'stretch', 'span', 'turn',
    'nebula', 'stars', 'dusk', 'violet',
]);

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The mood at `phase` (whole numbers are pure moods), written into `out` for every MOOD_KEYS key.
 * @param {number} phase @param {Record<string, number>} [out]
 */
export function moodAt(phase, out = {}) {
    wheelAt(phase, MOODS.length, AT);
    const a = MOODS[AT.a];
    const b = MOODS[AT.b];
    for (let i = 0; i < MOOD_KEYS.length; i += 1) {
        const key = MOOD_KEYS[i];
        out[key] = a[key] + (b[key] - a[key]) * AT.melt;
    }
    out.a = AT.a;
    out.b = AT.b;
    out.melt = AT.melt;
    return out;
}

/**
 * The mood phase for a level and a clock: the level's step (eased by the caller through
 * `stepMood`) plus what the clock alone has turned.
 */
export function moodPhase(step, time) {
    return step + moodDrift(time, MOOD_SECONDS, MOOD_HOLD);
}

/** Ease the level's step toward `level - 1` the short way round the wheel (`k` 1 snaps). */
export function stepMood(current, level, k) {
    return easeStep(current, Math.max(0, Math.round(level) - 1), k, MOODS.length);
}

/**
 * The form the simulation is given for a mood at a moment: `out` = [base, c1, s1, c2, s2]
 * (see formRadius in sim/fluid-particles.js). The lean's side wanders round the board; the
 * wings lie along the frame's free axis (beside the board on a wide frame, above and below it
 * on a phone) and sway a little.
 * @param {{ lean: number, wings: number }} mood
 * @param {number} time
 * @param {number} aspect  the frame's width over its height
 * @param {number[]} [out]
 */
export function moodForm(mood, time, aspect = 16 / 9, out = [1, 0, 0, 0, 0]) {
    const lean = Math.max(0, mood.lean);
    const wings = Math.max(0, mood.wings);
    const side = 0.6 + time * 0.031;
    const axis = (aspect < 0.85 ? Math.PI / 2 : 0) + Math.sin(time * 0.047 + 1.3) * 0.16;
    out[0] = 1 - lean - wings;
    out[1] = lean * Math.cos(side);
    out[2] = lean * Math.sin(side);
    out[3] = wings * Math.cos(2 * axis);
    out[4] = wings * Math.sin(2 * axis);
    return out;
}

// ── Happenings ────────────────────────────────────────────────────────────────────────────

/** One happening may fall in each slot of this many seconds. */
export const HAPPENING_SLOT = 41;
/** The round the slots walk: none twice running, the turn and the falcon well apart. */
export const HAPPENING_ROUND = Object.freeze([
    'meteor', 'turn', 'meteor', 'falcon', 'shower', 'turn', 'meteor', 'falcon',
]);
/** Seconds each kind lasts. */
export const HAPPENING_LENGTH = Object.freeze({
    meteor: 1.3, shower: 5.5, turn: 2.8, falcon: 2.8,
});

const hash = (n) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
};

/**
 * The happening whose slot holds `time`: its kind, when it starts (`at`), its length, how far
 * into it the clock is (`age`, negative before it starts) and a number of its own (`seed`,
 * 0..1) for the path it takes. A pure function of the clock.
 * @param {number} time
 * @param {{ slot: number, kind: string, at: number, length: number, age: number, seed: number,
 *   live: boolean }} [out]
 */
export function happeningAt(time, out = {
    slot: 0, kind: 'meteor', at: 0, length: 0, age: 0, seed: 0, live: false,
}) {
    const t = Math.max(0, Number(time) || 0);
    const slot = Math.floor(t / HAPPENING_SLOT);
    const kind = HAPPENING_ROUND[slot % HAPPENING_ROUND.length];
    const length = HAPPENING_LENGTH[kind];
    // It starts a few seconds into its slot, and always ends inside it.
    const room = Math.max(0, HAPPENING_SLOT - length - 5);
    const at = slot * HAPPENING_SLOT + 4 + hash(slot + 0.5) * Math.min(room, 14);
    out.slot = slot;
    out.kind = kind;
    out.at = at;
    out.length = length;
    out.age = t - at;
    out.seed = hash(slot * 3.7 + 9.1);
    out.live = out.age >= 0 && out.age < length;
    return out;
}

/**
 * A shooting star's line for a number 0..1: where it starts and which way it falls, in the
 * sky's tangent-plane units (x right, y up; the frame is about ±0.61 × ±0.34 at 16:9). The
 * flock fills the middle of the frame, so a star starts high beside the board's column and
 * falls outward across the open sky of an upper corner.
 * @param {number} seed @param {number} aspect @param {number[]} [out] [x, y, angle]
 */
export function meteorLine(seed, aspect = 16 / 9, out = [0, 0, 0]) {
    const halfW = 0.344 * Math.max(0.4, aspect);
    const side = hash(seed * 157.31 + 0.77) < 0.5 ? -1 : 1;
    out[0] = side * halfW * (0.12 + hash(seed * 17.9 + 5.5) * 0.4);
    out[1] = 0.344 * (0.72 + hash(seed * 43.1 + 1.1) * 0.3);
    // Outward and down, 12–30 degrees below the horizontal.
    const fall = (12 + hash(seed * 7.7 + 3.3) * 18) * (Math.PI / 180);
    out[2] = side > 0 ? -fall : Math.PI + fall;
    return out;
}

/**
 * The falcon's stoop for a number 0..1 and a share of it done: a straight fast line through one
 * wing of the flock, from above the frame to below it, in world units on the focal plane.
 * `half` is the view's half-size there. `out` = { x, y }
 */
export function falconPath(seed, done, half, out = { x: 0, y: 0 }) {
    const side = hash(seed * 31.3 + 7.1) < 0.5 ? -1 : 1;
    const k = Math.max(0, Math.min(1, done));
    const x0 = side * half.halfWidth * (0.42 + hash(seed * 11.9 + 2.7) * 0.3);
    const lean = side * half.halfWidth * (hash(seed * 77.7 + 0.9) - 0.35) * 0.35;
    out.x = x0 + lean * k;
    out.y = half.halfHeight * (1.25 - 2.5 * k);
    return out;
}
