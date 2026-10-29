/**
 * Geode — the CPU bakes (three-free).
 *
 * The noise field and its mip chain, and the shell's vertices, are pure functions of their seed
 * and the plan. They are kept for the session (geode-bakes.js), and a first visit bakes them in a
 * module Worker (geode-bake.worker.js) while the renderer comes up: ~45 ms of main thread on every
 * Geode start before (docs/THEME_FLEET_240_2026-10.md). The texture and the mesh are made over them
 * in geode-tsl.js and geode-shell.js.
 */
import {
    CAVITY, TAU, mulberry32, wallNormal,
} from './geode-core.js';
import { buildPlan } from './geode-layout.js';
import { toHalfFloat } from '../shared/half-float.js';

export const NOISE_SEED = 4409;
export const NOISE_SIZE = 256;

/**
 * Periodic fBm gradient noise, four decorrelated channels stretched to [0, 1].
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = NOISE_SEED, size = NOISE_SIZE) {
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

/** Bilinear, wrapping read of one channel of a baked noise field (the CPU twin of a fetch). */
export function sampleNoise(field, size, x, y, channel = 0) {
    const fx = (((x % 1) + 1) % 1) * size - 0.5;
    const fy = (((y % 1) + 1) % 1) * size - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (ix, iy) => field[((((iy % size) + size) % size) * size + (((ix % size) + size) % size)) * 4 + channel];
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return top + (bottom - top) * ty;
}

/**
 * The noise field's mip chain for a half-float texture: 2 × 2 box filter down to 1 × 1 (generating
 * half-float mips on the GPU is not portable to every WebGL2 device).
 * @param {Float32Array} field  bakeNoise's
 * @returns {Array<{ data: Uint16Array, width: number, height: number }>}
 */
export function noiseMips(field, size = NOISE_SIZE) {
    const mipmaps = [];
    let level = field;
    let w = size;
    for (;;) {
        const half = new Uint16Array(level.length);
        for (let i = 0; i < level.length; i++) half[i] = toHalfFloat(level[i]);
        mipmaps.push({ data: half, width: w, height: w });
        if (w === 1) break;
        const nw = w >> 1;
        const next = new Float32Array(nw * nw * 4);
        for (let y = 0; y < nw; y++) {
            for (let x = 0; x < nw; x++) {
                const a = (y * 2 * w + x * 2) * 4;
                const b2 = a + 4;
                const c2 = a + w * 4;
                const d2 = c2 + 4;
                const o = (y * nw + x) * 4;
                for (let c = 0; c < 4; c++) {
                    next[o + c] = (level[a + c] + level[b2 + c] + level[c2 + c] + level[d2 + c]) * 0.25;
                }
            }
        }
        level = next;
        w = nw;
    }
    return mipmaps;
}

/** The plan over a noise field (geode-layout.js's buildPlan, reading the field as the GPU does). */
export function planOver(field, options) {
    return buildPlan((x, y, c) => sampleNoise(field, NOISE_SIZE, x, y, c), options);
}

// ── The shell ───────────────────────────────────────────────────────────────────

export const RINGS = 132;
export const SPOKES = 176;

/**
 * The shell's vertices over a plan: the lumpy wall's points, normals (from its two tangents,
 * turned into the cavity) and (w, φ) coordinates, and the index (16-bit when it fits, as three
 * would pick for it).
 */
export function shellArrays(plan) {
    const cols = SPOKES + 1;
    const count = (RINGS + 1) * cols;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const coords = new Float32Array(count * 2);
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const c = [0, 0, 0];
    const d = [0, 0, 0];
    const n = [0, 0, 0];
    const eps = 0.012;
    for (let i = 0; i <= RINGS; i++) {
        const w = Math.max(1e-3, (i / RINGS) * CAVITY.wMax);
        for (let j = 0; j <= SPOKES; j++) {
            const phi = (j / SPOKES) * TAU;
            const o = i * cols + j;
            plan.surface(w, phi, a);
            positions.set(a, o * 3);
            coords.set([w, phi], o * 2);
            // The lumpy surface's own normal, from its two tangents, turned into the cavity.
            plan.surface(w + eps, phi, a);
            plan.surface(Math.max(1e-3, w - eps), phi, b);
            plan.surface(w, phi + eps, c);
            plan.surface(w, phi - eps, d);
            const tw = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
            const tp = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
            let nx = tw[1] * tp[2] - tw[2] * tp[1];
            let ny = tw[2] * tp[0] - tw[0] * tp[2];
            let nz = tw[0] * tp[1] - tw[1] * tp[0];
            wallNormal(w, phi, n);
            const len = Math.hypot(nx, ny, nz);
            if (len < 1e-7) {
                [nx, ny, nz] = n;
            } else {
                const s = (nx * n[0] + ny * n[1] + nz * n[2] < 0 ? -1 : 1) / len;
                nx *= s;
                ny *= s;
                nz *= s;
            }
            normals.set([nx, ny, nz], o * 3);
        }
    }
    const indexList = [];
    for (let i = 0; i < RINGS; i++) {
        for (let j = 0; j < SPOKES; j++) {
            const p0 = i * cols + j;
            const p1 = p0 + 1;
            const p2 = p0 + cols;
            const p3 = p2 + 1;
            indexList.push(p0, p2, p1, p1, p2, p3);
        }
    }
    const index = count - 1 >= 65535 ? new Uint32Array(indexList) : new Uint16Array(indexList);
    return {
        positions, normals, coords, index,
    };
}

/** What the worker bakes for a plan's options: the noise, its mips and the shell over its plan. */
export function bakeGeodeData(options) {
    const field = bakeNoise();
    return { field, mips: noiseMips(field), shell: shellArrays(planOver(field, options)) };
}
