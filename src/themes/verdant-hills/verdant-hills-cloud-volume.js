/**
 * Verdant Hills — the cumulus's 3D noise (three-free: typed arrays only, so a worker or a test
 * can run it).
 *
 * The cloud field (verdant-hills-light.js) is flat: it says where the heaps stand and how tall
 * they grow. Carved with flat noise alone, every billow was a column stood on end, so the heaps
 * read as tents, shark fins and stacks of slabs. This volume is what rounds them: a tileable
 * size³ RGBA8 block, read with texture3D and linear filtering, whose cells are balls in every
 * direction.
 *
 *   R  the lobes: gradient fBm carved by cellular fBm (Perlin–Worley), round masses on masses
 *   G  billows: cellular fBm at three rising frequencies, high at each cell's heart
 *   B  a second billow field like G, decorrelated, for the finest carving
 *   A  gradient fBm alone, for slow swells
 *
 * Deterministic by seed; about 0.2 s at size 64 on one core.
 */
import { bakeOnce } from '../shared/bake-cache.js';

/** Texels along each side of the volume. */
export const VERDANT_HILLS_CLOUD_VOLUME_SIZE = 64;
/** The seed of the volume the theme ships with. */
export const VERDANT_HILLS_CLOUD_VOLUME_SEED = 0x2c41;

/** The bake cache's key for a volume: every argument it depends on. */
export const verdantHillsCloudVolumeKey = (size, seed) => `verdant-hills:cloud-volume:${size}:${seed}`;

function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);

/**
 * Inverted cellular noise over the volume: 1 on a feature point, 0 a cell or more away. Each
 * point is pressed into the texels within a cell of it (a third of the work of asking all 27
 * neighbouring cells at every texel).
 */
function cellular(n, cells, rand) {
    const best = new Float32Array(n * n * n).fill(1);
    const span = n / cells;
    const reach = Math.ceil(span);
    const width = reach * 2 + 1;
    // One axis's texels within reach of a point: their wrapped index and squared offset in cells.
    const axis = (p, index, offset) => {
        const first = Math.floor(p) - reach;
        for (let i = 0; i < width; i += 1) {
            const t = first + i;
            index[i] = ((t % n) + n) % n;
            const d = (t + 0.5 - p) / span;
            offset[i] = d * d;
        }
    };
    const ix = new Int32Array(width);
    const iy = new Int32Array(width);
    const iz = new Int32Array(width);
    const ox = new Float32Array(width);
    const oy = new Float32Array(width);
    const oz = new Float32Array(width);
    for (let cz = 0; cz < cells; cz += 1) {
        for (let cy = 0; cy < cells; cy += 1) {
            for (let cx = 0; cx < cells; cx += 1) {
                axis((cx + rand()) * span, ix, ox);
                axis((cy + rand()) * span, iy, oy);
                axis((cz + rand()) * span, iz, oz);
                for (let k = 0; k < width; k += 1) {
                    const dz = oz[k];
                    if (dz >= 1) continue;
                    const plane = iz[k] * n * n;
                    for (let j = 0; j < width; j += 1) {
                        const dyz = dz + oy[j];
                        if (dyz >= 1) continue;
                        const row = plane + iy[j] * n;
                        for (let i = 0; i < width; i += 1) {
                            const d = dyz + ox[i];
                            const at = row + ix[i];
                            if (d < best[at]) best[at] = d;
                        }
                    }
                }
            }
        }
    }
    for (let i = 0; i < best.length; i += 1) best[i] = 1 - Math.sqrt(best[i]);
    return best;
}

