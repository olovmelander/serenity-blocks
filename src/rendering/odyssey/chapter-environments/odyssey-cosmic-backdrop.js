/**
 * @fileoverview Ch6 baked cosmic backdrop — the Wave 2 dome swap
 * (docs/ODYSSEY_CH6_SPACE_OVERHAUL_PLAN_2026-08.md §5 Wave 2).
 *
 * WHY A BAKE. Wave 0 measured the incumbent FBM void dome at **13.37 ms of the
 * station's 17.04 ms Lane B frame (78%)** — and it owns the frame tail too (p95
 * 26.35 → 3.80 with the dome removed). The dome evaluates ~15 value-noise fields per
 * fragment, full-screen, every frame, for a backdrop that changes glacially
 * (time*0.01 drift). This is the Act I backdrop-dome whale in a different chapter,
 * and it gets the same cure: terrain-shaped math the CPU can express belongs in a
 * BAKE, never in the per-frame graph (the One World codegen-bomb rule).
 *
 * WHAT IS BAKED. A seeded equirect field texture (512x256 RGBA8) holding the
 * POSTERIZED painted cosmos — the Wave 0 probe's band language applied to the
 * incumbent's deep-space palette: near-black indigo floor (never RGB-zero — the
 * 8-bit floor is asserted by test), warm indigo/magenta pockets, a separate cool
 * cobalt/teal body, and rust filaments concentrated along the galactic lane. Star
 * tiers are NOT baked: the instanced quad tiers measured 0.00 ms in Wave 0 and keep
 * their own earlier reveal window (stars ignite before the dome), so baking them
 * would cost the staging and save nothing.
 *
 * Longitude wraps seamlessly BY CONSTRUCTION (the field is a function of the 3D
 * direction, not of uv), and the texture uses RepeatWrapping in S so bilinear
 * filtering also blends across the seam texel pair — the Act II bake-tiling trap
 * (texel 255 must meet texel 0, not a phantom 256) is asserted by test.
 *
 * The per-frame material cost after the swap is one texture fetch plus the energy
 * multiply — the drift that used to ride the noise lattice is now a slow seamless
 * uv scroll.
 */

import * as THREE from 'three/webgpu';
import {
    dot, float, mix, texture as textureNode, uniform, uv, vec3,
} from 'three/tsl';

import {
    COSMIC_BACKDROP_DEFAULTS, GALACTIC_BAND_AXIS, bakeCosmicBackdropRows,
} from './odyssey-cosmic-backdrop-bake.js';

// The bake math lives in odyssey-cosmic-backdrop-bake.js (three-free, so a Worker can run it).
export { COSMIC_BACKDROP_DEFAULTS, GALACTIC_BAND_AXIS };

/**
 * Bake the painted-cosmos field into an equirect RGBA8 DataTexture.
 *
 * @returns {{ texture: THREE.DataTexture, data: Uint8Array, width: number,
 *             height: number, bakeMs: number }}
 */
export function bakeCosmicBackdropTexture(options = {}) {
    const o = { ...COSMIC_BACKDROP_DEFAULTS, ...options };
    const t0 = performance.now();
    const data = new Uint8Array(o.width * o.height * 4);
    bakeCosmicBackdropRows(data, o, 0, o.height);
    return {
        texture: makeBackdropTexture(data, o.width, o.height),
        data,
        width: o.width,
        height: o.height,
        bakeMs: performance.now() - t0,
    };
}

