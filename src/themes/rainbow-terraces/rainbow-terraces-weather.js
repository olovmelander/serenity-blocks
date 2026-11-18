/**
 * Rainbow Terraces: the air, and what happens in it by itself (CPU only, three-free).
 *
 * The hours (rainbow-terraces-hours.js) turn the LIGHT round its wheel of five. Beside them the AIR
 * turns on a wheel of its own, five airs of AIR_SECONDS each, so the same hour is never seen in the
 * same weather twice in a row (5 hours of 110 s against 5 airs of 96 s: a hundred and ten minutes
 * before a pair comes back at the same phase):
 *
 *   fair      the high country as it was first painted
 *   beams     the clouds behind the eye open: the anticrepuscular rays stand deep in the air and
 *             lie as lanes on the cloud sea, the deck thickens, the isles' wedges darken
 *   showers   the storm wall grows and walks in behind the Spring Isle, its rain thickens, and the
 *             bow comes out in it by itself; the spray rises, the wind freshens
 *   crystal   after the rain: the air washed clear, a deep sky, long mares' tails, the storm only
 *             a rag on the horizon, the far isles crisp
 *   mist      the Deep's mist rises: a milky horizon, the fogbow at its brightest, soft shadows,
 *             the falls' spray hanging, hardly a wind
 *
 * An air is numbers only (multipliers and offsets on the hour's own numbers, and how far a few of
 * the hour's colours lean toward others), so it never rebuilds a shader, and it is mixed as the
 * hours are: resting on an air for AIR_REST of its time at each end, crossing in between.
 *
 * And in every air things HAPPEN by themselves, one every SLOT_SECONDS or so (happeningAt, a pure
 * function of the clock): a skein of the paper birds crosses the far sky, the storm
 * flickers from within, the rays surge, the Mother Fall's plume heaves up with a bow in it, the bow
 * comes out in a passing veil of rain, shooting stars cross the night. Which one a slot holds is
 * drawn from the slot's own number and what the hour and the air allow, so a seek replays it.
 */
import { clamp01, lerp, smooth } from './rainbow-terraces-core.js';

/** The airs in wheel order (each stands beside its opposite: clear after rain, mist after clear). */
export const AIR_NAMES = Object.freeze(['fair', 'beams', 'showers', 'crystal', 'mist']);
/** Seconds one air lasts (480 s the wheel). */
export const AIR_SECONDS = 96;
/** The share of an air, at each end, the weather rests on it. */
export const AIR_REST = 0.22;

const A = AIR_NAMES.length;
const row = (...values) => Object.freeze(values);

/**
 * Every air's numbers (AIR_NAMES order), mixed linearly:
 *   shower   × the hour's storm (its cover, its dark, its rain)
 *   swing    radians the storm wall stands off its place (it walks along the horizon)
 *   deck     × the altocumulus' cover
 *   cirrus   × the high streaks
 *   rays     + the anticrepuscular rays' depth
 *   bow      + how much of the bow stands in the rain by itself (bowRest)
 *   fogbow   + the white ghost on the mist
 *   spray    × the falls' spray
 *   wedge    × how dark the isles' shadows lie on the sea
 *   wind     × how fast every layer of the sky drifts (and the mist's clock with it)
 *   swell    × the cloud sea's relief (it heaves under the storm, lies flat in the mist)
 *   gain     × the key's strength
 *   haze     how far the horizon's colours lean into the mist's (−: washed clear, +: a rising mist)
 *   deepen   how far the zenith darkens toward the storm's slate (showers) or deepens (crystal)
 *   veil     × the stratus veils lying under the horizon (the mist lifts and thickens them)
 *   polar    × the polarised band's depth overhead (clear air shows it, wet air drowns it)
 *   expose   × the lens
 *   glow     + how far the bloom's knee opens (a milky air glows, a storm's does not)
 */
