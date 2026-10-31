/**
 * Fall — the grove's authored assets.
 *
 * Trees, sprays and leaves are generated in Blender by scripts/blender/fall_grove_assets.py
 * and written as compact GLBs: quantised bark meshes plus a point cloud of foliage sites
 * (where each spray attaches, how the wind may move it, how much sky it sees). This module
 * loads them and turns them into plain geometry and typed arrays the forest can instance.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import manifest from './assets/asset-manifest.json';
// Reads a (possibly normalised integer) attribute as floats, bit-identical to the getters.
import { attributeFloats as floats } from '../shared/attribute-floats.js';
import { freshGeometry } from '../shared/fresh-geometry.js';
import { loadDecodedTexture } from '../shared/decoded-texture.js';

export const FALL_TREE_URLS = Object.freeze({
    'maple-hero': new URL('./assets/maple-hero.glb', import.meta.url).href,
    'oak-hero': new URL('./assets/oak-hero.glb', import.meta.url).href,
    'maple-grove-a': new URL('./assets/maple-grove-a.glb', import.meta.url).href,
    'maple-grove-b': new URL('./assets/maple-grove-b.glb', import.meta.url).href,
    'maple-grove-c': new URL('./assets/maple-grove-c.glb', import.meta.url).href,
    'birch-grove-a': new URL('./assets/birch-grove-a.glb', import.meta.url).href,
    'birch-grove-b': new URL('./assets/birch-grove-b.glb', import.meta.url).href,
});
export const FALL_FOLIAGE_URL = new URL('./assets/fall-foliage.glb', import.meta.url).href;
/** The red squirrel: modelled, rigged and animated in Blender (fall-squirrel.js draws it). */
export const FALL_SQUIRREL_URL = new URL('./assets/squirrel.glb', import.meta.url).href;
export const FALL_IMPOSTOR_URL = new URL('./assets/fall-impostors.png', import.meta.url).href;
export const FALL_ASSET_SCHEMA = 1;

/** Quantised positions decode through the node's scale and translation. */
function worldPositions(object) {
    const source = object.geometry.attributes.position;
    const out = floats(source, 3);
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
    if (!found?.geometry) throw new Error(`[Fall] Asset is missing its "${name}" primitive.`);
    return found;
}

/** Turn one parsed tree GLB into bark geometry and foliage-site arrays. */
export function parseFallTree(gltf, name = '') {
    const root = gltf.scene;
    const meta = root.userData || {};
    if (meta.schemaVersion !== FALL_ASSET_SCHEMA) {
        throw new Error(`[Fall] Tree "${name}" has asset schema ${meta.schemaVersion}; expected ${FALL_ASSET_SCHEMA}.`);
    }
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
        level: new Uint8Array(count),
    };
    for (let i = 0; i < count; i += 1) {
        sites.scale[i] = params[i * 4] * (meta.scaleRange || 2.5);
        sites.sky[i] = params[i * 4 + 1];
        sites.sway[i] = params[i * 4 + 2];
        sites.phase[i] = params[i * 4 + 3];
        sites.bent.set([bent[i * 4], bent[i * 4 + 1], bent[i * 4 + 2]], i * 3);
        sites.hue[i] = bent[i * 4 + 3] * 0.5 + 0.5;
        sites.variant[i] = kind.getX(i);
        sites.level[i] = kind.getY(i);
    }
    return {
        name: meta.name || name,
        species: meta.species,
        role: meta.role,
        foliage: meta.foliage,
        height: meta.height,
        trunkRadius: meta.trunkRadius,
        crownCentre: meta.crownCentre,
        crownRadii: meta.crownRadii,
        bark: meshGeometry(child(root, 'bark')),
        // Twigs are last in the index buffer; a tier may stop drawing here.
        barkCoreIndices: meta.barkCoreIndices,
        sites,
    };
}

/** Sprays and single leaves, keyed by mesh name. */
export function parseFallFoliage(gltf) {
    const root = gltf.scene;
    if (root.userData?.schemaVersion !== FALL_ASSET_SCHEMA) {
        throw new Error(`[Fall] Foliage has asset schema ${root.userData?.schemaVersion}; expected ${FALL_ASSET_SCHEMA}.`);
    }
    const meshes = {};
    root.children.forEach((object) => {
        if (object.geometry) meshes[object.name] = meshGeometry(object);
    });
    return { variants: root.userData.variants || 2, meshes };
}

/** GLTFLoader keeps its own parsed geometry; release what the grove did not adopt. */
function releaseGltf(gltf) {
    gltf.scene.traverse((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material?.dispose?.());
    });
}

export function disposeFallAssets(assets) {
    if (!assets) return;
    Object.values(assets.foliage?.meshes || {}).forEach((geometry) => geometry.dispose());
    Object.values(assets.trees || {}).forEach((tree) => tree.bark?.dispose());
    assets.impostors?.texture?.dispose();
    assets.squirrel?.scene?.traverse((object) => object.geometry?.dispose());
}

/** Tile layout of the far-tree sprite sheet, as written by the Blender bake. */
export function fallImpostorLayout() {
    const record = manifest.assets.find((entry) => entry.kind === 'impostors');
    if (!record) return null;
    return { atlasWidth: record.atlasWidth, atlasHeight: record.atlasHeight, tiles: record.tiles };
}

