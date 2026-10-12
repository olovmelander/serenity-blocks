/** Painted Ages: renderer-free mineral record, colour maths and event timings. */
export const PIECE_CODE = Object.freeze({
    I: 0, T: 1, Z: 2, L: 3, S: 4, J: 5, O: 6, GARBAGE: 7,
});
export const PIECE_ORDER = Object.freeze(['I', 'T', 'Z', 'L', 'S', 'J', 'O', 'GARBAGE']);
export const PIECE_COLORS = Object.freeze(['#D8432C', '#0E726F', '#B7AADE', '#81CA8B', '#F0C02D', '#D3739A', '#4C74E9', '#2A2630']);
export const PALETTE = Object.freeze({
    vermilion: '#C8432B',
    apricot: '#E6915A',
    gold: '#EDBE5C',
    cream: '#F2E2C2',
    sage: '#7DAA93',
    rose: '#DD8E98',
    lavender: '#9686B8',
    plum: '#3A2C4E',
    cobalt: '#2B56B9',
    horizon: '#D5E8EC',
    sulfur: '#E8D23A',
    moss: '#4E9A3C',
    obsidian: '#1D1A23',
});
export const FORMATIONS = Object.freeze([
    { name: 'Danxia red beds', cast: '#C78B70', colors: ['#C8432B', '#E6915A', '#EDBE5C', '#F2E2C2', '#7DAA93', '#DD8E98', '#9686B8'] },
    { name: 'Rhyolite pastels', cast: '#CBB4AC', colors: ['#E1B8AD', '#DFCCAB', '#B694A9', '#C9B765', '#9EABA2', '#EEE0C5', '#AD8B94'] },
    { name: 'Yacoraite limestones', cast: '#CBB691', colors: ['#BE985F', '#8F536E', '#72866C', '#EEE0BD', '#B97165', '#D2A268', '#9D898E'] },
    { name: 'Bentonite hills', cast: '#B8ACC2', colors: ['#9D8AB4', '#8DA4B5', '#E2D7C5', '#C5ABA8', '#887A98', '#D6C6AF', '#AEB8B0'] },
    { name: 'Copper series', cast: '#96ADA0', colors: ['#579E9D', '#789477', '#B5674A', '#E1D0AB', '#739AAD', '#CAB67D', '#B18586'] },
    { name: 'Gypsum whites', cast: '#DDD0C0', colors: ['#E5DDCD', '#D3A9AA', '#D3B875', '#EFE4CC', '#ACB6AE', '#C7BED5', '#E2C29E'] },
].map((f) => Object.freeze({ ...f, colors: Object.freeze(f.colors), tiltStep: 6 })));
export const ZONES = Object.freeze([
    { id: 'CF', distance: 10000 }, { id: 'R5', distance: 6000 }, { id: 'R4', distance: 4000 },
    { id: 'R3', distance: 2500 }, { id: 'R2', distance: 1500 }, { id: 'R1', distance: 800 }, { id: 'R0', distance: 350 },
]);
export const TIMING = Object.freeze({
    run: 1.1,
    reducedRun: 0.6,
    fanWeather: 12,
    fanBury: 0.6,
    rowStagger: 0.15,
    slurry: 0.45,
    nearStep: 0.6,
    farStep: 0.3,
    wetBed: 2,
    floodDelay: 0.15,
    floodTravel: 3,
    floodDrain: 10,
    weatherStep: 0.5,
    wetSweep: 0.4,
    retreat: 1.2,
    bowRise: 2.5,
    bowLife: 18,
    drySun: 35,
    dryShadow: 70,
    foldRise: 1.2,
    foldRelease: 8,
    hoodooRise: 1.4,
    hoodooLife: 25,
    perfectHold: 10,
    perfectFade: 6,
    tilt: 2.5,
    sunset: 6,
    morning: 4,
    idleDry: 90,
    formationLines: 15,
    dustRate: 1,
});
export const EVENT_ROWS = Object.freeze({
    formations: 0, fans: 12, runs: 36, beds: 48, flood: 56, hoodoos: 60, weather: 66, total: 68,
});
export const RECORD_WIDTH = 16;
export const RECORD_ROWS = 512;
export const BED_HEIGHT = 4;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
export const clampInt = (v, lo, hi) => Math.round(clamp(v, lo, hi));
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

/** Linear colour; wet rock recovers the exact cell pigment before the lighting darkens it. */
export function mineralise(rgb, rockTone, wet = 0, out = [0, 0, 0]) {
    const w = clamp01(wet);
    const dull = 0.28 * (1 - w);
    const r = lerp(rgb[0], rockTone[0], dull);
    const g = lerp(rgb[1], rockTone[1], dull);
    const b = lerp(rgb[2], rockTone[2], dull);
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const sat = lerp(0.85, 1, w);
    out[0] = lerp(luma, r, sat);
    out[1] = lerp(luma, g, sat);
    out[2] = lerp(luma, b, sat);
    return out;
}

/** Long Morning, source behind the viewer's left shoulder. Angles are in degrees. */
export function sunAt(time, azimuth = 115, reduced = false, out = {}) {
    const t = Number.isFinite(time) ? time : 0;
    out.elevation = 17 + 5 * Math.sin((TAU * t) / 420);
    out.azimuth = azimuth + 6 * Math.sin((TAU * t) / 150) * (reduced ? 0.5 : 1);
    const e = out.elevation * DEG;
    const a = out.azimuth * DEG;
    out.x = -Math.sin(a) * Math.cos(e);
    out.y = Math.sin(e);
    out.z = -Math.cos(a) * Math.cos(e);
    return out;
}

