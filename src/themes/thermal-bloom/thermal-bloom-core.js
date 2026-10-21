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
            [0.00, '#E4DFD4'], [0.08, '#D6CDBA'], [0.14, '#B3A585'], [0.20, '#8E7A58'],
            [0.27, '#7E6C46'], [0.33, '#727045'], [0.37, '#6C6C42'], [0.42, '#705040'],
            [0.47, '#94401E'], [0.55, '#CC6A30'], [0.63, '#E8803A'], [0.70, '#F09C3A'],
            [0.72, '#E9CF2C'], [0.765, '#E9CF2C'], [0.79, '#E8E0A8'], [0.83, '#EDE6CF'],
            [0.87, '#8FD3D0'], [0.90, '#14B3C8'], [0.94, '#1A63A8'], [1.00, '#0B3A8C'],
        ]),
        zenith: '#3F7FC8',
        haze: '#DCE7EE',
        rim: '#2F4A3E',
        meadow: '#5C6E3A',
        steam: 1.0,
        snow: 0,
        frost: 0,
        wet: 0,
        sun: '#FFE39C',
        sat: 1.0,
    }),
    Object.freeze({
        name: 'Straw Gold',
        ramp: Object.freeze([
            [0.00, '#E6DFCC'], [0.08, '#D8CCB0'], [0.14, '#B8A684'], [0.20, '#9A8566'],
            [0.27, '#8C7C62'], [0.33, '#887640'], [0.40, '#6A2E22'], [0.47, '#8E2626'],
            [0.55, '#B8401E'], [0.63, '#E0602A'], [0.70, '#EC8A2A'], [0.72, '#E6C42C'],
            [0.765, '#E6C42C'], [0.79, '#E8DCA0'], [0.83, '#EDE6CF'], [0.87, '#8FD3D0'],
            [0.90, '#14B3C8'], [0.94, '#1A63A8'], [1.00, '#0B3A8C'],
        ]),
        zenith: '#4A84C4',
        haze: '#E6E4D8',
        rim: '#4E4C2A',
        meadow: '#B89E52',
        steam: 1.0,
        snow: 0,
        frost: 0,
        wet: 0,
        sun: '#FFDCA8',
        sat: 1.04,
    }),
    Object.freeze({
        name: 'First Frost',
        ramp: Object.freeze([
            [0.00, '#E2E0DA'], [0.08, '#D0CCC2'], [0.14, '#ADA79A'], [0.20, '#8E887A'],
            [0.27, '#7A7458'], [0.33, '#6A7438'], [0.40, '#7A5A28'], [0.47, '#8A5A22'],
            [0.55, '#B8782A'], [0.63, '#D8902C'], [0.70, '#E2A830'], [0.72, '#DCC83A'],
            [0.765, '#DCC83A'], [0.79, '#E2DCA8'], [0.83, '#EDE6CF'], [0.87, '#8FD3D0'],
            [0.90, '#14B3C8'], [0.94, '#1A63A8'], [1.00, '#0B3A8C'],
        ]),
        zenith: '#4A86CC',
        haze: '#E2E8EC',
        rim: '#2F4A3E',
        meadow: '#D8A43A',
        steam: 1.45,
        snow: 0,
        frost: 1,
        wet: 0,
        sun: '#FFE4C0',
        sat: 0.98,
    }),
    Object.freeze({
        name: 'Deep Cold',
        ramp: Object.freeze([
            [0.00, '#EEF1F4'], [0.12, '#E8EBEE'], [0.18, '#D8DBDA'], [0.22, '#9AA096'],
            [0.27, '#4E6A40'], [0.33, '#2E5A36'], [0.40, '#335A30'], [0.47, '#4A5E2C'],
            [0.55, '#8A6A2A'], [0.63, '#D9762A'], [0.70, '#E6922C'], [0.72, '#D6C83A'],
            [0.765, '#D6C83A'], [0.79, '#E0DCB0'], [0.83, '#EDE6CF'], [0.87, '#8FD3D0'],
            [0.90, '#14B3C8'], [0.94, '#1A63A8'], [1.00, '#0B3A8C'],
        ]),
        zenith: '#8FB2D6',
        haze: '#E8EEF2',
        rim: '#3E5450',
        meadow: '#E6EAEE',
        steam: 1.6,
        snow: 1,
        frost: 1,
        wet: 0,
        sun: '#FCE8D2',
        sat: 0.95,
    }),
    Object.freeze({
        name: 'Thaw',
        ramp: Object.freeze([
            [0.00, '#D2CDC0'], [0.08, '#C2BCAC'], [0.14, '#A39B88'], [0.20, '#857C68'],
            [0.27, '#76804E'], [0.33, '#5A7438'], [0.40, '#587A34'], [0.47, '#7E9A3A'],
            [0.55, '#A8B43C'], [0.63, '#B6BC3E'], [0.665, '#D8902E'], [0.69, '#B8C042'],
            [0.71, '#C4C848'],
            [0.735, '#CCD058'], [0.775, '#D4D47A'], [0.80, '#E4E2B4'], [0.83, '#EDE6CF'],
            [0.87, '#8FD3D0'], [0.90, '#14B3C8'], [0.94, '#1A63A8'], [1.00, '#0B3A8C'],
        ]),
        zenith: '#3478D4',
        haze: '#D4E4F2',
        rim: '#2F4E3E',
        meadow: '#6E8A4A',
        steam: 1.1,
        snow: 0.25,
        frost: 0,
        wet: 1,
        sun: '#FFE6C4',
        sat: 1.02,
    }),
    Object.freeze({
        name: 'Bloom',
        ramp: Object.freeze([
            [0.00, '#E4DFD4'], [0.08, '#D3CBBC'], [0.14, '#ADA392'], [0.20, '#8F8475'],
            [0.27, '#808458'], [0.33, '#7A8A48'], [0.40, '#7A4A3A'], [0.47, '#8E3A30'],
            [0.55, '#D2603A'], [0.63, '#EE7420'], [0.70, '#F29A2C'], [0.72, '#E9CF2C'],
            [0.765, '#E9CF2C'], [0.79, '#E8E0A8'], [0.83, '#EDE6CF'], [0.87, '#8FD3D0'],
            [0.90, '#14B3C8'], [0.94, '#1A63A8'], [1.00, '#0B3A8C'],
        ]),
        zenith: '#3F7FC8',
        haze: '#E0E8EC',
        rim: '#2F5A3E',
        meadow: '#7A9A44',
        steam: 0.95,
        snow: 0,
        frost: 0,
        wet: 0,
        /** Rose streamers in the runoff channels (named Streamer Rose; no species in game). */
        streamer: '#E07FA0',
        streamerAmount: 0.7,
        sun: '#FFDFB2',
        sat: 1.06,
    }),
]);

