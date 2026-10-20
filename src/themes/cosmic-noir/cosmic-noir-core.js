/**
 * Cosmic Noir — constants and CPU maths shared by the choreography and the shaders.
 * Three-free: the director, the layout and their tests import only this.
 *
 * "Smoke in the searchlight." A black-and-white film of deep space: a pulsar turns inside the
 * derelict shutter cage of a lantern (a ring of vertical slats round it), and its two beams sweep
 * like a lighthouse's through drifting interstellar smoke. Most of the frame is dark; the smoke
 * shows where a beam crosses it, cut into fans of shafts by the cage's slats (light through
 * venetian blinds). The picture is graded as a print on one film stock at a time — silver,
 * selenium, sepia, platinum, cyanotype — that drifts by itself and changes reel on a level-up.
 *
 * Units: scene units. The camera stands near the origin and looks down −Z, turned so that the
 * pulsar (on the −Z axis, PULSAR.depth ahead) hangs in the free zone beside the board.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** The pulsar: on the −Z axis this far ahead. Its spin axis (the cage's axis) leans a little. */
export const PULSAR = Object.freeze({
    depth: 24,
    /** Spin axis (unnormalised): nearly upright, leaning a little toward the camera (a three-quarter view). */
    axis: Object.freeze([0.12, 1, 0.18]),
    /**
     * Angle between the spin axis and the beams (degrees). The camera stands ~79° off the axis:
     * at 60° the upper beam's cone passes ~19° from the lens at its nearest (a blaze that skims
     * past, never a white-out), and the lower beam's cone (120°) is far from it.
     */
    inclination: 60,
    /** The beams' core half-width and their soft skirt (degrees). */
    beamWidth: 11,
    beamSkirt: 26,
    /** How bright the skirt is beside the core (dim: noir keeps the air between shafts dark). */
    skirtShare: 0.06,
    /** Seconds per turn at rest. */
    period: 14,
    /** How bright the beam is near the lantern (it falls as 1 / (1 + (r/beamReach)²)). */
    beamGain: 7,
    beamReach: 16,
    /** The core's own glow round the lantern (all directions, through the slats). */
    coreGain: 2.0,
    coreReach: 2.2,
});

/**
 * The derelict shutter cage round the pulsar: a cylinder of vertical slats on the spin axis, with
 * closed lids (light leaves only between the slats).
 */
export const CAGE = Object.freeze({
    radius: 1.7,
    halfHeight: 2.3,
    slats: 22,
    /** Share of each pitch a slat covers: closed at rest, opened by a chain. */
    fillClosed: 0.45,
    fillOpen: 0.25,
    /** Seconds per turn of the cage itself (it turns slowly, the other way). */
    period: 150,
    /** The frame rings at the top and bottom (share of the half-height). */
    ring: 0.06,
    /** The share of the light the lids let past (round their rims): their shadow is soft, not a void. */
    lidLeak: 0.3,
});

/** The smoke: an envelope of drifting, stratified haze round the pulsar and toward the camera. */
export const SMOKE = Object.freeze({
    /** Centre and half-extents of the envelope (scene units). */
    centre: Object.freeze([4, -1.5, -21]),
    extent: Object.freeze([34, 12, 21]),
    /** One tile of the baked noise in scene units, and how much wider than tall it is drawn. */
    tile: 11,
    stretch: 2.4,
    /** The wind (scene units / s): the smoke drifts slowly sideways and away. */
    wind: Object.freeze([0.22, 0.015, -0.05]),
    /** A thin haze everywhere in the envelope, so a beam is a shaft even between the masses. */
    haze: 0.05,
    /** Where the march begins and ends along a view ray. */
    near: 2.2,
    far: 62,
});

// ── Events ──────────────────────────────────────────────────────────────────────

/** Light echoes (clears): shells of light expanding from the pulsar through the smoke. */
export const ECHO_SLOTS = 4;
export const ECHO_SPEED = 26;
export const ECHO_LIFE = 2.2;
/** An echo's light falls off with its distance from the pulsar (as 1 / (1 + (r/ECHO_REACH)²)). */
export const ECHO_REACH = 9;
/** An echo slows as it spreads and never reaches the camera (~24 away): inside it, it would be a wall. */
export const ECHO_MAX = 19;
/** Puffs (locks): smoke billowing out of the card's edge, lit from within by a dying ember. */
export const PUFF_SLOTS = 6;
export const PUFF_LIFE = 4.5;
/** The flashbulb (four lines): the print flips to its negative for a moment. */
export const NEGATIVE_HOLD = 0.06;
export const NEGATIVE_FADE = 0.2;
/** The reel change (level-up): two cue marks, a second apart, each this long. */
export const CUE_GAP = 1.0;
export const CUE_SHOW = 0.2;

