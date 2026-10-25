// @ts-check
/**
 * Crystal Cave — the hours above the cave.
 *
 * The hall has one window on the world: the chimney in the vault, whose shaft of light falls to
 * the pool. The cave keeps its stones and its baked light, but what comes down the chimney
 * turns with the day above, and the hall answers it: the pale shaft of a grey day the cave
 * opens in, the noon sun standing in the chimney, a low amber evening, a moonlit night when the
 * crystals' own glow leads, and the glow-worm night when the shaft has all but gone and the vault
 * is full of the worms' blue-green stars. The clock turns them by itself in every mode
 * (shared/mood-clock.js), and every level is one hour on from wherever the clock has brought
 * the day.
 *
 * Plain numbers and no three.js: the world writes them into the cave's light each frame, and
 * the tests share them. `sky` tints the skylight (the shaft in the air, its light baked on the
 * rock, its lobe in the crystals' far field) and `skyGain` scales it; `stones` is how strongly
 * the crystals glow and light the rock and the air; `worms` wakes the glow-worms; `haze` is the
 * cave air's colour (outright, linear) and `hazeDensity` scales its thickness; `pool` scales
 * the light the pool throws up the walls; `exposure` the lens's iris.
 */
import { meltPalettes, moodDrift, wheelAt } from '../shared/mood-clock.js';

/** Seconds from one hour to the next: a little over eight minutes for the day to come round. */
export const CRYSTAL_CAVE_HOUR_SECONDS = 100;
/** The share of its period an hour rests, pure, before it begins to melt into the next. */
export const CRYSTAL_CAVE_HOUR_HOLD = 0.35;
/** How quickly the cave takes a level's step, per second: most of the way in four seconds. */
export const CRYSTAL_CAVE_HOUR_FOLLOW = 0.6;

/** A colour written as a hex in sRGB, in the linear working space the cave's light holds. */
function srgb(hex) {
    return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((byte) => {
        const c = byte / 255;
        return c < 0.04045 ? c * 0.0773993808 : (c * 0.9478672986 + 0.0521327014) ** 2.4;
    });
}

export const CRYSTAL_CAVE_HOUR_COLOURS = Object.freeze(['sky', 'haze']);
export const CRYSTAL_CAVE_HOUR_SCALARS = Object.freeze([
    'skyGain', 'stones', 'worms', 'hazeDensity', 'pool', 'exposure',
]);

export const CRYSTAL_CAVE_HOURS = Object.freeze([
    {
        // The cave as it opens: a pale cool shaft of grey day, the stones glowing as they always have.
        name: 'pale day',
        sky: [1, 1, 1],
        haze: srgb(0x0b1626),
        skyGain: 1,
        stones: 1,
        worms: 0,
        hazeDensity: 1,
        pool: 1,
        exposure: 1,
    },
    {
        // The noon sun stands in the chimney: a warm white blaze down the shaft and on the wet
        // stone round it, a little daylight in the air, the stones' own glow modest beside it.
        name: 'noon blaze',
        sky: [1.25, 1.0, 0.62],
        haze: [0.0075, 0.0105, 0.0165],
        skyGain: 1.12,
        stones: 0.85,
        worms: 0,
        hazeDensity: 1.1,
        pool: 1.1,
        exposure: 0.94,
    },
    {
        // A low amber evening: the shaft turns honey and rose, the air dusky, the first
        // glow-worms waking on the vault.
        name: 'amber evening',
        sky: [1.45, 0.72, 0.4],
        haze: [0.0068, 0.0052, 0.0118],
        skyGain: 1.05,
        stones: 1.05,
        worms: 0.35,
        hazeDensity: 1.05,
        pool: 0.95,
        exposure: 1,
    },
    {
        // Moonlight in the chimney: a thin silver-blue beam, the air deep blue, and the crystals'
        // own glow leads.
        name: 'moonlit cave',
        sky: [0.58, 0.72, 1.12],
        haze: [0.002, 0.0055, 0.016],
        skyGain: 0.45,
        stones: 1.3,
        worms: 0.9,
        hazeDensity: 0.95,
        pool: 1.1,
        exposure: 1.06,
    },
    {
        // The glow-worm night: the shaft all but gone, the vault full of the worms' blue-green
        // stars, the stones and the pool lighting the hall by themselves.
        name: 'glow-worm night',
        sky: [0.5, 0.62, 1.0],
        haze: [0.0015, 0.0075, 0.011],
        skyGain: 0.12,
        stones: 1.4,
        worms: 1.7,
        hazeDensity: 0.9,
        pool: 1.35,
        exposure: 1.1,
    },
].map((hour) => Object.freeze(Object.fromEntries(Object.entries(hour).map(([key, value]) => (
    [key, Array.isArray(value) ? Object.freeze(value) : value]))))));

/** Somewhere to put an hour's colours and numbers: a place a caller keeps and fills again. */
export function createCrystalCaveHour() {
    /** @type {Record<string, any>} */
    const hour = {};
    for (const key of CRYSTAL_CAVE_HOUR_COLOURS) hour[key] = [0, 0, 0];
    for (const key of CRYSTAL_CAVE_HOUR_SCALARS) hour[key] = 0;
    return hour;
}

/**
 * How far the clock alone has turned the hours at `time` (seconds): a whole number while one
 * rests, easing to the next as it melts. A function of the time and nothing else.
 * @param {number} time
 */
export function crystalCaveHourDrift(time) {
    return moodDrift(time, CRYSTAL_CAVE_HOUR_SECONDS, CRYSTAL_CAVE_HOUR_HOLD);
}

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The cave's light `phase` hours in (any real number: the day comes round). On a whole phase it
 * is that hour exactly; between, the colours melt the short way round the colour wheel.
 * @param {number} phase
 * @param {Record<string, any>} [out]
 */
export function crystalCaveHourAt(phase, out = createCrystalCaveHour()) {
    meltPalettes(CRYSTAL_CAVE_HOURS, CRYSTAL_CAVE_HOUR_COLOURS, phase, out);
    wheelAt(phase, CRYSTAL_CAVE_HOURS.length, AT);
    const a = CRYSTAL_CAVE_HOURS[AT.a];
    const b = CRYSTAL_CAVE_HOURS[AT.b];
    for (const key of CRYSTAL_CAVE_HOUR_SCALARS) {
        const from = /** @type {number} */ (a[key]);
        const to = /** @type {number} */ (b[key]);
        // eslint-disable-next-line no-param-reassign
        out[key] = from + (to - from) * AT.melt;
    }
    return out;
}

/**
 * The name of the hour a phase is nearest.
 * @param {number} phase
 */
export function crystalCaveHourName(phase) {
    const n = CRYSTAL_CAVE_HOURS.length;
    const p = Number.isFinite(phase) ? phase : 0;
    return CRYSTAL_CAVE_HOURS[((Math.round(p) % n) + n) % n].name;
}
