/**
 * Grainfields shader gate — no GPU needed.
 *
 * Every material in the built world (found by walking the scene, so a part added later is gated
 * too), the post stack's output (its look per tier, and the falseColor debug view) and its march
 * of the light in the air are built through three's own node builders against a stub
 * renderer: the WGSL one of the WebGPU backend and the GLSL one of the WebGL2 fallback, at the tier
 * the theme defaults to and at the leanest. A graph one builder cannot turn into a shader throws
 * or warns here instead of leaving a part undrawn on someone's machine.
 *
 * Also gated: each stage's size (a feature unrolled in JS instead of looped shows up as a module of
 * 100 KB), MaterialX noise (`mx_*`), a smoothstep whose two edges are the same constant (a hard
 * WGSL error), a NaN/Infinity literal, a WGSL var read where it may not have been assigned, and a
 * laid-out `gf_*` helper that closes over a uniform or a texture (cached module-wide, it would emit
 * invalid WGSL in the second material that uses it).
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, ANGLE), BloomNode's own passes are
 * built lazily by the renderer, and there is no compute. The harness is
 * tests/unit/rainbow-terraces-shaders.test.js's.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadGrainfieldsAssets } from '../../src/themes/grainfields/grainfields-assets.js';
import { GRAINFIELDS_PARTS, GrainfieldsWorld } from '../../src/themes/grainfields/grainfields-world.js';
import { GrainfieldsPost, POST_LOOK } from '../../src/themes/grainfields/grainfields-post.js';
import { PIECE_COLORS } from '../../src/themes/grainfields/grainfields-core.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** Per stage, as the sibling gates (High Coast, Himalayan Peak, Rainbow Terraces). */
const STAGE_BUDGET = 48 * 1024;
/** The theme's laid-out Fn prefix (`setLayout({ name: 'hc_…' })`). */
const PREFIX = 'gf';

/** The trees' authored assets, served from disk (and a tiny sprite sheet in place of the PNG). */
async function diskAssets() {
    const directory = new URL('../../src/themes/grainfields/assets/', import.meta.url);
    const loader = {
        loadAsync: async (url) => {
            const name = decodeURIComponent(new URL(url).pathname.split('/').pop());
            const bytes = readFileSync(new URL(name, directory));
            return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
        },
    };
    const textureLoader = { loadAsync: async () => new THREE.DataTexture(new Uint8Array(16), 2, 2) };
    return loadGrainfieldsAssets({ loader, textureLoader });
}

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

/** Every `gf_*` function a WGSL stage defines: name → body. */
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

describe.each(TIERS)('grainfields shaders at %s', (quality) => {
    let world;
    let scene;
    /** { name, object, label, out, heard } per material and backend. */
    const built = [];

    beforeAll(async () => {
        scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(44, 16 / 9, 0.5, 90000);
        world = new GrainfieldsWorld({
            scene, quality, capture: true, prepared: GrainfieldsWorld.prepareSync(quality, await diskAssets()),
        }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, 16 / 9);
        world.updateCamera(camera, { time: 5, delta: 0 });
        world.update({ time: 5, delta: 0 }, camera);
        // Something in every table, as a frame mid-game has.
        world.onLock({ u: 0.3, rows: [9, 8], color: PIECE_COLORS[0] });
        world.onLock({
            u: 0.7, rows: [9], color: PIECE_COLORS[6], hardDrop: true,
        });
        world.onClear({ lines: 4, tspin: true, combo: 3 });
        world.update({ time: 6, delta: 1 / 30 }, camera);

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

    afterAll(() => world?.dispose());

    it('has a material to build for every part and every mesh of it', () => {
        for (const name of GRAINFIELDS_PARTS) {
            const part = world.parts[name];
            const meshes = part.meshes || [part.mesh];
            expect(meshes.length, name).toBeGreaterThan(0);
            meshes.forEach((root) => root.traverse((object) => {
                if (!object.material) return;
                const labels = built.filter((b) => b.object === object).map((b) => b.label);
                const label = `${name}: ${object.name || object.material.name}`;
                expect(labels, label).toEqual(expect.arrayContaining(['WGSL', 'GLSL']));
                expect(object.material.isNodeMaterial, `${name}: ${object.name}`).toBe(true);
            }));
        }
        expect(built.length).toBeGreaterThanOrEqual(GRAINFIELDS_PARTS.length * 2);
    });

    it('builds every material for WebGPU and for the WebGL2 fallback without a word, under budget', () => {
        expect(built.flatMap(problemsOf)).toEqual([]);
        // The land is the scene's anchor and is really there.
        const land = built.find((b) => b.object === world.parts.land.mesh && b.label === 'WGSL');
        expect(land.out.fragment.length).toBeGreaterThan(10_000);
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

    it('emits each shared gf_ helper once per stage, as a function of its arguments alone', () => {
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
        const post = new GrainfieldsPost(fakeRenderer(), scene, camera, {
            look: POST_LOOK[quality], u: world.u, t: world.textures, ...variant,
        });
        expect(Boolean(post.bloomNode)).toBe(POST_LOOK[quality].bloom === true);
        const material = new THREE.NodeMaterial();
        material.fragmentNode = post.pipeline.outputNode;
        const quad = new THREE.QuadMesh(material);
        // The march of the light in the air renders into a target of its own: build its graph too.
        const airMaterial = new THREE.NodeMaterial();
        if (post.airNode) airMaterial.fragmentNode = post.airNode.node;
        const airQuad = new THREE.QuadMesh(airMaterial);
        expect(Boolean(post.airNode)).toBe(POST_LOOK[quality].air > 0);
        try {
            const problems = [];
            const stages = post.airNode
                ? [['output', quad, material], ['air', airQuad, airMaterial]]
                : [['output', quad, material]];
            stages.forEach(([which, q, m]) => BACKENDS.forEach(([label, Builder]) => {
                const [out, heard] = listening(
                    () => build(Builder, q, m, postRenderer(), scene, q.camera),
                );
                problems.push(...problemsOf({
                    name: `post ${which} ${JSON.stringify(variant)}`, label, out, heard,
                }));
                if (label === 'WGSL' && !out.thrown) {
                    helpers(out.fragment).forEach((h) => {
                        const captured = captures(h.body);
                        if (captured) problems.push(`${h.name} in the post reads ${captured.join(', ')}`);
                    });
                }
            }));
            expect(problems).toEqual([]);
        } finally {
            post.dispose();
            material.dispose();
            airMaterial.dispose();
        }
        expect(post.pipeline).toBeNull();
    });
});