/** The sprite sheet stores shading data, not colour: keep it linear and mip-mapped. */
export function prepareImpostorTexture(texture) {
    const prepared = texture;
    prepared.colorSpace = THREE.NoColorSpace;
    prepared.wrapS = THREE.ClampToEdgeWrapping;
    prepared.wrapT = THREE.ClampToEdgeWrapping;
    prepared.minFilter = THREE.LinearMipmapLinearFilter;
    prepared.magFilter = THREE.LinearFilter;
    prepared.generateMipmaps = true;
    prepared.anisotropy = 4;
    prepared.name = 'FallDeepForestSprites';
    prepared.needsUpdate = true;
    return prepared;
}

/**
 * The game's own load (default loaders), kept for the session: parsing the grove's GLBs cost
 * 83-91 ms of main thread on every Fall start, a frame-long hitch in the outgoing theme and the
 * board during an in-play switch (docs/THEME_FLEET_240_2026-10.md §7). Nothing in the bundle is
 * changed by its users: the forest instances its geometry, the squirrel is cloned
 * (SkeletonUtils), and `disposeFallAssets` only releases GPU copies (geometry and texture
 * `dispose()`), which a later renderer uploads again. Loads with injected loaders (tests) are
 * never cached.
 * @type {?{ key: string, promise: Promise<object> }}
 */
let sessionAssets = null;

/**
 * Load every authored asset. `isCurrent` lets a superseded theme start abandon the work: a stale
 * load resolves to null (an uncached one disposes its results).
 */
export async function loadFallAssets({
    trees = Object.keys(FALL_TREE_URLS), loader, textureLoader, isCurrent = () => true, squirrel = true,
} = {}) {
    const cacheable = loader === undefined && textureLoader === undefined;
    const key = `${[...new Set(trees)].join(',')}|${squirrel}`;
    if (cacheable && sessionAssets?.key === key) {
        const assets = await sessionAssets.promise;
        return isCurrent() ? startView(assets) : null;
    }
    const work = loadFallAssetsFresh({
        trees,
        loader: loader ?? new GLTFLoader(),
        textureLoader: textureLoader === undefined ? new THREE.TextureLoader() : textureLoader,
        squirrel,
    });
    if (cacheable) {
        const entry = { key, promise: work };
        sessionAssets = entry;
        work.catch(() => { if (sessionAssets === entry) sessionAssets = null; });
    }
    const assets = await work;
    if (!isCurrent()) {
        if (!cacheable) disposeFallAssets(assets);
        return null;
    }
    return cacheable ? startView(assets) : assets;
}

/**
 * What one start draws from the session's assets: geometry objects of its own over the kept arrays
 * (shared/fresh-geometry.js), so its dispose() never reaches the next start's buffers. The kept
 * originals are never drawn. Textures and plain data are shared as they are.
 */
function startView(assets) {
    const each = (object, make) => Object.fromEntries(Object.entries(object || {}).map(([k, v]) => [k, make(v)]));
    let { squirrel } = assets;
    if (squirrel?.scene) {
        const scene = cloneSkinned(squirrel.scene);
        scene.traverse((object) => {
            const node = object;
            if (node.geometry) node.geometry = freshGeometry(node.geometry);
        });
        squirrel = { ...squirrel, scene };
    }
    return {
        ...assets,
        foliage: assets.foliage ? { ...assets.foliage, meshes: each(assets.foliage.meshes, freshGeometry) } : assets.foliage,
        trees: each(assets.trees, (tree) => (tree.bark ? { ...tree, bark: freshGeometry(tree.bark) } : tree)),
        squirrel,
    };
}

async function loadFallAssetsFresh({
    trees, loader, textureLoader, squirrel,
}) {
    const names = [...new Set(trees)];
    const layout = fallImpostorLayout();
    const [foliageGltf, impostorTexture, squirrelGltf, ...treeGltfs] = await Promise.all([
        loader.loadAsync(FALL_FOLIAGE_URL),
        layout && textureLoader ? loadDecodedTexture(FALL_IMPOSTOR_URL, textureLoader) : null,
        // The grove does without its squirrel rather than fail to open.
        squirrel ? loader.loadAsync(FALL_SQUIRREL_URL).catch((error) => {
            console.warn('[Fall] the squirrel did not arrive:', error?.message || error);
            return null;
        }) : null,
        ...names.map((name) => {
            if (!FALL_TREE_URLS[name]) throw new Error(`[Fall] Unknown tree asset "${name}".`);
            return loader.loadAsync(FALL_TREE_URLS[name]);
        }),
    ]);
    const assets = {
        foliage: parseFallFoliage(foliageGltf), trees: {}, impostors: null, squirrel: squirrelGltf || null,
    };
    names.forEach((name, index) => {
        assets.trees[name] = parseFallTree(treeGltfs[index], name);
    });
    if (impostorTexture) assets.impostors = { ...layout, texture: prepareImpostorTexture(impostorTexture) };
    // (The squirrel's GLTF is kept whole: its scene, skeleton and clips are the world's to clone.)
    [foliageGltf, squirrelGltf, ...treeGltfs].filter(Boolean).forEach(releaseGltf);
    return assets;
}
