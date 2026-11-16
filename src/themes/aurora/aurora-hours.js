/**
 * The hours of the aurora night: the light the display hangs in turns by the clock.
 *
 * A polar night over the lake is not one light. Under the display's own weather
 * (aurora-weather.js: stretches of arc that flare and fade, folds that breathe) the night
 * itself moves on: a quiet green night; a night whose rays stand tall under a red oxygen
 * crown; the rare rose night, when the whole display burns red and pink over a green hem and
 * the snow blushes under it; the deep middle of the night, when the display lies low and the
 * Milky Way is at its brightest; the moon rising over the range and climbing, silvering the
 * snow, laying its path on the water and paling the sky; and the blue hour, a twilight rim
 * along the horizon, ice fog on the lake and the display turned teal under blue-violet tops.
 * Each hour rests HOUR_HOLD of HOUR_SECONDS, then melts into the next
 * (src/themes/shared/mood-clock.js), so a whole night comes round in ten minutes, in every
 * mode: the clock is the world's (the theme's time, which a restart carries), never an event.
 * A level-up moves the night one hour on, eased over a few seconds, on top of the clock; its
 * burst (aurora-director.js cueLevelUp) plays as it always has.
 *
 * The same phase turns the sky itself: the stars and the Milky Way wheel round the pole
 * SKY_TURN an hour (so a level-up is seen as a short time-lapse of the night moving on), and
 * the moon rides its own arc through its hour (moonRise).
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

/** Seconds an hour lasts on the clock alone: six of them, a night of ten minutes. */
export const HOUR_SECONDS = 100;
/** The share of an hour seen pure before it melts into the next. */
export const HOUR_HOLD = 0.35;
/** Seconds (1/e) a level's step takes to ease in: most of the way in about six seconds. */
export const LEVEL_EASE = 2.2;
const DEG = Math.PI / 180;
/**
 * The moon's arc through its hour: it comes up from behind the range left of the board, low
 * enough at first that the lake mirrors it, and climbs to a third of the way up the sky,
 * drifting toward the board as it goes. [azimuth, elevation] at its rising and at its height.
 */
const MOON_RISING = Object.freeze([-33 * DEG, 5 * DEG]);
const MOON_HIGH = Object.freeze([-17 * DEG, 32 * DEG]);
/** The share of an hour before its own that the moon is already on its way up. */
const MOON_LEAD = 1 - HOUR_HOLD;
/**
 * Radians the stars and the Milky Way turn round the pole with each hour of the night: slow
 * enough that the drift is felt, not watched, and paced so the Milky Way stands clear to the
 * left of a centred board in the deep midnight of the first night, when it is brightest (it
 * goes on round: the second night finds it on the other side).
 */
export const SKY_TURN = 10 * DEG;
/** The pole the sky turns round: due north (straight ahead), as high as the latitude. */
export const SKY_POLE = Object.freeze([0, Math.sin(67 * DEG), -Math.cos(67 * DEG)]);

/**
 * A unit vector toward the moon (x right, y up, -z ahead) `rise` of the way along its arc
 * (0 as it clears the range … 1 at its height), written into `out`.
 */
export function moonDirectionAt(rise, out = [0, 0, 0]) {
    const k = Math.min(1, Math.max(0, Number.isFinite(rise) ? rise : 1));
    const azimuth = MOON_RISING[0] + (MOON_HIGH[0] - MOON_RISING[0]) * k;
    // It climbs slowly at first: the low moon over the water is the part worth seeing.
    const elevation = MOON_RISING[1] + (MOON_HIGH[1] - MOON_RISING[1]) * k ** 1.3;
    out[0] = Math.cos(elevation) * Math.sin(azimuth);
    out[1] = Math.sin(elevation);
    out[2] = -Math.cos(elevation) * Math.cos(azimuth);
    return out;
}
/** The moon at its height. */
export const MOON_DIRECTION = Object.freeze(moonDirectionAt(1));
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
 * And the hue the hour turns the curtains' own green body (a pure colour, not a light level);
 * `bodyMix` (HOUR_SCALARS) is how far.
 */
export const HOUR_HUES = Object.freeze(['body']);
/**
 * And its numbers: `stars` and `galaxy` scale the star field and the Milky Way; `moon` how
 * much of the moon's disc and the glow round it stand in the sky; `gain` and `height` scale
 * the resting arcs' brightness and the height of their rays; `crown`, `violet` and `fringe`
 * add to the resting red crown, blue-violet ray tops and pink hem; `bodyMix` is how far the
 * curtains' green body turns to the hour's `body` hue; `mist` scales the cold mist over the
 * water and `dust` how brightly the diamond dust glints.
 */
