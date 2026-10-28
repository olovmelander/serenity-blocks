/**
 * The pieces a chapter build is cut into (perf audit 2026-10-28): run straight through they are the
 * old one-go build, value for value, and they really pause.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    computeVertexNormalsSteps,
    runChapterSteps,
} from '../../src/rendering/odyssey/chapter-environments/shared/chapter-build-steps.js';
import {
    bakeTileableNoise3DData,
    bakeTileableNoise3DDataSteps,
} from '../../src/rendering/odyssey/chapter-environments/shared/odyssey-baked-noise.js';

function countPauses(steps) {
    let pauses = 0;
    let step = steps.next();
    while (!step.done) {
        pauses += 1;
        step = steps.next();
    }
    return { pauses, value: step.value };
}

/** An indexed, uneven surface: shared vertices get several faces' normals summed. */
function bumpyGeometry() {
    const geometry = new THREE.TorusKnotGeometry(4, 1.2, 180, 24);
    const pos = geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 1) {
        const k = 1 + (0.08 * Math.sin(i * 0.37)) + (0.05 * Math.cos(i * 1.91));
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    geometry.deleteAttribute('normal');
    return geometry;
}

describe('runChapterSteps', () => {
    it('runs every step and returns what the steps return', () => {
        const ran = [];
        function* steps() {
            ran.push('a');
            yield;
            ran.push('b');
            yield;
            ran.push('c');
            return 42;
        }
        expect(runChapterSteps(steps())).toBe(42);
        expect(ran).toEqual(['a', 'b', 'c']);
    });
});

describe('computeVertexNormalsSteps', () => {
    it('gives the one-shot call\'s normals bit for bit, in pauses', () => {
        const reference = bumpyGeometry();
        reference.computeVertexNormals();
        const stepped = bumpyGeometry();
        const { pauses } = countPauses(computeVertexNormalsSteps(stepped, 1024));
        expect(pauses).toBeGreaterThan(5);
        const a = reference.getAttribute('normal').array;
        const b = stepped.getAttribute('normal').array;
        expect(b.length).toBe(a.length);
        expect(Buffer.from(b.buffer).equals(Buffer.from(a.buffer))).toBe(true);
        expect(stepped.getAttribute('normal').version).toBeGreaterThan(0); // needsUpdate
    });

    it('recomputes into an existing normal attribute (the shaft flips its winding and calls it twice)', () => {
        const reference = bumpyGeometry();
        reference.computeVertexNormals();
        const idx = reference.index.array;
        for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
        reference.computeVertexNormals();

        const stepped = bumpyGeometry();
        runChapterSteps(computeVertexNormalsSteps(stepped));
        const sIdx = stepped.index.array;
        for (let t = 0; t < sIdx.length; t += 3) [sIdx[t + 1], sIdx[t + 2]] = [sIdx[t + 2], sIdx[t + 1]];
        runChapterSteps(computeVertexNormalsSteps(stepped, 500));
        const a = reference.getAttribute('normal').array;
        const b = stepped.getAttribute('normal').array;
        expect(Buffer.from(b.buffer).equals(Buffer.from(a.buffer))).toBe(true);
    });

    it('hands a geometry without an index to the one-shot call', () => {
        const reference = bumpyGeometry().toNonIndexed();
        reference.computeVertexNormals();
        const soup = bumpyGeometry().toNonIndexed();
        const { pauses } = countPauses(computeVertexNormalsSteps(soup));
        expect(pauses).toBe(0);
        const a = reference.getAttribute('normal').array;
        const b = soup.getAttribute('normal').array;
        expect(Buffer.from(b.buffer).equals(Buffer.from(a.buffer))).toBe(true);
    });
});

describe('bakeTileableNoise3DDataSteps', () => {
    it('bakes the same field as the one-go bake, pausing between z-slices', () => {
        const once = bakeTileableNoise3DData(24, 6, 1337);
        const { pauses, value } = countPauses(bakeTileableNoise3DDataSteps(24, 6, 1337));
        expect(pauses).toBe(5); // 24 slices, a pause every 4, none after the last
        expect(Buffer.from(value.buffer).equals(Buffer.from(once.buffer))).toBe(true);
    });
});
