/**
 * Astral Weave — the moods of the deep field: the light the loom hangs in turns by the clock.
 *
 * The nebula behind the loom is one river of gas lit by the hoop's heart and two hot stars. Its
 * light now turns slowly through five moods, each a different nebula's light: the teal river
 * the theme has always shown, a rose veil glowing in hydrogen red, the cold sapphire deep where
 * the stars crowd, a jade veil of oxygen green edged in violet, and an amethyst drift with peach
 * edges. Each mood rests MOOD_HOLD of MOOD_SECONDS, then melts into the next the short way round
 * the colour wheel (src/themes/shared/mood-clock.js), so a full turn takes a little over eight
 * minutes, in every mode: the clock is the world's (the theme's time, which a restart carries),
 * never an event. A level-up still rests the weave on a richer figure and rings the hoop, and
 * moves the light one mood on as well, eased over a few seconds, on top of the clock.
 *
 * The figure itself stays the play's (levels, chains, quads): a figure turned by the clock
 * would have to pass through broken, non-integer figures over a whole melt, or re-weave with
 * nobody having played.
 *
 * Mood 0 is the deep field the theme has always shown: every value in it is the constant the
 * sky shader used before (astral-weave-sky.js), so the theme opens exactly as it did. The
 * combo's heat (rose, then amber, then gold) is untouched by the moods and stays the brightest
 * thing in every one of them.
 *
 * Colours are scene-linear. Plain numbers: no three, no DOM, no timers.
 */
import {
    MOOD_HOLD, MOOD_SECONDS, easeStep, meltPalettes, moodDrift, wheelAt,
} from '../shared/mood-clock.js';

/** Seconds a mood lasts on the clock alone, and the share of it seen pure. */
export const MOOD_PERIOD = MOOD_SECONDS;
export const MOOD_REST = MOOD_HOLD;
/** Seconds (1/e) a level's step takes to ease in: most of the way in about six seconds. */
export const LEVEL_EASE = 2.2;

/**
 * Each mood's colours:
 *   gasA, gasB, gasC     the river's heart, body and edges (the shader mixes them along it)
 *   space, band          the dark between the stars, and the faint glow along the river
 *   lampA, lampB         the two hot stars in the gas (their light and their own colour)
 *   glow                 the hoop's heart light on the gas while the weave is cool
 *   filamentA, filamentB the bright ridges in the gas
 *   highlight            the sheen on the densest clouds
 */
export const MOOD_COLOURS = Object.freeze([
    'gasA', 'gasB', 'gasC', 'space', 'band', 'lampA', 'lampB', 'glow', 'filamentA', 'filamentB', 'highlight',
]);
/** And its numbers: `stars` scales the star field, `weave` the threads' own glow against the gas. */
export const MOOD_SCALARS = Object.freeze(['stars', 'weave']);

const mood = (name, values) => Object.freeze({
    name,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key, Array.isArray(value) ? Object.freeze([...value]) : value,
    ])),
});

