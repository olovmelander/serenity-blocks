/**
 * Fall — the airs of the grove.
 *
 * The lights of fall-moods.js change the grove's colour. The airs change what is IN it and how it
 * moves: the weather. Five follow one another and come round, on a clock of their own beside the
 * lights' (83 s an air against 110 s a light: the two wheels come back to the same pairing only
 * after two and a half hours, so the same light is met in a different air each time):
 *
 *   still gold        the grove as it was built: a light breeze, a leaf now and then, dust in the shafts
 *   ground mist       the air stands; mist lies thick between the trunks and the shafts are long
 *                     and solid in it; the far wood is gone
 *   windy day         the mist is blown away: boughs and grass work, the leaves stream by on the
 *                     slant, scud races under the cloud deck
 *   sun shower        the cloud closes but the sun stays out under it: fine rain falls through the
 *                     light, the floor darkens and shines, the path holds puddles of sky
 *   the great fall    not a breath, and the crowns let go everywhere at once: leaves coming down
 *                     through the whole wood, slowly
 *
 * and from the great fall back into still gold. Like the lights, an air rests a share of its period
 * pure and then melts into the next, and a level is one air on from wherever the clock has brought
 * the grove. The first air is the neutral one: every number of it is the rest the grove was built
 * with, so a session opens on the grove as it always did.
 *
 * Plain numbers and no three.js, so the light rig, the world, the tests and a capture share them.
 */
import { moodDrift, wheelAt } from '../shared/mood-clock.js';

/** Seconds from one air to the next (it does not divide the lights' 110 s). */
export const FALL_AIR_SECONDS = 83;
/** The share of its period an air rests, pure, before it melts into the next. */
export const FALL_AIR_HOLD = 0.42;

/**
 * What an air sets:
 *   mist      0..1  ground fog between the trunks (the haze thickens low down, the banks fill)
 *   wind      the steady wind at rest (the grove was built at 0.3)
 *   gusts     0..1  how hard the wind comes in waves
 *   rain      0..1  rain falling
 *   wet       0..1  how wet the floor and the bark are (it outlasts the rain into the next air)
 *   shed      0..1  how fast the crowns let their leaves go
 *   cover     0..1  how far the cloud deck has closed
 *   scud      0..1  fast low cloud racing under the deck
 *   dust      the sun motes against rest (1)
 *   sun       the sun's strength against rest (1)
 *   shafts    the shafts' strength against rest (1)
 *   exposure  the lens against rest (1)
 */
export const FALL_AIR_SCALARS = Object.freeze([
    'mist', 'wind', 'gusts', 'rain', 'wet', 'shed', 'cover', 'scud', 'dust', 'sun', 'shafts', 'exposure',
]);

const air = (name, values) => Object.freeze({ name, ...values });

export const FALL_AIRS = Object.freeze([
    air('still gold', {
        mist: 0,
        wind: 0.3,
        gusts: 0,
        rain: 0,
        wet: 0,
        shed: 0,
        cover: 0,
        scud: 0,
        dust: 1,
        sun: 1,
        shafts: 1,
        exposure: 1,
    }),
    air('ground mist', {
        mist: 1,
        wind: 0.12,
        gusts: 0,
        rain: 0,
        wet: 0.12,
        shed: 0.06,
        cover: 0.12,
        scud: 0,
        dust: 0.45,
        sun: 0.94,
        shafts: 1.7,
        exposure: 1.03,
    }),
    air('windy day', {
        mist: 0,
        wind: 1.05,
        gusts: 1,
        rain: 0,
        wet: 0,
        shed: 0.8,
        cover: 0.3,
        scud: 1,
        dust: 1.5,
        sun: 1.04,
        shafts: 0.9,
        exposure: 0.99,
    }),
    air('sun shower', {
        mist: 0.22,
        wind: 0.44,
        gusts: 0.3,
        rain: 1,
        wet: 1,
        shed: 0.18,
        cover: 0.78,
        scud: 0.35,
        dust: 0.15,
        sun: 0.9,
        shafts: 1.3,
        exposure: 1.01,
    }),
    air('the great fall', {
        mist: 0.1,
        wind: 0.08,
        gusts: 0,
        rain: 0,
        wet: 0.2,
        shed: 1,
        cover: 0.05,
        scud: 0,
        dust: 1.25,
        sun: 1.03,
        shafts: 1.15,
        exposure: 1,
    }),
]);

/** Somewhere to put an air's numbers: a place a caller keeps and fills again. */
export function createFallAir() {
    const out = {};
    for (const key of FALL_AIR_SCALARS) out[key] = FALL_AIRS[0][key];
    return out;
}

/**
 * How far the clock alone has turned the airs at `time` (seconds): a whole number while one rests,
 * easing to the next as it melts. A function of the time alone.
 * @param {number} time
 */
export function fallAirDrift(time) {
    return moodDrift(time, FALL_AIR_SECONDS, FALL_AIR_HOLD);
}

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The grove's air `phase` airs in (any real number: the wheel comes round). Fills `out` with every
 * number of an air, mixed between the two it lies between; on a whole phase it is that air exactly.
 * @param {number} phase
 * @param {Record<string, number>} [out]
 */
export function fallAirAt(phase, out = createFallAir()) {
    wheelAt(phase, FALL_AIRS.length, AT);
    const a = FALL_AIRS[AT.a];
    const b = FALL_AIRS[AT.b];
    for (const key of FALL_AIR_SCALARS) {
        // eslint-disable-next-line no-param-reassign
        out[key] = AT.melt > 0 ? a[key] + (b[key] - a[key]) * AT.melt : a[key];
    }
    return out;
}

/**
 * The name of the air a phase is nearest.
 * @param {number} phase
 */
export function fallAirName(phase) {
    const n = FALL_AIRS.length;
    const p = Number.isFinite(phase) ? phase : 0;
    return FALL_AIRS[((Math.round(p) % n) + n) % n].name;
}

/**
 * What this pass's own things scale by tier (the columns of FALL_TIERS are the grove's first pass):
 *   caps       mushrooms in all (clusters of several kinds)
 *   fireflies  the lights that come out at dusk, at night and in a combo
 *   dust       sun motes against the tier's own `motes`
 *   rain       falling drops drawn in a shower
 *   threads    gossamer against the tier's own `gossamer`
 *   stars      draw the night's stars
 *   geese, jays, acorns   the most of each a happening brings
 */
const WORLD_COLUMNS = ['caps', 'fireflies', 'dust', 'rain', 'threads', 'stars', 'geese', 'jays', 'acorns'];
const WORLD_ROWS = {
    Extreme: [150, 96, 2.6, 1500, 0.3, true, 17, 3, 9],
    Ultra: [130, 80, 2.4, 1300, 0.3, true, 15, 3, 8],
    High: [110, 64, 2.2, 1100, 0.28, true, 13, 2, 8],
    Medium: [80, 44, 1.8, 760, 0.25, true, 11, 2, 6],
    Low: [50, 26, 1.5, 420, 0.25, true, 9, 2, 5],
    Minimal: [30, 14, 1.3, 240, 0, true, 7, 1, 4],
};

export const FALL_WORLD_TIERS = Object.freeze(Object.fromEntries(Object.entries(WORLD_ROWS).map(([name, row]) => [
    name,
    Object.freeze(Object.fromEntries(WORLD_COLUMNS.map((key, index) => [key, row[index]]))),
])));

/** This pass's numbers for a quality tier (High for an unknown one). */
export function fallWorldTier(quality) {
    return FALL_WORLD_TIERS[quality] || FALL_WORLD_TIERS.High;
}
