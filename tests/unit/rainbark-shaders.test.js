/**
 * Rainbark — the shaders, written on the CPU for both backends (no GPU): every part's node
 * materials through three's own WGSLNodeBuilder and GLSLNodeBuilder against a stub renderer, on
 * the lightest and the heaviest tier.
 *
 * They pin what keeps the theme drawing everywhere and compiling fast: no build that throws or
 * warns, no NaN or Infinity printed into a shader (a JavaScript minus on a node), no MaterialX
 * noise (superlinear compile), no smoothstep with equal constant edges (a hard WGSL error), at
 * most 12 uniform buffers a stage and 8 vertex buffers, and every stage under a size budget.
 *
 * What it cannot see: the output is not compiled (Tint, the driver), so a shader the browser
 * still rejects needs the playground's capture; this catches what fails before that.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { RAINBARK_PARTS, RainbarkWorld } from '../../src/themes/rainbark/rainbark-world.js';

const TIERS = ['Minimal', 'Ultra'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** A feature unrolled in JS instead of looped shows up as a stage of 200 KB. */
const STAGE_BUDGET = 192 * 1024;
const MAX_UNIFORM_BUFFERS = 12;
const MAX_VERTEX_BUFFERS = 8;

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
    };
}

function buildShaders(Builder, mesh) {
    const builder = new Builder(mesh, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = mesh.material;
    builder.material = mesh.material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

function drawables(part) {
    const found = [];
    part.mesh.traverse((object) => {
        if (object.isMesh) found.push(object);
    });
    return found;
}

/** smoothstep() calls whose two edges are the same constant: a hard error in WGSL. */
function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

const uniformBuffers = (wgsl) => (wgsl.match(/var<uniform>/g) || []).length;
const vertexInputs = (wgsl) => {
    const main = wgsl.match(/fn main\(([\s\S]*?)\)\s*->/);
    return main ? (main[1].match(/@location\(\d+\)/g) || []).length : 0;
};

describe.each(TIERS)('Rainbark shaders at %s', (quality) => {
    let world;
    const built = {};
    const said = {};

    beforeAll(() => {
        world = new RainbarkWorld({ scene: new THREE.Scene(), quality, capture: true }).build();
        const warn = vi.spyOn(console, 'warn');
        const error = vi.spyOn(console, 'error');
        Object.keys(world.parts).forEach((name) => {
            drawables(world.parts[name]).forEach((mesh, i) => {
                const key = `${name} #${i} (${mesh.name || mesh.material.name || 'mesh'})`;
                built[key] = {};
                said[key] = {};
                BACKENDS.forEach(([label, Builder]) => {
                    const heard = [];
                    const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 400));
                    warn.mockImplementation(listen);
                    error.mockImplementation(listen);
                    try {
                        built[key][label] = buildShaders(Builder, mesh);
                    } catch (thrown) {
                        built[key][label] = { thrown };
                    }
                    said[key][label] = heard;
                });
            });
        });
        warn.mockRestore();
        error.mockRestore();
    }, 240000);

    afterAll(() => {
        world.dispose();
    });

    it('builds every part it has, each from node materials', () => {
        Object.keys(world.parts).forEach((name) => {
            expect(RAINBARK_PARTS).toContain(name);
            drawables(world.parts[name]).forEach((mesh) => expect(mesh.material.isNodeMaterial, name).toBe(true));
        });
        expect(Object.keys(built).length).toBeGreaterThan(5);
    });

    it('writes every material for WebGPU and for the WebGL2 fallback without a word', () => {
        Object.keys(built).forEach((key) => {
            BACKENDS.forEach(([label]) => {
                const out = built[key][label];
                expect(out.thrown, `${key}, ${label}: ${out.thrown?.stack ?? ''}`).toBeUndefined();
                expect(said[key][label], `${key}, ${label}`).toEqual([]);
                for (const stage of ['vertex', 'fragment']) {
                    expect(typeof out[stage], `${key}, ${label} ${stage}`).toBe('string');
                    expect(out[stage].length, `${key}, ${label} ${stage}`).toBeGreaterThan(200);
                    expect(Buffer.byteLength(out[stage]), `${key}, ${label} ${stage}`).toBeLessThan(STAGE_BUDGET);
                    expect(out[stage], `${key}, ${label} ${stage}`).not.toMatch(/\bNaN\b|\bInfinity\b/);
                    expect(equalEdges(out[stage]), `${key}, ${label} ${stage}`).toEqual([]);
                }
                expect(`${out.vertex}${out.fragment}`, `${key}, ${label}`).not.toMatch(/\bmx_\w+/);
            });
        });
    });

    it('stays within the device limits (uniform buffers a stage, vertex buffers a pipeline)', () => {
        Object.keys(built).forEach((key) => {
            const out = built[key].WGSL;
            if (out.thrown) return;
            expect(uniformBuffers(out.vertex), `${key} vertex`).toBeLessThanOrEqual(MAX_UNIFORM_BUFFERS);
            expect(uniformBuffers(out.fragment), `${key} fragment`).toBeLessThanOrEqual(MAX_UNIFORM_BUFFERS);
            expect(vertexInputs(out.vertex), `${key} vertex buffers`).toBeLessThanOrEqual(MAX_VERTEX_BUFFERS);
        });
    });
});
