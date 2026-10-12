/**
 * Painted Ages — renderer-free constants and maths (three-free, DOM-free).
 *
 * The world: an eye on the overlook ridge of a badland valley, looking north across ranks of
 * striped "dragon spine" ridges to a zigzag flatiron range at three kilometres and snow peaks on
 * the horizon. Metres; x right, y up, z toward the eye (the view looks down −z).
 *
 * This module owns the geometry everything shares (eye, fields, rest rig), the strata column
 * (which mineral bed lies at which geological height), the mineral record of cleared rows, the
 * piece codes the director deals in, and small maths.
 */

// ── Maths ─────────────────────────────────────────────────────────────────────────

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
export const clamp01 = (v) => clamp(v, 0, 1);
export const clampInt = (v, lo, hi) => Math.round(clamp(v, lo, hi));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Fraction of the way to a target after dt at an exponential rate. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

/** Hermite step between two edges (a step at lo when the edges are equal). */
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

// ── The view ──────────────────────────────────────────────────────────────────────

/** The eye stands on the overlook ridge, above the valley floor (y = 0 at the river). */
export const EYE = Object.freeze({ x: 0, y: 172, z: 0 });

/**
 * Rest rig (degrees). Landscape looks a little down across the valley; a wide screen narrows the
 * lens; portrait looks further down so the striped valley fills the strip below the card.
 */
export const RIG = Object.freeze({
    landscape: Object.freeze({ fov: 40, yaw: 0, pitch: -4.5 }),
    wide: Object.freeze({ fov: 34, yaw: 0, pitch: -4.2 }),
    portrait: Object.freeze({ fov: 62, yaw: 4, pitch: -12 }),
    near: 1.5,
    far: 60000,
});

/** The lens for an aspect ratio. */
export function rigFor(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    if (a < 0.75) return RIG.portrait;
    if (a > 2.1) return RIG.wide;
    return RIG.landscape;
}

/**
 * The three baked heightfields, nested (metres). Each is a square grid of `size` posts over
 * [x0, x0 + span] × [z0, z0 + span]; a point is read from the finest field that holds it.
 * `lo`/`hi` bound its heights (the half-float texture stores (h − lo) / (hi − lo)).
 */
export const FIELDS = Object.freeze({
    near: Object.freeze({
        name: 'near', x0: -1100, z0: -2100, span: 2200, size: 1024, lo: -40, hi: 420,
    }),
    mid: Object.freeze({
        name: 'mid', x0: -4200, z0: -6400, span: 8400, size: 1024, lo: -60, hi: 1100,
    }),
    far: Object.freeze({
        name: 'far', x0: -20000, z0: -36000, span: 40000, size: 512, lo: -200, hi: 4200,
    }),
});
export const FIELD_ORDER = Object.freeze(['near', 'mid', 'far']);

/** Width (metres) of the band at a field's edge where it hands over to the next one out. */
export const FIELD_BLEND = Object.freeze({ near: 120, mid: 500, far: 0 });

/** Earth's curvature drops a far point by d² / 2R (with the usual refraction allowance). */
export const EARTH_DROP = 1 / (2 * 6371000 * 1.15);

// ── Strata ────────────────────────────────────────────────────────────────────────

/**
 * Mineral families (sRGB). The colours of Zhangye and Hornocal in raking light: oxblood and
 * vermilion red beds, orange and ochre sandstones, cream gypsum, sage and teal reduced clays,
 * lilac and plum shales. Each bed takes a family's tone with its own small variation.
 */
export const MINERALS = Object.freeze({
    oxblood: '#76221A',
    vermilion: '#AE3D27',
    brick: '#9C5236',
    orange: '#C8733A',
    ochre: '#C99A45',
    gold: '#DDB660',
    cream: '#ECDDBE',
    rose: '#C08277',
    sage: '#8E9E83',
    teal: '#6C8A87',
    slate: '#7E8895',
    lilac: '#8F7E98',
    plum: '#5C4258',
    umber: '#6A4231',
});

/**
 * Packages of beds, bottom to top of a cycle. A package is a family sequence the column repeats
 * with variation, so the land shows the real rhythm of red beds broken by pale and green bands.
 * `hard` (0..1) is how strongly the bed resists rain: hard beds stand out as small ledges.
 */
