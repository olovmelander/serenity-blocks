/**
 * Supernova — the 3D bakes (CPU only, three-free).
 *
 * Four periodic gradient-noise fields, a pure function of the seed and size (0.13 s of main thread,
 * play-feel probe 2026-10-16), and a smaller volume of convection cells (the photosphere's
 * granules); both kept in the shared bake cache (read-only: the textures' bytes). A first visit
 * bakes them in a module Worker (supernova-bake.worker.js, started by supernova-bakes.js) while
 * the renderer comes up. The textures are made in supernova-tsl.js.
 */
import { mulberry32 } from './supernova-core.js';
import { bakeOnce } from '../shared/bake-cache.js';

export const NOISE3_SIZE = 64;
/** The seed the world bakes with (its default). */
export const NOISE3_SEED = 1987;
/** The bake cache's key. */
export const noise3Key = (seed, size) => `supernova:noise3:${seed}:${size}`;

/**
 * Four decorrelated periodic gradient-noise fields (three octaves each), as bytes. Every field
 * is centred on 0.5 with a standard deviation near 0.18, so a threshold means the same thing in
 * every channel: 0.5 is the median, 0.68 leaves about a sixth above it.
 * @returns {Uint8Array} size³ × 4
 */
function computeNoise3D(seed, size) {
    const n = size;
    const rand = mulberry32(seed);
    const out = new Uint8Array(n * n * n * 4);
    const field = new Float32Array(n * n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    const i0 = new Int32Array(n);
    const i1 = new Int32Array(n);
    const ft = new Float32Array(n);
    const fs = new Float32Array(n);
    for (let c = 0; c < 4; c++) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 3; o++) {
            const period = 4 << o;
            const cells = period * period * period;
            const gx = new Float32Array(cells);
            const gy = new Float32Array(cells);
            const gz = new Float32Array(cells);
            for (let i = 0; i < cells; i++) {
                const z = rand() * 2 - 1;
                const a = rand() * Math.PI * 2;
                const s = Math.sqrt(Math.max(0, 1 - z * z));
                gx[i] = Math.cos(a) * s;
                gy[i] = Math.sin(a) * s;
                gz[i] = z;
            }
            const scale = period / n;
            for (let x = 0; x < n; x++) {
                const f = x * scale;
                i0[x] = Math.floor(f);
                ft[x] = f - i0[x];
                i1[x] = (i0[x] + 1) % period;
                fs[x] = fade(ft[x]);
            }
            let at = 0;
            for (let z = 0; z < n; z++) {
                const tz = ft[z];
                const sz = fs[z];
                const za = i0[z] * period;
                const zb = i1[z] * period;
                for (let y = 0; y < n; y++) {
                    const ty = ft[y];
                    const sy = fs[y];
                    const aa = (za + i0[y]) * period;
                    const ab = (za + i1[y]) * period;
                    const ba = (zb + i0[y]) * period;
                    const bb = (zb + i1[y]) * period;
                    for (let x = 0; x < n; x++) {
                        const tx = ft[x];
                        const sx = fs[x];
                        const xa = i0[x];
                        const xb = i1[x];
                        let k = aa + xa;
                        const d000 = gx[k] * tx + gy[k] * ty + gz[k] * tz;
                        k = aa + xb;
                        const d100 = gx[k] * (tx - 1) + gy[k] * ty + gz[k] * tz;
                        k = ab + xa;
                        const d010 = gx[k] * tx + gy[k] * (ty - 1) + gz[k] * tz;
                        k = ab + xb;
                        const d110 = gx[k] * (tx - 1) + gy[k] * (ty - 1) + gz[k] * tz;
                        k = ba + xa;
                        const d001 = gx[k] * tx + gy[k] * ty + gz[k] * (tz - 1);
                        k = ba + xb;
                        const d101 = gx[k] * (tx - 1) + gy[k] * ty + gz[k] * (tz - 1);
                        k = bb + xa;
                        const d011 = gx[k] * tx + gy[k] * (ty - 1) + gz[k] * (tz - 1);
                        k = bb + xb;
                        const d111 = gx[k] * (tx - 1) + gy[k] * (ty - 1) + gz[k] * (tz - 1);
                        const x00 = d000 + (d100 - d000) * sx;
                        const x10 = d010 + (d110 - d010) * sx;
                        const x01 = d001 + (d101 - d001) * sx;
                        const x11 = d011 + (d111 - d011) * sx;
                        const y0 = x00 + (x10 - x00) * sy;
                        const y1 = x01 + (x11 - x01) * sy;
                        field[at] += (y0 + (y1 - y0) * sz) * amp;
                        at += 1;
                    }
                }
            }
            amp *= 0.5;
        }
        let mean = 0;
        for (let i = 0; i < field.length; i++) mean += field[i];
        mean /= field.length;
        let variance = 0;
        for (let i = 0; i < field.length; i++) variance += (field[i] - mean) * (field[i] - mean);
        const inv = 1 / (Math.sqrt(variance / field.length) * 5.6 + 1e-9);
        for (let i = 0; i < field.length; i++) {
            const v = 0.5 + (field[i] - mean) * inv;
            out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
        }
    }
    return out;
}

