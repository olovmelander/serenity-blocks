/**
 * Rainbark core: three-free constants and maths shared by the world, the director, the
 * playground effect and the unit tests. Nothing here touches the DOM, the bus or a renderer.
 */

/** Piece shape → integer bark code (the girdle and shadow-well encoding). 7 = old husk / unknown. */
export const PIECE_CODE = Object.freeze({ I: 0, T: 1, Z: 2, L: 3, S: 4, J: 5, O: 6, GARBAGE: 7 });

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
