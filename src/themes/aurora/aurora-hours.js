/**
 * The hours of the aurora night: the light the display hangs in turns by the clock.
 *
 * A polar night over the lake is not one light. Under the display's own weather
 * (aurora-weather.js: stretches of arc that flare and fade, folds that breathe) the night
 * itself moves on: a quiet green night, a night whose rays stand tall under a red oxygen
 * crown, the deep middle of the night when the display lies low and the Milky Way is at its
 * brightest, the moon risen behind the eye silvering the snow and paling the sky, and the
 * blue hour of early night, a twilight rim along the horizon and the tops of the rays still
 * in sunlight, blue-violet. Each hour rests HOUR_HOLD of HOUR_SECONDS, then melts into the
 * next (src/themes/shared/mood-clock.js), so a whole night comes round in about nine minutes,
 * in every mode: the clock is the world's (the theme's time, which a restart carries), never
 * an event. A level-up moves the night one hour on, eased over a few seconds, on top of the
 * clock; its burst (aurora-director.js cueLevelUp) plays as it always has.
 *
 * Hour 0 is the night the theme has always shown: every value in it is the constant the
 * shaders used before (AURORA_COLORS, the curtain bases in aurora-director.js), so the theme
 * opens exactly as it did.
 *
 * Colours are scene-linear. Plain numbers: no three, no DOM, no timers.
 */
import {
    easeStep, meltPalettes, moodDrift, wheelAt,
} from '../shared/mood-clock.js';
import { AURORA_COLORS } from './aurora-palette.js';

/** Seconds an hour lasts on the clock alone (Sunfall's stations take 110 too). */
export const HOUR_SECONDS = 110;
/** The share of an hour seen pure before it melts into the next. */
export const HOUR_HOLD = 0.35;
/** Seconds (1/e) a level's step takes to ease in: most of the way in about six seconds. */
export const LEVEL_EASE = 2.2;
const DEG = Math.PI / 180;
/** Where the moon stands: over the range left of the board, a third of the way up the sky. */
const MOON_AZIMUTH = -24 * DEG;
const MOON_ELEVATION = 32 * DEG;
/** A unit vector toward the moon (x right, y up, -z ahead). */
export const MOON_DIRECTION = Object.freeze([
    Math.cos(MOON_ELEVATION) * Math.sin(MOON_AZIMUTH),
    Math.sin(MOON_ELEVATION),
    -Math.cos(MOON_ELEVATION) * Math.cos(MOON_AZIMUTH),
]);
/** The moon's angular radius, radians: drawn a little large, as the eye sees it low. */
export const MOON_RADIUS = 0.75 * DEG;

/**
 * The night's colours, per hour:
 *   skyZenith, skyHorizon  the dome's gradient (and the haze, which takes the horizon)
 *   airglow                the low band along the horizon: green airglow, or the twilight rim
 *   skylight               the cold fill every surface takes from the whole sky
 *   mistLight              the light the cold mist over the water scatters
 *   moonLight              moonlight on whatever faces the moon (MOON_DIRECTION): tops and
 *                          ridges catch it, the slopes turned to the eye stay in blue shadow
 *   glow                   the light a resting display throws on snow and water
 */
export const HOUR_COLOURS = Object.freeze([
    'skyZenith', 'skyHorizon', 'airglow', 'skylight', 'mistLight', 'moonLight', 'glow',
]);
/**
 * And its numbers: `stars` and `galaxy` scale the star field and the Milky Way; `moon` how
 * much of the moon's disc and the glow round it stand in the sky; `gain` and `height` scale
 * the resting arcs' brightness and the height of their rays; `crown`, `violet` and `fringe`
 * add to the resting red crown, blue-violet ray tops and pink hem.
 */
export const HOUR_SCALARS = Object.freeze([
    'stars', 'galaxy', 'moon', 'gain', 'height', 'crown', 'violet', 'fringe',
]);

const hour = (name, values) => Object.freeze({
    name,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key, Array.isArray(value) ? Object.freeze([...value]) : value,
    ])),
});

