/**
 * First Light (the opening and menu world) shader gate — no GPU needed.
 *
 * Every mesh of every part is built through three's own node builders against a stub renderer:
 * the WGSL one the WebGPU backend uses and the GLSL one of the WebGL2 fallback, at the richest
 * tier and at the leanest. A graph that one builder cannot turn into a shader throws, warns or
 * shows here instead of leaving a part undrawn at boot. The harness is the one of
 * tests/unit/moonlit-greenhouse-shaders.test.js.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, the driver).
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { IntroWorld } from '../../src/ui/intro-world/intro-world.js';

const TIERS = ['High', 'Low'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const STAGE_BUDGET = 64 * 1024;

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

function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

/** Constant smoothstep edges in descending order: undefined behaviour in GLSL. */
function reversedEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) > Number(m[2])).map((m) => m[0]);
}

function helpers(wgsl) {
    return [...wgsl.matchAll(/^fn (fl_\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)^\}/gm)]
        .map((m) => ({ name: m[1], body: m[2] }));
}

const captures = (body) => body.match(/nodeUniform\d+|NodeBuffer_\w+|\bobject\.\w+|\brender\.\w+|texture\w*\(/g);

describe.each(TIERS)('First Light shaders at %s', (quality) => {
    let world;
    const built = {};
    const said = {};

    beforeAll(() => {
        world = new IntroWorld({ quality }).build(new THREE.Scene());
        const warn = vi.spyOn(console, 'warn');
        const error = vi.spyOn(console, 'error');
        const meshes = [];
        world.parts.forEach((part) => part.mesh.traverse((o) => { if (o.isMesh) meshes.push(o); }));
        meshes.forEach((mesh, i) => {
            const key = `#${i} ${mesh.name}`;
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
        warn.mockRestore();
        error.mockRestore();
    });

    afterAll(() => {
        world.dispose();
    });

    it('builds the sky, the veils, the seven pieces and the motes from node materials', () => {
        const names = Object.keys(built).map((k) => k.replace(/^#\d+ /, ''));
        expect(names).toEqual(expect.arrayContaining([
            'FirstLightSky', 'FirstLightVeils', 'FirstLightMotes',
            'FirstLightPieceI', 'FirstLightPieceO', 'FirstLightPieceT', 'FirstLightPieceS',
            'FirstLightPieceZ', 'FirstLightPieceJ', 'FirstLightPieceL',
        ]));
    });

    it('writes every material for WebGPU and for the WebGL2 fallback without a word', () => {
        Object.keys(built).forEach((key) => {
            BACKENDS.forEach(([label]) => {
                const out = built[key][label];
                expect(out.thrown, `${key}, ${label}: ${out.thrown?.stack ?? ''}`).toBeUndefined();
                expect(said[key][label], `${key}, ${label}`).toEqual([]);
                for (const stage of ['vertex', 'fragment']) {
                    expect(typeof out[stage], `${key}, ${label} ${stage}`).toBe('string');
                    expect(Buffer.byteLength(out[stage]), `${key}, ${label} ${stage}`).toBeLessThan(STAGE_BUDGET);
                    expect(equalEdges(out[stage]), `${key}, ${label} ${stage}`).toEqual([]);
                    expect(reversedEdges(out[stage]), `${key}, ${label} ${stage}`).toEqual([]);
                    expect(out[stage], `${key}, ${label} ${stage}`).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                }
                expect(`${out.vertex}${out.fragment}`, `${key}, ${label}`).not.toMatch(/mx_\w+/);
            });
        });
    });

    it('emits each shared helper once per stage, as a function of its arguments alone', () => {
        Object.keys(built).forEach((key) => {
            for (const stage of ['vertex', 'fragment']) {
                const found = helpers(built[key].WGSL[stage]);
                expect(new Set(found.map((helper) => helper.name)).size, `${key} ${stage}`).toBe(found.length);
                found.forEach((helper) => {
                    expect(captures(helper.body), `${helper.name} in ${key}'s ${stage} stage`).toBeNull();
                });
            }
        });
    });
});
