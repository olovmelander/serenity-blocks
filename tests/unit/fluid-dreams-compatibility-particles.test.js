import { describe, expect, it } from 'vitest';
import {
    createFluidDreamsCompatibilityParticles,
} from '../../src/themes/fluid-dreams/fluid-dreams-compatibility-particles.js';

describe('Fluid Dreams compatibility particles', () => {
    it.each([[1200, 1200], [2500, 2500], [9000, 4000]])(
        'preserves the tier count %s within the compatibility budget',
        (requested, expected) => {
            const { mesh, material } = createFluidDreamsCompatibilityParticles(requested, () => 0.4);
            expect(mesh.count).toBe(expected);
            expect(material.isNodeMaterial).toBe(true);
            for (const key of ['instancePosition', 'instanceColor', 'instanceSize', 'instancePhase']) {
                const attr = mesh.geometry.getAttribute(key);
                expect(attr.isInstancedBufferAttribute).toBe(true);
                expect(attr.count).toBe(expected);
                expect([...attr.array].every(Number.isFinite)).toBe(true);
            }
            const storageNodes = [];
            for (const root of [material.vertexNode, material.colorNode, material.emissiveNode]) {
                root.traverse((node) => {
                    if (node.isStorageBufferNode) storageNodes.push(node);
                });
            }
            expect(storageNodes).toHaveLength(0);
            material.userData.uTime.value = 8;
            material.userData.uColorOverrideMix.value = 0.7;
            material.userData.uBrightnessBoost.value = 0.4;
            expect(material.userData.uTime.value).toBe(8);
            expect(material.userData.uColorOverrideMix.value).toBe(0.7);
            mesh.geometry.dispose();
            material.dispose();
        },
    );
});
