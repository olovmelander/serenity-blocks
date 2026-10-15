/* eslint-disable no-restricted-globals -- `self` is the Worker global scope */
/**
 * Web Worker entry for Thermal Bloom's CPU bakes (thermal-bloom-bake-loader.js). Pure math only:
 * no three import. Each job is one bake, posted back with its typed arrays transferred; the main
 * thread primes the shared bake cache with them.
 */
import {
    bakeCellular, bakeNoise, bakeVapourNoise, computeStairArrays,
} from './thermal-bloom-bake.js';

const BAKES = {
    noise: bakeNoise,
    cellular: bakeCellular,
    vapour: bakeVapourNoise,
    stair: computeStairArrays,
};

/** The typed arrays' buffers in a bake result (top level, arrays of them, objects of them). */
function buffersOf(value, out = new Set(), depth = 0) {
    if (!value || depth > 2) return out;
    if (ArrayBuffer.isView(value)) out.add(value.buffer);
    else if (Array.isArray(value)) value.forEach((item) => buffersOf(item, out, depth + 1));
    else if (typeof value === 'object') Object.values(value).forEach((item) => buffersOf(item, out, depth + 1));
    return out;
}

self.onmessage = (event) => {
    const { id, kind, args } = event?.data || {};
    try {
        const bake = BAKES[kind];
        if (!bake) throw new Error(`unknown bake ${kind}`);
        const value = bake(...(args || []));
        self.postMessage({ id, ok: true, value }, [...buffersOf(value)]);
    } catch (error) {
        self.postMessage({ id, ok: false, error: String(error?.message || error) });
    }
};
