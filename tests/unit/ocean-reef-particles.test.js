import {
    describe, expect, it, vi,
} from 'vitest';
import { createOceanReefParticles } from '../../src/themes/ocean/ocean-particles.js';

function seededRng(seed = 37) {
    let state = seed;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

describe('Ocean GPU particle populations', () => {
    it('keeps seeded placement reproducible and all instance buffers static during motion', () => {
        const first = createOceanReefParticles({ rng: seededRng(), planktonCount: 24, bubbleCount: 12 });
        const second = createOceanReefParticles({ rng: seededRng(), planktonCount: 24, bubbleCount: 12 });
        expect(first.data.plankton.positions).toEqual(second.data.plankton.positions);
        expect(first.data.bubbles.positions).toEqual(second.data.bubbles.positions);
        expect(first.group.children).toHaveLength(2);
        const snapshots = first.group.children.map((mesh) => {
            expect(mesh.instanceMatrix).toBeUndefined();
            return Object.values(mesh.geometry.attributes).map((attr) => ({
                attr, version: attr.version, values: attr.array.slice(),
            }));
        });
        first.update(40, 1.2, 1.5);
        expect(first.planktonMesh.material.userData.uTime.value).toBe(40);
        expect(first.planktonMesh.material.userData.uCurrentStrength.value).toBe(1.2);
        expect(first.planktonMesh.material.userData.uGlowIntensity.value).toBe(1.5);
        expect(first.bubbleMesh.material.userData.uTime.value).toBe(40);
        expect(first.bubbleMesh.material.userData.uCurrentStrength.value).toBe(1.2);
        for (const attributes of snapshots) {
            for (const { attr, version, values } of attributes) {
                expect(attr.version).toBe(version);
                expect(attr.array).toEqual(values);
            }
        }
        first.dispose();
        second.dispose();
    });

    it('reuses existing populations and disposes GPU resources only once', () => {
        const original = createOceanReefParticles({ rng: seededRng(), planktonCount: 24, bubbleCount: 12 });
        const copied = createOceanReefParticles({
            planktonData: original.data.plankton,
            bubbleData: original.data.bubbles,
        });
        expect(copied.data).toEqual(original.data);
        const geometryDispose = vi.spyOn(copied.planktonMesh.geometry, 'dispose');
        const materialDispose = vi.spyOn(copied.bubbleMesh.material, 'dispose');
        copied.dispose();
        copied.dispose();
        expect(geometryDispose).toHaveBeenCalledTimes(1);
        expect(materialDispose).toHaveBeenCalledTimes(1);
        expect(copied.group.children).toHaveLength(0);
        original.dispose();
    });
});