/** @param {Uint8Array} data @param {number} width @param {number} height */
function makeBackdropTexture(data, width, height) {
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    // RepeatWrapping in S so bilinear filtering blends the longitude seam's texel
    // pair (255 ↔ 0) instead of clamping — the Act II bake-tiling lesson.
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

/** Finished bakes, by their options: the board is rebuilt across a session, the sky never changes. */
const BAKED_SKIES = new Map();
const bakeKey = (o) => JSON.stringify([o.width, o.height, o.seed, o.floorBottom, o.floorTop, o.bandAxis]);
const nextTask = () => new Promise((resolve) => { setTimeout(resolve, 0); });
/** Worker bakes in flight, by key: two domes asking for one sky share one bake. */
const WORKER_BAKES = new Map();

/**
 * Bake the field in a module Worker (odyssey-cosmic-backdrop.worker.js). Sliced on the page, the
 * bake still cost the map its frames for ~0.5-0.9 s right after the reveal at Extreme (measured
 * 2026-10-19, dev laptop): 4 ms slices between timer ticks leave too little of a 7.6 ms frame.
 * Resolves the RGBA8 bytes, or null without a Worker (tests) or when it fails — the caller then
 * bakes on the page as before. Byte-identical: the worker runs the same rows function.
 * @param {object} o resolved options @param {string} key
 * @returns {?Promise<?Uint8Array>}
 */
function bakeInBackdropWorker(o, key) {
    if (typeof Worker === 'undefined') return null;
    const inFlight = WORKER_BAKES.get(key);
    if (inFlight) return inFlight;
    let worker = null;
    try {
        worker = new Worker(new URL('./odyssey-cosmic-backdrop.worker.js', import.meta.url), { type: 'module' });
    } catch {
        return null;
    }
    const expected = o.width * o.height * 4;
    const promise = new Promise((resolve) => {
        const finish = (value) => {
            try { worker.terminate(); } catch { /* already gone */ }
            resolve(value);
        };
        worker.onmessage = (event) => {
            const { ok, value } = event?.data || {};
            finish(ok && value instanceof Uint8Array && value.length === expected ? value : null);
        };
        worker.onerror = () => finish(null);
        worker.postMessage({
            id: 0,
            options: {
                width: o.width,
                height: o.height,
                seed: o.seed,
                floorBottom: [...o.floorBottom],
                floorTop: [...o.floorTop],
                bandAxis: [...o.bandAxis],
            },
        });
    });
    WORKER_BAKES.set(key, promise);
    promise.then(() => WORKER_BAKES.delete(key));
    return promise;
}

/**
 * The bake WITHOUT THE FREEZE (Odyssey audit 2026-10-18). Baked in one go it held the main
 * thread ~450 ms (measured on the dev machine) every time chapter 6 was created — by the
 * background loader ~2.6 s after the map appeared, by the boundary preload mid-scroll, or by a
 * navigator flight. Now `create()` returns at once with the floor gradient and the field bakes
 * in ~`sliceMs` slices between frames, uploading once when done; a finished bake is kept for
 * the session, so a rebuilt board is instant. Byte-identical to the one-shot bake.
 * @param {object} [options] COSMIC_BACKDROP_DEFAULTS overrides
 * @param {{ sliceMs?: number }} [schedule]
 * @returns {{ texture: THREE.DataTexture, data: Uint8Array, ready: Promise<THREE.DataTexture|null>,
 *   cached: boolean }}
 */
export function bakeCosmicBackdropTextureSliced(options = {}, { sliceMs = 4 } = {}) {
    const o = { ...COSMIC_BACKDROP_DEFAULTS, ...options };
    const data = new Uint8Array(o.width * o.height * 4);
    const texture = makeBackdropTexture(data, o.width, o.height);
    const key = bakeKey(o);
    const done = BAKED_SKIES.get(key);
    if (done) {
        data.set(done);
        return {
            texture, data, ready: Promise.resolve(texture), cached: true,
        };
    }
    // Until the field lands the dome wears its own floor: the void's gradient, never black.
    for (let iy = 0; iy < o.height; iy += 1) {
        const h = ((iy + 0.5) / o.height) ** 1.4;
        const c = [0, 1, 2].map((k) => Math.round((o.floorBottom[k] + ((o.floorTop[k] - o.floorBottom[k]) * h)) * 255));
        for (let ix = 0; ix < o.width; ix += 1) {
            const i = ((iy * o.width) + ix) * 4;
            data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
        }
    }
    let cancelled = false;
    texture.addEventListener('dispose', () => { cancelled = true; });
    const ready = (async () => {
        const fromWorker = await bakeInBackdropWorker(o, key);
        if (fromWorker) {
            BAKED_SKIES.set(key, fromWorker);
            if (cancelled) return null;
            data.set(fromWorker);
            texture.needsUpdate = true;
            return texture;
        }
        if (cancelled) return null;
        const work = new Uint8Array(data.length);
        for (let y = 0; y < o.height;) {
            if (cancelled) return null;
            const t0 = performance.now();
            while (y < o.height && performance.now() - t0 < sliceMs) {
                bakeCosmicBackdropRows(work, o, y, y + 1);
                y += 1;
            }
            // Yielding between slices is the point: the frame runs between them.
            // eslint-disable-next-line no-await-in-loop
            if (y < o.height) await nextTask();
        }
        BAKED_SKIES.set(key, work);
        if (cancelled) return null;
        data.set(work);
        texture.needsUpdate = true;
        return texture;
    })();
    return {
        texture, data, ready, cached: false,
    };
}

/**
 * The baked void dome — same contract as the retired FBM dome (BackSide sphere 2400,
 * renderOrder −100, depthWrite off, opacity driven by uVoidSkyOpacity, energy
 * breathing) with the field read from the bake. The sky does not drift (see below).
 */
// eslint-disable-next-line no-unused-vars -- uTime stays in the signature for callers
export function createBakedVoidSkyTSL(uTime, uEnergy, uOpacity = uniform(1), bakeOptions = {}) {
    const energy = uEnergy ?? uniform(0.3);
    const bake = bakeCosmicBackdropTextureSliced(bakeOptions);

    const material = new THREE.MeshBasicNodeMaterial();
    // NO DRIFT (2026-10-03). The dome used to scroll at uv + time * 0.0004 (0.14 deg/s on the
    // manager's clock): the glow slid away from the star band it belongs under, so where the
    // Milky Way sat depended on how long the session had been running. The sky is fixed now
    // (`uTime` stays in the signature for callers and is unused).
    const drift = uv();
    // §3b rule 4 (three grayscale value bands): the dome must sit ONE BAND BELOW the
    // sculpted masses or depth collapses. RE-TUNED 2026-08-16 against a GROUND-TRUTH
    // capture (real board, real grade): 0.62 alone was measured too hot — the game's
    // post stack lifts saturation twice over a black crush, so the baked pockets came
    // back as vivid magenta competing with the masses in both value AND chroma, which
    // the flat NoToneMapping rig cannot show. Now dimmer AND desaturated toward its
    // own luma, so the backdrop reads as depth rather than as a rival subject.
    const baked = textureNode(bake.texture, drift).rgb.mul(energy.mul(0.5).add(0.7));
    const bakedLuma = dot(baked, vec3(0.2126, 0.7152, 0.0722));
    // Desaturation 0.34 -> 0.16 (2026-10-03): the Milky Way keeps its blue-and-gold.
    material.colorNode = mix(baked, vec3(bakedLuma), float(0.16)).mul(0.45);
    material.opacityNode = uOpacity;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.transparent = true;

    const geometry = new THREE.SphereGeometry(2400, 64, 48);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'void-sky-baked';
    mesh.renderOrder = -100;
    // The field lands a few hundred ms later, in slices between frames (see the sliced bake).
    const bakeStart = performance.now();
    mesh.userData.bakeMs = 0;
    mesh.userData.bakeReady = bake.ready.then((tex) => {
        mesh.userData.bakeMs = bake.cached ? 0 : performance.now() - bakeStart;
        return tex;
    });
    return {
        mesh, material, geometry, texture: bake.texture, ready: mesh.userData.bakeReady,
    };
}
