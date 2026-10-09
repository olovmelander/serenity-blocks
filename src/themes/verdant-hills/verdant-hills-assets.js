/**
 * Verdant Hills — the downs' authored assets.
 *
 * The old oak, the three field trees, their leaf sprays, the tower mill and its sails, the
 * drystone wall, the gate, the bench, the outcrops, the sheep and the fence post are
 * generated in Blender by scripts/blender/verdant_hills_assets.py and written as compact
 * GLBs: quantised bark meshes plus a point cloud of foliage sites (where each spray
 * attaches, how the wind may move it, how much sky it sees), and props whose vertex colour
 * says what each face is made of. This module loads them and turns them into plain
 * geometry and typed arrays the world can instance.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './assets/asset-manifest.json';
import { loadVerdantHillsClouds, loadVerdantHillsLand } from './verdant-hills-land.js';

export const VERDANT_HILLS_TREE_URLS = Object.freeze({
    'oak-hero': new URL('./assets/oak-hero.glb', import.meta.url).href,
    'oak-field-a': new URL('./assets/oak-field-a.glb', import.meta.url).href,
    'oak-field-b': new URL('./assets/oak-field-b.glb', import.meta.url).href,
    'oak-field-c': new URL('./assets/oak-field-c.glb', import.meta.url).href,
});
export const VERDANT_HILLS_FOLIAGE_URL = new URL('./assets/verdant-foliage.glb', import.meta.url).href;
export const VERDANT_HILLS_PROPS_URL = new URL('./assets/verdant-props.glb', import.meta.url).href;
export const VERDANT_HILLS_IMPOSTOR_URL = new URL('./assets/verdant-impostors.png', import.meta.url).href;
export const VERDANT_HILLS_ASSET_SCHEMA = 1;

/**
 * What a prop's vertices say they are made of: COLOR_0.g holds code / VERDANT_HILLS_MATERIAL_STEPS
 * (sixteen steps, not Summer's eight: this pack has eleven materials).
 */
export const VERDANT_HILLS_MATERIAL_STEPS = 16;
export const VERDANT_HILLS_MATERIALS = Object.freeze({
    timber: 0,
    limewash: 1,
    white: 2,
    tar: 3,
    stone: 4,
    glass: 5,
    door: 6,
    canvas: 7,
    wool: 8,
    skin: 9,
    iron: 10,
});

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
    if (!found?.geometry) throw new Error(`[Verdant Hills] Asset is missing its "${name}" primitive.`);
    return found;
}

function checkSchema(root, label) {
    const version = root.userData?.schemaVersion;
    if (version !== VERDANT_HILLS_ASSET_SCHEMA) {
        throw new Error(
            `[Verdant Hills] ${label} has asset schema ${version}; expected ${VERDANT_HILLS_ASSET_SCHEMA}.`,
        );
    }
}

/** Turn one parsed tree GLB into bark geometry and foliage-site arrays. */
export function parseVerdantHillsTree(gltf, name = '') {
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
        // Where the crown is: the middle and half-extents of its hull, in the tree's own metres.
        crownCentre: meta.crownCentre,
        crownRadii: meta.crownRadii,
        // Named points in the tree's own metres (the old oak's `swing` and `boughTip`); {} on the rest.
        anchors: meta.anchors || {},
        // The unit direction the bark's moss mask (COLOR_0.a) was painted against.
        weatherSide: meta.weatherSide,
        bark: meshGeometry(child(root, 'bark')),
        // Forks, shoots and twigs are last in the index buffer; a tier may stop drawing here.
        barkCoreIndices: meta.barkCoreIndices,
        sites,
    };
}

/**
 * Every mesh of a GLB (sprays, props), keyed by name. `records` holds what the generator
 * wrote beside each one: a prop's size, bounds, materials and anchors; a spray's leaf count.
 */
export function parseVerdantHillsMeshes(gltf, label) {
    const root = gltf.scene;
    checkSchema(root, label);
    const meshes = {};
    const records = {};
    root.children.forEach((object) => {
        if (!object.geometry) return;
        meshes[object.name] = meshGeometry(object);
        // The node's extras as the generator wrote them (GLTFLoader adds the node's name beside them).
        const record = { ...(object.userData || {}) };
        delete record.name;
        records[object.name] = record;
    });
    return { variants: root.userData.variants || 2, meshes, records };
}

