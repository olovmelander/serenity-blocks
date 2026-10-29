// @ts-check
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { attributeFloats } from '../../src/themes/shared/attribute-floats.js';

/** The parsers' original reader (fall-assets.js and eight copies), kept as the reference. */
function getterFloats(attribute, width = attribute.itemSize) {
    const out = new Float32Array(attribute.count * width);
    const getters = ['getX', 'getY', 'getZ', 'getW'];
    for (let i = 0; i < attribute.count; i += 1) {
        for (let c = 0; c < width; c += 1) out[i * width + c] = attribute[getters[c]](i);
    }
    return out;
}

/** Deterministic pseudo-random fill over a typed array's whole range. */
function fill(array, seed = 7) {
    let s = seed;
    const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s; };
    for (let i = 0; i < array.length; i += 1) {
        if (array instanceof Float32Array) array[i] = (next() / 2 ** 32 - 0.5) * 2000;
        else array[i] = next(); // wraps into the type's range (signed types get negatives)
    }
    // The signed extremes, where denormalize clamps to -1.
    if (array instanceof Int8Array) array[0] = -128;
    if (array instanceof Int16Array) array[0] = -32768;
    if (array instanceof Int32Array) array[0] = -2147483648;
    return array;
}

function sameBits(a, b) {
    expect(a.length).toBe(b.length);
    const ua = new Uint32Array(a.buffer, a.byteOffset, a.length);
    const ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
    for (let i = 0; i < ua.length; i += 1) {
        if (ua[i] !== ub[i]) throw new Error(`component ${i}: ${a[i]} vs ${b[i]}`);
    }
}

const TYPES = [Float32Array, Uint32Array, Uint16Array, Uint8Array, Uint8ClampedArray, Int32Array, Int16Array, Int8Array];

describe('attributeFloats', () => {
    for (const Type of TYPES) {
        for (const normalized of [false, true]) {
            it(`matches the getters for ${Type.name}${normalized ? ' (normalized)' : ''}, item sizes 1-4`, () => {
                for (const itemSize of [1, 2, 3, 4]) {
                    const attr = new THREE.BufferAttribute(fill(new Type(37 * itemSize), itemSize), itemSize, normalized);
                    sameBits(attributeFloats(attr), getterFloats(attr));
                    if (itemSize > 1) sameBits(attributeFloats(attr, itemSize - 1), getterFloats(attr, itemSize - 1));
                }
            });
        }
    }

    it('matches the getters on an interleaved attribute (stride and offset)', () => {
        for (const Type of [Int16Array, Uint16Array, Float32Array, Int8Array]) {
            const data = new THREE.InterleavedBuffer(fill(new Type(8 * 25)), 8);
            for (const normalized of [false, true]) {
                const a = new THREE.InterleavedBufferAttribute(data, 3, 1, normalized);
                const b = new THREE.InterleavedBufferAttribute(data, 4, 4, normalized);
                sameBits(attributeFloats(a), getterFloats(a));
                sameBits(attributeFloats(b, 4), getterFloats(b, 4));
                sameBits(attributeFloats(b, 2), getterFloats(b, 2));
            }
        }
    });

    it('reads past the item size as the getters do (width 4 on an itemSize-3 attribute)', () => {
        const attr = new THREE.BufferAttribute(fill(new Int16Array(3 * 9)), 3, true);
        sameBits(attributeFloats(attr, 4), getterFloats(attr, 4));
    });

    it('rejects a normalized attribute of an invalid type, as three does', () => {
        const attr = new THREE.BufferAttribute(new Float64Array(6), 3, true);
        expect(() => getterFloats(attr)).toThrow('Invalid component type');
        expect(() => attributeFloats(attr)).toThrow('Invalid component type');
    });
});
