import * as THREE from 'three/webgpu';
import {
    FOREST_FAR, FOREST_SPECIMENS, buildForestPull, forestBarkTile, forestFarIndex,
} from './odyssey-forest-models-decode.js';
import { FOREST_INSTANCE, buildForestSlots } from './odyssey-forest-material.js';

/**
 * THE FOREST'S MESHES (2026-11-24): one draw a bucket, whatever stands in it (the shape is pulled in the
 * vertex shader, odyssey-forest-material.js). A near bucket's geometry is only the slots its biggest
 * tree needs; a smaller one's unused slots collapse onto its foot.
 */

const LEAVES_URL = new URL('../assets/forest/leaves.png', import.meta.url).href;
const FAR_URL = new URL('../assets/forest/far.png', import.meta.url).href;

function dataTexture() {
    const tex = new THREE.Texture();
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.flipY = false;
    tex.anisotropy = 4;
    return tex;
}

/**
 * The pull texture (built here) and the two photographs (they arrive a moment later; until then the
 * forest is not drawn: `state.ready`). No browser (the unit tests build the world in node): no fetch.
 * @param {object} [opts]
 * @param {boolean} [opts.load] fetch the photographs at all
 * @param {() => void} [opts.onReady] called when they have landed
 */
export function createForestTextures({ load: wanted = true, onReady = null } = {}) {
    const pull = buildForestPull();
    const half = new Uint16Array(pull.data.length);
    for (let i = 0; i < half.length; i += 1) half[i] = THREE.DataUtils.toHalfFloat(pull.data[i]);
    const pullTex = new THREE.DataTexture(half, pull.width, pull.height, THREE.RGBAFormat, THREE.HalfFloatType);
    pullTex.minFilter = THREE.NearestFilter;
    pullTex.magFilter = THREE.NearestFilter;
    pullTex.generateMipmaps = false;
    pullTex.needsUpdate = true;
    const leafTex = dataTexture();
    const farTex = FOREST_FAR ? dataTexture() : null;
    const state = { ready: false, disposed: false, error: null };
    let waiting = 0;
    const load = (tex, url) => {
        waiting += 1;
        fetch(url)
            .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`${url} ${res.status}`))))
            .then((blob) => createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
            .then((bitmap) => {
                if (state.disposed) { bitmap.close?.(); return; }
                tex.image = bitmap;
                tex.needsUpdate = true;
                waiting -= 1;
                if (waiting === 0) {
                    state.ready = true;
                    onReady?.();
                }
            })
            .catch((error) => {
                state.error = error;
                console.warn('[OdysseyForest] photographs not loaded:', error?.message || error);
            });
    };
    if (wanted && typeof createImageBitmap === 'function' && typeof fetch === 'function' && typeof document !== 'undefined') {
        load(leafTex, LEAVES_URL);
        if (farTex) load(farTex, FAR_URL);
    }
    return {
        pullTex,
        leafTex,
        farTex,
        state,
        dispose() {
            state.disposed = true;
            [pullTex, leafTex, farTex].forEach((tex) => tex?.dispose());
        },
    };
}

/** The far frames of a specimen: [tile, half width, (middle, half height) low, (middle, half height) high]. */
function farFrames(id) {
    const at = forestFarIndex(id);
    if (at < 0) return null;
    const views = FOREST_FAR.azimuths * FOREST_FAR.elevations.length;
    const [low, high] = FOREST_FAR.specimens[at].frames;
    return {
        tile: at * views, wide: low[0], lowMid: low[1], lowHalf: low[2], highMid: high[1], highHalf: high[2],
    };
}

/**
 * One bucket's mesh.
 * @param {{lod: 'hero'|'mid'|'far', items: Array<any>}} bucket placements (odyssey-forest-scatter.js)
 * @param {{near: THREE.Material, far: THREE.Material}} materials
 * @param {object} [opts]
 * @param {(x: number, z: number) => number} [opts.sunVisAt] the terrain's sun visibility
 * @param {number} [opts.cardShare] the share of each tree's cards this tier draws, fewer and larger
 * @returns {THREE.Mesh | null}
 */
