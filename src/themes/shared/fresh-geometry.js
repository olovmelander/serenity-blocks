// @ts-check
/**
 * A new BufferGeometry over the same vertex arrays, for geometry a theme keeps for the session.
 *
 * A theme's dispose() releases its geometry's GPU buffers, and a later start that draws the same
 * BufferGeometry uploads them again. three r186 cannot do that for interleaved attributes:
 * `destroyAttribute` destroys the InterleavedBuffer's GPU buffer but forgets only the attribute's
 * record, so the next upload finds the destroyed buffer and every draw fails ("used in submit while
 * destroyed"; Fall and Sunfall drew black on a second start in one renderer). Each start therefore
 * gets its own geometry and attribute objects (and its own InterleavedBuffers) over the shared
 * arrays: nothing is copied, nothing old is touched, and dispose() stays the world's to call.
 * Only geometry nothing writes to belongs in a session cache.
 */
import * as THREE from 'three/webgpu';

/**
 * @param {THREE.BufferAttribute | THREE.InterleavedBufferAttribute} attribute
 * @param {Map<THREE.InterleavedBuffer, THREE.InterleavedBuffer>} buffers
 */
function freshAttribute(attribute, buffers) {
    let out;
    if (attribute instanceof THREE.InterleavedBufferAttribute) {
        const source = attribute.data;
        let data = buffers.get(source);
        if (!data) {
            data = new THREE.InterleavedBuffer(source.array, source.stride);
            data.setUsage(source.usage);
            buffers.set(source, data);
        }
        out = new THREE.InterleavedBufferAttribute(data, attribute.itemSize, attribute.offset, attribute.normalized);
    } else {
        out = new THREE.BufferAttribute(attribute.array, attribute.itemSize, attribute.normalized);
        out.setUsage(attribute.usage);
        out.gpuType = attribute.gpuType;
    }
    out.name = attribute.name;
    return out;
}

/**
 * @param {THREE.BufferGeometry} geometry
 * @returns {THREE.BufferGeometry}
 */
export function freshGeometry(geometry) {
    const buffers = new Map();
    const out = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
        out.setAttribute(name, freshAttribute(attribute, buffers));
    }
    for (const [name, list] of Object.entries(geometry.morphAttributes)) {
        out.morphAttributes[name] = list.map((attribute) => freshAttribute(attribute, buffers));
    }
    out.morphTargetsRelative = geometry.morphTargetsRelative;
    if (geometry.index) out.setIndex(freshAttribute(geometry.index, buffers));
    for (const g of geometry.groups) out.addGroup(g.start, g.count, g.materialIndex);
    out.setDrawRange(geometry.drawRange.start, geometry.drawRange.count);
    out.boundingSphere = geometry.boundingSphere ? geometry.boundingSphere.clone() : null;
    out.boundingBox = geometry.boundingBox ? geometry.boundingBox.clone() : null;
    out.name = geometry.name;
    out.userData = { ...geometry.userData };
    return out;
}