export const AIR_SCALARS = Object.freeze({
    shower: row(1.0, 0.85, 1.45, 0.35, 0.9),
    swing: row(0, 0.025, -0.06, 0.05, 0),
    deck: row(1.0, 1.3, 1.45, 0.25, 0.75),
    cirrus: row(1.0, 0.7, 0.4, 1.45, 0.5),
    rays: row(0, 0.36, 0.1, 0, 0.12),
    bow: row(0, 0.05, 0.26, -0.1, 0.06),
    fogbow: row(0, 0, 0.012, 0, 0.07),
    spray: row(1.0, 1.0, 1.2, 0.9, 1.35),
    wedge: row(1.0, 1.3, 0.8, 1.15, 0.5),
    wind: row(1.0, 0.8, 1.7, 1.25, 0.45),
    swell: row(1.0, 1.05, 1.16, 0.95, 0.78),
    gain: row(1.0, 1.08, 0.8, 1.08, 0.9),
    haze: row(0, 0.15, 0.25, -0.5, 1.0),
    deepen: row(0, 0, 1.0, -0.8, 0.1),
    veil: row(1.0, 0.9, 1.3, 0.3, 2.1),
    polar: row(1.0, 1.0, 0.5, 1.5, 0.4),
    expose: row(1.0, 1.03, 0.92, 1.0, 1.05),
    glow: row(0, 0.12, -0.05, 0, 0.3),
});

const SCALAR_NAMES = Object.freeze(Object.keys(AIR_SCALARS));

const wrap = (place) => ((place % A) + A) % A;

/**
 * The air at a place on its wheel, written into `out` (reused):
 *   { place, from, to, mix, name, scalar: { <name>: n } }
 * @param {number} place any real (the wheel wraps every five)
 * @param {object} [out]
 */
export function airAt(place, out = {}) {
    const p = wrap(Number.isFinite(place) ? place : 0);
    const from = Math.min(A - 1, Math.floor(p));
    const to = (from + 1) % A;
    const mix = smooth(AIR_REST, 1 - AIR_REST, p - from);
    out.place = p;
    out.from = from;
    out.to = to;
    out.mix = mix;
    out.name = AIR_NAMES[mix < 0.5 ? from : to];
    if (!out.scalar) out.scalar = {};
    for (let s = 0; s < SCALAR_NAMES.length; s++) {
        const key = SCALAR_NAMES[s];
        out.scalar[key] = lerp(AIR_SCALARS[key][from], AIR_SCALARS[key][to], mix);
    }
    return out;
}

/** Where the clock alone has turned the air's wheel. */
export function airPlace(clock) {
    return Number.isFinite(clock) ? clock / AIR_SECONDS : 0;
}

/**
 * The air's lean on the hour's colours, in place (`colour` is hourAt's { <row>: [r, g, b] }): a
 * rising mist pours the mist's light into the horizon and the middle sky and lifts the Deep's
 * shade; washed air does the opposite (a horizon nearer the sky's own blue); rain greys the zenith
 * toward the storm's slate, clear air deepens it.
 * @param {object} colour
 * @param {{haze: number, deepen: number}} scalar
 */
export function leanColours(colour, scalar) {
    const { haze, deepen } = scalar;
    const into = (name, target, k) => {
        const c = colour[name];
        if (!c || !target || !(Math.abs(k) > 1e-4)) return;
        c[0] += (target[0] - c[0]) * k;
        c[1] += (target[1] - c[1]) * k;
        c[2] += (target[2] - c[2]) * k;
    };
    if (haze > 0) {
        into('horizon', colour.mistLit, 0.5 * haze);
        into('mid', colour.horizon, 0.42 * haze);
        into('zenith', colour.mid, 0.3 * haze);
        into('mistShade', colour.mistLit, 0.3 * haze);
        into('cloudShade', colour.mistLit, 0.16 * haze);
        into('deep', colour.mistShade, 0.3 * haze);
    } else if (haze < 0) {
        into('horizon', colour.mid, -0.5 * haze);
        into('mid', colour.zenith, -0.3 * haze);
    }
    if (deepen > 0) {
        into('zenith', colour.shower, 0.42 * deepen);
        into('mid', colour.shower, 0.3 * deepen);
        into('horizon', colour.cloudShade, 0.22 * deepen);
        into('cloudShade', colour.shower, 0.3 * deepen);
        into('mistLit', colour.mistShade, 0.2 * deepen);
    } else if (deepen < 0) {
        const z = colour.zenith;
        const k = 1 + 0.32 * deepen;
        z[0] *= k; z[1] *= k * 1.03; z[2] *= Math.min(1, k * 1.12);
    }
}

// ── What happens by itself ──