const PACKAGES = Object.freeze([
    Object.freeze({ beds: ['oxblood', 'vermilion', 'brick', 'vermilion', 'cream'], hard: [0.2, 0.35, 0.3, 0.4, 0.85], weight: 2.2 }),
    Object.freeze({ beds: ['orange', 'ochre', 'gold', 'cream', 'orange'], hard: [0.4, 0.5, 0.6, 0.8, 0.35], weight: 1.6 }),
    Object.freeze({ beds: ['vermilion', 'rose', 'brick', 'umber', 'cream'], hard: [0.3, 0.3, 0.35, 0.25, 0.85], weight: 2 }),
    Object.freeze({ beds: ['sage', 'slate', 'cream', 'sage', 'rose'], hard: [0.25, 0.3, 0.8, 0.2, 0.35], weight: 1.7 }),
    Object.freeze({ beds: ['brick', 'orange', 'umber', 'ochre', 'vermilion'], hard: [0.3, 0.45, 0.25, 0.55, 0.35], weight: 1.6 }),
    Object.freeze({ beds: ['lilac', 'plum', 'rose', 'cream', 'vermilion'], hard: [0.25, 0.2, 0.3, 0.85, 0.35], weight: 1.5 }),
    Object.freeze({ beds: ['oxblood', 'teal', 'gold', 'vermilion', 'slate'], hard: [0.2, 0.3, 0.55, 0.35, 0.4], weight: 1.4 }),
]);
const PACKAGE_WEIGHT = PACKAGES.reduce((sum, p) => sum + p.weight, 0);

/** The strata table: geological heights G_MIN..G_MAX at COLUMN_SIZE texels. */
export const COLUMN = Object.freeze({ gMin: -700, gMax: 1100, size: 8192 });

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

const MINERAL_LINEAR = Object.fromEntries(Object.entries(MINERALS).map(([k, v]) => [k, hexToLinear(v)]));

/**
 * The bed sequence: every bed's base (geological metres), thickness, linear colour and hardness,
 * from the bottom of the column up. Deterministic for a seed. Beds are 1.2–9 m, thin pale
 * marker beds 0.6–1.8 m; colours vary ±8 % in value and slightly in hue within a family.
 */
export function buildBeds(seed = 0x9a1e5) {
    const random = mulberry32(seed);
    const beds = [];
    let g = COLUMN.gMin;
    let pkg = Math.floor(random() * PACKAGES.length);
    while (g < COLUMN.gMax) {
        const p = PACKAGES[pkg];
        for (let i = 0; i < p.beds.length && g < COLUMN.gMax; i++) {
            const family = p.beds[i];
            const pale = family === 'cream';
            const thick = pale ? 0.4 + random() * 0.9 : 0.9 + random() ** 1.5 * 4.2;
            const base = MINERAL_LINEAR[family];
            const value = 0.9 + random() * 0.18;
            const warm = (random() - 0.5) * 0.08;
            beds.push({
                g0: g,
                thickness: thick,
                family,
                color: [
                    clamp01(base[0] * value * (1 + warm)),
                    clamp01(base[1] * value),
                    clamp01(base[2] * value * (1 - warm)),
                ],
                hard: clamp01(p.hard[i] + (random() - 0.5) * 0.15),
            });
            g += thick;
            // A package sometimes repeats a bed pair, as cycles do.
            if (!pale && random() < 0.18 && g < COLUMN.gMax) {
                const again = 0.6 + random() * 1.2;
                beds.push({
                    g0: g, thickness: again, family: p.beds[(i + 1) % p.beds.length], color: MINERAL_LINEAR[p.beds[(i + 1) % p.beds.length]].slice(), hard: p.hard[(i + 1) % p.beds.length],
                });
                g += again;
            }
        }
        // The next package by weight (red and orange beds dominate), never the same twice.
        let pick = random() * PACKAGE_WEIGHT;
        let next = 0;
        while (next < PACKAGES.length - 1 && pick > PACKAGES[next].weight) {
            pick -= PACKAGES[next].weight;
            next++;
        }
        pkg = next === pkg ? (next + 1) % PACKAGES.length : next;
    }
    return beds;
}

/** The bed holding geological height g (binary search), or null outside the column. */
export function bedAt(beds, g) {
    if (!beds.length || g < beds[0].g0) return beds[0] || null;
    let lo = 0;
    let hi = beds.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (beds[mid].g0 <= g) lo = mid;
        else hi = mid - 1;
    }
    return beds[lo];
}

/**
 * The column as RGBA bytes, COLUMN.size texels from gMin to gMax: linear colour in RGB (scaled
 * into sRGB-encoded bytes by the caller if it wants), hardness in A. Thin laminae inside each bed
 * (a few percent of value) give the faces their fine banding.
 */
