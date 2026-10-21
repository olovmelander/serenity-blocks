/**
 * Tornado shader gate: no GPU needed (the harness of tests/unit/crystal-cave-shaders.test.js).
 *
 * Every material in the built storm (found by walking the scene, so a part added later is gated
 * too) and the post stack's output are built through three's own node builders against a stub
 * renderer: the WGSL one of the WebGPU backend and the GLSL one of the WebGL2 fallback, at the
 * default tier and at the leanest. A graph one builder cannot turn into a shader throws or warns
 * here instead of leaving a part undrawn (a JS number handed to a TSL method, as the tree belts
 * once did, throws at build). Also gated: each stage's size, MaterialX noise, a smoothstep whose
 * edges are the same constant, a NaN/Infinity literal and a stringified node.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { TornadoWorld } from '../../src/themes/tornado/tornado-world.js';
import { POST_LOOK, TornadoPost } from '../../src/themes/tornado/tornado-post.js';

vi.setConfig({ testTimeout: 120_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** The GLSL cap the other rebuilt themes hold. */
const STAGE_BUDGET = 48 * 1024;

function stubRenderer() {
    return {
        contextNode: context(),
        lighting: { enabled: false },
        backend: {
            device: null,
            capabilities: { getUniformBufferLimit: () => 65536 },
            extensions: { has: () => false },
            utils: { getTextureSampleData: () => ({ samples: 1, primarySamples: 1, isMSAA: false }) },
            compatibilityMode: false,
        },
        getRenderTarget: () => null,
        getCanvasTarget: () => null,
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
}

const postRenderer = () => ({
    ...stubRenderer(),
    samples: 0,
    getOutputBufferType: () => THREE.HalfFloatType,
    reversedDepthBuffer: false,
    getPixelRatio: () => 1,
    getDrawingBufferSize: (t) => t.set(1280, 720),
    getSize: (t) => t.set(1280, 720),
});

const fakeRenderer = () => ({
    isWebGPURenderer: true,
    backend: { isWebGPUBackend: true },
    getPixelRatio: () => 1,
    getDrawingBufferSize: (t) => t.set(1280, 720),
    getSize: (t) => t.set(1280, 720),
});

function build(Builder, object, material, renderer = stubRenderer(), scene = new THREE.Scene(), camera = null) {
    const builder = new Builder(object, renderer);
    builder.scene = scene;
    builder.camera = camera || new THREE.PerspectiveCamera();
    builder.context.material = material;
    builder.material = material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

function listening(fn) {
    const heard = [];
    const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 400));
    const warn = vi.spyOn(console, 'warn').mockImplementation(listen);
    const error = vi.spyOn(console, 'error').mockImplementation(listen);
    try {
        return [fn(), heard];
    } catch (thrown) {
        return [{ thrown }, heard];
    } finally {
        warn.mockRestore();
        error.mockRestore();
    }
}

function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

function problemsOf({
    name, label, out, heard, budget = STAGE_BUDGET,
}) {
    if (out.thrown) return [`${name}, ${label} threw: ${out.thrown?.stack?.split('\n').slice(0, 4).join(' | ')}`];
    const problems = heard.map((said) => `${name}, ${label} said: ${said}`);
    for (const stage of ['vertex', 'fragment']) {
        const code = out[stage];
        if (typeof code !== 'string' || code.length < 200) {
            problems.push(`${name}, ${label}: no ${stage} stage`);
            continue;
        }
        const bytes = Buffer.byteLength(code);
        if (bytes >= budget) problems.push(`${name}, ${label} ${stage}: ${bytes} B, over ${budget} B`);
        equalEdges(code).forEach((call) => problems.push(`${name}, ${label} ${stage}: equal edges in ${call}`));
        if (/\bNaN\b|\bInfinity\b/.test(code)) problems.push(`${name}, ${label} ${stage}: a NaN or Infinity literal`);
        if (/object Object/.test(code)) problems.push(`${name}, ${label} ${stage}: a stringified node`);
    }
    if (/mx_\w+/.test(`${out.vertex}${out.fragment}`)) problems.push(`${name}, ${label}: MaterialX noise`);
    return problems;
}

describe.each(TIERS)('tornado shaders at %s', (quality) => {
    let world;
    let scene;
    let camera;
    const built = [];

    beforeAll(() => {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 9000);
        world = new TornadoWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, 16 / 9);
        const seen = new Set();
        const targets = [];
        scene.traverse((object) => {
            if (!object.material || seen.has(object.material)) return;
            seen.add(object.material);
            targets.push([object.name || object.type, object, object.material]);
        });
        const sceneNow = scene;
        const cameraNow = camera;
        targets.forEach(([name, object, material]) => {
            BACKENDS.forEach(([label, Builder]) => {
                const [out, heard] = listening(() => build(Builder, object, material, postRenderer(), sceneNow, cameraNow));
                built.push({
                    name, label, out, heard,
                });
            });
        });
    });

    afterAll(() => world?.dispose?.());

    it('builds every material in the storm on both backends without a word', () => {
        expect(built.length).toBeGreaterThan(10);
        expect(built.flatMap(problemsOf)).toEqual([]);
    });

    it('builds the output stage of the post on both backends without a word', () => {
        const post = new TornadoPost(fakeRenderer(), scene, camera, { look: POST_LOOK[quality] || POST_LOOK.High });
        const material = new THREE.NodeMaterial();
        material.fragmentNode = post.pipeline.outputNode;
        const quad = new THREE.QuadMesh(material);
        const problems = [];
        try {
            BACKENDS.forEach(([label, Builder]) => {
                const [out, heard] = listening(() => build(Builder, quad, material, postRenderer(), scene, quad.camera));
                problems.push(...problemsOf({
                    name: 'post output', label, out, heard,
                }));
            });
            expect(problems).toEqual([]);
        } finally {
            post.dispose?.();
            material.dispose();
        }
    });
});
