// @ts-check
/**
 * Nimbus Veil — the light over the cloud sea, turned by the clock in every mode (three-free).
 *
 * The place never changes: the same deck of cumulus heads, the same towers, the sun low in the
 * same bearing throwing the same long shadows (its direction is fixed; only its colour and the
 * air's change). What turns is the light: the sky's gradient, the sun's disc and glow, the key
 * light on the clouds, the sky's fill in their shade, the mist, the banks, the cirrus and the
 * veils, and the first stars. Five moods:
 *
 *   0  golden sunrise   the light as it always was: a gold sun over lavender-rose haze and an
 *                       azure zenith, violet shade
 *   1  pearl morning    a cool, clear morning: a white sun, pearl-peach air, a pale blue sky,
 *                       blue-grey shade
 *   2  white noon       the high-altitude glare: a white sun, a deep cobalt sky, brilliant white
 *                       crowns over blue shade
 *   3  rose evening     the light reddens: salmon-rose sun on the crowns, mauve air, a violet
 *                       sky deepening to indigo
 *   4  blue hour        last light: an ember sun, a thin warm band in the pass, deep blue air
 *                       and the first stars
 *
 * phase = the level's step (eased the short way round) + moodDrift(time): a mood rests for
 * MOOD_HOLD of MOOD_PERIOD seconds, pure, then melts into the next (src/themes/shared/mood-clock.js).
 *
 * The sky's stops, the sun, its glow, the key light and the sky's fill are authored per mood
 * (PRIMARY); the mist, the towers' shade, the banks, the cirrus and the veils keep the relation
 * they have to one of them in today's look (SECONDARY). Mood 0 is today's look exactly. Authored
 * in sRGB, held scene-linear; a scale above 1 is HDR.
 */

import { meltPalettes, wheelAt } from '../shared/mood-clock.js';

/** Seconds a mood lasts when only the clock is turning it. */
export const MOOD_PERIOD = 110;
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
 *   hazeA / hazeT        the horizon away from the sun / toward it
 *   lowA / lowT          the band just above it, away / toward
 *   mid, upper, zenith   the sky above
 *   glowWide / glowCore / glowBand   the sun's aureole, its core glow, the band under it
 *   sunDisc              the disc
 *   sunLight             the key light on the clouds
 *   skyLow / skyHigh     the sky's fill in the deck's shade, from the horizon / the zenith
 */
export const PRIMARY_KEYS = Object.freeze([
    'hazeA', 'hazeT', 'lowA', 'lowT', 'mid', 'upper', 'zenith',
    'glowWide', 'glowCore', 'glowBand', 'sunDisc', 'sunLight', 'skyLow', 'skyHigh',
]);

/**
 * The colours that follow the authored ones: [the primary they follow, today's colour].
 *   mistA / mistT          the mist in the deck's creases, away / toward the sun
 *   shadeLow / shadeHigh   a tower's shade low / where it turns up to the zenith
 *   bankLit / bankShade / bankRim   the distant banks: lit, backlit body, burning rim
 *   cirrusA / cirrusT      the cirrus away from the sun / lit by it
 *   veilA / veilT          the near veils of mist, away / toward the sun
 * @type {Readonly<Record<string, [string, Hex]>>}
 */
export const SECONDARY = Object.freeze({
    mistA: ['mid', [0xb8a6d8, 0.62]],
    mistT: ['glowCore', [0xffd2b0, 0.95]],
    shadeLow: ['skyHigh', [0x6a62a2, 0.4]],
    shadeHigh: ['skyHigh', [0x9496d8, 0.52]],
    bankLit: ['lowA', [0xf0b9c4, 0.95]],
    bankShade: ['mid', [0x9a86bd, 0.62]],
    bankRim: ['glowWide', [0xffc890, 1.6]],
    cirrusA: ['mid', 0xf3e6f4],
    cirrusT: ['glowCore', [0xffd6a6, 1.3]],
    veilA: ['mid', [0xd9c4e6, 0.95]],
    veilT: ['glowCore', [0xffe2bc, 1.25]],
});

