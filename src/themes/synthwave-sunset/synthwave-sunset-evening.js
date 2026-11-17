// @ts-check

/**
 * Synthwave Sunset — the evening's clocks (no three, no shader code): which hour the evening
 * stands at, which colours tonight's sunset wears, what the sky's weather is and how lively the
 * sea runs. Four clocks of different lengths, so the same picture does not come round for a long
 * while:
 *
 *   the hour        golden hour, sunset, afterglow, night, and back (EVENING.seconds a stop).
 *                   The walk sets out from the sunset (the theme's opening look: the sun on the
 *                   sea) toward the night, comes back through the afterglow and the sunset to the
 *                   golden hour, the sun standing in the wheel's hub, and turns again. A level
 *                   steps it on along the same walk.
 *   the temperament tonight's colours: tangerine (the opening look), flamingo, ember, peach and
 *                   teal. Each is a whole sky (horizon to zenith, toward the sun and away), the
 *                   sun's disc, its glow and its road on the water.
 *   the weather     long streaks of cirrus (the opening look), a mackerel sky, a clear sky, a
 *                   bank of cumulus towers on the horizon (with heat lightning after dark).
 *   the sea         its liveliness: glassy, a light breeze (the opening look), a fresh breeze.
 *
 * Everything here is a pure function of the time (and a level's steps), so a seek, a replay and a
 * rebuild that carries the clock all land on the same evening. Colours are scene-linear RGB
 * triples; the world writes them into uniforms once a frame.
 */

import {
    MOOD_HOLD, meltColour, moodDrift, wheelAt,
} from '../shared/mood-clock.js';

/** @param {number} c one sRGB channel, 0..1 */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * A scene-linear RGB triple from an sRGB hex, scaled (HDR).
 * @param {number} hex
 * @param {number} [k]
 * @returns {number[]}
 */
export function lin(hex, k = 1) {
    return [
        toLinear(((hex >> 16) & 255) / 255) * k,
        toLinear(((hex >> 8) & 255) / 255) * k,
        toLinear((hex & 255) / 255) * k,
    ];
}

/** @param {number} x */
const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** @param {number} a @param {number} b @param {number} x */
const smooth = (a, b, x) => {
    const k = clamp01((x - a) / (b - a));
    return k * k * (3 - 2 * k);
};

// ── The hour ────────────────────────────────────────────────────────────────────

/** The evening's stops, as hours along its walk. */
export const HOUR = Object.freeze({
    gold: 0, sunset: 1, afterglow: 2, night: 3,
});

/**
 * The walk: where it sets out (the sunset), how long a stop lasts and how much of that it rests,
 * how far a level steps it on (hours), and the evening's old measure at the sunset stop (`dusk`,
 * 0 = the sun on the sea .. 1 = gone: the lights, the gulls' roost and the structures read it).
 */
export const EVENING = Object.freeze({
    start: HOUR.sunset,
    span: HOUR.night,
    seconds: 120,
    hold: MOOD_HOLD,
    levelStep: 0.25,
    restDusk: 0.14,
});

/**
 * The stops the clock alone has walked the evening by `time` (whole: a stop; between: the melt).
 * @param {number} time
 */
export const eveningStops = (time) => moodDrift(time, EVENING.seconds, EVENING.hold);

/**
 * The hour at `time` with `steps` hours of levels walked on top of the clock: folded there and
 * back between the golden hour and the night, so it never comes to rest at either end.
 * @param {number} steps
 * @param {number} time
 */
export function eveningHour(steps, time) {
    // Folded by hand (not through a share of the span): the opening hour is then exact.
    const round = EVENING.span * 2;
    const walked = EVENING.start + steps + eveningStops(time);
    const at = ((walked % round) + round) % round;
    return at <= EVENING.span ? at : round - at;
}

/**
 * What an hour looks like, as three measures: `gold` (1 at the golden hour, 0 from the sunset
 * on), `dusk` (0 at the golden hour, EVENING.restDusk at the sunset, 1 from the afterglow on) and
 * `night` (0 until the afterglow, 1 at night).
 * @param {number} hour
 * @param {{ gold: number, dusk: number, night: number }} [out]
 */
export function eveningLook(hour, out = { gold: 0, dusk: 0, night: 0 }) {
    const h = Math.min(HOUR.night, Math.max(HOUR.gold, Number.isFinite(hour) ? hour : EVENING.start));
    const rest = EVENING.restDusk;
    out.gold = 1 - Math.min(h, 1);
    if (h <= 1) out.dusk = rest * h;
    else if (h <= 2) out.dusk = rest + (1 - rest) * (h - 1);
    else out.dusk = 1;
    out.night = Math.max(0, h - 2);
    return out;
}