export const ASTRAL_MOODS = Object.freeze([
    // Today's deep field, exactly: a teal heart, an indigo body, rose edges.
    mood('Teal river', {
        gasA: [0.012, 0.21, 0.27],
        gasB: [0.07, 0.055, 0.33],
        gasC: [0.36, 0.05, 0.2],
        space: [0.0022, 0.0034, 0.0105],
        band: [0.0035, 0.005, 0.017],
        lampA: [0.55, 0.86, 1.0],
        lampB: [0.92, 0.78, 1.0],
        glow: [0.3, 0.5, 0.95],
        filamentA: [0.3, 0.62, 0.8],
        filamentB: [0.8, 0.42, 0.62],
        highlight: [0.55, 0.7, 0.9],
        stars: 1,
        weave: 1,
    }),
    // A rose veil: the gas glows in hydrogen red, plum in its body and coral at its edges, the
    // hot stars warm white and pink.
    mood('Rose veil', {
        gasA: [0.3, 0.035, 0.13],
        gasB: [0.13, 0.03, 0.21],
        gasC: [0.34, 0.13, 0.05],
        space: [0.003, 0.0024, 0.0088],
        band: [0.0055, 0.0034, 0.0145],
        lampA: [1.0, 0.82, 0.7],
        lampB: [1.0, 0.68, 0.86],
        glow: [0.8, 0.45, 0.78],
        filamentA: [0.86, 0.48, 0.62],
        filamentB: [0.95, 0.56, 0.36],
        highlight: [0.9, 0.64, 0.74],
        stars: 0.9,
        weave: 1,
    }),
    // The sapphire deep: cobalt gas thinning to cyan at its edges, the darkest, coldest space,
    // the stars crowding in it and the hot stars blue-white.
    mood('Sapphire deep', {
        gasA: [0.02, 0.085, 0.34],
        gasB: [0.016, 0.032, 0.17],
        gasC: [0.02, 0.2, 0.28],
        space: [0.0012, 0.0024, 0.0095],
        band: [0.0024, 0.0045, 0.016],
        lampA: [0.55, 0.76, 1.0],
        lampB: [0.7, 0.88, 1.0],
        glow: [0.25, 0.5, 1.0],
        filamentA: [0.3, 0.56, 0.95],
        filamentB: [0.36, 0.8, 0.9],
        highlight: [0.5, 0.68, 1.0],
        stars: 1.35,
        weave: 1.05,
    }),
    // A jade veil: oxygen green in the heart, deep teal-blue in the body, violet at the edges,
    // one hot star green-white and the other lilac.
    mood('Jade veil', {
        gasA: [0.025, 0.22, 0.12],
        gasB: [0.015, 0.09, 0.19],
        gasC: [0.17, 0.05, 0.3],
        space: [0.0018, 0.0034, 0.0086],
        band: [0.003, 0.0055, 0.013],
        lampA: [0.7, 1.0, 0.86],
        lampB: [0.82, 0.76, 1.0],
        glow: [0.36, 0.8, 0.62],
        filamentA: [0.36, 0.8, 0.6],
        filamentB: [0.62, 0.46, 0.9],
        highlight: [0.6, 0.88, 0.76],
        stars: 1,
        weave: 1,
    }),
    // An amethyst drift: violet gas over an indigo body, warmed to peach at its edges, the hot
    // stars a warm white and a violet.
    mood('Amethyst drift', {
        gasA: [0.17, 0.045, 0.33],
        gasB: [0.05, 0.04, 0.24],
        gasC: [0.36, 0.15, 0.08],
        space: [0.0026, 0.0024, 0.011],
        band: [0.0045, 0.0035, 0.018],
        lampA: [1.0, 0.86, 0.72],
        lampB: [0.78, 0.68, 1.0],
        glow: [0.6, 0.45, 1.0],
        filamentA: [0.7, 0.5, 0.95],
        filamentB: [0.95, 0.6, 0.46],
        highlight: [0.8, 0.68, 0.95],
        stars: 1,
        weave: 1,
    }),
]);

/** How far the clock alone has turned the moods by `time` seconds (whole moods + the melt). */
export function moodDriftAt(time) {
    return moodDrift(time, MOOD_PERIOD, MOOD_REST);
}

/**
 * The deep field at `phase` (whole moods round ASTRAL_MOODS, the fraction a melt into the next):
 * colours melt the short way round the colour wheel, numbers straight. Writes into `out`.
 * @param {number} phase
 * @param {{ colours?: Record<string, number[]>, [key: string]: any }} [out]
 */
export function moodAt(phase, out = {}) {
    out.colours = meltPalettes(ASTRAL_MOODS, MOOD_COLOURS, phase, out.colours || {});
    const at = wheelAt(phase, ASTRAL_MOODS.length);
    const a = ASTRAL_MOODS[at.a];
    const b = ASTRAL_MOODS[at.b];
    for (const key of MOOD_SCALARS) out[key] = a[key] + (b[key] - a[key]) * at.melt;
    out.name = at.melt < 0.5 ? a.name : b.name;
    return out;
}

export class AstralWeaveMoods {
    constructor() {
        this.colours = {};
        this.reset();
    }

    /** Back to the first mood, no level stepped. */
    reset() {
        /** Moods the levels have moved the light on (an integer; the clock adds its own). */
        this.levelSteps = 0;
        /** The levels' step as shown: it eases toward `levelSteps` the short way round. */
        this.step = 0;
        this.time = 0;
        this.apply(0);
    }

    /** A level: the light moves one mood on, eased in over the next few seconds. */
    levelUp() {
        this.levelSteps += 1;
    }

    /** Stand the levels' step at `steps` at once (a restart carrying its run, a capture). */
    setLevelSteps(steps) {
        this.levelSteps = Math.max(0, Math.round(Number(steps) || 0));
        this.settle();
    }

    /** Land the level's ease where it is going (a seek: no ease in flight). */
    settle() {
        this.step = this.levelSteps;
        this.apply(this.step + moodDriftAt(this.time));
    }

    /**
     * Advance the level's ease by `dt` seconds and stand the light where the clock has brought it:
     * a pure function of `time` and the eased step, so a seek and a replay agree.
     */
    update(dt, time) {
        const k = dt > 0 ? 1 - Math.exp(-dt / LEVEL_EASE) : 0;
        this.step = easeStep(this.step, this.levelSteps, k, ASTRAL_MOODS.length);
        this.time = Number.isFinite(time) ? Math.max(0, time) : 0;
        this.apply(this.step + moodDriftAt(this.time));
    }

    apply(phase) {
        this.phase = phase;
        moodAt(phase, this);
    }
}
