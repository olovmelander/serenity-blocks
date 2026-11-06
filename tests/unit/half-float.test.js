import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { halfBits } from '../../src/rendering/half-float.js';
import { fieldTextureData, fillFieldTextureRows } from '../../src/themes/high-coast/high-coast-field-data.js';
import { fieldTextureDataBefore, makeField, rng } from '../../scripts/lib/high-coast-field-reference.mjs';

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

// Speed is measured by hand (npm run perf:high-coast:field), not here: inside the
// test runner on shared CI hardware the measured speedup shrank so far that a
// timing bound failed at random.
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
});
