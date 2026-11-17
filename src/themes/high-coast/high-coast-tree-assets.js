/**
 * High Coast — the authored trees.
 *
 * The old Scots pine on the summit knoll and the forest's pines and spruces are generated in
 * Blender by scripts/blender/high_coast_assets.py. The old pine is a compact GLB: a quantised
 * bark mesh (its colour: sway, limb phase, occlusion, 0 plated bark … 1 orange bark; `_wood`:
 * dead silver wood, how far a vertex follows the rock) plus a point cloud of foliage sites (where
 * each needle spray attaches, how the wind may move it, how much sky it sees); its two needle
 * sprays are meshes in a second GLB. The forest stands half a kilometre and more from the eye, so
 * it is two sprite sheets with one layout: shading data (shade, needles or wood, hue or bark,
 * coverage) and the crowns' normals, of single trees and small groups.
 *
 * This module loads them and turns them into plain geometry, typed arrays and textures. Nothing
 * is kept by the module: the world that builds from them disposes them. A coast without them
 * (a failed request, a host with no loaders) draws its trees the old way (high-coast-pine.js,
 * high-coast-forest.js), so the land is never bare.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './assets/trees-manifest.json';
// Reads a (possibly normalised integer) attribute as floats, bit-identical to the getters.
import { attributeFloats as floats } from '../shared/attribute-floats.js';
import { loadDecodedTexture } from '../shared/decoded-texture.js';

export const HIGH_COAST_PINE_URL = new URL('./assets/pine-old.glb', import.meta.url).href;
export const HIGH_COAST_FOLIAGE_URL = new URL('./assets/high-coast-foliage.glb', import.meta.url).href;
export const HIGH_COAST_SPRITE_URL = new URL('./assets/high-coast-trees.png', import.meta.url).href;
export const HIGH_COAST_SPRITE_NORMAL_URL = new URL('./assets/high-coast-trees-normal.png', import.meta.url).href;
export const HIGH_COAST_TREE_SCHEMA = 1;

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
    ['normal', 'uv', 'color', '_wood'].forEach((name) => {
        if (source.attributes[name]) geometry.setAttribute(name, source.attributes[name]);
    });
    if (source.index) geometry.setIndex(source.index);
    geometry.computeBoundingSphere();
    geometry.name = object.name;
    return geometry;
}

function child(root, name) {
    const found = root.children.find((entry) => entry.name === name);
    if (!found?.geometry) throw new Error(`[High Coast] Tree asset is missing its "${name}" primitive.`);
    return found;
}

function checkSchema(root, label) {
    const version = root.userData?.schemaVersion;
    if (version !== HIGH_COAST_TREE_SCHEMA) {
        throw new Error(`[High Coast] ${label} has asset schema ${version}; expected ${HIGH_COAST_TREE_SCHEMA}.`);
    }
}

/** Turn the parsed old-pine GLB into bark geometry and foliage-site arrays. */
export function parseHighCoastPine(gltf) {
    const root = gltf.scene;
    const meta = root.userData || {};
    checkSchema(root, 'The old pine');
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
    const bark = meshGeometry(child(root, 'bark'));
    if (!bark.attributes._wood) throw new Error('[High Coast] The old pine is missing its "_wood" attribute.');
    if (!Array.isArray(meta.trunkLine) || meta.trunkLine.length < 2) {
        throw new Error('[High Coast] The old pine is missing its bole line.');
    }
    return {
        name: meta.name,
        foliage: meta.foliage,
        height: meta.height,
        crownBase: meta.crownBase,
        bark,
        // The bole and roots, the limbs, their branches, the twigs: where each ends in the index
        // buffer (a tier may stop drawing before the twigs).
        barkLevelIndices: Array.isArray(meta.barkLevelIndices) ? [...meta.barkLevelIndices] : [],
        // The bole's centre line: [x, y, z, radius] from the rock to the leader.
        trunkLine: meta.trunkLine.map((row) => [...row]),
        sites,
    };
}

/** Every mesh of the foliage GLB (the sprays), keyed by name. */
export function parseHighCoastFoliage(gltf) {
    const root = gltf.scene;
    checkSchema(root, 'The needle sprays');
    const meshes = {};
    root.children.forEach((object) => {
        if (object.geometry) meshes[object.name] = meshGeometry(object);
    });
    return { variants: root.userData.variants || 2, meshes };
}

/** Tile layout of the forest's sprite sheets, as written by the Blender bake. */
export function highCoastSpriteLayout() {
    const record = manifest.assets.find((entry) => entry.kind === 'sprites');
    if (!record) return null;
    return {
        atlasWidth: record.atlasWidth, atlasHeight: record.atlasHeight, gutter: record.gutter || 0, tiles: record.tiles,
    };
}

/** The sheets store shading data and normals, not colour: linear, mip-mapped, clamped. */
export function prepareHighCoastSprites(texture, name) {
    const prepared = texture;
    prepared.colorSpace = THREE.NoColorSpace;
    prepared.wrapS = THREE.ClampToEdgeWrapping;
    prepared.wrapT = THREE.ClampToEdgeWrapping;
    prepared.minFilter = THREE.LinearMipmapLinearFilter;
    prepared.magFilter = THREE.LinearFilter;
    prepared.generateMipmaps = true;
    prepared.anisotropy = 4;
    prepared.name = name;
    prepared.needsUpdate = true;
    return prepared;
}

/** GLTFLoader keeps its own parsed materials; release them. */
function releaseGltf(gltf) {
    gltf.scene.traverse((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material?.dispose?.());
    });
}

export function disposeHighCoastTrees(assets) {
    if (!assets) return;
    Object.values(assets.foliage?.meshes || {}).forEach((geometry) => geometry.dispose());
    assets.pine?.bark?.dispose();
    assets.sprites?.data?.dispose();
    assets.sprites?.normal?.dispose();
}

/**
 * Load the authored trees. Rejects when a file cannot be loaded or read (the caller then draws
 * the trees the old way); an aborted `signal` rejects with an AbortError and disposes the results.
 * @returns {Promise<{ pine: object, foliage: object, sprites: object }>}
 */
export async function loadHighCoastTrees({
    signal, loader = new GLTFLoader(), textureLoader = new THREE.TextureLoader(),
} = {}) {
    const layout = highCoastSpriteLayout();
    if (!layout) throw new Error('[High Coast] The tree manifest lists no sprite sheet.');
    const [pineGltf, foliageGltf, data, normal] = await Promise.all([
        loader.loadAsync(HIGH_COAST_PINE_URL),
        loader.loadAsync(HIGH_COAST_FOLIAGE_URL),
        loadDecodedTexture(HIGH_COAST_SPRITE_URL, textureLoader),
        loadDecodedTexture(HIGH_COAST_SPRITE_NORMAL_URL, textureLoader),
    ]);
    const assets = {
        pine: parseHighCoastPine(pineGltf),
        foliage: parseHighCoastFoliage(foliageGltf),
        sprites: {
            ...layout,
            data: prepareHighCoastSprites(data, 'HighCoastTreeSprites'),
            normal: prepareHighCoastSprites(normal, 'HighCoastTreeSpriteNormals'),
        },
    };
    [pineGltf, foliageGltf].forEach(releaseGltf);
    if (signal?.aborted) {
        disposeHighCoastTrees(assets);
        throw new DOMException('Aborted', 'AbortError');
    }
    return assets;
}
