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
 * periodic gradients so the texture tiles seamlessly; RGB carry three decorrelated fields.
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
 * Build a tileable 3D Perlin-noise `Data3DTexture` (Float32, RGB = 3 decorrelated fields).
 * @param {number} res texels per axis
 * @param {number} grid lattice cells per axis (features across the texture)
 * @param {number} period world units per full texture period (tiling); features/unit = grid/period
 * @param {number} seed
 * @returns {THREE.Data3DTexture} (userData.gridPeriodUnits = period)
 */
export function buildTileableNoise3D(res = 96, grid = 20, period = 10, seed = 1337) {
    const hash = (x, y, z, s) => {
        const xi = ((x % grid) + grid) % grid;
        const yi = ((y % grid) + grid) % grid;
        const zi = ((z % grid) + grid) % grid;
        let h = (xi * 374761393 + yi * 668265263 + zi * 2147483647 + s * 40503);
        h = (h ^ (h >>> 13)) * 1274126177;
        return ((h ^ (h >>> 16)) >>> 0) % 12;
    };
    const dotg = (gi, dx, dy, dz) => GRADS[gi][0] * dx + GRADS[gi][1] * dy + GRADS[gi][2] * dz;
    const perlin = (x, y, z, s) => {
        const X = Math.floor(x); const Y = Math.floor(y); const Z = Math.floor(z);
        const fx = x - X; const fy = y - Y; const fz = z - Z;
        const u = fade(fx); const v = fade(fy); const w = fade(fz);
        const g = (ox, oy, oz) => dotg(hash(X + ox, Y + oy, Z + oz, s), fx - ox, fy - oy, fz - oz);
        const x00 = lerp(g(0, 0, 0), g(1, 0, 0), u);
        const x10 = lerp(g(0, 1, 0), g(1, 1, 0), u);
        const x01 = lerp(g(0, 0, 1), g(1, 0, 1), u);
        const x11 = lerp(g(0, 1, 1), g(1, 1, 1), u);
        return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w); // ~[-1,1] (|g|=√2)
    };

    const data = new Float32Array(res * res * res * 4);
    const seeds = [seed, seed + 9173, seed + 51001];
    let off = 0;
    for (let z = 0; z < res; z += 1) {
        for (let y = 0; y < res; y += 1) {
            for (let x = 0; x < res; x += 1) {
                for (let c = 0; c < 3; c += 1) {
                    const s = seeds[c];
                    const ox = (s % 7); const oy = (s % 13); const oz = (s % 5);
                    const n = perlin((x / res) * grid + ox, (y / res) * grid + oy, (z / res) * grid + oz, s);
                    data[off + c] = n * 0.5 + 0.5; // store [0,1]; shader restores [-1,1]
                }
                data[off + 3] = 1.0;
                off += 4;
            }
        }
    }
    const tex = new THREE.Data3DTexture(data, res, res, res);
    tex.format = THREE.RGBAFormat;
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