export const HOUR_SCALARS = Object.freeze([
    'stars', 'galaxy', 'moon', 'gain', 'height', 'crown', 'violet', 'fringe', 'bodyMix', 'mist', 'dust',
]);
/** The curtains' own green, on average: an hour with no hue of its own names this. */
const GREEN = Object.freeze([0.115, 0.94, 0.385]);

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
        body: GREEN,
        stars: 1,
        galaxy: 1,
        moon: 0,
        gain: 1,
        height: 1,
        crown: 0,
        violet: 0,
        fringe: 0,
        bodyMix: 0,
        mist: 1,
        dust: 1,
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
        body: GREEN,
        stars: 0.9,
        galaxy: 0.75,
        moon: 0,
        gain: 1.12,
        height: 1.18,
        crown: 0.24,
        violet: 0.02,
        fringe: 0.08,
        bodyMix: 0,
        mist: 0.85,
        dust: 1.1,
    }),
    // The rare red night: the crown comes all the way down, and the whole display burns rose
    // and crimson over a thin green hem, taller than on any other night. The sky behind it
    // takes a plum cast and the snow and the mist blush under it.
    hour('Rose night', {
        skyZenith: [0.0044, 0.0034, 0.019],
        skyHorizon: [0.015, 0.012, 0.04],
        airglow: [0.02, 0.011, 0.017],
        skylight: [0.017, 0.018, 0.043],
        mistLight: [0.015, 0.012, 0.029],
        moonLight: [0, 0, 0],
        glow: [0.1, 0.046, 0.064],
        body: [1.0, 0.15, 0.4],
        stars: 0.85,
        galaxy: 0.7,
        moon: 0,
        gain: 1.06,
        height: 1.24,
        crown: 0.3,
        violet: 0.1,
        fringe: 0.16,
        bodyMix: 0.72,
        mist: 1.15,
        dust: 1.2,
    }),
    // The middle of the night: the display lies low and quiet, the green airglow stands on
    // the horizon and the Milky Way and the stars are at their brightest in a crisp, dark sky.
    hour('Deep midnight', {
        skyZenith: [0.0019, 0.0032, 0.016],
        skyHorizon: [0.006, 0.0135, 0.035],
        airglow: [0.0095, 0.028, 0.017],
        skylight: [0.011, 0.019, 0.042],
        mistLight: [0.008, 0.015, 0.03],
        moonLight: [0, 0, 0],
        glow: [0.022, 0.08, 0.055],
        body: GREEN,
        stars: 1.45,
        galaxy: 2.3,
        moon: 0,
        gain: 0.66,
        height: 0.9,
        crown: -0.04,
        violet: -0.03,
        fringe: -0.02,
        bodyMix: 0,
        mist: 0.7,
        dust: 0.8,
    }),
    // The moon comes up over the range and climbs (moonRise): a small pale disc left of the
    // board, mirrored in the lake while it is low, then its path of light on the water and
    // its light silvering the snow on every top and ridge (the slopes turned to the eye stay
    // in blue shadow). The lit sky hides the faint stars and most of the Milky Way, the
    // display against it is paler, and the diamond dust glints. Kept soft: moonlight, never
    // a milky wash or a blinding moon.
    hour('Moonlit night', {
        skyZenith: [0.0062, 0.0118, 0.041],
        skyHorizon: [0.0145, 0.029, 0.064],
        airglow: [0.008, 0.018, 0.026],
        skylight: [0.018, 0.031, 0.063],
        mistLight: [0.012, 0.021, 0.04],
        moonLight: [0.07, 0.077, 0.092],
        glow: [0.026, 0.09, 0.068],
        body: [0.42, 0.95, 0.7],
        stars: 0.55,
        galaxy: 0.3,
        moon: 1,
        gain: 0.86,
        height: 1,
        crown: -0.03,
        violet: 0,
        fringe: -0.02,
        bodyMix: 0.3,
        mist: 1.45,
        dust: 1.9,
    }),
    // The blue hour: the sky still a luminous deep blue, brightest in a twilight rim along
    // the horizon, the snow under it blue, ice fog lying on the water, few stars yet, and the
    // display turned teal, the tops of its rays still in sunlight, glowing blue-violet.
    hour('Blue hour', {
        skyZenith: [0.0042, 0.0095, 0.042],
        skyHorizon: [0.012, 0.036, 0.11],
        airglow: [0.016, 0.05, 0.15],
        skylight: [0.014, 0.03, 0.085],
        mistLight: [0.011, 0.023, 0.055],
        moonLight: [0, 0, 0],
        glow: [0.024, 0.095, 0.1],
        body: [0.03, 0.78, 0.95],
        stars: 0.6,
        galaxy: 0.55,
        moon: 0,
        gain: 0.96,
        height: 1.08,
        crown: -0.02,
        violet: 0.4,
        fringe: 0,
        bodyMix: 0.45,
        mist: 1.9,
        dust: 1.4,
    }),
]);

/** The hour the moon belongs to. */
const MOON_HOUR = AURORA_HOURS.findIndex((night) => night.moon > 0);

/**
 * How far along its arc the moon is at `phase`: 0 as it clears the range (while the hour
 * before its own is still melting into it), 1 at its height as its hour melts away.
 */
export function moonRise(phase) {
    const n = AURORA_HOURS.length;
    // Hours from the start of the moon's own, the short way round the wheel.
    const from = ((((phase - MOON_HOUR) % n) + n + n / 2) % n) - n / 2;
    return Math.min(1, Math.max(0, (from + MOON_LEAD) / (1 + MOON_LEAD)));
}

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
    out.hues = meltPalettes(AURORA_HOURS, HOUR_HUES, phase, out.hues || {});
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
        this.hues = {};
        /** A unit vector toward the moon, wherever it is on its arc. */
        this.moonDirection = [...MOON_DIRECTION];
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
        moonDirectionAt(moonRise(phase), this.moonDirection);
        /** Radians the stars and the Milky Way have turned round the pole. */
        this.skyTurn = phase * SKY_TURN;
    }
}
