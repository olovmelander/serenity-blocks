/**
 * Sunbraid — core constants and CPU maths (three-free).
 *
 * A pale world under three coloured suns. The suns are a close triple star low in the sky in front
 * of the eye, left of the board, wheeling round one another (the braid), so every shadow is a
 * colour: where the coral sun is hidden the light is jade and cobalt (cyan), where the jade one is
 * hidden it is coral and cobalt (magenta), where the cobalt one is hidden it is coral and jade
 * (gold), and every tower throws a fan of those bands toward the lens. The sun riding lowest in the
 * cluster names the era (eraAt).
 *
 * The braid is the suns' common turn. Its phase is integrated, never the clock times a rate, so a
 * chain can wind it faster and a level can step it on without the light ever jumping back.
 *
 * The director, composition, effect and tests import only this module.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Hermite smoothstep (edges may be reversed). */
export function smooth(e0, e1, x) {
    if (e0 === e1) return x < e0 ? 0 : 1;
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
}
/** Frame-rate independent easing factor for a rate (per second) over dt seconds. */
export const approach = (rate, dt) => 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));

/** Deterministic PRNG (32-bit state). */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** '#rrggbb' → linear RGB triple. */
export function hexToLinear(hex) {
    const h = String(hex).replace('#', '');
    return [0, 2, 4].map((i) => toLinear(parseInt(h.slice(i, i + 2), 16) / 255));
}

// ── The suns ──────────────────────────────────────────────────────────────────────

/**
 * The three suns: colour (linear, peak channel 1), power, and the disc's angular radius. Their
 * sum is a neutral white, so where all three reach a pale surface it is white, and every colour
 * in the world is a sun missing (a shadow) or a sun faced (a slope).
 */
export const SUNS = Object.freeze([
    Object.freeze({
        name: 'coral', rgb: Object.freeze([1.0, 0.27, 0.13]), power: 1.12, radius: 1.45 * DEG,
    }),
    Object.freeze({
        name: 'jade', rgb: Object.freeze([0.16, 1.0, 0.4]), power: 0.84, radius: 1.1 * DEG,
    }),
    Object.freeze({
        name: 'cobalt', rgb: Object.freeze([0.2, 0.36, 1.0]), power: 1.04, radius: 0.95 * DEG,
    }),
]);

/**
 * How strongly the suns light a surface square to them (the sky's own terms are scaled back by the
 * same factor): a cliff turned to a sun glows, the open floor under all three reads near white.
 */
export const LIGHT_GAIN = 3.1;

/**
 * The braid. The three suns are a close triple star: they wheel round one another, a third of a
 * turn apart, in one patch of sky low over the valley to the left of the board, so the whole
 * world is lit from in front of the eye. Every tower stands against their light with coloured
 * rims and throws a fan of three shadows toward the eye, dark where they overlap, splitting into
 * cyan, magenta and gold beyond.
 *  - azimuth / elevation: where the cluster's centre stands (degrees), its elevation nodding
 *    slowly by `nod` over `nodPeriod` seconds so no turn repeats exactly;
 *  - spread: the angular radius of the suns' circle round the centre (degrees), flattened to an
 *    ellipse by `flatten`;
 *  - period: seconds of clock for one whole turn of the braid;
 *  - levelStep: how far a level-up turns it (radians), eased over levelEase seconds.
 */
export const BRAID = Object.freeze({
    azimuth: -27,
    elevation: 9.4,
    nod: 1.5,
    nodPeriod: 1300,
    spread: 4.8,
    /** The circle's height as a share of its width (an ellipse: opened wide, no sun touches the rim). */
    flatten: 0.62,
    period: 330,
    levelStep: TAU / 6,
    levelEase: 4.5,
});

/** Angular speed of the calm braid (radians per second of clock). */
export const BRAID_RATE = TAU / BRAID.period;

/** Where the cluster's centre stands at clock `time`: [azimuth, elevation] in radians. */
export function clusterCentre(time = 0, out = [0, 0]) {
    out[0] = BRAID.azimuth * DEG;
    out[1] = (BRAID.elevation + BRAID.nod * Math.sin((TAU * time) / BRAID.nodPeriod)) * DEG;
    return out;
}

/** Unit vector toward a sun at (azimuth, elevation). */
export function sunDirection(az, el, out = [0, 0, 0]) {
    const c = Math.cos(el);
    out[0] = Math.sin(az) * c;
    out[1] = Math.sin(el);
    out[2] = -Math.cos(az) * c;
    return out;
}

const _centre = [0, 0];
const _c = [0, 0, 0];

/**
 * Unit vector toward sun `k` when the braid stands at `phase` and the clock at `time`; `spread`
 * scales the circle (a chain opens it, a four-line clear closes it to a point).
 */