/**
 * The year turns with the clock as well as the levels (the owner's standing rule: the palette
 * drifts slowly by itself, whatever the level): one season every SEASON_STEP seconds of the
 * theme's clock, each level-up a step more on top. Each step rests SEASON_REST of its length at
 * each end and turns through the middle, so the light is always on its way.
 */
export const SEASON_STEP = 100;
export const SEASON_REST = 0.15;

/**
 * The wheel's position eased through each step (whole numbers are the seasons themselves): the
 * clock's steps plus the levels' (`offset`), resting SEASON_REST at each end of every step.
 */
export function seasonWheel(time, offset = 0) {
    const s = Math.max(0, Number(time) || 0) / SEASON_STEP + Math.max(0, Number(offset) || 0);
    const base = Math.floor(s);
    return base + smooth(SEASON_REST, 1 - SEASON_REST, s - base);
}

/** A wheel position's two seasons (index a, index b = a + 1, wrapping) and how far between (0..1). */
export function seasonPair(wheel, out = { a: 0, b: 1, k: 0 }) {
    const n = SEASONS.length;
    const base = Math.floor(Math.max(0, Number(wheel) || 0));
    out.a = base % n;
    out.b = (base + 1) % n;
    out.k = Math.max(0, Number(wheel) || 0) - base;
    return out;
}

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

// ── How a column of steam bends: the wind's history ────────────────────────────

/** The heading the breeze leans the steam toward (radians); the wind's angle swings about it. */
export const WIND_HEADING = -0.35;

/**
 * A steam column is the path of the puffs that left its vent: a puff at a height has been rising
 * for an age, and has drifted with every wind it met on the way (the wind's run over that age).
 * So a change in the wind bends the column from the bottom up and the top lags behind, and a gust
 * leaves a kink that climbs the column with its puffs, instead of the whole column pivoting about
 * its foot as one straight stick. The rise slows with height (`bend`), so tall columns bend over.
 *
 *   nodes     points along the column the shader's curved axis passes through (f = k / nodes)
 *   bend      age at a height fraction f is T · f^bend (T = height / rise)
 *   step      seconds a sample of the wind's run table spans; horizon its length
 *   gust      how hard a gust's front pushes a puff it passes (m/s)
 *   gustStep  seconds a gust's push is sampled at (a front crosses a vent in about a second)
 *   ease      seconds over which a pushed puff hands its push from one node to the next
 *   rise      the rise speed a lean implies is 1 / lean, inside these bounds (m/s)
 */
