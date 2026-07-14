import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Global cache map to store loaded raw GLTF structures in-memory.
// Placed on window so it persists across theme switches/re-instantiations.
if (!window.g_OceanGltfCache) {
    window.g_OceanGltfCache = new Map();
}

const gltfLoader = new GLTFLoader();

function cloneOwnedScene(source) {
    let hasSkinnedMesh = false;
    source.traverse((child) => {
        if (child.isSkinnedMesh) hasSkinnedMesh = true;
    });

    const clone = hasSkinnedMesh ? SkeletonUtils.clone(source) : source.clone(true);
    const geometryClones = new Map();
    const materialClones = new Map();
    const cloneMaterial = (material) => {
        if (!material) return material;
        if (!materialClones.has(material)) materialClones.set(material, material.clone());
        return materialClones.get(material);
    };
    clone.traverse((child) => {
        if (!child.isMesh) return;
        if (child.geometry) {
            if (!geometryClones.has(child.geometry)) {
                geometryClones.set(child.geometry, child.geometry.clone());
            }
            child.geometry = geometryClones.get(child.geometry);
        }
        child.material = Array.isArray(child.material)
            ? child.material.map(cloneMaterial)
            : cloneMaterial(child.material);
    });
    return clone;
}

/**
 * Loads a GLTF asset from a URL, caching the raw parsed result.
 * Returns a cloned version of the GLTF scene and animations so callers can safely mutate them.
 * @param {string} url - The URL of the GLTF asset to load.
 * @returns {Promise<{scene: THREE.Group, animations: Array, cameras: Array, asset: Object}>}
 */
export async function loadGltfCached(url) {
    let loadPromise = window.g_OceanGltfCache.get(url);
    if (!loadPromise) {
        loadPromise = gltfLoader.loadAsync(url).catch((err) => {
            // Remove from cache on failure so future attempts can retry
            window.g_OceanGltfCache.delete(url);
            throw err;
        });
        window.g_OceanGltfCache.set(url, loadPromise);
    }

    const gltf = await loadPromise;

    // Deep clone the scene hierarchy. SkeletonUtils.clone is safe for both
    // rigged (SkinnedMesh) and static meshes.
    // Callers aggressively merge geometry, delete attributes, and dispose
    // converted materials. Give them owned resources so the cached template
    // remains immutable and warm theme switches never inherit disposed data.
    const sceneClone = cloneOwnedScene(gltf.scene);

    return {
        scene: sceneClone,
        animations: gltf.animations || [],
        cameras: gltf.cameras || [],
        asset: gltf.asset || {},
    };
}
