/**
 * Spring — the valley's authored assets.
 *
 * The valley's ground is baked offline (scripts/spring/bake-valley.mjs) and read here in one
 * request, inflated by the browser's own DecompressionStream.
 *
 * Birches in first leaf, spruces and granite are generated in Blender by
 * scripts/blender/spring_river_assets.py and written as compact GLBs: quantised bark meshes plus
 * a point cloud of foliage sites per tree (where each spray attaches, how the wind may move it,
 * how much sky it sees), the shared sprays, and the granite as plain meshes whose colours carry
 * shading data (lichen, moss, occlusion, tone). This module loads them once a session and turns
 * them into plain geometry and typed arrays the forest and the rocks can instance.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { decodeValley } from './spring-terrain.js';

export const SPRING_TREE_URLS = Object.freeze({
    'birch-hero': new URL('./assets/birch-hero.glb', import.meta.url).href,
    'birch-grove-a': new URL('./assets/birch-grove-a.glb', import.meta.url).href,
    'birch-grove-b': new URL('./assets/birch-grove-b.glb', import.meta.url).href,
    'birch-grove-c': new URL('./assets/birch-grove-c.glb', import.meta.url).href,
    'spruce-hero': new URL('./assets/spruce-hero.glb', import.meta.url).href,
    'spruce-grove-a': new URL('./assets/spruce-grove-a.glb', import.meta.url).href,
    'spruce-grove-b': new URL('./assets/spruce-grove-b.glb', import.meta.url).href,
    'spruce-grove-c': new URL('./assets/spruce-grove-c.glb', import.meta.url).href,
});
export const SPRING_FOLIAGE_URL = new URL('./assets/spring-foliage.glb', import.meta.url).href;
export const SPRING_ROCKS_URL = new URL('./assets/spring-rocks.glb', import.meta.url).href;
/** The baked valley (scripts/spring/bake-valley.mjs; spring-terrain.js encodeValley). */
export const SPRING_VALLEY_URL = new URL('./assets/spring-valley.bin', import.meta.url).href;
export const SPRING_ASSET_SCHEMA = 1;

/** Read a (possibly normalised integer) attribute as floats. */
function floats(attribute, width = attribute.itemSize) {
    const out = new Float32Array(attribute.count * width);
    const getters = ['getX', 'getY', 'getZ', 'getW'];
    for (let i = 0; i < attribute.count; i += 1) {
        for (let c = 0; c < width; c += 1) out[i * width + c] = attribute[getters[c]](i);
    }
    return out;
}

/** Quantised positions decode through the node's scale and translation. */
function worldPositions(object) {
    const out = floats(object.geometry.attributes.position, 3);
    const { position, scale } = object;
    for (let i = 0; i < out.length; i += 3) {
        out[i] = out[i] * scale.x + position.x;
        out[i + 1] = out[i + 1] * scale.y + position.y;
        out[i + 2] = out[i + 2] * scale.z + position.z;
    }
    return out;
}

/** A renderable geometry in metres that keeps the compact normal/colour encodings. */
function meshGeometry(object) {
    const source = object.geometry;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(worldPositions(object), 3));
    ['normal', 'uv', 'color'].forEach((name) => {
        if (source.attributes[name]) geometry.setAttribute(name, source.attributes[name]);
    });
    if (source.index) geometry.setIndex(source.index);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    geometry.name = object.name;
    return geometry;
}

function child(root, name) {
    const found = root.children.find((entry) => entry.name === name);
    if (!found?.geometry) throw new Error(`[Spring] Asset is missing its "${name}" primitive.`);
    return found;
}

function checkSchema(root, label) {
    const version = root.userData?.schemaVersion;
    if (version !== SPRING_ASSET_SCHEMA) {
        throw new Error(`[Spring] ${label} has asset schema ${version}; expected ${SPRING_ASSET_SCHEMA}.`);
    }
}

