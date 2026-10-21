/**
 * Void Ember shader gate — no GPU needed.
 *
 * Every material in the built world (found by walking the scene, so a part added later is gated
 * too: the photosphere, the corona, the loops, the stones, the dust ring, the cinder world, the sky
 * and the event parts) and the post stack's output are built through three's own node builders
 * against a stub renderer: the WGSL one of the WebGPU backend and the GLSL one of the WebGL2
 * fallback, at the tier the theme defaults to and at the leanest. A graph one builder cannot turn
 * into a shader throws or warns here instead of leaving a part undrawn on someone's machine.
 *
 * Also gated: each stage's size (a feature unrolled in JS instead of looped shows up as a module of
 * 100 KB), MaterialX noise (`mx_*`), a smoothstep whose two edges are the same constant (a hard
 * WGSL error), a NaN/Infinity literal, a node concatenated into the source as a string, a WGSL var
 * read where it may not have been assigned, a laid-out `ve_*` helper that closes over a uniform or
 * a texture (cached module-wide, it would emit invalid WGSL in the second material that uses it) or
 * takes a parameter named with a reserved word, and that no material searches cells per pixel (the
 * crust's plates are baked once). The bake itself is checked at the end: the cube mapping, the
 * cracks it draws, its seams, and that it is made once.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, ANGLE), and BloomNode's own passes
 * are built lazily by the renderer. The harness is tests/unit/luminous-tides-shaders.test.js's.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import {
    REST_RIG, VOID_EMBER_PARTS, VoidEmberWorld, fovForAspect,
} from '../../src/themes/void-ember/void-ember-world.js';
import { POST_LOOK, VoidEmberPost } from '../../src/themes/void-ember/void-ember-post.js';
import { QUALITY } from '../../src/themes/void-ember/void-ember-quality.js';
import { fallbackLayout } from '../../src/themes/void-ember/void-ember-composition.js';
import { VOID_EMBER_TETROMINOS } from '../../src/themes/void-ember/void-ember-tetrominos.js';
import {
    PLATES, bakePlates, createPlatesTexture, cubeFace, plateAtlasSize,
} from '../../src/themes/void-ember/void-ember-tsl.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const STAGE_BUDGET = 64 * 1024;
/** The theme's laid-out Fn prefix (`setLayout({ name: 've_…' })`). */
const PREFIX = 've';
/** Words WGSL or GLSL reserves that read like ordinary parameter names. */
const RESERVED = new Set([
    'from', 'of', 'in', 'out', 'inout', 'input', 'output', 'type', 'set', 'get', 'use', 'target',
    'filter', 'smooth', 'flat', 'sample', 'patch', 'common', 'shared', 'static', 'self', 'this',
    'match', 'mod', 'module', 'move', 'new', 'null', 'pass', 'precise', 'resource', 'with', 'where',
    'meta', 'macro', 'layout', 'active', 'attribute', 'varying', 'uniform', 'buffer', 'texture',
    'fn', 'let', 'var', 'const', 'override', 'struct', 'enable', 'requires', 'switch', 'case',
    'default', 'loop', 'continuing', 'discard', 'return', 'true', 'false', 'bitcast',
]);

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

/** Every `ve_*` function a WGSL stage defines: name → parameters, body. */
const HELPER = new RegExp(`^fn (${PREFIX}_\\w+)\\s*\\(([^)]*)\\)[^{]*\\{([\\s\\S]*?)^\\}`, 'gm');
const helpers = (wgsl) => [...wgsl.matchAll(HELPER)].map((m) => ({ name: m[1], params: m[2], body: m[3] }));
/** Every `ve_*` function a GLSL stage defines: name → parameters. */
const GLSL_HELPER = new RegExp(`^\\w+ (${PREFIX}_\\w+)\\s*\\(([^)]*)\\)\\s*\\{`, 'gm');
const paramNames = (params) => params.split(',').map((p) => p.trim()).filter(Boolean)
    .map((p) => (p.includes(':') ? p.split(':')[0] : p.split(/\s+/).at(-1)).trim());

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
        } else if (/^\}\s*else\s*(if\s*\(.*\)\s*)?\{$/.test(line)) {
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
        if (/object Object/.test(code)) problems.push(`${name}, ${label} ${stage}: a node concatenated as a string`);
        const pattern = label === 'WGSL' ? HELPER : GLSL_HELPER;
        [...code.matchAll(pattern)].forEach((m) => paramNames(m[2]).forEach((param) => {
            if (!RESERVED.has(param)) return;
            problems.push(`${name}, ${label} ${stage}: ${m[1]} takes reserved word "${param}"`);
        }));
    }
    if (/mx_\w+/.test(`${out.vertex}${out.fragment}`)) problems.push(`${name}, ${label}: MaterialX noise`);
    const entry = label === 'WGSL' ? [/@vertex/, /@fragment/] : [/void main\(\)/, /void main\(\)/];
    if (!entry[0].test(out.vertex)) problems.push(`${name}, ${label}: the vertex stage has no entry point`);
    if (!entry[1].test(out.fragment)) problems.push(`${name}, ${label}: the fragment stage has no entry point`);
    return problems;
}

