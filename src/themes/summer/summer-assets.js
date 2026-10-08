/**
 * Summer — the meadow's authored assets.
 *
 * Birches, spruces, their leaf and needle sprays, the cottage, the maypole and the shore
 * props are generated in Blender by
 * scripts/blender/summer_meadow_assets.py and written as compact GLBs: quantised bark
 * meshes plus a point cloud of foliage sites (where each spray attaches, how the wind may
 * move it, how much sky it sees). This module loads them and turns them into plain
 * geometry and typed arrays the forest can instance.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './assets/asset-manifest.json';

export const SUMMER_TREE_URLS = Object.freeze({
    'birch-hero': new URL('./assets/birch-hero.glb', import.meta.url).href,
    'spruce-hero': new URL('./assets/spruce-hero.glb', import.meta.url).href,
    'birch-grove-a': new URL('./assets/birch-grove-a.glb', import.meta.url).href,
    'birch-grove-b': new URL('./assets/birch-grove-b.glb', import.meta.url).href,
    'birch-grove-c': new URL('./assets/birch-grove-c.glb', import.meta.url).href,
    'spruce-grove-a': new URL('./assets/spruce-grove-a.glb', import.meta.url).href,
    'spruce-grove-b': new URL('./assets/spruce-grove-b.glb', import.meta.url).href,
    'spruce-grove-c': new URL('./assets/spruce-grove-c.glb', import.meta.url).href,
    'spruce-grove-d': new URL('./assets/spruce-grove-d.glb', import.meta.url).href,
});
export const SUMMER_FOLIAGE_URL = new URL('./assets/summer-foliage.glb', import.meta.url).href;
export const SUMMER_PROPS_URL = new URL('./assets/summer-props.glb', import.meta.url).href;
export const SUMMER_IMPOSTOR_URL = new URL('./assets/summer-impostors.png', import.meta.url).href;
export const SUMMER_ASSET_SCHEMA = 1;

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
    if (!found?.geometry) throw new Error(`[Summer] Asset is missing its "${name}" primitive.`);
    return found;
}

function checkSchema(root, label) {
    const version = root.userData?.schemaVersion;
    if (version !== SUMMER_ASSET_SCHEMA) {
        throw new Error(`[Summer] ${label} has asset schema ${version}; expected ${SUMMER_ASSET_SCHEMA}.`);
    }
}

/** Turn one parsed tree GLB into bark geometry and foliage-site arrays. */
export function parseSummerTree(gltf, name = '') {
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
        bark: meshGeometry(child(root, 'bark')),
        // Limbs are last in the index buffer; a tier may stop drawing here.
        barkCoreIndices: meta.barkCoreIndices,
        sites,
    };
}

/** Every mesh of a GLB (sprays, props), keyed by name. */
export function parseSummerMeshes(gltf, label) {
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

export function disposeSummerAssets(assets) {
    if (!assets) return;
    Object.values(assets.foliage?.meshes || {}).forEach((geometry) => geometry.dispose());
    Object.values(assets.props?.meshes || {}).forEach((geometry) => geometry.dispose());
    Object.values(assets.trees || {}).forEach((tree) => tree.bark?.dispose());
    assets.impostors?.texture?.dispose();
}

/** Anchor points and size the Blender generator recorded for a prop (its local metres), or null. */
export function summerPropRecord(name) {
    const record = manifest.assets.find((entry) => entry.kind === 'props');
    return record?.meshes?.[name] || null;
}

/** Tile layout of the far-shore sprite sheet, as written by the Blender bake. */
export function summerImpostorLayout() {
    const record = manifest.assets.find((entry) => entry.kind === 'impostors');
    if (!record) return null;
    return { atlasWidth: record.atlasWidth, atlasHeight: record.atlasHeight, tiles: record.tiles };
}

/** The sprite sheet stores shading data, not colour: keep it linear and mip-mapped. */
export function prepareSummerImpostors(texture) {
    const prepared = texture;
    prepared.colorSpace = THREE.NoColorSpace;
    prepared.wrapS = THREE.ClampToEdgeWrapping;
    prepared.wrapT = THREE.ClampToEdgeWrapping;
    prepared.minFilter = THREE.LinearMipmapLinearFilter;
    prepared.magFilter = THREE.LinearFilter;
    prepared.generateMipmaps = true;
    prepared.anisotropy = 4;
    prepared.name = 'SummerFarShoreSprites';
    prepared.needsUpdate = true;
    return prepared;
}

/**
 * Load every authored asset. `isCurrent` lets a superseded theme start abandon the
 * work: nothing is retained by the module, so a stale load simply disposes its results.
 */
export async function loadSummerAssets({
    trees = Object.keys(SUMMER_TREE_URLS), loader = new GLTFLoader(),
    textureLoader = new THREE.TextureLoader(), isCurrent = () => true,
} = {}) {
    const names = [...new Set(trees)];
    const layout = summerImpostorLayout();
    const [foliageGltf, propsGltf, impostorTexture, ...treeGltfs] = await Promise.all([
        loader.loadAsync(SUMMER_FOLIAGE_URL),
        loader.loadAsync(SUMMER_PROPS_URL),
        layout && textureLoader ? textureLoader.loadAsync(SUMMER_IMPOSTOR_URL) : null,
        ...names.map((name) => {
            if (!SUMMER_TREE_URLS[name]) throw new Error(`[Summer] Unknown tree asset "${name}".`);
            return loader.loadAsync(SUMMER_TREE_URLS[name]);
        }),
    ]);
    const assets = {
        foliage: parseSummerMeshes(foliageGltf, 'Foliage'),
        props: parseSummerMeshes(propsGltf, 'Props'),
        trees: {},
        impostors: null,
    };
    names.forEach((name, index) => {
        assets.trees[name] = parseSummerTree(treeGltfs[index], name);
    });
    if (impostorTexture) assets.impostors = { ...layout, texture: prepareSummerImpostors(impostorTexture) };
    [foliageGltf, propsGltf, ...treeGltfs].forEach(releaseGltf);
    if (!isCurrent()) {
        disposeSummerAssets(assets);
        return null;
    }
    return assets;
}
