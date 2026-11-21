import {
    afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { KoiPondWorld } from '../../src/themes/koi-pond/koi-pond-world.js';
import { PondSurface } from '../../src/themes/koi-pond/koi-pond-surface.js';
import { build, stubRenderer } from './helpers/tsl-node-build.js';

// The browser captures exercise shadows and the real depth buffer. The device-free
// renderer checks every material, including the two passes that write the wave field.
describe.each(['Minimal', 'High'])('Koi Pond %s shaders', (quality) => {
    let world;
    let surface;
    beforeAll(() => {
        world = new KoiPondWorld({ scene: new THREE.Scene(), quality }).build();
        surface = new PondSurface({ light: world.light, tier: world.tier, rocks: world.rocks });
    });
    afterAll(() => {
        surface.dispose();
        world.dispose();
    });

    it.each([['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]])('builds the pond and its simulation to %s', (_, Builder) => {
        const renderer = stubRenderer();
        renderer.shadowMap.enabled = Boolean(world.tier.shadows);
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.hasCompatibility = () => true;
        renderer.getCanvasTarget = () => null;
        const meshes = [surface.stepQuad, surface.deriveQuad];
        world.root.traverse((object) => {
            if (object.isMesh) meshes.push(object);
        });
        for (const mesh of meshes) {
            const shader = build(Builder, mesh, renderer);
            expect(shader.thrown, mesh.material.name).toBeUndefined();
            expect(shader.heard, mesh.material.name).toEqual([]);
            expect(shader.vertex, mesh.material.name).not.toMatch(/NaN|\[object Object\]/);
            expect(shader.fragment, mesh.material.name).not.toMatch(/NaN|\[object Object\]/);
        }
    });
});
