import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { halfBits } from '../../src/rendering/half-float.js';
import { fieldTextureData, fillFieldTextureRows } from '../../src/themes/high-coast/high-coast-field-data.js';

/** A seeded generator, so a failure repeats. */
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('halfBits', () => {
    it('returns three\'s DataUtils.toHalfFloat bits for every kind of value', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const edges = [
            0, -0, 1, -1, 0.5, 1 / 3, 65504, -65504, 65505, -65505, 70000, 1e9, -1e9, 65519, 65520,
            Infinity, -Infinity, NaN, 6.1e-5, 6.0e-5, 5.96e-8, 2.98e-8, 1e-10, -1e-10, 1e-40, 2047.5, 2048.5,
        ];
        for (const v of edges) expect(halfBits(v), String(v)).toBe(THREE.DataUtils.toHalfFloat(v));
        const random = rng(1);
        for (let k = 0; k < 200000; k++) {
            // Every exponent from far below the denormals to past the range, both signs.
            const v = (random() < 0.5 ? -1 : 1) * random() * 2 ** Math.floor(random() * 50 - 30);
            const want = THREE.DataUtils.toHalfFloat(v);
            if (halfBits(v) !== want) expect(halfBits(v), String(v)).toBe(want);
        }
        warn.mockRestore();
    });
});

/** High Coast's fieldTextureData as it was before 2026-10-31: the reference the new one must equal. */
function fieldTextureDataBefore(heights, sky, field) {
    const { size } = field;
    const cell = field.span / (size - 1);
    const range = field.hi - field.lo;
    const toHalf = THREE.DataUtils.toHalfFloat;
    const data = new Uint16Array(size * size * 4);
    const at = (i, j) => heights[Math.max(0, Math.min(size - 1, j)) * size + Math.max(0, Math.min(size - 1, i))];
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const gx = (at(i + 1, j - 1) + 2 * at(i + 1, j) + at(i + 1, j + 1)
                - at(i - 1, j - 1) - 2 * at(i - 1, j) - at(i - 1, j + 1)) / (8 * cell);
            const gz = (at(i - 1, j + 1) + 2 * at(i, j + 1) + at(i + 1, j + 1)
                - at(i - 1, j - 1) - 2 * at(i, j - 1) - at(i + 1, j - 1)) / (8 * cell);
            const o = (j * size + i) * 4;
            data[o] = toHalf((heights[j * size + i] - field.lo) / range);
            data[o + 1] = toHalf(gx);
            data[o + 2] = toHalf(gz);
            data[o + 3] = toHalf(sky[j * size + i] / 255);
        }
    }
    return data;
}

function makeField(size, seed) {
    const random = rng(seed);
    const field = { name: `t${size}`, size, span: 2500 * (size / 1024) + 1, lo: -70, hi: 270 };
    const heights = new Float32Array(size * size);
    const sky = new Uint8Array(size * size);
    for (let k = 0; k < heights.length; k++) {
        heights[k] = -70 + random() * 340 + (random() < 0.01 ? 4000 * (random() - 0.5) : 0); // a few cliffs
        sky[k] = Math.floor(random() * 256);
    }
    return { field, heights, sky };
}

describe('High Coast field texture data', () => {
    it('is the same data as before, whole and band by band', () => {
        for (const [size, seed] of [[2, 3], [3, 4], [17, 5], [64, 6], [129, 7]]) {
            const { field, heights, sky } = makeField(size, seed);
            const want = fieldTextureDataBefore(heights, sky, field);
            expect(fieldTextureData(heights, sky, field), `size ${size}`).toEqual(want);
            const banded = new Uint16Array(size * size * 4);
            for (let j = 0; j < size; j += 5) fillFieldTextureRows(banded, heights, sky, field, j, Math.min(size, j + 5));
            expect(banded, `size ${size} in bands`).toEqual(want);
        }
    });

    it('converts a 1024-post field much faster than before', () => {
        const { field, heights, sky } = makeField(1024, 9);
        const time = (fn) => {
            fn(heights, sky, field); // warm the JIT
            const t0 = performance.now();
            fn(heights, sky, field);
            return performance.now() - t0;
        };
        const before = time(fieldTextureDataBefore);
        const now = time(fieldTextureData);
        // Loose bound (shared CI runners); locally ~5x.
        expect(now).toBeLessThan(before * 0.75);
    });
});
