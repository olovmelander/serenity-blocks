/**
 * Thermal Bloom core: three-free constants and maths shared by the world, the director, the
 * playground effect and the unit tests. Nothing here touches the DOM, the bus or a renderer.
 *
 * The world is the Iris Basin, a fictional hydrothermal basin seen from an overlook at late
 * morning (docs/theme-concepts/iris-springs.md, the concept this theme builds; it was renamed
 * Thermal Bloom at Stage 0). Its ground colours are a function of a real physical variable,
 * the water's temperature: a normalised T runs from 1 at the vent (cobalt water) through the
 * turquoise shelf and the cream silica rim to the living mats (lemon, orange, rust, olive) and
 * out to dry bleached sinter at 0. The mats change pigment with the season (one step per level),
 * the steam with the basin's breath (a closed-form sum of three slow sines), and every ambient
 * schedule (gusts, the Chalice's preplay and its idle eruption) is hashed from the clock, so
 * seek(t) reproduces any frame.
 */

/** Piece shape → integer code (the shadow-well encoding). 7 = garbage / unknown. */
export const PIECE_CODE = Object.freeze({
    I: 0, T: 1, Z: 2, L: 3, S: 4, J: 5, O: 6, GARBAGE: 7,
});

/**
 * Each piece code's pigment (sRGB hex), in PIECE_CODE order: the same seven hexes as
 * thermal-bloom-tetrominos.js, so a lock blooms in the piece's own colour; 7 is Bleached Sinter.
 */
export const PIECE_HEX = Object.freeze([
    '#FF9A3C', // I  Phormidium Orange
    '#F5D020', // T  Sulfur Lemon
    '#619945', // Z  Mat Green
    '#BD3B1A', // L  Calothrix Rust
    '#19C2D6', // S  Vent Turquoise
    '#E2559A', // J  Streamer Rose
    '#3A78F0', // O  Iris Cobalt (bright)
    '#7E776C', // garbage: Bleached Sinter
]);

/** Piece shape key → code, tolerant of lower case and unknown input. */
export function pieceCode(shape) {
    if (typeof shape !== 'string') return PIECE_CODE.GARBAGE;
    const key = shape.trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(PIECE_CODE, key) ? PIECE_CODE[key] : PIECE_CODE.GARBAGE;
}

/**
 * A piece matrix as 4 cell offsets (8 numbers, x right, y up), centred on its bounding box.
 * Returns null for anything that is not a matrix with at least one filled cell.
 */
export function cellsFromMatrix(matrix) {
    if (!Array.isArray(matrix)) return null;
    const cells = [];
    for (let r = 0; r < matrix.length && r < 8; r++) {
        const row = matrix[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length && c < 8; c++) {
            if (Number(row[c]) > 0 && cells.length < 8) cells.push(c, -r);
        }
    }
    if (!cells.length) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < cells.length; i += 2) {
        minX = Math.min(minX, cells[i]);
        maxX = Math.max(maxX, cells[i]);
        minY = Math.min(minY, cells[i + 1]);
        maxY = Math.max(maxY, cells[i + 1]);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const out = new Array(8);
    for (let i = 0; i < 8; i += 2) {
        const j = i < cells.length ? i : 0;
        out[i] = cells[j] - cx;
        out[i + 1] = cells[j + 1] - cy;
    }
    return out;
}

