/**
 * Ocean — the hours: the light the reef is seen in (CPU only, three-free).
 *
 * The reef is the same reef all day; what changes is the hour. Six of them stand on a wheel in
 * the order a day runs: the high sun over a turquoise sea, the gold of the afternoon, the fire
 * of sunset seen through the surface, the blue hour when the corals begin to glow, the moon
 * with the sea alight, first light through jade water, and round again.
 *
 * Where the light stands on the wheel is one number, the place:
 *
 *     place = (level − 1) + clock / HOUR_SECONDS
 *
 * so a new level turns it one whole hour (eased over HOUR_TURN seconds) and the clock turns it
 * by itself, slowly, in every mode — the ones that never level included. Both simply add. Within
 * an hour the light rests on that hour's own colours for a share of the time at each end
 * (HOUR_REST) and is on its way to the next for the rest, so the six named looks are really seen
 * and everything between them is a mix of two neighbours. Neighbours are neighbours in hue too
 * (turquoise, azure, violet, indigo, night blue, jade), so no crossing goes through grey.
 *
 * Every colour is scene-linear.
 */
import { lerp, smooth } from './ocean-core.js';

/** Seconds of the world's clock one hour lasts when no level turns it. */
export const HOUR_SECONDS = 100;
/** The share of an hour, at each end, the light rests on that hour's own colours. */
export const HOUR_REST = 0.15;

/**
 * An hour's colours, in the order of the uniforms the shaders read:
 *   shallow, deep, abyss   the water itself, looking up, level and down
 *   ext                    what a metre of water takes out of white light
 *   sun                    the direct light on things (the moon's, at night)
 *   ambient                the light of the whole surface on things
 *   bounce                 the light the sand gives back from below
 *   shaft                  the colour of the shafts
 *   halo                   the glow of the water round the sun's direction
 *   zenith, horizon        the sky seen through the surface
 *   disc                   the sun (or the moon) seen through it
 *   spark                  what drifts in the water, where the light catches it
 *   glow                   the reef's own light: polyps, tentacle tips, the sea alight at night
 */
export const HOUR_COLOURS = Object.freeze([
    'shallow', 'deep', 'abyss', 'ext', 'sun', 'ambient', 'bounce', 'shaft', 'halo', 'zenith', 'horizon', 'disc',
    'spark', 'glow',
]);

/**
 * An hour's plain numbers: the light's height and bearing in the water (degrees; it can never
 * stand lower than the window's edge), how strongly the reef fluoresces, how much of the night's
 * own light is out, the lens, and how strongly the shafts stand.
 */
export const HOUR_SCALARS = Object.freeze(['elevation', 'azimuth', 'fluor', 'night', 'exposure', 'shafts']);

const hour = (name, values) => Object.freeze({
    name,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key, Array.isArray(value) ? Object.freeze(value) : value,
    ])),
});