// ── Film stocks ─────────────────────────────────────────────────────────────────

/**
 * Each stock tones a black-and-white print: `shadow` and `high` are multipliers of grey at the
 * dark and light ends (luminance ≈ 1, so the tone never changes how bright the print is), `paper`
 * the base the darkest blacks sit on, `grain` the stock's grain. Walked as a LINE, there and back
 * (cyanotype – silver – selenium – sepia – platinum – sepia – …): neighbours are close tones.
 */
export const FILM_STOCKS = Object.freeze([
    Object.freeze({
        name: 'cyanotype', shadow: [0.57, 1.04, 1.84], high: [0.9, 1.0, 1.12], paper: [0.0008, 0.0018, 0.004], grain: 1.0,
    }),
    Object.freeze({
        name: 'silver', shadow: [0.93, 0.98, 1.1], high: [1.0, 1.0, 1.0], paper: [0.0011, 0.0013, 0.0017], grain: 1.0,
    }),
    Object.freeze({
        name: 'selenium', shadow: [1.18, 0.93, 1.2], high: [1.02, 0.99, 0.98], paper: [0.0017, 0.0009, 0.0017], grain: 0.9,
    }),
    Object.freeze({
        name: 'sepia', shadow: [1.32, 0.95, 0.62], high: [1.08, 1.0, 0.85], paper: [0.0024, 0.0014, 0.0008], grain: 1.15,
    }),
    Object.freeze({
        name: 'platinum', shadow: [1.14, 1.0, 0.84], high: [1.04, 1.02, 0.94], paper: [0.002, 0.0018, 0.0014], grain: 0.85,
    }),
]);
/** The stock level 1 starts on (silver). */
export const STOCK_HOME = 1;
/** Seconds the clock alone takes to carry the print one stock along. A level-up is one step. */
export const STOCK_STEP = 100;
/** The share of a step, at each end, the print rests on a stock before it turns. */
export const STOCK_REST = 0.15;

