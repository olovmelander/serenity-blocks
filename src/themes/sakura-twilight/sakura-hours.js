// @ts-check
/**
 * Sakura Twilight — the hours of the garden's night.
 *
 * The moon does not move: the garden is laid out for where it hangs low behind the trees, and
 * its shadows are drawn once. But the night does. Its colours turn through five hours and come
 * round: the last rose of the afterglow the garden opens in, the blue hour when the rose drains
 * to sapphire, the lantern night when the sky has gone to ink and the paper lanterns carry the
 * blossom, the moonlit night when the moon has the garden to itself, and a plum dawn when the far
 * rim pales to apricot and the lanterns burn low. The clock turns them by itself in every mode
 * (shared/mood-clock.js), and every level is one hour on from wherever the clock has brought
 * the night. Plain numbers and no three.js, so the light rig, the tests and a capture share them.
 */
import { meltPalettes, moodDrift, wheelAt } from '../shared/mood-clock.js';

/** Seconds from one hour to the next: a little over nine minutes for the night to come round. */
export const SAKURA_HOUR_SECONDS = 110;
/** The share of its period an hour rests, pure, before it begins to melt into the next. */
export const SAKURA_HOUR_HOLD = 0.35;

/** A colour written as a hex in sRGB, in the linear working space the light rig holds. */
function srgb(hex) {
    return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((byte) => {
        const c = byte / 255;
        return c < 0.04045 ? c * 0.0773993808 : (c * 0.9478672986 + 0.0521327014) ** 2.4;
    });
}

/** The colours an hour sets (linear). */
export const SAKURA_HOUR_COLOURS = Object.freeze([
    'moon', 'zenith', 'vault', 'horizon', 'afterglow', 'ember', 'skyLight', 'bounce', 'lampColor',
    'cloudShade', 'cloudLit',
]);
/**
 * And the numbers: how thick the air and the lake's mist are, how the lanterns burn, how many stars
 * show, the iris, how much of the river of heaven the sky is dark enough to show, and how dense the
 * moon's shafts stand in the air.
 */
export const SAKURA_HOUR_SCALARS = Object.freeze(['haze', 'mist', 'lampGain', 'stars', 'exposure', 'galaxy', 'beams']);

/**
 * The five hours, in the order the night takes them. `moon` is the moonlight; `zenith`, `vault`,
 * `horizon`, `afterglow` and `ember` the sky from overhead down to the band where the sun went
 * down; `skyLight` and `bounce` what the sky and the ground give back; `lampColor` the lanterns'
 * flame; `cloudShade` and `cloudLit` the high cirrus. `exposure` scales the lens's iris.
 */