const COLORS = VOID_EMBER_TETROMINOS.colors;
/** A loop over a 3 × 3 × 3 neighbourhood: a cellular search, in WGSL or GLSL. */
const CELL_SEARCH = /for\s*\([^;]*;[^;]*<\s*27\b/;
/** Texture fetches in one stage. */
const fetches = (code) => (code.match(/\btextureSampleLevel\s*\(|\btextureLod\s*\(/g) ?? []).length;

describe.each(TIERS)('void ember shaders at %s', (quality) => {
    let world;
    let scene;
    /** { name, object, label, out, heard } per material and backend. */
    const built = [];

    beforeAll(() => {
        scene = new THREE.Scene();
        const aspect = 1600 / 900;
        const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
        world = new VoidEmberWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, aspect);
        world.setLayout(fallbackLayout(1600, 900), aspect);
        const step = (time, delta) => {
            const sim = {
                time, delta, pointerX: 0, pointerY: 0,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
        };
        world.seek(10);
        step(10, 0);
        // Something in every table, as a frame mid-game has.
        world.onLock({ u: 0.3, rows: [12], color: COLORS.J });
        world.onLock({
            u: 0.7, rows: [18], color: COLORS.T, hardDrop: true,
        });
        world.onCombo(3);
        world.onClear({ lines: 2, rows: [19, 18] });
        world.onClear({ lines: 4, rows: [19, 18, 17, 16] });
        step(11, 1);

        const targets = [];
        scene.traverse((object) => {
            if (!object.material) return;
            (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
                targets.push([object.name || material.name || object.type, object, material]);
            });
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

    afterAll(() => world?.dispose?.());

    it('has a node material on both backends for every part the world builds', () => {
        const names = new Set(built.map((b) => b.name));
        expect(names.size).toBeGreaterThanOrEqual(8);
        expect(VOID_EMBER_PARTS.length).toBeGreaterThan(0);
        built.forEach((b) => expect(b.object.material.isNodeMaterial, b.name).toBe(true));
        names.forEach((name) => {
            const labels = built.filter((b) => b.name === name).map((b) => b.label);
            expect(labels, name).toEqual(expect.arrayContaining(['WGSL', 'GLSL']));
        });
    });

    it('builds every material for WebGPU and for the WebGL2 fallback without a word, under budget', () => {
        expect(built.flatMap(problemsOf)).toEqual([]);
    });

    it('reads the crust\'s plates from the baked atlas: no cellular search per pixel', () => {
        // Searching 27 cells a pixel, twice, cost the scene pass a third on an integrated GPU;
        // the plates are baked once (bakePlates) and the star reads them with one fetch.
        built.forEach(({ name, label, out }) => {
            ['vertex', 'fragment'].forEach((stage) => {
                expect(CELL_SEARCH.test(out[stage] ?? ''), `${name} ${label} ${stage}`).toBe(false);
            });
        });
        const star = built.filter((b) => b.name === 'VoidEmberPhotosphere');
        expect(star).toHaveLength(2);
        // The lattice reads by tier, the impacts' loop, and the one plates fetch: a handful.
        star.forEach(({ label, out }) => expect(fetches(out.fragment), label).toBeLessThanOrEqual(8));
        // The fire in the stones' fractures reads the same atlas, on the tiers that have cracks.
        const stones = built.filter((b) => /^VoidEmberRocks_/.test(b.name));
        expect(stones.length).toBeGreaterThan(0);
        stones.forEach(({ name, label, out }) => {
            expect(fetches(out.fragment), `${name} ${label}`).toBe(QUALITY[quality].cracks ? 1 : 0);
        });
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

    it('emits each shared ve_ helper once per stage, as a function of its arguments alone', () => {
        let seen = 0;
        const problems = [];
        built.filter((b) => b.label === 'WGSL' && !b.out.thrown).forEach(({ name, out }) => {
            ['vertex', 'fragment'].forEach((stage) => {
                const found = helpers(out[stage]);
                seen += found.length;
                const names = found.map((h) => h.name);
                if (new Set(names).size !== names.length) {
                    problems.push(`${name} ${stage}: ${names.join(', ')} repeats`);
                }
                found.forEach((h) => {
                    const captured = captures(h.body);
                    if (captured) problems.push(`${h.name} in ${name}'s ${stage} reads ${captured.join(', ')}`);
                });
            });
        });
        expect(problems).toEqual([]);
        expect(seen).toBeGreaterThan(0);
    });

    it('builds the post stack\'s output on both backends without a word', () => {
        const camera = new THREE.PerspectiveCamera();
        const post = new VoidEmberPost(fakeRenderer(), scene, camera, {
            look: POST_LOOK[quality], noise: world.noiseTexture,
        });
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
                    name: 'post', label, out, heard,
                }));
            });
            expect(problems).toEqual([]);
        } finally {
            post.dispose();
            material.dispose();
        }
    });
});

describe('void ember crust plates bake', () => {
    const bake = bakePlates();
    const { tile } = plateAtlasSize();
    const { gutter, face } = PLATES;
    /** The texel of the atlas at (u, v) on cube face f (u, v in −1..1), channel c (0..1). */
    const at = (f, u, v, c) => {
        const i = Math.min(tile - 1, Math.max(0, Math.floor(gutter + (u * 0.5 + 0.5) * face)));
        const j = Math.min(tile - 1, Math.max(0, Math.floor(gutter + (v * 0.5 + 0.5) * face)));
        const x = (f % 3) * tile + i;
        const y = Math.floor(f / 3) * tile + j;
        return bake.data[(y * bake.width + x) * 4 + c] / 255;
    };

    it('maps a direction to one cube face and back', () => {
        const out = [0, 0, 0];
        for (let k = 0; k < 400; k++) {
            const z = Math.cos(k * 2.399) * 0.999;
            const r = Math.sqrt(1 - z * z);
            const d = [Math.cos(k * 0.7) * r, z, Math.sin(k * 0.7) * r];
            cubeFace(d[0], d[1], d[2], out);
            expect(out[0]).toBeGreaterThanOrEqual(0);
            expect(out[0]).toBeLessThan(6);
            expect(Math.abs(out[1])).toBeLessThanOrEqual(1 + 1e-9);
            expect(Math.abs(out[2])).toBeLessThanOrEqual(1 + 1e-9);
            // The face's own axis is the largest component, and its sign is the face's parity.
            const axis = Math.floor(out[0] / 2);
            const m = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
            expect(Math.abs(d[axis])).toBeCloseTo(m, 9);
            expect(Math.sign(d[axis])).toBe(out[0] % 2 === 0 ? 1 : -1);
        }
    });

    it('draws a net of cracks between plates, at both scales, with every plate its own number', () => {
        let cracks = 0;
        let chips = 0;
        let total = 0;
        const ids = new Set();
        for (let f = 0; f < 6; f++) {
            for (let j = -0.95; j < 1; j += 0.025) {
                for (let i = -0.95; i < 1; i += 0.025) {
                    total += 1;
                    if (at(f, i, j, 0) * PLATES.range < 0.06) cracks += 1;
                    if (at(f, i, j, 2) * PLATES.range < 0.03) chips += 1;
                    ids.add(Math.round(at(f, i, j, 1) * 255));
                }
            }
        }
        // Thin lines, not blotches, and not missing.
        expect(cracks / total).toBeGreaterThan(0.02);
        expect(cracks / total).toBeLessThan(0.25);
        expect(chips / total).toBeGreaterThan(0.02);
        expect(chips / total).toBeLessThan(0.25);
        expect(ids.size).toBeGreaterThan(40);
    });

    it('joins its faces without a seam: a face\'s gutter continues the face beside it', () => {
        // Just past the +x face's edge at u = +1 (toward +y) is the +y face near its own v = +1 edge.
        const out = [0, 0, 0];
        let worst = 0;
        for (let v = -0.9; v <= 0.9; v += 0.1) {
            const u = 1 + (1.5 / face) * 2; // inside the gutter
            const d = [1, u, v];
            cubeFace(d[0], d[1], d[2], out);
            const inGutter = at(0, u, v, 0);
            const onNeighbour = at(out[0], out[1], out[2], 0);
            worst = Math.max(worst, Math.abs(inGutter - onNeighbour));
        }
        expect(worst).toBeLessThan(0.08);
    });

    it('is baked once per page and shared by every world', () => {
        const a = createPlatesTexture();
        const b = createPlatesTexture();
        // (Compared as booleans: an object compare pretty-prints 2.5 MB of texels, for seconds.)
        expect(a === b).toBe(false);
        expect(a.image.data === b.image.data).toBe(true);
        expect(a.generateMipmaps).toBe(false);
        a.dispose();
        b.dispose();
    });
});
