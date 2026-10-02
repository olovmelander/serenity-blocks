/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Value noise from a BAKED LATTICE — one texture fetch per octave.
 *
 * WHY (seamless pass, 2026-10). The shared analytic `noise3` (odyssey-tsl-noise.js) costs
 * EIGHT `od_hash31` calls plus seven mixes per octave — ~110 ALU — and the space chapters
 * stack it: the ch6 nebula gas runs 9 octaves per fragment over 18 overlapping additive hulls,
 * the gas giant 12-19 over ~1.8x its old screen area, ch7's dome 5 over the WHOLE frame,
 * Gargantua's disk 6. That is the fill x shader product the perf audit ranked first.
 *
 * The cure is the classic value-noise lattice: bake the random lattice values ONCE into a
 * small periodic R8 Data3DTexture (64^3 = 256 KB, ~3 ms of CPU, built on first use) and let the
 * texture unit do the trilinear blend. The smooth (C1) Hermite interpolation that `noise3`
 * applies is kept EXACTLY by feeding the hardware filter a smoothstepped coordinate:
 *
 *     uvw = (floor(p) + f*f*(3 - 2f) + 0.5) / N        f = fract(p)
 *
 * which makes the bilinear weights the Hermite weights — the same function family, same
 * lattice spacing, same [0,1] value distribution as `noise3`, so every smoothstep threshold
 * tuned against the analytic noise holds. Only the particular random values differ (a new
 * seed, not a new look). Per octave: one `textureSampleLevel` + ~8 ALU.
 *
 * Drop-in: `fbm3(p, octaves, latticeNoise3)` / `ridged3(p, octaves, latticeNoise3)` — the
 * octave builders already take the noise primitive as their third argument.
 *
 * - LEVEL 0 sampling (no implicit derivatives): legal in any control flow and in the vertex
 *   stage, and there are no mips to choose between anyway.
 * - Periodic in all three axes (RepeatWrapping), period LATTICE_NOISE_PERIOD cells. The
 *   chapters' lowest octaves span a few cells, so the period is never seen; the 2.03
 *   lacunarity keeps successive octaves from re-aligning on it.
 * - One shared texture: every TextureNode hashes by texture uuid, so all call sites in a
 *   material bind the SAME texture + sampler (never one binding per octave).
 */

import * as THREE from 'three/webgpu';
import {
    float, floor, fract, texture3D, vec3,
} from 'three/tsl';

/** Lattice cells per period on each axis (also the texture's size in texels). */
export const LATTICE_NOISE_PERIOD = 64;
const LATTICE_SEED = 0x51ed27;

let latticeTexture = null;
let latticeBase = null;

// Integer bit-mix hash (the cosmic-backdrop bake's form — no sin, deterministic per seed).
function latticeHash(ix, iy, iz) {
    let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(iz, 0x9e3779b9) ^ LATTICE_SEED;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/**
 * The lattice texture (built once, on first use, never disposed — 256 KB shared by every
 * chapter that samples it).
 * @returns {THREE.Data3DTexture}
 */
export function getLatticeNoiseTexture() {
    if (latticeTexture) return latticeTexture;
    const n = LATTICE_NOISE_PERIOD;
    const data = new Uint8Array(n * n * n);
    let o = 0;
    for (let z = 0; z < n; z += 1) {
        for (let y = 0; y < n; y += 1) {
            for (let x = 0; x < n; x += 1) {
                data[o] = Math.min(255, Math.floor(latticeHash(x, y, z) * 256));
                o += 1;
            }
        }
    }
    const texture = new THREE.Data3DTexture(data, n, n, n);
    texture.name = 'odyssey-lattice-noise';
    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.wrapR = THREE.RepeatWrapping;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    latticeTexture = texture;
    return texture;
}

function getLatticeBase() {
    if (!latticeBase) latticeBase = texture3D(getLatticeNoiseTexture());
    return latticeBase;
}

/**
 * Smooth 3D value noise in [0,1] — the baked twin of `noise3` (same Hermite interpolation,
 * same lattice spacing). Pass it as the `n` argument of fbm3 / ridged3.
 * @param {*} pInput vec3 node
 * @returns {*} float node
 */
export function latticeNoise3(pInput) {
    const p = vec3(pInput);
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const uvw = i.add(u).add(0.5).div(LATTICE_NOISE_PERIOD);
    return getLatticeBase().sample(uvw).level(0).r;
}
