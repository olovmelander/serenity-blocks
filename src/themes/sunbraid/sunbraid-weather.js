/**
 * Sunbraid — the valley's weather and its moon (three-free, pure functions of the clock).
 *
 * The braid turns the light's colours (one turn in 330 s); the weather is a second, slower wheel
 * beside it, so the two never line up the same way twice in a sitting:
 *
 *   clear    the crisp day the theme was made with: a few fibres of high cloud, the fans sharp
 *   cirrus   long streets of ice cloud fan out over the valley from the suns' bearing, each lit
 *            in the colour of the sun it stands before
 *   veil     a thin veil of ice crystals: a pillar of light stands over each sun (three pillars
 *            that cross as the suns wheel: the braid, upright) and faint rings ghost round them
 *   banks    cloud banks tower along the rim, and their shadows cross the plain three times over,
 *            once in each sun's missing colour
 *   rain     a shower hangs from the banks over the far plain
 *   wet      the shower has passed: the plain lies under a film of water and mirrors the sky, the
 *            towers and the suns (three paths of glitter that braid); it dries as the wind rises
 *   wind     the wind is up: streamers of gypsum dust race over the crust and the air thickens
 *
 * The moon: a small dark moon crosses the triple star about every minute and a half, on a path
 * that differs each pass. Where it covers a sun, that sun's light fails for a few seconds and the
 * whole valley turns the colour of the other two (the colour of that sun's shadows): an eclipse
 * here is a change of colour, not of brightness.
 */
import {
    DEG, TAU, clamp, smooth,
} from './sunbraid-core.js';
import { moodDrift, wheelAt } from '../shared/mood-clock.js';

/** Seconds a weather lasts, and the share of it that it rests before melting into the next. */
export const WEATHER_SECONDS = 72;
export const WEATHER_HOLD = 0.42;

/**
 * The weathers, in the order the clock turns them. `cirrus` the high ice cloud (0..1), `banks` the
 * cloud banks along the rim (0..1), `veil` the ice veil (pillars, rings), `rain` the shower under
 * the banks, `wet` the film of water on the plain, `wind` the dust streamers and how fast the air
 * moves, `haze` the air's density (× the rest), `shade` how dark a cloud's shadow lies on the land.
 */
export const WEATHERS = Object.freeze([
    {
        name: 'clear', cirrus: 0.46, banks: 0.16, veil: 0, rain: 0, wet: 0, wind: 0.22, haze: 1, shade: 0.16,
    },
    {
        name: 'cirrus', cirrus: 1, banks: 0.1, veil: 0.22, rain: 0, wet: 0, wind: 0.3, haze: 1, shade: 0.2,
    },
    {
        name: 'veil', cirrus: 0.55, banks: 0.05, veil: 1, rain: 0, wet: 0, wind: 0.08, haze: 1.2, shade: 0.12,
    },
    {
        name: 'banks', cirrus: 0.26, banks: 0.8, veil: 0, rain: 0, wet: 0, wind: 0.34, haze: 1, shade: 0.5,
    },
    {
        name: 'rain', cirrus: 0.12, banks: 1, veil: 0, rain: 1, wet: 0.5, wind: 0.4, haze: 1.3, shade: 0.56,
    },
    {
        name: 'wet', cirrus: 0.45, banks: 0.42, veil: 0.12, rain: 0, wet: 1, wind: 0.1, haze: 0.9, shade: 0.3,
    },
    {
        name: 'wind', cirrus: 0.2, banks: 0.2, veil: 0, rain: 0, wet: 0.08, wind: 1, haze: 1.55, shade: 0.18,
    },
].map((w) => Object.freeze(w)));

export const WEATHER_NAMES = Object.freeze(WEATHERS.map((w) => w.name));
const WEATHER_KEYS = Object.freeze(['cirrus', 'banks', 'veil', 'rain', 'wet', 'wind', 'haze', 'shade']);

/** A weather's index from its name or number (−1 if neither). */
export function weatherIndex(key) {
    if (key === null || key === undefined || key === '') return -1;
    const named = WEATHER_NAMES.indexOf(String(key));
    if (named >= 0) return named;
    const n = Number(key);
    return Number.isInteger(n) && n >= 0 && n < WEATHERS.length ? n : -1;
}

