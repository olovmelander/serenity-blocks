/**
 * Grainfields — the fields' authored trees and the herd's horse.
 *
 * Japanese white birch (shirakaba), Ezo spruce and Japanese larch (karamatsu), their leaf
 * and needle sprays and a sprite sheet of them for the far belts are generated in Blender
 * by scripts/blender/grainfields_assets.py and written as compact GLBs: quantised bark
 * meshes plus a point cloud of foliage sites (where each spray attaches, how the wind may
 * move it, how much sky it sees). The same script models the herd's horse, a Hokkaido
 * native horse (Dosanko), as one mesh painted with the parts and masks a vertex stage poses
 * it by, and the pivots its neck, legs and tail turn about. This module loads them and
 * turns them into plain geometry and typed arrays the belts and the herd can instance.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './assets/asset-manifest.json';

export const GRAINFIELDS_TREE_URLS = Object.freeze({
    'birch-grove-a': new URL('./assets/birch-grove-a.glb', import.meta.url).href,
    'birch-grove-b': new URL('./assets/birch-grove-b.glb', import.meta.url).href,
    'birch-grove-c': new URL('./assets/birch-grove-c.glb', import.meta.url).href,
    'spruce-grove-a': new URL('./assets/spruce-grove-a.glb', import.meta.url).href,
    'spruce-grove-b': new URL('./assets/spruce-grove-b.glb', import.meta.url).href,
    'spruce-grove-c': new URL('./assets/spruce-grove-c.glb', import.meta.url).href,
    'larch-grove-a': new URL('./assets/larch-grove-a.glb', import.meta.url).href,
    'larch-grove-b': new URL('./assets/larch-grove-b.glb', import.meta.url).href,
    'larch-grove-c': new URL('./assets/larch-grove-c.glb', import.meta.url).href,
});
export const GRAINFIELDS_FOLIAGE_URL = new URL('./assets/grainfields-foliage.glb', import.meta.url).href;
export const GRAINFIELDS_IMPOSTOR_URL = new URL('./assets/grainfields-impostors.png', import.meta.url).href;
export const GRAINFIELDS_HORSE_URL = new URL('./assets/grainfields-horse.glb', import.meta.url).href;
export const GRAINFIELDS_ASSET_SCHEMA = 1;
/**
 * The horse's parts: its colour's red channel is part / 8, so Math.round(r * 8) is one of
 * these. Green is a dark mask (mane, forelock, tail, the legs below the knees and hocks),
 * blue a light mask (a mealy muzzle and the belly), alpha 1.
 */
export const GRAINFIELDS_HORSE_PARTS = Object.freeze({
    body: 0, neck: 1, frontLeft: 2, frontRight: 3, hindLeft: 4, hindRight: 5, tail: 6,
});
/** What the neck (with the head), each leg and the tail turn about. */
const HORSE_PIVOTS = Object.freeze([
    'neck', 'frontLeft', 'frontRight', 'hindLeft', 'hindRight', 'tail',
    'knee', 'hock', 'frontFetlock', 'hindFetlock', 'poll', 'ear',
]);

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
    ['normal', 'uv', 'color', '_rig'].forEach((name) => {
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
    if (!found?.geometry) throw new Error(`[Grainfields] Asset is missing its "${name}" primitive.`);
    return found;
}

function checkSchema(root, label) {
    const version = root.userData?.schemaVersion;
    if (version !== GRAINFIELDS_ASSET_SCHEMA) {
        throw new Error(`[Grainfields] ${label} has asset schema ${version}; expected ${GRAINFIELDS_ASSET_SCHEMA}.`);
    }
}

/** Turn one parsed tree GLB into bark geometry and foliage-site arrays. */
export function parseGrainfieldsTree(gltf, name = '') {
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
        crownBase: meta.crownBase,
        crownCentre: meta.crownCentre,
        crownRadii: meta.crownRadii,
        bark: meshGeometry(child(root, 'bark')),
        // Limbs are last in the index buffer; a tier may stop drawing here.
        barkCoreIndices: meta.barkCoreIndices,
        sites,
    };
}

/** Every mesh of a GLB (the sprays), keyed by name. */
export function parseGrainfieldsMeshes(gltf, label) {
    const root = gltf.scene;
    checkSchema(root, label);
    const meshes = {};
    root.children.forEach((object) => {
        if (object.geometry) meshes[object.name] = meshGeometry(object);
    });
    return { variants: root.userData.variants || 2, meshes };
}

/**
 * The herd's horse: one geometry in metres (+z forward toward the head, y up, the hooves on
 * y = 0, centred on x = 0; its left side is +x) with position, normal, colour and the skin's
 * weights (`_rig`: how far each vertex follows its part's root joint, the joint below it, the
 * one below that, the ears), and the pivots in the same frame: the base of the neck, each
 * shoulder and hip joint, the root of the dock, the knee, the hock and the fetlocks (the left
 * leg's), the atlas under the poll and the left ear's base, each as [x, y, z].
 */
