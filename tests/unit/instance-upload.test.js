import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { uploadUsed } from '../../src/themes/shared/instance-upload.js';

const ranges = (buffer) => buffer.updateRanges.map(({ start, count }) => [start, count]);

describe('uploads of instance pools rewritten every frame', () => {
    it('marks only the elements in use, replacing last frame\'s ranges', () => {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(256 * 4), 4);
        const b = new THREE.InstancedBufferAttribute(new Float32Array(256 * 4), 4);
        a.addUpdateRange(0, 400);
        const versions = [a.version, b.version];
        uploadUsed([a, b], 12 * 4);
        expect(ranges(a)).toEqual([[0, 48]]);
        expect(ranges(b)).toEqual([[0, 48]]);
        expect([a.version, b.version]).toEqual(versions.map((v) => v + 1));
    });

    it('works on an interleaved buffer, counted by its stride', () => {
        const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(64 * 12), 12);
        uploadUsed([buffer], 5 * 12);
        expect(ranges(buffer)).toEqual([[0, 60]]);
    });

    it('sends nothing when nothing is drawn', () => {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(16), 4);
        const { version } = a;
        uploadUsed([a], 0);
        expect(a.version).toBe(version);
        expect(a.updateRanges).toEqual([]);
    });
});