/** GLTFLoader keeps its own parsed geometry; release what the world did not adopt. */
function releaseGltf(gltf) {
    gltf.scene.traverse((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material?.dispose?.());
    });
}

export function disposeVerdantHillsAssets(assets) {
    if (!assets) return;
    Object.values(assets.foliage?.meshes || {}).forEach((geometry) => geometry.dispose());
    Object.values(assets.props?.meshes || {}).forEach((geometry) => geometry.dispose());
    Object.values(assets.trees || {}).forEach((tree) => tree.bark?.dispose());
    assets.impostors?.texture?.dispose();
    assets.land?.dispose();
    assets.clouds?.texture?.dispose();
}

/** Anchor points and size the Blender generator recorded for a prop (its local metres), or null. */
export function verdantHillsPropRecord(name) {
    const record = manifest.assets.find((entry) => entry.kind === 'props');
    return record?.meshes?.[name] || null;
}

/** What the manifest records for a tree (its height and anchors among them), or null. */
export function verdantHillsTreeRecord(name) {
    return manifest.assets.find((entry) => entry.kind === 'tree' && entry.file === `${name}.glb`) || null;
}

/** Tile layout of the far-hills sprite sheet, as written by the Blender bake. */
export function verdantHillsImpostorLayout() {
    const record = manifest.assets.find((entry) => entry.kind === 'impostors');
    if (!record) return null;
    return { atlasWidth: record.atlasWidth, atlasHeight: record.atlasHeight, tiles: record.tiles };
}

/** The sprite sheet stores shading data, not colour: keep it linear and mip-mapped. */
export function prepareVerdantHillsImpostors(texture) {
    const prepared = texture;
    prepared.colorSpace = THREE.NoColorSpace;
    prepared.wrapS = THREE.ClampToEdgeWrapping;
    prepared.wrapT = THREE.ClampToEdgeWrapping;
    prepared.minFilter = THREE.LinearMipmapLinearFilter;
    prepared.magFilter = THREE.LinearFilter;
    prepared.generateMipmaps = true;
    prepared.anisotropy = 4;
    prepared.name = 'VerdantHillsFarTreeSprites';
    prepared.needsUpdate = true;
    return prepared;
}

/**
 * Load every authored asset. `isCurrent` lets a superseded theme start abandon the
 * work: nothing is retained by the module, so a stale load simply disposes its results.
 */
export async function loadVerdantHillsAssets({
    trees = Object.keys(VERDANT_HILLS_TREE_URLS), loader = new GLTFLoader(),
    textureLoader = new THREE.TextureLoader(), isCurrent = () => true,
} = {}) {
    const names = [...new Set(trees)];
    const layout = verdantHillsImpostorLayout();
    const [land, clouds, foliageGltf, propsGltf, impostorTexture, ...treeGltfs] = await Promise.all([
        // The valley's baked patchwork and the baked cloud field; null (never a rejection)
        // leaves the terrain and the light rig to make their own.
        textureLoader ? loadVerdantHillsLand({ textureLoader }) : null,
        textureLoader ? loadVerdantHillsClouds({ textureLoader }) : null,
        loader.loadAsync(VERDANT_HILLS_FOLIAGE_URL),
        loader.loadAsync(VERDANT_HILLS_PROPS_URL),
        layout && textureLoader ? textureLoader.loadAsync(VERDANT_HILLS_IMPOSTOR_URL) : null,
        ...names.map((name) => {
            if (!VERDANT_HILLS_TREE_URLS[name]) throw new Error(`[Verdant Hills] Unknown tree asset "${name}".`);
            return loader.loadAsync(VERDANT_HILLS_TREE_URLS[name]);
        }),
    ]);
    const assets = {
        foliage: parseVerdantHillsMeshes(foliageGltf, 'Foliage'),
        props: parseVerdantHillsMeshes(propsGltf, 'Props'),
        trees: {},
        impostors: null,
        land,
        clouds,
    };
    names.forEach((name, index) => {
        assets.trees[name] = parseVerdantHillsTree(treeGltfs[index], name);
    });
    if (impostorTexture) assets.impostors = { ...layout, texture: prepareVerdantHillsImpostors(impostorTexture) };
    [foliageGltf, propsGltf, ...treeGltfs].forEach(releaseGltf);
    if (!isCurrent()) {
        disposeVerdantHillsAssets(assets);
        return null;
    }
    return assets;
}
