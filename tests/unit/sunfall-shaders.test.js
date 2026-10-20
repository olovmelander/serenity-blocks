/**
 * Sunfall shader gate — no GPU needed (the harness of tests/unit/sunbraid-shaders.test.js).
 *
 * Every material in the built world (found by walking the scene, so a part added later is gated
 * too) and the post stack (the air's integral and the output, per tier, and the falseColor view)
 * are built through three's own node builders against a stub renderer: the WGSL one of the WebGPU
 * backend and the GLSL one of the WebGL2 fallback, at the default tier and at the leanest. A graph
 * one builder cannot turn into a shader throws or warns here instead of leaving a part undrawn.
 *
 * Also gated: each stage's size, MaterialX noise, a smoothstep whose edges are the same constant
 * (a hard WGSL error), a NaN/Infinity literal, a WGSL var read where it may not have been
 * assigned, and a laid-out `sf_*` helper that closes over a uniform or a texture.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { SunfallWorld } from '../../src/themes/sunfall/sunfall-world.js';
import { SunfallDirector } from '../../src/themes/sunfall/sunfall-director.js';
import { SunfallPost, resolveSunfallPostLook } from '../../src/themes/sunfall/sunfall-post.js';
import { SUNFALL_PARTS } from '../../src/themes/sunfall/sunfall-core.js';
import { loadSunfallAssetsFromDisk } from './helpers/sunfall-assets-disk.js';

vi.setConfig({ testTimeout: 120_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const STAGE_BUDGET = 48 * 1024;
/** The air integral is one big fragment: its own, larger budget. */
const AIR_BUDGET = 96 * 1024;
const PREFIX = 'sf';

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