/** Periodic gradient (Perlin) noise over the volume, `cells` lattice cells a side, about −1..1. */
function gradient(n, cells, rand) {
    const g = new Float32Array(cells * cells * cells * 3);
    for (let i = 0; i < g.length; i += 3) {
        const zc = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(1 - zc * zc);
        g[i] = r * Math.cos(a);
        g[i + 1] = r * Math.sin(a);
        g[i + 2] = zc;
    }
    const out = new Float32Array(n * n * n);
    const scale = cells / n;
    const corner = (ix, iy, iz, dx, dy, dz) => {
        const k = ((((iz % cells) * cells) + (iy % cells)) * cells + (ix % cells)) * 3;
        return g[k] * dx + g[k + 1] * dy + g[k + 2] * dz;
    };
    let o = 0;
    for (let z = 0; z < n; z += 1) {
        const fz = (z + 0.5) * scale;
        const z0 = Math.floor(fz);
        const tz = fz - z0;
        const sz = fade(tz);
        for (let y = 0; y < n; y += 1) {
            const fy = (y + 0.5) * scale;
            const y0 = Math.floor(fy);
            const ty = fy - y0;
            const sy = fade(ty);
            for (let x = 0; x < n; x += 1) {
                const fx = (x + 0.5) * scale;
                const x0 = Math.floor(fx);
                const tx = fx - x0;
                const sx = fade(tx);
                const a0 = corner(x0, y0, z0, tx, ty, tz);
                const a1 = corner(x0 + 1, y0, z0, tx - 1, ty, tz);
                const b0 = corner(x0, y0 + 1, z0, tx, ty - 1, tz);
                const b1 = corner(x0 + 1, y0 + 1, z0, tx - 1, ty - 1, tz);
                const c0 = corner(x0, y0, z0 + 1, tx, ty, tz - 1);
                const c1 = corner(x0 + 1, y0, z0 + 1, tx - 1, ty, tz - 1);
                const d0 = corner(x0, y0 + 1, z0 + 1, tx, ty - 1, tz - 1);
                const d1 = corner(x0 + 1, y0 + 1, z0 + 1, tx - 1, ty - 1, tz - 1);
                const lo = (a0 + (a1 - a0) * sx) + ((b0 + (b1 - b0) * sx) - (a0 + (a1 - a0) * sx)) * sy;
                const hi = (c0 + (c1 - c0) * sx) + ((d0 + (d1 - d0) * sx) - (c0 + (c1 - c0) * sx)) * sy;
                out[o] = (lo + (hi - lo) * sz) * 1.6;
                o += 1;
            }
        }
    }
    return out;
}

/**
 * The volume's texels.
 * @param {number} [size] texels a side
 * @param {number} [seed]
 * @returns {{ data: Uint8Array, size: number }} RGBA8, x fastest, then y, then z
 */
export function computeVerdantHillsCloudVolume(
    size = VERDANT_HILLS_CLOUD_VOLUME_SIZE,
    seed = VERDANT_HILLS_CLOUD_VOLUME_SEED,
) {
    const n = Math.max(4, Math.floor(size));
    const count = n * n * n;
    const rand = mulberry32(seed);
    const p3 = gradient(n, 3, rand);
    const p6 = gradient(n, 6, rand);
    const p12 = gradient(n, 12, rand);
    const w3 = cellular(n, 3, rand);
    const w6 = cellular(n, 6, rand);
    const w12 = cellular(n, 12, rand);
    const v4 = cellular(n, 4, rand);
    const v8 = cellular(n, 8, rand);
    const v16 = cellular(n, 16, rand);
    const channels = Array.from({ length: 4 }, () => new Float32Array(count));
    for (let i = 0; i < count; i += 1) {
        // The gradient's masses, 0..1, remapped from (worley − 1 .. 1) to (0 .. 1) by the cells'
        // fBm: what the cells leave of a mass is a heap of balls (Schneider's Perlin–Worley).
        const perlin = Math.min(1, Math.max(0, (p3[i] * 0.6 + p6[i] * 0.28 + p12[i] * 0.12) * 0.5 + 0.5));
        const worley = w3[i] * 0.625 + w6[i] * 0.25 + w12[i] * 0.125;
        channels[0][i] = (perlin + 1 - worley) / (2 - worley);
        channels[1][i] = worley;
        channels[2][i] = v4[i] * 0.625 + v8[i] * 0.25 + v16[i] * 0.125;
        channels[3][i] = perlin;
    }
    // Each channel stretched between its 1st and 99th percentile, so a threshold in the shader
    // means the same share of the volume whatever the seed.
    const data = new Uint8Array(count * 4);
    channels.forEach((channel, c) => {
        const sorted = Float32Array.from(channel).sort();
        const lo = sorted[Math.floor(count * 0.01)];
        const hi = sorted[Math.floor(count * 0.99)];
        const span = hi - lo || 1;
        for (let i = 0; i < count; i += 1) {
            data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(((channel[i] - lo) / span) * 255)));
        }
    });
    return { data, size: n };
}

/** The volume, baked once a session (shared/bake-cache.js) and READ-ONLY. */
export function bakeVerdantHillsCloudVolume(
    size = VERDANT_HILLS_CLOUD_VOLUME_SIZE,
    seed = VERDANT_HILLS_CLOUD_VOLUME_SEED,
) {
    return bakeOnce(verdantHillsCloudVolumeKey(size, seed), () => computeVerdantHillsCloudVolume(size, seed));
}