/** Turn one parsed tree GLB into bark geometry and foliage-site arrays. */
export function parseSpringTree(gltf, name = '') {
    const root = gltf.scene;
    const meta = root.userData || {};
    checkSchema(root, `Tree "${name}"`);
    const points = child(root, 'sites');
    const { attributes } = points.geometry;
    const { count } = attributes.position;
    const params = floats(attributes._params, 4);
    const bent = floats(attributes._bent, 4);
    const kind = attributes._kind;
    const sites = {
        count,
        position: worldPositions(points),
        rotation: floats(attributes._rot, 4),
        scale: new Float32Array(count),
        sky: new Float32Array(count),
        sway: new Float32Array(count),
        phase: new Float32Array(count),
        bent: new Float32Array(count * 3),
        hue: new Float32Array(count),
        variant: new Uint8Array(count),
    };
    for (let i = 0; i < count; i += 1) {
        sites.scale[i] = params[i * 4] * (meta.scaleRange || 2.5);
        sites.sky[i] = params[i * 4 + 1];
        sites.sway[i] = params[i * 4 + 2];
        sites.phase[i] = params[i * 4 + 3];
        sites.bent.set([bent[i * 4], bent[i * 4 + 1], bent[i * 4 + 2]], i * 3);
        sites.hue[i] = bent[i * 4 + 3] * 0.5 + 0.5;
        sites.variant[i] = kind.getX(i);
    }
    return {
        name: meta.name || name,
        species: meta.species,
        role: meta.role,
        foliage: meta.foliage,
        height: meta.height,
        trunkRadius: meta.trunkRadius,
        crownBase: meta.crownBase,
        crownRadii: meta.crownRadii,
        bark: meshGeometry(child(root, 'bark')),
        barkCoreIndices: meta.barkCoreIndices,
        sites,
    };
}

/** Every mesh of a GLB (sprays, rocks), keyed by name. */
export function parseSpringMeshes(gltf, label) {
    const root = gltf.scene;
    checkSchema(root, label);
    const meshes = {};
    root.children.forEach((object) => {
        if (object.geometry) meshes[object.name] = meshGeometry(object);
    });
    return { variants: root.userData.variants || 2, meshes };
}

/** GLTFLoader keeps its own parsed geometry; release what the forest did not adopt. */
function releaseGltf(gltf) {
    gltf.scene.traverse((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material?.dispose?.());
    });
}

let pending = null;

/**
 * The asset pack, loaded once a session: { trees: {name: tree}, foliage: {variants, meshes},
 * rocks: {meshes} }. Resolves to null where there is nothing to load from (no fetch: unit tests).
 */
export function loadSpringAssets({ signal } = {}) {
    if (typeof fetch !== 'function' || typeof window === 'undefined') return Promise.resolve(null);
    if (!pending) {
        const loader = new GLTFLoader();
        const load = (url) => loader.loadAsync(url);
        pending = (async () => {
            const [foliage, rocks, ...trees] = await Promise.all([
                load(SPRING_FOLIAGE_URL),
                load(SPRING_ROCKS_URL),
                ...Object.values(SPRING_TREE_URLS).map(load),
            ]);
            const out = {
                foliage: parseSpringMeshes(foliage, 'Foliage'),
                rocks: parseSpringMeshes(rocks, 'Rocks'),
                trees: {},
            };
            Object.keys(SPRING_TREE_URLS).forEach((name, k) => {
                out.trees[name] = parseSpringTree(trees[k], name);
            });
            [foliage, rocks, ...trees].forEach(releaseGltf);
            return out;
        })().catch((error) => {
            pending = null;
            throw error;
        });
    }
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return pending;
}

let valleyPending = null;

/**
 * The baked valley, read once a session: the same shape spring-terrain bakeTerrain returns.
 * Resolves to null where it cannot be read here (no fetch or no DecompressionStream: unit tests),
 * and the caller bakes instead.
 */
export function loadSpringValley({ signal } = {}) {
    if (typeof fetch !== 'function' || typeof window === 'undefined' || typeof DecompressionStream !== 'function') {
        return Promise.resolve(null);
    }
    if (!valleyPending) {
        valleyPending = (async () => {
            const response = await fetch(SPRING_VALLEY_URL);
            if (!response.ok) throw new Error(`[Spring] valley request failed: ${response.status}`);
            const inflated = new Response(response.body.pipeThrough(new DecompressionStream('deflate')));
            return decodeValley(new Uint8Array(await inflated.arrayBuffer()));
        })().catch((error) => {
            valleyPending = null;
            throw error;
        });
    }
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return valleyPending;
}
