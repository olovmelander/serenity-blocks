/* eslint-disable import/no-unresolved */

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const cacheOwner = typeof window !== 'undefined' ? window : globalThis;

if (!cacheOwner.g_OdysseyGltfCache) {
    cacheOwner.g_OdysseyGltfCache = new Map();
}

let gltfLoader = null;
let ktx2Loader = null;
let ktx2SupportDetected = false;

function getGltfLoader() {
    if (!gltfLoader) {
        gltfLoader = new GLTFLoader();

        // KTX2 (Basis-supercompressed GPU textures): stays block-compressed end-to-end —
        // ~4-6x less VRAM and no CPU decode-to-RGBA stall. Transcoder lives in
        // public/basics/basis/ (mirrors the neon-district theme's path).
        ktx2Loader = new KTX2Loader().setTranscoderPath('./basics/basis/');
        gltfLoader.setKTX2Loader(ktx2Loader);

        // Meshopt (EXT_meshopt_compression): ~3x smaller geometry + morph/animation safe
        // (unlike Draco). Decoder is inlined — no external file to host.
        gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    }
    return gltfLoader;
}

/**
 * Detect the GPU's native transcode target for KTX2 (ASTC/BC7/ETC...). MUST be called once
 * with the live renderer BEFORE loading any KTX2-encoded GLB, or the transcode fails.
 * No-op (and harmless) for the current uncompressed assets — KTX2 only activates once the
 * GLBs are re-exported to KTX2. The board's WebGPU renderer is accepted in three r181.
 * @param {*} renderer the live WebGL/WebGPU renderer
 */
export function setOdysseyGltfRenderer(renderer) {
    if (!renderer || ktx2SupportDetected) {
        return;
    }
    try {
        getGltfLoader(); // ensure ktx2Loader exists
        ktx2Loader.detectSupport(renderer);
        ktx2SupportDetected = true;
    } catch (err) {
        console.warn('[OdysseyGltf] KTX2 detectSupport failed (KTX2 assets will fail until fixed):', err?.message || err);
    }
}

export async function loadOdysseyGltfCached(url) {
    if (!url) {
        throw new Error('loadOdysseyGltfCached requires a URL');
    }

    let loadPromise = cacheOwner.g_OdysseyGltfCache.get(url);
    if (!loadPromise) {
        loadPromise = getGltfLoader().loadAsync(url).catch((err) => {
            cacheOwner.g_OdysseyGltfCache.delete(url);
            throw err;
        });
        cacheOwner.g_OdysseyGltfCache.set(url, loadPromise);
    }

    const gltf = await loadPromise;
    return {
        scene: SkeletonUtils.clone(gltf.scene),
        animations: gltf.animations || [],
        cameras: gltf.cameras || [],
        asset: gltf.asset || {},
    };
}
