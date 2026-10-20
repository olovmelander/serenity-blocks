/**
 * Sunbraid — the baked noise (three-free), shared by the CPU land plan and the shaders, so a
 * height read on the CPU and the same read on the GPU agree.
 *
 * Tileable value-noise fBm, four independent fields (RGBA) at lattice periods 8, 16, 32 and 64
 * across the tile: broad, mid, fine and grain. A read at xz / D has features D / period wide.
 */
import { mulberry32 } from './sunbraid-core.js';

export const NOISE_SIZE = 256;
export const NOISE_PERIODS = Object.freeze([8, 16, 32, 64]);

export function bakeNoise(size = NOISE_SIZE, seed = 0x5b7a1d) {
    const out = new Uint8Array(size * size * 4);
    const lattices = NOISE_PERIODS.map((period, c) => {
        const random = mulberry32(seed + c * 977);
        const values = new Float32Array(period * period);
        for (let i = 0; i < values.length; i++) values[i] = random();
        return { period, values };
    });
    const fade = (t) => t * t * (3 - 2 * t);
    const valueAt = (lat, x, y) => {
        const { period, values } = lat;
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const tx = fade(x - xi);
        const ty = fade(y - yi);
        const at = (a, b) => values[(((b % period) + period) % period) * period + (((a % period) + period) % period)];
        const a = at(xi, yi);
        const b = at(xi + 1, yi);
        const c = at(xi, yi + 1);
        const d = at(xi + 1, yi + 1);
        return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            for (let c = 0; c < 4; c++) {
                let sum = 0;
                let amp = 0.5;
                let norm = 0;
                for (let o = 0; o < 4 && c + o < 4; o++) {
                    const lat = lattices[c + o];
                    sum += amp * valueAt(lat, (i / size) * lat.period, (j / size) * lat.period);
                    norm += amp;
                    amp *= 0.5;
                }
                out[(j * size + i) * 4 + c] = Math.round((sum / norm) * 255);
            }
        }
    }
    return out;
}

let cached = null;
/** The bake is deterministic: one copy per page. */
export function noiseData() {
    if (!cached) cached = bakeNoise();
    return cached;
}

/**
 * Bilinear read of channel `c` at texture coordinates (u, v) with repeat wrapping, 0..1 — the
 * same value a LinearFilter sampler returns at mip 0 (texel centres at (i + 0.5) / size).
 */
export function noiseAt(u, v, c = 0, data = noiseData(), size = NOISE_SIZE) {
    const x = u * size - 0.5;
    const y = v * size - 0.5;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = x - xi;
    const ty = y - yi;
    const wrap = (i) => ((i % size) + size) % size;
    const x0 = wrap(xi);
    const x1 = wrap(xi + 1);
    const y0 = wrap(yi);
    const y1 = wrap(yi + 1);
    const at = (a, b) => data[(b * size + a) * 4 + c] / 255;
    const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
    const bot = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
    return top * (1 - ty) + bot * ty;
}
