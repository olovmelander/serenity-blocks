/**
 * Koi Pond — the nights the pond passes through (CPU only, three-free).
 *
 * The pond is not one night but six, standing on a wheel: the jade night it was built as, a
 * frost moon, a night of blossom, the rose hour, a harvest moon, the moss after rain. Each has
 * its own moon, its own water, its own leaves on the old maple and its own lilies.
 *
 * Two things turn the wheel. A new level steps it one night on. And by itself, level or no
 * level, the clock carries it one night every MOOD_DRIFT seconds, resting on each for a while
 * before it moves on. Both are places on the same wheel, so they simply add.
 *
 * The nights are ordered by the hue of their water, so every neighbouring pair mixes through a
 * colour and never through grey. The maple does not mix at all: its leaves turn one by one
 * (koi-pond-garden.js), so its colours are free to follow the seasons instead.
 */
import { smooth } from './koi-pond-core.js';

/**
 * moon        moonlight (scene-linear, brightest channel 1)
 * sky         the night above: ambient on everything in the air, and what the water mirrors low
 * zenith      what the water mirrors straight overhead
 * water       ambient under the surface
 * scatter     what a depth of this water gives back: the colour of the pond's body
 * absorb      what a metre of it takes out of light, per channel
 * lantern     the flame in the stone lantern
 * petal       the water lilies, deep and pale
 * firefly     the lights over the water
 * gradeMul    the lens: what the picture's shadows are multiplied by, and lifted by
 * leafA       the maple's leaves, three stops from the shaded heart of a leaf to its lit tip
 * leafB       the minority that has turned differently, the same three stops
 */
export const KOI_POND_MOODS = Object.freeze([
    Object.freeze({
        name: 'jade night',
        moon: [0.62, 0.78, 1.0],
        sky: [0.034, 0.058, 0.098],
        zenith: [0.008, 0.016, 0.04],
        water: [0.011, 0.044, 0.052],
        scatter: [0.004, 0.03, 0.036],
        absorb: [0.42, 0.11, 0.09],
        lantern: [1.0, 0.56, 0.2],
        petal: [0.9, 0.36, 0.48],
        petalPale: [0.95, 0.62, 0.7],
        firefly: [0.62, 1.0, 0.22],
        gradeMul: [0.9, 1.02, 1.06],
        gradeLift: [0.0008, 0.0026, 0.0032],
        leafA: [[0.13, 0.004, 0.006], [0.46, 0.014, 0.01], [0.72, 0.12, 0.012]],
        leafB: [[0.05, 0.11, 0.015], [0.3, 0.3, 0.025], [0.72, 0.4, 0.03]],
    }),
    Object.freeze({
        name: 'frost moon',
        moon: [0.8, 0.88, 1.0],
        sky: [0.03, 0.044, 0.115],
        zenith: [0.008, 0.012, 0.05],
        water: [0.012, 0.03, 0.075],
        scatter: [0.006, 0.017, 0.056],
        absorb: [0.42, 0.2, 0.07],
        lantern: [1.0, 0.58, 0.22],
        petal: [0.6, 0.72, 0.95],
        petalPale: [0.86, 0.9, 0.98],
        firefly: [0.55, 0.9, 1.0],
        gradeMul: [0.9, 0.98, 1.1],
        gradeLift: [0.0008, 0.0018, 0.0042],
        leafA: [[0.05, 0.065, 0.11], [0.17, 0.22, 0.33], [0.42, 0.5, 0.64]],
        leafB: [[0.045, 0.05, 0.12], [0.16, 0.16, 0.36], [0.4, 0.38, 0.62]],
    }),
    Object.freeze({
        name: 'blossom night',
        moon: [0.86, 0.76, 1.0],
        sky: [0.05, 0.04, 0.105],
        zenith: [0.014, 0.01, 0.046],
        water: [0.032, 0.022, 0.07],
        scatter: [0.022, 0.011, 0.05],
        absorb: [0.2, 0.34, 0.08],
        lantern: [1.0, 0.56, 0.24],
        petal: [0.72, 0.42, 0.92],
        petalPale: [0.9, 0.74, 0.96],
        firefly: [1.0, 0.84, 0.45],
        gradeMul: [1.0, 0.95, 1.08],
        gradeLift: [0.0024, 0.0012, 0.0036],
        leafA: [[0.16, 0.025, 0.06], [0.48, 0.13, 0.22], [0.8, 0.42, 0.5]],
        leafB: [[0.18, 0.09, 0.12], [0.5, 0.33, 0.38], [0.82, 0.68, 0.7]],
    }),
    Object.freeze({
        name: 'rose hour',
        moon: [1.0, 0.78, 0.8],
        sky: [0.08, 0.04, 0.072],
        zenith: [0.028, 0.012, 0.04],
        water: [0.05, 0.02, 0.044],
        scatter: [0.038, 0.009, 0.03],
        absorb: [0.13, 0.36, 0.12],
        lantern: [1.0, 0.52, 0.22],
        petal: [0.95, 0.26, 0.42],
        petalPale: [0.98, 0.56, 0.66],
        firefly: [0.72, 1.0, 0.32],
        gradeMul: [1.05, 0.96, 1.03],
        gradeLift: [0.0028, 0.0012, 0.0026],
        leafA: [[0.02, 0.06, 0.012], [0.08, 0.25, 0.03], [0.3, 0.52, 0.06]],
        leafB: [[0.05, 0.09, 0.01], [0.22, 0.34, 0.03], [0.52, 0.6, 0.09]],
    }),
    Object.freeze({
        name: 'harvest moon',
        moon: [1.0, 0.82, 0.52],
        sky: [0.085, 0.058, 0.026],
        zenith: [0.03, 0.02, 0.012],
        water: [0.044, 0.03, 0.012],
        scatter: [0.028, 0.018, 0.006],
        absorb: [0.08, 0.19, 0.42],
        lantern: [1.0, 0.5, 0.16],
        petal: [0.96, 0.7, 0.3],
        petalPale: [0.98, 0.88, 0.66],
        firefly: [1.0, 0.7, 0.2],
        gradeMul: [1.06, 1.0, 0.9],
        gradeLift: [0.003, 0.002, 0.0008],
        leafA: [[0.13, 0.065, 0.006], [0.44, 0.25, 0.02], [0.78, 0.55, 0.06]],
        leafB: [[0.12, 0.03, 0.005], [0.44, 0.13, 0.012], [0.76, 0.34, 0.03]],
    }),
    Object.freeze({
        name: 'moss rain',
        moon: [0.72, 1.0, 0.84],
        sky: [0.03, 0.075, 0.05],
        zenith: [0.008, 0.026, 0.02],
        water: [0.012, 0.055, 0.03],
        scatter: [0.006, 0.04, 0.02],
        absorb: [0.4, 0.08, 0.2],
        lantern: [1.0, 0.56, 0.2],
        petal: [0.78, 0.94, 0.76],
        petalPale: [0.95, 0.98, 0.9],
        firefly: [0.4, 1.0, 0.42],
        gradeMul: [0.92, 1.05, 1.0],
        gradeLift: [0.0008, 0.003, 0.002],
        leafA: [[0.14, 0.022, 0.004], [0.5, 0.1, 0.01], [0.82, 0.34, 0.02]],
        leafB: [[0.05, 0.1, 0.012], [0.28, 0.32, 0.03], [0.66, 0.56, 0.05]],
    }),
]);

