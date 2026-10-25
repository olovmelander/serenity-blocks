// @ts-check
/**
 * Neon Dusk — the moods of the dusk, turned by the clock in every mode (three-free).
 *
 * The great sun always sinks into the same pass over the same glass; what turns is the light: the
 * sky's gradient, the sun's face, the glow round it, the cloud bars, the ranges' bodies, rims and
 * mist, the glass and the stars. Five moods, a synthwave dusk each:
 *
 *   0  magenta dusk         the dusk as it always was: hot coral horizon, violet-indigo sky,
 *                           a gold-to-magenta sun
 *   1  violet twilight      the warmth has left the air: an orchid horizon under a violet sky,
 *                           a pink sun with a pearl crown
 *   2  teal night           a deep navy night with a cyan glow in the pass, a pink-to-ice
 *                           chrome sun, more stars
 *   3  ultraviolet midnight near-black violet, an electric blue-violet horizon, a dim lavender
 *                           sun, the stars at their brightest
 *   4  amber dawn           the sky warms again: an amber horizon toward the sun, slate blue
 *                           away from it, a red-gold sun with a pale crown
 *
 * phase = the level's step (eased the short way round) + moodDrift(time): a mood rests for
 * MOOD_HOLD of MOOD_PERIOD seconds, pure, then melts into the next (src/themes/shared/mood-clock.js).
 *
 * Only the sky's stops, the sun's face and the glow are authored per mood (PRIMARY). Every other
 * colour (cloud bars, ranges, mist, the light in the air, the glass) keeps the relation it has to
 * one of them in today's look: the same turn of hue, the same share of its saturation and
 * brightness (SECONDARY). Mood 0 is today's look exactly. Colours are authored in sRGB and held
 * scene-linear; a scale above 1 is HDR (it blooms).
 */

import { meltPalettes, wheelAt } from '../shared/mood-clock.js';

/** Seconds a mood lasts when only the clock is turning it. */
export const MOOD_PERIOD = 105;
/** The share of that time a mood rests, pure, before it melts into the next. */
export const MOOD_HOLD = 0.35;

/** @param {number} c an sRGB channel 0..1 */
const toLinear = (c) => (c < 0.04045 ? c * 0.0773993808 : (c * 0.9478672986 + 0.0521327014) ** 2.4);

/**
 * A scene-linear colour from an sRGB hex (the same conversion THREE.Color makes), times `scale`.
 * @param {number} hex
 * @param {number} [scale]
 * @returns {number[]}
 */
export function linearHex(hex, scale = 1) {
    return [
        toLinear(((hex >> 16) & 255) / 255) * scale,
        toLinear(((hex >> 8) & 255) / 255) * scale,
        toLinear((hex & 255) / 255) * scale,
    ];
}

/** @typedef {number | [number, number]} Hex a hex, or [hex, scale] */

/** @param {Hex} spec */
const lin = (spec) => (Array.isArray(spec) ? linearHex(spec[0], spec[1]) : linearHex(spec));

/**
 * The authored colours of a mood:
 *   hazeA / hazeT    the horizon away from the sun / toward it
 *   lowA / lowT      the band just above it, away / toward
 *   midA / midT      the band above that, away / toward
 *   high, upper      the violet and the indigo above
 *   zenith           the top of the sky
 *   sun0..sun4       the sun's face from its base to its crown
 *   glowWide         the broad air round the sun
 *   glowHalo         the halo hugging its rim
 *   glowBand         the band of light along the horizon under it
 */
export const PRIMARY_KEYS = Object.freeze([
    'hazeA', 'hazeT', 'lowA', 'lowT', 'midA', 'midT', 'high', 'upper', 'zenith',
    'sun0', 'sun1', 'sun2', 'sun3', 'sun4',
    'glowWide', 'glowHalo', 'glowBand',
]);

/**
 * The colours that follow the authored ones: [the primary they follow, today's colour].
 *   cloudLitFar / cloudLit / cloudLitSun   a bar's lit underside far out, beside the sun, over it
 *   cloudShadeFar / cloudShadeNear         its shaded body far out / near the sun
 *   rangeFar / rangeMid / rangeNear        the three ranges' bodies
 *   rangeSky                               the sky's lift on their tops
 *   rimFar / rimSun                        the backlit ridge line, away from / beside the sun
 *   mistA / mistT                          the mist at their feet, away / toward the sun
 *   airA / airT                            the light in the air toward the sun
 *   glass                                  the dark glass of the floor
 *   mirrorRange                            the ranges in the analytic mirror (Low and Minimal)
 * @type {Readonly<Record<string, [string, Hex]>>}
 */
