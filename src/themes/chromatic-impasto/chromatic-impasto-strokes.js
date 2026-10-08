/**
 * Chromatic Impasto — strokes and their geometry (CPU only, three-free).
 *
 * A STROKE is a path with a width, a load of paint and a time to be drawn in. The painter
 * (chromatic-impasto-painter.js) asks, every frame and for each stroke under way, for the piece of
 * ribbon between where its brush was and where it is now, and the GPU composites that piece into
 * the paint. The pieces partition the ribbon exactly (they share their cut edges, and a cut inside
 * a segment lies on the segment's own straight sides), so each texel of a stroke is composited
 * once whatever the frame rate.
 */

import {
    KIND, RELIEF, clamp, clamp01,
} from './chromatic-impasto-core.js';

/** Floats per vertex: position(3) uv(4) colA+seed(4) colB+mix(4) par(4) par2(4). */
export const VERTEX_STRIDE = 23;
export const QUAD_FLOATS = VERTEX_STRIDE * 4;

const EASE = {
    linear: (x) => x,
    out: (x) => 1 - (1 - x) ** 2.4,
    inout: (x) => x * x * (3 - 2 * x),
    in: (x) => x * x,
};

/** A fixed-capacity run of quads. `onFull(batch)` must draw it; the batch then starts over. */
export class StrokeBatch {
    constructor(maxQuads = 2048, onFull = null) {
        this.maxQuads = maxQuads;
        this.data = new Float32Array(maxQuads * QUAD_FLOATS);
        this.quads = 0;
        this.onFull = onFull;
        /** Quads emitted over the batch's life (diagnostics, tests). */
        this.total = 0;
    }

    reset() {
        this.quads = 0;
    }

    /** The float offset of a new quad. */
    alloc() {
        if (this.quads >= this.maxQuads) {
            this.onFull?.(this);
            this.quads = 0;
        }
        const offset = this.quads * QUAD_FLOATS;
        this.quads += 1;
        this.total += 1;
        return offset;
    }
}

let strokeIds = 1;

/** Resample a polyline (xy pairs) at a uniform arc step. Returns a Float32Array of xy pairs. */
export function resamplePath(points, step) {
    const n = Math.floor(points.length / 2);
    if (n < 2) return new Float32Array(points);
    let total = 0;
    for (let i = 1; i < n; i++) {
        total += Math.hypot(points[i * 2] - points[i * 2 - 2], points[i * 2 + 1] - points[i * 2 - 1]);
    }
    const count = Math.max(2, Math.min(400, Math.ceil(total / Math.max(1e-4, step)) + 1));
    const out = new Float32Array(count * 2);
    const ds = total / (count - 1);
    let seg = 1;
    let walked = 0;
    let segLen = Math.hypot(points[2] - points[0], points[3] - points[1]);
    out[0] = points[0];
    out[1] = points[1];
    for (let k = 1; k < count; k++) {
        const target = Math.min(total, k * ds);
        while (seg < n - 1 && walked + segLen < target) {
            walked += segLen;
            seg += 1;
            segLen = Math.hypot(points[seg * 2] - points[seg * 2 - 2], points[seg * 2 + 1] - points[seg * 2 - 1]);
        }
        const f = segLen > 1e-9 ? clamp01((target - walked) / segLen) : 0;
        out[k * 2] = points[seg * 2 - 2] + (points[seg * 2] - points[seg * 2 - 2]) * f;
        out[k * 2 + 1] = points[seg * 2 - 1] + (points[seg * 2 + 1] - points[seg * 2 - 1]) * f;
    }
    return out;
}

/**
 * A ribbon stroke.
 *
 * @param {object} spec
 * @param {ArrayLike<number>} spec.points   the path, xy pairs in canvas units
 * @param {number} spec.width               half-width at the start (canvas units)
 * @param {number} [spec.widthEnd]          half-width at the end (default: the same)
 * @param {number} spec.t0                  when the brush touches down (world seconds)
 * @param {number} [spec.dur=0.4]           seconds the stroke takes
 * @param {string} [spec.ease='out']
 * @param {number} [spec.kind=KIND.BRUSH]
 * @param {number[]} spec.colorA            the paint (scene-linear rgb)
 * @param {number[]} [spec.colorB]          a second colour carried on some bristles
 * @param {number} [spec.mixB=0]            fraction of bristles that carry colorB
 * @param {number} [spec.load=1]            how much paint is on the brush
 * @param {number} [spec.dry=0.5]           how far it runs dry by the end (0 = never)
 * @param {number} [spec.bristle=1]         1 = hog bristle tracks, 0 = a knife's flat face
 * @param {number} [spec.height=1]          relief scale
 * @param {number} [spec.special=0]         > 0 gold leaf, < 0 fluorescent
 * @param {number} [spec.keep]              how much of the relief beneath survives
 * @param {number} [spec.seed]
 */
