/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Earth Core lava lake — baked noise texture + TSL sampler (three side).
 * The bake math lives in odyssey-lake-noise-math.js (re-exported here); the Worker entry is
 * lake-noise.worker.js. Design: docs/ODYSSEY_EARTH_CORE_LAVA_LAKE_REMAKE_2026-08.md §2.2–2.5.
 */

import * as THREE from 'three/webgpu';
import { texture3D, vec3 } from 'three/tsl';
import { keepOdysseyTexture } from './odyssey-resident-textures.js';
import {
    LAKE_BAKE_K, LAKE_BAKE_RES, bakeLakeNoise, lakeNoisePeriod,
} from './odyssey-lake-noise-math.js';
import {
    readStoredLakeBake, storeLakeBake, worldBakeStoreAvailable,
} from '../../world/odyssey-world-bake-store.js';

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

/**
 * Whether the lake samples this bake (default ON since 2026-08-21): `?earthCoreLakeBake=0` (dev
 * URL) or `localStorage['serenity.earthCoreLakeBake'] = '0'` (packaged Electron) keep it analytic,
 * `?earthCoreLakeBake=1` wins over the stored value. Off without a window (node builds).
 * @returns {boolean}
 */
export function lakeNoiseBakeEnabled() {
    if (typeof window === 'undefined') return false;
    try {
        const url = new URLSearchParams(window.location.search).get('earthCoreLakeBake');
        const ls = window.localStorage && window.localStorage.getItem('serenity.earthCoreLakeBake');
        return !(url === '0' || (url !== '1' && ls === '0'));
    } catch {
        return true; // URL/localStorage unavailable: the default
    }
}

// ── Loader: the kept copy, else a Worker, else the main thread; one texture per process ───────

let _bakePromise = null;
let _lakeTexture = null;

/**
 * What a kept copy is valid for: this build's code (a production chunk's URL names its content
 * hash, as the world bake's key does) and the bake's size. Development builds keep nothing: their
 * module URLs do not change with the code.
 */
let STORE_FINGERPRINT = null;
try {
    STORE_FINGERPRINT = import.meta.env?.PROD === true ? String(import.meta.url) : null;
} catch { /* no import.meta.env: not a Vite build */ }

/** `?odysseyNoBakeCache=1` bakes afresh and keeps nothing, as it does for the world's bake. */
function bakeCacheDisabled() {
    try {
        const value = new URLSearchParams(globalThis.location?.search || '').get('odysseyNoBakeCache');
        return value === '1' || value === 'true';
    } catch {
        return false;
    }
}

/** @param {{res: number, k: number}} opts @returns {?string} */
function lakeStoreKey(opts) {
    if (!STORE_FINGERPRINT || !worldBakeStoreAvailable() || bakeCacheDisabled()) return null;
    return JSON.stringify(['lake', opts.res, opts.k, STORE_FINGERPRINT]);
}

/** A write-back the page does when it is idle (never on the bake's way to the lake). */
function whenPageIdle(run) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 });
    else setTimeout(run, 0);
}

function bakeInWorker(opts) {
    return new Promise((resolve) => {
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
    });
}

/**
 * Start (or join) the bake. A production build first reads the copy a previous launch kept (perf
 * audit 2026-10-28: the bake is as heavy as the whole world's, and ran on every launch); otherwise
 * it runs in a module Worker when the platform has one, or — vitest, or a Worker that fails to
 * start — synchronously on the caller's thread, and is kept for the next launch.
 * @param {{res?: number, k?: number}} [options]
 * @param {{storeKey?: ?string, bake?: Function, idle?: Function, indexedDB?: IDBFactory,
 *   connection?: object}} [env] tests: the store's key (null keeps nothing), the bake, the idle
 *   scheduler and the database
 * @returns {Promise<{data: Uint16Array, res: number, k: number, periodP: number, crc32: number, stats?: object, viaWorker: boolean, kept?: boolean}>}
 */
export function startLakeNoiseBake(options = {}, env = {}) {
    if (_bakePromise) return _bakePromise;
    const opts = { res: options.res ?? LAKE_BAKE_RES, k: options.k ?? LAKE_BAKE_K };
    const key = env.storeKey !== undefined ? env.storeKey : lakeStoreKey(opts);
    const bake = env.bake ?? (async (o) => (await bakeInWorker(o)) ?? { ...bakeLakeNoise(o), viaWorker: false });
    const idle = env.idle ?? whenPageIdle;
    const db = { indexedDB: env.indexedDB, connection: env.connection };
    _bakePromise = (async () => {
        const kept = key ? await readStoredLakeBake(key, opts, db) : null;
        if (kept) return { ...kept, viaWorker: false, kept: true };
        const result = await bake(opts);
        if (key) idle(() => { storeLakeBake(key, result, db); });
        return result;
    })();
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
    _lakeTexture = keepOdysseyTexture(tex);
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