const HELPER = new RegExp(`^fn (${PREFIX}_\\w+)\\s*\\([^)]*\\)[^{]*\\{([\\s\\S]*?)^\\}`, 'gm');
const helpers = (wgsl) => [...wgsl.matchAll(HELPER)].map((m) => ({ name: m[1], body: m[2] }));
const captures = (body) => body.match(/nodeUniform\d+|NodeBuffer_\w+|\bobject\.\w+|\brender\.\w+|texture\w*\(/g);

function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

function unassignedReads(wgsl) {
    const found = [];
    let stack = null;
    let header = false;
    wgsl.split('\n').forEach((raw, index) => {
        const line = raw.trim();
        if (!stack) {
            if (/^fn \w+\s*\(/.test(line)) header = true;
            if (header && /\{$/.test(line)) {
                header = false;
                stack = [{ kind: 'fn', set: new Set() }];
            }
            return;
        }
        const check = (text) => {
            (text.match(/\bnodeVar\d+\b/g) || []).forEach((name) => {
                if (stack.some((block) => block.set.has(name))) return;
                found.push(`${name}, line ${index + 1}: ${line.slice(0, 120)}`);
            });
        };
        if (/^if\s*\(.*\)\s*\{$/.test(line)) {
            check(line);
            stack.push({ kind: 'if', set: new Set() });
        } else if (/^\}\s*else\s*\{$/.test(line)) {
            const branch = stack.pop();
            stack.push({ kind: 'else', set: new Set(), ifSet: branch.set });
        } else if (/^(for\s*\(.*\)|loop)\s*\{$/.test(line)) {
            check(line);
            stack.push({ kind: 'loop', set: new Set() });
        } else if (line === '}') {
            const block = stack.pop();
            if (block.kind === 'fn') stack = null;
            else if (block.kind === 'else') {
                block.set.forEach((name) => {
                    if (block.ifSet.has(name)) stack[stack.length - 1].set.add(name);
                });
            }
        } else if (!/^var\s+nodeVar\d+\s*:[^=]*;$/.test(line)) {
            const assignment = line.match(/^(?:var\s+)?(nodeVar\d+)\s*(?::[^=]*)?=(?!=)\s*(.*)$/);
            if (assignment) {
                check(assignment[2]);
                stack[stack.length - 1].set.add(assignment[1]);
            } else check(line);
        }
    });
    return found;
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

describe.each(TIERS)('sunfall shaders at %s', (quality) => {
    let world;
    let scene;
    const built = [];

    beforeAll(async () => {
        scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.5, 4000);
        world = new SunfallWorld({
            scene, camera, quality, assets: await loadSunfallAssetsFromDisk(),
        });
        const director = new SunfallDirector({ level: 1 });
        director.onPieceLock({ code: 'T', u: 0.3, row: 9 });
        director.onLineClear({ lines: 4, rows: [12, 13, 14, 15] });
        director.onCombo(5);
        world.applySnapshot(director.step(0.5));

        const seen = new Set();
        const targets = [];
        scene.traverse((object) => {
            if (!object.material || seen.has(object.material)) return;
            seen.add(object.material);
            targets.push([object.name || object.parent?.name || object.type, object, object.material]);
        });
        for (const [name, object, material] of targets) {
            BACKENDS.forEach(([label, Builder]) => {
                const [out, heard] = listening(() => build(Builder, object, material));
                built.push({
                    name, object, label, out, heard,
                });
            });
        }
    });

    afterAll(() => world?.dispose());

    it('has node materials in every part', () => {
        for (const part of SUNFALL_PARTS) {
            const materials = [];
            world.partGroups.get(part).traverse((o) => { if (o.material) materials.push(o.material); });
            expect(materials.length, part).toBeGreaterThan(0);
            materials.forEach((m) => expect(m.isNodeMaterial, part).toBe(true));
        }
        expect(built.length).toBeGreaterThanOrEqual(SUNFALL_PARTS.length * 2);
    });

    it('builds every material for WebGPU and for the WebGL2 fallback without a word, under budget', () => {
        expect(built.flatMap(problemsOf)).toEqual([]);
    });

    it('reads no WGSL var where it may not have been assigned', () => {
        const found = [];
        built.filter((b) => b.label === 'WGSL' && !b.out.thrown).forEach(({ name, out }) => {
            for (const stage of ['vertex', 'fragment']) {
                unassignedReads(out[stage] ?? '').forEach((read) => found.push(`${name} ${stage}: ${read}`));
            }
        });
        expect(found).toEqual([]);
    });

    it('emits each shared sf_ helper once per stage, as a function of its arguments alone', () => {
        let seen = 0;
        const problems = [];
        built.filter((b) => b.label === 'WGSL' && !b.out.thrown).forEach(({ name, out }) => ['vertex', 'fragment'].forEach((stage) => {
            const found = helpers(out[stage]);
            seen += found.length;
            const names = found.map((h) => h.name);
            if (new Set(names).size !== names.length) problems.push(`${name} ${stage}: ${names.join(', ')} repeats`);
            found.forEach((h) => {
                const captured = captures(h.body);
                if (captured) problems.push(`${h.name} in ${name}'s ${stage} reads ${captured.join(', ')}`);
            });
        }));
        expect(problems).toEqual([]);
        expect(seen).toBeGreaterThan(0);
    });

    it.each([
        ['the look', {}],
        ['falseColor', { falseColor: true }],
    ])('builds the air and the output (%s) on both backends without a word', (_, variant) => {
        const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.5, 4000);
        const look = resolveSunfallPostLook(quality);
        const post = new SunfallPost(fakeRenderer(), scene, camera, { look, u: world.u, ...variant });
        expect(Boolean(post.bloomNode)).toBe(look.bloom);
        const stages = [['output', post.pipeline.outputNode, STAGE_BUDGET], ['air', post.compositeNode, AIR_BUDGET]];
        const problems = [];
        const materials = [];
        try {
            stages.forEach(([which, node, budget]) => {
                const material = new THREE.NodeMaterial();
                material.fragmentNode = node;
                materials.push(material);
                const quad = new THREE.QuadMesh(material);
                BACKENDS.forEach(([label, Builder]) => {
                    const [out, heard] = listening(() => build(Builder, quad, material, postRenderer(), scene, quad.camera));
                    problems.push(...problemsOf({
                        name: `post ${which} ${JSON.stringify(variant)}`, label, out, heard, budget,
                    }));
                });
            });
            expect(problems).toEqual([]);
        } finally {
            post.dispose();
            materials.forEach((m) => m.dispose());
        }
    });
});