export const DRIFT = Object.freeze({
    nodes: 6,
    bend: 1.3,
    step: 0.5,
    horizon: 64,
    gust: 14,
    gustStep: 0.1,
    ease: 3,
    rise: Object.freeze([2.5, 16]),
});

const _wind = { angle: 0, speed: 0 };

/** The breeze's velocity at t (m/s, world x and z), without gusts, written to `out`. */
export function windVelocity(t, out = [0, 0]) {
    windAt(t, _wind);
    const heading = WIND_HEADING + _wind.angle;
    out[0] = Math.cos(heading) * _wind.speed;
    out[1] = Math.sin(heading) * _wind.speed;
    return out;
}

/**
 * The CPU twin of tbGustBand: a gust's front strength (0..1) at a ground point, for the gust's
 * phase (0..1 across its crossing; negative: none), the Iris's centre and the wind's heading.
 */
export function gustBand(phase, x, z, cx, cz, dx, dz) {
    if (!(phase >= 0)) return 0;
    const along = (x - cx) * dx + (z - cz) * dz;
    const front = -520 + 1040 * Math.min(1, phase);
    const d = (along - front) / 140;
    const ends = smooth(0, 0.12, phase) * (1 - smooth(0.85, 1, phase));
    return Math.exp(-d * d) * ends;
}

/**
 * The breeze's run back from t: entry i (x, z) is how far the air moved over the last i · step
 * seconds. One table a frame serves every column.
 */
export function windRunTable(t, out = new Float32Array(2 * (Math.round(DRIFT.horizon / DRIFT.step) + 1))) {
    const n = out.length / 2;
    const v = windVelocity(t, [0, 0]);
    let px = v[0];
    let pz = v[1];
    let rx = 0;
    let rz = 0;
    out[0] = 0;
    out[1] = 0;
    for (let i = 1; i < n; i++) {
        windVelocity(t - i * DRIFT.step, v);
        rx += (px + v[0]) * 0.5 * DRIFT.step;
        rz += (pz + v[1]) * 0.5 * DRIFT.step;
        px = v[0];
        pz = v[1];
        out[2 * i] = rx;
        out[2 * i + 1] = rz;
    }
    return out;
}

/** The rise speed (m/s) a body's lean implies (a puff leans by wind / rise per metre). */
export function riseForLean(lean) {
    const [lo, hi] = DRIFT.rise;
    return Math.max(lo, Math.min(hi, 1 / Math.max(lean, 1e-3)));
}

const _gust = [0, 0];

/**
 * Where a column's axis stands at the heights f = k / nodes (k = 1 … nodes), as offsets (metres,
 * world x and z) from its vent at (x, z): each height's puffs have drifted with the breeze's run
 * over their age and with every gust front that crossed the vent since they left it.
 * @param {number} t           the world's time (the clock the wind and the gusts run on)
 * @param {number} height      the column's height (metres)
 * @param {number} rise        how fast its puffs rise (m/s)
 * @param {Float32Array} run   windRunTable(t)
 * @param {number[]} centre    the Iris's centre [x, z] (the gust's frame)
 * @param {Float32Array|number[]} out  2 · nodes values
 */