export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two edges. */
export function smooth(lo, hi, v) {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** Deterministic PRNG. */
export function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Where the print stands on the stocks' line for a level's place and the clock: the two simply
 * add. `levelPlace` = the steps the level-ups have taken (eased by the world).
 */
export const stockPlace = (levelPlace, time) => levelPlace + Math.max(0, time) / STOCK_STEP;

/** A place on the line as (index, next, mix), walked there and back from STOCK_HOME. */
export function stockPhase(place) {
    const last = FILM_STOCKS.length - 1;
    const period = last * 2;
    let x = (((place + STOCK_HOME) % period) + period) % period;
    if (x > last) x = period - x;
    const index = Math.min(last - 1, Math.floor(x));
    return { index, next: index + 1, mix: smooth(STOCK_REST, 1 - STOCK_REST, x - index) };
}

/** The toning at a place: every field mixed between two neighbouring stocks. Fills `out`. */
export function stockAt(place, out = {}) {
    const { index, next, mix } = stockPhase(place);
    const a = FILM_STOCKS[index];
    const b = FILM_STOCKS[next];
    ['shadow', 'high', 'paper'].forEach((key) => {
        const target = out[key] || (out[key] = [0, 0, 0]);
        for (let c = 0; c < 3; c++) target[c] = lerp(a[key][c], b[key][c], mix);
    });
    out.grain = lerp(a.grain, b.grain, mix);
    return out;
}

/** The name of the stock a place stands nearest to. */
export function stockName(place) {
    const { index, next, mix } = stockPhase(place);
    return FILM_STOCKS[mix < 0.5 ? index : next].name;
}

// ── The lighthouse: beams and cage (CPU twins of the shader maths) ─────────────

const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The spin axis and two unit vectors across it (the basis the beams and the slats turn in). */
export function spinBasis() {
    const a = norm(PULSAR.axis);
    const e1 = norm(cross([0, 0, 1], a));
    const e2 = cross(a, e1);
    return { a, e1, e2 };
}

/** One beam's direction at spin phase φ (the other beam is its opposite). */
export function beamDirection(phase, basis = spinBasis(), out = [0, 0, 0]) {
    const inc = PULSAR.inclination * DEG;
    const ci = Math.cos(inc);
    const si = Math.sin(inc);
    const c = Math.cos(phase);
    const s = Math.sin(phase);
    for (let k = 0; k < 3; k++) out[k] = basis.a[k] * ci + si * (basis.e1[k] * c + basis.e2[k] * s);
    return out;
}

/**
 * How much of a beam reaches direction `d` (unit, from the pulsar): a gaussian core and a soft
 * skirt round either beam. CPU twin of cnBeam().
 */
export function beamLight(d, beam) {
    const c = Math.min(1, Math.abs(dot(d, beam)));
    const angle = Math.acos(c);
    const core = Math.exp(-((angle / (PULSAR.beamWidth * DEG)) ** 2));
    const skirt = Math.exp(-((angle / (PULSAR.beamSkirt * DEG)) ** 2)) * PULSAR.skirtShare;
    return core + skirt;
}

/**
 * How much light leaving the pulsar along `d` passes the cage: none through the lids, else
 * 1 − (a slat's share of the pitch), with soft edges. CPU twin of cnCage().
 */
export function cageTransmit(d, cagePhase, fill, basis = spinBasis(), soft = 0) {
    const h = dot(d, basis.a);
    const qx = dot(d, basis.e1);
    const qy = dot(d, basis.e2);
    const q = Math.hypot(qx, qy);
    if (q < 1e-6) return 0;
    const axial = Math.abs((h * CAGE.radius) / q);
    const theta = Math.atan2(qy, qx) + cagePhase;
    const f = ((((theta * CAGE.slats) / TAU) % 1) + 1) % 1;
    // A slat spans [0, fill) of each pitch; `soft` widens its edges and, far out, blends the
    // stripes into their average.
    const edge = Math.max(soft, 0.03);
    const sharp = smooth(-edge, edge, f) * (1 - smooth(fill - edge, fill + edge, f));
    const inSlat = lerp(sharp, fill * 0.85, smooth(0.12, 0.42, soft));
    // Past the wall's height the light meets a lid: most of it is stopped (a soft-edged shadow, a
    // little light leaking round the rims).
    const wall = 1 - smooth(CAGE.halfHeight - 0.5, CAGE.halfHeight + 1.2, axial) * (1 - CAGE.lidLeak);
    return (1 - inSlat * (1 - smooth(CAGE.halfHeight - 0.05, CAGE.halfHeight + 0.05, axial))) * wall;
}

/** A light echo's radius `age` seconds after it left the pulsar. */
export const echoRadius = (age) => ECHO_MAX * (1 - Math.exp(-(ECHO_SPEED / ECHO_MAX) * Math.max(0, age)));

/** The flashbulb's negative (0..1) `age` seconds after it fired. */
export function negativeAt(age) {
    if (age < 0) return 0;
    if (age < NEGATIVE_HOLD) return 1;
    return Math.exp(-(age - NEGATIVE_HOLD) / (NEGATIVE_FADE * 0.45));
}

/** The reel change's cue marks (0..1) `age` seconds after a level-up: two marks a second apart. */
export function cueAt(age) {
    const mark = (t) => (t >= 0 && t < CUE_SHOW ? 1 : 0);
    return Math.max(mark(age - 0.35), mark(age - 0.35 - CUE_GAP));
}

/** Where the composition hangs the pulsar for an aspect (screen fractions, y down) and the lens. */
export function pulsarAnchor(aspect) {
    const a = Math.max(0.3, Number.isFinite(aspect) ? aspect : 16 / 9);
    if (a < 0.9) {
        // An upright phone: the board fills the width; the lantern hangs in the sky above it.
        return { x: 0.5, y: 0.12, vFov: 64 };
    }
    // Landscape: the free zone left of the card. Wider frames lean a little further out.
    const x = a >= 1.3 ? 0.205 + Math.min(0.03, (a - 1.78) * 0.03) : 0.17;
    return { x: Math.max(0.15, x), y: a >= 1.3 ? 0.34 : 0.3, vFov: 50 };
}
