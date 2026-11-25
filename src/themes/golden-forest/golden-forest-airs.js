/**
 * Golden Forest — the airs of the lake.
 *
 * The hours (golden-forest-moods.js) turn the light's colour; the airs turn the weather under
 * it, on a clock of their own, so the same hour is never long the same evening:
 *
 *   still         the lake as it was built: long bars of evening cloud, mist lying in banks, a
 *                 mirror for water (and where a session starts)
 *   burning sky   a ceiling of high cloud comes over with a clear slot under it, and the low sun
 *                 shines up through the slot and sets its underside alight
 *   breeze        the wind gets up: cat's-paws spread over the water, the mist is blown thin,
 *                 the cloud streams, the far shore stands out
 *   clear         a high clear evening: hardly a cloud, thin air, the ridges sharp and their
 *                 snow catching the sun
 *   mist          the mist thickens and smokes off the water, the far shore goes, and the sun
 *                 stands in it and throws its rays through the trees
 *
 * and round to still again. An air lasts GOLDEN_FOREST_AIR_SECONDS and rests a share of that
 * pure before it melts into the next; with five hours of 120 s and five airs of 96 s the pair
 * comes round only every forty minutes. A function of the time alone, so a seek and an evening
 * lived through agree. Plain numbers and no three.js.
 */
import { moodDrift, wheelAt } from '../shared/mood-clock.js';

/** Seconds from one air to the next. */
export const GOLDEN_FOREST_AIR_SECONDS = 96;
/** The share of its period an air rests, pure, before it melts into the next. */
export const GOLDEN_FOREST_AIR_HOLD = 0.4;

/**
 * What an air sets:
 *   deck     how much of the sky the ceiling of high cloud covers (0: none)
 *   bars     the long bars of evening cloud against the lake as built (1)
 *   mist     how thick the banks on the water lie against rest (1)
 *   smoke    the wisps smoking off the water (0..1)
 *   haze     the density of the air against the hour's (1)
 *   rays     the sun's rays through the trees against rest (1)
 *   wind     breeze added to the resting breeze
 *   ruffle   cat's-paws added to the lake (0: the lee's glass)
 *   clarity  how sharp the far ridges stand, and how much their snow catches (0..1)
 *   drift    how fast the cloud moves against rest (1)
 *   glitter  the sun's road on the water against rest (1)
 */
export const GOLDEN_FOREST_AIR_SCALARS = Object.freeze([
    'deck', 'bars', 'mist', 'smoke', 'haze', 'rays', 'wind', 'ruffle', 'clarity', 'drift', 'glitter',
]);

const air = (name, values) => Object.freeze({ name, ...values });

export const GOLDEN_FOREST_AIRS = Object.freeze([
    air('still', {
        deck: 0, bars: 1, mist: 1, smoke: 0.3, haze: 1, rays: 1, wind: 0, ruffle: 0, clarity: 0.4, drift: 1, glitter: 1,
    }),
    air('burning sky', {
        deck: 0.9,
        bars: 0.45,
        mist: 0.75,
        smoke: 0.1,
        haze: 0.88,
        rays: 1.3,
        wind: 0.03,
        ruffle: 0.06,
        clarity: 0.55,
        drift: 1.8,
        glitter: 0.9,
    }),
    air('breeze', {
        deck: 0.22,
        bars: 0.85,
        mist: 0.3,
        smoke: 0,
        haze: 0.72,
        rays: 0.8,
        wind: 0.2,
        ruffle: 0.55,
        clarity: 0.75,
        drift: 3.2,
        glitter: 1.35,
    }),
    air('clear', {
        deck: 0,
        bars: 0.12,
        mist: 0.45,
        smoke: 0.12,
        haze: 0.56,
        rays: 0.7,
        wind: 0.04,
        ruffle: 0.1,
        clarity: 1,
        drift: 1,
        glitter: 1.1,
    }),
    air('mist', {
        deck: 0.08,
        bars: 0.6,
        mist: 1.9,
        smoke: 1,
        haze: 1.55,
        rays: 1.8,
        wind: 0,
        ruffle: 0,
        clarity: 0.08,
        drift: 0.6,
        glitter: 0.7,
    }),
]);

/** Somewhere to put an air's numbers: a place a caller keeps and fills again. */
export function createGoldenForestAir() {
    const out = {};
    for (const key of GOLDEN_FOREST_AIR_SCALARS) out[key] = GOLDEN_FOREST_AIRS[0][key];
    return out;
}

/**
 * How far the clock alone has turned the airs at `time` (seconds): a whole number while one
 * rests, easing to the next as it melts.
 * @param {number} time
 */
export function goldenForestAirDrift(time) {
    return moodDrift(time, GOLDEN_FOREST_AIR_SECONDS, GOLDEN_FOREST_AIR_HOLD);
}

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The lake's air `phase` airs in (any real number: they come round). Fills `out` with every
 * number of an air, mixed between the two it lies between, and returns it; on a whole phase it
 * is that air exactly.
 * @param {number} phase
 * @param {Record<string, number>} [out]
 */
export function goldenForestAirAt(phase, out = createGoldenForestAir()) {
    wheelAt(phase, GOLDEN_FOREST_AIRS.length, AT);
    const a = GOLDEN_FOREST_AIRS[AT.a];
    const b = GOLDEN_FOREST_AIRS[AT.b];
    for (const key of GOLDEN_FOREST_AIR_SCALARS) {
        // eslint-disable-next-line no-param-reassign
        out[key] = AT.melt > 0 ? a[key] + (b[key] - a[key]) * AT.melt : a[key];
    }
    return out;
}

/**
 * The name of the air a phase is nearest.
 * @param {number} phase
 */
export function goldenForestAirName(phase) {
    const n = GOLDEN_FOREST_AIRS.length;
    const p = Number.isFinite(phase) ? phase : 0;
    return GOLDEN_FOREST_AIRS[((Math.round(p) % n) + n) % n].name;
}

/**
 * The index of an air by name (or by number), for a capture that wants to hold one; -1 if there
 * is no such air.
 * @param {string | number | null | undefined} which
 */
export function goldenForestAirIndex(which) {
    // (Only a number or a string names an air: false, an empty array or a blank would all read as 0.)
    const named = typeof which === 'string' ? which.trim() : which;
    if ((typeof named !== 'number' && typeof named !== 'string') || named === '') return -1;
    const asNumber = Number(named);
    if (Number.isFinite(asNumber)) {
        const n = GOLDEN_FOREST_AIRS.length;
        return ((Math.round(asNumber) % n) + n) % n;
    }
    const wanted = String(which).trim().toLowerCase().replace(/[\s_-]+/g, ' ');
    const joined = wanted.replace(/\s/g, '');
    return GOLDEN_FOREST_AIRS.findIndex((entry) => entry.name === wanted || entry.name.replace(/\s/g, '') === joined);
}
