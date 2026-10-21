/**
 * Serenity Warp shader gate — no GPU needed.
 *
 * Every material in the built world (found by walking the scene, so a part added later is gated
 * too: the sky, the pieces, the near stars, the dust, the streams and the flares), the environment
 * pass the pieces read, and the post stack's output are built through three's own node builders
 * against a stub renderer: the WGSL one of the WebGPU backend and the GLSL one of the WebGL2
 * fallback, at the tier the game defaults to and at the leanest. A graph one builder cannot turn
 * into a shader throws or warns here instead of leaving a part undrawn on someone's machine.
 *
 * Also gated: each stage's size, MaterialX noise (`mx_*`), a smoothstep whose two edges are the
 * same constant (a hard WGSL error), a NaN/Infinity literal, a node stringified into the code, a
 * laid-out `sw_*` helper given a reserved word as a parameter, and a WGSL var read where it may
 * not have been assigned. And the sky's own promise: the tiers that light the vortex, veil it in
 * dust or draw bright stars carry those reads, and the environment pass never does.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, ANGLE), and BloomNode's own passes
 * are built lazily by the renderer. The harness is tests/unit/sunset-shaders.test.js's.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import {
    REST_RIG, SERENITY_WARP_PARTS, SerenityWarpWorld, fovForAspect,
} from '../../src/themes/serenity-warp/serenity-warp-world.js';
import { POST_LOOK, SerenityWarpPost } from '../../src/themes/serenity-warp/serenity-warp-post.js';
import { fallbackLayout } from '../../src/themes/serenity-warp/serenity-warp-composition.js';
import { QUALITY } from '../../src/themes/serenity-warp/serenity-warp-quality.js';
import { SHAPES, cellsFromMatrix } from '../../src/themes/serenity-warp/serenity-warp-core.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** Per stage: the sky's fragment (the lens, the vortex, the stars, the throat, the tunnel) is the largest. */
const STAGE_BUDGET = 96 * 1024;
const W = 1600;
const H = 900;
/** The theme's laid-out Fn prefix (`setLayout({ name: 'sw_…' })`). */
const PREFIX = 'sw';
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
    getDrawingBufferSize: (t) => t.set(W, H),
    getSize: (t) => t.set(W, H),
});

/** What RenderPipeline's constructor needs. */
const fakeRenderer = () => ({
    isWebGPURenderer: true,
    backend: { isWebGPUBackend: true },
    getPixelRatio: () => 1,
    getDrawingBufferSize: (t) => t.set(W, H),
    getSize: (t) => t.set(W, H),
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

/** Every `sw_*` function a stage defines, with its parameters (WGSL, then GLSL). */
const HELPER = new RegExp(`^fn (${PREFIX}_\\w+)\\s*\\(([^)]*)\\)`, 'gm');
const GLSL_HELPER = new RegExp(`^\\w+ (${PREFIX}_\\w+)\\s*\\(([^)]*)\\)\\s*\\{`, 'gm');
const paramNames = (params) => params.split(',').map((p) => p.trim()).filter(Boolean)
    .map((p) => (p.includes(':') ? p.split(':')[0] : p.split(/\s+/).at(-1)).trim());

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
        if (/object Object/.test(code)) problems.push(`${name}, ${label} ${stage}: a node stringified into the code`);
        const pattern = label === 'WGSL' ? HELPER : GLSL_HELPER;
        [...code.matchAll(pattern)].forEach((m) => paramNames(m[2]).forEach((param) => {
            if (RESERVED.has(param)) problems.push(`${name}, ${label} ${stage}: ${m[1]} takes reserved word "${param}"`);
        }));
    }
    if (/mx_\w+/.test(`${out.vertex}${out.fragment}`)) problems.push(`${name}, ${label}: MaterialX noise`);
    const entry = label === 'WGSL' ? [/@vertex/, /@fragment/] : [/void main\(\)/, /void main\(\)/];
    if (!entry[0].test(out.vertex)) problems.push(`${name}, ${label}: the vertex stage has no entry point`);
    if (!entry[1].test(out.fragment)) problems.push(`${name}, ${label}: the fragment stage has no entry point`);
    return problems;
}