/** The colours of a night that mix with the next night's. */
export const MOOD_KEYS = Object.freeze([
    'moon', 'sky', 'zenith', 'water', 'scatter', 'absorb', 'lantern', 'petal', 'petalPale', 'firefly',
    'gradeMul', 'gradeLift',
]);
/** The maple's two ramps: handed over whole, a night's and the next night's, and never mixed. */
export const LEAF_KEYS = Object.freeze(['leafA', 'leafB']);
/** Stops in a leaf ramp. */
export const LEAF_STOPS = 3;

/** Seconds the pond takes to drift from one night to the next by itself. */
export const MOOD_DRIFT = 90;
/** The share of a step spent resting on a night before leaving it, and again on reaching the next. */
export const MOOD_REST = 0.2;
/** How fast a new level's step is taken (1/s): about three seconds from one night to the next. */
export const MOOD_TURN = 0.55;

/**
 * Where the pond stands on the wheel for a level and a clock: the level's place (a new level
 * is one step on) plus how far the clock has carried it.
 */
export function moodPhase(level, time) {
    const step = Number.isFinite(level) ? Math.max(0, Math.round(level) - 1) : 0;
    const drift = Number.isFinite(time) ? Math.max(0, time) / MOOD_DRIFT : 0;
    return step + drift;
}

/**
 * The two nights a phase lies between and how far it has gone from the first to the second
 * (0..1). The pond rests on each night before it moves on.
 */
export function moodMix(phase, out = {}) {
    const o = out;
    const n = KOI_POND_MOODS.length;
    const p = Number.isFinite(phase) ? Math.max(0, phase) : 0;
    const whole = Math.floor(p);
    o.from = whole % n;
    o.to = (whole + 1) % n;
    o.mix = smooth(MOOD_REST, 1 - MOOD_REST, p - whole);
    return o;
}

/**
 * The pond's light at a phase, written into `out`: every mixing colour of the two nights it
 * lies between, plus `from`, `to` and `mix` for what turns leaf by leaf.
 */
export function moodAt(phase, out = {}) {
    const o = out;
    moodMix(phase, o);
    const a = KOI_POND_MOODS[o.from];
    const b = KOI_POND_MOODS[o.to];
    for (let i = 0; i < MOOD_KEYS.length; i += 1) {
        const key = MOOD_KEYS[i];
        const colour = o[key] || (o[key] = [0, 0, 0]);
        for (let c = 0; c < 3; c += 1) colour[c] = a[key][c] + (b[key][c] - a[key][c]) * o.mix;
    }
    return o;
}

/**
 * Ease the level's place on the wheel toward where `level` stands, the short way round, by `k`
 * (1 snaps). What is eased is the PLACE, never the colours: a new level's night arrives through
 * the same mixes the drift passes, and at rest the pond is a pure function of the clock.
 */
export function turnToward(place, level, k) {
    const n = KOI_POND_MOODS.length;
    const asked = Number.isFinite(level) ? Math.max(0, Math.round(level) - 1) : 0;
    const want = asked % n;
    if (k >= 1 || !Number.isFinite(place)) return want;
    let gap = want - place;
    gap -= Math.round(gap / n) * n;
    // Settled: exactly on the place, so the drift alone moves the light from here.
    if (Math.abs(gap) < 1e-4) return want;
    return (((place + gap * k) % n) + n) % n;
}

/**
 * How much moonlight is left a metre down, as the exponent the shaders use: what the water
 * absorbs, plus what any water takes.
 */
export function sinkOf(absorb, out = [0, 0, 0]) {
    const o = out;
    for (let c = 0; c < 3; c += 1) o[c] = absorb[c] * 1.032 + 0.0865;
    return o;
}
