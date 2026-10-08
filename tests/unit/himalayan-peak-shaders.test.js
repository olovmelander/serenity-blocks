/**
 * Himalayan Peak shader gate — no GPU needed.
 *
 * Every part's material is built through three's own node builders against a stub renderer: the
 * WGSL one the WebGPU backend uses and the GLSL one of the WebGL2 fallback, at the richest tier
 * the theme defaults to and at the leanest. A graph that one builder cannot turn into a shader
 * (a conditional the GLSL builder has no stack for, a helper that reads a uniform it was never
 * handed) throws or warns here instead of leaving a part undrawn on someone's machine.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, the driver), so a shader the
 * browser rejects can still pass. The harness is the one of tests/unit/parhelion-shader-size.test.js.
 */

import { readFileSync } from 'node:fs';
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HIMALAYAN_PEAK_PARTS, HimalayanPeakWorld } from '../../src/themes/himalayan-peak/himalayan-peak-world.js';
import { planMassif } from '../../src/themes/himalayan-peak/himalayan-peak-assets.js';
import { createEagle } from '../../src/themes/himalayan-peak/himalayan-peak-eagle.js';
import { QUALITY } from '../../src/themes/himalayan-peak/himalayan-peak-quality.js';

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** The largest stage today is the massif's fragment at 17 KB of WGSL. */
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

/** The mesh a part draws (the eagle's hangs under a pivot). */
function drawable(part) {
    let found = null;
    part.mesh.traverse((object) => {
        if (!found && object.isMesh) found = object;
    });
    return found;
}

/** Every `hp_*` function a WGSL stage defines: name → body. */
function helpers(wgsl) {
    return [...wgsl.matchAll(/^fn (hp_\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)^\}/gm)]
        .map((m) => ({ name: m[1], body: m[2] }));
}

/** What a helper's body names that is neither an argument nor a local: uniforms, arrays, textures. */
const captures = (body) => body.match(/nodeUniform\d+|NodeBuffer_\w+|\bobject\.\w+|\brender\.\w+|texture\w*\(/g);

/** smoothstep() calls whose two edges are the same constant: a hard error in WGSL. */
function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

let massif;
let gltf;
beforeAll(async () => {
    massif = planMassif(64);
    // The eagle's own model: a skinned mesh with painted vertices and no textures to decode.
    const file = readFileSync(new URL('../../src/themes/himalayan-peak/assets/eagle.glb', import.meta.url));
    gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
});

describe.each(TIERS)('himalayan peak shaders at %s', (quality) => {
    let world;
    /** part → backend → { vertex, fragment } */
    const built = {};
    /** What three said while building, per part and backend. */
    const said = {};

    beforeAll(() => {
        world = new HimalayanPeakWorld({
            scene: new THREE.Scene(), quality, capture: true, massif, eagle: false,
        }).build();
        // The eagle joins a running world when its model arrives; here it is handed over at once.
        world.parts.eagle = createEagle(world.u, gltf);
        const warn = vi.spyOn(console, 'warn');
        const error = vi.spyOn(console, 'error');
        Object.keys(world.parts).forEach((name) => {
            built[name] = {};
            said[name] = {};
            BACKENDS.forEach(([label, Builder]) => {
                const heard = [];
                const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 400));
                warn.mockImplementation(listen);
                error.mockImplementation(listen);
                try {
                    built[name][label] = buildShaders(Builder, drawable(world.parts[name]));
                } catch (thrown) {
                    built[name][label] = { thrown };
                }
                said[name][label] = heard;
            });
        });
        warn.mockRestore();
        error.mockRestore();
    });

    afterAll(() => {
        world.parts.eagle.dispose();
        delete world.parts.eagle;
        world.dispose();
    });

    it('has a material to build for every part the tier draws', () => {
        const expected = HIMALAYAN_PEAK_PARTS.filter((name) => name !== 'dust' || QUALITY[quality].dust > 0);
        expect(Object.keys(built).sort()).toEqual([...expected].sort());
        expect(HIMALAYAN_PEAK_PARTS).toHaveLength(13);
        Object.keys(world.parts).forEach((name) => {
            const mesh = drawable(world.parts[name]);
            expect(mesh, name).toBeTruthy();
            expect(mesh.material.isNodeMaterial, name).toBe(true);
        });
        // The eagle is the real model: skinned, painted, with normals.
        const eagle = drawable(world.parts.eagle);
        expect(eagle.isSkinnedMesh).toBe(true);
        expect(Object.keys(eagle.geometry.attributes)).toEqual(expect.arrayContaining(['position', 'normal', 'color']));
    });

    it.each(HIMALAYAN_PEAK_PARTS)('builds the %s for WebGPU and for the WebGL2 fallback without a word', (name) => {
        if (!built[name]) {
            // Only the diamond dust is ever left out, and only where the tier has none.
            expect(name).toBe('dust');
            expect(QUALITY[quality].dust).toBe(0);
            return;
        }
        BACKENDS.forEach(([label]) => {
            const out = built[name][label];
            expect(out.thrown, `${name}, ${label}: ${out.thrown?.stack ?? ''}`).toBeUndefined();
            expect(said[name][label], `${name}, ${label}`).toEqual([]);
            for (const stage of ['vertex', 'fragment']) {
                expect(typeof out[stage], `${name}, ${label} ${stage}`).toBe('string');
                expect(out[stage].length, `${name}, ${label} ${stage}`).toBeGreaterThan(200);
                // A feature unrolled in JS instead of looped shows up here as a module of 100 KB.
                expect(Buffer.byteLength(out[stage]), `${name}, ${label} ${stage}`).toBeLessThan(STAGE_BUDGET);
                expect(equalEdges(out[stage]), `${name}, ${label} ${stage}`).toEqual([]);
            }
            expect(`${out.vertex}${out.fragment}`, `${name}, ${label}`).not.toMatch(/mx_\w+/);
        });
        expect(built[name].WGSL.vertex).toMatch(/@vertex/);
        expect(built[name].WGSL.fragment).toMatch(/@fragment/);
        expect(built[name].GLSL.vertex).toMatch(/void main\(\)/);
        expect(built[name].GLSL.fragment).toMatch(/void main\(\)/);
    });

    it('emits each shared helper once per stage, as a function of its arguments alone', () => {
        const names = new Set();
        Object.keys(built).forEach((part) => {
            for (const stage of ['vertex', 'fragment']) {
                const found = helpers(built[part].WGSL[stage]);
                // Defined once: a helper without a layout would be inlined, not defined at all.
                expect(new Set(found.map((helper) => helper.name)).size, `${part} ${stage}`).toBe(found.length);
                found.forEach((helper) => {
                    names.add(helper.name);
                    // A function with a layout is written once and reused by later materials: a
                    // uniform, a uniform array or a texture it closed over is declared only in the
                    // first shader that built it.
                    expect(captures(helper.body), `${helper.name} in the ${part}'s ${stage} stage`).toBeNull();
                });
            }
        });
        // The air's optical depth is one of them wherever the haze is drawn.
        expect([...names]).toContain('hp_airDepth');
        expect(helpers(built.massif.WGSL.fragment).map((helper) => helper.name)).toContain('hp_airDepth');
        expect(built.massif.GLSL.fragment).toMatch(/float hp_airDepth\s*\(/);
    });
});
