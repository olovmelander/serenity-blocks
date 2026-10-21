/**
 * Murmuration shader gate — no GPU needed.
 *
 * The swarm's motes, the night sky and the post stack's output are built through three's own node
 * builders against a stub renderer: the WGSL one of the WebGPU backend (the swarm read from storage
 * buffers, as the compute path draws it) and the GLSL one of the WebGL2 fallback (the swarm read from
 * instanced attributes, as the CPU path draws it), at the tier the theme defaults to and at the
 * leanest. A graph one builder cannot turn into a shader throws or warns here instead of leaving the
 * swarm undrawn on someone's machine.
 *
 * Also gated: each stage's size, MaterialX noise (`mx_*`), a smoothstep whose two edges are the same
 * constant (a hard WGSL error), a NaN/Infinity literal, a WGSL var read where it may not have been
 * assigned, a laid-out `murm_*` helper that closes over a uniform or a texture (cached module-wide,
 * it would emit invalid WGSL in the second material that uses it), and a helper parameter named with
 * a reserved word: the builders print names as given, and only Tint or ANGLE reject them (a helper
 * that took `from` drew nothing at all until it was renamed).
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, ANGLE), BloomNode's own passes are
 * built lazily by the renderer, and there is no compute. The harness is
 * tests/unit/luminous-tides-shaders.test.js's.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { FluidParticleSim, getFluidBudget } from '../../src/themes/murmuration/sim/fluid-particles.js';
import { createFluidParticlesRenderer } from '../../src/themes/murmuration/rendering/fluid-particles-renderer.js';
import { createNebulaSky } from '../../src/themes/murmuration/rendering/nebula-volume.js';
import { SwarmPostPipeline, getSwarmPostProfile } from '../../src/themes/murmuration/post/render-pipeline.js';
import { QUALITY_PRESETS, swarmLook } from '../../src/themes/murmuration/composition/swarm-tiers.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [
    ['WGSL', THREE.WGSLNodeBuilder, { native: true }],
    ['GLSL', THREE.GLSLNodeBuilder, { native: false }],
];
const STAGE_BUDGET = 48 * 1024;
/** The theme's laid-out Fn prefix (`setLayout({ name: 'murm_…' })`). */
const PREFIX = 'murm';
/**
 * Words WGSL reserves (or keeps as keywords) and GLSL reserves that read like ordinary parameter
 * names. Not every reserved word: the ones a helper is likely to be given.
 */
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

/** What RenderPipeline's constructor needs (`native` = the WebGPU backend, so selective MRT bloom). */
const fakeRenderer = (native) => ({
    isWebGPURenderer: true,
    backend: native ? { isWebGPUBackend: true } : { isWebGLBackend: true },
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

/** Every `murm_*` function a WGSL stage defines: name → parameters, body. */
const HELPER = new RegExp(`^fn (${PREFIX}_\\w+)\\s*\\(([^)]*)\\)[^{]*\\{([\\s\\S]*?)^\\}`, 'gm');
const helpers = (wgsl) => [...wgsl.matchAll(HELPER)].map((m) => ({ name: m[1], params: m[2], body: m[3] }));

/** Every `murm_*` function a GLSL stage defines: name → parameters. */
const GLSL_HELPER = new RegExp(`^\\w+ (${PREFIX}_\\w+)\\s*\\(([^)]*)\\)\\s*\\{`, 'gm');

/** The parameter names in a helper's signature, either language. */
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

describe.each(TIERS)('murmuration shaders at %s', (quality) => {
    const preset = QUALITY_PRESETS[quality];
    /** { name, label, out, heard } per material and backend. */
    const built = [];
    const disposers = [];

    beforeAll(() => {
        BACKENDS.forEach(([label, Builder, { native }]) => {
            const budget = getFluidBudget(quality, { native });
            const sim = new FluidParticleSim(budget.count, {
                cpu: !native, focalRadius: budget.focalRadius, gravityStrength: budget.gravityStrength,
            });
            const look = swarmLook(quality, budget.count);
            const swarm = createFluidParticlesRenderer(sim, {
                sizeMul: look.sizeMul,
                exposure: look.exposure,
                aperture: preset.aperture,
                maxBlur: preset.maxBlur,
                stretch: preset.stretch,
            });
            const sky = createNebulaSky({ detail: preset.skyDetail });
            disposers.push(() => swarm.dispose(), () => sky.dispose(), () => sim.dispose());
            [['swarm', swarm.mesh], ['sky', sky.mesh]].forEach(([name, mesh]) => {
                const [out, heard] = listening(() => build(Builder, mesh, mesh.material));
                built.push({
                    name, label, out, heard,
                });
            });
        });
    });

    afterAll(() => disposers.forEach((dispose) => dispose()));

    it('builds the swarm and the sky for WebGPU and for the WebGL2 fallback without a word, under budget', () => {
        expect(built.flatMap(problemsOf)).toEqual([]);
        expect(built).toHaveLength(4);
        // The swarm on WebGPU reads the simulation's storage buffers; on WebGL2, its attributes.
        const swarmWgsl = built.find((b) => b.name === 'swarm' && b.label === 'WGSL');
        const swarmGlsl = built.find((b) => b.name === 'swarm' && b.label === 'GLSL');
        expect(swarmWgsl.out.vertex).toMatch(/var<storage/);
        expect(swarmGlsl.out.vertex).toMatch(/aFluidPosition/);
    });

    it('turns the hot swarm\'s hue in one laid-out helper, called once a stage', () => {
        // The heat's turn of hue (cool → violet → rose → fire) is murm_turnHue: one definition
        // and one call in the swarm's vertex stage, on both backends.
        built.filter((b) => b.name === 'swarm').forEach(({ label, out }) => {
            const uses = out.vertex.match(/\bmurm_turnHue\s*\(/g) ?? [];
            expect(uses.length, label).toBe(2);
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

    it('emits each shared murm_ helper once per stage, as a function of its arguments alone', () => {
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

    it.each(BACKENDS.map(([label, , { native }]) => [label, native]))(
        'builds the post stack\'s output for %s without a word',
        (label, native) => {
            const profile = getSwarmPostProfile(quality);
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera();
            const post = new SwarmPostPipeline(fakeRenderer(native), scene, camera, {
                ...profile, useMRT: preset.useMRT,
            });
            const material = new THREE.NodeMaterial();
            material.fragmentNode = post.postProcessing.outputNode;
            const quad = new THREE.QuadMesh(material);
            try {
                const Builder = BACKENDS.find(([l]) => l === label)[1];
                const [out, heard] = listening(
                    () => build(Builder, quad, material, postRenderer(), scene, quad.camera),
                );
                expect(problemsOf({
                    name: 'post', label, out, heard,
                })).toEqual([]);
            } finally {
                post.dispose();
                material.dispose();
            }
        },
    );
});
