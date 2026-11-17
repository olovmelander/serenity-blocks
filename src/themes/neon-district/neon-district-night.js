/**
 * Neon District — the night's weather (CPU only, three-free).
 *
 * The district never looks the same for long. Beside the palettes the clock turns
 * (neon-district-world.js: districtDrift), the weather over the canyon turns on a clock of its
 * own, WEATHER_PERIOD seconds round. The two periods share no small multiple, so a given palette
 * meets a given weather again only after hours.
 *
 *   rain      today's look, where every night starts: steady rain, the street running wet
 *   downpour  it comes down hard and leans in the wind, the smog thickens, sheet lightning walks
 *   easing    the rain thins, the first gaps open in the smog
 *   clear     the rain stops: the air is washed clean, the far street stands sharp and deep,
 *             the smog parts over the moon and a few stars, the neon burns its most saturated
 *   fog       a bank of fog rolls down the canyon: everything past the near shops dissolves,
 *             every lamp and sign wears a wide halo, the fog itself glows warm with the city
 *   mizzle    the fog lifts into a fine rain, and the night comes round to rain again
 *
 * Each state is held for most of its span and then melts into the next. Everything here is a
 * pure function of the time, so a seek and a replay agree. Play pushes the weather on top (hot
 * play brings the downpour whatever the clock says, a perfect clear's crown opens the sky): the
 * world adds that.
 */

import { smooth } from './neon-district-core.js';

/**
 * The states, in order. `span` seconds each; `fall` how hard the rain falls (1 = today's rain),
 * `wind` how far it leans (0..1), `fog` the haze's density (1 = today's), `sky` how far the smog
 * has parted (0..1), `storm` how readily sheet lightning walks (0..1), `mist` how bright the
 * street-level mist glows, `warm` how far the mist turns to the amber of lit fog (0..1), `tint`
 * what the grade multiplies the shadows by, `sat` the grade's saturation.
 */
export const WEATHER = Object.freeze([
    {
        name: 'rain', span: 84, fall: 1, wind: 0.12, fog: 1, sky: 0, storm: 0.25, mist: 1, warm: 0, tint: [0.86, 0.97, 1.16], sat: 1.12,
    },
    {
        name: 'downpour', span: 72, fall: 1.65, wind: 1, fog: 1.4, sky: 0, storm: 1, mist: 0.9, warm: 0, tint: [0.8, 0.95, 1.22], sat: 1.03,
    },
    {
        name: 'easing', span: 46, fall: 0.5, wind: 0.3, fog: 1, sky: 0.3, storm: 0.1, mist: 1, warm: 0.05, tint: [0.86, 0.96, 1.18], sat: 1.12,
    },
    {
        name: 'clear', span: 108, fall: 0, wind: 0.04, fog: 0.6, sky: 1, storm: 0, mist: 0.7, warm: 0, tint: [0.8, 0.9, 1.3], sat: 1.26,
    },
    {
        name: 'fog', span: 92, fall: 0.1, wind: 0, fog: 2.7, sky: 0.06, storm: 0, mist: 1.75, warm: 1, tint: [1.12, 0.97, 0.98], sat: 1.02,
    },
    {
        name: 'mizzle', span: 68, fall: 0.4, wind: 0.06, fog: 1.6, sky: 0, storm: 0, mist: 1.3, warm: 0.45, tint: [0.96, 0.97, 1.08], sat: 1.08,
    },
]);

/** Seconds the weather takes to come round. */
export const WEATHER_PERIOD = WEATHER.reduce((sum, state) => sum + state.span, 0);

/** The share of a state's span over which it melts into the next (the rest of it is held). */
export const WEATHER_MELT = 0.34;

const KEYS = Object.freeze(['fall', 'wind', 'fog', 'sky', 'storm', 'mist', 'warm', 'sat']);

/** A blank reading (what weatherAt fills in). */
export const createWeather = () => ({
    name: WEATHER[0].name, index: 0, melt: 0, fall: 1, wind: 0, fog: 1, sky: 0, storm: 0, mist: 1, warm: 0, sat: 1.12, tint: [0.86, 0.97, 1.16],
});

/**
 * The weather at `time`: the state it is in (`name`, `index`), how far that has melted into the
 * next (`melt` 0..1), and every number of WEATHER blended between the two.
 * @param {number} time
 * @param {object} [out]
 */
export function weatherAt(time, out = createWeather()) {
    let t = ((time % WEATHER_PERIOD) + WEATHER_PERIOD) % WEATHER_PERIOD;
    let index = 0;
    while (index < WEATHER.length - 1 && t >= WEATHER[index].span) {
        t -= WEATHER[index].span;
        index += 1;
    }
    const from = WEATHER[index];
    const to = WEATHER[(index + 1) % WEATHER.length];
    const melt = smooth(1 - WEATHER_MELT, 1, t / from.span);
    out.name = from.name;
    out.index = index;
    out.melt = melt;
    for (let i = 0; i < KEYS.length; i++) {
        const key = KEYS[i];
        out[key] = from[key] + (to[key] - from[key]) * melt;
    }
    for (let c = 0; c < 3; c++) out.tint[c] = from.tint[c] + (to.tint[c] - from.tint[c]) * melt;
    return out;
}

