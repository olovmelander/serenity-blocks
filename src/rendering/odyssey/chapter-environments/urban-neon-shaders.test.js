/**
 * Chapter 8's neon city (2026-10-20 overhaul) — every material built to WGSL on the CPU (no GPU),
 * through three's own WGSLNodeBuilder against a stub renderer (the harness of
 * tests/unit/thermal-bloom-shaders.test.js), on the lightest and the heaviest tier.
 *
 * Pins what keeps the chapter compiling fast and valid everywhere: no MaterialX noise (`mx_*`,
 * superlinear compile), no JavaScript leaking into the shader (`NaN`, `[object Object]` — a JS
 * minus or `+` on a node), at most 8 vertex buffers (the signs carry six instance vec4s, packed
 * into one interleaved buffer) and 12 uniform buffers a stage, and every stage under a budget.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { createUrbanDreamsEnvironment } from './urban-dreams.js';

const STAGE_BUDGET_KIB = 96;
const MAX_UNIFORM_BUFFERS = 12;
const MAX_VERTEX_BUFFERS = 8;

function buildShaders(object) {
    const { material } = object;
    const renderer = {
        contextNode: context(),
        lighting: { enabled: false },
        backend: {
            device: null,
            capabilities: { getUniformBufferLimit: () => 65536 },
            utils: { getTextureSampleData: () => ({ samples: 1, primarySamples: 1, isMSAA: false }) },
        },
        getRenderTarget: () => null,
        getMRT: () => null,
        shadowMap: { enabled: false, type: 0 },
        capabilities: {},
        library: { fromMaterial: (m) => m },
        nodes: {},
        getOutputRenderTarget: () => null,
        currentColorSpace: 'srgb',
        outputColorSpace: 'srgb',
        toneMapping: 0,
        xr: { enabled: false },
        debug: { checkShaderErrors: false, diagnostics: { keywords: true } },
        getUniformBufferLimit: () => 65536,
        hasFeature: () => false,
        isOutputTarget: false,
        logarithmicDepthBuffer: false,
        reverseDepth: false,
        highPrecision: false,
    };
    const builder = new THREE.WGSLNodeBuilder(object, renderer);
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = material;
    builder.material = material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

const kib = (text) => Buffer.byteLength(text, 'utf8') / 1024;
const uniformBuffers = (wgsl) => (wgsl.match(/var<uniform>/g) || []).length;
const vertexInputs = (wgsl) => {
    const main = wgsl.match(/fn main\(([\s\S]*?)\)\s*->/);
    return main ? (main[1].match(/@location\(\d+\)/g) || []).length : 0;
};

/** The node-material meshes of the chapter (the plain MeshBasicMaterials need no builder check). */
function nodeMeshes(group) {
    const meshes = [];
    group.traverse((child) => {
        if (child.isMesh && child.material?.isNodeMaterial) meshes.push(child);
    });
    return meshes;
}

describe('Chapter 8 neon city shaders (WGSL, built on the CPU)', () => {
    for (const qualityTier of ['Low', 'High']) {
        it(`builds every ${qualityTier} material cleanly and within the device limits`, () => {
            const group = createUrbanDreamsEnvironment({ qualityTier });
            const names = [];
            nodeMeshes(group).forEach((mesh) => {
                const { vertex, fragment } = buildShaders(mesh);
                names.push(mesh.name);
                [vertex, fragment].forEach((wgsl) => {
                    expect(wgsl, mesh.name).not.toMatch(/\bmx_/);
                    expect(wgsl, mesh.name).not.toMatch(/\bNaN\b|\bInfinity\b/);
                    expect(wgsl, mesh.name).not.toContain('[object Object]');
                    expect(uniformBuffers(wgsl), mesh.name).toBeLessThanOrEqual(MAX_UNIFORM_BUFFERS);
                    expect(kib(wgsl), mesh.name).toBeLessThan(STAGE_BUDGET_KIB);
                });
                expect(vertexInputs(vertex), mesh.name).toBeLessThanOrEqual(MAX_VERTEX_BUFFERS);
            });
            ['city-tower-instances-tsl', 'wet-neon-reflection-plane', 'neon-city-signs',
                'neon-city-sign-halos', 'rain-streak-curtain', 'sky-traffic-light-trails',
                'neon-lantern-strings', 'neon-skybridges'].forEach((name) => expect(names, name).toContain(name));
        });
    }
});