export function recordAddress(head, depth, lamina = 0) {
    const row = (((Math.round(head) - Math.floor(depth)) % RECORD_ROWS) + RECORD_ROWS) % RECORD_ROWS;
    const col = clampInt(lamina, 0, RECORD_WIDTH - 1);
    return {
        row, col, offset: (row * RECORD_WIDTH + col) * 4, u: (col + 0.5) / RECORD_WIDTH, v: (row + 0.5) / RECORD_ROWS,
    };
}

const CELL_LINEAR = PIECE_COLORS.map((c) => hexToLinear(c));
const CREAM = hexToLinear(PALETTE.cream);
const FORMATION_LINEAR = FORMATIONS.map((f) => ({ cast: hexToLinear(f.cast), colors: f.colors.map((c) => hexToLinear(c)) }));

/**
 * 16 × 512 RGBA8, linear bytes (not sRGB). Row 0 is the texture's v=0 edge.
 * Columns 0–9 pigments, 10 mean, 11 parting, 12 metadata, 13 mineral cast.
 * A bounded journal permits backward capture seeks; after wrap the checkpoint is deep time.
 */
export class StrataRecord {
    constructor(seed = 0x5ed1) {
        this.seed = seed;
        this.data = new Uint8Array(RECORD_WIDTH * RECORD_ROWS * 4);
        this.baseline = new Uint8Array(this.data.length);
        this.journal = [];
        this.head = RECORD_ROWS - 1;
        this.total = 0;
        this.baselineHead = RECORD_ROWS - 1;
        this.baselineTotal = 0;
        this.version = 0;
        this._rgb = [0, 0, 0];
        this._mean = [0, 0, 0];
        this.prefill();
    }

    writeColor(row, col, rgb) {
        const offset = (row * RECORD_WIDTH + col) * 4;
        for (let c = 0; c < 3; c++) this.data[offset + c] = Math.round(clamp01(rgb[c]) * 255);
        this.data[offset + 3] = 255;
    }

    prefill() {
        const random = mulberry32(this.seed);
        for (let row = 0; row < RECORD_ROWS; row++) {
            const f = Math.floor((RECORD_ROWS - row - 1) / 85) % FORMATIONS.length;
            const palette = FORMATION_LINEAR[f];
            const tone = palette.colors[Math.floor(random() * palette.colors.length)];
            this._mean.fill(0);
            for (let c = 0; c < 10; c++) {
                const grain = 0.89 + random() * 0.19;
                for (let k = 0; k < 3; k++) {
                    this._rgb[k] = tone[k] * grain;
                    this._mean[k] += this._rgb[k] * 0.1;
                }
                this.writeColor(row, c, this._rgb);
            }
            this.writeColor(row, 10, this._mean);
            this.writeColor(row, 11, CREAM);
            this.writeColor(row, 12, [0.25 + random() * 0.5, f / 5, 0.8]);
            this.writeColor(row, 13, palette.cast);
        }
        this.head = RECORD_ROWS - 1;
        this.total = 0;
        this.baseline.set(this.data);
        this.baselineHead = this.head;
        this.baselineTotal = 0;
        this.journal.length = 0;
        this.version++;
    }

    deposit(codes, {
        time = 0, formation = Math.floor(this.total / 15) % 6, thickness = 1, log = true,
    } = {}) {
        const f = clampInt(formation, 0, 5);
        const palette = FORMATION_LINEAR[f];
        this.head = (this.head + 1) % RECORD_ROWS;
        this.total++;
        this._mean.fill(0);
        const synthetic = !codes || codes.length < 10;
        for (let c = 0; c < 10; c++) {
            const rgb = synthetic ? palette.colors[(this.total + c) % palette.colors.length]
                : CELL_LINEAR[clampInt(codes[c], 0, 7)];
            this.writeColor(this.head, c, rgb);
            for (let k = 0; k < 3; k++) this._mean[k] += rgb[k] * 0.1;
        }
        this.writeColor(this.head, 10, this._mean);
        this.writeColor(this.head, 11, CREAM);
        this.writeColor(this.head, 12, [clamp01(thickness / 4), f / 5, 1]);
        this.writeColor(this.head, 13, palette.cast);
        if (log) {
            // Retain one complete visible ring; an older committed prefix is checkpointed.
            this.journal.push({
                time,
                formation: f,
                thickness,
                codes: synthetic ? null : Array.from(codes).slice(0, 10),
                bytes: this.data.slice(this.head * 64, (this.head + 1) * 64),
            });
            if (this.journal.length > RECORD_ROWS) {
                const oldest = this.journal.shift();
                this.baselineHead = (this.baselineHead + 1) % RECORD_ROWS;
                this.baselineTotal++;
                this.baseline.set(oldest.bytes, this.baselineHead * 64);
            }
        }
        this.version++;
        return this.head;
    }

    seek(time) {
        const log = this.journal.slice();
        this.data.set(this.baseline);
        this.head = this.baselineHead;
        this.total = this.baselineTotal;
        for (const event of log) if (event.time <= time) this.deposit(event.codes, { ...event, log: false });
        this.version++;
        return this;
    }

    read(depth = 0, column = 10, out = [0, 0, 0]) {
        const { offset } = recordAddress(this.head, depth, column);
        for (let c = 0; c < 3; c++) out[c] = this.data[offset + c] / 255;
        return out;
    }
}
