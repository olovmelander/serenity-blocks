/**
 * Aurora shader gate — no GPU needed.
 *
 * Every material in the built world (found by walking the scene, so a part added later is gated
 * too) and the curtain march are built through three's own node builders against a stub
 * renderer: the WGSL one of the WebGPU backend and the GLSL one of the WebGL2 fallback, at the
 * default tier (planar mirror) and at Low (analytic mirror). A graph one builder cannot turn
 * into a shader throws or warns here instead of leaving a part undrawn on someone's machine.
 *
 * Also gated: a smoothstep whose two edges are the same constant (a hard WGSL error), a
 * NaN/Infinity literal, a stringified node (`[object Object]`) and MaterialX noise. The harness
 * is tests/unit/sunbraid-shaders.test.js's; the WGSL and GLSL are not compiled here.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { AuroraWorld } from '../../src/themes/aurora/aurora-world.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Low'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** Per stage. The curtain march is the largest module (three arcs unrolled, four spans each). */
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
    }
    if (/mx_\w+/.test(`${out.vertex}${out.fragment}`)) problems.push(`${name}, ${label}: MaterialX noise`);
    return problems;
}

describe.each(TIERS)('aurora shaders at %s', (quality) => {
    let world;
    const built = [];

    beforeAll(() => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 12000);
        world = new AuroraWorld({ scene, camera, quality });
        world.setViewport(1600, 900);
        world.director.onPieceLock({
            piece: {
                x: 3, y: 18, shape: [[1, 1, 1, 1]], color: '#ff3df0',
            },
        });
        world.director.onLineClear({ lineCount: 4, clearedRows: [20, 21, 22, 23] });
        world.update(2, 1 / 30);

        const targets = [];
        scene.traverse((object) => {
            if (!object.material) return;
            targets.push([object.name || object.material.name || object.type, object, object.material]);
        });
        targets.push(['Aurora — curtain march', world.curtains.quad, world.curtains.material]);
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

    it('builds every part on both backends without a warning', () => {
        const names = new Set(built.map((entry) => entry.name));
        for (const part of ['sky dome', 'snow range', 'snow banks', 'spruces', 'far forest', 'mirror lake',
            'diamond dust', 'curtain march']) {
            expect([...names].some((name) => name.includes(part)), part).toBe(true);
        }
        const problems = built.flatMap(problemsOf);
        expect(problems).toEqual([]);
    });
});