export function parseGrainfieldsHorse(gltf) {
    const root = gltf.scene;
    checkSchema(root, 'Horse');
    const authored = root.userData.pivots || {};
    const pivots = {};
    HORSE_PIVOTS.forEach((name) => {
        const pivot = authored[name];
        if (!Array.isArray(pivot) || pivot.length !== 3 || !pivot.every(Number.isFinite)) {
            throw new Error(`[Grainfields] Horse is missing its "${name}" pivot.`);
        }
        pivots[name] = [pivot[0], pivot[1], pivot[2]];
    });
    return { geometry: meshGeometry(child(root, 'horse')), pivots };
}

/** The horse is a nicety: a failed download leaves the herd without it, not the fields. */
async function loadHorse(loader) {
    try {
        return await loader.loadAsync(GRAINFIELDS_HORSE_URL);
    } catch (error) {
        console.warn('[Grainfields] The horse could not be loaded; the herd stays home.', error);
        return null;
    }
}

function adoptHorse(gltf) {
    try {
        return parseGrainfieldsHorse(gltf);
    } catch (error) {
        console.warn('[Grainfields] The horse could not be read; the herd stays home.', error);
        return null;
    }
}

/** GLTFLoader keeps its own parsed geometry; release what the belts did not adopt. */
function releaseGltf(gltf) {
    gltf.scene.traverse((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material?.dispose?.());
    });
}

export function disposeGrainfieldsAssets(assets) {
    if (!assets) return;
    Object.values(assets.foliage?.meshes || {}).forEach((geometry) => geometry.dispose());
    Object.values(assets.trees || {}).forEach((tree) => tree.bark?.dispose());
    assets.impostors?.texture?.dispose();
    assets.horse?.geometry?.dispose();
}

/** Tile layout of the far-belt sprite sheet, as written by the Blender bake. */
export function grainfieldsImpostorLayout() {
    const record = manifest.assets.find((entry) => entry.kind === 'impostors');
    if (!record) return null;
    return { atlasWidth: record.atlasWidth, atlasHeight: record.atlasHeight, tiles: record.tiles };
}

/** The sprite sheet stores shading data, not colour: keep it linear and mip-mapped. */
export function prepareGrainfieldsImpostors(texture) {
    const prepared = texture;
    prepared.colorSpace = THREE.NoColorSpace;
    prepared.wrapS = THREE.ClampToEdgeWrapping;
    prepared.wrapT = THREE.ClampToEdgeWrapping;
    prepared.minFilter = THREE.LinearMipmapLinearFilter;
    prepared.magFilter = THREE.LinearFilter;
    prepared.generateMipmaps = true;
    prepared.anisotropy = 4;
    prepared.name = 'GrainfieldsFarBeltSprites';
    prepared.needsUpdate = true;
    return prepared;
}

/**
 * Load every authored asset. `isCurrent` lets a superseded theme start abandon the
 * work: nothing is retained by the module, so a stale load simply disposes its results.
 * The horse (`horse: false` skips it) resolves to null when it cannot be loaded or read;
 * every other file is required.
 */
export async function loadGrainfieldsAssets({
    trees = Object.keys(GRAINFIELDS_TREE_URLS), horse = true, loader = new GLTFLoader(),
    textureLoader = new THREE.TextureLoader(), isCurrent = () => true,
} = {}) {
    const names = [...new Set(trees)];
    const layout = grainfieldsImpostorLayout();
    const [foliageGltf, impostorTexture, horseGltf, ...treeGltfs] = await Promise.all([
        loader.loadAsync(GRAINFIELDS_FOLIAGE_URL),
        layout && textureLoader ? textureLoader.loadAsync(GRAINFIELDS_IMPOSTOR_URL) : null,
        horse ? loadHorse(loader) : null,
        ...names.map((name) => {
            if (!GRAINFIELDS_TREE_URLS[name]) throw new Error(`[Grainfields] Unknown tree asset "${name}".`);
            return loader.loadAsync(GRAINFIELDS_TREE_URLS[name]);
        }),
    ]);
    const assets = {
        foliage: parseGrainfieldsMeshes(foliageGltf, 'Foliage'),
        trees: {},
        impostors: null,
        horse: null,
    };
    names.forEach((name, index) => {
        assets.trees[name] = parseGrainfieldsTree(treeGltfs[index], name);
    });
    if (impostorTexture) assets.impostors = { ...layout, texture: prepareGrainfieldsImpostors(impostorTexture) };
    if (horseGltf) assets.horse = adoptHorse(horseGltf);
    [foliageGltf, horseGltf, ...treeGltfs].filter(Boolean).forEach(releaseGltf);
    if (!isCurrent()) {
        disposeGrainfieldsAssets(assets);
        return null;
    }
    return assets;
}
