/**
 * Fluid Dreams — shared TSL building blocks and the one baked noise texture.
 *
 * Rules (from the fleet's perf sweeps):
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable half-float texture baked on the CPU, hashes are hash-without-sine;
 *  - helpers with `setLayout` are pure (no uniforms, no textures captured), so they are emitted
 *    once as real shader functions;
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    dot,
    float,
    fract,
    max,
    vec3,
} from 'three/tsl';

import { TAU, mulberry32 } from './fluid-dreams-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const fdHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'fd_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const fdHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'fd_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → vec3 in [0,1) */
export const fdHash33 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(pIn.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}).setLayout({ name: 'fd_hash33', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const fdLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const fdMax3 = (c) => max(c.x, max(c.y, c.z));

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/** The slope channels store d(height)/d(texel) · NOISE_SLOPE_GAIN + 0.5. */
export const NOISE_SLOPE_GAIN = 0.5;

/** One periodic fBm gradient-noise field over an n × n tile, not normalised. */
function fbmField(rand, n, firstPeriod, octaves, gain) {
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    let amp = 1;
    for (let o = 0; o < octaves; o += 1) {
        const period = firstPeriod << o;
        const gx = new Float32Array(period * period);
        const gy = new Float32Array(period * period);
        for (let i = 0; i < gx.length; i += 1) {
            const a = rand() * TAU;
            gx[i] = Math.cos(a);
            gy[i] = Math.sin(a);
        }
        const scale = period / n;
        for (let y = 0; y < n; y += 1) {
            const fy = y * scale;
            const y0 = Math.floor(fy);
            const ty = fy - y0;
            const y1 = (y0 + 1) % period;
            const sy = fade(ty);
            for (let x = 0; x < n; x += 1) {
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
        amp *= gain;
    }
    return field;
}

function stretch(field) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < field.length; i += 1) {
        if (field[i] < lo) lo = field[i];
        if (field[i] > hi) hi = field[i];
    }
    const inv = 1 / Math.max(1e-6, hi - lo);
    for (let i = 0; i < field.length; i += 1) field[i] = (field[i] - lo) * inv;
    return field;
}

/**
 * The theme's one noise tile, four channels in [0, 1]:
 *   R  ripple height (fine fBm)
 *   G  its slope along x, B its slope along y (unit-peak, stored · NOISE_SLOPE_GAIN + 0.5)
 *   A  ink (broad, billowing fBm, decorrelated from R)
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = 4129, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const ripple = stretch(fbmField(rand, n, 8, 4, 0.55));
    const ink = stretch(fbmField(rand, n, 3, 5, 0.52));
    const out = new Float32Array(n * n * 4);
    let peak = 1e-6;
    const sx = new Float32Array(n * n);
    const sy = new Float32Array(n * n);
    for (let y = 0; y < n; y += 1) {
        const yp = ((y + 1) % n) * n;
        const ym = ((y + n - 1) % n) * n;
        for (let x = 0; x < n; x += 1) {
            const xp = (x + 1) % n;
            const xm = (x + n - 1) % n;
            const i = y * n + x;
            sx[i] = (ripple[y * n + xp] - ripple[y * n + xm]) * 0.5;
            sy[i] = (ripple[yp + x] - ripple[ym + x]) * 0.5;
            peak = Math.max(peak, Math.abs(sx[i]), Math.abs(sy[i]));
        }
    }
    for (let i = 0; i < n * n; i += 1) {
        out[i * 4] = ripple[i];
        out[i * 4 + 1] = (sx[i] / peak) * NOISE_SLOPE_GAIN + 0.5;
        out[i * 4 + 2] = (sy[i] / peak) * NOISE_SLOPE_GAIN + 0.5;
        out[i * 4 + 3] = ink[i];
    }
    return out;
}

/**
 * The noise field as a tileable half-float texture with a CPU-built mip chain (the sea reads it
 * at grazing angles; generating half-float mips on the GPU is not portable to every WebGL2 device).
 */
export function createNoiseTexture(field, size = NOISE_SIZE) {
    const mipmaps = [];
    let level = field;
    let w = size;
    for (;;) {
        const half = new Uint16Array(level.length);
        for (let i = 0; i < level.length; i += 1) half[i] = THREE.DataUtils.toHalfFloat(level[i]);
        mipmaps.push({ data: half, width: w, height: w });
        if (w === 1) break;
        const nw = w >> 1;
        const next = new Float32Array(nw * nw * 4);
        for (let y = 0; y < nw; y += 1) {
            for (let x = 0; x < nw; x += 1) {
                const a = (y * 2 * w + x * 2) * 4;
                const b = a + 4;
                const c = a + w * 4;
                const d = c + 4;
                const o = (y * nw + x) * 4;
                for (let ch = 0; ch < 4; ch += 1) {
                    next[o + ch] = (level[a + ch] + level[b + ch] + level[c + ch] + level[d + ch]) * 0.25;
                }
            }
        }
        level = next;
        w = nw;
    }
    const tex = new THREE.DataTexture(mipmaps[0].data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mipmaps = mipmaps;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'fluid-dreams-noise';
    tex.needsUpdate = true;
    return tex;
}
