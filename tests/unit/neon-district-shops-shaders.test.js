/**
 * Neon District shop shader gate — no GPU needed.
 *
 * The generated shops' material (the shop rooms and the people in them, neon-district-shops.js and
 * neon-district-people.js) is built through three's own node builders against a stub renderer:
 * the WGSL one of the WebGPU backend and the GLSL one of the WebGL2 fallback, at High (rooms and
 * people) and Low (flat rooms, nobody inside). A graph a builder cannot turn into a shader throws
 * or warns here instead of leaving the shops undrawn.
 *
 * Also gated: a texture a WGSL stage reads but never declares, smoothstep with equal constant
 * edges, NaN/Infinity literals, a stringified node, MaterialX noise, and that the people's sprite
 * sheets are read (with explicit gradients) wherever rooms are traced.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { NeonDistrictWorld } from '../../src/themes/neon-district/neon-district-world.js';

vi.setConfig({ testTimeout: 120_000 });

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const STAGE_BUDGET = 112 * 1024;

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
        getDrawingBufferSize: (t) => t.set(1280, 720),
        getSize: (t) => t.set(1280, 720),
        getPixelRatio: () => 1,
    };
}

function build(Builder, object, camera) {
    const builder = new Builder(object, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = camera;
    builder.context.material = object.material;
    builder.material = object.material;
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

function undeclaredBindings(wgsl) {
    const pattern = /\bnodeUniform\d+_sampler\b|\bnodeUniform\d+(?=\s*,\s*nodeUniform\d+_sampler)/g;
    const used = new Set(wgsl.match(pattern) || []);
    return [...used].filter((name) => !new RegExp(`\\b${name}\\s*:`).test(wgsl));
}

describe.each(['High', 'Low'])('neon-district shop shaders at %s', (quality) => {
    let world;
    let shops;
    let camera;
    const out = {};

    beforeAll(() => {
        const scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 1500);
        world = new NeonDistrictWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1280, 720, 16 / 9);
        shops = world.parts.shops.mesh;
        BACKENDS.forEach(([label, Builder]) => {
            const [result, heard] = listening(() => build(Builder, shops, camera));
            out[label] = { result, heard };
        });
    });

    afterAll(() => world?.dispose());

    it.each(BACKENDS.map(([label]) => label))('builds the shop material cleanly in %s', (label) => {
        const { result, heard } = out[label];
        expect(result.thrown, String(result.thrown?.stack || '')).toBeUndefined();
        expect(heard).toEqual([]);
        for (const stage of ['vertex', 'fragment']) {
            const code = result[stage];
            expect(typeof code).toBe('string');
            expect(Buffer.byteLength(code)).toBeLessThan(STAGE_BUDGET);
            expect(equalEdges(code)).toEqual([]);
            expect(/\bNaN\b|\bInfinity\b/.test(code)).toBe(false);
            expect(/object Object/.test(code)).toBe(false);
            expect(/mx_\w+/.test(code)).toBe(false);
            if (label === 'WGSL') expect(undeclaredBindings(code)).toEqual([]);
        }
    });

    it('reads the people sheets exactly where rooms are traced', () => {
        const wgsl = out.WGSL.result.fragment;
        const grads = (wgsl.match(/textureSampleGrad\(/g) || []).length;
        if (quality === 'High') {
            expect(world.people).not.toBeNull();
            // Two frames of the sheet and both halves of the masks, read ONCE in a loop over the
            // four figure slots, plus the glyph and logo reads that were there before.
            expect(grads).toBe(9);
            expect(wgsl).toMatch(/for \( var i : i32 = 0; i < 4;/);
        } else {
            expect(world.people).toBeNull();
            expect(grads).toBe(5);
        }
    });
});
