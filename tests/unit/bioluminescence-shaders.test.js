import {
    afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { BioluminescenceWorld } from '../../src/themes/bioluminescence/bioluminescence-world.js';
import { BioluminescencePost, POST_LOOK } from '../../src/themes/bioluminescence/bioluminescence-post.js';
import { build, stubRenderer, unassignedReads } from './helpers/tsl-node-build.js';

const backends = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];

/** The scene pass and the planar mirror ask for target sizes when their graphs are built. */
function rendererForShaders() {
    return {
        ...stubRenderer(),
        isWebGPURenderer: true,
        samples: 0,
        getPixelRatio: () => 1,
        getDrawingBufferSize: (size) => size.set(1280, 720),
        getSize: (size) => size.set(1280, 720),
        getOutputBufferType: () => THREE.HalfFloatType,
    };
}

function checkShader(backend, Builder, mesh, renderer) {
    const result = build(Builder, mesh, renderer);
    const label = `${mesh.material.name} (${backend})`;
    expect(result.thrown, label).toBeUndefined();
    expect(result.heard, label).toEqual([]);
    for (const stage of [result.vertex, result.fragment]) {
        expect(stage, label).toMatch(/\bmain\b/);
        expect(stage, label).not.toMatch(/\b(?:NaN|Infinity)\b|\[object Object\]/);
        if (backend === 'WGSL') expect(unassignedReads(stage), label).toEqual([]);
    }
}

describe.each(['Minimal', 'High'])('Bioluminescence shaders at %s', (quality) => {
    let scene;
    let world;
    beforeAll(() => {
        scene = new THREE.Scene();
        world = new BioluminescenceWorld({ scene, quality, capture: true }).build();
    });
    afterAll(() => world?.dispose());

    it.each(backends)('builds every scene mesh for %s', (backend, Builder) => {
        const renderer = rendererForShaders();
        const meshes = [];
        scene.traverse((object) => { if (object.isMesh) meshes.push(object); });
        expect(meshes.length).toBeGreaterThan(0);
        for (const mesh of meshes) checkShader(backend, Builder, mesh, renderer);
    }, 60_000);

    it.each(backends)('builds the graded output and calm zones for %s', (backend, Builder) => {
        const renderer = rendererForShaders();
        const post = new BioluminescencePost(renderer, scene, new THREE.PerspectiveCamera(), {
            look: POST_LOOK[quality],
        });
        const material = new THREE.NodeMaterial();
        material.name = 'BioluminescencePost';
        material.fragmentNode = post.pipeline.outputNode;
        try {
            checkShader(backend, Builder, new THREE.QuadMesh(material), renderer);
        } finally {
            material.dispose();
            post.dispose();
        }
    }, 60_000);
});
