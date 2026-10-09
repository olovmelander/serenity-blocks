/**
 * Verdant Hills — what is baked ahead of time: the valley's patchwork and the cloud field.
 *
 * scripts/verdant-hills/bake-land.mjs writes `assets/verdant-land.png` (hedgerows, the
 * tone of each pasture, still water and the shade of every tree beyond the shadow map, at
 * a resolution the theme could not afford to work out when it starts) and
 * `assets/verdant-clouds.png` (the field the sky marches and the hills are shaded by).
 * Both are opaque throughout, so they decode like any picture. If a file cannot be read
 * the terrain makes a coarse map of its own and the light rig makes the same clouds on the
 * spot, so loading never fails.
 */
import * as THREE from 'three/webgpu';
import cloudManifest from './assets/verdant-clouds.json';
import manifest from './assets/verdant-land.json';
import { VERDANT_HILLS_CLOUD_SCHEMA, prepareVerdantHillsClouds } from './verdant-hills-light.js';
import { VERDANT_HILLS_LAND_SCHEMA } from './verdant-hills-terrain.js';

export const VERDANT_HILLS_LAND_URL = new URL('./assets/verdant-land.png', import.meta.url).href;
export const VERDANT_HILLS_CLOUDS_URL = new URL('./assets/verdant-clouds.png', import.meta.url).href;

/** The baked map's record: its size, bounds and the hash that pins its bytes. */
export function verdantHillsLandRecord() {
    return manifest;
}

/** The map is data, not colour: keep it linear, unflipped (row 0 is the far edge) and mip-mapped. */
export function prepareVerdantHillsLand(texture) {
    const prepared = texture;
    prepared.colorSpace = THREE.NoColorSpace;
    prepared.flipY = false;
    prepared.wrapS = THREE.ClampToEdgeWrapping;
    prepared.wrapT = THREE.ClampToEdgeWrapping;
    prepared.minFilter = THREE.LinearMipmapLinearFilter;
    prepared.magFilter = THREE.LinearFilter;
    prepared.generateMipmaps = true;
    prepared.anisotropy = 8;
    prepared.name = 'VerdantHillsLandMap';
    prepared.needsUpdate = true;
    return prepared;
}

/**
 * Read the baked patchwork. Never rejects: null means "make the coarse one".
 * @returns {Promise<THREE.Texture | null>}
 */
export async function loadVerdantHillsLand({ textureLoader = new THREE.TextureLoader() } = {}) {
    try {
        if (manifest.schema !== VERDANT_HILLS_LAND_SCHEMA) throw new Error(`land schema ${manifest.schema}`);
        if (!textureLoader || typeof textureLoader.loadAsync !== 'function') return null;
        const texture = await textureLoader.loadAsync(VERDANT_HILLS_LAND_URL);
        const { width, height } = texture.image || {};
        if (width !== manifest.size || height !== manifest.size) {
            texture.dispose();
            throw new Error(`land map is ${width}×${height}`);
        }
        return prepareVerdantHillsLand(texture);
    } catch (error) {
        console.warn('[Verdant Hills] baked land map unavailable, drawing a coarse one:', error?.message || error);
        return null;
    }
}

/** The baked cloud field's record: its size, seed, level table and the hash that pins its bytes. */
export function verdantHillsCloudRecord() {
    return cloudManifest;
}

/**
 * Read the baked cloud field. Never rejects: null means "make it on the spot".
 * @returns {Promise<{ texture: THREE.Texture, edges: Float32Array } | null>}
 */
export async function loadVerdantHillsClouds({ textureLoader = new THREE.TextureLoader() } = {}) {
    try {
        if (cloudManifest.schema !== VERDANT_HILLS_CLOUD_SCHEMA) {
            throw new Error(`cloud schema ${cloudManifest.schema}`);
        }
        if (!Array.isArray(cloudManifest.edges) || cloudManifest.edges.length !== 256) {
            throw new Error('cloud level table missing');
        }
        if (!textureLoader || typeof textureLoader.loadAsync !== 'function') return null;
        const texture = await textureLoader.loadAsync(VERDANT_HILLS_CLOUDS_URL);
        const { width, height } = texture.image || {};
        if (width !== cloudManifest.size || height !== cloudManifest.size) {
            texture.dispose();
            throw new Error(`cloud field is ${width}×${height}`);
        }
        return {
            texture: prepareVerdantHillsClouds(texture),
            edges: Float32Array.from(cloudManifest.edges, (level) => level / 255),
        };
    } catch (error) {
        console.warn('[Verdant Hills] baked cloud field unavailable, making one:', error?.message || error);
        return null;
    }
}
