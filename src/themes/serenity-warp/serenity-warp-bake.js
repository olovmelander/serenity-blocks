/**
 * Serenity Warp — the noise bakes (CPU only, three-free).
 *
 * The gas volume (64³, about 0.4 s of main thread) and the fBm field are pure functions of their
 * seed and size, kept in the shared bake cache. A first visit bakes them in a module Worker
 * (serenity-warp-bake.worker.js, started by serenity-warp-bakes.js) while the renderer comes up;
 * the world's build then finds them in the cache. The textures are made in serenity-warp-tsl.js.
 */
import { TAU, mulberry32 } from './serenity-warp-core.js';
import { bakeOnce } from '../shared/bake-cache.js';

export const FBM_SIZE = 256;
/** The seeds and the gas volume's size the world builds with. */
export const GAS_SEED = 6151;
export const GAS_SIZE = 64;
export const FBM_SEED = 2718;

/** The bake cache's keys. */
export const gasNoiseKey = (seed, size) => `serenity-warp:gas:${seed}:${size}`;
export const fbmKey = (seed, size) => `serenity-warp:fbm:${seed}:${size}`;

/**
 * The gas as a tileable volume, four fields in the bytes of one texel:
 *   R  the masses (three octaves of gradient noise)
 *   G  filaments (the ridges of three finer octaves)
 *   B  billows (two octaves of cells)
 *   A  a second, slower field: where the gas opens, and where it is hot or cool
 * @returns {Uint8Array} size³ × 4
 */
export function bakeGasNoise(seed = GAS_SEED, size = GAS_SIZE) {
    return bakeOnce(gasNoiseKey(seed, size), () => computeGasNoise(seed, size));
}

function computeGasNoise(seed, size) {
    const rand = mulberry32(seed);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);

    /** A periodic lattice of unit gradients, `cells` to a tile. */
    const gradientLattice = (cells) => {
        const g = new Float32Array(cells * cells * cells * 3);
        for (let i = 0; i < g.length; i += 3) {
            const zc = rand() * 2 - 1;
            const a = rand() * TAU;
            const r = Math.sqrt(1 - zc * zc);
            g[i] = r * Math.cos(a);
            g[i + 1] = r * Math.sin(a);
            g[i + 2] = zc;
        }
        return { g, cells };
    };
    /** Gradient noise of a lattice on an n³ grid, in about [−1, 1]. */
    const gradient = ({ g, cells }, n) => {
        const out = new Float32Array(n * n * n);
        const scale = cells / n;
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
                    const a0 = at(x0, y0, z0, tx, ty, tz) + (at(x0 + 1, y0, z0, tx - 1, ty, tz) - at(x0, y0, z0, tx, ty, tz)) * sx;
                    const a1 = at(x0, y0 + 1, z0, tx, ty - 1, tz)
                        + (at(x0 + 1, y0 + 1, z0, tx - 1, ty - 1, tz) - at(x0, y0 + 1, z0, tx, ty - 1, tz)) * sx;
                    const b0 = at(x0, y0, z0 + 1, tx, ty, tz - 1)
                        + (at(x0 + 1, y0, z0 + 1, tx - 1, ty, tz - 1) - at(x0, y0, z0 + 1, tx, ty, tz - 1)) * sx;
                    const b1 = at(x0, y0 + 1, z0 + 1, tx, ty - 1, tz - 1)
                        + (at(x0 + 1, y0 + 1, z0 + 1, tx - 1, ty - 1, tz - 1) - at(x0, y0 + 1, z0 + 1, tx, ty - 1, tz - 1)) * sx;
                    const lo = a0 + (a1 - a0) * sy;
                    const hi = b0 + (b1 - b0) * sy;
                    out[o] = (lo + (hi - lo) * sz) * 1.5;
                    o += 1;
                }
            }
        }
        return out;
    };
    /** Cells of a lattice on an n³ grid: 1 at a cell's own point, falling to 0 a cell away. */
    const cellular = (cells, n) => {
        const pts = new Float32Array(cells * cells * cells * 3);
        for (let i = 0; i < pts.length; i++) pts[i] = rand();
        const out = new Float32Array(n * n * n);
        const scale = cells / n;
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
                        const kz = (((cz + dz) % cells) + cells) % cells;
                        for (let dy = -1; dy <= 1; dy++) {
                            const ky = (((cy + dy) % cells) + cells) % cells;
                            for (let dx = -1; dx <= 1; dx++) {
                                const kx = (((cx + dx) % cells) + cells) % cells;
                                const k = ((kz * cells + ky) * cells + kx) * 3;
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

    const n = size;
    const count = n * n * n;
    const g2 = gradient(gradientLattice(2), n);
    const g4 = gradient(gradientLattice(4), n);
    const g8 = gradient(gradientLattice(8), n);
    const r4 = gradient(gradientLattice(4), n);
    const r8 = gradient(gradientLattice(8), n);
    const r16 = gradient(gradientLattice(16), n);
    const c4 = cellular(4, n);
    const c8 = cellular(8, n);
    const h2 = gradient(gradientLattice(2), n);
    const h4 = gradient(gradientLattice(4), n);
    const fields = [new Float32Array(count), new Float32Array(count), new Float32Array(count), new Float32Array(count)];
    for (let i = 0; i < count; i++) {
        fields[0][i] = g2[i] * 0.56 + g4[i] * 0.3 + g8[i] * 0.14;
        const ridge = 1 - Math.min(1, Math.abs(r4[i] * 0.58 + r8[i] * 0.3 + r16[i] * 0.12) * 1.6);
        fields[1][i] = ridge * ridge;
        fields[2][i] = c4[i] * 0.64 + c8[i] * 0.36;
        fields[3][i] = h2[i] * 0.66 + h4[i] * 0.34;
    }
    const data = new Uint8Array(count * 4);
    for (let c = 0; c < 4; c++) {
        const field = fields[c];
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < count; i++) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        const inv = 255 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < count; i++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round((field[i] - lo) * inv)));
    }
    return data;
}

/**
 * Periodic fBm gradient noise, four decorrelated channels stretched to [0, 1].
 * @returns {Float32Array} size × size × 4
 */
export function bakeFbm(seed = FBM_SEED, size = FBM_SIZE) {
    return bakeOnce(fbmKey(seed, size), () => computeFbm(seed, size));
}

function computeFbm(seed, size) {
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
