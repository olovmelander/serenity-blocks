/**
 * Parhelion weather: what turns by the clock beside the Lower Sun's walk, so the plain never
 * stands in one look for long. Three-free, DOM-free and a pure function of the time (a seek, a
 * replay and a rebuild that carries the clock all land on the same air).
 *
 * THE NIGHT. The Lower Sun walks out to the late golden sun and back (parhelion-optics-state.js,
 * LOWER_SUN_WALK). On the way back the sun goes under: the display becomes a paraselene, the
 * same 22° ring and its two dogs round a hidden MOON, over blue snow and under stars. nightOf()
 * is that night on the walk's own axis (0 at noon, 1 the golden sun, 2 noon again): it rises
 * after the golden stop, rests on the stop half way back and lifts before noon, so a level
 * (a step along the same walk) reaches it too. duskOf() is the afterglow on either side of it.
 *
 * THE AIRS. A second wheel of five airs, AIR_SECONDS each, of a length with no small common
 * multiple with the walk's 400 s (2 h 20 min before a pair repeats in phase). Each air is a row
 * of numbers the optics state multiplies into what the hour already shows, and each has two
 * things only it has: clear (the display as designed), cirrus (mares' tails streaming, the ring
 * broken into bright arcs, mother-of-pearl cloud at dusk), crystal (the air full of diamond
 * dust, shafts of light round the stone, a tall sun pillar), drift (a ground blizzard: spindrift
 * racing over the plain, the far stones half veiled) and fog (ice fog lifting off the plain, the
 * ring soft in a wide glow). Phase 0 is the old look, exactly.
 *
 * THE HAPPENINGS. Every HAPPENING_SECONDS one small thing happens by itself, picked by a hash of
 * its slot: a gust, a glint running round the ring, a hound flaring, a shimmer falling through
 * the dust, a flush on the far range. happeningAt() is the whole schedule as a closed form; the
 * optics state arms each on its OWN start, never on the frame that noticed it (gotcha #1742).
 */
import { moodDrift, wheelAt } from '../../shared/mood-clock.js';

/** Seconds an air lasts, and the share of it it rests before melting into the next. */
export const AIR_SECONDS = 84;
export const AIR_HOLD = 0.4;

/** The wheel's order: neighbours are opposites (sky, air, ground, air, sky). */
export const AIR_NAMES = Object.freeze(['clear', 'cirrus', 'crystal', 'drift', 'fog']);

/**
 * What an air is. Multipliers are 1 at rest, additions 0:
 *   veil      the cirrostratus fibres' light (×)
 *   fog       how far the ice fog lifts off the plain (0..1)
 *   drift     the blowing snow's strength (×)
 *   glow      a soft glow round the ring and the hounds (ice fog scatters them; 0..1)
 *   rays      shafts of light round the stone (0..1)
 *   density   more (or fewer) crystals in the air (+)
 *   dust      the crystals' glitter (×)
 *   pillar    the sun pillar's height of light (+)
 *   halo      the ring's and the hounds' own light (×)
 *   nacre     mother-of-pearl cloud in the afterglow (0..1)
 *   veilRate, driftRate, dustRate   the three clocks' rates (×)
 *   warm      the air's lean in the grade (−1 a blue-grey cold, +1 gold)
 *   sat       the frame's saturation (× : a ground blizzard and ice fog are pale)
 */
export const AIR_FIELDS = Object.freeze([
    'veil', 'fog', 'drift', 'glow', 'rays', 'density', 'dust', 'pillar', 'halo', 'nacre',
    'veilRate', 'driftRate', 'dustRate', 'warm', 'sat',
]);

function air(veil, fog, drift, glow, rays, density, dust, pillar, halo, nacre, veilRate, driftRate, dustRate, warm, sat) {
    return Object.freeze({
        veil, fog, drift, glow, rays, density, dust, pillar, halo, nacre, veilRate, driftRate, dustRate, warm, sat,
    });
}

/* eslint-disable no-multi-spaces, key-spacing */
export const AIRS = Object.freeze({
    //            veil  fog   drift glow  rays  dens   dust  pill  halo  nacre vRate dRate uRate warm  sat
    clear:   air(1.0,  0.0,  1.0,  0.0,  0.0,  0.0,   1.0,  0.0,  1.0,  0.4,  1.0,  1.0,  1.0,  0.0,  1.0),
    cirrus:  air(3.0,  0.08, 0.7,  0.2,  0.1,  -0.12, 0.8,  0.0,  1.15, 1.0,  3.4,  0.8,  0.9,  0.15, 1.05),
    crystal: air(0.55, 0.14, 0.55, 0.3,  0.55, 0.4,   2.0,  0.7,  1.08, 0.2,  0.6,  0.6,  0.7,  0.7,  1.1),
    drift:   air(0.8,  0.6,  3.4,  0.25, 0.14, 0.14,  1.3,  0.1,  0.92, 0.15, 1.6,  2.6,  1.7,  -0.8, 0.8),
    fog:     air(0.35, 1.0,  0.4,  1.0,  0.3,  0.08,  1.1,  0.3,  0.8,  0.0,  0.5,  0.5,  0.6,  -0.25, 0.68),
});
/* eslint-enable no-multi-spaces, key-spacing */

