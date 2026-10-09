/**
 * Waves — the hours: the light the wave is seen in (CPU only, three-free).
 *
 * The wave is the same wave all day; what changes is the hour. Six of them stand on a wheel in
 * the order a day runs, which is also the order of their hues, so no two neighbours mix through
 * grey: golden hour, sunset, afterglow, moonrise, first light, the trade-wind day, and round
 * again to golden hour.
 *
 * Where the light stands on the wheel is one number, the place:
 *
 *     place = (level − 1) + clock / HOUR_SECONDS
 *
 * so a new level turns it one whole hour (eased while the set wave runs through the tube) and
 * the clock turns it by itself, slowly, in every mode — the ones that never level included.
 * Both simply add. Within an hour the light rests on that hour's own colours for a share of the
 * time at each end (HOUR_REST) and crosses to the next in between, so the six named looks are
 * really seen and everything between them is a mix of two neighbours.
 *
 * Every colour is scene-linear. An hour's sky and water are written out in full; what the
 * shaders had as golden-hour constants (the light inside the water, the fire on a cloud's edge,
 * a drop's spark) is kept as written and multiplied by the hour's tints, which are all 1 at
 * golden hour: that hour is the picture the theme was built to.
 */
import { lerp, smooth } from './waves-core.js';

/** Seconds of the world's clock one hour lasts when no level turns it. */
export const HOUR_SECONDS = 100;
/** The share of an hour, at each end, the light rests on that hour's own colours. */
export const HOUR_REST = 0.15;
/** A set wave takes this long to run the length of the tube; a level's hour turns with it. */
export const SET_SECONDS = 3.4;

/**
 * An hour's colours, in the order of the uniform rows the shaders read:
 *   horizonSun, horizonFar   the sky's lowest band, toward the sun and away from it
 *   beltSun, beltFar         the band over it
 *   zenithSun, zenithFar     overhead
 *   bloom, aureole, disc, glare   the sun (or the moon): its widest glow to its tightest
 *   absorb                   what a metre of the water takes out of white light
 *   scatter                  the colour the water itself gives back when lit
 *   sunTint                  the direct light in the water (white at golden hour)
 *   fireTint                 what the sun sets alight: sparks in the air and on the sea, wet skin
 *   skyTint                  the light of the whole sky on things
 *   waterTint                foam's shadow, the aerated lip, a ring's gleam
 *   cloudFire, cloudGlow     a cloud's lit edge, toward the sun and away from it
 *   cloudShade, cloudFar     its body, toward the sun and away from it
 *   barSun, barFar           the long bars of cloud low over the sea
 *   shaft                    the colour the lens gives the shafts
 */
export const HOUR_COLOURS = Object.freeze([
    'horizonSun', 'horizonFar', 'beltSun', 'beltFar', 'zenithSun', 'zenithFar',
    'bloom', 'aureole', 'disc', 'glare',
    'absorb', 'scatter',
    'sunTint', 'fireTint', 'skyTint', 'waterTint',
    'cloudFire', 'cloudGlow', 'cloudShade', 'cloudFar', 'barSun', 'barFar',
    'shaft',
]);

/** An hour's plain numbers: the sun's height (degrees), how far the stars are out, the lens. */
export const HOUR_SCALARS = Object.freeze(['elevation', 'stars', 'exposure']);

const hour = (name, values) => Object.freeze({
    name,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key, Array.isArray(value) ? Object.freeze(value) : value,
    ])),
});

