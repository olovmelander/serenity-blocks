import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import { GoldenForestBirds } from '../../src/themes/golden-forest/golden-forest-birds.js';
import {
    createSkyNodeMaterial, createSunNodeMaterial,
} from '../../src/themes/golden-forest/golden-forest-materials.js';
import { GoldenForestPost } from '../../src/themes/golden-forest/golden-forest-post.js';

describe('Golden Forest compatibility artwork', () => {
    it('keeps the procedural sky and distant sunset light outside distance fog', () => {
        for (const createMaterial of [createSkyNodeMaterial, createSunNodeMaterial]) {
            const { material } = createMaterial();
            expect(material.isNodeMaterial).toBe(true);
            expect(material.fog).toBe(false);
            material.dispose();
        }
    });

    it.each([24, 100, 384])('uses the exact %s bird budget with bounded attribute-driven node flight', (count) => {
        const renderer = { isWebGPURenderer: true, backend: { isWebGLBackend: true }, compute: vi.fn() };
        const birds = new GoldenForestBirds(renderer, new THREE.Scene(), { birdCount: count, randomFn: () => 0.4 });
        birds.initCompatibilityBirds();
        expect(birds.mesh.material.isNodeMaterial).toBe(true);
        expect(birds.mesh.count).toBe(count);
        expect(birds.birdCompute).toBeNull();
        expect(birds.gpuCompute).toBeNull();
        for (const attribute of ['birdOrigin', 'birdFlight']) {
            const values = birds.mesh.geometry.getAttribute(attribute);
            expect(values.isInstancedBufferAttribute).toBe(true);
            expect(values.count).toBe(count);
            expect([...values.array].every(Number.isFinite)).toBe(true);
        }
        const storageNodes = [];
        birds.mesh.material.positionNode.traverse((node) => {
            if (node.isStorageBufferNode) storageNodes.push(node);
        });
        expect(storageNodes).toHaveLength(0);
        expect(renderer.compute).not.toHaveBeenCalled();
        birds.dispose();
    });

    it('retains modern post grading on a node WebGL2 renderer and prevents MRT', () => {
        const renderer = { isWebGPURenderer: true, backend: { isWebGLBackend: true } };
        const post = new GoldenForestPost(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), {
            useMRT: true, useBloom: false, exposure: 0.97, sunGlowStrength: 0.045,
        });
        expect(post.isEnabled()).toBe(true);
        expect(post.postProcessing).toBeTruthy();
        expect(post.composer).toBeNull();
        expect(post.useMRT).toBe(false);
        expect(post.uExposure.value).toBe(0.97);
        expect(post.uSunGlowStrength.value).toBe(0.045);
        post.dispose();
    });
});