/** The noise for a seed and size, baked once. */
export function bakeNoise3D(seed = NOISE3_SEED, size = NOISE3_SIZE) {
    return bakeOnce(noise3Key(seed, size), () => computeNoise3D(seed, size));
}

// ── Convection cells ────────────────────────────────────────────────────────────

/** Voxels across the cell volume, and how many cells cross it (the pattern's period). */
export const CELLS3_SIZE = 48;
export const CELLS3_GRID = 6;
/** The bake cache's key. */
export const cells3Key = (seed, size) => `supernova:cells3:${seed}:${size}`;

/**
 * A periodic field of convection cells (the photosphere's granules), as bytes. One point is
 * scattered in each cell of a grid that wraps; a voxel knows the two points nearest it.
 *   R  how far it is from its own point (0 on it, 1 a cell away): a granule's dome
 *   G  how far it is from the wall between its cell and the next (0 on the wall, 1 half a
 *      cell in): the dark lanes between granules, the same width everywhere
 *   B  its cell's own number (0..1): every granule a little hotter or cooler than the next
 *   A  the same wall distance for cells three times as wide: the network the granules sit in
 * @returns {Uint8Array} size³ × 4
 */
function computeCells3D(seed, size, grid) {
    const n = size;
    const rand = mulberry32(seed ^ 0x9e3779b9);
    const out = new Uint8Array(n * n * n * 4);
    /** Scatter one point in every cell of a g³ grid: [x, y, z, value] per cell, in cells. */
    const scatter = (g) => {
        const points = new Float32Array(g * g * g * 4);
        for (let i = 0; i < g * g * g; i++) {
            points[i * 4] = 0.12 + rand() * 0.76;
            points[i * 4 + 1] = 0.12 + rand() * 0.76;
            points[i * 4 + 2] = 0.12 + rand() * 0.76;
            points[i * 4 + 3] = rand();
        }
        return points;
    };
    const fine = scatter(grid);
    const coarseGrid = Math.max(2, Math.round(grid / 3));
    const coarse = scatter(coarseGrid);
    const found = {
        d1: 0, wall: 0, value: 0,
    };
    /** The nearest point to (x, y, z) (in cells), and the distance to the wall toward the next. */
    const nearest = (points, g, x, y, z) => {
        const cx = Math.floor(x);
        const cy = Math.floor(y);
        const cz = Math.floor(z);
        let d1 = Infinity;
        let d2 = Infinity;
        let ax = 0;
        let ay = 0;
        let az = 0;
        let bx = 0;
        let by = 0;
        let bz = 0;
        let value = 0;
        for (let k = -1; k <= 1; k++) {
            const wz = (((cz + k) % g) + g) % g;
            for (let j = -1; j <= 1; j++) {
                const wy = (((cy + j) % g) + g) % g;
                for (let i = -1; i <= 1; i++) {
                    const wx = (((cx + i) % g) + g) % g;
                    const at = ((wz * g + wy) * g + wx) * 4;
                    const px = cx + i + points[at] - x;
                    const py = cy + j + points[at + 1] - y;
                    const pz = cz + k + points[at + 2] - z;
                    const d = px * px + py * py + pz * pz;
                    if (d < d1) {
                        d2 = d1;
                        bx = ax;
                        by = ay;
                        bz = az;
                        d1 = d;
                        ax = px;
                        ay = py;
                        az = pz;
                        value = points[at + 3];
                    } else if (d < d2) {
                        d2 = d;
                        bx = px;
                        by = py;
                        bz = pz;
                    }
                }
            }
        }
        // The wall between the two nearest points is the plane half way between them.
        const ex = bx - ax;
        const ey = by - ay;
        const ez = bz - az;
        const span = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
        found.d1 = Math.sqrt(d1);
        found.wall = ((ax + bx) * 0.5 * ex + (ay + by) * 0.5 * ey + (az + bz) * 0.5 * ez) / span;
        found.value = value;
        return found;
    };
    const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
    let at = 0;
    for (let z = 0; z < n; z++) {
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                const fx = ((x + 0.5) / n) * grid;
                const fy = ((y + 0.5) / n) * grid;
                const fz = ((z + 0.5) / n) * grid;
                const cell = nearest(fine, grid, fx, fy, fz);
                out[at] = byte(cell.d1);
                out[at + 1] = byte(cell.wall * 2);
                out[at + 2] = byte(cell.value);
                const s = coarseGrid / grid;
                out[at + 3] = byte(nearest(coarse, coarseGrid, fx * s, fy * s, fz * s).wall * 2);
                at += 4;
            }
        }
    }
    return out;
}

/** The convection cells for a seed and size, baked once. */
export function bakeCells3D(seed = NOISE3_SEED, size = CELLS3_SIZE) {
    return bakeOnce(cells3Key(seed, size), () => computeCells3D(seed, size, CELLS3_GRID));
}
