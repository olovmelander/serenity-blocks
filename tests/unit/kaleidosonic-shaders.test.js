/**
 * Kaleidosonic shader gate — no GPU needed.
 *
 * Every material in the built world (found by walking the scene, so a part added later is gated
 * too: today the one full-screen temple march) and the post stack's output (its look per tier, and
 * the falseColor debug view) are built through three's own node builders against a stub renderer:
 * the WGSL one of the WebGPU backend and the GLSL one of the WebGL2 fallback, at the tier the theme
 * defaults to, at the leanest and at the richest (the only one here with the soft shadow). The
 * temple's scout pass (drawn before the frame, not in the scene) is built with them. A graph one
 * builder cannot turn into a shader throws or warns here instead of leaving the temple undrawn on
 * someone's machine.
 *
 * Also gated: how often each march calls the field (a value read twice can be emitted twice: the
 * soft shadow once ran the whole fractal twice a step), each stage's size (a march unrolled in JS
 * instead of looped shows up as a module of hundreds of KB), MaterialX noise (`mx_*`), a
 * smoothstep whose two edges are the same constant (a hard WGSL error), a NaN/Infinity literal, a
 * WGSL var read where it may not have been assigned, and a laid-out `ks_*` helper that closes over
 * a uniform or a texture (cached module-wide, it would emit invalid WGSL in the second material
 * that uses it).
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, ANGLE), BloomNode's own passes are
 * built lazily by the renderer, and there is no compute. The harness is
 * tests/unit/high-coast-shaders.test.js's.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { KALEIDOSONIC_PARTS, KaleidosonicWorld } from '../../src/themes/kaleidosonic/kaleidosonic-world.js';
import { KaleidosonicPost, POST_LOOK } from '../../src/themes/kaleidosonic/kaleidosonic-post.js';
import { PIECE_COLORS } from '../../src/themes/kaleidosonic/kaleidosonic-core.js';
import { tierFor } from '../../src/themes/kaleidosonic/kaleidosonic-quality.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Minimal', 'Extreme'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** Per stage. The march, its veins, strikes and harmonics are loops, so the temple stays small. */
const STAGE_BUDGET = 64 * 1024;
/** The theme's laid-out Fn prefix (`setLayout({ name: 'ks_…' })`). */
const PREFIX = 'ks';

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

/** What the scene pass inside the post reads from the renderer as it is set up. */
const postRenderer = () => ({
    ...stubRenderer(),
    samples: 0,
    getOutputBufferType: () => THREE.HalfFloatType,
    reversedDepthBuffer: false,
    getPixelRatio: () => 1,
    getDrawingBufferSize: (t) => t.set(1280, 720),
    getSize: (t) => t.set(1280, 720),
});

/** What RenderPipeline's constructor needs. */
const fakeRenderer = () => ({
    isWebGPURenderer: true,
    backend: { isWebGPUBackend: true },
    getPixelRatio: () => 1,
    getDrawingBufferSize: (t) => t.set(1280, 720),
    getSize: (t) => t.set(1280, 720),
});

/** Both stages of one material on one object, as one backend would write them. */
function build(Builder, object, material, renderer = stubRenderer(), scene = new THREE.Scene(), camera = null) {
    const builder = new Builder(object, renderer);
    builder.scene = scene;
    builder.camera = camera || new THREE.PerspectiveCamera();
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

/** Every `ks_*` function a WGSL stage defines: name → body. */
const HELPER = new RegExp(`^fn (${PREFIX}_\\w+)\\s*\\([^)]*\\)[^{]*\\{([\\s\\S]*?)^\\}`, 'gm');
const helpers = (wgsl) => [...wgsl.matchAll(HELPER)].map((m) => ({ name: m[1], body: m[2] }));

/** What a helper's body names that is neither an argument nor a local: uniforms, arrays, textures. */
const captures = (body) => body.match(/nodeUniform\d+|NodeBuffer_\w+|\bobject\.\w+|\brender\.\w+|texture\w*\(/g);

/** smoothstep() calls whose two edges are the same constant: a hard error in WGSL. */
function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

/**
 * Reads of a `nodeVarN` at a point where no assignment to it has certainly run, in every `fn` of
 * a WGSL stage (the helper of tests/unit/painted-ages-shaders.test.js).
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

/** What is wrong with one built stage pair, as one line per problem. */
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
    }
    if (/mx_\w+/.test(`${out.vertex}${out.fragment}`)) problems.push(`${name}, ${label}: MaterialX noise`);
    const entry = label === 'WGSL' ? [/@vertex/, /@fragment/] : [/void main\(\)/, /void main\(\)/];
    if (!entry[0].test(out.vertex)) problems.push(`${name}, ${label}: the vertex stage has no entry point`);
    if (!entry[1].test(out.fragment)) problems.push(`${name}, ${label}: the fragment stage has no entry point`);
    return problems;
}

