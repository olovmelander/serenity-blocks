/**
 * Chromatic Impasto shader gate — no GPU needed.
 *
 * Every material the world draws (found by walking the scene: the canvas surface, the thrown paint
 * and its shadows, the dust) and every pass of the paint canvas itself (the two stamps, fill, dry
 * and the two bakes), and the post stack's output, are built through three's own node builders
 * against a stub renderer: the WGSL one of the WebGPU backend and the GLSL one of the WebGL2
 * fallback, at the tier the theme defaults to, at the leanest and at the richest. A graph one
 * builder cannot turn into a shader throws or warns here instead of leaving the canvas undrawn on
 * someone's machine.
 *
 * Also gated: each stage's size, MaterialX noise (`mx_*`), a smoothstep whose two edges are the
 * same constant (a hard WGSL error), a NaN/Infinity literal, a WGSL var read where it may not have
 * been assigned, and a laid-out `ci_*` helper that closes over a uniform or a texture (cached
 * module-wide, it would emit invalid WGSL in the second material that uses it). The harness is
 * tests/unit/kaleidosonic-shaders.test.js's.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { ChromaticImpastoWorld, REST_RIG } from '../../src/themes/chromatic-impasto/chromatic-impasto-world.js';
import { ChromaticImpastoPost, POST_LOOK } from '../../src/themes/chromatic-impasto/chromatic-impasto-post.js';
import { fallbackLayout } from '../../src/themes/chromatic-impasto/chromatic-impasto-composition.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Minimal', 'Extreme'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const STAGE_BUDGET = 64 * 1024;
/** The theme's laid-out Fn prefix (`setLayout({ name: 'ci_…' })`). */
const PREFIX = 'ci';

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

describe.each(TIERS)('chromatic impasto shaders at %s', (quality) => {
    /** { name, label, out, heard } per material and backend. */
    const built = [];
    let world = null;

    it('builds every material and pass for WebGPU and for the WebGL2 fallback without a word, under budget', () => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(REST_RIG.fov, 16 / 9, REST_RIG.near, REST_RIG.far);
        world = new ChromaticImpastoWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, 16 / 9);
        world.setLayout(fallbackLayout(1600, 900), 16 / 9);
        world.seek(12);
        world.updateCamera(camera, { time: 12, delta: 0 });
        world.update({ time: 12, delta: 0 }, camera);

        const targets = [];
        scene.traverse((object) => {
            if (!object.material) return;
            targets.push([object.name || object.material.name, object, object.material]);
        });
        const { canvas } = world;
        targets.push(['stamp pigment', canvas.mesh, canvas.pigmentMaterial]);
        targets.push(['stamp relief', canvas.mesh, canvas.reliefMaterial]);
        targets.push(['fill', canvas.fillQuad, canvas.fillMaterial]);
        targets.push(['dry', canvas.dryQuad, canvas.dryMaterial]);
        canvas.bakeQuads.forEach((quad, i) => targets.push([`bake ${i}`, quad, canvas.bakeMaterials[i]]));
        expect(targets.length).toBeGreaterThanOrEqual(7);
        for (const [name, object, material] of targets) {
            BACKENDS.forEach(([label, Builder]) => {
                const [out, heard] = listening(() => build(Builder, object, material));
                built.push({
                    name, label, out, heard,
                });
            });
        }
        expect(built.flatMap(problemsOf)).toEqual([]);
        // The painted surface is really there: a whole fragment stage, with the gilding helper.
        const surface = built.find((b) => b.name === 'Chromatic Impasto — canvas' && b.label === 'WGSL');
        expect(surface).toBeTruthy();
        expect(surface.out.fragment.length).toBeGreaterThan(8_000);
        // (the gilding is laid out as its own function: ci_gildLeaf)
        expect(surface.out.fragment).toMatch(/ci_gildLeaf/);
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

    it('emits each shared ci_ helper once per stage, as a function of its arguments alone', () => {
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
        world?.dispose();
    });

    it.each([
        ['the look', {}],
        ['falseColor', { falseColor: true }],
    ])('builds the post stack output (%s) on both backends without a word', (_, variant) => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();
        const post = new ChromaticImpastoPost(fakeRenderer(), scene, camera, { look: POST_LOOK[quality], ...variant });
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
            });
            expect(problems).toEqual([]);
        } finally {
            post.dispose();
            material.dispose();
        }
    });
});