/**
 * The hour that shows a `dusk` of the old measure (the playground's `dusk=` and the tests).
 * @param {number} dusk
 */
export function hourOfDusk(dusk) {
    const d = clamp01(dusk);
    const rest = EVENING.restDusk;
    return d <= rest ? d / rest : 1 + (d - rest) / (1 - rest);
}

/**
 * The bay's lights and the air's light for a look: how far the pier's lights have come on from
 * the land end, how bright the bulbs and the town burn, the daylight left on what stands in the
 * scene, how far the stars are out and how bright the moon hangs.
 * @param {{ gold: number, dusk: number, night: number }} look
 * @param {{ power: number, glow: number, town: number, ambient: number, stars: number, moon: number }} [out]
 */
export function eveningLights(look, out = {
    power: 0, glow: 0, town: 0, ambient: 0, stars: 0, moon: 0,
}) {
    const { gold, dusk, night } = look;
    out.power = clamp01(0.42 + dusk * 0.85 - gold * 0.3);
    out.glow = 0.85 + dusk * 0.5 + night * 0.22 - gold * 0.08;
    out.town = 0.5 + dusk * 0.5 + night * 0.2 - gold * 0.25;
    out.ambient = (1 + (0.52 - 1) * dusk) * (1 - 0.42 * night) * (1 + 0.2 * gold);
    // The first stars at the sunset, a few hundred in the afterglow, the whole field at night.
    out.stars = 0.012 * smooth(0.05, 0.14, dusk) + 0.1 * smooth(0.14, 1, dusk) + 0.74 * night;
    out.moon = smooth(0.4, 1, dusk) * (0.5 + 0.5 * night);
    return out;
}

// ── Tonight's colours ───────────────────────────────────────────────────────────

/** The colours a sky is made of (the world has a uniform for each). */
export const SKY_KEYS = Object.freeze([
    // The gradient, away from the sun (0) and toward it (1): horizon, low, mid; then overhead.
    'horizon0', 'horizon1', 'low0', 'low1', 'mid0', 'mid1', 'high', 'zenith',
    // The high cloud's underside away from the sun and toward it.
    'cloud0', 'cloud1',
    // The sun's disc at its foot, its belt and its crown (its level folded in).
    'disc0', 'disc1', 'disc2',
    // The sun's glow (aureole, mist, shafts, the rim on what stands against it), the band along
    // the horizon under it, its road of light on the water.
    'warm', 'band', 'glint',
]);

/** @param {number[]} a @param {number[]} b @param {number} t */
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** @param {number[]} a @param {number} k */
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/** The golden hour: a bright, clear late afternoon, the sun still white-gold and high. */
const GOLD = Object.freeze({
    horizon0: lin(0xe9b29a, 0.86),
    horizon1: lin(0xffd08a, 0.98),
    low0: lin(0xcf9aa6, 0.84),
    low1: lin(0xffb072, 0.9),
    mid0: lin(0x9a8cb6),
    mid1: lin(0xc7919e),
    high: lin(0x5878b2),
    zenith: lin(0x2b5796),
    cloud0: lin(0xb99ab4),
    cloud1: lin(0xffc59a, 1.05),
    disc0: lin(0xff8a30, 3.4),
    disc1: lin(0xffb548, 3.4),
    disc2: lin(0xffe096, 3.4),
    warm: lin(0xffc070),
    band: lin(0xffb070),
    glint: lin(0xffd28a),
});

/** The night: indigo to the zenith, a last ember on the sun's bearing. */
const NIGHT = Object.freeze({
    horizon0: lin(0x232a5c),
    horizon1: lin(0x8a3a52, 0.6),
    low0: lin(0x161d4a),
    low1: lin(0x35265c, 0.85),
    mid0: lin(0x0e163e),
    mid1: lin(0x151a44),
    high: lin(0x091030),
    zenith: lin(0x050920),
    cloud0: lin(0x1f2852),
    cloud1: lin(0x46305c),
    disc0: lin(0xff4a22, 1.8),
    disc1: lin(0xff8a34, 1.8),
    disc2: lin(0xffb04c, 1.8),
    warm: lin(0xff7a5a, 0.5),
    band: lin(0xd0506a, 0.4),
    glint: lin(0xff6a3a),
});

/** The share of its own sunset a temperament keeps at the golden hour, of its afterglow at night. */
const GOLD_OWN = 0.42;
const NIGHT_OWN = 0.18;