export function plumeDrift(t, x, z, height, rise, run, centre, out) {
    const { nodes, bend, step } = DRIFT;
    const last = run.length / 2 - 1;
    const T = Math.min(Math.max(height, 0) / Math.max(rise, 1e-3), last * step);
    for (let k = 1; k <= nodes; k++) {
        const age = T * (k / nodes) ** bend;
        const at = Math.min(age / step, last);
        const i = Math.floor(at);
        const f = at - i;
        const j = Math.min(i + 1, last);
        out[2 * (k - 1)] = run[2 * i] + (run[2 * j] - run[2 * i]) * f;
        out[2 * (k - 1) + 1] = run[2 * i + 1] + (run[2 * j + 1] - run[2 * i + 1]) * f;
    }
    // The gusts that crossed the vent within the column's age: each pushes the puffs it found
    // there, and the push stays with them as they climb.
    const t0 = t - T;
    for (let cell = Math.floor(t0 / GUST_CELL) - 1; cell <= Math.floor(t / GUST_CELL); cell++) {
        if (cell < 0) continue;
        const start = cell * GUST_CELL + 5 + GUST_JITTER * hash1(cell, 11);
        if (Math.min(start + GUST_CROSS, t) <= Math.max(start, t0)) continue;
        // Slices fixed to the gust's start, each counted by the share of it inside the column's
        // age, so the push grows (and leaves the top) continuously, never a slice at a time.
        const slices = Math.round(GUST_CROSS / DRIFT.gustStep);
        for (let n = 0; n < slices; n++) {
            const s0 = start + n * DRIFT.gustStep;
            const covered = (Math.min(s0 + DRIFT.gustStep, t) - Math.max(s0, t0)) / DRIFT.gustStep;
            if (covered <= 0) continue;
            const s = s0 + DRIFT.gustStep * 0.5;
            windVelocity(s, _gust);
            const speed = Math.hypot(_gust[0], _gust[1]) || 1;
            const dx = _gust[0] / speed;
            const dz = _gust[1] / speed;
            const push = gustBand((s - start) / GUST_CROSS, x, z, centre[0], centre[1], dx, dz)
                * DRIFT.gust * DRIFT.gustStep * Math.min(covered, 1);
            if (push < 1e-4) continue;
            const since = t - s;
            for (let k = 1; k <= nodes; k++) {
                // The puffs a gust pushed pass a node as they age past it: eased over a few
                // seconds, so the kink climbs smoothly instead of hopping from node to node.
                const held = clamp01((T * (k / nodes) ** bend - since) / DRIFT.ease + 0.5);
                if (held <= 0) continue;
                out[2 * (k - 1)] += dx * push * held;
                out[2 * (k - 1) + 1] += dz * push * held;
            }
        }
    }
    return out;
}

/**
 * A body that does not trail its vent (a heap, a puff, a devil, a spray) leans as one: its axis
 * offset at f = k / nodes is the current lean times its height there, a gust at its foot leaning
 * it harder (the old straight lean, which suits a body that moves as one).
 */
export function rigidDrift(t, x, z, height, lean, centre, gustPhase, out) {
    const v = windVelocity(t, _gust);
    const speed = Math.hypot(v[0], v[1]) || 1;
    const dx = v[0] / speed;
    const dz = v[1] / speed;
    const g = gustBand(gustPhase, x, z, centre[0], centre[1], dx, dz);
    const perMetre = speed * lean * (1 + 2 * g) + 0.22 * g;
    for (let k = 1; k <= DRIFT.nodes; k++) {
        const h = (height * k) / DRIFT.nodes;
        out[2 * (k - 1)] = dx * perMetre * h;
        out[2 * (k - 1) + 1] = dz * perMetre * h;
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
export const IDLE_HEIGHT = 28;

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
    // A chain's burst, one a link (§3.9 gauge 1): held near a second so the count reads.
    preplay: Object.freeze({
        delay: 0, rise: 0.35, hold: 0.85, fall: 0.6, steam: 0, height: 3,
    }),
    // A splash of the idle Chalice's preplay clusters, about a second apart.
    splash: Object.freeze({
        delay: 0, rise: 0.35, hold: 0.15, fall: 0.6, steam: 0, height: 3,
    }),
    // The fall-back lasts as long as rain takes to come down from the crown (about √(2h/g) + ½ s).
    idle: Object.freeze({
        delay: 0, rise: 1.5, hold: 6.5, fall: 3.0, steam: IDLE_STEAM, height: IDLE_HEIGHT,
    }),
    combo: Object.freeze({
        delay: 0, rise: 0.8, hold: 1e6, fall: 1.2, steam: 0, height: 25,
    }),
    // (58 m: from the overlook the whole column and its crown of spray stand in the frame)
    quad: Object.freeze({
        delay: 0.35, rise: 0.8, hold: 2.85, fall: 1.2, steam: 15, height: 46,
    }),
    consort: Object.freeze({
        delay: 0.6, rise: 0.7, hold: 2.4, fall: 1.0, steam: 8, height: 50,
    }),
    sleeper: Object.freeze({
        delay: 0.8, rise: 1.6, hold: 4.0, fall: 2.0, steam: 10, height: 150,
    }),
    // A spouter's pulse (§1.4: 1–2 m spouts); between pulses it burbles about half a metre.
    spouter: Object.freeze({
        delay: 0, rise: 0.25, hold: 0.35, fall: 0.45, steam: 0, height: 2,
    }),
    // A hard drop's fumarole jet (§1.5: 2–8 m by the rows fallen): sharp, held a moment.
    jet: Object.freeze({
        delay: 0, rise: 0.2, hold: 0.55, fall: 0.6, steam: 0, height: 5,
    }),
});

