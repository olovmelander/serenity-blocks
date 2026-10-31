/**
 * Halcyon Apex builds its first visit in steps (2026-10-31): the plan's stone a slice at a time, the
 * islets' rocks and trees by the clock, and the world a few parts to a breath. What is built must
 * not change, however the slices fall.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import { createHash } from 'node:crypto';
import * as THREE from 'three/webgpu';
import { HalcyonApexWorld } from '../../src/themes/halcyon-apex/halcyon-apex-world.js';
import { buildPlan, buildPlanSteps } from '../../src/themes/halcyon-apex/halcyon-apex-plan.js';

/** Every array a world built, in scene order: names, geometry, instance matrices, textures. */
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
    world.textures.forEach((t) => {
        if (t.image?.data) hash.update(bytes(t.image.data));
        (t.mipmaps || []).forEach((m) => hash.update(bytes(m.data)));
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

describe('Halcyon Apex first build in steps', () => {
    it('cuts the same plan when every slice of its stone breathes', () => {
        const [count, plan] = runEveryBreath(buildPlanSteps(77));
        // A yield before every quad of the pyramid's and the dial's stone but their first.
        expect(count).toBeGreaterThan(100);
        expect(plan).toEqual(buildPlan(77));
    });

    it('builds the same world a few parts to a step as its build() makes', () => {
        const once = new HalcyonApexWorld({ scene: new THREE.Scene(), quality: 'High', capture: true }).build();
        const sliced = new HalcyonApexWorld({ scene: new THREE.Scene(), quality: 'High', capture: true });
        const [count, built] = runEveryBreath(sliced.buildSteps());
        expect(built).toBe(sliced);
        // The world's own steps, and the islets' rocks and trees between them.
        expect(count).toBeGreaterThan(20);
        expect(sliced.plan).toBe(once.plan); // one plan for the session
        expect(Object.keys(sliced.parts)).toEqual(Object.keys(once.parts));
        expect(fingerprint(sliced)).toBe(fingerprint(once));
        once.dispose();
        sliced.dispose();
    });
});
