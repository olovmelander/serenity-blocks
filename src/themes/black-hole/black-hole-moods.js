// @ts-check
/**
 * Black Hole — the moods of the hole, turned by the clock in every mode (three-free).
 *
 * The hole, its disk and its sky stay where they are; what turns is how the disk burns and how
 * the field round it is lit. Each mood scales the look knobs the director computes from play
 * (black-hole-director.js: diskHeat, diskGain, diskTint, ringGain, ringTint, skyGain,
 * nebulaGain) and the lens's star and corona gains, so the heat of play still builds on top
 * of whatever mood the clock has brought:
 *
 *   0  gold accretion      the hole as it always was: a gold disk round a white-hot heart
 *   1  blue-white furnace  the gas runs hotter: a white disk with a blue-white inner edge, the
 *                          galaxy a little dimmer round it
 *   2  nebula field        the hole drifts through emission nebulae: rose and teal clouds lit
 *                          all round, the disk a touch cooler
 *   3  red quiescence      a quiet, cooling disk of ember and flame, the nebulae's rose
 *                          answering it, more stars
 *   4  starved ring        the disk thins to a faint veil and the photon ring stands out
 *                          bright round the shadow under a field of stars
 *
 * phase = the level's step (eased the short way round) + moodDrift(time): a mood rests for
 * MOOD_HOLD of MOOD_PERIOD seconds, pure, then melts into the next over most of a minute
 * (src/themes/shared/mood-clock.js). A melt is a slow change of light, never a flash
 * (ADR-0021): nothing here moves faster than the clock's own ease.
 */

import { wheelAt } from '../shared/mood-clock.js';

/** Seconds a mood lasts when only the clock is turning it. */
export const MOOD_PERIOD = 112;
/** The share of that time a mood rests, pure, before it melts into the next. */
export const MOOD_HOLD = 0.35;

/** The scalar factors a mood sets (1 = today). */
export const MOOD_SCALARS = Object.freeze(['heat', 'gain', 'ring', 'sky', 'nebula', 'stars', 'corona']);
/** The colour factors a mood sets ([1, 1, 1] = today). */
export const MOOD_TINTS = Object.freeze(['tint', 'ringTint']);

/**
 * The moods, in the order the clock turns through them. Every factor multiplies what the
 * director (or the lens default) sets:
 *   heat      the gas's blackbody temperature      gain      its brightness
 *   ring      the photon ring's brightness         sky       the galaxy's glow
 *   nebula    the emission nebulae                 stars     the starlight
 *   corona    the hot haze over the disk           tint      the gas's colour
 *   ringTint  the photon ring's colour
 * @type {ReadonlyArray<Readonly<{ name: string, heat: number, gain: number, ring: number, sky: number,
 *   nebula: number, stars: number, corona: number, tint: ReadonlyArray<number>,
 *   ringTint: ReadonlyArray<number> }>>}
 */
export const MOODS = Object.freeze([
    {
        name: 'gold accretion',
        heat: 1,
        gain: 1,
        ring: 1,
        sky: 1,
        nebula: 1,
        stars: 1,
        corona: 1,
        tint: [1, 1, 1],
        ringTint: [1, 1, 1],
    },
    {
        name: 'blue-white furnace',
        heat: 1.6,
        gain: 0.82,
        ring: 1.15,
        sky: 0.8,
        nebula: 0.7,
        stars: 1,
        corona: 0.8,
        tint: [0.88, 0.93, 1.16],
        ringTint: [0.82, 0.94, 1.2],
    },
    {
        name: 'nebula field',
        heat: 0.9,
        gain: 0.88,
        ring: 1,
        sky: 1.25,
        nebula: 2.8,
        stars: 1.1,
        corona: 0.9,
        tint: [1, 0.94, 1.02],
        ringTint: [1, 0.96, 1.02],
    },
    {
        name: 'red quiescence',
        heat: 0.55,
        gain: 1.35,
        ring: 0.85,
        sky: 1.08,
        nebula: 1.6,
        stars: 1.2,
        corona: 1.1,
        tint: [1.08, 0.85, 0.78],
        ringTint: [1.1, 0.76, 0.6],
    },
    {
        name: 'starved ring',
        heat: 1.08,
        gain: 0.45,
        ring: 3,
        sky: 0.9,
        nebula: 0.7,
        stars: 1.35,
        corona: 0.5,
        tint: [1, 1, 1],
        ringTint: [0.96, 0.98, 1.04],
    },
].map((mood) => Object.freeze({
    ...mood,
    tint: Object.freeze([...mood.tint]),
    ringTint: Object.freeze([...mood.ringTint]),
})));

export const MOOD_COUNT = MOODS.length;

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The mood's factors at `phase` round the wheel, written into `out` (scalars, and [r, g, b]
 * arrays for the tints). On a whole phase it is that mood exactly; between, every factor eases
 * straight across. Returns `out`.
 * @param {number} phase
 * @param {Record<string, any>} [out]
 */
export function moodAt(phase, out = {}) {
    wheelAt(phase, MOOD_COUNT, AT);
    const a = MOODS[AT.a];
    const b = MOODS[AT.b];
    const k = AT.melt;
    for (const key of MOOD_SCALARS) out[key] = k <= 0 ? a[key] : a[key] + (b[key] - a[key]) * k;
    for (const key of MOOD_TINTS) {
        const rgb = out[key] || (out[key] = [1, 1, 1]);
        for (let c = 0; c < 3; c += 1) rgb[c] = k <= 0 ? a[key][c] : a[key][c] + (b[key][c] - a[key][c]) * k;
    }
    return out;
}

/** The name of the mood nearest `phase`. */
export function moodName(phase) {
    const k = ((Math.round(Number.isFinite(phase) ? phase : 0) % MOOD_COUNT) + MOOD_COUNT) % MOOD_COUNT;
    return MOODS[k].name;
}
