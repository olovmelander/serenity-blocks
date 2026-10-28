// @ts-check
/**
 * A glTF attribute read out as plain floats, for the asset parsers that turn Blender GLBs into the
 * typed arrays a theme instances (forest family, Spring, Sunfall, Grainfields).
 *
 * The values are exactly those of calling `getX`/`getY`/`getZ`/`getW` per vertex, as the parsers
 * used to. In three r186 that is the raw component (`BufferAttribute`: `array[i * itemSize + c]`;
 * `InterleavedBufferAttribute`: `data.array[i * data.stride + offset + c]`), passed through
 * `MathUtils.denormalize` when the attribute is normalized. Here they are read straight from the
 * typed array with the same arithmetic, so every Float32 comes out bit-identical. The getter loop
 * dispatched a method call and a type switch per component. The bench (docs/THEME_FLEET_240_2026-10.md
 * §7) put the asset parse at 83-132 ms of main thread on every Fall and Sunfall start, and this is
 * most of that loop.
 * tests/unit/attribute-floats.test.js compares the two on every component type, both attribute
 * kinds, and widths below and above the item size.
 */

/** Unsigned normalized types: value / max (MathUtils.denormalize). @type {Map<Function, number>} */
const UNSIGNED_SCALE = new Map(/** @type {[Function, number][]} */ ([
    [Uint32Array, 4294967295.0],
    [Uint16Array, 65535.0],
    [Uint8Array, 255.0],
    [Uint8ClampedArray, 255.0],
]));

/** Signed normalized types: max(value / max, -1) (MathUtils.denormalize). @type {Map<Function, number>} */
const SIGNED_SCALE = new Map(/** @type {[Function, number][]} */ ([
    [Int32Array, 2147483647.0],
    [Int16Array, 32767.0],
    [Int8Array, 127.0],
]));

/**
 * @param {any} attribute a three BufferAttribute or InterleavedBufferAttribute
 * @param {number} [width] components per vertex to read (the parsers' `floats(attribute, width)`)
 * @returns {Float32Array} count × width floats
 */
export function attributeFloats(attribute, width = attribute.itemSize) {
    const interleaved = attribute.isInterleavedBufferAttribute === true;
    const array = interleaved ? attribute.data.array : attribute.array;
    const stride = interleaved ? attribute.data.stride : attribute.itemSize;
    const offset = interleaved ? attribute.offset : 0;
    const { count } = attribute;
    const out = new Float32Array(count * width);
    const kind = array.constructor;
    if (!attribute.normalized || kind === Float32Array) {
        for (let i = 0; i < count; i += 1) {
            const at = i * stride + offset;
            for (let c = 0; c < width; c += 1) out[i * width + c] = array[at + c];
        }
        return out;
    }
    const unsigned = UNSIGNED_SCALE.get(kind);
    if (unsigned !== undefined) {
        for (let i = 0; i < count; i += 1) {
            const at = i * stride + offset;
            for (let c = 0; c < width; c += 1) out[i * width + c] = array[at + c] / unsigned;
        }
        return out;
    }
    const signed = SIGNED_SCALE.get(kind);
    if (signed !== undefined) {
        for (let i = 0; i < count; i += 1) {
            const at = i * stride + offset;
            for (let c = 0; c < width; c += 1) out[i * width + c] = Math.max(array[at + c] / signed, -1.0);
        }
        return out;
    }
    // As three: a normalized attribute of any other type is invalid.
    throw new Error('THREE.MathUtils: Invalid component type.');
}