/**
 * A temperament from its sunset (`day`) and afterglow (`dusk`) colours; the golden hour and the
 * night are the shared rows below, each keeping a share of the temperament's own hue.
 * @param {string} name
 * @param {Record<string, number[]>} day
 * @param {Record<string, number[]>} dusk
 */
function temperament(name, day, dusk) {
    /** @type {Record<string, number[]>} */
    const gold = {};
    /** @type {Record<string, number[]>} */
    const night = {};
    for (const key of SKY_KEYS) {
        gold[key] = mix3(GOLD[key], day[key], GOLD_OWN);
        night[key] = mix3(NIGHT[key], scale3(dusk[key], 0.4), NIGHT_OWN);
    }
    return Object.freeze({
        name, day, dusk, gold, night,
    });
}

/**
 * Tonight's colours, in the order the clock turns them. The first is the theme's opening look
 * (the constants its shaders held before the palettes moved here).
 */
export const TEMPERAMENTS = Object.freeze([
    temperament('tangerine', {
        horizon0: lin(0xc9707f),
        horizon1: lin(0xffb466, 0.74),
        low0: lin(0xb2607a),
        low1: lin(0xf47a5c, 0.8),
        mid0: lin(0x8a5274),
        mid1: mix3(lin(0x8a5274), lin(0xa45a72), 0.6),
        high: lin(0x3a4a78),
        zenith: lin(0x163456),
        cloud0: lin(0x8a5e8e),
        cloud1: lin(0xff9478, 0.95),
        disc0: lin(0xff4a22, 3),
        disc1: lin(0xff8a34, 3),
        disc2: lin(0xffb04c, 3),
        warm: lin(0xffa060),
        band: lin(0xff8a5a),
        glint: lin(0xffb060),
    }, {
        horizon0: lin(0x9a4d6e),
        horizon1: lin(0xff7a4a, 0.56),
        low0: lin(0x703a66),
        low1: lin(0xd0505a, 0.55),
        mid0: lin(0x8a5274, 0.55),
        mid1: scale3(mix3(lin(0x8a5274), lin(0xa45a72), 0.6), 0.55),
        high: lin(0x3a4a78, 0.45),
        zenith: lin(0x163456, 0.4),
        cloud0: lin(0x8a5e8e, 0.5),
        cloud1: lin(0xff9478, 0.475),
        disc0: lin(0xff4a22, 1.8),
        disc1: lin(0xff8a34, 1.8),
        disc2: lin(0xffb04c, 1.8),
        warm: lin(0xffa060),
        band: lin(0xff8a5a),
        glint: lin(0xff6a3a),
    }),
    // Flamingo: a hot pink sun into a violet sky.
    temperament('flamingo', {
        horizon0: lin(0xbd6ea6),
        horizon1: lin(0xff8f86, 0.78),
        low0: lin(0xa45ea6),
        low1: lin(0xf2648e, 0.8),
        mid0: lin(0x7a52a2),
        mid1: lin(0x9c5290),
        high: lin(0x49398c),
        zenith: lin(0x1f1c5e),
        cloud0: lin(0x8a5cb2),
        cloud1: lin(0xff7ca6, 0.95),
        disc0: lin(0xff2a52, 3),
        disc1: lin(0xff5c62, 3),
        disc2: lin(0xffa26e, 3),
        warm: lin(0xff7c92),
        band: lin(0xff5c8c),
        glint: lin(0xff9088),
    }, {
        horizon0: lin(0x86488c),
        horizon1: lin(0xff567c, 0.58),
        low0: lin(0x62387c),
        low1: lin(0xc83e8c, 0.56),
        mid0: lin(0x7a52a2, 0.52),
        mid1: lin(0x9c5290, 0.52),
        high: lin(0x49398c, 0.42),
        zenith: lin(0x1f1c5e, 0.4),
        cloud0: lin(0x8a5cb2, 0.5),
        cloud1: lin(0xff7ca6, 0.48),
        disc0: lin(0xff2a52, 1.8),
        disc1: lin(0xff5c62, 1.8),
        disc2: lin(0xffa26e, 1.8),
        warm: lin(0xff7c92),
        band: lin(0xff5c8c),
        glint: lin(0xff4c7a),
    }),
    // Ember: gold on the horizon under a crimson sky.
    temperament('ember', {
        horizon0: lin(0xbe6a5c),
        horizon1: lin(0xffc050, 0.8),
        low0: lin(0xa6585c),
        low1: lin(0xf26a38, 0.82),
        mid0: lin(0x7c4a5c),
        mid1: lin(0x9c4a4c),
        high: lin(0x2f3f6c),
        zenith: lin(0x122a4c),
        cloud0: lin(0x8a5a6c),
        cloud1: lin(0xffa24e, 0.95),
        disc0: lin(0xff2a10, 3),
        disc1: lin(0xff7a20, 3),
        disc2: lin(0xffc040, 3),
        warm: lin(0xff8c40),
        band: lin(0xff6c38),
        glint: lin(0xffb440),
    }, {
        horizon0: lin(0x8a3a4c),
        horizon1: lin(0xff6a2a, 0.6),
        low0: lin(0x6a3048),
        low1: lin(0xc83a38, 0.56),
        mid0: lin(0x7c4a5c, 0.52),
        mid1: lin(0x9c4a4c, 0.52),
        high: lin(0x2f3f6c, 0.45),
        zenith: lin(0x122a4c, 0.4),
        cloud0: lin(0x8a5a6c, 0.5),
        cloud1: lin(0xffa24e, 0.48),
        disc0: lin(0xff2a10, 1.8),
        disc1: lin(0xff7a20, 1.8),
        disc2: lin(0xffc040, 1.8),
        warm: lin(0xff8c40),
        band: lin(0xff6c38),
        glint: lin(0xff4c28),
    }),
    // Peach and teal: a clear, cool evening.
    temperament('peach', {
        horizon0: lin(0xcf9a92),
        horizon1: lin(0xffc892, 0.78),
        low0: lin(0xae8a9a),
        low1: lin(0xf0957a, 0.8),
        mid0: lin(0x7a7a9a),
        mid1: lin(0xa07a8c),
        high: lin(0x2f6a88),
        zenith: lin(0x0f4462),
        cloud0: lin(0x7c7a9c),
        cloud1: lin(0xffb29a, 0.95),
        disc0: lin(0xff6a30, 3),
        disc1: lin(0xffa050, 3),
        disc2: lin(0xffd880, 3),
        warm: lin(0xffb080),
        band: lin(0xffa07a),
        glint: lin(0xffc890),
    }, {
        horizon0: lin(0x966a82),
        horizon1: lin(0xff9060, 0.58),
        low0: lin(0x6c5a82),
        low1: lin(0xd06a6a, 0.56),
        mid0: lin(0x7a7a9a, 0.5),
        mid1: lin(0xa07a8c, 0.5),
        high: lin(0x2f6a88, 0.42),
        zenith: lin(0x0f4462, 0.4),
        cloud0: lin(0x7c7a9c, 0.5),
        cloud1: lin(0xffb29a, 0.48),
        disc0: lin(0xff6a30, 1.8),
        disc1: lin(0xffa050, 1.8),
        disc2: lin(0xffd880, 1.8),
        warm: lin(0xffb080),
        band: lin(0xffa07a),
        glint: lin(0xff8a60),
    }),
]);