export const HOURS = Object.freeze([
    // The high sun: turquoise water with the light right through it.
    hour('noon', {
        shallow: [0.085, 0.5, 0.6],
        deep: [0.01, 0.15, 0.3],
        abyss: [0.003, 0.04, 0.105],
        ext: [0.105, 0.036, 0.024],
        sun: [1.55, 1.45, 1.2],
        ambient: [0.13, 0.33, 0.42],
        bounce: [0.16, 0.2, 0.16],
        shaft: [0.55, 0.95, 1.0],
        halo: [0.25, 0.75, 0.8],
        zenith: [0.22, 0.5, 0.95],
        horizon: [0.75, 0.92, 1.05],
        disc: [14, 13, 10],
        spark: [0.75, 1.0, 0.95],
        glow: [0.5, 1.0, 0.9],
        elevation: 62,
        azimuth: -18,
        fluor: 0.12,
        night: 0,
        exposure: 1,
        shafts: 1,
    }),
    // The gold: a lower sun, azure water, long warm shafts.
    hour('gold', {
        shallow: [0.11, 0.42, 0.55],
        deep: [0.012, 0.115, 0.275],
        abyss: [0.004, 0.032, 0.1],
        ext: [0.1, 0.04, 0.026],
        sun: [1.75, 1.25, 0.72],
        ambient: [0.13, 0.27, 0.4],
        bounce: [0.2, 0.18, 0.12],
        shaft: [1.0, 0.86, 0.5],
        halo: [0.55, 0.62, 0.45],
        zenith: [0.2, 0.42, 0.9],
        horizon: [1.0, 0.85, 0.6],
        disc: [16, 12, 6],
        spark: [1.0, 0.9, 0.6],
        glow: [0.9, 0.9, 0.5],
        elevation: 51,
        azimuth: -27,
        fluor: 0.16,
        night: 0,
        exposure: 1,
        shafts: 1.0,
    }),
    // The fire: sunset burning in the window, the water gone violet under it.
    hour('fire', {
        shallow: [0.24, 0.12, 0.28],
        deep: [0.035, 0.035, 0.2],
        abyss: [0.01, 0.012, 0.075],
        ext: [0.085, 0.055, 0.028],
        sun: [1.7, 0.62, 0.34],
        ambient: [0.2, 0.15, 0.36],
        bounce: [0.2, 0.1, 0.12],
        shaft: [1.0, 0.48, 0.4],
        halo: [0.44, 0.16, 0.2],
        zenith: [0.22, 0.17, 0.5],
        horizon: [1.6, 0.55, 0.25],
        disc: [18, 6.5, 2.2],
        spark: [1.0, 0.6, 0.6],
        glow: [1.0, 0.45, 0.7],
        elevation: 44,
        azimuth: -35,
        fluor: 0.3,
        night: 0.05,
        exposure: 1.0,
        shafts: 1.05,
    }),
    // The blue hour: the light going, indigo water, the corals beginning to glow.
    hour('blue', {
        shallow: [0.055, 0.13, 0.36],
        deep: [0.01, 0.032, 0.155],
        abyss: [0.003, 0.009, 0.055],
        ext: [0.11, 0.06, 0.03],
        sun: [0.42, 0.5, 0.95],
        ambient: [0.07, 0.12, 0.3],
        bounce: [0.04, 0.06, 0.1],
        shaft: [0.4, 0.55, 1.0],
        halo: [0.15, 0.25, 0.6],
        zenith: [0.03, 0.06, 0.22],
        horizon: [0.2, 0.22, 0.5],
        disc: [2.5, 3, 5],
        spark: [0.4, 0.7, 1.0],
        glow: [0.5, 0.6, 1.0],
        elevation: 52,
        azimuth: -24,
        fluor: 0.7,
        night: 0.55,
        exposure: 1.12,
        shafts: 0.8,
    }),
    // The moon: silver shafts in black-blue water, the reef and the sea alight.
    hour('moon', {
        shallow: [0.022, 0.085, 0.17],
        deep: [0.003, 0.02, 0.062],
        abyss: [0.001, 0.005, 0.025],
        ext: [0.12, 0.05, 0.034],
        sun: [0.5, 0.7, 0.95],
        ambient: [0.035, 0.085, 0.15],
        bounce: [0.02, 0.04, 0.06],
        shaft: [0.45, 0.75, 1.0],
        halo: [0.1, 0.3, 0.45],
        zenith: [0.006, 0.014, 0.045],
        horizon: [0.02, 0.05, 0.11],
        disc: [5, 6.5, 8],
        spark: [0.25, 0.95, 1.0],
        glow: [0.3, 1.0, 0.8],
        elevation: 64,
        azimuth: -12,
        fluor: 1,
        night: 1,
        exposure: 1.2,
        shafts: 0.9,
    }),
    // First light: a rose sun coming up on the other side, the water clear jade.
    hour('dawn', {
        shallow: [0.15, 0.45, 0.38],
        deep: [0.018, 0.14, 0.16],
        abyss: [0.004, 0.036, 0.055],
        ext: [0.1, 0.034, 0.036],
        sun: [1.45, 0.95, 0.85],
        ambient: [0.13, 0.3, 0.3],
        bounce: [0.16, 0.16, 0.13],
        shaft: [1.0, 0.82, 0.78],
        halo: [0.38, 0.42, 0.34],
        zenith: [0.25, 0.4, 0.7],
        horizon: [1.0, 0.62, 0.62],
        disc: [12, 7.6, 6.4],
        spark: [0.9, 1.0, 0.8],
        glow: [0.7, 1.0, 0.6],
        elevation: 45,
        azimuth: 22,
        fluor: 0.3,
        night: 0.1,
        exposure: 0.95,
        shafts: 0.9,
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

/** The place on the wheel a level and a clock give (the level's own place may be mid-turn). */
export function hourPlace(levelPlace, clock, drifting = true) {
    return levelPlace + (drifting ? Math.max(0, clock) / HOUR_SECONDS : 0);
}

/**
 * Where a level's place lands coming from `from`: the short way round the wheel, so a new run
 * turns back to its first hour instead of on through all of them.
 */
export function nearestTurn(from, level) {
    const n = HOURS.length;
    let to = Math.max(1, Math.round(Number(level) || 1)) - 1;
    while (to - from > n / 2) to -= n;
    while (from - to > n / 2) to += n;
    return to;
}
