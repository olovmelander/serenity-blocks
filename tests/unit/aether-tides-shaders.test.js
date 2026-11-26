import {
    afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { AetherTidesWorld } from '../../src/themes/aether-tides/aether-tides-world.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';
import { hasMaterialXNoise } from './helpers/materialx-noise.js';

const BACKENDS = [
    ['WebGPU', THREE.WGSLNodeBuilder],
    ['WebGL2', THREE.GLSLNodeBuilder],
];

// Physical contexts without float targets draw the resting field directly on the screen.
// That is a different node graph from the fluid-backed picture, even on the same tier.
describe.each([
    ['High', true],
    ['Minimal', true],
    ['High', false],
])('Aether Tides %s shaders (live fluid %s)', (quality, live) => {
    let world;
    let scene;

    beforeAll(() => {
        scene = new THREE.Scene();
        world = new AetherTidesWorld({
            scene, renderer: {}, quality, live,
        }).build();
    });

    afterAll(() => world?.dispose());

    it.each(BACKENDS)('builds the scene and active offscreen passes on %s', (backend, Builder) => {
        const meshes = [];
        scene.traverse((obj) => {
            if (obj.isMesh) meshes.push(obj);
        });
        expect(meshes).toContain(world.nebula.mesh);
        expect(meshes).toContain(world.stars.mesh);
        expect(meshes).toContain(world.ribbons.mesh);
        if (live) {
            for (const owner of [world.fluid, world.light]) {
                for (const material of Object.values(owner)) {
                    if (material?.isMaterial) meshes.push(new THREE.QuadMesh(material));
                }
            }
        }

        for (const mesh of meshes) {
            const name = mesh.material.name || mesh.name;
            const shader = build(Builder, mesh);
            expect(shader.thrown, name).toBeUndefined();
            expect(shader.heard, name).toEqual([]);
            for (const stage of ['vertex', 'fragment']) {
                const code = shader[stage];
                const label = `${name}, ${stage}`;
                const entry = backend === 'WebGPU' ? `@${stage}` : 'void main()';
                expect(code, label).toContain(entry);
                expect(code, label).not.toMatch(/\bNaN\b|\bInfinity\b|\[object Object\]/);
                expect(hasMaterialXNoise(code), label).toBe(false);
                if (backend === 'WebGPU') expect(unassignedReads(code), label).toEqual([]);
            }
        }
    });
});
