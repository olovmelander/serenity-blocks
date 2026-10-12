/**
 * Rainbark core: three-free constants and maths shared by the world, the director, the
 * playground effect and the unit tests. Nothing here touches the DOM, the bus or a renderer.
 */

/** Piece shape → integer bark code (the girdle and shadow-well encoding). 7 = old husk / unknown. */
export const PIECE_CODE = Object.freeze({
    I: 0, T: 1, Z: 2, L: 3, S: 4, J: 5, O: 6, GARBAGE: 7,
});

/** Bark age of each piece code (0 fresh First Skin … 1 old husk): the ramp stop it wears. */
export const PIECE_AGE = Object.freeze([0.0, 0.12, 0.26, 0.38, 0.52, 0.66, 0.79, 0.95]);

/** The bark age ramp, age → sRGB hex. Lightness is deliberately non-monotonic. */
export const RAMP_STOPS = Object.freeze([
    [0.0, '#C2F23D'], // First Skin (I)
    [0.12, '#2BCB72'], // Young Emerald (T)
    [0.26, '#1A93AC'], // Glaucous Teal (Z)
    [0.38, '#2F4CC0'], // Cobalt Bark (L)
    [0.52, '#B98AF2'], // Bloom Violet (S)
    [0.66, '#D23468'], // Ruby Bark (J)
    [0.79, '#F07A2A'], // Ember Bark (O)
    [0.91, '#5E2430'], // Husk Maroon
    [0.98, '#3E2A26'], // Old Husk
    [1.0, '#3E2A26'],
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

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

/** Ken Perlin's smootherstep on 0..1 (the Climb's ease). */
export function smoother(t) {
    const x = clamp01(t);
    return x * x * x * (x * (x * 6 - 15) + 10);
}

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

const RAMP_LINEAR = RAMP_STOPS.map(([age, hex]) => [age, hexToLinear(hex)]);

/** The bark at an age (0..1, clamped), interpolated in linear light between the ramp stops. */
export function rampAt(age, out = [0, 0, 0]) {
    const a = clamp01(Number.isFinite(age) ? age : 1);
    let i = 0;
    while (i < RAMP_LINEAR.length - 2 && a > RAMP_LINEAR[i + 1][0]) i += 1;
    const [a0, c0] = RAMP_LINEAR[i];
    const [a1, c1] = RAMP_LINEAR[i + 1];
    const k = a1 > a0 ? clamp01((a - a0) / (a1 - a0)) : 0;
    for (let c = 0; c < 3; c++) out[c] = c0[c] + (c1[c] - c0[c]) * k;
    return out;
}

// ── The grove and the Climb ─────────────────────────────────────────────────────

/** Metres the walkway rises a level, the lowest storey, and the levels before it wraps. */
export const STOREY = 12;
export const CLIMB_BASE = 20;
export const CLIMB_LEVELS = 12;
/** The canopy plane (yC, metres): the gobo and the lace hang here. */
export const CANOPY_Y = 172;
/** The tide's period (seconds): low at t = 0, high at half of it. */
export const TIDE_PERIOD = 150;
/** The sun's azimuth, degrees to the right of the view axis (it drifts ±SUN_DRIFT over the tide). */
export const SUN_AZIMUTH = 70;
export const SUN_DRIFT = 3;

/** The Climb's place for a level: c = (level − 1) mod 12, so level 13 is the lowest storey again. */
export function levelCycle(level) {
    const n = Math.max(1, Math.round(Number.isFinite(Number(level)) ? Number(level) : 1));
    return (n - 1) % CLIMB_LEVELS;
}

/** The walkway's height (metres above the floor) on a level: 20 m on L1 … 152 m on L12. */
export function climbHeight(level) {
    return CLIMB_BASE + STOREY * levelCycle(level);
}

/** The palette rows each zone sets (in this order in the palette table). */
export const ZONE_COLOR_KEYS = Object.freeze([
    'hazeShade', 'hazeSun', 'sky', 'zenith', 'mistTop', 'underglow', 'fleck', 'crown', 'gradeShadow', 'gradeLight',
]);

/**
 * The five zones of the Climb. Each sets the haze, the light and the grade; `cycles` are the
 * values of c (level − 1 mod 12) that stand in it. Air: σA (per metre at the tide top) falling
 * off with the scale height Hs above it, σM inside the mist.
 */
export const ZONES = Object.freeze([
    Object.freeze({
        name: 'Buttress Deep',
        cycles: Object.freeze([0, 1]),
        tideTop: 10,
        tideAmp: 8,
        sunElevation: 50,
        fleck: 0.06,
        sat: 0.85,
        exposure: 1.15,
        sigmaA: 0.016,
        scaleHeight: 30,
        sigmaM: 0.06,
        colors: Object.freeze({
            hazeShade: '#4F5F9A',
            hazeSun: '#B9C6E4',
            sky: '#9DB4D8',
            zenith: '#9DB4D8',
            mistTop: '#D5DCEB',
            underglow: '#AFC0E2',
            fleck: '#FFE9B8',
            crown: '#1B3326',
            gradeShadow: '#18213D',
            gradeLight: '#E6EDF8',
        }),
    }),
    Object.freeze({
        name: 'Bole',
        cycles: Object.freeze([2, 3, 4]),
        tideTop: 38,
        tideAmp: 8,
        sunElevation: 55,
        fleck: 0.18,
        sat: 1.0,
        exposure: 1.0,
        sigmaA: 0.0102,
        scaleHeight: 40,
        sigmaM: 0.05,
        colors: Object.freeze({
            hazeShade: '#8FA6D8',
            hazeSun: '#F6EBCB',
            sky: '#CFE6F6',
            zenith: '#CFE6F6',
            mistTop: '#F6EBCB',
            underglow: '#F2DDB0',
            fleck: '#FFE3A0',
            crown: '#23452F',
            gradeShadow: '#1E2A44',
            gradeLight: '#FFF2D8',
        }),
    }),
    Object.freeze({
        name: 'Fog Line',
        cycles: Object.freeze([5, 6, 7]),
        tideTop: 100,
        tideAmp: 4,
        sunElevation: 58,
        fleck: 0.10,
        sat: 0.78,
        exposure: 0.92,
        sigmaA: 0.012,
        scaleHeight: 40,
        sigmaM: 0.05,
        colors: Object.freeze({
            hazeShade: '#C9D2E2',
            hazeSun: '#F4F1EA',
            sky: '#EEF2F6',
            zenith: '#EEF2F6',
            mistTop: '#F7F7F3',
            underglow: '#E9E6DE',
            fleck: '#FFF4DC',
            crown: '#3A5446',
            gradeShadow: '#4E5873',
            gradeLight: '#FBFAF6',
        }),
    }),
    Object.freeze({
        name: 'Limb Storey',
        cycles: Object.freeze([8, 9, 10]),
        tideTop: 104,
        tideAmp: 8,
        sunElevation: 61,
        fleck: 0.30,
        sat: 1.08,
        exposure: 0.98,
        sigmaA: 0.0075,
        scaleHeight: 45,
        sigmaM: 0.045,
        colors: Object.freeze({
            hazeShade: '#A6BEE4',
            hazeSun: '#FFF0D2',
            sky: '#D6ECFA',
            zenith: '#D6ECFA',
            mistTop: '#FFF6E2',
            underglow: '#F5E2BE',
            fleck: '#FFE6A6',
            crown: '#2C5A3A',
            gradeShadow: '#22314E',
            gradeLight: '#FFF4DE',
        }),
    }),
    Object.freeze({
        name: 'Crown Light',
        cycles: Object.freeze([11]),
        tideTop: 108,
        tideAmp: 8,
        sunElevation: 64,
        fleck: 0.42,
        sat: 1.0,
        exposure: 0.95,
        sigmaA: 0.006,
        scaleHeight: 50,
        sigmaM: 0.04,
        colors: Object.freeze({
            hazeShade: '#9CC4EA',
            hazeSun: '#FDF5E4',
            sky: '#8FC3EE',
            zenith: '#4F93D6',
            mistTop: '#FFFDF6',
            underglow: '#F0E7D2',
            fleck: '#FFF0C4',
            crown: '#2F6A3E',
            gradeShadow: '#28406A',
            gradeLight: '#FFF8EA',
        }),
    }),
]);

/**
 * The Mistfall look (game over, at rest): laid over the zone, never a zone of its own. It has
 * no flecks, so its fleck colour is never seen.
 */
export const MISTFALL = Object.freeze({
    name: 'Mistfall',
    /** The mist rises this far above the camera. */
    tideLift: 15,
    fleck: 0,
    sat: 0.6,
    exposure: 0.95,
    colors: Object.freeze({
        hazeShade: '#A9B2C6',
        hazeSun: '#E6E9EE',
        sky: '#E3E8EF',
        zenith: '#E3E8EF',
        mistTop: '#EEF0F3',
        underglow: '#DADDE3',
        fleck: '#E6E9EE',
        crown: '#3C4A44',
        gradeShadow: '#3C4560',
        gradeLight: '#F2F3F6',
    }),
});

/** The zone a level stands in (an index into ZONES). */
export function zoneIndex(level) {
    const c = levelCycle(level);
    for (let i = 0; i < ZONES.length; i++) if (ZONES[i].cycles.includes(c)) return i;
    return ZONES.length - 1;
}

/** The mist floor's top (metres) at time t in a zone: low at t = 0, high at TIDE_PERIOD / 2. */
export function tideAt(t, zone = ZONES[1]) {
    const time = Number.isFinite(t) ? t : 0;
    return zone.tideTop + zone.tideAmp * -Math.cos((TAU * time) / TIDE_PERIOD);
}

/**
 * The unit vector toward the sun for an elevation and an azimuth (degrees; azimuth to the right
 * of the view axis −z). The Bole sun (55°, 70°) is (0.539, 0.819, −0.196).
 */
export function sunDirection(elevation, azimuth = SUN_AZIMUTH, out = [0, 0, 0]) {
    const el = elevation * DEG;
    const az = azimuth * DEG;
    out[0] = Math.cos(el) * Math.sin(az);
    out[1] = Math.sin(el);
    out[2] = -Math.cos(el) * Math.cos(az);
    return out;
}

// ── The shared tables ───────────────────────────────────────────────────────────

/**
 * Rows of the palette table (one vec4 uniform array): the zone colours (linear rgb, 1), the four
 * group mean bark colours, then the eight piece-age rows (linear rgb of the bark at that age,
 * the age) in PIECE_CODE order.
 */
export const PALETTE_ROWS = Object.freeze({
    ...Object.fromEntries(ZONE_COLOR_KEYS.map((key, i) => [key, i])),
    groupMean: ZONE_COLOR_KEYS.length,
    pieceAge: ZONE_COLOR_KEYS.length + 4,
    used: ZONE_COLOR_KEYS.length + 4 + PIECE_AGE.length,
    total: 24,
});

/** Slots per block of the event table, and rows per slot. */
export const EVENT_SLOTS = Object.freeze({
    peels: 16, girdles: 12, helices: 6, knocks: 4, gaps: 7, moult: 1,
});
export const EVENT_ROWS_PER = Object.freeze({
    peels: 3, girdles: 3, helices: 2, knocks: 1, gaps: 1, moult: 1,
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
    rows.total = 112;
    return Object.freeze(rows);
})();