/** Fraction of the way to a target after dt at an exponential rate. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two edges (0 when the edges are equal or reversed and v is below lo). */
export function smooth(lo, hi, v) {
    if (hi === lo) return v < lo ? 0 : 1;
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** Ken Perlin's smootherstep on 0..1. */
export function smoother(t) {
    const x = clamp01(t);
    return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Small, fast, deterministic PRNG (returns a function giving floats in [0, 1)). */
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

/** A stateless hash of an integer (and a salt) to [0, 1): the ambient schedules' dice. */
export function hash1(n, salt = 0) {
    let h = Math.imul((Math.trunc(n) | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35);
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

/** The pieces in their spawn orientation (the game's own matrices). */
export const SHAPES = Object.freeze({
    I: [[1, 1, 1, 1]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]],
});
export const SHAPE_KEYS = Object.freeze(Object.keys(SHAPES));

// ── Colour ──────────────────────────────────────────────────────────────────────

const srgbChannelToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** An sRGB hex ('#RRGGBB') as linear RGB in 0..1 (black for anything else). */
export function hexToLinear(hex, out = [0, 0, 0]) {
    const m = typeof hex === 'string' ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
    if (!m) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        return out;
    }
    const n = parseInt(m[1], 16);
    out[0] = srgbChannelToLinear(((n >> 16) & 255) / 255);
    out[1] = srgbChannelToLinear(((n >> 8) & 255) / 255);
    out[2] = srgbChannelToLinear((n & 255) / 255);
    return out;
}

/** The basin's named colours (High Summer, the resting look). */
export const COLORS = Object.freeze({
    irisCobalt: '#0B3A8C',
    ventTurquoise: '#14B3C8',
    sinterCream: '#EDE6CF',
    lemon: '#E9CF2C',
    orange: '#EE7420',
    rust: '#9C3A1C',
    olive: '#5E7F2E',
    steamLit: '#F3F1EC',
    steamShade: '#9DB1C6',
    skyZenith: '#3F7FC8',
    skyHaze: '#DCE7EE',
    /** Aerial perspective's target: a warm pearl, never Rainbark's blue air (§4.2). */
    hazePearl: '#E8E6DE',
    lodgepole: '#2F4A3E',
    plateau: '#7E97A8',
    sun: '#FFF1DC',
    bleachedSinter: '#7E776C',
    opal: '#CFE3E0',
});

/**
 * The temperature bands (normalised T, §1.3): above WATER the ground is under water (the shelf,
 * then the eye); the mats live between DRY and CREAM.
 */
export const T_BANDS = Object.freeze({
    eye: 0.92,
    water: 0.85,
    cream: 0.78,
    lemon: 0.70,
    orange: 0.55,
    rust: 0.40,
    olive: 0.25,
});

/**
 * The six seasons (one step per level, §1.3 A). Every season keeps the cobalt, turquoise and
 * cream core; only the living bands, the air and the rim change. `ramp` is the season's row of
 * the temperature ramp: [T, sRGB hex] stops, T rising from dry sinter to the vent. `steam`
 * scales the plumes' density, `snow` lays snow on the cold ground and the rim, `frost` feathers
 * the ghost pines, `wet` is the thaw's meltwater sheen.
 */
export const SEASONS = Object.freeze([
    Object.freeze({
        name: 'High Summer',
        ramp: Object.freeze([
            [0.00, '#E4DFD4'], [0.08, '#D3CBBC'], [0.14, '#ADA392'], [0.20, '#8F8475'],
            [0.27, '#7C6E58'], [0.33, '#6E6B3E'], [0.40, '#7A4A26'], [0.47, '#9C3A1C'],
            [0.55, '#C9561E'], [0.63, '#EE7420'], [0.70, '#F29A2C'], [0.74, '#E9CF2C'],
            [0.79, '#E8E0A8'], [0.83, '#EDE6CF'], [0.87, '#8FD3D0'], [0.90, '#14B3C8'],
            [0.94, '#1A63A8'], [1.00, '#0B3A8C'],
        ]),
        zenith: '#3F7FC8',
        haze: '#DCE7EE',
        rim: '#2F4A3E',
        meadow: '#5C6E3A',
        steam: 1.0,
        snow: 0,
        frost: 0,
        wet: 0,
        sun: '#FFF1DC',
        sat: 1.0,
    }),
    Object.freeze({
        name: 'Straw Gold',
        ramp: Object.freeze([
            [0.00, '#E6DFCC'], [0.08, '#D8CCB0'], [0.14, '#B8A684'], [0.20, '#9A8566'],
            [0.27, '#8A7448'], [0.33, '#857232'], [0.40, '#6A2E22'], [0.47, '#8E2626'],
            [0.55, '#B8401E'], [0.63, '#E0602A'], [0.70, '#EC8A2A'], [0.74, '#E6C42C'],
            [0.79, '#E8DCA0'], [0.83, '#EDE6CF'], [0.87, '#8FD3D0'], [0.90, '#14B3C8'],
            [0.94, '#1A63A8'], [1.00, '#0B3A8C'],
        ]),
        zenith: '#4A84C4',
        haze: '#E6E4D8',
        rim: '#3C4A30',
        meadow: '#B89E52',
        steam: 1.0,
        snow: 0,
        frost: 0,
        wet: 0,
        sun: '#FFEFD6',
        sat: 1.04,
    }),
    Object.freeze({
        name: 'First Frost',
        ramp: Object.freeze([
            [0.00, '#E2E0DA'], [0.08, '#D0CCC2'], [0.14, '#ADA79A'], [0.20, '#8E887A'],
            [0.27, '#7A7458'], [0.33, '#6A7438'], [0.40, '#7A5A28'], [0.47, '#8A5A22'],
            [0.55, '#B8782A'], [0.63, '#D8902C'], [0.70, '#E2A830'], [0.74, '#DCC83A'],
            [0.79, '#E2DCA8'], [0.83, '#EDE6CF'], [0.87, '#8FD3D0'], [0.90, '#14B3C8'],
            [0.94, '#1A63A8'], [1.00, '#0B3A8C'],
        ]),
        zenith: '#4A86CC',
        haze: '#E2E8EC',
        rim: '#2F4A3E',
        meadow: '#D8A43A',
        steam: 1.45,
        snow: 0,
        frost: 1,
        wet: 0,
        sun: '#FFF3E2',
        sat: 0.98,
    }),
    Object.freeze({
        name: 'Deep Cold',
        ramp: Object.freeze([
            [0.00, '#EEF1F4'], [0.12, '#E8EBEE'], [0.18, '#D8DBDA'], [0.22, '#9AA096'],
            [0.27, '#4E6A40'], [0.33, '#2E5A36'], [0.40, '#335A30'], [0.47, '#4A5E2C'],
            [0.55, '#8A6A2A'], [0.63, '#D9762A'], [0.70, '#E6922C'], [0.74, '#D6C83A'],
            [0.79, '#E0DCB0'], [0.83, '#EDE6CF'], [0.87, '#8FD3D0'], [0.90, '#14B3C8'],
            [0.94, '#1A63A8'], [1.00, '#0B3A8C'],
        ]),
        zenith: '#8FB2D6',
        haze: '#E8EEF2',
        rim: '#3E5450',
        meadow: '#E6EAEE',
        steam: 1.6,
        snow: 1,
        frost: 1,
        wet: 0,
        sun: '#F4F2EE',
        sat: 0.95,
    }),
    Object.freeze({
        name: 'Thaw',
        ramp: Object.freeze([
            [0.00, '#D2CDC0'], [0.08, '#C2BCAC'], [0.14, '#A39B88'], [0.20, '#857C68'],
            [0.27, '#6E8A3A'], [0.33, '#4E7E34'], [0.40, '#5E8A30'], [0.47, '#8AAE34'],
            [0.55, '#B4C834'], [0.63, '#D9A030'], [0.67, '#E58430'], [0.71, '#E8B030'],
            [0.75, '#DCD440'], [0.80, '#E4E2B4'], [0.83, '#EDE6CF'], [0.87, '#8FD3D0'],
            [0.90, '#14B3C8'], [0.94, '#1A63A8'], [1.00, '#0B3A8C'],
        ]),
        zenith: '#3A82D0',
        haze: '#DDEAF0',
        rim: '#2F4E3E',
        meadow: '#6E8A4A',
        steam: 1.1,
        snow: 0.25,
        frost: 0,
        wet: 1,
        sun: '#FFF4E4',
        sat: 1.02,
    }),
    Object.freeze({
        name: 'Bloom',
        ramp: Object.freeze([
            [0.00, '#E4DFD4'], [0.08, '#D3CBBC'], [0.14, '#ADA392'], [0.20, '#8F8475'],
            [0.27, '#8A9A48'], [0.33, '#8AA83A'], [0.40, '#C0486E'], [0.47, '#D85A90'],
            [0.55, '#E06A50'], [0.63, '#EE7420'], [0.70, '#F29A2C'], [0.74, '#E9CF2C'],
            [0.79, '#E8E0A8'], [0.83, '#EDE6CF'], [0.87, '#8FD3D0'], [0.90, '#14B3C8'],
            [0.94, '#1A63A8'], [1.00, '#0B3A8C'],
        ]),
        zenith: '#3F7FC8',
        haze: '#E0E8EC',
        rim: '#2F5A3E',
        meadow: '#7A9A44',
        steam: 0.95,
        snow: 0,
        frost: 0,
        wet: 0,
        sun: '#FFF1DC',
        sat: 1.06,
    }),
]);

/** Seconds of active play per season step where no level ever comes (Infinity, multiplayer). */
export const SEASON_CLOCK = 300;

/** The season a level stands in: (level − 1) mod 6, so level 7 is High Summer again. */
export function seasonForLevel(level) {
    const n = Math.max(1, Math.round(Number.isFinite(Number(level)) ? Number(level) : 1));
    return (n - 1) % SEASONS.length;
}

/** The temperature ramp's width (texels): one row per season. */
export const RAMP_WIDTH = 256;

/** A season's ramp at T (0..1, clamped), interpolated in linear light between its stops. */
export function rampAt(season, T, out = [0, 0, 0]) {
    const stops = SEASONS[((season % SEASONS.length) + SEASONS.length) % SEASONS.length].ramp;
    const x = clamp01(Number.isFinite(T) ? T : 0);
    let i = 0;
    while (i < stops.length - 2 && x > stops[i + 1][0]) i += 1;
    const a = hexToLinear(stops[i][1], [0, 0, 0]);
    const b = hexToLinear(stops[i + 1][1], [0, 0, 0]);
    const span = stops[i + 1][0] - stops[i][0];
    const k = span > 0 ? clamp01((x - stops[i][0]) / span) : 0;
    for (let c = 0; c < 3; c++) out[c] = a[c] + (b[c] - a[c]) * k;
    return out;
}

// ── The basin's breath, its wind and its gusts (§1.3 B) ────────────────────────

/** The breath's three incommensurate periods (seconds). */
export const BREATH_PERIODS = Object.freeze([71, 97, 133]);

/** The basin's breath at t: 0 (warm, thin steam) … 1 (cold, thick). Closed form. */
export function breathAt(t) {
    const x = Number.isFinite(t) ? t : 0;
    const s = Math.sin((TAU * x) / BREATH_PERIODS[0])
        + Math.sin((TAU * x) / BREATH_PERIODS[1] + 1.3)
        + Math.sin((TAU * x) / BREATH_PERIODS[2] + 2.1);
    return clamp01(0.5 + s / 6);
}

/** Steam density multiplier for a breath (×0.7 … ×1.35). */
export const steamForBreath = (b) => lerp(0.7, 1.35, clamp01(b));

/**
 * The wind at t: `angle` (radians, the offset of its heading from the base heading, ±20°)
 * and `speed` (metres a second, 1.5 … 4).
 */
export function windAt(t, out = { angle: 0, speed: 2 }) {
    const x = Number.isFinite(t) ? t : 0;
    out.angle = 20 * DEG * (0.6 * Math.sin((TAU * x) / 97 + 0.4) + 0.4 * Math.sin((TAU * x) / 61 + 2.2));
    out.speed = 2.75 + 1.25 * (0.55 * Math.sin((TAU * x) / 71 + 0.9) + 0.45 * Math.sin((TAU * x) / 43));
    return out;
}

/** Gusts: one per cell, starting somewhere in its first GUST_JITTER seconds, crossing in GUST_CROSS. */
export const GUST_CELL = 30;
export const GUST_JITTER = 10;
export const GUST_CROSS = 6;

/**
 * The gust tearing through the steam at t: `phase` 0..1 across its crossing (−1 when none is
 * crossing), and `seed` (0..1) for its lane. Starts are 20–40 s apart.
 */
export function gustAt(t, out = { phase: -1, seed: 0 }) {
    const x = Math.max(0, Number.isFinite(t) ? t : 0);
    const k = Math.floor(x / GUST_CELL);
    out.phase = -1;
    out.seed = 0;
    for (let j = k; j >= k - 1 && j >= 0; j -= 1) {
        const start = j * GUST_CELL + 5 + GUST_JITTER * hash1(j, 11);
        const phase = (x - start) / GUST_CROSS;
        if (phase >= 0 && phase < 1) {
            out.phase = phase;
            out.seed = hash1(j, 23);
            return out;
        }
    }
    return out;
}

// ── The Chalice's idle cycle (§1.4, §3.9) ──────────────────────────────────────

/** Preplay clusters: one per cell (35–50 s apart), each 2–4 splashes. */
export const PREPLAY_CELL = 42.5;
export const PREPLAY_JITTER = 7.5;
/** The idle eruption: every IDLE_PERIOD seconds, the first at t = IDLE_PERIOD, never earlier. */
export const IDLE_PERIOD = 170;
export const IDLE_WATER = 10;
export const IDLE_STEAM = 20;
export const IDLE_HEIGHT = 25;

/**
 * What the Chalice's own clock is doing at t (closed form, seek-safe):
 * `preplayAge` (seconds since the latest preplay cluster began, or −1), `preplaySeed`,
 * `splashes` (2–4) in it; `eruptionAge` (seconds since the latest idle eruption began, or −1
 * while none has, or after its water and steam phases).
 */
export function chaliceSchedule(t, out = {
    preplayAge: -1, preplaySeed: 0, splashes: 0, eruptionAge: -1,
}) {
    const x = Math.max(0, Number.isFinite(t) ? t : 0);
    out.preplayAge = -1;
    out.preplaySeed = 0;
    out.splashes = 0;
    const k = Math.floor(x / PREPLAY_CELL);
    for (let j = k; j >= k - 1 && j >= 0; j -= 1) {
        const start = (j + 0.5) * PREPLAY_CELL + PREPLAY_JITTER * (hash1(j, 31) - 0.5);
        if (x >= start && x - start < 6) {
            out.preplayAge = x - start;
            out.preplaySeed = hash1(j, 37);
            out.splashes = 2 + Math.floor(hash1(j, 41) * 3);
            break;
        }
    }
    const e = Math.floor(x / IDLE_PERIOD);
    const age = x - e * IDLE_PERIOD;
    out.eruptionAge = e >= 1 && age < IDLE_WATER + IDLE_STEAM ? age : -1;
    return out;
}

// ── Eruptions (closed-form envelopes) ───────────────────────────────────────────

/**
 * A water column's shape over its life. Every kind rises with a decelerating launch to its
 * peak, holds with a flutter, then falls back as rain; a steam phase follows (§3.6.2, §3.10).
 * delay: seconds before the launch (the four-line surge); rise: launch to peak; hold: at peak;
 * fall: back to the vent; steam: the steam phase after the water.
 */
export const ERUPTIONS = Object.freeze({
    preplay: Object.freeze({
        delay: 0, rise: 0.35, hold: 0.15, fall: 0.6, steam: 0, height: 3,
    }),
    idle: Object.freeze({
        delay: 0, rise: 1.5, hold: 7.5, fall: 1.0, steam: IDLE_STEAM, height: IDLE_HEIGHT,
    }),
    combo: Object.freeze({
        delay: 0, rise: 0.8, hold: 1e6, fall: 1.2, steam: 0, height: 25,
    }),
    quad: Object.freeze({
        delay: 0.35, rise: 0.8, hold: 2.85, fall: 1.2, steam: 15, height: 90,
    }),
    consort: Object.freeze({
        delay: 0.6, rise: 0.7, hold: 2.4, fall: 1.0, steam: 8, height: 50,
    }),
    sleeper: Object.freeze({
        delay: 0.8, rise: 1.6, hold: 4.0, fall: 2.0, steam: 10, height: 150,
    }),
    spouter: Object.freeze({
        delay: 0, rise: 0.3, hold: 0.5, fall: 0.5, steam: 0, height: 8,
    }),
});

/**
 * The column's height (metres) at `age` seconds after the event for an eruption kind (0 before
 * the launch and after the fall). `peak` overrides the kind's height.
 */
export function columnHeight(kind, age, peak) {
    const e = ERUPTIONS[kind] || ERUPTIONS.preplay;
    const h = Number.isFinite(peak) ? peak : e.height;
    const a = age - e.delay;
    if (!(a > 0)) return 0;
    if (a < e.rise) {
        const k = a / e.rise;
        return h * (1 - (1 - k) * (1 - k)); // a ballistic launch: fast, then slowing
    }
    const held = a - e.rise;
    if (held < e.hold) return h;
    const f = (held - e.hold) / e.fall;
    if (f >= 1) return 0;
    return h * (1 - f * f);
}

/** How long a kind's water and steam last, all told (seconds after the event). */
export function eruptionLength(kind) {
    const e = ERUPTIONS[kind] || ERUPTIONS.preplay;
    return e.delay + e.rise + e.hold + e.fall + e.steam;
}

/** The steam phase after a chain breaks at peak p: 4 + 2·p seconds (§1.5, §3.9). */
export const steamPhaseLength = (peak) => 4 + 2 * Math.max(0, Number(peak) || 0);

/** One preplay splash a link (§3.9 gauge 1): its height in metres for the chain it raises. */
export function preplayHeight(chain) {
    const n = Math.max(0, Math.round(Number(chain) || 0));
    if (n < 2) return 0;
    if (n <= 3) return 1 + 1.5 * (n - 2) + 1.5; // links 2–3: 2.5 … 4 m (1–4 m splashes)
    if (n <= 5) return 8 + 3.5 * (n - 4); // links 4–5: 8 … 11.5 m (8–15 m)
    return Math.min(60, 25 + 7 * (n - 6)); // links 6+: a sustained column, 25 growing to 60 m
}

// ── Lock blooms under slot pressure (§3.7) ──────────────────────────────────────

/** A bloom's life (seconds) for N slots at a lock rate λ (locks/s): clamp(0.9·N/λ, 6, 60). */
export function bloomLife(slots, rate) {
    const n = Math.max(1, Number(slots) || 1);
    const lambda = Number(rate);
    if (!(lambda > 0)) return 60;
    return Math.max(6, Math.min(60, (0.9 * n) / lambda));
}

/**
 * A bloom's bleach at `age` of a life L: `sat` 1 while saturated (0.13·L), easing to 0 by 0.5·L
 * (pale cream); `alive` 1 until recolonised, easing to 0 by L.
 */
export function bleachAt(age, life, out = { sat: 1, alive: 1 }) {
    const a = Math.max(0, Number(age) || 0);
    const L = Math.max(1e-3, Number(life) || 60);
    out.sat = 1 - smooth(0.13 * L, 0.5 * L, a);
    out.alive = 1 - smooth(0.5 * L, L, a);
    return out;
}

// ── The combo's two gauges and the eye's heat (§3.9) ────────────────────────────

/** Notches the fingers' wet front can reach (a chain of n ≥ 2 stands at notch n − 1, capped). */
export const REACH_NOTCHES = 8;

/** The fingers' wet front for a chain: radius as a multiple of the rim's (1 at rest). */
export function fingerReach(chain) {
    const n = Math.max(0, Math.round(Number(chain) || 0));
    const k = n >= 2 ? Math.min(REACH_NOTCHES, n - 1) : 0;
    return 1 + 0.12 * k;
}

/**
 * The eye's widening (a fraction: 0.1 = 10% wider): 6% a link (capped at +40%) plus 3% a level
 * above the first (capped at +15%), the two capped together at +50%.
 */
export function eyeHeat(chain, level) {
    const links = Math.max(0, Math.round(Number(chain) || 0) - 1);
    const lv = Math.max(1, Math.round(Number(level) || 1));
    return Math.min(0.5, Math.min(0.4, 0.06 * links) + Math.min(0.15, 0.03 * (lv - 1)));
}

// ── Light and the one bow (§3.2, §3.4) ──────────────────────────────────────────

/** The primary bow's band (degrees from the antisolar point), red outside. */
export const BOW = Object.freeze({ inner: 40.6, outer: 42.4, blend: 0.6 });

/**
 * The sun's ranges (degrees). Azimuth is measured from the view direction toward the camera's
 * left (180 = straight behind the camera); a mirrored preset swings it to the right.
 */
export const SUN_RANGES = Object.freeze({
    desktop: Object.freeze({ azimuth: Object.freeze([115, 130]), elevation: Object.freeze([30, 36]) }),
    portrait: Object.freeze({ azimuth: Object.freeze([140, 150]), elevation: Object.freeze([28, 36]) }),
});

/**
 * The unit vector toward the sun for an azimuth (degrees from the horizontal view direction
 * (fx, fz) toward the camera's left, or its right when mirrored) and an elevation (degrees).
 */
export function sunVector(azimuth, elevation, fx = 0, fz = -1, mirrored = false, out = [0, 0, 0]) {
    const n = Math.hypot(fx, fz) || 1;
    const f0 = fx / n;
    const f2 = fz / n;
    // The camera's left on the ground plane (y up): forward (0, 0, −1) has its left at (−1, 0, 0).
    const side = mirrored ? -1 : 1;
    const l0 = f2 * side;
    const l2 = -f0 * side;
    const az = azimuth * DEG;
    const el = elevation * DEG;
    const hx = f0 * Math.cos(az) + l0 * Math.sin(az);
    const hz = f2 * Math.cos(az) + l2 * Math.sin(az);
    out[0] = hx * Math.cos(el);
    out[1] = Math.sin(el);
    out[2] = hz * Math.cos(el);
    return out;
}

/** Degrees between a view direction (from the eye to P) and the antisolar direction. */
export function antisolarAngle(eye, P, sun) {
    const dx = P[0] - eye[0];
    const dy = P[1] - eye[1];
    const dz = P[2] - eye[2];
    const d = Math.hypot(dx, dy, dz) || 1;
    const c = -(dx * sun[0] + dy * sun[1] + dz * sun[2]) / d;
    return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

/**
 * Where the primary bow crosses a vertical column (its base at `base`, `height` metres tall)
 * seen from `eye` with the sun along `sun`: the height above the base (metres) of the bow's
 * centre line (41.5°), or −1 when the column never reaches it.
 */
export function bowCrossing(eye, base, height, sun, steps = 64) {
    const mid = (BOW.inner + BOW.outer) / 2;
    const P = [base[0], base[1], base[2]];
    let prev = null;
    for (let i = 0; i <= steps; i++) {
        const h = (height * i) / steps;
        P[1] = base[1] + h;
        const a = antisolarAngle(eye, P, sun) - mid;
        if (prev !== null && Math.sign(a) !== Math.sign(prev.a)) {
            const k = prev.a / (prev.a - a);
            return prev.h + (h - prev.h) * k;
        }
        prev = { h, a };
    }
    return -1;
}

/**
 * The sun for a composition (§3.2): inside the preset's ranges, the (azimuth, elevation) pair
 * that puts the primary bow across the Chalice's column at 55–70% of its height (aiming at
 * 62.5%); if none does, the in-range pair nearest that target, and the bow is simply unseen.
 * @param {{ eye: number[], forward: number[], base: number[], height: number,
 *   preset?: 'desktop'|'portrait', mirrored?: boolean }} q
 * @returns {{ azimuth: number, elevation: number, crossing: number, onColumn: boolean }}
 */
export function solveSun(q) {
    const ranges = SUN_RANGES[q.preset === 'portrait' ? 'portrait' : 'desktop'];
    const [az0, az1] = ranges.azimuth;
    const [el0, el1] = ranges.elevation;
    const target = 0.625 * q.height;
    const sun = [0, 0, 0];
    let best = null;
    for (let i = 0; i <= 15; i++) {
        const azimuth = az0 + ((az1 - az0) * i) / 15;
        for (let j = 0; j <= 12; j++) {
            const elevation = el0 + ((el1 - el0) * j) / 12;
            sunVector(azimuth, elevation, q.forward[0], q.forward[2], q.mirrored === true, sun);
            const crossing = bowCrossing(q.eye, q.base, q.height * 1.5, sun);
            const onColumn = crossing >= 0.55 * q.height && crossing <= 0.70 * q.height;
            // Off the column: how far off, in column heights (never crossing = far off).
            const miss = crossing < 0 ? 10 : Math.abs(crossing - target) / q.height;
            const score = (onColumn ? 0 : 1) + miss;
            if (!best || score < best.score) {
                best = {
                    azimuth, elevation, crossing, onColumn, score,
                };
            }
        }
    }
    return {
        azimuth: best.azimuth, elevation: best.elevation, crossing: best.crossing, onColumn: best.onColumn,
    };
}

// ── The overlook: the camera rig and the composition (§1.2) ─────────────────────

/**
 * The camera rig's two presets. We stand on a pale sinter lip above the basin floor (y = 0)
 * and look down along −z: on a desktop 44 m up, pitched down 18° with a 46° vertical field of
 * view (the horizon about 12% from the top); upright (aspect < 0.62) the camera rises to 60 m,
 * pitches down 30° and widens to 62°, so the Iris is seen more face-on below the card.
 */
export const RIG = Object.freeze({
    desktop: Object.freeze({ height: 44, pitch: 18, fov: 46 }),
    portrait: Object.freeze({ height: 60, pitch: 30, fov: 62 }),
});

/**
 * The aspect's weights: `k` 0 upright … 1 landscape (the preset switch at 0.62, done by 1.2),
 * `w` 16:9 … 21:9, `q` 4:3 … 16:9 (0 at 16:9 and wider).
 */
export function aspectWeights(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    return { k: smooth(0.62, 1.2, a), w: smooth(1.78, 2.37, a), q: 1 - smooth(1.33, 1.78, a) };
}

/** The rest rig (height, pitch down, vertical fov; metres and degrees) for an aspect. */
export function rigForAspect(aspect, out = { height: 44, pitch: 18, fov: 46 }) {
    const { k } = aspectWeights(aspect);
    out.height = lerp(RIG.portrait.height, RIG.desktop.height, k);
    out.pitch = lerp(RIG.portrait.pitch, RIG.desktop.pitch, k);
    out.fov = lerp(RIG.portrait.fov, RIG.desktop.fov, k);
    return out;
}

/** The rest camera's frame for a rig: position, forward, up, right (camera at x = z = 0). */
export function rigFrame(rig) {
    const p = rig.pitch * DEG;
    return {
        position: [0, rig.height, 0],
        forward: [0, -Math.sin(p), -Math.cos(p)],
        up: [0, Math.cos(p), -Math.sin(p)],
        right: [1, 0, 0],
    };
}

/**
 * The ground point under a screen point (fractions, y down) at elevation `y`, seen from the rest
 * rig, or null when that ray never comes down to it.
 */
export function screenToGround(rig, aspect, sx, sy, y = 0) {
    const f = rigFrame(rig);
    const tanV = Math.tan((rig.fov * DEG) / 2);
    const tanH = tanV * aspect;
    const nx = (2 * sx - 1) * tanH;
    const ny = (1 - 2 * sy) * tanV;
    const d = [0, 1, 2].map((i) => f.forward[i] + f.right[i] * nx + f.up[i] * ny);
    const drop = y - f.position[1];
    if (!(d[1] < -1e-6) || drop > 0) return null;
    const t = drop / d[1];
    return [f.position[0] + d[0] * t, y, f.position[2] + d[2] * t];
}

/** A world point on screen (fractions, y down) from the rest rig; null when behind the camera. */
export function projectToScreen(rig, aspect, P) {
    const f = rigFrame(rig);
    const d = [P[0] - f.position[0], P[1] - f.position[1], P[2] - f.position[2]];
    const zc = d[0] * f.forward[0] + d[1] * f.forward[1] + d[2] * f.forward[2];
    if (!(zc > 1e-6)) return null;
    const tanV = Math.tan((rig.fov * DEG) / 2);
    const xc = (d[0] * f.right[0] + d[1] * f.right[1] + d[2] * f.right[2]) / zc / (tanV * aspect);
    const yc = (d[0] * f.up[0] + d[1] * f.up[1] + d[2] * f.up[2]) / zc / tanV;
    return [(xc + 1) / 2, (1 - yc) / 2];
}

/**
 * Where each hero stands on screen (fractions, y down) for a layout preset: the Iris's eye, the
 * Chalice's vent, the Sleeper's mound on the far rim, the Consort's vent on the far apron, and
 * the Stair's near end in the bottom-right corner. 16:9 from §1.2 and §3.5/§3.12; 21:9 and 4:3
 * where those sections give them; upright from the portrait preset.
 */
export const ANCHORS = Object.freeze({
    wide169: Object.freeze({
        eye: [0.16, 0.39],
        chalice: [0.88, 0.33],
        sleeper: [0.72, 0.145],
        consort: [0.25, 0.24],
        stairNear: [0.99, 0.97],
    }),
    wide219: Object.freeze({
        eye: [0.13, 0.39],
        chalice: [0.80, 0.33],
        sleeper: [0.88, 0.145],
        consort: [0.22, 0.24],
        stairNear: [0.97, 0.97],
    }),
    wide43: Object.freeze({
        eye: [0.15, 0.40],
        chalice: [0.93, 0.34],
        sleeper: [0.70, 0.145],
        consort: [0.24, 0.245],
        stairNear: [0.99, 0.97],
    }),
    portrait: Object.freeze({
        eye: [0.5, 0.87],
        chalice: [0.72, 0.10],
        sleeper: [0.42, 0.055],
        consort: [0.28, 0.08],
        stairNear: [0.98, 0.84],
    }),
});
export const ANCHOR_KEYS = Object.freeze(['eye', 'chalice', 'sleeper', 'consort', 'stairNear']);

/**
 * The screen anchors for an aspect, blended between the presets, and mirrored (the Iris on the
 * right, the Chalice and the Stair on the left) when the HUD sits on the larger free side.
 */
export function anchorsFor(aspect, mirrored = false) {
    const { k, w, q } = aspectWeights(aspect);
    const out = {};
    ANCHOR_KEYS.forEach((key) => {
        const wide = [0, 1].map((i) => {
            const base = lerp(ANCHORS.wide169[key][i], ANCHORS.wide219[key][i], w);
            return lerp(base, ANCHORS.wide43[key][i], q);
        });
        const p = [0, 1].map((i) => lerp(ANCHORS.portrait[key][i], wide[i], k));
        if (mirrored) p[0] = 1 - p[0];
        out[key] = p;
    });
    return out;
}

/**
 * The elevations (metres) the heroes stand at: the pool surface, the Chalice's vent on its mound,
 * the Sleeper's mound near the far rim, the Consort's vent, the Stair's lowest pool.
 */
export const ELEVATION = Object.freeze({
    eye: 0, chalice: 12, sleeper: 18, consort: 2, stairNear: 1,
});

/** The Iris pool's radius (metres, about 105 m across), and the Chalice's cone. */
export const IRIS_RADIUS = 52;
export const CHALICE = Object.freeze({ height: 9, radius: 7, mound: 30 });

/**
 * The world plan for an aspect: where each hero stands (metres), solved by unprojecting its
 * screen anchor from the rest rig onto its elevation. Far anchors that would cross the horizon
 * are held below it.
 */
export function composeWorld(aspect, mirrored = false) {
    const rig = rigForAspect(aspect, {});
    const anchors = anchorsFor(aspect, mirrored);
    const tanV = Math.tan((rig.fov * DEG) / 2);
    // The screen y of the true horizon, and a hair below it (rays must come down to the ground).
    const horizon = 0.5 - Math.tan(rig.pitch * DEG) / (2 * tanV);
    const plan = {
        rig, anchors, horizon, mirrored,
    };
    ANCHOR_KEYS.forEach((key) => {
        const [sx, sy] = anchors[key];
        const elev = ELEVATION[key];
        // An elevated point sits higher on screen than the ground under the same ray: keep its
        // ray above the horizon line by the margin its height needs, then solve.
        let y = Math.max(sy, horizon + 0.004);
        let p = screenToGround(rig, aspect, sx, y, elev);
        while (!p && y < 1) {
            y += 0.004;
            p = screenToGround(rig, aspect, sx, y, elev);
        }
        plan[key] = p || [0, elev, -1000];
    });
    return plan;
}

/**
 * How much of a column standing on `base` the rest rig sees (metres): from its foot up to where
 * the frame's top edge cuts it, at most `height`. The bow is placed on the visible part (§3.2).
 */
export function visibleColumn(rig, base, height) {
    const d = Math.hypot(base[0], base[2]);
    const topAngle = (rig.fov / 2 - rig.pitch) * DEG;
    const cut = rig.height + Math.tan(topAngle) * d - base[1];
    return Math.max(8, Math.min(height, cut));
}

// ── The shared tables ───────────────────────────────────────────────────────────

/** Slots per block of the event table, and rows per slot (§5.4). */
export const EVENT_SLOTS = Object.freeze({
    blooms: 24, fills: 8, jets: 8, eruptions: 8, boils: 4, devils: 3, rosettes: 6, plumes: 14, globals: 1,
});
export const EVENT_ROWS_PER = Object.freeze({
    blooms: 2, fills: 1, jets: 1, eruptions: 2, boils: 1, devils: 2, rosettes: 1, plumes: 1, globals: 4,
});

/** The first row of each block of the event table (one vec4 uniform array of `total` rows). */
export const EVENT_ROWS = (() => {
    const rows = {};
    let at = 0;
    Object.keys(EVENT_SLOTS).forEach((block) => {
        rows[block] = at;
        at += EVENT_SLOTS[block] * EVENT_ROWS_PER[block];
    });
    rows.used = at;
    rows.total = 120;
    return Object.freeze(rows);
})();
