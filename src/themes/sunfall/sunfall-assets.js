/**
 * Sunfall — the doline's authored geometry, from scripts/blender/sunfall_assets.py.
 *
 * Three compact GLBs (KHR_mesh_quantization) and a manifest:
 * - `sunfall-shell.glb`: the chamber in chunks small enough for 16-bit indices. Each vertex
 *   carries Cycles bakes: `color` = (ambient occlusion, sky light, sun station 0, sun station 1)
 *   and `_bake` = (sun station 2, 3, 4, flowstone mask). Light is stored as log2 over
 *   `manifest.light.stops` stops below a ceiling, 0 meaning none (`decodeSunfallLight`).
 * - `sunfall-ledge.glb`: the rimstone terrace the eye stands on, the same layout with the
 *   spikemoss mask in place of flowstone.
 * - `sunfall-crowns.glb`: six unit crowns (top at y = 0, `color` = (occlusion, height in the
 *   crown)) and the canopy plan as points: crown top position and `_crown` = (radius,
 *   tree height, variant + tone, kind: 1 for an emergent).
 *
 * Positions are dequantised to metres once at load; normals and bakes stay in their compact
 * normalised encodings, which the node materials read as they are.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './assets/asset-manifest.json';

export const SUNFALL_ASSET_SCHEMA = 1;
export const SUNFALL_ASSET_MANIFEST = manifest;
export const SUNFALL_ASSET_URLS = Object.freeze({
    shell: new URL('./assets/sunfall-shell.glb', import.meta.url).href,
    ledge: new URL('./assets/sunfall-ledge.glb', import.meta.url).href,
    crowns: new URL('./assets/sunfall-crowns.glb', import.meta.url).href,
});

/** Decode one baked light byte (0..1 normalised) the way the shaders do. */
export function decodeSunfallLight(q, ceiling, stops = manifest.light.stops) {
    if (!(q > 0.5 / 255)) return 0;
    return ceiling * 2 ** (q * stops - stops);
}

function floats(attribute, width = attribute.itemSize) {
    const out = new Float32Array(attribute.count * width);
    const getters = ['getX', 'getY', 'getZ', 'getW'];
    for (let i = 0; i < attribute.count; i += 1) {
        for (let c = 0; c < width; c += 1) out[i * width + c] = attribute[getters[c]](i);
    }
    return out;
}

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

function meshGeometry(object) {
    const source = object.geometry;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(worldPositions(object), 3));
    ['normal', 'color', '_bake'].forEach((name) => {
        if (source.attributes[name]) geometry.setAttribute(name, source.attributes[name]);
    });
    if (source.index) geometry.setIndex(source.index);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    geometry.name = object.name;
    return geometry;
}

function checkSchema(gltf, kind) {
    const extras = gltf.scene.userData || {};
    if (extras.schemaVersion !== SUNFALL_ASSET_SCHEMA || extras.kind !== kind) {
        throw new Error(`[Sunfall] ${kind} asset has schema ${extras.schemaVersion}/${extras.kind}; `
            + `expected ${SUNFALL_ASSET_SCHEMA}/${kind}.`);
    }
}

function meshesNamed(gltf, prefix) {
    const out = [];
    gltf.scene.traverse((object) => {
        if (object.isMesh && object.name.startsWith(prefix)) out.push(object);
    });
    out.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    return out.map(meshGeometry);
}

/** Turn the three parsed GLBs into geometries and the canopy plan. */
export function parseSunfallAssets({ shell, ledge, crowns }) {
    checkSchema(shell, 'shell');
    checkSchema(ledge, 'ledge');
    checkSchema(crowns, 'crowns');
    let planObject = null;
    crowns.scene.traverse((object) => {
        if (object.isPoints && object.name === 'CanopyPlan') planObject = object;
    });
    if (!planObject) throw new Error('[Sunfall] The crowns asset has no canopy plan.');
    const position = worldPositions(planObject);
    const crown = floats(planObject.geometry.attributes._crown, 4);
    return {
        manifest,
        shell: meshesNamed(shell, 'Shell'),
        ledge: meshesNamed(ledge, 'Ledge'),
        crowns: meshesNamed(crowns, 'Crown'),
        plan: { count: position.length / 3, position, crown },
    };
}

/** GLTFLoader's own materials are never drawn; its attributes live on in our geometries. */
function releaseGltf(gltf) {
    gltf?.scene?.traverse((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material?.dispose?.());
    });
}

/**
 * Load every authored asset. `isCurrent` lets a superseded theme start abandon the work:
 * a stale load disposes what it made and resolves to null.
 */
export async function loadSunfallAssets({ loader = new GLTFLoader(), isCurrent = () => true } = {}) {
    const [shell, ledge, crowns] = await Promise.all([
        loader.loadAsync(SUNFALL_ASSET_URLS.shell),
        loader.loadAsync(SUNFALL_ASSET_URLS.ledge),
        loader.loadAsync(SUNFALL_ASSET_URLS.crowns),
    ]);
    const assets = parseSunfallAssets({ shell, ledge, crowns });
    [shell, ledge, crowns].forEach(releaseGltf);
    if (!isCurrent()) {
        disposeSunfallAssets(assets);
        return null;
    }
    return assets;
}

export function disposeSunfallAssets(assets) {
    if (!assets) return;
    [...(assets.shell || []), ...(assets.ledge || []), ...(assets.crowns || [])].forEach((g) => g.dispose());
}
