/**
 * Ocean shader gate: no GPU needed (the harness of tests/unit/crystal-cave-shaders.test.js).
 *
 * Every material in the built sea (found by walking the scene, so a part added later is gated
 * too) and the light pattern's pass are built through three's own node builders against a stub
 * renderer: the WGSL one of the WebGPU backend and the GLSL one of the WebGL2 fallback, at the
 * default tier and at the leanest. A graph one builder cannot turn into a shader throws or warns
 * here instead of leaving a part undrawn. Also gated: each stage's size, MaterialX noise, a
 * smoothstep whose edges are the same constant, a NaN/Infinity literal, a stringified node and a
 * var read in a WGSL function before anything has assigned it.
 */
import { readFileSync } from 'node:fs';
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { OceanWorld } from '../../src/themes/ocean/ocean-world.js';
import { parseCreatures, useCreatures } from '../../src/themes/ocean/ocean-creatures.js';

vi.setConfig({ testTimeout: 120_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const STAGE_BUDGET = 96 * 1024;
const VAR_NAMES = /\b(?:nodeVar\d+|normalViewGeometry|normalView|normalWorld)\b(?!\s*\()/g;
const ASSIGNMENT = /^(?:var\s+)?(nodeVar\d+|normalViewGeometry|normalView|normalWorld)\s*(?::[^=]*)?=(?!=)\s*(.*)$/;

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
        getCanvasTarget: () => null,
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
        samples: 0,
        getOutputBufferType: () => THREE.HalfFloatType,
        reversedDepthBuffer: false,
        getPixelRatio: () => 1,
        getDrawingBufferSize: (t) => t.set(1280, 720),
        getSize: (t) => t.set(1280, 720),
    };
}

function build(Builder, object, material, scene, camera) {
    const builder = new Builder(object, stubRenderer());
    builder.scene = scene;
    builder.camera = camera;
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

function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

/**
 * Vars read in a WGSL function where no assignment has certainly run (one in both arms of an
 * if/else counts; one in a lone if or a loop does not). The helper of
 * tests/unit/synthwave-sunset-shaders.test.js.
 */
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
            (text.match(VAR_NAMES) || []).forEach((name) => {
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
        } else if (!/^var\s+(?:nodeVar\d+|normalViewGeometry|normalView|normalWorld)\s*:[^=]*;$/.test(line)) {
            const assignment = line.match(ASSIGNMENT);
            if (assignment) {
                check(assignment[2]);
                stack[stack.length - 1].set.add(assignment[1]);
            } else check(line);
        }
    });
    return found;
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
        if (/object Object/.test(code)) problems.push(`${name}, ${label} ${stage}: a stringified node`);
        if (label === 'WGSL') {
            unassignedReads(code).forEach((read) => {
                problems.push(`${name}, ${label} ${stage}: read before assigned: ${read}`);
            });
        }
    }
    if (/mx_\w+/.test(`${out.vertex}${out.fragment}`)) problems.push(`${name}, ${label}: MaterialX noise`);
    return problems;
}

beforeAll(() => {
    useCreatures(parseCreatures(readFileSync(new URL('../../src/themes/ocean/assets/creatures.glb', import.meta.url))));
});

describe.each(TIERS)('ocean shaders at %s', (quality) => {
    let world;
    const built = [];
    const find = (pattern, label = 'WGSL') => built.find((entry) => entry.label === label && pattern.test(entry.name));

    beforeAll(() => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.2, 420);
        world = new OceanWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1920, 1080, 16 / 9);
        const seen = new Set();
        const targets = [];
        scene.traverse((object) => {
            if (!object.material || seen.has(object.material)) return;
            seen.add(object.material);
            targets.push([object.material.name || object.name || object.type, object, object.material]);
        });
        const lightPass = world.light.material;
        targets.push(['OceanLightPass', new THREE.QuadMesh(lightPass), lightPass]);
        for (const [name, object, material] of targets) {
            BACKENDS.forEach(([label, Builder]) => {
                const [out, heard] = listening(() => build(Builder, object, material, scene, camera));
                built.push({
                    name, label, out, heard,
                });
            });
        }
    });

    afterAll(() => world?.dispose());

    it('builds every material in the sea on both backends without a word', () => {
        expect(built.length).toBeGreaterThan(20);
        expect(built.flatMap(problemsOf)).toEqual([]);
    });

    it('crinkles the surface from the light pattern, at a level that keeps one facet size on every tier', () => {
        const surface = find(/^OceanSurface$/);
        expect(surface).toBeTruthy();
        // The pattern is read three times for its slope, at an explicit level, beside the chop.
        const reads = surface.out.fragment.match(/textureSampleLevel\(/g) || [];
        expect(reads.length).toBeGreaterThanOrEqual(3);
        expect(surface.out.fragment).toMatch(/fwidth\(/);
    });

    it('turns every kelp blade\'s face with its twist (a normal per vertex, not one for all)', () => {
        const blades = find(/^OceanKelpBlades$/);
        expect(blades.out.vertex).toMatch(/cross\(/);
        expect(blades.out.vertex).toMatch(/vKelpFace/);
        expect(blades.out.fragment).toMatch(/vKelpFace/);
    });

    it('draws the specks in front of the eye', () => {
        const near = find(/^OceanNearMotes$/);
        expect(near).toBeTruthy();
        expect(world.parts.nearMotes.count).toBeGreaterThan(quality === 'High' ? 500 : 100);
    });
});