/** The temperament's clock: seconds a temperament lasts, the share of it that rests pure. */
export const TEMPERAMENT_CLOCK = Object.freeze({ seconds: 210, hold: 0.45 });

/**
 * How far the clock has turned the temperaments by `time` (whole: one of TEMPERAMENTS).
 * @param {number} time
 */
export const temperamentPhase = (time) => moodDrift(time, TEMPERAMENT_CLOCK.seconds, TEMPERAMENT_CLOCK.hold);

const HERE = { a: 0, b: 0, melt: 0 };
const ONE = [0, 0, 0];
const OTHER = [0, 0, 0];

/**
 * One temperament's colour at a look: its sunset into its afterglow by `dusk` (a straight mix, as
 * the sky's shaders did), toward its golden hour by `gold`, toward its night by `night`.
 * @param {typeof TEMPERAMENTS[number]} temper
 * @param {string} key
 * @param {{ gold: number, dusk: number, night: number }} look
 * @param {number[]} out
 */
function colourAt(temper, key, look, out) {
    const a = temper.day[key];
    const b = temper.dusk[key];
    // Between the golden hour and the sunset the old measure runs 0..restDusk: the sunset's own
    // colour there is the mix it always was at restDusk.
    const d = look.gold > 0 ? EVENING.restDusk : look.dusk;
    for (let i = 0; i < 3; i += 1) {
        let c = a[i] + (b[i] - a[i]) * d;
        if (look.gold > 0) c += (temper.gold[key][i] - c) * look.gold;
        if (look.night > 0) c += (temper.night[key][i] - c) * look.night;
        out[i] = c;
    }
    return out;
}

/**
 * The sky's colours for a look and a temperament phase, written into `out[key]` (arrays made as
 * needed) for every key of SKY_KEYS. On a whole phase it is that temperament exactly; between two
 * each colour melts the short way round the colour wheel.
 * @param {{ gold: number, dusk: number, night: number }} look
 * @param {number} phase
 * @param {Record<string, number[]>} [out]
 */