export function createStroke(spec) {
    const width = Math.max(1e-4, spec.width);
    const widthEnd = Math.max(1e-4, spec.widthEnd ?? width);
    const step = clamp(Math.min(width, widthEnd) * 0.5, 0.006, 0.03);
    const pts = resamplePath(spec.points, step);
    const n = pts.length / 2;
    const len = new Float32Array(n);
    for (let i = 1; i < n; i++) {
        len[i] = len[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    }
    const total = len[n - 1];
    // The two sides of the ribbon at every node (xy pairs), and the half-width there.
    const left = new Float32Array(n * 2);
    const right = new Float32Array(n * 2);
    const half = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1);
        const b = Math.min(n - 1, i + 1);
        let tx = pts[b * 2] - pts[a * 2];
        let ty = pts[b * 2 + 1] - pts[a * 2 + 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const w = width + (widthEnd - width) * (total > 0 ? len[i] / total : 0);
        half[i] = w;
        left[i * 2] = pts[i * 2] - ty * w;
        left[i * 2 + 1] = pts[i * 2 + 1] + tx * w;
        right[i * 2] = pts[i * 2] + ty * w;
        right[i * 2 + 1] = pts[i * 2 + 1] - tx * w;
    }
    const colorA = spec.colorA || [0.5, 0.5, 0.5];
    const colorB = spec.colorB || colorA;
    return {
        id: strokeIds++,
        kind: spec.kind ?? KIND.BRUSH,
        t0: spec.t0 ?? 0,
        dur: Math.max(0, spec.dur ?? 0.4),
        ease: EASE[spec.ease] ? spec.ease : 'out',
        nodes: n,
        len,
        length: total,
        half,
        baseLeft: left,
        baseRight: right,
        left,
        right,
        colorA: [colorA[0], colorA[1], colorA[2]],
        colorB: [colorB[0], colorB[1], colorB[2]],
        mixB: spec.colorB ? clamp01(spec.mixB ?? 0.35) : 0,
        load: spec.load ?? 1,
        dry: spec.dry ?? 0.5,
        bristle: spec.bristle ?? (spec.kind === KIND.KNIFE ? 0 : 1),
        height: spec.height ?? 1,
        special: spec.special ?? 0,
        keep: spec.keep ?? RELIEF.keep,
        seed: Math.floor(Math.abs(spec.seed ?? strokeIds * 37.13) % 4096),
        tag: spec.tag || '',
        // progress
        drawn: 0,
        seg: 0,
        done: !(total > 1e-7), // (emitStroke lays nothing shorter: such a stroke is finished already)
        /** The twist this stroke was laid through (null until its first piece is emitted). */
        twist: null,
        warped: false,
    };
}

/**
 * A blob of paint landing at a point: a splat, a drop, a dab.
 *
 * @param {object} spec  x, y, radius, t0, colorA, [colorB, mixB, load, height, special, keep,
 *                       seed, fingers (0..1: how far its rim is thrown out in spikes), crater
 *                       (0 = a bead standing on the cloth, 1 = struck hollow with a thrown rim),
 *                       angle]
 */
export function createBlob(spec) {
    const colorA = spec.colorA || [0.5, 0.5, 0.5];
    const colorB = spec.colorB || colorA;
    return {
        id: strokeIds++,
        kind: KIND.BLOB,
        t0: spec.t0 ?? 0,
        dur: 0,
        ease: 'linear',
        nodes: 0,
        length: 0,
        x: spec.x,
        y: spec.y,
        baseX: spec.x,
        baseY: spec.y,
        radius: Math.max(1e-4, spec.radius),
        angle: spec.angle ?? 0,
        colorA: [colorA[0], colorA[1], colorA[2]],
        colorB: [colorB[0], colorB[1], colorB[2]],
        mixB: spec.colorB ? clamp01(spec.mixB ?? 0.3) : 0,
        load: spec.load ?? 1,
        dry: clamp01(spec.fingers ?? 0.5),
        bristle: clamp01(spec.crater ?? 0),
        height: spec.height ?? 1,
        special: spec.special ?? 0,
        keep: spec.keep ?? RELIEF.keep,
        seed: Math.floor(Math.abs(spec.seed ?? strokeIds * 91.7) % 4096),
        tag: spec.tag || '',
        drawn: 0,
        seg: 0,
        done: false,
        twist: null,
        warped: false,
    };
}

/** Where along its path a stroke's brush is at `time` (arc length). */
export function strokeReach(stroke, time) {
    if (time < stroke.t0) return 0;
    if (stroke.dur <= 0) return stroke.length;
    const x = clamp01((time - stroke.t0) / stroke.dur);
    return stroke.length * EASE[stroke.ease](x);
}