export const HOURS = Object.freeze([
    // The end of the day: a gold sun in the eye of the barrel, emerald water.
    hour('golden', {
        horizonSun: [0.82, 0.4, 0.15],
        horizonFar: [0.27, 0.24, 0.3],
        beltSun: [0.36, 0.31, 0.33],
        beltFar: [0.11, 0.19, 0.34],
        zenithSun: [0.05, 0.115, 0.28],
        zenithFar: [0.028, 0.085, 0.25],
        bloom: [0.5, 0.2, 0.05],
        aureole: [1.5, 0.8, 0.26],
        disc: [1, 0.8, 0.5],
        glare: [2.6, 1.5, 0.5],
        absorb: [0.6, 0.07, 0.115],
        scatter: [0.005, 0.125, 0.11],
        sunTint: [1, 1, 1],
        fireTint: [1, 1, 1],
        skyTint: [1, 1, 1],
        waterTint: [1, 1, 1],
        cloudFire: [2.3, 1.25, 0.5],
        cloudGlow: [0.95, 0.56, 0.36],
        cloudShade: [0.5, 0.33, 0.33],
        cloudFar: [0.2, 0.2, 0.3],
        barSun: [1.7, 0.66, 0.22],
        barFar: [0.3, 0.22, 0.3],
        shaft: [1.2, 1, 0.76],
        elevation: 8.5,
        stars: 0,
        exposure: 1,
    }),
    // Sunset: the sun a red coal low on the sea, crimson under violet, the water jade.
    hour('sunset', {
        horizonSun: [0.95, 0.3, 0.09],
        horizonFar: [0.24, 0.15, 0.28],
        beltSun: [0.44, 0.22, 0.28],
        beltFar: [0.09, 0.1, 0.29],
        zenithSun: [0.045, 0.065, 0.24],
        zenithFar: [0.022, 0.045, 0.2],
        bloom: [0.62, 0.13, 0.035],
        aureole: [1.7, 0.52, 0.14],
        disc: [1, 0.5, 0.24],
        glare: [2.8, 0.95, 0.26],
        absorb: [0.62, 0.085, 0.1],
        scatter: [0.006, 0.105, 0.105],
        sunTint: [1, 0.78, 0.66],
        fireTint: [1.08, 0.72, 0.55],
        skyTint: [0.85, 0.78, 0.98],
        waterTint: [1, 0.94, 0.98],
        cloudFire: [2.4, 0.85, 0.3],
        cloudGlow: [0.95, 0.36, 0.3],
        cloudShade: [0.42, 0.2, 0.3],
        cloudFar: [0.16, 0.13, 0.28],
        barSun: [1.8, 0.42, 0.14],
        barFar: [0.26, 0.14, 0.28],
        shaft: [1.25, 0.88, 0.68],
        elevation: 4.2,
        stars: 0,
        exposure: 1,
    }),
    // Afterglow: the sun going under, a rose band on the horizon, the water turning violet.
    hour('afterglow', {
        horizonSun: [0.8, 0.22, 0.3],
        horizonFar: [0.15, 0.12, 0.28],
        beltSun: [0.38, 0.17, 0.4],
        beltFar: [0.065, 0.075, 0.26],
        zenithSun: [0.03, 0.04, 0.2],
        zenithFar: [0.014, 0.028, 0.15],
        bloom: [0.5, 0.1, 0.13],
        aureole: [1.25, 0.36, 0.34],
        disc: [1, 0.42, 0.38],
        glare: [2.2, 0.7, 0.6],
        absorb: [0.56, 0.115, 0.085],
        scatter: [0.014, 0.08, 0.125],
        sunTint: [0.85, 0.62, 0.78],
        fireTint: [0.95, 0.5, 0.85],
        skyTint: [0.66, 0.6, 1],
        waterTint: [0.95, 0.9, 1.08],
        cloudFire: [1.7, 0.5, 0.6],
        cloudGlow: [0.8, 0.3, 0.45],
        cloudShade: [0.34, 0.16, 0.36],
        cloudFar: [0.1, 0.09, 0.24],
        barSun: [1.5, 0.34, 0.42],
        barFar: [0.16, 0.1, 0.26],
        shaft: [1.15, 0.85, 0.95],
        elevation: -0.4,
        stars: 0.25,
        exposure: 1.05,
    }),
    // Moonrise: a full moon where the sun stood, its road on the sea, the water sapphire.
    hour('moon', {
        horizonSun: [0.07, 0.12, 0.26],
        horizonFar: [0.02, 0.034, 0.09],
        beltSun: [0.04, 0.068, 0.17],
        beltFar: [0.011, 0.02, 0.065],
        zenithSun: [0.011, 0.02, 0.07],
        zenithFar: [0.005, 0.01, 0.042],
        bloom: [0.045, 0.075, 0.16],
        aureole: [0.22, 0.32, 0.56],
        disc: [0.26, 0.3, 0.36],
        glare: [0.7, 0.9, 1.3],
        absorb: [0.62, 0.17, 0.06],
        scatter: [0.004, 0.055, 0.14],
        sunTint: [0.5, 0.62, 0.95],
        fireTint: [0.3, 0.5, 1.4],
        skyTint: [0.3, 0.4, 0.8],
        waterTint: [0.8, 0.92, 1.15],
        cloudFire: [0.34, 0.42, 0.62],
        cloudGlow: [0.1, 0.14, 0.27],
        cloudShade: [0.07, 0.1, 0.22],
        cloudFar: [0.02, 0.03, 0.08],
        barSun: [0.3, 0.38, 0.6],
        barFar: [0.03, 0.045, 0.11],
        shaft: [0.85, 0.95, 1.2],
        elevation: 10.5,
        stars: 1,
        exposure: 1.1,
    }),
    // First light: a pale sun coming up through rose and lavender, the water clear aquamarine.
    hour('dawn', {
        horizonSun: [0.92, 0.5, 0.5],
        horizonFar: [0.3, 0.32, 0.5],
        beltSun: [0.5, 0.4, 0.55],
        beltFar: [0.14, 0.27, 0.48],
        zenithSun: [0.07, 0.19, 0.42],
        zenithFar: [0.04, 0.13, 0.34],
        bloom: [0.45, 0.2, 0.2],
        aureole: [1.3, 0.7, 0.6],
        disc: [1, 0.82, 0.72],
        glare: [2.2, 1.4, 1.1],
        absorb: [0.5, 0.055, 0.075],
        scatter: [0.01, 0.135, 0.155],
        sunTint: [1, 0.92, 0.95],
        fireTint: [0.95, 0.9, 1.5],
        skyTint: [1, 1.05, 1.25],
        waterTint: [0.98, 1.03, 1.1],
        cloudFire: [2, 1.1, 0.95],
        cloudGlow: [0.95, 0.6, 0.62],
        cloudShade: [0.5, 0.38, 0.5],
        cloudFar: [0.24, 0.26, 0.4],
        barSun: [1.6, 0.75, 0.62],
        barFar: [0.34, 0.3, 0.44],
        shaft: [1.15, 0.98, 0.95],
        elevation: 2.6,
        stars: 0.1,
        exposure: 1,
    }),
    // The trade-wind day: a white sun, a blue sky, turquoise water with the light right through it.
    hour('day', {
        horizonSun: [0.6, 0.7, 0.8],
        horizonFar: [0.34, 0.5, 0.72],
        beltSun: [0.3, 0.5, 0.76],
        beltFar: [0.15, 0.33, 0.6],
        zenithSun: [0.06, 0.2, 0.5],
        zenithFar: [0.035, 0.14, 0.42],
        bloom: [0.3, 0.28, 0.22],
        aureole: [1, 0.92, 0.72],
        disc: [1, 0.95, 0.84],
        glare: [2.4, 2.1, 1.5],
        absorb: [0.55, 0.05, 0.07],
        scatter: [0.008, 0.15, 0.16],
        sunTint: [1.25, 1.25, 1.2],
        fireTint: [0.95, 1.35, 2.2],
        skyTint: [1.5, 1.6, 1.7],
        waterTint: [1, 1.04, 1.08],
        cloudFire: [1.45, 1.4, 1.3],
        cloudGlow: [0.8, 0.84, 0.9],
        cloudShade: [0.5, 0.6, 0.78],
        cloudFar: [0.34, 0.44, 0.62],
        barSun: [1.15, 1.12, 1.05],
        barFar: [0.42, 0.52, 0.7],
        shaft: [1.05, 1, 0.92],
        elevation: 12.5,
        stars: 0,
        exposure: 0.92,
    }),
]);