export function skyColours(look, phase, out = {}) {
    wheelAt(phase, TEMPERAMENTS.length, HERE);
    const a = TEMPERAMENTS[HERE.a];
    const b = TEMPERAMENTS[HERE.b];
    for (const key of SKY_KEYS) {
        const rgb = out[key] || (out[key] = [0, 0, 0]);
        colourAt(a, key, look, ONE);
        if (HERE.melt <= 0) {
            rgb[0] = ONE[0];
            rgb[1] = ONE[1];
            rgb[2] = ONE[2];
        } else {
            colourAt(b, key, look, OTHER);
            meltColour(ONE, OTHER, HERE.melt, rgb);
        }
    }
    return out;
}

// ── The weather ─────────────────────────────────────────────────────────────────

/**
 * The sky's weathers, in the order the clock turns them: how much cirrus streaks the low sky,
 * how much of a mackerel sky lies above it, how far a bank of cumulus towers stands on the
 * horizon. The first is the opening look.
 */
export const WEATHERS = Object.freeze([
    Object.freeze({
        name: 'streaks', cirrus: 0.78, mackerel: 0, towers: 0,
    }),
    Object.freeze({
        name: 'mackerel', cirrus: 0.34, mackerel: 0.9, towers: 0,
    }),
    Object.freeze({
        name: 'clear', cirrus: 0.12, mackerel: 0, towers: 0,
    }),
    Object.freeze({
        name: 'towers', cirrus: 0.46, mackerel: 0.12, towers: 1,
    }),
]);

export const WEATHER_CLOCK = Object.freeze({ seconds: 170, hold: 0.4 });

/**
 * @param {number} time
 */
export const weatherPhase = (time) => moodDrift(time, WEATHER_CLOCK.seconds, WEATHER_CLOCK.hold);

/**
 * The weather at a phase round WEATHERS: each measure melts straight into the next.
 * @param {number} phase
 * @param {{ cirrus: number, mackerel: number, towers: number }} [out]
 */
export function weatherAt(phase, out = { cirrus: 0, mackerel: 0, towers: 0 }) {
    wheelAt(phase, WEATHERS.length, HERE);
    const a = WEATHERS[HERE.a];
    const b = WEATHERS[HERE.b];
    const k = HERE.melt;
    out.cirrus = a.cirrus + (b.cirrus - a.cirrus) * k;
    out.mackerel = a.mackerel + (b.mackerel - a.mackerel) * k;
    out.towers = a.towers + (b.towers - a.towers) * k;
    return out;
}

// ── The sea ─────────────────────────────────────────────────────────────────────

/**
 * How lively the sea runs (a scale on the swell's slopes: 1 is the opening look, a light breeze),
 * in the order the clock turns it: a light breeze, a glassy calm, a fresh breeze, a slack sea.
 */
export const SEA_STATES = Object.freeze([1, 0.55, 1.32, 0.8]);
export const SEA_CLOCK = Object.freeze({ seconds: 145, hold: 0.3 });

/**
 * The sea's liveliness at `time`.
 * @param {number} time
 */
export function seaStateAt(time) {
    wheelAt(moodDrift(time, SEA_CLOCK.seconds, SEA_CLOCK.hold), SEA_STATES.length, HERE);
    return SEA_STATES[HERE.a] + (SEA_STATES[HERE.b] - SEA_STATES[HERE.a]) * HERE.melt;
}

// ── The moon ────────────────────────────────────────────────────────────────────

/**
 * The crescent that follows the sun down: where it hangs (degrees left of the sun's bearing, its
 * elevation in the afterglow and how far it sinks through the night), its radius (stylised, in
 * proportion to the theme's big sun) and its phase (the terminator's place across the disc:
 * 1 = new, 0 = half).
 */
export const MOON = Object.freeze({
    azimuthDeg: -10,
    elevationDeg: 27,
    sinkDeg: 4,
    radiusDeg: 1.9,
    phase: 0.6,
});

/**
 * The moon's unit direction for a look (it sinks a little through the night).
 * @param {{ night: number }} look
 * @param {number[]} [out]
 */
export function moonDirection(look, out = [0, 0, 0]) {
    const az = (MOON.azimuthDeg * Math.PI) / 180;
    const el = ((MOON.elevationDeg - MOON.sinkDeg * look.night) * Math.PI) / 180;
    out[0] = Math.sin(az) * Math.cos(el);
    out[1] = Math.sin(el);
    out[2] = -Math.cos(az) * Math.cos(el);
    return out;
}