const _wheel = { a: 0, b: 0, melt: 0 };

/**
 * The weather at clock `time`: every number melted between the weather it is leaving and the one it
 * turns into. `hold` (an index) pins one weather (captures). `out` also gets `a`, `b`, `melt`.
 */
export function weatherAt(time, hold = -1, out = {}) {
    if (hold >= 0 && hold < WEATHERS.length) {
        _wheel.a = hold;
        _wheel.b = hold;
        _wheel.melt = 0;
    } else {
        wheelAt(moodDrift(time, WEATHER_SECONDS, WEATHER_HOLD), WEATHERS.length, _wheel);
    }
    const from = WEATHERS[_wheel.a];
    const to = WEATHERS[_wheel.b];
    for (const key of WEATHER_KEYS) out[key] = from[key] + (to[key] - from[key]) * _wheel.melt;
    out.a = _wheel.a;
    out.b = _wheel.b;
    out.melt = _wheel.melt;
    return out;
}

// ── The moon ──────────────────────────────────────────────────────────────────────

/**
 * The moon: its disc's angular radius (a little larger than the largest sun: a sun it crosses is
 * hidden whole for a moment), seconds a pass takes, the stretch of sky a pass crosses (centred on
 * the triple star), how far above or below the cluster's centre a pass may run, how far its path
 * may tilt, and how much of a covered sun's light it takes.
 */
export const MOON = Object.freeze({
    radius: 1.7 * DEG,
    period: 97,
    span: 66 * DEG,
    reach: 4.6 * DEG,
    tilt: 0.16,
    depth: 0.97,
});

const hash1 = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
};

/**
 * Where the moon stands at clock `time`, given the cluster's centre (radians): azimuth and
 * elevation, the pass's number and how far through it (0..1).
 */
export function moonAt(time, centreAz, centreEl, out = {
    az: 0, el: 0, pass: 0, phase: 0,
}) {
    const turns = Math.max(0, time) / MOON.period;
    const pass = Math.floor(turns);
    const phase = turns - pass;
    const across = (phase - 0.5) * MOON.span;
    // Each pass has its own height over the cluster's centre and its own tilt.
    const offset = (hash1(pass) * 2 - 1) * MOON.reach;
    const tilt = (hash1(pass + 0.5) * 2 - 1) * MOON.tilt;
    out.az = centreAz + across;
    out.el = centreEl + offset + tilt * across;
    out.pass = pass;
    out.phase = phase;
    return out;
}

/**
 * The share of a disc of radius `rs` hidden by a disc of radius `rm` whose centre is `sep` away
 * (all angles, radians): the lens two circles share, over the first disc's area.
 */
export function discCover(sep, rs, rm) {
    if (!(rs > 0) || !(rm > 0)) return 0;
    const d = Math.abs(sep);
    if (d >= rs + rm) return 0;
    if (d <= Math.abs(rm - rs)) return rm >= rs ? 1 : (rm * rm) / (rs * rs);
    const a = Math.acos(clamp((d * d + rs * rs - rm * rm) / (2 * d * rs), -1, 1));
    const b = Math.acos(clamp((d * d + rm * rm - rs * rs) / (2 * d * rm), -1, 1));
    const lens = rs * rs * (a - Math.sin(2 * a) / 2) + rm * rm * (b - Math.sin(2 * b) / 2);
    return clamp(lens / (Math.PI * rs * rs), 0, 1);
}

/** The angle between two directions given as (azimuth, elevation), radians. */
export function angleBetween(az0, el0, az1, el1) {
    const c = Math.sin(el0) * Math.sin(el1) + Math.cos(el0) * Math.cos(el1) * Math.cos(az0 - az1);
    return Math.acos(clamp(c, -1, 1));
}

/** How visible the moon is on its pass (it fades in from the rim's haze and out again). */
export function moonSeen(phase) {
    return smooth(0.02, 0.1, phase) * smooth(0.98, 0.9, phase);
}

export { TAU };