export const SAKURA_HOURS = Object.freeze([
    {
        // The garden as it opens: indigo overhead, violet air, the last rose where the sun went.
        name: 'afterglow',
        moon: [0.5, 0.66, 1.0],
        zenith: [0.004, 0.006, 0.03],
        vault: [0.028, 0.017, 0.085],
        horizon: [0.07, 0.038, 0.13],
        afterglow: [0.46, 0.12, 0.17],
        ember: [0.85, 0.34, 0.2],
        skyLight: [0.2, 0.11, 0.24],
        bounce: [0.06, 0.035, 0.07],
        lampColor: [2.9, 1.28, 0.4],
        cloudShade: srgb(0x241a3c),
        cloudLit: srgb(0x4a3a6e),
        haze: 0.0018,
        mist: 0.003,
        lampGain: 1,
        stars: 1,
        exposure: 1,
        galaxy: 0.4,
        beams: 1,
    },
    {
        // The rose drains to sapphire: a pale line of the day low in the west, a clear cool moon,
        // the lanterns warm against the blue.
        name: 'blue hour',
        moon: [0.48, 0.72, 1.06],
        zenith: [0.003, 0.009, 0.04],
        vault: [0.012, 0.03, 0.098],
        horizon: [0.028, 0.08, 0.158],
        afterglow: [0.1, 0.235, 0.36],
        ember: [0.42, 0.3, 0.17],
        skyLight: [0.09, 0.15, 0.27],
        bounce: [0.03, 0.045, 0.072],
        lampColor: [3.0, 1.3, 0.38],
        cloudShade: [0.012, 0.022, 0.05],
        cloudLit: [0.04, 0.075, 0.16],
        haze: 0.002,
        mist: 0.0036,
        lampGain: 1.12,
        stars: 0.6,
        exposure: 1,
        galaxy: 0.3,
        beams: 0.9,
    },
    {
        // Yozakura: the sky has gone to ink, the moon is veiled, and the lanterns carry the blossom.
        name: 'lantern night',
        moon: [0.24, 0.32, 0.56],
        zenith: [0.0015, 0.0025, 0.015],
        vault: [0.01, 0.008, 0.04],
        horizon: [0.028, 0.018, 0.06],
        afterglow: [0.09, 0.035, 0.07],
        ember: [0.14, 0.05, 0.03],
        skyLight: [0.088, 0.056, 0.126],
        bounce: [0.036, 0.023, 0.04],
        lampColor: [3.2, 1.32, 0.36],
        cloudShade: [0.008, 0.006, 0.02],
        cloudLit: [0.025, 0.02, 0.055],
        haze: 0.0016,
        mist: 0.0026,
        lampGain: 1.7,
        stars: 1.35,
        exposure: 1.08,
        galaxy: 1,
        beams: 0.6,
    },
    {
        // The moon has the garden: silver light and blue shade, a thin mist on the lake, the sky
        // deep and full of stars.
        name: 'moonlit night',
        moon: [0.82, 0.95, 1.3],
        zenith: [0.002, 0.006, 0.028],
        vault: [0.01, 0.02, 0.062],
        horizon: [0.035, 0.05, 0.1],
        afterglow: [0.07, 0.085, 0.15],
        ember: [0.05, 0.05, 0.07],
        skyLight: [0.1, 0.12, 0.22],
        bounce: [0.03, 0.038, 0.06],
        lampColor: [2.8, 1.3, 0.45],
        cloudShade: [0.014, 0.02, 0.04],
        cloudLit: [0.05, 0.065, 0.11],
        haze: 0.0016,
        mist: 0.0042,
        lampGain: 0.75,
        stars: 1.1,
        exposure: 1,
        galaxy: 0.6,
        beams: 1.7,
    },
    {
        // Akatsuki: the small hours turn plum, the far rim pales to apricot, the moon to lavender;
        // the lanterns burn low and a mist rises off the lake.
        name: 'plum dawn',
        moon: [0.6, 0.56, 0.8],
        zenith: [0.012, 0.014, 0.05],
        vault: [0.06, 0.04, 0.12],
        horizon: [0.22, 0.13, 0.18],
        afterglow: [0.72, 0.36, 0.22],
        ember: [1.1, 0.66, 0.32],
        skyLight: [0.21, 0.14, 0.22],
        bounce: [0.065, 0.042, 0.06],
        lampColor: [2.6, 1.25, 0.5],
        cloudShade: [0.03, 0.018, 0.04],
        cloudLit: [0.12, 0.06, 0.09],
        haze: 0.0021,
        mist: 0.0045,
        lampGain: 0.65,
        stars: 0.3,
        exposure: 0.98,
        galaxy: 0.05,
        beams: 1.25,
    },
].map((hour) => Object.freeze(Object.fromEntries(Object.entries(hour).map(([key, value]) => (
    [key, Array.isArray(value) ? Object.freeze(value) : value]))))));

/** Somewhere to put an hour's colours and numbers: a place a caller keeps and fills again. */
export function createSakuraHour() {
    /** @type {Record<string, any>} */
    const hour = {};
    for (const key of SAKURA_HOUR_COLOURS) hour[key] = [0, 0, 0];
    for (const key of SAKURA_HOUR_SCALARS) hour[key] = 0;
    return hour;
}

/**
 * How far the clock alone has turned the hours at `time` (seconds): a whole number while one
 * rests, easing to the next as it melts. A function of the time and nothing else.
 * @param {number} time
 */
export function sakuraHourDrift(time) {
    return moodDrift(time, SAKURA_HOUR_SECONDS, SAKURA_HOUR_HOLD);
}

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The night's colours `phase` hours in (any real number: the night comes round). On a whole
 * phase it is that hour exactly; between, the colours melt the short way round the colour wheel.
 * @param {number} phase
 * @param {Record<string, any>} [out]
 */
export function sakuraHourAt(phase, out = createSakuraHour()) {
    meltPalettes(SAKURA_HOURS, SAKURA_HOUR_COLOURS, phase, out);
    wheelAt(phase, SAKURA_HOURS.length, AT);
    const a = SAKURA_HOURS[AT.a];
    const b = SAKURA_HOURS[AT.b];
    for (const key of SAKURA_HOUR_SCALARS) {
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
export function sakuraHourName(phase) {
    const n = SAKURA_HOURS.length;
    const p = Number.isFinite(phase) ? phase : 0;
    return SAKURA_HOURS[((Math.round(p) % n) + n) % n].name;
}
