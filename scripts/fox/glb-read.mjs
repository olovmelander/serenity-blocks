/**
 * Read a binary glTF from Node: its JSON, any accessor as plain numbers, any buffer view's
 * bytes. (Just enough for the foxes' rigging and preview scripts: one buffer, no sparse
 * accessors.)
 */

import { readFileSync } from 'node:fs';

const SIZES = {
    SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16,
};
const BYTES = {
    5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4,
};

/**
 * @param {string} file
 * @returns {{ json: object, read: (accessor: number) => Float64Array, bytes: (view: number) => Buffer }}
 */
export function readGlb(file) {
    const buf = readFileSync(file);
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a binary glTF`);
    const jsonLength = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
    const bin = buf.subarray(20 + jsonLength + 8);
    const read = (index) => {
        const acc = json.accessors[index];
        const view = json.bufferViews[acc.bufferView];
        const size = SIZES[acc.type];
        const bytes = BYTES[acc.componentType];
        const offset = (view.byteOffset || 0) + (acc.byteOffset || 0);
        const stride = view.byteStride || size * bytes;
        const out = new Float64Array(acc.count * size);
        for (let i = 0; i < acc.count; i++) {
            for (let k = 0; k < size; k++) {
                const at = offset + i * stride + k * bytes;
                let v;
                if (acc.componentType === 5126) v = bin.readFloatLE(at);
                else if (acc.componentType === 5125) v = bin.readUInt32LE(at);
                else if (acc.componentType === 5123) v = bin.readUInt16LE(at) / (acc.normalized ? 65535 : 1);
                else if (acc.componentType === 5121) v = bin.readUInt8(at) / (acc.normalized ? 255 : 1);
                else throw new Error(`unsupported accessor component ${acc.componentType}`);
                out[i * size + k] = v;
            }
        }
        return out;
    };
    /** The bytes of a buffer view (an embedded image's file, say). */
    const bytes = (viewIndex) => {
        const view = json.bufferViews[viewIndex];
        return bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    };
    return { json, read, bytes };
}
