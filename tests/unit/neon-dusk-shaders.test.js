/**
 * Neon Dusk shader gate — no GPU needed.
 *
 * Every material in the built dusk (found by walking the scene, so a part added later is gated
 * too) is built through three's own node builders against a stub renderer: the WGSL one of the
 * WebGPU backend and the GLSL one of the WebGL2 fallback, at High (planar mirror) and Low (the
 * analytic mirror). A graph one builder cannot turn into a shader throws or warns here instead of
 * leaving a part undrawn on someone's machine.
 *
 * Also gated: a texture or sampler a WGSL stage reads but never declares, a smoothstep whose two
 * edges are the same constant, a NaN/Infinity literal, a stringified node and MaterialX noise. The
 * WGSL and GLSL are not compiled here.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { NeonDuskWorld } from '../../src/themes/neon-dusk/neon-dusk-world.js';
import { RIG } from '../../src/themes/neon-dusk/neon-dusk-tsl.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Low'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
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
        getDrawingBufferSize: (t) => t.set(1280, 720),
        getSize: (t) => t.set(1280, 720),
        getPixelRatio: () => 1,
    };
}

function build(Builder, object, material, camera) {
    const builder = new Builder(object, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = camera;
    builder.context.material = material;
    builder.material = material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

/** Run fn with console.warn / console.error captured: [result | { thrown }, what was said]. */
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

/** smoothstep() calls whose two edges are the same constant: a hard error in WGSL. */
function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

/** Texture and sampler bindings a WGSL stage reads but never declares. */
function undeclaredBindings(wgsl) {
    const pattern = /\bnodeUniform\d+_sampler\b|\bnodeUniform\d+(?=\s*,\s*nodeUniform\d+_sampler)/g;
    const used = new Set(wgsl.match(pattern) || []);
    return [...used].filter((name) => !new RegExp(`\\b${name}\\s*:`).test(wgsl));
}

function problemsOf({
    name, label, out, heard,
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
        if (bytes >= STAGE_BUDGET) problems.push(`${name}, ${label} ${stage}: ${bytes} B, over ${STAGE_BUDGET} B`);
        equalEdges(code).forEach((call) => problems.push(`${name}, ${label} ${stage}: equal edges in ${call}`));
        if (/\bNaN\b|\bInfinity\b/.test(code)) problems.push(`${name}, ${label} ${stage}: a NaN or Infinity literal`);
        if (/object Object/.test(code)) problems.push(`${name}, ${label} ${stage}: a node was stringified`);
        if (label === 'WGSL') {
            undeclaredBindings(code).forEach((binding) => {
                problems.push(`${name}, WGSL ${stage}: ${binding} is read but not declared`);
            });
        }
    }
    if (/mx_\w+/.test(`${out.vertex}${out.fragment}`)) problems.push(`${name}, ${label}: MaterialX noise`);
    return problems;
}

describe.each(TIERS)('neon-dusk shaders at %s', (quality) => {
    let world;
    const built = [];

    beforeAll(() => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(RIG.vfov, 16 / 9, RIG.near, RIG.far);
        world = new NeonDuskWorld({ scene, quality, random: () => 0.5 }).build();
        world.bindCamera(camera);
        world.setLayout(16 / 9, null, { immediate: true });
        world.updateCamera(camera, { time: 10, delta: 0 });
        world.update({ time: 10, delta: 0 });

        const targets = [];
        scene.traverse((object) => {
            if (!object.material) return;
            (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
                targets.push([object.name || material.name || object.type, object, material]);
            });
        });
        for (const [name, object, material] of targets) {
            BACKENDS.forEach(([label, Builder]) => {
                const [out, heard] = listening(() => build(Builder, object, material, camera));
                built.push({
                    name, label, out, heard,
                });
            });
        }
    });

    afterAll(() => world?.dispose());

    it('builds every part on both backends without a warning or an undeclared binding', () => {
        // sky, mountains, floor, burst pixels, tiles (+ dust above Minimal), on two backends
        expect(built.length).toBeGreaterThanOrEqual(10);
        expect(built.flatMap(problemsOf)).toEqual([]);
    });

    it('draws the sun in the lens\'s image plane, in the sky and in the glass', () => {
        const sky = built.find((b) => b.name === 'NeonDuskSkyDome' && b.label === 'WGSL');
        const floor = built.find((b) => b.name === 'NeonDuskFloor' && b.label === 'WGSL');
        // The view matrix is read in the fragment stage: the disc is measured per camera, so
        // the reflector's mirrored camera draws its own round sun.
        expect(sky.out.fragment).toMatch(/viewMatrix/i);
        if (quality === 'Low') expect(floor.out.fragment).toMatch(/viewMatrix/i);
    });
});
