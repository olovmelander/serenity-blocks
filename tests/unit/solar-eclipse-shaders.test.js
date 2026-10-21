/**
 * Solar Eclipse shader gate — no GPU needed.
 *
 * The world is built at each tier and driven through a frame with something in every table (a
 * lock's prominence and mote, a clear's beads and ring, the diamond and its glitter, a CME), and
 * every material in its scene is built through three's own node builders: the WGSL one of the
 * WebGPU backend and the GLSL one of the WebGL2 fallback. A graph one builder cannot turn into a
 * shader throws or warns here instead of leaving the eclipse undrawn on someone's machine.
 *
 * Also gated: each stage's size, MaterialX noise, a smoothstep whose two edges are the same
 * constant (a hard WGSL error), a NaN/Infinity literal, a WGSL var read where it may not have
 * been assigned, and a laid-out `se_*` helper that closes over a uniform or a texture.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, ANGLE). The harness is
 * tests/unit/blood-moon-shaders.test.js's. SE_DUMP_SHADERS=<dir> writes every stage there.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REST_RIG, SolarEclipseWorld, fovForAspect } from '../../src/themes/solar-eclipse/solar-eclipse-world.js';
import { fallbackLayout } from '../../src/themes/solar-eclipse/solar-eclipse-composition.js';

vi.setConfig({ testTimeout: 60_000 });

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** The dome draws the whole picture in one fragment: sky, sun, shore, clouds and the mirror. */
const STAGE_BUDGET = 112 * 1024;

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

const HELPER = /^fn (se_\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)^\}/gm;
const helpers = (wgsl) => [...wgsl.matchAll(HELPER)].map((m) => ({ name: m[1], body: m[2] }));
const captures = (body) => body.match(/nodeUniform\d+|NodeBuffer_\w+|\bobject\.\w+|\brender\.\w+|texture\w*\(/g);

function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

/** Reads of a `nodeVarN` where no assignment has certainly run (painted-ages-shaders.test.js). */
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
        if (/\bNaN\b|\bInfinity\b|object Object/.test(code)) {
            problems.push(`${name}, ${label} ${stage}: a NaN, Infinity or [object Object] literal`);
        }
    }
    if (/mx_\w+/.test(`${out.vertex}${out.fragment}`)) problems.push(`${name}, ${label}: MaterialX noise`);
    const entry = label === 'WGSL' ? [/@vertex/, /@fragment/] : [/void main\(\)/, /void main\(\)/];
    if (!entry[0].test(out.vertex)) problems.push(`${name}, ${label}: the vertex stage has no entry point`);
    if (!entry[1].test(out.fragment)) problems.push(`${name}, ${label}: the fragment stage has no entry point`);
    return problems;
}

describe.each(['High', 'Minimal'])('solar eclipse shaders at %s', (quality) => {
    const built = [];
    let world;

    beforeAll(() => {
        const scene = new THREE.Scene();
        const aspect = 16 / 9;
        const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
        world = new SolarEclipseWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, aspect);
        world.setLayout(fallbackLayout(1600, 900), aspect);
        world.seek(14);
        const frame = (time) => {
            const sim = {
                time, delta: 1 / 30, pointerX: 0, pointerY: 0,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
        };
        frame(14);
        world.onLock({ rows: [19, 18], u: 0.3, color: '#ff5f8a' });
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        for (let t = 14; t < 15.2; t += 1 / 30) frame(t);

        const targets = [];
        scene.traverse((object) => {
            if (object.material) targets.push([object.name, object, object.material]);
        });
        for (const [name, object, material] of targets) {
            BACKENDS.forEach(([label, Builder]) => {
                const [out, heard] = listening(() => build(Builder, object, material, stubRenderer(), scene, camera));
                built.push({
                    name, object, label, out, heard,
                });
                const dir = process.env.SE_DUMP_SHADERS;
                if (dir && !out.thrown) {
                    mkdirSync(dir, { recursive: true });
                    const ext = label === 'WGSL' ? 'wgsl' : 'glsl';
                    writeFileSync(path.join(dir, `${quality}-${name}-vertex.${ext}`), out.vertex);
                    writeFileSync(path.join(dir, `${quality}-${name}-fragment.${ext}`), out.fragment);
                }
            });
        }
    });

    afterAll(() => {
        world?.dispose();
    });

    it('builds every material for WebGPU and for the WebGL2 fallback without a word, under budget', () => {
        expect(built.length).toBe(6);
        expect(built.flatMap(problemsOf)).toEqual([]);
        const dome = built.find((b) => b.name === 'solar-eclipse-sky' && b.label === 'WGSL');
        expect(dome.out.fragment.length).toBeGreaterThan(20_000);
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

    it('keeps its laid-out se_ helpers functions of their arguments alone', () => {
        const dome = built.find((b) => b.name === 'solar-eclipse-sky' && b.label === 'WGSL');
        const found = helpers(dome.out.fragment);
        // The stars and the salt hash their cells; Minimal draws neither.
        if (quality === 'High') expect(found.map((h) => h.name)).toContain('se_hash21');
        found.forEach((h) => expect(captures(h.body), h.name).toBeNull());
    });
});