export function bakeColumn(beds, size = COLUMN.size) {
    const out = new Float32Array(size * 4);
    const random = mulberry32(0x51a7);
    const step = (COLUMN.gMax - COLUMN.gMin) / size;
    for (let i = 0; i < size; i++) {
        const g = COLUMN.gMin + (i + 0.5) * step;
        const bed = bedAt(beds, g);
        const within = (g - bed.g0) / Math.max(0.01, bed.thickness);
        // Laminae: a little darker at the base of a bed, a little paler at its top.
        const lamina = 0.94 + 0.08 * within + (random() - 0.5) * 0.05;
        out[i * 4] = clamp01(bed.color[0] * lamina);
        out[i * 4 + 1] = clamp01(bed.color[1] * lamina);
        out[i * 4 + 2] = clamp01(bed.color[2] * lamina);
        out[i * 4 + 3] = bed.hard;
    }
    return out;
}

/**
 * Geological height of a point: its height, lifted or dropped by the dip of the beds and their
 * folds. Near the eye the beds dip gently north-east and roll over two broad folds, so a band
 * climbs across a hill instead of drawing its contour; under the flatiron range they dip steeply
 * toward the eye, so its gullies cut them into zigzags. The shader evaluates the same formula.
 */
export function strataG(x, y, z) {
    // Steep dip under the flatiron range (z −2600 … −5200), gentle elsewhere.
    const range = smooth(-2100, -2800, z) * (1 - smooth(-5200, -6400, z));
    const gentle = x * 0.085 + z * -0.06;
    const fold = 26 * Math.sin(x * 0.0021 + z * 0.0013) + 14 * Math.sin(x * 0.0057 - z * 0.0031 + 1.7);
    // Under the range the beds rise away from the eye at ~46°, steeper than the faces, so a face
    // shows straight stripes and every gully cuts them into a V.
    const steep = (-z - 2600) * 1.05 + 30 * Math.sin(x * 0.0019);
    return y - lerp(gentle + fold, steep, range);
}

// ── Pieces ────────────────────────────────────────────────────────────────────────

export const PIECE_CODE = Object.freeze({
    I: 0, T: 1, Z: 2, L: 3, S: 4, J: 5, O: 6, GARBAGE: 7,
});
export const PIECE_ORDER = Object.freeze(['I', 'T', 'Z', 'L', 'S', 'J', 'O', 'GARBAGE']);
/** The board's piece colours by code (painted-ages-tetrominos.js carries the same table). */
export const PIECE_COLORS = Object.freeze(['#D8432C', '#0E726F', '#B7AADE', '#81CA8B', '#F0C02D', '#D3739A', '#4C74E9', '#2A2630']);

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

/**
 * A piece's pigment as rock: the hue kept, pulled a quarter of the way toward the nearest
 * mineral and a little dusted, so a cobalt piece lays a slate-blue bed and not a plastic one.
 * Wet rock (wet = 1) shows the pigment itself.
 */