function writeVertex(data, o, x, y, u, s, stroke) {
    data[o] = x;
    data[o + 1] = y;
    data[o + 2] = 0;
    data[o + 3] = u;
    data[o + 4] = s;
    data[o + 5] = stroke.length;
    // data[o + 6] = half-width, written by the caller
    data[o + 7] = stroke.colorA[0];
    data[o + 8] = stroke.colorA[1];
    data[o + 9] = stroke.colorA[2];
    data[o + 10] = stroke.seed;
    data[o + 11] = stroke.colorB[0];
    data[o + 12] = stroke.colorB[1];
    data[o + 13] = stroke.colorB[2];
    data[o + 14] = stroke.mixB;
    data[o + 15] = stroke.kind;
    data[o + 16] = stroke.load;
    data[o + 17] = stroke.dry;
    data[o + 18] = stroke.bristle;
    data[o + 19] = stroke.height;
    data[o + 20] = stroke.special;
    data[o + 21] = stroke.keep;
    data[o + 22] = 0;
}

/** How far past its radius a blob's quad reaches (its thrown fingers). */
export const BLOB_MARGIN = 1.9;

function emitBlob(stroke, batch) {
    const o = batch.alloc();
    const { data } = batch;
    const r = stroke.radius * BLOB_MARGIN;
    const c = Math.cos(stroke.angle) * r;
    const s = Math.sin(stroke.angle) * r;
    // Corners (−1,−1) (1,−1) (−1,1) (1,1) in the blob's own turned frame.
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (let k = 0; k < 4; k++) {
        const [u, v] = corners[k];
        const base = o + k * VERTEX_STRIDE;
        const x = stroke.x + u * c - v * s;
        const y = stroke.y + u * s + v * c;
        writeVertex(data, base, x, y, u * BLOB_MARGIN, v * BLOB_MARGIN, stroke);
        data[base + 5] = stroke.radius;
        data[base + 6] = stroke.radius;
    }
}

/**
 * Emit the piece of a stroke between where it has been drawn to and arc length `to`.
 * @returns {number} quads written
 */
export function emitStroke(stroke, to, batch) {
    if (stroke.done) return 0;
    if (stroke.kind === KIND.BLOB) {
        emitBlob(stroke, batch);
        stroke.done = true;
        return 1;
    }
    const end = Math.min(stroke.length, to);
    let a = stroke.drawn;
    if (end <= a + 1e-7) return 0;
    const {
        len, left, right, half, nodes,
    } = stroke;
    let i = Math.min(stroke.seg, nodes - 2);
    while (i < nodes - 2 && len[i + 1] <= a) i += 1;
    let quads = 0;
    const cut = (s, seg, out) => {
        const span = len[seg + 1] - len[seg];
        const f = span > 1e-9 ? clamp01((s - len[seg]) / span) : 0;
        out[0] = left[seg * 2] + (left[seg * 2 + 2] - left[seg * 2]) * f;
        out[1] = left[seg * 2 + 1] + (left[seg * 2 + 3] - left[seg * 2 + 1]) * f;
        out[2] = right[seg * 2] + (right[seg * 2 + 2] - right[seg * 2]) * f;
        out[3] = right[seg * 2 + 1] + (right[seg * 2 + 3] - right[seg * 2 + 1]) * f;
        out[4] = half[seg] + (half[seg + 1] - half[seg]) * f;
    };
    const ca = [0, 0, 0, 0, 0];
    const cb = [0, 0, 0, 0, 0];
    cut(a, i, ca);
    while (a < end - 1e-7) {
        const b = Math.min(end, len[i + 1]);
        cut(b, i, cb);
        const o = batch.alloc();
        const { data } = batch;
        writeVertex(data, o, ca[0], ca[1], 1, a, stroke);
        data[o + 6] = ca[4];
        writeVertex(data, o + VERTEX_STRIDE, ca[2], ca[3], -1, a, stroke);
        data[o + VERTEX_STRIDE + 6] = ca[4];
        writeVertex(data, o + VERTEX_STRIDE * 2, cb[0], cb[1], 1, b, stroke);
        data[o + VERTEX_STRIDE * 2 + 6] = cb[4];
        writeVertex(data, o + VERTEX_STRIDE * 3, cb[2], cb[3], -1, b, stroke);
        data[o + VERTEX_STRIDE * 3 + 6] = cb[4];
        quads += 1;
        a = b;
        ca[0] = cb[0];
        ca[1] = cb[1];
        ca[2] = cb[2];
        ca[3] = cb[3];
        ca[4] = cb[4];
        if (b >= len[i + 1] - 1e-9) {
            if (i >= nodes - 2) break;
            i += 1;
        }
    }
    stroke.drawn = end;
    stroke.seg = i;
    if (end >= stroke.length - 1e-7) stroke.done = true;
    return quads;
}