/** Every colour a mood sets, in a fixed order (the uniforms the shaders read). */
export const MOOD_KEYS = Object.freeze([...PRIMARY_KEYS, ...Object.keys(SECONDARY)]);

/**
 * The moods, in the order the clock turns through them. `stars` is the starlight (0 = none).
 * @type {ReadonlyArray<{ name: string, stars: number, colors: Record<string, Hex> }>}
 */
const AUTHORED = Object.freeze([
    {
        name: 'golden sunrise',
        stars: 0,
        colors: {
            hazeA: 0xb895bd,
            hazeT: [0xffcb92, 1.12],
            lowA: 0xe9b3b8,
            lowT: 0xffc79a,
            mid: 0xa39cd0,
            upper: 0x5f7fc6,
            zenith: 0x2b4f9e,
            glowWide: 0xffb070,
            glowCore: 0xffe2b0,
            glowBand: 0xffc18a,
            sunDisc: [0xfff4dc, 5],
            sunLight: [0xffc48c, 1.85],
            skyLow: [0xa37fb0, 0.3],
            skyHigh: [0x8186d0, 0.44],
        },
    },
    {
        name: 'pearl morning',
        stars: 0,
        colors: {
            hazeA: 0xa8b0d4,
            hazeT: [0xffdcc4, 0.98],
            lowA: 0xc8c4e0,
            lowT: 0xffe6d4,
            mid: 0x98b2e0,
            upper: 0x5c8cd4,
            zenith: 0x2c5cb0,
            glowWide: [0xffd6b8, 0.85],
            glowCore: 0xfff0e0,
            glowBand: 0xffe0cc,
            sunDisc: [0xfff8ee, 5],
            sunLight: [0xffe6d4, 1.6],
            skyLow: [0x8a94c4, 0.3],
            skyHigh: [0x7c9ce0, 0.44],
        },
    },
    {
        name: 'white noon',
        stars: 0,
        colors: {
            hazeA: 0x8ea8d8,
            hazeT: [0xd8e0ee, 0.95],
            lowA: 0x9cb8e6,
            lowT: 0xdce6f4,
            mid: 0x5c8ad8,
            upper: 0x2e5ec0,
            zenith: 0x123490,
            glowWide: [0xd4e2ff, 0.55],
            glowCore: 0xf2f6ff,
            glowBand: [0xe0eaff, 0.75],
            sunDisc: [0xffffff, 5],
            sunLight: [0xfff6ec, 1.7],
            skyLow: [0x6a82c4, 0.34],
            skyHigh: [0x5e88e0, 0.5],
        },
    },
    {
        name: 'rose evening',
        stars: 0.12,
        colors: {
            hazeA: 0xa8749e,
            hazeT: [0xff9a86, 1.1],
            lowA: 0xd486a6,
            lowT: 0xffa086,
            mid: 0x9476bc,
            upper: 0x5648a4,
            zenith: 0x262874,
            glowWide: 0xff8a6c,
            glowCore: 0xffc8ae,
            glowBand: 0xff9a7c,
            sunDisc: [0xffe0c8, 4.6],
            sunLight: [0xffa08a, 1.75],
            skyLow: [0x9a68a6, 0.3],
            skyHigh: [0x7870c8, 0.42],
        },
    },
    {
        name: 'blue hour',
        stars: 1,
        colors: {
            hazeA: 0x4a5490,
            hazeT: [0xd88a6a, 0.8],
            lowA: 0x5a5c9c,
            lowT: 0xc87a70,
            mid: 0x3a4890,
            upper: 0x1e2e70,
            zenith: 0x0c1648,
            glowWide: [0xff7a4a, 0.45],
            glowCore: [0xffb080, 0.8],
            glowBand: [0xff8a5a, 0.8],
            sunDisc: [0xffa070, 2.4],
            sunLight: [0xe08a7a, 0.9],
            skyLow: [0x4a4a8a, 0.3],
            skyHigh: [0x4a5aa8, 0.38],
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