/** Seconds a slot of the air's happenings lasts; the first one waits `HAPPEN_FIRST`. */
export const SLOT_SECONDS = 31;
export const HAPPEN_FIRST = 14;

/**
 * The happenings: how long each plays (s) and what it needs. `night` 0..1 is the hour's stars,
 * `storm` the storm's cover as the hour and the air leave it (0..~1.2), `rays` whether the tier
 * draws the anticrepuscular rays at all.
 */
export const HAPPENINGS = Object.freeze({
    /** A skein of the paper birds crosses the far sky, edge to edge. */
    flight: Object.freeze({ length: 26, weight: () => 1.0 }),
    /** The rays surge: the clouds behind the eye part, and their shadows stand deep in the air. */
    beams: Object.freeze({ length: 16, weight: (c) => (c.rays ? 1.0 - 0.7 * c.night : 0) }),
    /** The Mother Fall's plume heaves up, a bow standing in it. */
    plume: Object.freeze({ length: 5, weight: () => 0.8 }),
    /** A veil of rain passes behind the leg: the bow comes out by itself, and goes. */
    veil: Object.freeze({ length: 18, weight: (c) => 0.5 + 0.7 * clamp01(c.storm) }),
    /** The storm flickers from within (sheet lightning: slow, soft, far). */
    flicker: Object.freeze({ length: 4, weight: (c) => (c.storm > 0.55 ? 0.5 + 0.9 * c.night : 0) }),
    /** Shooting stars (the night's own). */
    meteors: Object.freeze({ length: 7, weight: (c) => (c.night > 0.5 ? 2.4 : 0) }),
});

const KINDS = Object.freeze(Object.keys(HAPPENINGS));

const frac = (x) => x - Math.floor(x);
/** A slot's own numbers (0..1), by channel. */
export const slotHash = (slot, channel = 0) => frac(Math.sin((slot + 1) * 127.1 + channel * 311.7) * 43758.5453);

/**
 * What the slot holding `time` plays, into `out` (reused):
 *   { slot, kind, at, length, age, env, seed }
 * `at` is when it starts (a few seconds into its slot, each slot its own), `age` seconds since
 * (negative before it starts, past `length` when it is over), `env` 0..1 its slow rise and fall
 * (for the ones that are an air: beams, veil), `seed` 0..1 its own number. `kind` is null in a
 * slot that holds nothing (about one in five rests) and before HAPPEN_FIRST.
 * @param {number} time the world's clock
 * @param {{night: number, storm: number, rays: boolean}} context
 * @param {object} [out]
 */
export function happeningAt(time, context, out = {}) {
    const t = Number.isFinite(time) ? time : 0;
    const slot = Math.floor(Math.max(0, t - HAPPEN_FIRST) / SLOT_SECONDS);
    out.slot = slot;
    out.kind = null;
    out.at = HAPPEN_FIRST + slot * SLOT_SECONDS;
    out.length = 0;
    out.age = -1;
    out.env = 0;
    out.seed = slotHash(slot, 3);
    if (t < HAPPEN_FIRST) return out;
    // One slot in five holds its breath.
    if (slotHash(slot, 1) < 0.2) return out;
    let total = 0;
    for (let k = 0; k < KINDS.length; k++) total += Math.max(0, HAPPENINGS[KINDS[k]].weight(context));
    if (!(total > 0)) return out;
    // Never the same thing twice running: the pick is offset by the slot's parity through the list.
    let pick = slotHash(slot, 2) * total;
    let kind = KINDS[KINDS.length - 1];
    for (let k = 0; k < KINDS.length; k++) {
        const name = KINDS[(k + slot) % KINDS.length];
        const w = Math.max(0, HAPPENINGS[name].weight(context));
        if (pick < w) {
            kind = name;
            break;
        }
        pick -= w;
    }
    const { length } = HAPPENINGS[kind];
    const room = Math.max(0, SLOT_SECONDS - length - 1);
    const at = HAPPEN_FIRST + slot * SLOT_SECONDS + slotHash(slot, 4) * room;
    const age = t - at;
    out.kind = kind;
    out.at = at;
    out.length = length;
    out.age = age;
    const ramp = Math.min(4, length * 0.3);
    out.env = age <= 0 || age >= length ? 0 : smooth(0, ramp, age) * (1 - smooth(length - ramp, length, age));
    return out;
}
