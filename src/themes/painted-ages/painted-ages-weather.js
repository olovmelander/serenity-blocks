/**
 * Painted Ages — the weather: a wheel of airs beside the hours (CPU only, three-free).
 *
 * The hours turn the LIGHT (painted-ages-hours.js, one every 100 s). The airs turn what the light
 * falls through: how much cloud stands overhead and how dark its shadows lie, how thick the haze
 * is, whether mist fills the valleys or dust blows along them, how high the cumulus banks have
 * grown, whether a far shower hangs its curtains in front of the ranges. An air lasts AIR_SECONDS
 * (not a divisor of the hour, so the two wheels drift against each other and an hour is rarely
 * met twice in the same air), rests AIR_HOLD of that time and then melts into the next.
 *
 *   fair      the day as it was before the airs: scattered cloud, soft shadows
 *   towers    the banks boil up to their full height and the deck thins: a sky of great heaps
 *   pools     a broken deck: most of the land in shade, pools of sunlight wandering the stripes
 *   showers   a far shower trails its curtains across one side, a leg of rainbow in them
 *   crystal   the air washed clean: thin haze, deep colours, the snow peaks sharp, cirrus high up
 *   mist      a sea of mist in the valleys, the hills standing out of it as islands
 *   dust      a warm wind: the clouds race, dust blows along the valley floor, the far ranges fade
 *
 * A pure function of the time (a seek lands on the same sky). The clock also schedules the small
 * HAPPENINGS (slots of HAPPENING_SECONDS, one seeded draw each): a meteor in the dark hours, a
 * flicker of lightning inside a far bank, a gust of dust.
 */
import { moodDrift, wheelAt } from '../shared/mood-clock.js';
import {
    clamp, lerp, mulberry32, smooth,
} from './painted-ages-core.js';

export const AIR_SECONDS = 92;
export const AIR_HOLD = 0.4;

/**
 * cover      the deck's cover overhead (0..1; its shadows on the land follow)
 * shade      how much of the sun a cloud's shadow takes
 * haze       factor on the hour's haze density
 * mist       valley-mist density the air adds to the hour's own
 * mistRise   factor on the mist layer's height (a sea of mist stands deeper)
 * dust       0..1: the low layer is warm dust, and the haze warms
 * wind       factor on the deck's drift
 * towers     0..1: how high the cumulus banks have grown
 * virga      0..1: the far shower's curtains
 * cirrus     factor on the high cirrus
 * sat        added to the grade's saturation
 */
export const AIRS = Object.freeze([
    Object.freeze({
        name: 'fair', cover: 0.38, shade: 0.72, haze: 1, mist: 0, mistRise: 1, dust: 0, wind: 1, towers: 0.55, virga: 0, cirrus: 1, sat: 0,
    }),
    Object.freeze({
        name: 'towers', cover: 0.24, shade: 0.74, haze: 0.92, mist: 0, mistRise: 1, dust: 0, wind: 0.7, towers: 1, virga: 0, cirrus: 0.5, sat: 0.02,
    }),
    Object.freeze({
        name: 'pools', cover: 0.6, shade: 0.9, haze: 1.12, mist: 0.05, mistRise: 1, dust: 0, wind: 1.5, towers: 0.7, virga: 0, cirrus: 0.4, sat: 0.03,
    }),
    Object.freeze({
        name: 'showers', cover: 0.5, shade: 0.82, haze: 1.1, mist: 0.1, mistRise: 1.2, dust: 0, wind: 1.25, towers: 0.85, virga: 1, cirrus: 0.3, sat: 0.04,
    }),
    Object.freeze({
        name: 'crystal', cover: 0.14, shade: 0.7, haze: 0.5, mist: 0, mistRise: 0.8, dust: 0, wind: 0.8, towers: 0.3, virga: 0, cirrus: 1.7, sat: 0.07,
    }),
    Object.freeze({
        name: 'mist', cover: 0.2, shade: 0.7, haze: 1.05, mist: 1.0, mistRise: 2.0, dust: 0, wind: 0.5, towers: 0.4, virga: 0, cirrus: 1.1, sat: 0,
    }),
    Object.freeze({
        name: 'dust', cover: 0.3, shade: 0.72, haze: 1.55, mist: 0.75, mistRise: 1.7, dust: 1, wind: 3.2, towers: 0.45, virga: 0, cirrus: 0.8, sat: -0.02,
    }),
]);

export const AIR_COUNT = AIRS.length;
export const AIR_NAMES = Object.freeze(AIRS.map((a) => a.name));
const AIR_KEYS = Object.freeze(['cover', 'shade', 'haze', 'mist', 'mistRise', 'dust', 'wind', 'towers', 'virga', 'cirrus', 'sat']);