describe.each(TIERS)('kaleidosonic shaders at %s', (quality) => {
    let world;
    let scene;
    /** { name, object, label, out, heard } per material and backend. */
    const built = [];

    beforeAll(() => {
        scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 60);
        world = new KaleidosonicWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, 16 / 9);
        world.updateCamera(camera, { time: 5, delta: 0 });
        world.update({ time: 5, delta: 0 }, camera);
        // Something in every table, as a frame mid-game has: strikes, harmonics, a dive, the folds.
        world.onLock({
            u: 0.3, rows: [9, 8], color: PIECE_COLORS[0], shape: 'I',
        });
        world.onLock({
            u: 0.7, rows: [9], color: PIECE_COLORS[6], shape: 'O', hardDrop: true, distance: 12,
        });
        world.onClear({ lines: 4, tspin: true, combo: 3 });
        world.onCombo(9);
        world.updateCamera(camera, { time: 6, delta: 0 });
        world.update({ time: 6, delta: 1 / 30 }, camera);

        const targets = [];
        scene.traverse((object) => {
            if (!object.material) return;
            (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
                targets.push([object.name || material.name || object.type, object, material]);
            });
        });
        const { scout } = world.parts.temple;
        targets.push([scout.quad.name, scout.quad, scout.material]);
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

    it('has a material to build for every part, every mesh of it, on both backends', () => {
        for (const name of KALEIDOSONIC_PARTS) {
            const part = world.parts[name];
            const meshes = part.meshes || [part.mesh];
            expect(meshes.length, name).toBeGreaterThan(0);
            meshes.forEach((root) => root.traverse((object) => {
                if (!object.material) return;
                const labels = built.filter((b) => b.object === object).map((b) => b.label);
                expect(labels, `${name}: ${object.name}`).toEqual(expect.arrayContaining(['WGSL', 'GLSL']));
                expect(object.material.isNodeMaterial, `${name}: ${object.name}`).toBe(true);
            }));
        }
        expect(built.length).toBeGreaterThanOrEqual(KALEIDOSONIC_PARTS.length * 2);
    });

    it('builds every material for WebGPU and for the WebGL2 fallback without a word, under budget', () => {
        expect(built.flatMap(problemsOf)).toEqual([]);
        // The temple is the whole picture and is really there: the march loops, it is not unrolled.
        const temple = built.find((b) => b.object === world.parts.temple.mesh && b.label === 'WGSL');
        expect(temple.out.fragment.length).toBeGreaterThan(5_000);
        expect(temple.out.fragment).toMatch(/\bloop\b|\bfor\s*\(/);
    });

    it('caps the field\'s folds at the tier\'s: one laid-out field per material, named for its cap', () => {
        const { folds } = tierFor(quality);
        const temple = built.filter((b) => b.object === world.parts.temple.mesh && !b.out.thrown);
        expect(temple).toHaveLength(2);
        const wgsl = temple.find((b) => b.label === 'WGSL').out.fragment;
        const fields = helpers(wgsl).filter((h) => /^ks_temple\d+$/.test(h.name)).map((h) => h.name);
        expect(fields).toEqual([`ks_temple${Math.max(2, Math.round(folds))}`]);
    });

    it('calls the field once a site: the march, four normal taps, the occlusion tap and the shadow step', () => {
        const { folds, shadowSteps } = tierFor(quality);
        const field = new RegExp(`\\bks_temple${Math.max(2, Math.round(folds))}\\s*\\(`, 'g');
        // the definition's own `fn ks_templeN (` is not a call
        const calls = (wgsl, pattern) => (wgsl.match(pattern) || []).length - 1;
        const wgslOf = (object) => built.find((b) => b.object === object && b.label === 'WGSL').out.fragment;
        const { mesh, scout } = world.parts.temple;
        expect(calls(wgslOf(mesh), field)).toBe(1 + 4 + 1 + (shadowSteps > 0 ? 1 : 0));
        // the orbit trap colours the stone: read once, at the hit
        expect(calls(wgslOf(mesh), /\bks_templeTrap\d+\s*\(/g)).toBe(1);
        expect(calls(wgslOf(scout.quad), field)).toBe(1);
    });

    it('reads no WGSL var where it may not have been assigned', () => {
        const found = [];
        built.filter((b) => b.label === 'WGSL' && !b.out.thrown).forEach(({ name, out }) => {
            for (const stage of ['vertex', 'fragment']) {
                unassignedReads(out[stage] ?? '').forEach((read) => found.push(`${name} ${stage}: ${read}`));
            }
        });
        expect(found).toEqual([]);
        // The check sees the trap: a var assigned in one branch and read after it.
        expect(unassignedReads([
            'fn main() {', 'if ( c ) {', 'nodeVar1 = 1.0;', '} else {', 'nodeVar2 = 0.0;', '}',
            'nodeVar3 = nodeVar1;', '}',
        ].join('\n'))).toHaveLength(1);
    });

    it('emits each shared ks_ helper once per stage, as a function of its arguments alone', () => {
        let seen = 0;
        const problems = [];
        const wgsl = built.filter((b) => b.label === 'WGSL' && !b.out.thrown);
        wgsl.forEach(({ name, out }) => ['vertex', 'fragment'].forEach((stage) => {
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
    ])('builds the post stack\'s output (%s) on both backends without a word', (_, variant) => {
        const camera = new THREE.PerspectiveCamera();
        const post = new KaleidosonicPost(fakeRenderer(), scene, camera, { look: POST_LOOK[quality], ...variant });
        expect(Boolean(post.bloomNode)).toBe(POST_LOOK[quality].bloom === true);
        const material = new THREE.NodeMaterial();
        material.fragmentNode = post.pipeline.outputNode;
        const quad = new THREE.QuadMesh(material);
        try {
            const problems = [];
            BACKENDS.forEach(([label, Builder]) => {
                const [out, heard] = listening(
                    () => build(Builder, quad, material, postRenderer(), scene, quad.camera),
                );
                problems.push(...problemsOf({
                    name: `post ${JSON.stringify(variant)}`, label, out, heard,
                }));
                if (label === 'WGSL' && !out.thrown) {
                    helpers(out.fragment).forEach((h) => {
                        const captured = captures(h.body);
                        if (captured) problems.push(`${h.name} in the post reads ${captured.join(', ')}`);
                    });
                }
            });
            expect(problems).toEqual([]);
        } finally {
            post.dispose();
            material.dispose();
        }
        expect(post.pipeline).toBeNull();
    });
});
