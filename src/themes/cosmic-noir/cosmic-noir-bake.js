/**
 * Cosmic Noir — the noise bake (CPU only, three-free).
 *
 * The smoke's volume is a pure function of its seed and size, kept in the shared bake cache. A
 * first visit bakes it in a module Worker (cosmic-noir-bake.worker.js, started by
 * cosmic-noir-bakes.js) while the renderer comes up; the world's build then finds it in the cache.
 * The textures are made in cosmic-noir-tsl.js.
 */
import { TAU, mulberry32 } from './cosmic-noir-core.js';
import { bakeOnce } from '../shared/bake-cache.js';
import { toHalfFloat } from '../shared/half-float.js';

/** The seed the world builds with (the size is the tier's `noise`). */
export const SMOKE_SEED = 1946; // the year of the noir

/** The bake cache's key. */
export const smokeNoiseKey = (seed, size) => `cosmic-noir:smoke:${seed}:${size}`;

/**
 * The smoke as a tileable volume, four fields in the bytes of one texel:
 *   R  the masses (three octaves of gradient noise)
 *   G  filaments: the ridges of three finer octaves (the curling threads of smoke)
 *   B  billows (two octaves of cells: the puffs)
 *   A  a second, slower field: where the smoke opens into dark gaps
 *
 * Baked twice from the same lattices: `near` with every octave, and `far` at half the resolution
 * with each field's finest octave left out, for march steps longer than the finest features.
 * @returns {{ near: Uint8Array, far: Uint8Array, farSize: number }} size³ × 4 and (size/2)³ × 4
 */
export function bakeSmokeNoise(seed = SMOKE_SEED, size = 64) {
    return bakeOnce(smokeNoiseKey(seed, size), () => computeSmokeNoise(seed, size));
}

function computeSmokeNoise(seed, size) {
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
    /** A periodic lattice of one point a cell. */
    const cellLattice = (cells) => {
        const pts = new Float32Array(cells * cells * cells * 3);
        for (let i = 0; i < pts.length; i++) pts[i] = rand();
        return { pts, cells };
    };
    /** Cells of a lattice on an n³ grid: 1 at a cell's own point, falling to 0 a cell away. */
    const cellular = ({ pts, cells }, n) => {
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

    const L = {
        g2: gradientLattice(2),
        g4: gradientLattice(4),
        g8: gradientLattice(8),
        r4: gradientLattice(4),
        r8: gradientLattice(8),
        r16: gradientLattice(16),
        c4: cellLattice(4),
        c8: cellLattice(8),
        h2: gradientLattice(2),
        h4: gradientLattice(4),
    };
    /** The four fields on an n³ grid; `fine` = with each field's finest octave. */
    const fieldsAt = (n, fine) => {
        const count = n * n * n;
        const g2 = gradient(L.g2, n);
        const g4 = gradient(L.g4, n);
        const g8 = fine ? gradient(L.g8, n) : null;
        const r4 = gradient(L.r4, n);
        const r8 = gradient(L.r8, n);
        const r16 = fine ? gradient(L.r16, n) : null;
        const c4 = cellular(L.c4, n);
        const c8 = fine ? cellular(L.c8, n) : null;
        const h2 = gradient(L.h2, n);
        const h4 = gradient(L.h4, n);
        const out = [new Float32Array(count), new Float32Array(count), new Float32Array(count), new Float32Array(count)];
        for (let i = 0; i < count; i++) {
            out[0][i] = g2[i] * 0.56 + g4[i] * 0.3 + (g8 ? g8[i] * 0.14 : 0);
            const ridge = 1 - Math.min(1, Math.abs(r4[i] * 0.58 + r8[i] * 0.3 + (r16 ? r16[i] * 0.12 : 0)) * 1.6);
            out[1][i] = ridge * ridge;
            // Without their finer octave the cells keep their mean.
            out[2][i] = c4[i] * 0.64 + (c8 ? c8[i] : 0.42) * 0.36;
            out[3][i] = h2[i] * 0.66 + h4[i] * 0.34;
        }
        return out;
    };
    const farSize = Math.max(8, size >> 1);
    const nearFields = fieldsAt(size, true);
    const farFields = fieldsAt(farSize, false);
    // Both are coded against the near fields' ranges, so they agree where they overlap.
    const ranges = nearFields.map((field) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < field.length; i++) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        return [lo, 255 / Math.max(1e-6, hi - lo)];
    });
    const code = (fields) => {
        const count = fields[0].length;
        const data = new Uint8Array(count * 4);
        for (let c = 0; c < 4; c++) {
            const [lo, inv] = ranges[c];
            const field = fields[c];
            for (let i = 0; i < count; i++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round((field[i] - lo) * inv)));
        }
        return data;
    };
    return { near: code(nearFields), far: code(farFields), farSize };
}

// ── The sea of smoke ────────────────────────────────────────────────────────────

/** The seed the sea is baked from (the size is the tier's `sea`). */
export const SEA_SEED = 1941;

/** The bake cache's key. */
export const seaFieldKey = (seed, size) => `cosmic-noir:sea:${seed}:${size}`;

