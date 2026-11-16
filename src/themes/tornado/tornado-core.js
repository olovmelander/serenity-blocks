/**
 * Tornado — the numbers of the scene (CPU only, three-free).
 *
 * World units are metres. The lens stands in a wheat field at eye height and looks north (-Z);
 * the tornado touches down WORLD.distance away, left of the gameplay card, under a cloud base
 * WORLD.cloudBase up. The storm's deck reaches WORLD.stormRadius from the funnel; past it the
 * sky is clear, and the low sun shines in under the deck through that gap.
 */

export const TAU = Math.PI * 2;

export const WORLD = Object.freeze({
    eye: 1.7,
    distance: 720,
    cloudBase: 340,
    stormRadius: 2400,
    /** The funnel's radius at the ground, at the cloud base, and the flare into the wall cloud. */
    radiusGround: 24,
    radiusTop: 64,
    flare: 170,
    foot: 9,
    /** The dust skirt round the foot. */
    skirtHeight: 86,
    /** Sun: screen x it is aimed at (fraction of the frame), and its height above the horizon. */
    sunScreenX: 0.86,
});

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth01 = (t) => {
    const k = clamp01(t);
    return k * k * (3 - 2 * k);
};
/** Frame-rate independent ease factor: the share of the gap closed in `dt` at `rate` per second. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * Math.max(0, dt));

export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A CSS hex colour → linear RGB in `out` (three numbers). Returns false if it is not a hex. */
export function hexToLinear(hex, out) {
    if (typeof hex !== 'string') return false;
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return false;
    const v = Number.parseInt(m[1], 16);
    for (let i = 0; i < 3; i += 1) {
        const c = ((v >> (16 - i * 8)) & 255) / 255;
        out[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }
    return true;
}

/**
 * The funnel's radius at height fraction h (0 = ground, 1 = cloud base), in metres.
 * `girth` scales the stem (the live control times the chain's swell), `flare` the wall cloud,
 * `taper` how much wider the funnel is aloft than at the ground (a stovepipe has little, a cone
 * its authored share, a wedge more). The shader evaluates the same expression (tornado-tsl.js).
 */
export function funnelRadius(h, girth = 1, flare = 1, taper = 1) {
    const k = clamp01(h);
    return WORLD.radiusGround * girth
        + (WORLD.radiusTop - WORLD.radiusGround) * taper * k ** 1.7
        + WORLD.flare * flare * Math.exp(-(1 - k) * 8)
        + WORLD.foot * Math.exp(-k * 16);
}

// ── The storm's own life ─────────────────────────────────────────────────────────

/**
 * The kinds of funnel the storm goes through by itself, whatever the play: a cone, a stovepipe, a
 * wedge, a cone again, a rope, and a funnel that has let go of the ground and hangs under the wall
 * cloud until it comes down again as the next cone. Each is a shape for the stem (`girth`,
 * `taper`, `flare`), how far it sways (`rope`) and how far down it reaches (`touch`: 1 on the
 * ground). The first is the scene as authored.
 */
export const STAGE_KEYS = Object.freeze(['girth', 'taper', 'flare', 'rope', 'touch']);
export const STAGES = Object.freeze([
    Object.freeze({
        name: 'cone', girth: 1, taper: 1, flare: 1, rope: 1, touch: 1,
    }),
    Object.freeze({
        name: 'stovepipe', girth: 1.32, taper: 0.38, flare: 1.12, rope: 0.5, touch: 1,
    }),
    Object.freeze({
        name: 'wedge', girth: 1.8, taper: 1.5, flare: 1.35, rope: 0.22, touch: 1,
    }),
    Object.freeze({
        name: 'elephant trunk', girth: 0.82, taper: 1.3, flare: 0.95, rope: 1.9, touch: 1,
    }),
    Object.freeze({
        name: 'rope', girth: 0.4, taper: 0.42, flare: 0.62, rope: 2.9, touch: 1,
    }),
    Object.freeze({
        name: 'aloft', girth: 0.5, taper: 0.8, flare: 0.85, rope: 1.3, touch: 0.42,
    }),
]);
/** Seconds of storm time one kind lasts, and the share of it the funnel rests on that kind. */
export const STAGE_SECONDS = 47;
export const STAGE_REST = 0.42;

/**
 * The funnel's kind at `clock` seconds: rests on a kind, then turns into the next over the rest
 * of the step. Writes the shape into `out` and returns it (`index`, `turn` and `name` with it).
 */
export function stageAt(clock, out = {}) {
    const n = STAGES.length;
    const w = (((clock / STAGE_SECONDS) % n) + n) % n;
    const i = Math.floor(w);
    const k = smooth01((w - i - STAGE_REST) / (1 - STAGE_REST));
    const a = STAGES[i];
    const b = STAGES[(i + 1) % n];
    for (let c = 0; c < STAGE_KEYS.length; c += 1) {
        const key = STAGE_KEYS[c];
        out[key] = lerp(a[key], b[key], k);
    }
    out.index = i;
    out.turn = k;
    out.name = k < 0.5 ? a.name : b.name;
    return out;
}

/**
 * The weather round the storm, on clocks of its own that share no period with the hours or the
 * funnel's kinds, so the three never line up the same way twice in a session:
 *   rainAt     where the rain core hangs, radians left (−) or right of where it was authored
 *   rain       how heavy the curtains under the deck are, 0.55 … 1.3
 *   edge       the storm's edge, as a share of its radius: the bright gap opens and narrows
 *   mammatus   the pouches under the anvil, 0 … 1 (fields of them come and go)
 *   squall     rain over the lens, 0 … 1: a band of it crosses every few minutes
 *   pools      how far the pools of sun on the field have drifted (their own slow clock)
 */
export function weatherAt(clock, out = {}) {
    const t = Math.max(0, clock);
    out.rainAt = 0.34 * Math.sin(t * 0.0113 + 0.4) + 0.12 * Math.sin(t * 0.0291 + 2.1);
    out.rain = 0.92 + 0.26 * Math.sin(t * 0.0171 + 1.2) + 0.12 * Math.sin(t * 0.043);
    out.edge = 1 + 0.085 * Math.sin(t * 0.0087 + 0.9) + 0.03 * Math.sin(t * 0.0233 + 4);
    out.mammatus = smooth01(0.5 + 0.9 * Math.sin(t * 0.0131 + 2.6) + 0.25 * Math.sin(t * 0.0397));
    // A squall: a 34 s band of rain every 167 s, the first one a good minute into the storm.
    const phase = ((t + 62) % 167) / 34;
    out.squall = phase < 1 ? Math.sin(phase * Math.PI) ** 1.5 : 0;
    return out;
}

// ── The power line ───────────────────────────────────────────────────────────────

/**
 * A power line running out across the field toward the horizon right of the card. Pole 0 is the
 * nearest one in the picture; pole -1 stands behind the lens, so the first span runs past the lens
 * and its wires leave the frame at the right edge instead of ending on pole 0's arm. Pole i stands
 * at `nearest + i·step`; the far poles shrink and dissolve into the haze before the last one
 * (tornado-field.js), so the line has no end in sight either way.
 */
export const POWER_LINE = Object.freeze({
    nearest: Object.freeze([34, -46]),
    step: Object.freeze([26, -92]),
    /** Poles in front of the lens (0 … count−1), past pole −1 behind it. */
    count: 30,
    height: 11,
    /** The cross-arm: its centre this far below the top, its length and thickness. */
    armDrop: 0.9,
    armLength: 3.2,
    armThick: 0.22,
    /** The three wires: this far apart along the arm, sagging this much mid-span. */
    wireSpread: 1.4,
    sag: 1.5,
});

const LINE_RUN = Math.hypot(POWER_LINE.step[0], POWER_LINE.step[1]);
/** Square across the line (x, z), and the turn about Y that lays a box's x axis along it. */
const LINE_ACROSS = Object.freeze([-POWER_LINE.step[1] / LINE_RUN, POWER_LINE.step[0] / LINE_RUN]);
export const POWER_LINE_ARM_YAW = Math.atan2(-LINE_ACROSS[1], LINE_ACROSS[0]);

/** Pole i's foot (x, z) and its lean across the picture (radians, about Z), in `out`. */
export function powerLinePole(i, out = { x: 0, z: 0, tilt: 0 }) {
    out.x = POWER_LINE.nearest[0] + POWER_LINE.step[0] * i;
    out.z = POWER_LINE.nearest[1] + POWER_LINE.step[1] * i;
    // Every third pole leans one way, the rest a little the other, the far ones no further.
    out.tilt = (((i % 3) + 3) % 3 === 1 ? 0.04 : -0.02) * clamp(i + 1, 0, 9) * 0.4;
    return out;
}

/**
 * Where wire w (−1, 0, 1) rests on pole i's cross-arm, in `out` ([x, y, z]). The arm is built the
 * same way (tornado-field.js): turned square across the line, raised, then leaned with the pole.
 */
export function powerLineAttach(i, w, out = [0, 0, 0]) {
    const pole = powerLinePole(i);
    const along = w * POWER_LINE.wireSpread;
    const up = POWER_LINE.height - POWER_LINE.armDrop + POWER_LINE.armThick * 0.5 + 0.02;
    const ax = LINE_ACROSS[0] * along;
    const c = Math.cos(pole.tilt);
    const s = Math.sin(pole.tilt);
    out[0] = pole.x + ax * c - up * s;
    out[1] = ax * s + up * c;
    out[2] = pole.z + LINE_ACROSS[1] * along;
    return out;
}

/** A point on wire w of the span from pole i to pole i + 1 (t = 0 … 1), sag included. */
export function powerLineWire(i, w, t, out = [0, 0, 0]) {
    const a = powerLineAttach(i, w, [0, 0, 0]);
    const b = powerLineAttach(i + 1, w, [0, 0, 0]);
    for (let k = 0; k < 3; k += 1) out[k] = a[k] + (b[k] - a[k]) * t;
    out[1] -= Math.sin(t * Math.PI) * POWER_LINE.sag;
    return out;
}

/** How far from the lens the last pole stands: the line is gone into the haze by there. */
export function powerLineReach() {
    const last = powerLinePole(POWER_LINE.count - 1);
    return Math.hypot(last.x, last.z);
}

// ── The hours ────────────────────────────────────────────────────────────────────

/**
 * The storm's light. Scene-linear colours, authored through the post's tone map. `sunPower` is
 * the disc's brightness, `sunElev` its height above the horizon (radians), `flicker` how often the
 * cloud lights from inside while nothing is happening (flashes per second at rest).
 */
export const PALETTE_KEYS = Object.freeze([
    'sun', 'gapLow', 'gapHigh', 'skyTop', 'cloudDark', 'cloudMid', 'cloudLit', 'cloudRim',
    'wheatLit', 'wheatShade', 'haze', 'funnelLit', 'funnelShade', 'dust', 'bolt',
]);

export const PALETTES = Object.freeze([
    Object.freeze({
        name: 'golden hour',
        sun: [1.0, 0.55, 0.2],
        gapLow: [0.98, 0.5, 0.17],
        gapHigh: [0.5, 0.36, 0.3],
        skyTop: [0.13, 0.17, 0.25],
        cloudDark: [0.016, 0.023, 0.034],
        cloudMid: [0.05, 0.062, 0.082],
        cloudLit: [0.92, 0.36, 0.13],
        cloudRim: [0.95, 0.68, 0.44],
        wheatLit: [0.62, 0.37, 0.09],
        wheatShade: [0.085, 0.062, 0.026],
        haze: [0.56, 0.33, 0.17],
        funnelLit: [1.0, 0.6, 0.32],
        funnelShade: [0.062, 0.075, 0.1],
        dust: [0.36, 0.2, 0.09],
        bolt: [0.8, 0.86, 1.0],
        sunPower: 6,
        sunElev: 0.05,
        flicker: 0.07,
    }),
    Object.freeze({
        name: 'ember dusk',
        sun: [1.0, 0.27, 0.07],
        gapLow: [0.95, 0.24, 0.08],
        gapHigh: [0.44, 0.16, 0.24],
        skyTop: [0.1, 0.08, 0.2],
        cloudDark: [0.02, 0.015, 0.032],
        cloudMid: [0.058, 0.04, 0.074],
        cloudLit: [0.9, 0.2, 0.15],
        cloudRim: [1.0, 0.44, 0.38],
        wheatLit: [0.5, 0.19, 0.06],
        wheatShade: [0.07, 0.036, 0.034],
        haze: [0.48, 0.18, 0.15],
        funnelLit: [1.0, 0.38, 0.27],
        funnelShade: [0.065, 0.048, 0.095],
        dust: [0.3, 0.12, 0.075],
        bolt: [0.95, 0.8, 1.0],
        sunPower: 5,
        sunElev: 0.03,
        flicker: 0.1,
    }),
    Object.freeze({
        name: 'green sky',
        sun: [0.72, 0.8, 0.4],
        gapLow: [0.58, 0.66, 0.3],
        gapHigh: [0.2, 0.31, 0.24],
        skyTop: [0.06, 0.12, 0.12],
        cloudDark: [0.01, 0.027, 0.025],
        cloudMid: [0.03, 0.074, 0.062],
        cloudLit: [0.34, 0.56, 0.3],
        cloudRim: [0.62, 0.8, 0.56],
        wheatLit: [0.36, 0.4, 0.13],
        wheatShade: [0.045, 0.066, 0.036],
        haze: [0.27, 0.38, 0.24],
        funnelLit: [0.62, 0.76, 0.56],
        funnelShade: [0.032, 0.058, 0.056],
        dust: [0.18, 0.2, 0.1],
        bolt: [0.8, 1.0, 0.9],
        sunPower: 3,
        sunElev: 0.06,
        flicker: 0.16,
    }),
    Object.freeze({
        name: 'blue hour',
        sun: [0.9, 0.36, 0.26],
        gapLow: [0.52, 0.2, 0.17],
        gapHigh: [0.075, 0.13, 0.31],
        skyTop: [0.02, 0.04, 0.12],
        cloudDark: [0.007, 0.011, 0.028],
        cloudMid: [0.02, 0.03, 0.068],
        cloudLit: [0.26, 0.14, 0.22],
        cloudRim: [0.34, 0.4, 0.72],
        wheatLit: [0.115, 0.125, 0.2],
        wheatShade: [0.018, 0.023, 0.048],
        haze: [0.115, 0.125, 0.25],
        funnelLit: [0.4, 0.43, 0.62],
        funnelShade: [0.02, 0.028, 0.06],
        dust: [0.07, 0.07, 0.11],
        bolt: [0.72, 0.8, 1.0],
        sunPower: 1.8,
        sunElev: 0.012,
        flicker: 0.24,
    }),
    // The storm at night: the last ember of afterglow in the gap, the deck and the field lit by
    // the storm's own lightning (it flickers most now) and by what the funnel holds.
    Object.freeze({
        name: 'storm night',
        sun: [0.3, 0.085, 0.075],
        gapLow: [0.075, 0.026, 0.045],
        gapHigh: [0.012, 0.02, 0.07],
        skyTop: [0.004, 0.008, 0.032],
        cloudDark: [0.003, 0.005, 0.014],
        cloudMid: [0.009, 0.014, 0.036],
        cloudLit: [0.045, 0.026, 0.07],
        cloudRim: [0.07, 0.1, 0.26],
        wheatLit: [0.03, 0.037, 0.076],
        wheatShade: [0.006, 0.008, 0.021],
        haze: [0.026, 0.032, 0.084],
        funnelLit: [0.13, 0.155, 0.3],
        funnelShade: [0.008, 0.011, 0.028],
        dust: [0.02, 0.023, 0.044],
        bolt: [0.74, 0.8, 1.0],
        sunPower: 0.5,
        sunElev: 0.004,
        flicker: 0.42,
    }),
    // First light: the gap pale lemon over teal, the deck slate with peach under its lobes, the
    // wheat the colour of straw. The cold, clean hour before the gold comes back.
    Object.freeze({
        name: 'first light',
        sun: [1.0, 0.8, 0.52],
        gapLow: [0.92, 0.74, 0.47],
        gapHigh: [0.36, 0.56, 0.62],
        skyTop: [0.085, 0.19, 0.31],
        cloudDark: [0.017, 0.026, 0.04],
        cloudMid: [0.058, 0.08, 0.11],
        cloudLit: [0.8, 0.47, 0.33],
        cloudRim: [0.84, 0.8, 0.72],
        wheatLit: [0.55, 0.44, 0.19],
        wheatShade: [0.068, 0.07, 0.046],
        haze: [0.47, 0.48, 0.44],
        funnelLit: [0.9, 0.76, 0.6],
        funnelShade: [0.058, 0.08, 0.11],
        dust: [0.3, 0.24, 0.15],
        bolt: [0.84, 0.9, 1.0],
        sunPower: 4.5,
        sunElev: 0.022,
        flicker: 0.06,
    }),
]);

/**
 * The clock alone carries the light one hour on in this many seconds of storm time, whatever the
 * level: a level-up is a step added on top (tornado-world.js: wheel = clock / HOUR_SECONDS +
 * level − 1), never the only thing that moves it.
 */
export const HOUR_SECONDS = 100;
/**
 * The share of a step the light rests on an hour before it leaves, and again when it reaches the
 * next. Small on purpose: for the other 70 % of every step the light is visibly on its way.
 */
export const HOUR_REST = 0.15;

/**
 * The light at wheel position `wheel` (one unit per palette, wraps): a short rest on the hour,
 * a long slow turn into the next, a short rest there. Writes every colour (arrays of three) and
 * scalar into `out` and returns it.
 */
export function paletteAt(wheel, out = {}) {
    const n = PALETTES.length;
    const w = ((wheel % n) + n) % n;
    const i = Math.floor(w);
    const f = w - i;
    const k = smooth01((f - HOUR_REST) / (1 - 2 * HOUR_REST));
    const a = PALETTES[i];
    const b = PALETTES[(i + 1) % n];
    for (let c = 0; c < PALETTE_KEYS.length; c += 1) {
        const key = PALETTE_KEYS[c];
        const dst = out[key] || (out[key] = [0, 0, 0]);
        for (let j = 0; j < 3; j += 1) dst[j] = lerp(a[key][j], b[key][j], k);
    }
    out.sunPower = lerp(a.sunPower, b.sunPower, k);
    out.sunElev = lerp(a.sunElev, b.sunElev, k);
    out.flicker = lerp(a.flicker, b.flicker, k);
    out.index = i;
    out.turn = k;
    return out;
}

/** How hard the storm blows for a chain of `combo` clears: 0 at rest, toward 1. */
export function furyFor(combo) {
    const n = Math.max(0, combo - 1);
    return 1 - Math.exp(-n / 3.2);
}

/**
 * A crawler: lightning that runs along under the cloud base instead of coming down. `count`
 * points from `from` (x, y, z), heading `turn` radians, `length` metres long: it wanders
 * sideways as it goes (it does not have to land anywhere) and sags a little under the deck.
 */
export function crawlerPath(rand, from, turn, length, jag, count, out) {
    let heading = turn;
    let x = from[0];
    let z = from[2];
    const stride = length / (count - 1);
    for (let i = 0; i < count; i += 1) {
        const t = i / (count - 1);
        if (i > 0) {
            heading += (rand() - 0.5) * jag;
            x += Math.cos(heading) * stride;
            z += Math.sin(heading) * stride;
        }
        out[i * 3] = x;
        out[i * 3 + 1] = from[1] - Math.sin(t * Math.PI) * length * 0.012 - (rand() - 0.5) * 2;
        out[i * 3 + 2] = z;
    }
    return out;
}

/**
 * A lightning channel from `from` to `to` (x, y, z triples): `count` points written to `out`.
 * A sideways random walk of `jag` metres a step that dies away toward the end, so the channel
 * wanders and still lands exactly where it was aimed.
 */
export function boltPath(rand, from, to, jag, count, out) {
    let ox = 0;
    let oz = 0;
    for (let i = 0; i < count; i += 1) {
        const t = i / (count - 1);
        if (i > 0) {
            ox += (rand() - 0.5) * jag * 2;
            oz += (rand() - 0.5) * jag * 2;
        }
        const hold = 1 - t * t;
        out[i * 3] = lerp(from[0], to[0], t) + ox * hold;
        out[i * 3 + 1] = lerp(from[1], to[1], t);
        out[i * 3 + 2] = lerp(from[2], to[2], t) + oz * hold;
    }
    return out;
}