export const SECONDARY = Object.freeze({
    cloudLitFar: ['lowA', [0xb02a6a, 0.5]],
    cloudLit: ['glowWide', 0xff3f7c],
    cloudLitSun: ['sun3', [0xffa040, 1.45]],
    cloudShadeFar: ['upper', 0x1c0b30],
    cloudShadeNear: ['midA', 0x3c1240],
    rangeFar: ['high', 0x241248],
    rangeMid: ['upper', 0x150a2c],
    rangeNear: ['zenith', 0x0a0418],
    rangeSky: ['high', 0x3c2280],
    rimFar: ['glowWide', [0xd0257a, 0.7]],
    rimSun: ['glowHalo', [0xff8a34, 1.9]],
    mistA: ['hazeA', [0x5a2a8a, 0.9]],
    mistT: ['hazeT', [0xff6a7e, 1.2]],
    airA: ['glowWide', [0xff2a86, 0.45]],
    airT: ['glowHalo', [0xff6a3e, 0.75]],
    glass: ['zenith', 0x06020e],
    mirrorRange: ['upper', 0x140a26],
});

/** Every colour a mood sets, in a fixed order (the uniforms the shaders read). */
export const MOOD_KEYS = Object.freeze([...PRIMARY_KEYS, ...Object.keys(SECONDARY)]);

/**
 * The moods, in the order the clock turns through them. `stars` scales the starlight.
 * @type {ReadonlyArray<{ name: string, stars: number, colors: Record<string, Hex> }>}
 */
const AUTHORED = Object.freeze([
    {
        name: 'magenta dusk',
        stars: 1,
        colors: {
            hazeA: 0x4e2b86,
            hazeT: [0xff5a6e, 1.15],
            lowA: 0xb02a6c,
            lowT: [0xff6f5a, 1.1],
            midA: 0x6e1a68,
            midT: 0xc8306a,
            high: 0x3a1470,
            upper: 0x1a0d4c,
            zenith: 0x06051a,
            sun0: [0xff1872, 1.2],
            sun1: [0xff3a24, 1.25],
            sun2: [0xff7a14, 1.35],
            sun3: [0xffc632, 1.5],
            sun4: [0xffeb98, 1.7],
            glowWide: 0xff2a7a,
            glowHalo: 0xff6a2e,
            glowBand: 0xff5a5e,
        },
    },
    {
        name: 'violet twilight',
        stars: 1.15,
        colors: {
            hazeA: 0x3a2a7c,
            hazeT: [0xe060c0, 1.05],
            lowA: 0x7c3098,
            lowT: [0xf070b8, 1.0],
            midA: 0x4c1c78,
            midT: 0xa23cb0,
            high: 0x2c1668,
            upper: 0x150c46,
            zenith: 0x050418,
            sun0: [0xd81aa0, 1.15],
            sun1: [0xff2a8a, 1.2],
            sun2: [0xff5aa8, 1.3],
            sun3: [0xff9cc8, 1.42],
            sun4: [0xffe0f0, 1.6],
            glowWide: 0xd02ab0,
            glowHalo: 0xff5aa0,
            glowBand: 0xe856b8,
        },
    },
    {
        name: 'teal night',
        stars: 1.35,
        colors: {
            hazeA: 0x162a5c,
            hazeT: [0x1cb0c8, 1.0],
            lowA: 0x1c387a,
            lowT: [0x2e9ad8, 1.0],
            midA: 0x152a68,
            midT: 0x2a64b8,
            high: 0x0e1c56,
            upper: 0x08103c,
            zenith: 0x020614,
            sun0: [0xff1a8c, 1.1],
            sun1: [0xc83cff, 1.15],
            sun2: [0x6a72ff, 1.22],
            sun3: [0x30d0ff, 1.35],
            sun4: [0xc8faff, 1.55],
            glowWide: 0x2a7aff,
            glowHalo: 0x3ad8ff,
            glowBand: 0x30b0ff,
        },
    },
    {
        name: 'ultraviolet midnight',
        stars: 1.5,
        colors: {
            hazeA: 0x1e1058,
            hazeT: [0x6a3cff, 0.95],
            lowA: 0x34168a,
            lowT: [0x7a48ff, 0.95],
            midA: 0x240c66,
            midT: 0x4a28c0,
            high: 0x160a4a,
            upper: 0x0b0630,
            zenith: 0x030210,
            sun0: [0x6a10ff, 0.95],
            sun1: [0x8a2aff, 1.02],
            sun2: [0xb44cff, 1.1],
            sun3: [0xd890ff, 1.22],
            sun4: [0xf0d8ff, 1.38],
            glowWide: 0x7a2aff,
            glowHalo: 0xb060ff,
            glowBand: 0x8a50ff,
        },
    },
    {
        name: 'amber dawn',
        stars: 0.6,
        colors: {
            hazeA: 0x4a5a96,
            hazeT: [0xffa040, 1.15],
            lowA: 0x7a6a9c,
            lowT: [0xffb85a, 1.1],
            midA: 0x3a4a8c,
            midT: 0xf08860,
            high: 0x22307c,
            upper: 0x101c58,
            zenith: 0x040a20,
            sun0: [0xff3a2a, 1.2],
            sun1: [0xff6a18, 1.28],
            sun2: [0xffa820, 1.38],
            sun3: [0xffdc60, 1.52],
            sun4: [0xfff6d0, 1.7],
            glowWide: 0xff6a40,
            glowHalo: 0xffb040,
            glowBand: 0xff9050,
        },
    },
]);

