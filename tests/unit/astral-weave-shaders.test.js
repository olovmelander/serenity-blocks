/**
 * Astral Weave shader gate — no GPU needed.
 *
 * Every material in the built world (found by walking the scene, so a part added later is gated
 * too) is built through three's own node builders against a stub renderer: the WGSL one of the
 * WebGPU backend and the GLSL one of the WebGL2 fallback, at the default tier, at Low (no relief
 * read in the sky) and at Minimal (no dust, no near motes). A graph one builder cannot turn into a
 * shader throws or warns here instead of leaving a part undrawn on someone's machine.
 *
 * Also gated: a smoothstep whose two edges are the same constant (a hard WGSL error), a
 * NaN/Infinity literal, a stringified node (`[object Object]`), MaterialX noise, and the deep
 * field writing its own alpha (the gas density the post scatters the weave's bloom by). The
 * harness is tests/unit/aurora-shaders.test.js's; the WGSL and GLSL are not compiled here.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { AstralWeaveWorld } from '../../src/themes/astral-weave/astral-weave-world.js';
import { fallbackLayout } from '../../src/themes/astral-weave/astral-weave-composition.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Low', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** Per stage. The deep field is the largest module (≈ 14 KB: nebula reads, two star layers, lights). */
const STAGE_BUDGET = 32 * 1024;

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

describe.each(TIERS)('astral weave shaders at %s', (quality) => {
    let world;
    const built = [];

    beforeAll(() => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.2, 120);
        world = new AstralWeaveWorld({ scene, quality, capture: true }).build();
        world.setViewport(1600, 900, 16 / 9);
        world.setLayout(fallbackLayout(1600, 900), 16 / 9);
        world.seek(20);
        world.lock({ rows: [19, 18], u: 0.4, hardDrop: true });
        world.clear({ rows: [19, 18, 17, 16], lines: 4, combo: 3 });
        world.updateCamera(camera, { time: 21, delta: 0 });
        world.update({ time: 21, delta: 1 / 60 });

        scene.traverse((object) => {
            if (!object.material) return;
            BACKENDS.forEach(([label, Builder]) => {
                const [out, heard] = listening(() => build(Builder, object, object.material, camera));
                built.push({
                    name: object.name || object.material.name, label, out, heard,
                });
            });
        });
    });

    afterAll(() => world?.dispose());

    it('builds every part on both backends without a warning', () => {
        const names = new Set(built.map((entry) => entry.name));
        const parts = ['deep-field', 'jewels', 'rosette', 'wefts', 'warp', 'hoop', 'pegs', 'flares', 'sparks'];
        if (quality !== 'Minimal') parts.push('dust', 'motes');
        for (const part of parts) {
            expect([...names].some((name) => name.includes(part)), part).toBe(true);
        }
        expect(built.flatMap(problemsOf)).toEqual([]);
    });

    it('writes the gas density into the deep field\'s alpha instead of forcing it opaque', () => {
        const field = world.sky.field.material;
        expect(field.blending).toBe(THREE.NoBlending);
        expect(field.transparent).toBe(false);
        // Every other part adds light with alpha 0 through premultiplied "over" blending, so the
        // sky's alpha reaches the post untouched.
        world.group.traverse((object) => {
            if (!object.material || object === world.sky.field) return;
            expect(object.material.blendSrcAlpha, object.name).toBe(THREE.OneFactor);
            expect(object.material.blendDstAlpha, object.name).toBe(THREE.OneMinusSrcAlphaFactor);
        });
    });
});
