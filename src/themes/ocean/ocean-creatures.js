/**
 * Ocean — the large animals' bodies: one small GLB (assets/creatures.glb) holding all nine, built
 * in Blender from numbers by scripts/blender/ocean_creatures_assets.py.
 *
 * Read here with a reader for that file's own layout (not GLTFLoader), so the browser and the
 * tests parse it the same way. Each animal becomes one BufferGeometry, nose along +z, one unit
 * long (a ray: one unit across its wings), with what each vertex is for the shaders
 * (ocean-giants.js): `aShape` (along the body, part and side, how far out along its fin, kind),
 * `aSkin` (ambient occlusion, two pattern masks, eye) and `aPivot` (where its part turns from).
 *
 * loadCreatures() fetches once per page and keeps the parsed pack for every world after.
 */

import * as THREE from 'three/webgpu';
import { KINDS } from './ocean-visits.js';

export const CREATURES_URL = new URL('./assets/creatures.glb', import.meta.url).href;

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENTS = {
    5120: Int8Array,
    5121: Uint8Array,
    5122: Int16Array,
    5123: Uint16Array,
    5125: Uint32Array,
    5126: Float32Array,
};
const WIDTH = {
    SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4,
};
/** What a normalised integer decodes to (glTF 2.0 §3.11). */
const UNIT = {
    5120: (q) => Math.max(q / 127, -1),
    5121: (q) => q / 255,
    5122: (q) => Math.max(q / 32767, -1),
    5123: (q) => q / 65535,
};

/** One accessor as a tightly packed typed array (vertex rows may be padded to a 4-byte stride). */
function readAccessor(doc, bin, index) {
    const acc = doc.accessors[index];
    const view = doc.bufferViews[acc.bufferView];
    const Type = COMPONENTS[acc.componentType];
    const width = WIDTH[acc.type];
    const bytes = Type.BYTES_PER_ELEMENT;
    const offset = (view.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = view.byteStride || width * bytes;
    const out = new Type(acc.count * width);
    if (stride === width * bytes && (bin.byteOffset + offset) % bytes === 0) {
        out.set(new Type(bin.buffer, bin.byteOffset + offset, acc.count * width));
    } else {
        const data = new DataView(bin.buffer, bin.byteOffset + offset);
        const get = {
            1: (o) => (Type === Int8Array ? data.getInt8(o) : data.getUint8(o)),
            2: (o) => (Type === Int16Array ? data.getInt16(o, true) : data.getUint16(o, true)),
            4: (o) => (Type === Float32Array ? data.getFloat32(o, true) : data.getUint32(o, true)),
        }[bytes];
        for (let i = 0; i < acc.count; i++) {
            for (let c = 0; c < width; c++) out[i * width + c] = get(i * stride + c * bytes);
        }
    }
    return {
        array: out, width, normalized: acc.normalized === true, componentType: acc.componentType,
    };
}

function toFloats({
    array, width, normalized, componentType,
}, scale = null, offset = null) {
    const out = new Float32Array(array.length);
    const decode = normalized ? UNIT[componentType] : null;
    for (let i = 0; i < array.length; i++) {
        const c = i % width;
        let v = decode ? decode(array[i]) : array[i];
        if (scale) v *= scale[c];
        if (offset) v += offset[c];
        out[i] = v;
    }
    return out;
}

/**
 * Parse the pack. Returns { kinds: { [name]: { geometry, kind, family, nose, tail, triangles } },
 * triangles, bytes }, or throws when the file is not the pack.
 * @param {ArrayBuffer|Uint8Array} source
 */
export function parseCreatures(source) {
    const u8 = source instanceof Uint8Array ? source : new Uint8Array(source);
    const head = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (head.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB');
    let at = 12;
    let doc = null;
    let bin = null;
    while (at + 8 <= u8.byteLength) {
        const length = head.getUint32(at, true);
        const type = head.getUint32(at + 4, true);
        const body = u8.subarray(at + 8, at + 8 + length);
        if (type === CHUNK_JSON) doc = JSON.parse(new TextDecoder().decode(body));
        else if (type === CHUNK_BIN) bin = body;
        at += 8 + length;
    }
    if (!doc || !bin || !doc.scenes?.[0]?.extras?.oceanCreatures) throw new Error('not the ocean creature pack');
    const kinds = {};
    let triangles = 0;
    doc.nodes.forEach((node) => {
        if (node.mesh === undefined) return;
        const prim = doc.meshes[node.mesh].primitives[0];
        const read = (name) => readAccessor(doc, bin, prim.attributes[name]);
        const geometry = new THREE.BufferGeometry();
        // POSITION is normalised int16: the node's scale and translation restore units.
        geometry.setAttribute('position', new THREE.BufferAttribute(
            toFloats(read('POSITION'), node.scale || [1, 1, 1], node.translation || [0, 0, 0]),
            3,
        ));
        geometry.setAttribute('normal', new THREE.BufferAttribute(toFloats(read('NORMAL')), 3));
        const shape = read('_SHAPE');
        geometry.setAttribute('aShape', new THREE.BufferAttribute(shape.array, 4, true));
        const skin = read('_SKIN');
        geometry.setAttribute('aSkin', new THREE.BufferAttribute(skin.array, 4, true));
        const pivot = read('_PIVOT');
        geometry.setAttribute('aPivot', new THREE.BufferAttribute(pivot.array, 4, true));
        const index = readAccessor(doc, bin, prim.indices).array;
        geometry.setIndex(new THREE.BufferAttribute(index, 1));
        geometry.computeBoundingSphere();
        const extras = node.extras || {};
        const { name } = node;
        geometry.name = `OceanCreature:${name}`;
        kinds[name] = {
            geometry,
            kind: extras.kind ?? KINDS.indexOf(name),
            family: extras.family ?? 0,
            nose: extras.nose ?? 0.5,
            tail: extras.tail ?? -0.5,
            triangles: index.length / 3,
        };
        triangles += index.length / 3;
    });
    return { kinds, triangles, bytes: u8.byteLength };
}

let pending = null;
let pack = null;

/** The pack once it has arrived (null before, or if it never can). */
export function creaturesLoaded() {
    return pack;
}

/**
 * Fetch and parse the pack, once per page. Resolves null when it cannot be read: the sea then
 * goes on without its large animals.
 */
export function loadCreatures(url = CREATURES_URL) {
    if (pack) return Promise.resolve(pack);
    if (!pending) {
        pending = (async () => {
            try {
                if (typeof fetch !== 'function') return null;
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                pack = parseCreatures(await response.arrayBuffer());
                return pack;
            } catch (error) {
                console.warn('[Ocean] the large animals did not arrive:', error?.message || error);
                pending = null;
                return null;
            }
        })();
    }
    return pending;
}

/** Hand a pack in directly (tests read the file from disk). */
export function useCreatures(next) {
    pack = next;
    pending = next ? Promise.resolve(next) : null;
    return pack;
}
