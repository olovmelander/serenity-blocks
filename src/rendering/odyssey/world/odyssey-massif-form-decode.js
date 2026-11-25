// @ts-check
/**
 * THE MASSIF'S FORM, decoded (2026-11-25). The hero mountain is grown as a landform in Blender
 * (scripts/blender/odyssey/odyssey_massif.py: ridges drawn over the island's cone, rain and frost on
 * them, hard beds standing as broken cliff bands) and shipped as `ODYSSEY_MASSIF_FORM`, a JS module, so
 * the main thread, the bake worker and the tests read the same numbers synchronously.
 *
 * Layout (see `pack` in the script): an n x n grid on ODYSSEY_SCULPT_PLATE's square (post (i, j) at
 * x0 + i * step, z0 + j * step), two fields, each zlib + base64:
 *   delta  the height the form adds over the island's ground (macro + relief x weight), in `quant` u,
 *          stored as the residual of a left + up - up-left predictor, zig-zagged into uint16;
 *   gully  where water gathers (the rain's flow, log scaled), 0..255.
 * The grid's border is zero (the form fades out across the massif's foot), so a point off it adds nothing.
 */
import { unzlibSync } from 'three/examples/jsm/libs/fflate.module.js';
import { ODYSSEY_MASSIF_FORM as F } from './odyssey-massif-form.js';

/** @param {string} b64 */
function bytesOf(b64) {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return unzlibSync(out);
}

/** @type {Float32Array | null} */
let deltaGrid = null;
/** @type {Uint8Array | null} */
let gullyGrid = null;

function decodeDelta() {
    const { n } = F;
    const raw = bytesOf(F.delta);
    const res = new Uint16Array(raw.buffer, raw.byteOffset, n * n);
    const q = new Int32Array(n * n);
    for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
            const k = (j * n) + i;
            const z = res[k];
            const r = (z & 1) ? -((z + 1) >> 1) : (z >> 1);
            let p = 0;
            if (i > 0 && j > 0) p = q[k - 1] + q[k - n] - q[k - n - 1];
            else if (i > 0) p = q[k - 1];
            else if (j > 0) p = q[k - n];
            q[k] = p + r;
        }
    }
    const out = new Float32Array(n * n);
    for (let k = 0; k < n * n; k += 1) out[k] = q[k] * F.quant;
    return out;
}

/** The decoded delta grid (u), row j along z. */
export function massifDeltaGrid() {
    if (!deltaGrid) deltaGrid = decodeDelta();
    return deltaGrid;
}

/** The decoded gully grid (0..255), row j along z. */
export function massifGullyGrid() {
    if (!gullyGrid) gullyGrid = bytesOf(F.gully);
    return gullyGrid;
}

export const ODYSSEY_MASSIF_GRID = Object.freeze({
    n: F.n, x0: F.x0, z0: F.z0, step: F.step,
});

/** Catmull-Rom weights for a fraction t. @param {number} t */
function cr(t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return [
        0.5 * (-t3 + (2 * t2) - t),
        0.5 * ((3 * t3) - (5 * t2) + 2),
        0.5 * ((-3 * t3) + (4 * t2) + t),
        0.5 * (t3 - t2),
    ];
}

/**
 * The height the massif's form adds at (x, z), world units: bicubic (Catmull-Rom) over the grid, so its
 * slope is continuous; 0 off the grid.
 * @param {number} x
 * @param {number} z
 */
export function odysseyMassifDelta(x, z) {
    const { n } = F;
    const fi = (x - F.x0) / F.step;
    const fj = (z - F.z0) / F.step;
    if (!(fi > 1 && fj > 1 && fi < n - 2 && fj < n - 2)) return 0;
    const g = massifDeltaGrid();
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const wx = cr(fi - i);
    const wz = cr(fj - j);
    let sum = 0;
    for (let b = 0; b < 4; b += 1) {
        const row = (j - 1 + b) * n;
        const r = (g[row + i - 1] * wx[0]) + (g[row + i] * wx[1]) + (g[row + i + 1] * wx[2]) + (g[row + i + 2] * wx[3]);
        sum += r * wz[b];
    }
    return sum;
}

/**
 * Where water gathers on the massif at (x, z), 0..1: bilinear over the grid, 0 off it.
 * @param {number} x
 * @param {number} z
 */
export function odysseyMassifGully(x, z) {
    const { n } = F;
    const fi = (x - F.x0) / F.step;
    const fj = (z - F.z0) / F.step;
    if (!(fi >= 0 && fj >= 0 && fi < n - 1 && fj < n - 1)) return 0;
    const g = massifGullyGrid();
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;
    const k = (j * n) + i;
    const top = (g[k] * (1 - u)) + (g[k + 1] * u);
    const bottom = (g[k + n] * (1 - u)) + (g[k + n + 1] * u);
    return ((top * (1 - v)) + (bottom * v)) / 255;
}