/** The time at which state `name` is first seen pure (for captures and tests). */
export function weatherTime(name) {
    let at = 0;
    for (let i = 0; i < WEATHER.length; i++) {
        if (WEATHER[i].name === name) return at + WEATHER[i].span * 0.3;
        at += WEATHER[i].span;
    }
    return 0;
}

// ── Passers-by ──────────────────────────────────────────────────────────────────

/**
 * Now and then something flies down the street past the camera, low between the walls: a cab,
 * a patrol with its lights turning, a freighter hung with lamps, a string of courier drones.
 * One every FLYBY_BEAT seconds or so; which, on which side, how high and which way are drawn
 * from the beat's number, so no two in a row are alike.
 */
export const FLYBY_BEAT = 27;
/** Seconds a passer-by takes from one end of its run to the other. */
export const FLYBY_SPAN = 7.5;
/** Its run along the street (metres ahead of the camera: from behind it to deep in the haze). */
export const FLYBY_RUN = Object.freeze([-22, 120]);

export const FLYBY_KINDS = Object.freeze([
    {
        name: 'cab', length: 5.2, height: 1.7, lamp: [1.0, 0.74, 0.3], glow: [1.0, 0.62, 0.22], light: 0.55,
    },
    {
        name: 'patrol', length: 5.8, height: 1.8, lamp: [0.75, 0.86, 1.0], glow: [0.3, 0.45, 1.0], light: 0.8,
    },
    {
        name: 'freighter', length: 12, height: 3.2, lamp: [1.0, 0.5, 0.2], glow: [1.0, 0.45, 0.16], light: 0.7,
    },
    {
        name: 'couriers', length: 9, height: 1.2, lamp: [0.4, 1.0, 0.8], glow: [0.25, 1.0, 0.7], light: 0.45,
    },
]);

const hash = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return x - Math.floor(x);
};

/** The kinds in the order a hand of them is dealt: every kind once, shuffled by the hand's number. */
function flybyHand(hand) {
    const order = FLYBY_KINDS.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(hash(hand * 13.7 + i * 3.3 + 0.5) * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

/**
 * Which kind of passer-by beat `beat` sends: every kind once in each hand of FLYBY_KINDS.length
 * beats, and never the kind of the beat before (a hand that would open with the last one's
 * closing kind opens with its second instead).
 */
export function flybyKind(beat) {
    const n = FLYBY_KINDS.length;
    const hand = Math.floor(beat / n);
    const order = flybyHand(hand);
    const closing = flybyHand(hand - 1)[n - 1];
    if (order[0] === closing) [order[0], order[1]] = [order[1], order[0]];
    return order[((beat % n) + n) % n];
}

/** A blank passer-by (what flybyAt fills in). */
export const createFlyby = () => ({
    live: false, kind: 0, side: -1, dir: 1, x: 0, y: 8, depth: 0, beat: 0, fade: 0,
});

/**
 * The passer-by at `time`, if one is in the street: its kind (index into FLYBY_KINDS), which
 * side of the street it keeps to, which way it flies (+1 away up the street, −1 toward the
 * camera), where it is (`x`, `y`, `depth` metres ahead of the camera) and how lit (`fade` 0..1).
 */
export function flybyAt(time, out = createFlyby()) {
    const beat = Math.floor(time / FLYBY_BEAT);
    // Each beat starts its passer-by at a moment of its own (never on the beat).
    const start = beat * FLYBY_BEAT + 2 + hash(beat * 3.1 + 0.7) * (FLYBY_BEAT - FLYBY_SPAN - 4);
    const age = time - start;
    out.beat = beat;
    out.live = age >= 0 && age <= FLYBY_SPAN;
    if (!out.live) {
        out.fade = 0;
        return out;
    }
    out.kind = flybyKind(beat);
    out.side = hash(beat * 2.7 + 5.3) < 0.5 ? -1 : 1;
    out.dir = hash(beat * 5.9 + 2.2) < 0.55 ? 1 : -1;
    const k = age / FLYBY_SPAN;
    const run = out.dir > 0 ? k : 1 - k;
    // Quick past the camera, slower into the distance (a constant speed, seen in perspective,
    // would spend its whole run as a dot far off).
    out.depth = FLYBY_RUN[0] + (FLYBY_RUN[1] - FLYBY_RUN[0]) * run ** 1.7;
    out.x = out.side * (4.4 + hash(beat * 1.3 + 8.8) * 2.4);
    out.y = 4.4 + hash(beat * 9.1 + 4.4) * 3.4 + Math.sin(age * 1.3 + beat) * 0.25;
    out.fade = smooth(0, 0.5, age) * (1 - smooth(FLYBY_SPAN - 0.8, FLYBY_SPAN, age));
    return out;
}