/** A spouter's constant burble between its pulses (metres). */
export const SPOUTER_BURBLE = 0.6;

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

/**
 * What the shaders draw of a column at `age` (§3.6.2): its crown height, held through the
 * fall-back (the water does not shrink back into the vent: the column empties from the base up
 * and rains down from the crown), and `fall`, how far through the fall-back it is (0 while it
 * rises and holds, then 0 < fall < 1; height 0 before the launch and after the fall).
 */
export function columnState(kind, age, peak, out = { height: 0, fall: 0 }) {
    const e = ERUPTIONS[kind] || ERUPTIONS.preplay;
    const a = age - e.delay;
    out.height = 0;
    out.fall = 0;
    if (!(a > 0)) return out;
    if (a < e.rise + e.hold) {
        out.height = columnHeight(kind, age, peak);
        return out;
    }
    const f = (a - e.rise - e.hold) / e.fall;
    if (f >= 1) return out;
    out.height = Number.isFinite(peak) ? peak : e.height;
    out.fall = Math.max(f, 1e-3);
    return out;
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
    // A morning sun low over the left shoulder: warm on the mats and the terraces, the steam's
    // left flanks lit and their right in the sky's blue shade; the colours stay saturated.
    desktop: Object.freeze({ azimuth: Object.freeze([104, 118]), elevation: Object.freeze([20, 25]) }),
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
 * view (the horizon about 12% from the top); upright (aspect < 0.62) it rises to 220 m and
 * narrows to 42° (still 18° down), so the Iris lies below the card, bands and fingers round it.
 */
export const RIG = Object.freeze({
    desktop: Object.freeze({ height: 44, pitch: 15, fov: 46 }),
    // §1.2 proposed 60 m / 30° / 62°, but an upright phone's narrow width then holds only water
    // (the 105 m spring is 2.5 frame-widths across), seen nearly round. From 220 m up, 18° down
    // through a 42° lens the pool is ~0.73 of the width and an ellipse of ~0.56, its near rim and
    // orange band stay on screen under the card, and a sliver of sky stays above.
    portrait: Object.freeze({ height: 220, pitch: 18, fov: 42 }),
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
    // (the desktop camera looks 15° down: the horizon stands 18% from the top, a band of sky the
    // steam columns climb into; the heroes stand below it at the distances they had at 18°)
    wide169: Object.freeze({
        eye: [0.16, 0.44],
        chalice: [0.88, 0.375],
        sleeper: [0.72, 0.21],
        consort: [0.25, 0.29],
        stairNear: [0.99, 0.97],
    }),
    wide219: Object.freeze({
        eye: [0.13, 0.44],
        chalice: [0.80, 0.375],
        sleeper: [0.88, 0.21],
        consort: [0.22, 0.29],
        stairNear: [0.97, 0.97],
    }),
    wide43: Object.freeze({
        // (left of the 16:9 eye: a 4:3 card stands wider on the frame, and the pool must clear it)
        eye: [0.1, 0.47],
        chalice: [0.93, 0.385],
        sleeper: [0.70, 0.21],
        consort: [0.24, 0.295],
        stairNear: [0.99, 0.97],
    }),
    // Upright, nothing on the ground can stand in the top band above the card and still be
    // inside the basin (from 220 m that band is 3 km and more away), so the Chalice stands in the
    // right margin beside the card, its column rising up the margin, the Sleeper far above it in
    // the same margin (on the side it holds on every wide preset, so the blend between them
    // never sweeps it across the card), and the Consort in the left; the eye just under the card.
    portrait: Object.freeze({
        // Low enough that the pool's far rim clears the card's foot (the whole eye reads).
        eye: [0.5, 0.9],
        chalice: [0.885, 0.3],
        sleeper: [0.93, 0.19],
        consort: [0.08, 0.34],
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

/**
 * The Iris pool's radius (metres, about 105 m across), and the Chalice's cone: its lip's height
 * above its foot (the vent's base, ELEVATION.chalice above the apron), its foot's radius (the
 * Stair's head stands 1.6 radii down its line), and the mound's mean radius.
 */
export const IRIS_RADIUS = 52;
export const CHALICE = Object.freeze({ height: 7.5, radius: 7, mound: 44 });

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
        rig, anchors, horizon, mirrored, aspect,
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

// ── Steam: the plumes' plan (§1.4, §3.6.1) ──────────────────────────────────────

/** Steam plume slots the shaders read (the Iris's dome, the Chalice's thread, far columns). */
export const STEAM_SLOTS = 14;
/** Plume kinds (the row's fourth B component). */
export const PLUME_KIND = Object.freeze({ column: 0, dome: 1, thread: 2 });
/** How far a plume leans downwind: metres per metre of height per metre a second of wind. */
export const STEAM_LEAN = 0.08;

/**
 * Where the far steam columns stand on screen (fractions; y below the horizon by a fraction of
 * the frame), each with its height, base radius and density: spread along the far apron so the
 * steam punches up into the sky band at many depths. Mirrored with the layout.
 */
export const FAR_PLUMES = Object.freeze([
    Object.freeze({
        x: 0.3, dy: 0.07, height: 260, radius: 22, density: 0.85,
    }),
    Object.freeze({
        x: 0.7, dy: 0.1, height: 180, radius: 34, density: 0.85,
    }),
    Object.freeze({
        x: 0.08, dy: 0.13, height: 120, radius: 11, density: 0.8,
    }),
    Object.freeze({
        x: 0.8, dy: 0.05, height: 360, radius: 34, density: 0.6,
    }),
    Object.freeze({
        x: 0.56, dy: 0.04, height: 420, radius: 42, density: 0.5,
    }),
    Object.freeze({
        x: 0.42, dy: 0.16, height: 70, radius: 9, density: 0.8,
    }),
    Object.freeze({
        x: 0.95, dy: 0.09, height: 220, radius: 40, density: 0.65,
    }),
    Object.freeze({
        x: 0.2, dy: 0.045, height: 300, radius: 30, density: 0.55,
    }),
    Object.freeze({
        x: 0.63, dy: 0.2, height: 55, radius: 13, density: 0.75,
    }),
    Object.freeze({
        x: 0.36, dy: 0.035, height: 200, radius: 24, density: 0.55,
    }),
    Object.freeze({
        x: 0.88, dy: 0.035, height: 280, radius: 32, density: 0.5,
    }),
    Object.freeze({
        x: 0.14, dy: 0.22, height: 45, radius: 12, density: 0.7,
    }),
]);

/** Far columns a low tier draws as analytic ghosts in the sky instead of sheets (at most). */
export const GHOSTS_MAX = 8;

/** The farthest a column stands from the camera (metres): in front of the rim forest at 3.8 km. */
export const FAR_PLUME_REACH = 3200;

/**
 * The plumes for a world plan: the Iris's dome first, then the Chalice's thread, then as many far
 * columns as the tier keeps (`count` in all), each `{ x, z, base, height, r0, r1, density, kind }`
 * in metres. Three-free and deterministic: the world writes it into the shaders' plume rows.
 */
export function plumePlan(plan, count) {
    const out = [];
    const n = Math.max(0, Math.min(STEAM_SLOTS, Math.round(count)));
    if (n > 0) {
        out.push({
            x: plan.eye[0],
            z: plan.eye[2],
            base: 0,
            height: 72,
            r0: IRIS_RADIUS * 0.95,
            r1: IRIS_RADIUS * 1.5,
            density: 0.55,
            kind: PLUME_KIND.dome,
        });
    }
    if (n > 1) {
        out.push({
            x: plan.chalice[0],
            z: plan.chalice[2],
            base: plan.chalice[1] + CHALICE.height - 1,
            height: 45,
            r0: 2.5,
            r1: 10,
            density: 0.85,
            kind: PLUME_KIND.thread,
        });
    }
    const horizon = plan.horizon ?? 0.12;
    for (let i = 0; out.length < n && i < FAR_PLUMES.length; i++) {
        const f = FAR_PLUMES[i];
        const sx = plan.mirrored ? 1 - f.x : f.x;
        const g = screenToGround(plan.rig, plan.aspect ?? 16 / 9, sx, horizon + f.dy, 0);
        if (!g) continue;
        // Inside the basin, in front of the rim forest (a high upright camera reaches far).
        const far = Math.hypot(g[0], g[2]);
        if (far > FAR_PLUME_REACH) {
            g[0] *= FAR_PLUME_REACH / far;
            g[2] *= FAR_PLUME_REACH / far;
        }
        out.push({
            x: g[0],
            z: g[2],
            base: 0,
            height: f.height,
            r0: f.radius,
            r1: f.radius * 2.6,
            density: f.density,
            kind: PLUME_KIND.column,
        });
    }
    return out;
}

// ── Flora and jewels: placed from screen anchors (§1.2) ─────────────────────────

/**
 * Stands of ghost pines (screen x, depth below the horizon as a fraction of the frame, spread in
 * metres, and a weight for how many of the tier's pines it takes). Mirrored with the layout.
 */
export const PINE_STANDS = Object.freeze([
    Object.freeze({
        x: 0.43, dy: 0.07, spread: 45, weight: 3,
    }),
    Object.freeze({
        x: 0.6, dy: 0.11, spread: 30, weight: 2,
    }),
    Object.freeze({
        x: 0.04, dy: 0.16, spread: 32, weight: 2,
    }),
    Object.freeze({
        x: 0.71, dy: 0.21, spread: 22, weight: 2,
    }),
    Object.freeze({
        x: 0.96, dy: 0.09, spread: 48, weight: 3,
    }),
    Object.freeze({
        x: 0.27, dy: 0.12, spread: 28, weight: 2,
    }),
]);

/** The jewel pools on the far apron: lime acid, champagne (orange rim, fizzing), milky opal. */
export const JEWEL_KIND = Object.freeze({ lime: 0, champagne: 1, opal: 2 });
export const JEWELS = Object.freeze([
    // Beside the card, not behind it, and near enough to read as pools (several pixels tall).
    Object.freeze({
        x: 0.33, dy: 0.15, radius: 15, kind: JEWEL_KIND.lime,
    }),
    Object.freeze({
        x: 0.22, dy: 0.085, radius: 16, kind: JEWEL_KIND.champagne,
    }),
    Object.freeze({
        x: 0.75, dy: 0.1, radius: 15, kind: JEWEL_KIND.opal,
    }),
]);

/** The ghost pines for a plan: `count` trees `{ x, z, height, seed }` spread over the stands. */
export function pinePlan(plan, count) {
    const out = [];
    const n = Math.max(0, Math.round(count));
    const total = PINE_STANDS.reduce((a, s) => a + s.weight, 0);
    const horizon = plan.horizon ?? 0.12;
    const rand = mulberry32(0x9105);
    PINE_STANDS.forEach((stand, i) => {
        const sx = plan.mirrored ? 1 - stand.x : stand.x;
        const g = screenToGround(plan.rig, plan.aspect ?? 16 / 9, sx, horizon + stand.dy, 0);
        const k = i === PINE_STANDS.length - 1 ? n - out.length : Math.round((n * stand.weight) / total);
        for (let j = 0; j < k && out.length < n; j++) {
            const a = rand() * TAU;
            const r = stand.spread * Math.sqrt(rand());
            out.push({
                x: (g ? g[0] : 0) + Math.cos(a) * r,
                z: (g ? g[2] : -2000) + Math.sin(a) * r,
                height: 8 + 16 * rand() ** 1.3,
                seed: 1 + rand() * 97,
            });
        }
    });
    return out;
}

/** The jewel pools for a plan: `{ x, z, radius, kind }` (world metres). */
export function jewelPlan(plan) {
    const horizon = plan.horizon ?? 0.12;
    return JEWELS.map((j) => {
        const sx = plan.mirrored ? 1 - j.x : j.x;
        const g = screenToGround(plan.rig, plan.aspect ?? 16 / 9, sx, horizon + j.dy, 0);
        return {
            x: g ? g[0] : 0, z: g ? g[2] : -2000, radius: j.radius, kind: j.kind,
        };
    });
}

/**
 * The fumaroles (§1.4): small vents across the apron that chuff sharp white puffs on their own
 * hashed clocks (screen x, depth below the horizon), mirrored with the layout.
 */
export const FUMAROLES = Object.freeze([
    // Each stands on open apron where its chuffs read against the ground or the far haze: none
    // under the Iris's dome, none on the Chalice's mound or the Stair.
    Object.freeze({ x: 0.12, dy: 0.06 }),
    Object.freeze({ x: 0.3, dy: 0.085 }),
    Object.freeze({ x: 0.355, dy: 0.15 }),
    Object.freeze({ x: 0.52, dy: 0.05 }),
    Object.freeze({ x: 0.66, dy: 0.1 }),
    Object.freeze({ x: 0.72, dy: 0.165 }),
    Object.freeze({ x: 0.97, dy: 0.14 }),
]);
/** A fumarole's chuff period range (seconds). */
export const FUMAROLE_PERIOD = Object.freeze([6, 15]);
/**
 * A far fumarole's chuffs grow with its distance (scale (d / FUMAROLE_NEAR)^0.8, at most
 * FUMAROLE_SCALE_MAX), so a chuff 300 m off and one 1 km off read at about the same size.
 */
export const FUMAROLE_NEAR = 260;
export const FUMAROLE_SCALE_MAX = 4;

/**
 * The fumaroles for a plan: `{ x, z, period, phase, scale }` (world metres; seconds; the chuff's
 * size for its distance), each period and phase hashed from its index so the schedule is
 * closed-form in time.
 */
export function fumarolePlan(plan) {
    const horizon = plan.horizon ?? 0.12;
    const [lo, hi] = FUMAROLE_PERIOD;
    return FUMAROLES.map((f, i) => {
        const sx = plan.mirrored ? 1 - f.x : f.x;
        const g = screenToGround(plan.rig, plan.aspect ?? 16 / 9, sx, horizon + f.dy, 0);
        const d = g ? Math.hypot(g[0], g[2]) : 2000;
        return {
            x: g ? g[0] : 0,
            z: g ? g[2] : -2000,
            period: lo + (hi - lo) * hash1(i, 53),
            phase: hash1(i, 88),
            scale: Math.min(FUMAROLE_SCALE_MAX, Math.max(1, (d / FUMAROLE_NEAR) ** 0.8)),
        };
    });
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

// ── The vapour: the ray-marched steam volume (thermal-bloom-vapour.js) ─────────

/**
 * Steam bodies the post's march reads each frame, three vec4 rows each:
 *   (x, y, z, height)          the body's foot (y its base height) and how tall it stands
 *   (r0, r1, density, lean)    radius at the foot and at the top (metres), optical density, and
 *                              how far it leans downwind (metres per metre of height at 1 m/s)
 *   (r, g, b, code)            the light it takes from below (linear rgb × strength) and
 *                              code = kind + VAPOUR_CODE.seed × seed (seed a whole number < 64)
 * The world writes them near to far (the march composites front to back) and the count.
 */
export const VAPOUR_SLOTS = 32;
/** Rows a body: (foot, height), (radii, density, billow climb), (underlight, code), then its curved
 * axis as DRIFT.nodes (x, z) offsets, two a row. */
export const VAPOUR_ROWS_PER = 6;
/**
 * plume  a rising column: billows climbing it, fading out over its top third (vents, the
 *        Chalice's thread, the steam phases)
 * dome   the Iris's shell of steam: wide and low, densest in its skin, lit from below turquoise
 *        over the water and apricot over the mats, torn by the gusts
 * puff   a ball of steam swelling as it rises (a lock's boil-over, chuffs, a clear's lift)
 * devil  a spinning column (the T-spin's steam devils)
 * spray  a cloud of falling water drops: white, forward-scattering, the bow in it
 */
/** How fast billows climb a body that names no speed of its own (m/s). */
export const VAPOUR_RISE = 1.7;

export const VAPOUR_KIND = Object.freeze({
    plume: 0, dome: 1, puff: 2, devil: 3, spray: 4,
});
export const VAPOUR_CODE = Object.freeze({ kinds: 8, seed: 8 });

/** A body's code (kind and a whole-number seed < 64), as the shaders unpack it. */
export function vapourCode(kind, seed = 0) {
    const k = Math.max(0, Math.min(VAPOUR_CODE.kinds - 1, Math.round(Number(kind) || 0)));
    const s = Math.max(0, Math.min(63, Math.round(Number(seed) || 0)));
    return k + VAPOUR_CODE.seed * s;
}

/** A body's kind and seed back from its code. */
export function vapourDecode(code) {
    const c = Math.max(0, Math.round(Number(code) || 0));
    return { kind: c % VAPOUR_CODE.seed, seed: Math.floor(c / VAPOUR_CODE.seed) };
}

// ── The bursts: drops thrown up by the events (thermal-bloom-bursts.js) ────────

/** Bursts live at once (two rows each), their kinds, and how a row packs its code. */
export const BURST_SLOTS = 16;
export const BURST_KIND = Object.freeze({ splash: 0, jet: 1, fountain: 2 });
export const BURST_CODE = Object.freeze({ scale: 8, life: 8000 });

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
