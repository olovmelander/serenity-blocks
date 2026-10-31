/**
 * Painted Ages builds its first visit in steps (2026-10-31): the field textures' half floats in
 * bands with the bit-identical rendering/half-float.js `halfBits`, the land's mesh by the clock, and
 * the world's build a few parts to a breath. What is built must not change.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { FIELDS } from '../../src/themes/painted-ages/painted-ages-core.js';
import { fieldTextureData, fillFieldTextureRows } from '../../src/themes/painted-ages/painted-ages-field-data.js';
import { PaintedAgesWorld } from '../../src/themes/painted-ages/painted-ages-world.js';

/** The field data as it was made before 2026-10-31 (three's toHalfFloat through an edge clamp). */
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

describe('Painted Ages first build in steps', () => {
    it('prepares each field\'s texture data bit for bit as before, whole or in bands', () => {
        for (const name of ['near', 'far']) {
            const field = { ...FIELDS[name], size: 97 };
            const n = field.size * field.size;
            const heights = new Float32Array(n);
            const sky = new Uint8Array(n);
            for (let i = 0; i < n; i++) {
                // Rough ground, a cliff, out-of-range spikes (the half floats' clamp) and a NaN.
                heights[i] = field.lo + (field.hi - field.lo) * (0.5 + 0.5 * Math.sin(i * 0.37) * Math.cos(i * 0.011));
                if (i % 211 === 0) heights[i] = field.hi * 400;
                sky[i] = (i * 37) & 255;
            }
            heights[5] = NaN;
            const want = fieldTextureDataBefore(heights, sky, field);
            expect(fieldTextureData(heights, sky, field), name).toEqual(want);
            const banded = new Uint16Array(n * 4);
            for (let j = 0; j < field.size; j += 13) {
                fillFieldTextureRows(banded, heights, sky, field, j, Math.min(field.size, j + 13));
            }
            expect(banded, name).toEqual(want);
        }
    });

    it('builds the world a few parts to a step, the same world its build() makes', () => {
        const prepared = PaintedAgesWorld.prepareSync('Low');
        const once = new PaintedAgesWorld({
            scene: new THREE.Scene(), quality: 'Low', capture: true, prepared,
        });
        once.build();
        const stepped = new PaintedAgesWorld({
            scene: new THREE.Scene(), quality: 'Low', capture: true, prepared,
        });
        const steps = stepped.buildSteps();
        let count = 0;
        let next = steps.next();
        while (!next.done) {
            count += 1;
            next = steps.next();
        }
        expect(next.value).toBe(stepped);
        expect(count).toBeGreaterThanOrEqual(6);
        expect(Object.keys(stepped.parts)).toEqual(Object.keys(once.parts));
        const shape = (world) => world.root.children.map((mesh) => [
            mesh.name, mesh.geometry.attributes.position.count, mesh.geometry.index?.count ?? 0,
        ]);
        expect(shape(stepped)).toEqual(shape(once));
        expect(stepped.parts.props.mesh.geometry.attributes.position.array)
            .toEqual(once.parts.props.mesh.geometry.attributes.position.array);
        once.dispose();
        stepped.dispose();
    });
});
