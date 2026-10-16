/**
 * Voltage Storm — the noise bakes (CPU only, three-free).
 *
 * The 2D noise and the cloud's 3D noise are pure functions of their seed and size, kept in the
 * shared bake cache. A first visit bakes them in a module Worker (voltage-storm-bake.worker.js,
 * started by voltage-storm-bakes.js) while the renderer comes up; the world's build then finds them
 * there. The textures are made in voltage-storm-tsl.js.
 */
import { TAU, mulberry32 } from './voltage-storm-core.js';
import { bakeOnce } from '../shared/bake-cache.js';

/** The seeds the world builds with (the cloud's size is the tier's `noise3d`). */
export const NOISE_SEED = 5150;
export const CLOUD_SEED = 9001;

/** The bake cache's keys. */
export const noiseKey = (seed, size) => `voltage-storm:noise:${seed}:${size}`;
export const cloudKey = (seed, size) => `voltage-storm:cloud:${seed}:${size}`;

export const NOISE_SIZE = 256;
/** The slope channels hold (dR/du, dR/dv) per texel times this, so they sit near ±1. */
export const NOISE_SLOPE_GAIN = 14;

/**
 * Periodic fBm gradient noise. R and G are two decorrelated fields stretched to [0, 1]; B and A
 * are R's slope along u and v (signed, times NOISE_SLOPE_GAIN), so one fetch gives a height and
 * its gradient.
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
    for (let c = 0; c < 2; c++) {
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
    for (let y = 0; y < n; y++) {
        const yu = ((y + n - 1) % n) * n;
        const yd = ((y + 1) % n) * n;
        for (let x = 0; x < n; x++) {
            const xl = (x + n - 1) % n;
            const xr = (x + 1) % n;
            const o = (y * n + x) * 4;
            base[o + 2] = (base[(y * n + xr) * 4] - base[(y * n + xl) * 4]) * 0.5 * NOISE_SLOPE_GAIN;
            base[o + 3] = (base[(yd + x) * 4] - base[(yu + x) * 4]) * 0.5 * NOISE_SLOPE_GAIN;
        }
    }
    return base;
}

/**
 * Tileable cloud noise, `size`³ voxels of RGBA8:
 *   R  the lobes: smooth gradient noise carved by inverted cellular noise (billows that hang)
 *   G  finer billows (cellular, two octaves), for the erosion of the lobes' edges
 *   B  the finest cells
 *   A  smooth gradient noise alone (wisps, the slow churn)
 * @returns {Uint8Array} size³ × 4, x fastest, then y, then z
 */
export function bakeCloudNoise(seed = CLOUD_SEED, size = 48) {
    return bakeOnce(cloudKey(seed, size), () => computeCloudNoise(seed, size));
}

