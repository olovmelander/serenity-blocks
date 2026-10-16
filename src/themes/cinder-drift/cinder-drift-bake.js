/**
 * Cinder Drift — the baked fields (CPU only, three-free).
 *
 * The noise and the crust's plates are pure functions of their arguments, a tenth of a second or
 * more each, kept in the shared bake cache (a rebuild, a quality change, a GPU recovery or coming
 * back to the theme reuses them; read-only). A first visit bakes them in a module Worker
 * (cinder-drift-bake.worker.js, started by cinder-drift-bakes.js) while the renderer comes up. The
 * textures are made in cinder-drift-tsl.js.
 */
import { PLATE_CELLS, TAU, mulberry32 } from './cinder-drift-core.js';
import { bakeOnce } from '../shared/bake-cache.js';

export const NOISE_SIZE = 256;
export const PLATE_SIZE = 512;
/** The seeds the world builds with. */
export const NOISE_SEED = 4177;
export const PLATE_SEED = 9311;

/** The bake cache's keys. */
export const noiseKey = (seed, size) => `cinder-drift:noise:${seed}:${size}`;
export const platesKey = (seed, size, cells) => `cinder-drift:plates:${seed}:${size}:${cells}`;

/**
 * Periodic fBm gradient noise, four decorrelated channels stretched to [0, 1].
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = NOISE_SEED, size = NOISE_SIZE) {
    return bakeOnce(noiseKey(seed, size), () => computeNoise(seed, size));
}

function computeNoise(seed, size) {
    const n = size;
    const rand = mulberry32(seed);
    const base = new Float32Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    for (let c = 0; c < 4; c++) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 5; o++) {
            const period = 4 << o;
            const gx = new Float32Array(period * period);
            const gy = new Float32Array(period * period);
            for (let i = 0; i < gx.length; i++) {
                const a = rand() * TAU;
                gx[i] = Math.cos(a);
                gy[i] = Math.sin(a);
            }
            const scale = period / n;
            for (let y = 0; y < n; y++) {
                const fy = y * scale;
                const y0 = Math.floor(fy);
                const ty = fy - y0;
                const y1 = (y0 + 1) % period;
                const sy = fade(ty);
                for (let x = 0; x < n; x++) {
                    const fx = x * scale;
                    const x0 = Math.floor(fx);
                    const tx = fx - x0;
                    const x1 = (x0 + 1) % period;
                    const sx = fade(tx);
                    const i00 = y0 * period + x0;
                    const i10 = y0 * period + x1;
                    const i01 = y1 * period + x0;
                    const i11 = y1 * period + x1;
                    const d00 = gx[i00] * tx + gy[i00] * ty;
                    const d10 = gx[i10] * (tx - 1) + gy[i10] * ty;
                    const d01 = gx[i01] * tx + gy[i01] * (ty - 1);
                    const d11 = gx[i11] * (tx - 1) + gy[i11] * (ty - 1);
                    const top = d00 + (d10 - d00) * sx;
                    const bottom = d01 + (d11 - d01) * sx;
                    field[y * n + x] += (top + (bottom - top) * sy) * amp;
                }
            }
            amp *= 0.5;
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < field.length; i++) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        const inv = 1 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i++) base[i * 4 + c] = (field[i] - lo) * inv;
    }
    return base;
}

/**
 * The crust's plates: a tileable Voronoi of `cells` × `cells` jittered sites.
 *   R  distance to the nearest plate edge, ×2 (0 on a crack, → 1 deep inside a plate)
 *   G  the plate's own random number
 *   B  distance to the plate's site (0 at its heart)
 *   A  a second random number for the plate
 * @returns {Float32Array} size × size × 4
 */
export function bakePlates(seed = PLATE_SEED, size = PLATE_SIZE, cells = PLATE_CELLS) {
    return bakeOnce(platesKey(seed, size, cells), () => computePlates(seed, size, cells));
}

function computePlates(seed, size, cells) {
    const rand = mulberry32(seed);
    const sx = new Float32Array(cells * cells);
    const sy = new Float32Array(cells * cells);
    const ra = new Float32Array(cells * cells);
    const rb = new Float32Array(cells * cells);
    for (let i = 0; i < cells * cells; i++) {
        sx[i] = 0.5 + (rand() - 0.5) * 0.84;
        sy[i] = 0.5 + (rand() - 0.5) * 0.84;
        ra[i] = rand();
        rb[i] = rand();
    }
    const out = new Float32Array(size * size * 4);
    const px = new Float32Array(9);
    const py = new Float32Array(9);
    const wrap = (v) => ((v % cells) + cells) % cells;
    for (let y = 0; y < size; y++) {
        const fy = ((y + 0.5) / size) * cells;
        const cy = Math.floor(fy);
        for (let x = 0; x < size; x++) {
            const fx = ((x + 0.5) / size) * cells;
            const cx = Math.floor(fx);
            let nearest = 0;
            let best = Infinity;
            let id = 0;
            for (let j = -1; j <= 1; j++) {
                for (let i = -1; i <= 1; i++) {
                    const cell = wrap(cy + j) * cells + wrap(cx + i);
                    const k = (j + 1) * 3 + (i + 1);
                    px[k] = cx + i + sx[cell] - fx;
                    py[k] = cy + j + sy[cell] - fy;
                    const d = px[k] * px[k] + py[k] * py[k];
                    if (d < best) {
                        best = d;
                        nearest = k;
                        id = cell;
                    }
                }
            }
            // The true distance to the nearest edge: the nearest bisector with any neighbour.
            let edge = Infinity;
            for (let k = 0; k < 9; k++) {
                if (k === nearest) continue;
                const dx = px[k] - px[nearest];
                const dy = py[k] - py[nearest];
                const len = Math.hypot(dx, dy);
                if (len < 1e-5) continue;
                const d = ((px[nearest] + px[k]) * 0.5 * dx + (py[nearest] + py[k]) * 0.5 * dy) / len;
                if (d < edge) edge = d;
            }
            const o = (y * size + x) * 4;
            out[o] = Math.max(0, Math.min(1, edge * 2));
            out[o + 1] = ra[id];
            out[o + 2] = Math.min(1, Math.sqrt(best));
            out[o + 3] = rb[id];
        }
    }
    return out;
}
