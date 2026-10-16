/**
 * Supernova — the 3D noise bake (CPU only, three-free).
 *
 * Four periodic gradient-noise fields, a pure function of the seed and size (0.13 s of main thread,
 * play-feel probe 2026-10-16), kept in the shared bake cache (read-only: the texture's bytes). A
 * first visit bakes it in a module Worker (supernova-bake.worker.js, started by supernova-bakes.js)
 * while the renderer comes up. The texture is made in supernova-tsl.js.
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
