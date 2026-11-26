/**
 * Crystal Cave — the authored cavern.
 *
 * scripts/blender/crystal_cave_assets.py sculpts the hall, roots every crystal on it and
 * bakes the light each mineral family throws on the rock. It writes one GLB; this module
 * loads it and hands the runtime plain geometry and typed records.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const CRYSTAL_CAVE_CAVERN_URL = new URL('./assets/cavern.glb', import.meta.url).href;
export const CRYSTAL_CAVE_CAUSTICS_URL = new URL('./assets/pool-caustics.png', import.meta.url).href;
export const CRYSTAL_CAVE_REFLECTION_URL = new URL('./assets/pool-reflection.png', import.meta.url).href;
export const CRYSTAL_CAVE_ASSET_SCHEMA = 1;

const GETTERS = ['getX', 'getY', 'getZ', 'getW'];

/** Read a (possibly normalised integer) attribute as floats. */
function floats(attribute, width = attribute.itemSize) {
    const out = new Float32Array(attribute.count * width);
    for (let i = 0; i < attribute.count; i += 1) {
        for (let c = 0; c < width; c += 1) out[i * width + c] = attribute[GETTERS[c]](i);
    }
    return out;
}

function named(root, name) {
    const object = root.getObjectByName(name);
    if (!object?.geometry) throw new Error(`[CrystalCave] cavern.glb has no "${name}" node.`);
    return object;
}

/** Quantised positions decode through the node's scale and translation. */
function cavernGeometry(object) {
    const source = object.geometry;
    const positions = floats(source.attributes.position, 3);
    const { position, scale } = object;
    for (let i = 0; i < positions.length; i += 3) {
        positions[i] = positions[i] * scale.x + position.x;
        positions[i + 1] = positions[i + 1] * scale.y + position.y;
        positions[i + 2] = positions[i + 2] * scale.z + position.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.name = 'Crystal Cave — cavern';
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    // Normals, baked light and its direction stay in their compact normalised form.
    geometry.setAttribute('normal', source.attributes.normal);
    geometry.setAttribute('aLight0', source.attributes._light0);
    geometry.setAttribute('aLight1', source.attributes._light1);
    geometry.setAttribute('aLightDir', source.attributes._ldir);
    geometry.setIndex(source.index);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
}

/** One plain record per crystal, in the shape `packCrystal` reads. */
function crystalRecords(object) {
    const { attributes } = object.geometry;
    const position = floats(attributes.position, 3);
    const quat = floats(attributes._quat, 4);
    const dims = floats(attributes._dims, 4);
    const look = floats(attributes._look, 4);
    const meta = floats(attributes._meta, 4);
    return Array.from({ length: attributes.position.count }, (_, i) => ({
        x: position[i * 3],
        y: position[i * 3 + 1],
        z: position[i * 3 + 2],
        qx: quat[i * 4],
        qy: quat[i * 4 + 1],
        qz: quat[i * 4 + 2],
        qw: quat[i * 4 + 3],
        radius: dims[i * 4],
        depth: dims[i * 4 + 1],
        height: dims[i * 4 + 2],
        tip: dims[i * 4 + 3],
        apexX: look[i * 4],
        apexZ: look[i * 4 + 1],
        family: Math.round(look[i * 4 + 2]),
        glow: look[i * 4 + 3],
        seed: meta[i * 4],
        /** 0: always present. n > 0: grown by play at sprout site n - 1. */
        group: Math.round(meta[i * 4 + 1]),
        rank: meta[i * 4 + 2],
    }));
}

function pointRecords(object) {
    return {
        count: object.geometry.attributes.position.count,
        positions: floats(object.geometry.attributes.position, 3),
        params: floats(object.geometry.attributes._params, 4),
    };
}

/** Turn a parsed glTF into the runtime's cavern description. */
export function parseCrystalCaveCavern(gltf) {
    const root = gltf.scene;
    const meta = root.userData ?? {};
    if (meta.schemaVersion !== CRYSTAL_CAVE_ASSET_SCHEMA) {
        throw new Error(`[CrystalCave] cavern.glb schema ${meta.schemaVersion}, expected ${CRYSTAL_CAVE_ASSET_SCHEMA}.`);
    }
    const drips = root.getObjectByName('drips');
    return {
        meta,
        geometry: cavernGeometry(named(root, 'cavern')),
        crystals: crystalRecords(named(root, 'crystals')),
        glowworms: pointRecords(named(root, 'glowworms')),
        drips: drips?.geometry ? pointRecords(drips) : { count: 0, positions: new Float32Array(0), params: new Float32Array(0) },
    };
}

function disposeGltf(gltf) {
    gltf?.scene?.traverse((object) => object.geometry?.dispose?.());
}

/**
 * @param {object} [options]
 * @param {{loadAsync: Function}} [options.loader]
 * @param {boolean} [options.bakedReflection] load the reflection weights on tiers without the planar mirror
 * @param {{loadAsync: Function}} [options.textureLoader]
 * @param {() => boolean} [options.isCurrent] false once the caller no longer wants the result
 * @returns {Promise<object|null>} the cavern, or null when the request went stale
 */
export async function loadCrystalCaveAssets({
    loader = new GLTFLoader(), bakedReflection = false, textureLoader = new THREE.TextureLoader(),
    isCurrent = () => true,
} = {}) {
    const gltf = await loader.loadAsync(CRYSTAL_CAVE_CAVERN_URL);
    if (!isCurrent()) {
        disposeGltf(gltf);
        return null;
    }
    const cavern = parseCrystalCaveCavern(gltf);
    const urls = [CRYSTAL_CAVE_CAUSTICS_URL];
    if (bakedReflection) urls.push(CRYSTAL_CAVE_REFLECTION_URL);
    const textures = await Promise.allSettled(urls.map((url) => textureLoader.loadAsync(url)));
    const failure = textures.find((item) => item.status === 'rejected');
    if (failure || !isCurrent()) {
        for (const item of textures) if (item.status === 'fulfilled') item.value.dispose();
        disposeCrystalCaveAssets(cavern);
        if (failure) throw failure.reason;
        return null;
    }
    cavern.caustics = textures[0].value;
    cavern.caustics.name = 'Crystal Cave — refracted light';
    cavern.caustics.colorSpace = THREE.NoColorSpace;
    cavern.caustics.wrapS = THREE.RepeatWrapping;
    cavern.caustics.wrapT = THREE.RepeatWrapping;
    if (bakedReflection) {
        cavern.poolReflection = textures[1].value;
        cavern.poolReflection.name = 'Crystal Cave — reflected mineral weights';
        cavern.poolReflection.colorSpace = THREE.NoColorSpace;
    }
    // The source primitives are no longer needed; the cavern geometry shares its
    // compact attribute arrays with them, and those arrays survive a geometry dispose.
    return cavern;
}

export function disposeCrystalCaveAssets(assets) {
    assets?.geometry?.dispose();
    assets?.caustics?.dispose();
    assets?.poolReflection?.dispose();
}
