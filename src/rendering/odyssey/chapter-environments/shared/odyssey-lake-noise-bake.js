/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Earth Core lava lake — baked noise texture + TSL sampler (three side).
 * The bake math lives in odyssey-lake-noise-math.js (re-exported here); the Worker entry is
 * lake-noise.worker.js. Design: docs/ODYSSEY_EARTH_CORE_LAVA_LAKE_REMAKE_2026-08.md §2.2–2.5.
 */

import * as THREE from 'three/webgpu';
import { texture3D, vec3 } from 'three/tsl';
import {
    LAKE_BAKE_K, LAKE_BAKE_RES, bakeLakeNoise, lakeNoisePeriod,
} from './odyssey-lake-noise-math.js';

export * from './odyssey-lake-noise-math.js';

/**
 * Wrap baked data in a Data3DTexture configured for the sampler: R16F, linear, repeat on all
 * three axes, no mips (r185 generates none for 3D textures; the analytic field is unfiltered too).
 * @param {Uint16Array} data half floats, x fastest
 * @param {number} res
 * @param {number} [periodP] the field's period in p-units (stored in userData for the sampler)
 */
export function buildLakeNoise3D(data, res, periodP = lakeNoisePeriod()) {
    const tex = new THREE.Data3DTexture(data, res, res, res);
    tex.format = THREE.RedFormat;
    tex.type = THREE.HalfFloatType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.wrapR = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    tex.userData.periodP = periodP;
    tex.userData.lakeNoiseBake = true;
    return tex;
}

/**
 * TSL noise source with `snoise3`'s signature: `(p) => float`, p in the chapter's units.
 *
 * The slice shear (`epsX`, `epsZ`): every lake field samples the y≈0 slice of the tile, so without
 * it the field repeats exactly every `periodP / scale` along x and z (the 100 u hot-spot pitch was
 * the salient one). Tilting the sampled slice by a few degrees puts consecutive x-periods on
 * different y-slices; the repeat distance becomes `periodP / eps` — ≈ 254 p-units, i.e. ≥ 500 u for
 * every lake field. Two incommensurate epsilons so the x/z re-alignment lands beyond the plane. The
 * marginal is unchanged (isotropic field; in-plane metric stretch 0.25 %), and the shear is linear
 * so it commutes with fbm's octave scaling — one closure serves every call.
 *
 * @param {THREE.Data3DTexture} tex from buildLakeNoise3D
 * @param {{periodP?: number, epsX?: number, epsZ?: number}} [options]
 * @returns {(p: any) => any} TSL node factory
 */
export function makeLakeNoiseSampler(tex, options = {}) {
    const { periodP = tex?.userData?.periodP ?? lakeNoisePeriod(), epsX = 0.071, epsZ = 0.053 } = options;
    const invL = 1 / periodP;
    return (pInput) => {
        const p = vec3(pInput);
        const sheared = vec3(p.x, p.y.add(p.x.mul(epsX)).add(p.z.mul(epsZ)), p.z);
        // No fract(): RepeatWrapping on S/T/R handles the wrap and keeps derivatives continuous.
        return texture3D(tex, sheared.mul(invL)).r;
    };
}

// ── Loader: Worker first, main thread as the fallback, one texture per process ──────────────

let _bakePromise = null;
let _lakeTexture = null;

/**
 * Start (or join) the bake. Runs in a module Worker when the platform has one; otherwise — vitest,
 * or a Worker that fails to start — bakes synchronously on the caller's thread.
 * @param {{res?: number, k?: number}} [options]
 * @returns {Promise<{data: Uint16Array, res: number, k: number, periodP: number, crc32: number, stats: object, viaWorker: boolean}>}
 */
export function startLakeNoiseBake(options = {}) {
    if (_bakePromise) return _bakePromise;
    const opts = { res: options.res ?? LAKE_BAKE_RES, k: options.k ?? LAKE_BAKE_K };
    _bakePromise = new Promise((resolve) => {
        if (typeof Worker === 'undefined') { resolve(null); return; }
        let worker = null;
        try {
            worker = new Worker(new URL('./lake-noise.worker.js', import.meta.url), { type: 'module' });
        } catch { resolve(null); return; }
        worker.onmessage = (event) => {
            worker.terminate();
            const msg = event?.data;
            resolve(msg?.ok ? { ...msg, viaWorker: true } : null);
        };
        worker.onerror = () => { worker.terminate(); resolve(null); };
        worker.postMessage(opts);
    }).then((result) => result ?? { ...bakeLakeNoise(opts), viaWorker: false });
    return _bakePromise;
}

/**
 * The lake's shared noise texture — created immediately at its final size (zeros) so a material
 * can bind it before the bake lands; filled in place and re-uploaded (`needsUpdate`) when the bake
 * resolves. `userData.ready` tells the perf manifest whether the first frame saw real data
 * (design §2.5 step 5: `lakeBakeReadyBeforeBuild`). Never put this texture in a chapter group's
 * `ownedTextures`: it is a process-level singleton like `_bakedNoiseTex`.
 * @param {{res?: number, k?: number}} [options]
 * @returns {THREE.Data3DTexture}
 */
export function getLakeNoiseTexture(options = {}) {
    if (_lakeTexture) return _lakeTexture;
    const res = options.res ?? LAKE_BAKE_RES;
    const k = options.k ?? LAKE_BAKE_K;
    const tex = buildLakeNoise3D(new Uint16Array(res * res * res), res, lakeNoisePeriod(k));
    tex.userData.ready = false;
    _lakeTexture = tex;
    startLakeNoiseBake({ res, k }).then((result) => {
        if (_lakeTexture !== tex) return; // disposed/reset meanwhile
        tex.image.data.set(result.data);
        tex.userData.ready = true;
        tex.userData.crc32 = result.crc32;
        tex.userData.viaWorker = result.viaWorker;
        tex.needsUpdate = true; // version bump → re-upload; size unchanged, no descriptor rebuild
    });
    return tex;
}

/** Test/teardown hook: forget the singleton (does not dispose GPU resources). */
export function resetLakeNoiseTextureForTests() {
    _lakeTexture = null;
    _bakePromise = null;
}