export function createAir() {
    const air = {
        place: 0, from: 0, to: 1, mix: 0, name: AIRS[0].name,
    };
    for (const key of AIR_KEYS) air[key] = AIRS[0][key];
    return air;
}

/** The wheel's place by the clock alone: whole airs passed plus the eased melt into the next. */
export function airPlace(time) {
    return moodDrift(time, AIR_SECONDS, AIR_HOLD);
}

const _wheel = { a: 0, b: 0, melt: 0 };

/** The air at a wheel place, written into `out` (allocated once by the caller). */
export function airAt(at, out = createAir()) {
    // (A place that is not a number is the wheel's start: the world reads `place` back.)
    const place = Number.isFinite(at) ? at : 0;
    const w = wheelAt(place, AIR_COUNT, _wheel);
    const a = AIRS[w.a];
    const b = AIRS[w.b];
    for (const key of AIR_KEYS) out[key] = lerp(a[key], b[key], w.melt);
    out.place = place;
    out.from = w.a;
    out.to = w.b;
    out.mix = w.melt;
    out.name = w.melt < 0.5 ? a.name : b.name;
    return out;
}

let driftTo = 0;
let driftSum = 0;
const _drift = createAir();

/**
 * What the weather's winds have added to the deck's drift by `time` (seconds of extra drift):
 * the integral of (wind − 1), summed in one-second steps and carried on from the last call, so a
 * world sought to a time stands under the sky a live run would have reached.
 */
export function airDrift(time) {
    const t = Math.max(0, Math.min(86400, Math.floor(Number(time) || 0)));
    if (t < driftTo) {
        driftTo = 0;
        driftSum = 0;
    }
    while (driftTo < t) {
        driftSum += airAt(airPlace(driftTo + 0.5), _drift).wind - 1;
        driftTo += 1;
    }
    return driftSum;
}

/** The warm dust the wind carries (linear), as a tint the haze and the low layer lean toward. */
export const DUST_TINT = Object.freeze([1.0, 0.7, 0.46]);

/** The showers air's place on the wheel. */
const SHOWERS = AIRS.findIndex((air) => air.name === 'showers');

/**
 * Where the far shower's curtains hang, in radians right of the view axis: one side of the board
 * per visit of the showers air (seeded by the visit), drifting slowly downwind while it lasts.
 * Continuous through the whole visit (it melts in, rests and melts out without a step: the side
 * changes only half a wheel away, where there is no shower to see).
 */
export function virgaBearing(place) {
    const p = Number.isFinite(place) ? place : 0;
    const turns = (p - SHOWERS + AIR_COUNT / 2) / AIR_COUNT;
    const visit = Math.floor(turns);
    // How far the wheel stands from the showers air: -1 melting in … 0 resting … 1 melting out.
    const from = clamp((turns - visit) * AIR_COUNT - AIR_COUNT / 2, -1, 1);
    const side = mulberry32(0x71a9 + visit * 131)() < 0.5 ? -1 : 1;
    return side * (0.4 + 0.04 * from);
}

// ── Happenings ────────────────────────────────────────────────────────────────────

export const HAPPENING_SECONDS = 23;
export const HAPPENINGS = Object.freeze(['meteor', 'flicker', 'gust']);

/**
 * What the slot holding `time` brings, or null: `{ kind, slot, start, seed, age }`. One seeded
 * draw a slot, starting a little into it. The world decides whether the hour allows it (a meteor
 * needs the stars, a flicker a grown bank, a gust the sun).
 */
export function happeningAt(time, out = {}) {
    const t = Math.max(0, Number(time) || 0);
    const slot = Math.floor(t / HAPPENING_SECONDS);
    const random = mulberry32(0x4a99 + slot * 2654435761);
    const draw = random();
    const start = slot * HAPPENING_SECONDS + 2 + random() * (HAPPENING_SECONDS - 12);
    out.slot = slot;
    out.start = start;
    out.seed = random();
    out.side = random() < 0.5 ? -1 : 1;
    out.age = t - start;
    out.kind = HAPPENINGS[Math.min(HAPPENINGS.length - 1, Math.floor(draw * HAPPENINGS.length))];
    return out;
}

/** A bump that rises over `rise` s, holds, and is gone by `life` s (0 outside). */
export function swellOver(age, rise, life) {
    if (!(age > 0) || age >= life) return 0;
    return smooth(0, rise, age) * (1 - smooth(life * 0.55, life, age));
}

export { clamp };