export function sunVector(phase, k, time = 0, spread = 1, out = [0, 0, 0]) {
    const [az, el] = clusterCentre(time, _centre);
    sunDirection(az, el, _c);
    // East (along rising azimuth) and north (along rising elevation) at the centre.
    const ex = Math.cos(az);
    const ez = Math.sin(az);
    const nx = -Math.sin(az) * Math.sin(el);
    const ny = Math.cos(el);
    const nz = Math.cos(az) * Math.sin(el);
    const rho = BRAID.spread * DEG * Math.max(0, spread);
    const a = phase + (k * TAU) / 3;
    const s = Math.sin(rho);
    const c = Math.cos(rho);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    out[0] = _c[0] * c + (ex * ca + nx * sa * BRAID.flatten) * s;
    out[1] = _c[1] * c + ny * sa * s * BRAID.flatten;
    out[2] = _c[2] * c + (ez * ca + nz * sa * BRAID.flatten) * s;
    const len = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= len;
    out[1] /= len;
    out[2] /= len;
    return out;
}

/** Azimuth and elevation (radians) of a unit direction. */
export function azElOf(dir, out = [0, 0]) {
    out[0] = Math.atan2(dir[0], -dir[2]);
    out[1] = Math.asin(clamp(dir[1], -1, 1));
    return out;
}

/**
 * The era at a braid phase: which sun rides lowest (its glow floods the horizon, its shadows run
 * longest), which comes down next, and how far between them: { low: k, next: k', mix: 0..1 }.
 */
export function eraAt(phase) {
    // Sun k is lowest where its angle round the circle, phase + k·120°, points straight down.
    const turns = (phase + Math.PI / 2) / (TAU / 3);
    const n = Math.round(turns);
    const low = ((-n % 3) + 3) % 3;
    // mix runs 0 → 1 while this sun rides lowest (it is exactly lowest at 0.5); the phase rising
    // carries it on round, and the sun 120° behind it comes down next.
    return { low, next: (low + 2) % 3, mix: turns - n + 0.5 };
}

// ── The eye ───────────────────────────────────────────────────────────────────────

/** Where the eye stands (world metres; the ground under it is laid out in sunbraid-plan.js). */
export const EYE_HEIGHT = 1.75;

/**
 * The camera rig by aspect: vertical field of view and pitch (degrees, negative = down). The
 * horizon sits a little above the middle of a landscape frame so the land and its shadows fill
 * the lower half and the suns ride the upper half beside the card.
 */
export const RIG = Object.freeze({ near: 0.35, far: 42000 });
export function rigFor(aspect) {
    const a = clamp(aspect || 16 / 9, 0.4, 3.2);
    // A phone held upright: the card covers all but a band above and below it, so the lens turns
    // toward the suns and looks down: they ride in the band above, the fans lie in the band below.
    const portrait = smooth(1.0, 0.55, a);
    return {
        fov: lerp(46, 66, portrait),
        pitch: lerp(-4.5, -20, portrait),
        yaw: lerp(0, -20, portrait),
    };
}

// ── Pieces ────────────────────────────────────────────────────────────────────────

/** The pieces' colours by piece code (I T Z L S J O, then garbage): SUNBRAID_TETROMINOS. */
export const PIECE_COLORS = Object.freeze([
    '#FF8463', '#F5BB45', '#62E0D6', '#B9A2F7', '#C8378A', '#22804A', '#2B4FC4', '#2A2D3B',
]);

/** The piece codes the director's shadow well uses (7 = garbage or unknown). */
export const PIECE_CODE = Object.freeze({
    I: 0, T: 1, Z: 2, L: 3, S: 4, J: 5, O: 6, GARBAGE: 7,
});
export const PIECE_KEYS = Object.freeze(['I', 'T', 'Z', 'L', 'S', 'J', 'O']);

export function pieceCode(key) {
    return Object.prototype.hasOwnProperty.call(PIECE_CODE, key) ? PIECE_CODE[key] : 7;
}

/**
 * A locked matrix's occupied cells as offsets from their own centre (x right, y up), eight
 * numbers; null if the matrix is not a 0/1 grid with four cells.
 */
export function cellsFromMatrix(shape, out = new Array(8)) {
    if (!Array.isArray(shape)) return null;
    const cells = [];
    for (let r = 0; r < shape.length; r++) {
        const row = shape[r];
        if (!Array.isArray(row)) return null;
        for (let c = 0; c < row.length; c++) if (row[c]) cells.push([c, r]);
    }
    if (cells.length !== 4) return null;
    let cx = 0;
    let cy = 0;
    cells.forEach(([c, r]) => {
        cx += c;
        cy += r;
    });
    cx /= 4;
    cy /= 4;
    cells.forEach(([c, r], i) => {
        out[i * 2] = c - cx;
        out[i * 2 + 1] = cy - r;
    });
    return out;
}
