/**
 * Thermal Bloom — the shaders, built to WGSL on the CPU (no GPU): every part's node materials go
 * through three's own WGSLNodeBuilder against a stub renderer (the harness of
 * tests/unit/parhelion-shader-size.test.js), on the lightest and the heaviest tier.
 *
 * They pin what keeps the theme compiling fast and within the device limits everywhere: no
 * MaterialX noise (`mx_*`, superlinear compile), at most 12 uniform buffers a stage and 8 vertex
 * buffers, and every stage under a size budget (the largest, the basin's fragment, compiles in
 * well under a second on a desktop GPU at this size).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { REST_RIG, ThermalBloomWorld, fovForAspect } from '../../src/themes/thermal-bloom/thermal-bloom-world.js';
import { fallbackLayout } from '../../src/themes/thermal-bloom/thermal-bloom-composition.js';

/** Bytes a stage may take (KiB): twice the largest (the basin's fragment, ~64 KiB) when written. */
const STAGE_BUDGET_KIB = 128;
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

function buildWorld(quality) {
    const scene = new THREE.Scene();
    const aspect = 16 / 9;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new ThermalBloomWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(1600, 900, aspect);
    world.setLayout(fallbackLayout(1600, 900), aspect);
    world.seek(10);
    return { scene, world };
}

const kib = (text) => Buffer.byteLength(text, 'utf8') / 1024;
const uniformBuffers = (wgsl) => (wgsl.match(/var<uniform>/g) || []).length;
const vertexInputs = (wgsl) => {
    const main = wgsl.match(/fn main\(([\s\S]*?)\)\s*->/);
    return main ? (main[1].match(/@location\(\d+\)/g) || []).length : 0;
};

describe('Thermal Bloom shaders (WGSL, built on the CPU)', () => {
    for (const quality of ['Minimal', 'Ultra']) {
        it(`builds every part's materials within the limits at ${quality}`, () => {
            const { scene, world } = buildWorld(quality);
            const objects = [];
            scene.traverse((o) => { if (o.material) objects.push(o); });
            expect(objects.length).toBeGreaterThan(5);
            const sizes = [];
            for (const object of objects) {
                const name = object.material.name || object.name;
                const { vertex, fragment } = buildShaders(object);
                expect(vertex.length, `${name} vertex`).toBeGreaterThan(200);
                expect(fragment.length, `${name} fragment`).toBeGreaterThan(200);
                for (const [stage, wgsl] of [['vertex', vertex], ['fragment', fragment]]) {
                    expect(wgsl, `${name} ${stage}: MaterialX noise`).not.toMatch(/\bmx_/);
                    expect(uniformBuffers(wgsl), `${name} ${stage} uniform buffers`)
                        .toBeLessThanOrEqual(MAX_UNIFORM_BUFFERS);
                    expect(kib(wgsl), `${name} ${stage} KiB`).toBeLessThan(STAGE_BUDGET_KIB);
                }
                expect(vertexInputs(vertex), `${name} vertex buffers`).toBeLessThanOrEqual(MAX_VERTEX_BUFFERS);
                sizes.push(`${name}: ${kib(vertex).toFixed(1)} + ${kib(fragment).toFixed(1)} KiB`);
            }
            if (process.env.TB_SHADER_SIZES) console.log(`${quality}\n  ${sizes.join('\n  ')}`);
            world.dispose();
        }, 120000);
    }
});
