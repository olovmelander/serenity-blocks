import {
    afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { CinderDriftWorld } from '../../src/themes/cinder-drift/cinder-drift-world.js';
import { hasMaterialXNoise } from './helpers/materialx-noise.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

const backends = [
    ['WGSL', THREE.WGSLNodeBuilder],
    ['GLSL', THREE.GLSLNodeBuilder],
];

describe.each(['High', 'Minimal'])('Cinder Drift materials on %s', (quality) => {
    let world;
    const meshes = [];

    beforeAll(() => {
        world = new CinderDriftWorld({ scene: new THREE.Scene(), quality, capture: true }).build();
        world.root.traverse((object) => {
            if (object.isMesh) meshes.push(object);
        });
    });
    afterAll(() => world?.dispose());

    it.each(backends)('builds the chamber and every event material to %s', (language, Builder) => {
        expect(meshes.length).toBeGreaterThan(0);
        for (const mesh of meshes) {
            const shader = build(Builder, mesh);
            const { name } = mesh.material;
            expect(shader.thrown, name).toBeUndefined();
            expect(shader.heard, name).toEqual([]);
            for (const stage of [shader.vertex, shader.fragment]) {
                expect(stage.length, name).toBeGreaterThan(200);
                expect(stage, name).not.toMatch(/\b(?:NaN|Infinity)\b|\[object Object\]/);
                expect(hasMaterialXNoise(stage), name).toBe(false);
                if (language === 'WGSL') expect(unassignedReads(stage), name).toEqual([]);
            }
        }
    }, 30_000);
});