/** @param {number[]} c @returns {number[]} (hue 0..1 or NaN for a grey, saturation, value) */
function hsv([r, g, b]) {
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    if (d <= 1e-9) return [Number.NaN, 0, max];
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h / 6, d / max, max];
}

/** @param {number} h @param {number} s @param {number} v @returns {number[]} */
function rgbOf(h, s, v) {
    const ch = (n) => {
        const k = (n + h * 6) % 6;
        return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [ch(5), ch(3), ch(1)];
}

/**
 * The colour that stands to `parent` as `child0` stands to `parent0`: the same turn of hue, the
 * same share of saturation and brightness.
 * @param {number[]} child0 @param {number[]} parent0 @param {number[]} parent
 */
export function relate(child0, parent0, parent) {
    const [hc, sc, vc] = hsv(child0);
    const [hp0, sp0, vp0] = hsv(parent0);
    const [hp, sp, vp] = hsv(parent);
    const turn = Number.isNaN(hc) || Number.isNaN(hp0) ? 0 : hc - hp0;
    const hue = ((((Number.isNaN(hp) ? 0 : hp) + turn) % 1) + 1) % 1;
    const s = Math.min(1, sp0 > 1e-6 ? sp * (sc / sp0) : sc);
    const v = vp0 > 1e-9 ? vp * (vc / vp0) : vc;
    return rgbOf(hue, s, v);
}

const TODAY = AUTHORED[0];

/** The moods as scene-linear palettes: every key of MOOD_KEYS, plus `name` and `stars`. */
export const MOODS = Object.freeze(AUTHORED.map((mood, index) => {
    /** @type {Record<string, any>} */
    const out = { name: mood.name, stars: mood.stars };
    for (const key of PRIMARY_KEYS) out[key] = lin(mood.colors[key]);
    for (const [key, [parent, today]] of Object.entries(SECONDARY)) {
        out[key] = index === 0 ? lin(today) : relate(lin(today), lin(TODAY.colors[parent]), out[parent]);
    }
    return Object.freeze(out);
}));

export const MOOD_COUNT = MOODS.length;

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The palette at `phase` round the wheel of moods, written into `out` (one [r, g, b] a key of
 * MOOD_KEYS, made as needed) and `out.stars`. On a whole phase it is that mood exactly; between,
 * the colours melt the short way round the colour wheel. Returns `out`.
 * @param {number} phase
 * @param {Record<string, any>} [out]
 */
export function moodAt(phase, out = {}) {
    meltPalettes(MOODS, MOOD_KEYS, phase, out);
    wheelAt(phase, MOOD_COUNT, AT);
    out.stars = MOODS[AT.a].stars + (MOODS[AT.b].stars - MOODS[AT.a].stars) * AT.melt;
    return out;
}

/** The name of the mood nearest `phase`. */
export function moodName(phase) {
    const k = ((Math.round(Number.isFinite(phase) ? phase : 0) % MOOD_COUNT) + MOOD_COUNT) % MOOD_COUNT;
    return MOODS[k].name;
}
