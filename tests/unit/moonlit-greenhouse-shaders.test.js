/**
 * Moonlit Greenhouse shader gate — no GPU needed.
 *
 * Every mesh of every part is built through three's own node builders against a stub renderer:
 * the WGSL one the WebGPU backend uses and the GLSL one of the WebGL2 fallback, at the richest
 * tier the theme defaults to and at the leanest. A graph that one builder cannot turn into a
 * shader (a conditional the GLSL builder has no stack for, a helper that reads a uniform it was
 * never handed, a JS minus applied to a node, which prints NaN into the shader) throws, warns or
 * shows here instead of leaving a part undrawn on someone's machine.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, the driver), so a shader the
 * browser rejects can still pass. The harness is the one of tests/unit/himalayan-peak-shaders.test.js.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import {
    MOONLIT_GREENHOUSE_PARTS, MoonlitGreenhouseWorld,
} from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-world.js';

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** A feature unrolled in JS instead of looped shows up as a module of 100 KB. */
const STAGE_BUDGET = 96 * 1024;

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

/** Both stages of a mesh's material as one backend would write them. */
function buildShaders(Builder, mesh) {
    const builder = new Builder(mesh, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = mesh.material;
    builder.material = mesh.material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

/** Every mesh a part draws. */
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

/** Every `mg_*` function a WGSL stage defines: name → body. */
function helpers(wgsl) {
    return [...wgsl.matchAll(/^fn (mg_\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)^\}/gm)]
        .map((m) => ({ name: m[1], body: m[2] }));
}

/** What a helper's body names that is neither an argument nor a local: uniforms, arrays, textures. */
const captures = (body) => body.match(/nodeUniform\d+|NodeBuffer_\w+|\bobject\.\w+|\brender\.\w+|texture\w*\(/g);

describe.each(TIERS)('moonlit greenhouse shaders at %s', (quality) => {
    let world;
    /** "part #mesh" → backend → { vertex, fragment } */
    const built = {};
    const said = {};

    beforeAll(() => {
        world = new MoonlitGreenhouseWorld({ scene: new THREE.Scene(), quality, capture: true }).build();
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
    });

    afterAll(() => {
        world.dispose();
    });

    it('builds every part, each from node materials', () => {
        expect(Object.keys(world.parts).sort()).toEqual([...MOONLIT_GREENHOUSE_PARTS].sort());
        Object.keys(world.parts).forEach((name) => {
            drawables(world.parts[name]).forEach((mesh) => expect(mesh.material.isNodeMaterial, name).toBe(true));
        });
        expect(Object.keys(built).length).toBeGreaterThan(0);
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
                    expect(equalEdges(out[stage]), `${key}, ${label} ${stage}`).toEqual([]);
                    // A JS minus on a node prints NaN; an infinity is as bad.
                    expect(out[stage], `${key}, ${label} ${stage}`).not.toMatch(/\bNaN\b|\bInfinity\b/);
                }
                expect(`${out.vertex}${out.fragment}`, `${key}, ${label}`).not.toMatch(/mx_\w+/);
            });
            expect(built[key].WGSL.fragment, key).toMatch(/@fragment/);
            expect(built[key].GLSL.fragment, key).toMatch(/void main\(\)/);
        });
    });

    it('emits each shared helper once per stage, as a function of its arguments alone', () => {
        const names = new Set();
        Object.keys(built).forEach((key) => {
            for (const stage of ['vertex', 'fragment']) {
                const found = helpers(built[key].WGSL[stage]);
                expect(new Set(found.map((helper) => helper.name)).size, `${key} ${stage}`).toBe(found.length);
                found.forEach((helper) => {
                    names.add(helper.name);
                    expect(captures(helper.body), `${helper.name} in ${key}'s ${stage} stage`).toBeNull();
                });
            }
        });
        // The moonlight through the glazing is one of them wherever a surface is lit.
        expect([...names]).toEqual(expect.arrayContaining(['mg_moonlightBay', 'mg_glazing', 'mg_houseExit']));
    });
});