const wrap = (place) => {
    const n = HOURS.length;
    return ((place % n) + n) % n;
};

/**
 * Which two hours the light stands between at a place on the wheel, and how far it has crossed
 * from the first to the second (0 while it rests on the first, 1 while it rests on the second).
 */
export function hourMix(place, out = {}) {
    const p = wrap(Number.isFinite(place) ? place : 0);
    const from = Math.floor(p) % HOURS.length;
    out.from = from;
    out.to = (from + 1) % HOURS.length;
    out.mix = smooth(HOUR_REST, 1 - HOUR_REST, p - from);
    return out;
}

const mixed = {};

/**
 * The light at a place on the wheel: every colour of HOUR_COLOURS as [r, g, b], every number of
 * HOUR_SCALARS, and `name` (the hour it stands nearer to), `next` and `mix`.
 */
export function hourAt(place, out = {}) {
    const { from, to, mix } = hourMix(place, mixed);
    const a = HOURS[from];
    const b = HOURS[to];
    for (let i = 0; i < HOUR_COLOURS.length; i += 1) {
        const key = HOUR_COLOURS[i];
        if (!out[key]) out[key] = [0, 0, 0];
        const colour = out[key];
        colour[0] = lerp(a[key][0], b[key][0], mix);
        colour[1] = lerp(a[key][1], b[key][1], mix);
        colour[2] = lerp(a[key][2], b[key][2], mix);
    }
    for (let i = 0; i < HOUR_SCALARS.length; i += 1) {
        const key = HOUR_SCALARS[i];
        out[key] = lerp(a[key], b[key], mix);
    }
    out.name = mix < 0.5 ? a.name : b.name;
    out.next = mix < 0.5 ? b.name : a.name;
    out.mix = mix;
    return out;
}

/**
 * The place a level holds on the wheel, `since` seconds after it was reached from the place
 * `from`: the turn is eased over the set wave's passage and then stays put.
 */
export function levelPlace(from, to, since) {
    if (!(since > 0)) return from;
    return from + (to - from) * smooth(0, SET_SECONDS, since);
}

/**
 * Where a new run takes up the wheel from the place the last one left it: the nearest turn of
 * the wheel that is golden hour again, so the light goes back the short way round.
 */
export function restPlace(place) {
    const n = HOURS.length;
    return place - Math.round(place / n) * n;
}

/**
 * The clock's own sets: half-way through every hour, as the light is crossing fastest, a set
 * wave enters the tube. Seconds since the latest one entered, or −1 when none is in the tube.
 */
export function tideSetAge(clock) {
    const beat = clock / HOUR_SECONDS - 0.5;
    if (!(beat >= 0)) return -1;
    const since = (beat - Math.floor(beat)) * HOUR_SECONDS;
    return since < SET_SECONDS ? since : -1;
}