const AIR_LIST = AIR_NAMES.map((name) => AIRS[name]);
const WHEEL = { a: 0, b: 0, melt: 0 };

/** A fresh row for airAt() to write into (the rest air). */
export function createAir() {
    return {
        ...AIRS.clear, index: 0, next: 0, melt: 0,
    };
}

/**
 * The air at `time`: the row it rests on, melting into the next. A `pin` holds one air
 * (a capture's `?parhelionAir=`): its row, exactly.
 * @param {number} time seconds on the theme clock
 * @param {ReturnType<typeof createAir>} [out]
 * @param {number} [pin] an air's index to hold, or −1 for the clock
 */
export function airAt(time, out = createAir(), pin = -1) {
    const phase = pin >= 0 ? pin : moodDrift(time, AIR_SECONDS, AIR_HOLD);
    wheelAt(phase, AIR_LIST.length, WHEEL);
    const a = AIR_LIST[WHEEL.a];
    const b = AIR_LIST[WHEEL.b];
    const k = WHEEL.melt;
    for (let i = 0; i < AIR_FIELDS.length; i++) {
        const key = AIR_FIELDS[i];
        out[key] = a[key] + (b[key] - a[key]) * k;
    }
    out.index = WHEEL.a;
    out.next = WHEEL.b;
    out.melt = k;
    return out;
}

// ---------------------------------------------------------------------------------------
// The night on the Lower Sun's walk
// ---------------------------------------------------------------------------------------

function smoothstep(e0, e1, x) {
    const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return u * u * (3 - 2 * u);
}

/**
 * Where the night lies on the walk (0 noon, 1 the golden sun, 2 noon again): falling from
 * `fall` to `deep`, lifting from `lift` to `day`. The stop half way back (1.5) is the moon's.
 */
export const NIGHT_WALK = Object.freeze({
    fall: 1.1, deep: 1.4, lift: 1.6, day: 1.9,
});

/**
 * The night (0 day, 1 the moonlit night) at a place on the walk.
 * @param {number} walk the walk's axis, any real (folded onto 0..2)
 */
export function nightOf(walk) {
    const x = (((Number.isFinite(walk) ? walk : 0) % 2) + 2) % 2;
    const n = NIGHT_WALK;
    return smoothstep(n.fall, n.deep, x) * (1 - smoothstep(n.lift, n.day, x));
}

/**
 * The afterglow (0..1) a night of `night` leaves on the horizon: none by day, none in the deep
 * night, most half way between (dusk on the way in, dawn on the way out).
 * @param {number} night
 */
export function duskOf(night) {
    const n = Math.min(1, Math.max(0, night));
    return 4 * n * (1 - n);
}

// ---------------------------------------------------------------------------------------
// Happenings
// ---------------------------------------------------------------------------------------

/** One happening a slot; it starts a few seconds into it and lasts `length`. */
export const HAPPENING_SECONDS = 37;
export const HAPPENING_KINDS = Object.freeze(['gust', 'glint', 'hound', 'shimmer', 'flush']);
const HAPPENING_LENGTH = Object.freeze({
    gust: 9, glint: 3, hound: 7, shimmer: 5, flush: 10,
});

function hash01(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
}

/** A fresh result for happeningAt(). */
export function createHappening() {
    return {
        slot: -1, kind: '', kindIndex: -1, at: 0, length: 0, age: -1, live: false, side: 1,
    };
}

/**
 * The happening of the slot `time` stands in. Pure: the same time gives the same answer.
 * The first slot is quiet (a theme opens at rest), and a kind never follows itself.
 * @param {number} time
 * @param {ReturnType<typeof createHappening>} [out]
 */
export function happeningAt(time, out = createHappening()) {
    const t = Math.max(0, Number(time) || 0);
    const slot = Math.floor(t / HAPPENING_SECONDS);
    out.slot = slot;
    const count = HAPPENING_KINDS.length;
    let index = Math.floor(hash01(slot) * count) % count;
    if (slot > 0) {
        const before = Math.floor(hash01(slot - 1) * count) % count;
        if (index === before) index = (index + 1 + Math.floor(hash01(slot + 0.5) * (count - 1))) % count;
    }
    out.kindIndex = slot === 0 ? -1 : index;
    out.kind = slot === 0 ? '' : HAPPENING_KINDS[index];
    out.length = slot === 0 ? 0 : HAPPENING_LENGTH[out.kind];
    out.at = slot * HAPPENING_SECONDS + 5 + hash01(slot + 0.25) * (HAPPENING_SECONDS - 5 - 12);
    out.side = hash01(slot + 0.75) < 0.5 ? -1 : 1;
    out.age = t - out.at;
    out.live = slot > 0 && out.age >= 0 && out.age < out.length;
    return out;
}
