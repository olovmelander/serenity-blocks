/**
 * Forest — the airs of the night.
 *
 * The hours (forest-hours.js) turn the night's colours; the airs turn the weather under them, on
 * a clock of their own, so the same hour is never long the same night:
 *
 *   still          the night as it opens: thin mist in the hollow, clean beams through the
 *                  boughs, fireflies each on its own clock
 *   rising mist    the mist comes up out of the valley and fills the ride; the moon stands in
 *                  it and its beams widen into pillars; the far stands go
 *   night wind     the wind gets up: the boughs heave in long swells, the mist is torn off the
 *                  floor and streams, cloud races, dust and seeds blow through the beams
 *   clouded moon   cloud comes over the moon and the wood goes dark, and what glows by itself
 *                  takes the night: the fungi, the foxfire in the moss, the fireflies
 *   the dance      the cloud clears to a starry sky and the fireflies fall into step by
 *                  themselves, flashing in slow waves that roll out through the trees
 *
 * and round to still again. An air lasts FOREST_AIR_SECONDS and rests a share of that pure
 * before it melts into the next; with five hours of 120 s and five airs of 96 s a pairing comes
 * round only every forty minutes. A function of the time alone, so a seek and a night lived
 * through agree. Plain numbers and no three.js.
 */
import { moodDrift, wheelAt } from '../shared/mood-clock.js';

/** Seconds from one air to the next. */
export const FOREST_AIR_SECONDS = 96;
/** The share of its period an air rests, pure, before it melts into the next. */
export const FOREST_AIR_HOLD = 0.4;

/**
 * What an air sets:
 *   mist     how thick the night air is against the hour's (1)
 *   banks    how thick the banks of mist on the floor lie against rest (1)
 *   drift    how fast the banks and the cloud move against rest (1)
 *   rays     the moonbeams through the boughs against rest (1)
 *   wind     wind added to the resting night air
 *   veil     how much of the moon the cloud takes (0: none, 1: all of it)
 *   cloud    how much of the sky the cloud covers (0: the thin streaks the night opens with)
 *   life     how brightly the wood's own cold light burns at rest: fungi, foxfire, moss (0..1)
 *   dance    how far the fireflies fall into step by themselves (0..1)
 *   motes    moths, dust and seeds in the beams against rest (1)
 *   stars    how many stars show against the hour's (1)
 *   spores   spores the fungi let go by themselves, bursts a second across the wood
 */
export const FOREST_AIR_SCALARS = Object.freeze([
    'mist', 'banks', 'drift', 'rays', 'wind', 'veil', 'cloud', 'life', 'dance', 'motes', 'stars', 'spores',
]);

const air = (name, values) => Object.freeze({ name, ...values });

export const FOREST_AIRS = Object.freeze([
    air('still', {
        mist: 1,
        banks: 1,
        drift: 1,
        rays: 1,
        wind: 0,
        veil: 0,
        cloud: 0,
        life: 0.14,
        dance: 0,
        motes: 1,
        stars: 1,
        spores: 0.25,
    }),
    air('rising mist', {
        mist: 1.75,
        banks: 2.1,
        drift: 0.7,
        rays: 1.55,
        wind: 0,
        veil: 0.06,
        cloud: 0.2,
        life: 0.3,
        dance: 0.08,
        motes: 0.5,
        stars: 0.4,
        spores: 0.4,
    }),
    air('night wind', {
        mist: 0.62,
        banks: 0.5,
        drift: 4.2,
        rays: 0.92,
        wind: 0.34,
        veil: 0.12,
        cloud: 0.5,
        life: 0.1,
        dance: 0,
        motes: 2.4,
        stars: 0.9,
        spores: 0,
    }),
    air('clouded moon', {
        mist: 1.08,
        banks: 1.05,
        drift: 1.5,
        rays: 0.16,
        wind: 0.06,
        veil: 0.82,
        cloud: 1,
        life: 1,
        dance: 0.22,
        motes: 0.25,
        stars: 0.08,
        spores: 1.4,
    }),
    air('the dance', {
        mist: 0.8,
        banks: 0.85,
        drift: 1,
        rays: 1.1,
        wind: 0,
        veil: 0,
        cloud: 0.04,
        life: 0.42,
        // (About half of them: the rest keep their own clocks, so the wood is never all dark between waves.)
        dance: 0.5,
        motes: 1,
        stars: 1.3,
        spores: 0.6,
    }),
]);

/** Somewhere to put an air's numbers: a place a caller keeps and fills again. */
export function createForestAir() {
    const out = {};
    for (const key of FOREST_AIR_SCALARS) out[key] = FOREST_AIRS[0][key];
    return out;
}

/**
 * How far the clock alone has turned the airs at `time` (seconds): a whole number while one
 * rests, easing to the next as it melts.
 * @param {number} time
 */
export function forestAirDrift(time) {
    return moodDrift(time, FOREST_AIR_SECONDS, FOREST_AIR_HOLD);
}

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The night's air `phase` airs in (any real number: they come round). Fills `out` with every
 * number of an air, mixed between the two it lies between, and returns it; on a whole phase it
 * is that air exactly.
 * @param {number} phase
 * @param {Record<string, number>} [out]
 */
export function forestAirAt(phase, out = createForestAir()) {
    wheelAt(phase, FOREST_AIRS.length, AT);
    const a = FOREST_AIRS[AT.a];
    const b = FOREST_AIRS[AT.b];
    for (const key of FOREST_AIR_SCALARS) {
        // eslint-disable-next-line no-param-reassign
        out[key] = AT.melt > 0 ? a[key] + (b[key] - a[key]) * AT.melt : a[key];
    }
    return out;
}

/**
 * The name of the air a phase is nearest.
 * @param {number} phase
 */
export function forestAirName(phase) {
    const n = FOREST_AIRS.length;
    const p = Number.isFinite(phase) ? phase : 0;
    return FOREST_AIRS[((Math.round(p) % n) + n) % n].name;
}

/**
 * The index of an air by name (or by number), for a capture that wants to hold one; -1 if there
 * is no such air.
 * @param {string | number | null | undefined} which
 */
export function forestAirIndex(which) {
    // (Only a number or a string names an air: false, an empty array or a blank would all read as 0.)
    const named = typeof which === 'string' ? which.trim() : which;
    if ((typeof named !== 'number' && typeof named !== 'string') || named === '') return -1;
    const asNumber = Number(named);
    if (Number.isFinite(asNumber)) {
        const n = FOREST_AIRS.length;
        return ((Math.round(asNumber) % n) + n) % n;
    }
    const wanted = String(which).trim().toLowerCase().replace(/[\s_-]+/g, ' ');
    const joined = wanted.replace(/\s/g, '');
    return FOREST_AIRS.findIndex((entry) => entry.name === wanted || entry.name.replace(/\s/g, '') === joined);
}