export function buildForestMesh(bucket, materials, { sunVisAt = () => 1, cardShare = 1 } = {}) {
    const pull = buildForestPull();
    const far = bucket.lod === 'far';
    // Front to back along the journey (it goes north, down z), so hidden leaves fail the depth test.
    const items = bucket.items.filter((t) => !far || forestFarIndex(FOREST_SPECIMENS[t.specimen].id) >= 0)
        .sort((a, b) => b.z - a.z);
    const n = items.length;
    if (!n) return null;
    const { stride } = FOREST_INSTANCE;
    const data = new Float32Array(n * stride);
    let cardSlots = 0;
    let barkSlots = 0;
    items.forEach((t, i) => {
        const spec = FOREST_SPECIMENS[t.specimen];
        const o = i * stride;
        data[o] = t.x;
        data[o + 1] = t.y;
        data[o + 2] = t.z;
        data[o + 3] = t.rot;
        data[o + 4] = t.scale;
        data[o + 5] = t.scaleY;
        data[o + 6] = t.leanX;
        data[o + 7] = t.leanZ;
        let sizeLane = 1;
        let trunkLane = 0;
        if (far) {
            const f = farFrames(spec.id);
            data[o + 8] = f.tile;
            data[o + 9] = f.wide;
            data[o + 10] = f.lowMid;
            data[o + 11] = f.lowHalf;
            sizeLane = f.highMid;
            trunkLane = f.highHalf;
        } else {
            const r = pull.ranges[bucket.lod][t.specimen];
            const cards = Math.min(r.cards, Math.max(Math.min(r.cards, 12), Math.ceil(r.cards * cardShare)));
            data[o + 8] = r.cardAt;
            data[o + 9] = cards;
            data[o + 10] = r.barkAt;
            data[o + 11] = r.barkVerts;
            cardSlots = Math.max(cardSlots, cards);
            barkSlots = Math.max(barkSlots, r.barkVerts);
            trunkLane = forestBarkTile(spec);
            // Fewer cards cover the same crown, each a little larger.
            sizeLane = r.cards > 0 ? Math.min(1.45, Math.sqrt(r.cards / Math.max(1, cards))) : 1;
        }
        data.set(t.crown, o + 12);
        data[o + 15] = t.phase;
        data.set(t.shade, o + 16);
        data[o + 19] = sizeLane;
        data.set(t.trunk, o + 20);
        data[o + 23] = trunkLane;
        data[o + 24] = Math.min(1, Math.max(0, sunVisAt(t.x, t.z)));
        data[o + 25] = t.shadeTop;
        data[o + 26] = t.open;
        data[o + 27] = Math.max(0.5, spec.height * t.scaleY);
    });
    const geo = new THREE.InstancedBufferGeometry();
    const { slots, index } = buildForestSlots(far ? 1 : cardSlots, far ? 0 : barkSlots);
    geo.setAttribute('position', new THREE.BufferAttribute(slots, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const buffer = new THREE.InstancedInterleavedBuffer(data, stride, 1);
    FOREST_INSTANCE.layout.forEach(([name, offset]) => {
        geo.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, offset));
    });
    geo.instanceCount = n;

    let cx = 0; let cz = 0; let minY = Infinity; let maxY = -Infinity; let crown = 0;
    items.forEach((t) => {
        const spec = FOREST_SPECIMENS[t.specimen];
        cx += t.x / n;
        cz += t.z / n;
        minY = Math.min(minY, t.y);
        maxY = Math.max(maxY, t.y + (spec.height * t.scaleY));
        crown = Math.max(crown, spec.reach * t.scale);
    });
    const spread = items.reduce((m, t) => Math.max(m, Math.hypot(t.x - cx, t.z - cz)), 0);
    const sphere = new THREE.Sphere(
        new THREE.Vector3(cx, (minY + maxY) / 2, cz),
        Math.hypot(spread + crown + 6, (maxY - minY) / 2) + 8,
    );
    geo.boundingSphere = sphere;
    const mesh = new THREE.Mesh(geo, far ? materials.far : materials.near);
    mesh.frustumCulled = true;
    mesh.raycast = () => {};
    mesh.userData.centre = new THREE.Vector2(cx, cz);
    mesh.userData.radius = spread;
    mesh.userData.forest = {
        lod: bucket.lod, trees: n, triangles: n * ((cardSlots * 2) + (barkSlots / 3) + (far ? 2 : 0)),
    };
    // Keeps `?worldOnly=forest` working, which is the compile-bisect lever.
    mesh.name = `odyssey-world-forest-${bucket.lod}`;
    return mesh;
}