export const AURORA_HOURS = Object.freeze([
    // Today's night, exactly: a quiet green display over a dark blue sky.
    hour('Quiet night', {
        skyZenith: AURORA_COLORS.skyZenith,
        skyHorizon: AURORA_COLORS.skyHorizon,
        airglow: AURORA_COLORS.airglow,
        skylight: [0.013, 0.022, 0.047],
        mistLight: [0.009, 0.017, 0.034],
        moonLight: [0, 0, 0],
        glow: [0.03, 0.105, 0.07],
        stars: 1,
        galaxy: 1,
        moon: 0,
        gain: 1,
        height: 1,
        crown: 0,
        violet: 0,
        fringe: 0,
    }),
    // The display wakes on its own: tall rays under a red oxygen crown, a pink hem, the snow
    // and the water taking a warmer light from it; the brighter sky hides the faintest stars.
    hour('Crowned night', {
        skyZenith: [0.0026, 0.0038, 0.019],
        skyHorizon: [0.0085, 0.016, 0.042],
        airglow: [0.012, 0.02, 0.016],
        skylight: [0.013, 0.021, 0.045],
        mistLight: [0.011, 0.017, 0.032],
        moonLight: [0, 0, 0],
        glow: [0.05, 0.11, 0.07],
        stars: 0.9,
        galaxy: 0.75,
        moon: 0,
        gain: 1.12,
        height: 1.18,
        crown: 0.24,
        violet: 0.02,
        fringe: 0.08,
    }),
    // The middle of the night: the display lies low and quiet, the green airglow stands on
    // the horizon and the Milky Way and the stars are at their brightest.
    hour('Deep midnight', {
        skyZenith: [0.0021, 0.0035, 0.017],
        skyHorizon: [0.0065, 0.0145, 0.037],
        airglow: [0.0095, 0.027, 0.017],
        skylight: [0.011, 0.019, 0.042],
        mistLight: [0.008, 0.015, 0.03],
        moonLight: [0, 0, 0],
        glow: [0.024, 0.085, 0.058],
        stars: 1.3,
        galaxy: 1.7,
        moon: 0,
        gain: 0.74,
        height: 0.92,
        crown: -0.04,
        violet: -0.03,
        fringe: -0.02,
    }),
    // The moon has risen over the range: a small pale disc left of the board and its glow in
    // the sky, its light silvering the snow on every top and ridge (the slopes turned to the
    // eye stay in blue shadow); the lit sky hides the faint stars and most of the Milky Way,
    // and the display against it is a little paler. Kept soft: moonlight, never a milky wash
    // or a blinding moon. It fades in and out with the hour's melt, over about a minute.
    hour('Moonlit night', {
        skyZenith: [0.0062, 0.0118, 0.041],
        skyHorizon: [0.0145, 0.029, 0.064],
        airglow: [0.008, 0.018, 0.026],
        skylight: [0.018, 0.031, 0.063],
        mistLight: [0.012, 0.021, 0.04],
        moonLight: [0.07, 0.077, 0.092],
        glow: [0.026, 0.09, 0.068],
        stars: 0.55,
        galaxy: 0.3,
        moon: 1,
        gain: 0.86,
        height: 1,
        crown: -0.03,
        violet: 0,
        fringe: -0.02,
    }),
    // Early night, the blue hour: the sky still a luminous deep blue, brightest in a twilight
    // rim along the horizon, the snow under it blue, few stars yet, and the tops of the rays
    // still in sunlight, glowing blue-violet over the green.
    hour('Blue hour', {
        skyZenith: [0.0042, 0.0095, 0.042],
        skyHorizon: [0.012, 0.036, 0.11],
        airglow: [0.016, 0.05, 0.15],
        skylight: [0.014, 0.03, 0.085],
        mistLight: [0.011, 0.023, 0.055],
        moonLight: [0, 0, 0],
        glow: [0.03, 0.1, 0.085],
        stars: 0.6,
        galaxy: 0.55,
        moon: 0,
        gain: 0.96,
        height: 1.08,
        crown: -0.02,
        violet: 0.4,
        fringe: 0,
    }),
]);

/** How far the clock alone has turned the night by `clock` seconds (whole hours + the melt). */
export function hourDrift(clock) {
    return moodDrift(clock, HOUR_SECONDS, HOUR_HOLD);
}

/**
 * The night at `phase` (whole hours round AURORA_HOURS, the fraction a melt into the next):
 * colours melt the short way round the colour wheel, numbers straight. Writes into `out`.
 * @param {number} phase
 * @param {{ colours?: Record<string, number[]>, [key: string]: any }} [out]
 */
export function hourAt(phase, out = {}) {
    out.colours = meltPalettes(AURORA_HOURS, HOUR_COLOURS, phase, out.colours || {});
    const at = wheelAt(phase, AURORA_HOURS.length);
    const a = AURORA_HOURS[at.a];
    const b = AURORA_HOURS[at.b];
    for (const key of HOUR_SCALARS) out[key] = a[key] + (b[key] - a[key]) * at.melt;
    out.name = at.melt < 0.5 ? a.name : b.name;
    return out;
}

export class AuroraHours {
    constructor() {
        this.colours = {};
        this.reset();
    }

    /** Back to the first hour, no level stepped. */
    reset() {
        /** Hours the levels have moved the night on (an integer; the clock adds its own). */
        this.levelSteps = 0;
        /** The levels' step as shown: it eases toward `levelSteps` the short way round. */
        this.step = 0;
        this.clock = 0;
        this.apply(0);
    }

    /** A level: the night moves one hour on, eased in over the next few seconds. */
    levelUp() {
        this.levelSteps += 1;
    }

    /** Stand the levels' step at `steps` at once (a restart carrying its run, a replay). */
    setLevelSteps(steps) {
        const n = Math.max(0, Math.round(Number(steps) || 0));
        this.levelSteps = n;
        this.step = n;
        this.apply(this.step + hourDrift(this.clock));
    }

    /**
     * Advance the level's ease by `dt` seconds and stand the night where the clock has brought
     * it: a pure function of `clock` and the eased step, so a seek and a replay agree.
     */
    update(dt, clock) {
        const k = dt > 0 ? 1 - Math.exp(-dt / LEVEL_EASE) : 0;
        this.step = easeStep(this.step, this.levelSteps, k, AURORA_HOURS.length);
        this.clock = Number.isFinite(clock) ? Math.max(0, clock) : 0;
        this.apply(this.step + hourDrift(this.clock));
    }

    apply(phase) {
        this.phase = phase;
        hourAt(phase, this);
    }
}