export function mineralise(rgb, rockTone, wet = 0, out = [0, 0, 0], toward = 0.28) {
    const w = clamp01(wet);
    const dull = toward * (1 - w);
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

const CELL_LINEAR = PIECE_COLORS.map((c) => hexToLinear(c));
/** The mineral each piece's pigment settles toward. */
const CELL_ROCK = ['vermilion', 'teal', 'lilac', 'sage', 'ochre', 'rose', 'lilac', 'umber'].map((k) => MINERAL_LINEAR[k]);
const CREAM = MINERAL_LINEAR.cream;

// ── The mineral record ────────────────────────────────────────────────────────────

/** Cleared rows the land remembers (a ring); each is one bed of the record. */
export const RECORD_ROWS = 256;
/** Texels per record row: ten cells, their mean, then metadata. */
export const RECORD_WIDTH = 16;
/** Geological thickness of one record bed (metres). */
export const RECORD_BED = 1.6;

export function recordAddress(head, depth, lamina = 0) {
    const row = (((Math.round(head) - Math.floor(depth)) % RECORD_ROWS) + RECORD_ROWS) % RECORD_ROWS;
    const col = clampInt(lamina, 0, RECORD_WIDTH - 1);
    return {
        row, col, offset: (row * RECORD_WIDTH + col) * 4, u: (col + 0.5) / RECORD_WIDTH, v: (row + 0.5) / RECORD_ROWS,
    };
}

/**
 * The cleared rows as rock: RECORD_WIDTH × RECORD_ROWS RGBA8, linear bytes. Columns 0–9 hold a
 * row's cells (mineralised piece pigments), 10 their mean, 11 the pigments themselves (for wet
 * rock and the glow of a fresh bed), 12 metadata (thickness, tuff, written). A bounded journal
 * lets a capture seek backward; past the ring the checkpoint is deep time.
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
        this._raw = [0, 0, 0];
        this.prefill();
    }

    writeColor(row, col, rgb, alpha = 255) {
        const offset = (row * RECORD_WIDTH + col) * 4;
        for (let c = 0; c < 3; c++) this.data[offset + c] = Math.round(clamp01(rgb[c]) * 255);
        this.data[offset + 3] = alpha;
    }

    /** An empty record: every row unwritten (alpha 0 = the land's own beds show). */
    prefill() {
        this.data.fill(0);
        this.head = RECORD_ROWS - 1;
        this.total = 0;
        this.baseline.set(this.data);
        this.baselineHead = this.head;
        this.baselineTotal = 0;
        this.journal.length = 0;
        this.version++;
    }

    /**
     * Lay one cleared row down as the newest bed. `codes` are ten piece codes (null = a synthetic
     * row in the land's own colours); `tuff` lays a pale ash bed (level-ups, game over).
     */
    deposit(codes, {
        time = 0, thickness = 1, tuff = false, log = true,
    } = {}) {
        this.head = (this.head + 1) % RECORD_ROWS;
        this.total++;
        this._mean.fill(0);
        const synthetic = !codes || codes.length < 10;
        for (let c = 0; c < 10; c++) {
            const code = synthetic ? (this.total * 3 + c) % 7 : clampInt(codes[c], 0, 7);
            let rgb = mineralise(CELL_LINEAR[code], CELL_ROCK[code], 0, this._rgb, 0.46);
            let raw = CELL_LINEAR[code];
            if (tuff) {
                rgb = CREAM;
                raw = CREAM;
            }
            this.writeColor(this.head, c, rgb);
            for (let k = 0; k < 3; k++) this._mean[k] += rgb[k] * 0.1;
            if (c === 0) for (let k = 0; k < 3; k++) this._raw[k] = 0;
            for (let k = 0; k < 3; k++) this._raw[k] += raw[k] * 0.1;
        }
        this.writeColor(this.head, 10, this._mean);
        this.writeColor(this.head, 11, this._raw);
        this.writeColor(this.head, 12, [clamp01(thickness / 4), tuff ? 1 : 0, 1]);
        if (log) {
            this.journal.push({
                time,
                thickness,
                tuff,
                codes: synthetic ? null : Array.from(codes).slice(0, 10),
                bytes: this.data.slice(this.head * RECORD_WIDTH * 4, (this.head + 1) * RECORD_WIDTH * 4),
            });
            // Keep one complete visible ring; an older committed prefix is checkpointed.
            if (this.journal.length > RECORD_ROWS) {
                const oldest = this.journal.shift();
                this.baselineHead = (this.baselineHead + 1) % RECORD_ROWS;
                this.baselineTotal++;
                this.baseline.set(oldest.bytes, this.baselineHead * RECORD_WIDTH * 4);
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

    /** A row's texel (depth 0 = the newest bed) as linear RGB in 0..1. */
    read(depth = 0, column = 10, out = [0, 0, 0]) {
        const { offset } = recordAddress(this.head, depth, column);
        for (let c = 0; c < 3; c++) out[c] = this.data[offset + c] / 255;
        return out;
    }

    /** True when the row `depth` beds down has been written. */
    written(depth = 0) {
        const { offset } = recordAddress(this.head, depth, 12);
        return this.data[offset + 3] > 0;
    }
}

// ── Timings (seconds) ─────────────────────────────────────────────────────────────

export const TIMING = Object.freeze({
    /** One hour of light per this many seconds of theme clock (the wheel's clock term). */
    hour: 100,
    /** Share of an hour step the light rests on the hour's own palette, at each end. */
    hourRest: 0.15,
    /** A level-up's turn of the wheel eases over this long. */
    levelTurn: 5,
    /** A cleared row settles into the record over this long (the record beds step down). */
    settle: 0.9,
    rowStagger: 0.14,
    /** A lock's pigment ribbon runs along its bed for this long. */
    ribbon: 3.2,
    /** A clear's band of light climbs the strata for this long. */
    clearWave: 3.6,
    /** Four lines: the flood reaches the near valley after this long and drains over the next. */
    floodTravel: 3.2,
    floodDrain: 14,
    /** Wet rock dries (sunlit / shadowed time constants). */
    dry: 38,
    /** A chain's shower moves in over this long per step; the rainbow after it lives this long. */
    showerStep: 0.8,
    bowLife: 18,
    tspinLife: 9,
    perfectHold: 10,
    perfectFade: 6,
    /** Game over: the light falls to dusk over this long, and returns over this long. */
    dusk: 6,
    dawn: 4,
    /** Without play the land dries and the chain is forgotten after this long. */
    idle: 90,
    /** Modes without level events advance the hour after this many deposited lines. */
    formationLines: 15,
});