/** How many reads of the gas volume (the stage's one 3D texture) a WGSL stage makes. */
function gasReads(wgsl) {
    const declared = wgsl.match(/(\w+)\s*:\s*texture_3d<f32>/);
    if (!declared) return 0;
    return (wgsl.match(new RegExp(`textureSample\\w*\\(\\s*${declared[1]}\\b`, 'g')) || []).length;
}

describe.each(TIERS)('serenity-warp shaders at %s', (quality) => {
    let world;
    let scene;
    let camera;
    /** { name, object, label, out, heard } per material and backend. */
    const built = [];

    beforeAll(() => {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(fovForAspect(W / H), W / H, REST_RIG.near, REST_RIG.far);
        world = new SerenityWarpWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(W, H, W / H);
        world.setLayout(fallbackLayout(W, H), W / H);
        world.seek(20);
        const sim = (time) => ({
            time, delta: 1 / 30, pointerX: 0, pointerY: 0,
        });
        world.updateCamera(camera, sim(20));
        world.update(sim(20), camera);
        // A frame mid-game: pieces locked, a clear's rings out, a chain held.
        const keys = Object.keys(SHAPES);
        for (let i = 0; i < 5; i += 1) {
            world.onLock({
                rows: [19 - i], u: (i * 0.37) % 1, color: '#8b5cf6', cells: cellsFromMatrix(SHAPES[keys[i % keys.length]]), hardDrop: i === 2,
            });
        }
        world.onClear({ lines: 2, rows: [19, 18] });
        world.onCombo(4);
        world.updateCamera(camera, sim(21));
        world.update(sim(21), camera);

        const targets = [];
        scene.traverse((object) => {
            if (!object.material) return;
            (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
                targets.push([object.name || material.name || object.type, object, material]);
            });
        });
        // The environment pass is drawn with a QuadMesh outside the scene.
        targets.push(['SerenityWarpEnvironment', world.sky.pass.quad, world.sky.pass.material]);
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

    it('has a node material to build for every part', () => {
        for (const name of SERENITY_WARP_PARTS) {
            const { mesh } = world.parts[name];
            const meshes = mesh.isGroup ? mesh.children : [mesh];
            expect(meshes.length, name).toBeGreaterThan(0);
            meshes.forEach((m) => {
                expect(m.material.isNodeMaterial, name).toBe(true);
                const labels = built.filter((b) => b.object === m).map((b) => b.label);
                expect(labels, name).toEqual(expect.arrayContaining(['WGSL', 'GLSL']));
            });
        }
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

    it("lights and veils the vortex only on the tiers that pay for it, and never in the glass's mirror", () => {
        const tier = QUALITY[quality];
        const sky = built.find((b) => b.name === 'SerenityWarpSky' && b.label === 'WGSL');
        const env = built.find((b) => b.name === 'SerenityWarpEnvironment' && b.label === 'WGSL');
        // Our sky's reads (far gas, its curl, the vortex, its fine read, the lit face, the near
        // dust) and the throat's two: each tier flag adds exactly its own.
        const extra = (tier.warpRead ? 1 : 0) + (tier.detail ? 1 : 0);
        const base = 2 + 2 + extra;
        expect(gasReads(sky.out.fragment)).toBe(base + (tier.vortexLight ? 1 : 0) + (tier.vortexDust ? 1 : 0));
        expect(gasReads(env.out.fragment)).toBe(base);
    });

    it("builds the post stack's output on both backends without a word", () => {
        const look = POST_LOOK[quality];
        const post = new SerenityWarpPost(fakeRenderer(), scene, camera, { look });
        const material = new THREE.NodeMaterial();
        material.fragmentNode = post.pipeline.outputNode;
        const quad = new THREE.QuadMesh(material);
        const problems = [];
        BACKENDS.forEach(([label, Builder]) => {
            const [out, heard] = listening(() => build(Builder, quad, material, postRenderer(), scene, quad.camera));
            problems.push(...problemsOf({
                name: 'post', label, out, heard,
            }));
        });
        expect(problems).toEqual([]);
        material.dispose();
    });
});