function computeCloudNoise(seed, size) {
    const n = size;
    const rand = mulberry32(seed);
    const count = n * n * n;

    /** Inverted cellular noise (1 at a cell's point, 0 between) with `cells` cells per tile. */
    const cellular = (cells) => {
        const pts = new Float32Array(cells * cells * cells * 3);
        for (let i = 0; i < pts.length; i++) pts[i] = rand();
        const out = new Float32Array(count);
        const scale = cells / n;
        const wrap = (v) => ((v % cells) + cells) % cells;
        let o = 0;
        for (let z = 0; z < n; z++) {
            const fz = (z + 0.5) * scale;
            const cz = Math.floor(fz);
            for (let y = 0; y < n; y++) {
                const fy = (y + 0.5) * scale;
                const cy = Math.floor(fy);
                for (let x = 0; x < n; x++) {
                    const fx = (x + 0.5) * scale;
                    const cx = Math.floor(fx);
                    let best = 9;
                    for (let dz = -1; dz <= 1; dz++) {
                        const kz = wrap(cz + dz) * cells * cells;
                        for (let dy = -1; dy <= 1; dy++) {
                            const ky = kz + wrap(cy + dy) * cells;
                            for (let dx = -1; dx <= 1; dx++) {
                                const k = (ky + wrap(cx + dx)) * 3;
                                const px = cx + dx + pts[k] - fx;
                                const py = cy + dy + pts[k + 1] - fy;
                                const pz = cz + dz + pts[k + 2] - fz;
                                const d = px * px + py * py + pz * pz;
                                if (d < best) best = d;
                            }
                        }
                    }
                    out[o] = 1 - Math.min(1, Math.sqrt(best));
                    o += 1;
                }
            }
        }
        return out;
    };

    /** Periodic gradient noise with `cells` lattice cells per tile, in about [−1, 1]. */
    const gradient = (cells) => {
        const g = new Float32Array(cells * cells * cells * 3);
        for (let i = 0; i < g.length; i += 3) {
            const zc = rand() * 2 - 1;
            const a = rand() * TAU;
            const r = Math.sqrt(1 - zc * zc);
            g[i] = r * Math.cos(a);
            g[i + 1] = r * Math.sin(a);
            g[i + 2] = zc;
        }
        const out = new Float32Array(count);
        const scale = cells / n;
        const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
        const at = (ix, iy, iz, dx, dy, dz) => {
            const k = ((((iz % cells) * cells) + (iy % cells)) * cells + (ix % cells)) * 3;
            return g[k] * dx + g[k + 1] * dy + g[k + 2] * dz;
        };
        let o = 0;
        for (let z = 0; z < n; z++) {
            const fz = (z + 0.5) * scale;
            const z0 = Math.floor(fz);
            const tz = fz - z0;
            const sz = fade(tz);
            for (let y = 0; y < n; y++) {
                const fy = (y + 0.5) * scale;
                const y0 = Math.floor(fy);
                const ty = fy - y0;
                const sy = fade(ty);
                for (let x = 0; x < n; x++) {
                    const fx = (x + 0.5) * scale;
                    const x0 = Math.floor(fx);
                    const tx = fx - x0;
                    const sx = fade(tx);
                    const a00 = at(x0, y0, z0, tx, ty, tz);
                    const a10 = at(x0 + 1, y0, z0, tx - 1, ty, tz);
                    const a01 = at(x0, y0 + 1, z0, tx, ty - 1, tz);
                    const a11 = at(x0 + 1, y0 + 1, z0, tx - 1, ty - 1, tz);
                    const b00 = at(x0, y0, z0 + 1, tx, ty, tz - 1);
                    const b10 = at(x0 + 1, y0, z0 + 1, tx - 1, ty, tz - 1);
                    const b01 = at(x0, y0 + 1, z0 + 1, tx, ty - 1, tz - 1);
                    const b11 = at(x0 + 1, y0 + 1, z0 + 1, tx - 1, ty - 1, tz - 1);
                    const a0 = a00 + (a10 - a00) * sx;
                    const a1 = a01 + (a11 - a01) * sx;
                    const b0 = b00 + (b10 - b00) * sx;
                    const b1 = b01 + (b11 - b01) * sx;
                    const lo = a0 + (a1 - a0) * sy;
                    const hi = b0 + (b1 - b0) * sy;
                    out[o] = (lo + (hi - lo) * sz) * 1.5;
                    o += 1;
                }
            }
        }
        return out;
    };

    const c3 = cellular(3);
    const c6 = cellular(6);
    const c12 = cellular(12);
    const g3 = gradient(3);
    const g6 = gradient(6);
    const data = new Uint8Array(count * 4);
    const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
    for (let i = 0; i < count; i++) {
        const smoothField = Math.max(0, Math.min(1, 0.5 + 0.5 * (g3[i] * 0.7 + g6[i] * 0.3)));
        const billow = c3[i] * 0.6 + c6[i] * 0.28 + c12[i] * 0.12;
        // Gradient noise gives the masses, the cells hang lobes from them.
        data[i * 4] = byte(smoothField * 0.55 + billow * 0.62 - 0.08);
        data[i * 4 + 1] = byte(c6[i] * 0.62 + c12[i] * 0.38);
        data[i * 4 + 2] = byte(c12[i]);
        data[i * 4 + 3] = byte(smoothField);
    }
    return data;
}

/** The cloud noise as a tileable, linearly filtered 3D texture (RGBA8: filterable everywhere). */
