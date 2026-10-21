/**
 * Voltage Storm shader gate — no GPU needed.
 *
 * Every material of the built storm (found by walking the scene, so a part added later is gated
 * too), and the sky pass that paints the cloud into its target (a QuadMesh outside the scene), is
 * built through three's own node builders against a stub renderer: the WGSL one of the WebGPU
 * backend and the GLSL one of the WebGL2 fallback, at High, Low and Minimal (the tiers that switch
 * the cloud's detail, its per-step lightning and the water's images). A graph one builder cannot
 * turn into a shader throws or warns here instead of leaving a part undrawn on someone's machine.
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
import { REST_RIG, VoltageStormWorld, fovForAspect } from '../../src/themes/voltage-storm/voltage-storm-world.js';
import { fallbackLayout } from '../../src/themes/voltage-storm/voltage-storm-composition.js';

vi.setConfig({ testTimeout: 120_000 });

const TIERS = ['High', 'Low', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const STAGE_BUDGET = 128 * 1024;

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

describe.each(TIERS)('voltage-storm shaders at %s', (quality) => {
    let world;
    const built = [];

    beforeAll(() => {
        const scene = new THREE.Scene();
        const aspect = 1600 / 900;
        const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
        world = new VoltageStormWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, aspect);
        world.setLayout(fallbackLayout(1600, 900), aspect);
        world.seek(10);
        world.updateCamera(camera, { time: 10, delta: 0 });
        world.update({ time: 10, delta: 0 }, camera);

        const targets = [];
        scene.traverse((object) => {
            if (!object.material) return;
            (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
                targets.push([object.name || material.name || object.type, object, material]);
            });
        });
        // The sky is painted by a pass outside the scene.
        const { pass } = world.sky;
        targets.push(['VoltageStormSkyPass', pass.quad, pass.material]);
        for (const [name, object, material] of targets) {
            BACKENDS.forEach(([label, Builder]) => {
                const [out, heard] = listening(() => build(Builder, object, material, camera));
                built.push({
                    name, label, out, heard,
                });
            });
        }
    });

    afterAll(() => world?.dispose?.());

    it('builds every part and the sky pass on both backends without a warning or an undeclared binding', () => {
        expect(built.some((b) => b.name === 'VoltageStormSkyPass')).toBe(true);
        expect(built.length).toBeGreaterThanOrEqual(14);
        expect(built.flatMap(problemsOf)).toEqual([]);
    });
});
