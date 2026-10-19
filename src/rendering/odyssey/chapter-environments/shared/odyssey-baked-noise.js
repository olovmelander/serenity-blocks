/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Tileable 3D gradient-noise baked into a Data3DTexture — the compile-cost
 * "bake" for chapters whose `snoise3` (`mx_noise_float`, ~50 ALU) dominates cold WebGPU
 * pipeline compile. Replacing each analytic noise eval with one `texture3D()` fetch trims
 * the shader instruction count (see docs/ODYSSEY_AAA_PERF_FINDINGS_2026-07.md §6b).
 *
 * DEFAULT-OFF / experimental: only built when a chapter's bake flag is on. Kept as a
 * standalone helper (proven in src/playground/effects/earth-core-lava-bake.effect.js) so
 * a chapter can opt in behind a flag and be A/B'd in-scene before anything ships.
 *
 * Gradient (Perlin) noise — matches `mx_noise_float`'s ~centred [-1,1] distribution so the
 * consuming field's smoothstep thresholds behave; Float32 (no 8-bit contour banding);
 * periodic gradients so the texture tiles seamlessly. SINGLE channel (Red): the consuming
 * field decorrelates its layers by sampling at different world offsets, so one field is
 * enough — building 3 channels was ~3x wasted gen (samplers only ever read `.r`).
 */

import * as THREE from 'three/webgpu';

// Perlin's classic 12 edge-midpoint gradients — well-distributed / isotropic.
const GRADS = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * The noise field's texels (single channel, [0,1]) — three-free, so a worker or a test can run it.
 *
 * TABLE-DRIVEN (2026-10-19). This was a closure per lattice corner per texel: 8 hashes, 8 closure
 * calls and 24 modulos for each of 96^3 texels, ~210 ms on the main thread at the first Odyssey
 * entry (profiled on the dev laptop, inside the board's load). The lattice has only grid^3
 * corners, and a texel's cell, fraction and fade depend on one axis each, so all of those are
 * computed once; the per-texel arithmetic is unchanged and in the same order, so every value is
 * bit-identical (tests/unit/odyssey-baked-noise.test.js keeps the old loop as its reference).
 * @param {number} res texels per axis @param {number} grid lattice cells per axis @param {number} seed
 * @returns {Float32Array} res^3 values, x fastest
 */
export function bakeTileableNoise3DData(res = 96, grid = 20, seed = 1337) {
    const hash = (x, y, z, s) => {
        const xi = ((x % grid) + grid) % grid;
        const yi = ((y % grid) + grid) % grid;
        const zi = ((z % grid) + grid) % grid;
        let h = (xi * 374761393 + yi * 668265263 + zi * 2147483647 + s * 40503);
        h = (h ^ (h >>> 13)) * 1274126177;
        return ((h ^ (h >>> 16)) >>> 0) % 12;
    };
    // Gradient of every lattice corner, once.
    const gx = new Float64Array(grid * grid * grid);
    const gy = new Float64Array(grid * grid * grid);
    const gz = new Float64Array(grid * grid * grid);
    for (let z = 0; z < grid; z += 1) {
        for (let y = 0; y < grid; y += 1) {
            for (let x = 0; x < grid; x += 1) {
                const g = GRADS[hash(x, y, z, seed)];
                const i = (z * grid + y) * grid + x;
                gx[i] = g[0]; gy[i] = g[1]; gz[i] = g[2];
            }
        }
    }
    // Per axis: the texel's lattice cell (and its wrapped neighbour), fraction and fade.
    const c0 = new Int32Array(res);
    const c1 = new Int32Array(res);
    const fr = new Float64Array(res);
    const fd = new Float64Array(res);
    for (let i = 0; i < res; i += 1) {
        const p = (i / res) * grid;
        const P = Math.floor(p);
        c0[i] = ((P % grid) + grid) % grid;
        c1[i] = (((P + 1) % grid) + grid) % grid;
        fr[i] = p - P;
        fd[i] = fade(p - P);
    }
    const dot = (i, dx, dy, dz) => gx[i] * dx + gy[i] * dy + gz[i] * dz;

    const data = new Float32Array(res * res * res); // single channel (Red)
    let off = 0;
    for (let z = 0; z < res; z += 1) {
        const fz = fr[z]; const w = fd[z];
        const z0 = c0[z] * grid * grid; const z1 = c1[z] * grid * grid;
        for (let y = 0; y < res; y += 1) {
            const fy = fr[y]; const v = fd[y];
            const y0 = c0[y] * grid; const y1 = c1[y] * grid;
            for (let x = 0; x < res; x += 1) {
                const fx = fr[x]; const u = fd[x];
                const x0 = c0[x]; const x1 = c1[x];
                const x00 = lerp(dot(z0 + y0 + x0, fx, fy, fz), dot(z0 + y0 + x1, fx - 1, fy, fz), u);
                const x10 = lerp(dot(z0 + y1 + x0, fx, fy - 1, fz), dot(z0 + y1 + x1, fx - 1, fy - 1, fz), u);
                const x01 = lerp(dot(z1 + y0 + x0, fx, fy, fz - 1), dot(z1 + y0 + x1, fx - 1, fy, fz - 1), u);
                const x11 = lerp(dot(z1 + y1 + x0, fx, fy - 1, fz - 1), dot(z1 + y1 + x1, fx - 1, fy - 1, fz - 1), u);
                const n = lerp(lerp(x00, x10, v), lerp(x01, x11, v), w); // ~[-1,1] (|g|=√2)
                data[off] = n * 0.5 + 0.5; // store [0,1]; shader restores [-1,1]
                off += 1;
            }
        }
    }
    return data;
}

/**
 * Build a tileable 3D Perlin-noise `Data3DTexture` (Float32, single Red channel).
 * @param {number} res texels per axis
 * @param {number} grid lattice cells per axis (features across the texture)
 * @param {number} period world units per full texture period (tiling); features/unit = grid/period
 * @param {number} seed
 * @returns {THREE.Data3DTexture} (userData.gridPeriodUnits = period)
 */
export function buildTileableNoise3D(res = 96, grid = 20, period = 10, seed = 1337) {
    const data = bakeTileableNoise3DData(res, grid, seed);
    const tex = new THREE.Data3DTexture(data, res, res, res);
    tex.format = THREE.RedFormat;
    tex.type = THREE.FloatType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.wrapR = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    tex.userData.gridPeriodUnits = period;
    return tex;
}