/**
 * How much of an octave's height the next (twice as fine) keeps. Under a half, so each finer octave
 * is also less steep: a light that rakes the sea then draws its swells, not a crumple of creases.
 */
const SEA_PERSISTENCE = 0.4;
/** Lattice cells to a tile, octave by octave. */
const SEA_CELLS = Object.freeze([3, 6, 12, 24, 48]);

/**
 * The sea's surface as one tileable field, four values a texel:
 *   R  height (−1 .. 1, mean about 0)
 *   G  ∂height/∂u   (per tile: bilinear filtering of a slope is continuous, so the light on the
 *   B  ∂height/∂v    sea shows no texel grid)
 *   A  a second, slower field (0 .. 1): where the sea heaps up and where it lies calm
 * with its mip chain averaged here (half floats; the mean of a slope is the slope of the mean
 * height, so a far read is the filtered sea).
 * @returns {{ levels: Array<{ data: Uint16Array, width: number, height: number }>, size: number }}
 */
export function bakeSeaField(seed = SEA_SEED, size = 256) {
    return bakeOnce(seaFieldKey(seed, size), () => computeSeaField(seed, size));
}

function computeSeaField(seed, size) {
    const rand = mulberry32(seed);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    /** Periodic gradient noise on the size² grid, `cells` to a tile, in about [−1, 1]. */
    const octave = (cells) => {
        const g = new Float32Array(cells * cells * 2);
        for (let i = 0; i < g.length; i += 2) {
            const a = rand() * TAU;
            g[i] = Math.cos(a);
            g[i + 1] = Math.sin(a);
        }
        const out = new Float32Array(size * size);
        const scale = cells / size;
        const at = (ix, iy, dx, dy) => {
            const k = ((iy % cells) * cells + (ix % cells)) * 2;
            return g[k] * dx + g[k + 1] * dy;
        };
        for (let y = 0; y < size; y++) {
            const fy = (y + 0.5) * scale;
            const y0 = Math.floor(fy);
            const ty = fy - y0;
            const sy = fade(ty);
            for (let x = 0; x < size; x++) {
                const fx = (x + 0.5) * scale;
                const x0 = Math.floor(fx);
                const tx = fx - x0;
                const sx = fade(tx);
                const a = at(x0, y0, tx, ty);
                const b = at(x0 + 1, y0, tx - 1, ty);
                const c = at(x0, y0 + 1, tx, ty - 1);
                const d = at(x0 + 1, y0 + 1, tx - 1, ty - 1);
                const lo = a + (b - a) * sx;
                const hi = c + (d - c) * sx;
                out[y * size + x] = (lo + (hi - lo) * sy) * 1.6;
            }
        }
        return out;
    };
    const count = size * size;
    const height = new Float32Array(count);
    let gain = 1;
    SEA_CELLS.forEach((cells) => {
        if (cells * 2 > size) return; // finer than the grid holds
        const o = octave(cells);
        for (let i = 0; i < count; i++) height[i] += o[i] * gain;
        gain *= SEA_PERSISTENCE;
    });
    const calmA = octave(2);
    const calmB = octave(5);
    // Height to −1 .. 1 about its mean.
    let mean = 0;
    for (let i = 0; i < count; i++) mean += height[i];
    mean /= count;
    let peak = 1e-6;
    for (let i = 0; i < count; i++) {
        height[i] -= mean;
        peak = Math.max(peak, Math.abs(height[i]));
    }
    const field = new Float32Array(count * 4);
    for (let y = 0; y < size; y++) {
        const up = ((y + 1) % size) * size;
        const down = ((y + size - 1) % size) * size;
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            const right = y * size + ((x + 1) % size);
            const left = y * size + ((x + size - 1) % size);
            const o = i * 4;
            field[o] = height[i] / peak;
            // Central differences on the periodic grid, per tile.
            field[o + 1] = ((height[right] - height[left]) / peak) * size * 0.5;
            field[o + 2] = ((height[up + x] - height[down + x]) / peak) * size * 0.5;
            field[o + 3] = Math.max(0, Math.min(1, 0.5 + calmA[i] * 0.42 + calmB[i] * 0.2));
        }
    }
    const levels = [];
    let level = field;
    let w = size;
    for (;;) {
        const half = new Uint16Array(level.length);
        for (let i = 0; i < level.length; i++) half[i] = toHalfFloat(level[i]);
        levels.push({ data: half, width: w, height: w });
        if (w === 1) break;
        const nw = w >> 1;
        const next = new Float32Array(nw * nw * 4);
        for (let y = 0; y < nw; y++) {
            for (let x = 0; x < nw; x++) {
                const a = (y * 2 * w + x * 2) * 4;
                const o = (y * nw + x) * 4;
                for (let c = 0; c < 4; c++) {
                    next[o + c] = (level[a + c] + level[a + 4 + c] + level[a + w * 4 + c] + level[a + w * 4 + 4 + c]) * 0.25;
                }
            }
        }
        level = next;
        w = nw;
    }
    return { levels, size };
}
