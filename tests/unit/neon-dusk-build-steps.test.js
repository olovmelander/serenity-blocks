/**
 * Neon Dusk builds its first visit in steps (2026-10-31): the ranges' terrain by the clock, a
 * range's columns, indices and normals at a time, and the world a few parts to a breath. What is
 * built must not change, however the slices fall.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import { createHash } from 'node:crypto';
import * as THREE from 'three/webgpu';
import { NeonDuskWorld, createWorldUniforms } from '../../src/themes/neon-dusk/neon-dusk-world.js';
import { createMountains, createMountainsSteps } from '../../src/themes/neon-dusk/neon-dusk-mountains.js';

const seeded = () => {
    let s = 7;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
};

/** Every array a world built, in scene order: names, geometry, instance matrices. */
function fingerprint(world) {
    const hash = createHash('sha256');
    const bytes = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    world.root.traverse((o) => {
        hash.update(`${o.type}|${o.name}|${o.renderOrder}|${o.layers.mask}|`);
        if (o.geometry) {
            for (const [name, attribute] of Object.entries(o.geometry.attributes)) {
                hash.update(name);
                hash.update(bytes(attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array));
            }
            if (o.geometry.index) hash.update(bytes(o.geometry.index.array));
        }
        if (o.isInstancedMesh) hash.update(bytes(o.instanceMatrix.array));
    });
    return hash.digest('hex');
}

/** Run steps on a clock that is always due, so every slice breathes; returns [steps, value]. */
function runEveryBreath(steps) {
    let t = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => {
        t += 50;
        return t;
    });
    try {
        let count = 0;
        let next = steps.next();
        while (!next.done) {
            count += 1;
            next = steps.next();
        }
        return [count, next.value];
    } finally {
        now.mockRestore();
    }
}

describe('Neon Dusk first build in steps', () => {
    it('raises the same ranges when every slice of their terrain breathes', () => {
        const once = createMountains(createWorldUniforms(), { detail: 1.3 });
        const [count, sliced] = runEveryBreath(createMountainsSteps(createWorldUniforms(), { detail: 1.3 }));
        // A yield at every column of the three ranges (their vertices and their indices).
        expect(count).toBeGreaterThan(2000);
        for (const name of ['position', 'normal', 'aInfo']) {
            expect(sliced.geometry.attributes[name].array, name).toEqual(once.geometry.attributes[name].array);
        }
        expect(sliced.geometry.index.array).toEqual(once.geometry.index.array);
        once.geometry.dispose();
        sliced.geometry.dispose();
    });

    it('builds the same world a few parts to a step as its build() makes', () => {
        const once = new NeonDuskWorld({ scene: new THREE.Scene(), quality: 'High', random: seeded() }).build();
        const sliced = new NeonDuskWorld({ scene: new THREE.Scene(), quality: 'High', random: seeded() });
        const [count, built] = runEveryBreath(sliced.buildSteps());
        expect(built).toBe(sliced);
        expect(count).toBeGreaterThan(100);
        expect(Object.keys(sliced.parts)).toEqual(Object.keys(once.parts));
        expect(fingerprint(sliced)).toBe(fingerprint(once));
        once.dispose();
        sliced.dispose();
    });
});
