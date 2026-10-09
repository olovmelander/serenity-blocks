/**
 * Sakura Twilight — the garden's authored assets.
 *
 * Trees, blossom sprays, garden furniture and the mountain are generated in Blender by
 * scripts/blender/sakura_twilight_assets.py and written as compact GLBs: quantised bark
 * meshes plus a point cloud of blossom sites (where each spray attaches, how the wind may
 * move it, how much sky it sees). This module loads them and turns them into plain
 * geometry and typed arrays the garden can instance.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './assets/asset-manifest.json';

export const SAKURA_TREE_URLS = Object.freeze({
    'sakura-hero-weeping': new URL('./assets/sakura-hero-weeping.glb', import.meta.url).href,
    'sakura-hero-spreading': new URL('./assets/sakura-hero-spreading.glb', import.meta.url).href,
    'sakura-grove-a': new URL('./assets/sakura-grove-a.glb', import.meta.url).href,
    'sakura-grove-b': new URL('./assets/sakura-grove-b.glb', import.meta.url).href,
    'sakura-grove-c': new URL('./assets/sakura-grove-c.glb', import.meta.url).href,
    'sakura-grove-weeping': new URL('./assets/sakura-grove-weeping.glb', import.meta.url).href,
});
export const SAKURA_BLOSSOM_URL = new URL('./assets/sakura-blossoms.glb', import.meta.url).href;
export const SAKURA_PROPS_URL = new URL('./assets/sakura-props.glb', import.meta.url).href;
export const SAKURA_FUJI_URL = new URL('./assets/sakura-fuji.glb', import.meta.url).href;
export const SAKURA_IMPOSTOR_URL = new URL('./assets/sakura-impostors.png', import.meta.url).href;
export const SAKURA_FOX_URL = new URL('./assets/sakura-fox.glb', import.meta.url).href;
export const SAKURA_ASSET_SCHEMA = 1;

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
    if (!found?.geometry) throw new Error(`[Sakura] Asset is missing its "${name}" primitive.`);
    return found;
}

function checkSchema(root, label) {
    const version = root.userData?.schemaVersion;
    if (version !== SAKURA_ASSET_SCHEMA) {
        throw new Error(`[Sakura] ${label} has asset schema ${version}; expected ${SAKURA_ASSET_SCHEMA}.`);
    }
    return root.userData;
}

/** Turn one parsed tree GLB into bark geometry and blossom-site arrays. */
export function parseSakuraTree(gltf, name = '') {
    const root = gltf.scene;
    const meta = checkSchema(root, `Tree "${name}"`);
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
        role: meta.role,
        habit: meta.habit,
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

/** Every mesh of a pack (sprays and petals, or the garden furniture), keyed by name. */
export function parseSakuraPack(gltf, label) {
    const root = gltf.scene;
    const meta = checkSchema(root, label);
    const meshes = {};
    root.children.forEach((object) => {
        if (object.geometry) meshes[object.name] = meshGeometry(object);
    });
    return { variants: meta.variants || 0, records: meta.meshes || {}, meshes };
}

/** GLTFLoader keeps its own parsed geometry; release what the garden did not adopt. */
function releaseGltf(gltf) {
    gltf.scene.traverse((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material?.dispose?.());
    });
}

export function disposeSakuraAssets(assets) {
    if (!assets) return;
    [assets.blossoms, assets.props].forEach((pack) => {
        Object.values(pack?.meshes || {}).forEach((geometry) => geometry.dispose());
    });
    Object.values(assets.trees || {}).forEach((tree) => tree.bark?.dispose());
    assets.fuji?.geometry?.dispose();
    assets.impostors?.texture?.dispose();
    // The fox keeps its own geometry, material and texture: the garden only borrows them.
    assets.fox?.scene?.traverse((object) => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
            material?.map?.dispose();
            material?.dispose?.();
        });
    });
}

/** Tile layout of the far-shore sprite sheet, as written by the Blender bake. */
export function sakuraImpostorLayout() {
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
    prepared.name = 'SakuraFarShoreSprites';
    prepared.needsUpdate = true;
    return prepared;
}

/**
 * Load every authored asset. `isCurrent` lets a superseded theme start abandon the
 * work: nothing is retained by the module, so a stale load simply disposes its results.
 */
export async function loadSakuraAssets({
    trees = Object.keys(SAKURA_TREE_URLS), loader = new GLTFLoader(), textureLoader = new THREE.TextureLoader(),
    isCurrent = () => true,
} = {}) {
    const names = [...new Set(trees)];
    const layout = sakuraImpostorLayout();
    const [blossomGltf, propsGltf, fujiGltf, impostorTexture, foxGltf, ...treeGltfs] = await Promise.all([
        loader.loadAsync(SAKURA_BLOSSOM_URL),
        loader.loadAsync(SAKURA_PROPS_URL),
        loader.loadAsync(SAKURA_FUJI_URL),
        layout && textureLoader ? textureLoader.loadAsync(SAKURA_IMPOSTOR_URL) : null,
        // The garden is whole without its foxes: a failed download only leaves them out.
        loader.loadAsync(SAKURA_FOX_URL).catch(() => null),
        ...names.map((name) => {
            if (!SAKURA_TREE_URLS[name]) throw new Error(`[Sakura] Unknown tree asset "${name}".`);
            return loader.loadAsync(SAKURA_TREE_URLS[name]);
        }),
    ]);
    const fujiMeta = checkSchema(fujiGltf.scene, 'The mountain');
    const assets = {
        blossoms: parseSakuraPack(blossomGltf, 'The blossom pack'),
        props: parseSakuraPack(propsGltf, 'The garden pack'),
        fuji: { geometry: meshGeometry(child(fujiGltf.scene, 'fuji')), baseRadius: fujiMeta.baseRadius },
        trees: {},
        impostors: null,
        fox: foxGltf?.scene ? { scene: foxGltf.scene, animations: foxGltf.animations || [] } : null,
    };
    names.forEach((name, index) => {
        assets.trees[name] = parseSakuraTree(treeGltfs[index], name);
    });
    if (impostorTexture) assets.impostors = { ...layout, texture: prepareImpostorTexture(impostorTexture) };
    [blossomGltf, propsGltf, fujiGltf, ...treeGltfs].forEach(releaseGltf);
    if (!isCurrent()) {
        disposeSakuraAssets(assets);
        return null;
    }
    return assets;
}
