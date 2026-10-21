/**
 * Shifting Sands shader gate — no GPU needed.
 *
 * Every material in the built world (found by walking the scene, so a part added later is gated
 * too: the erg, the sky dome, the formations, the worm, its sand, the motes, the spindrift and the
 * dust geysers) and the post stack's output are built through three's own node builders against a
 * stub renderer: the WGSL one of the WebGPU backend and the GLSL one of the WebGL2 fallback, at the
 * tier the game defaults to and at the leanest. A graph one builder cannot turn into a shader
 * throws or warns here instead of leaving a part undrawn on someone's machine.
 *
 * Also gated: each stage's size, MaterialX noise (`mx_*`), a smoothstep whose two edges are the
 * same constant (a hard WGSL error), a NaN/Infinity literal, a node stringified into the code, and
 * a WGSL var read where it may not have been assigned. And three promises of the dusk pass: the
 * ember sun's disc carries its own colour, the crest's turn is not filtered by fwidth (constant per
 * triangle, it beaded far crests), and the worm's maw cap flips its inside test.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, ANGLE), and BloomNode's own passes
 * are built lazily by the renderer. The harness is tests/unit/sunset-shaders.test.js's.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { ShiftingSandsWorld } from '../../src/themes/shifting-sands/shifting-sands-world.js';
import { POST_LOOK, ShiftingSandsPost } from '../../src/themes/shifting-sands/shifting-sands-post.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** Per stage: the erg's fragment (ridges, wells, ripples, glitter, rings, the atmosphere) is the
 * largest; still far under what an unrolled feature produces. */
const STAGE_BUDGET = 96 * 1024;

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
    }
    if (/mx_\w+/.test(`${out.vertex}${out.fragment}`)) problems.push(`${name}, ${label}: MaterialX noise`);
    const entry = label === 'WGSL' ? [/@vertex/, /@fragment/] : [/void main\(\)/, /void main\(\)/];
    if (!entry[0].test(out.vertex)) problems.push(`${name}, ${label}: the vertex stage has no entry point`);
    if (!entry[1].test(out.fragment)) problems.push(`${name}, ${label}: the fragment stage has no entry point`);
    return problems;
}

describe.each(TIERS)('shifting sands shaders at %s', (quality) => {
    let world;
    let scene;
    /** { name, object, label, out, heard } per material and backend. */
    const built = [];
    const parts = () => ({
        terrain: world.terrain.mesh,
        sky: world.sky.mesh,
        rocks: world.rocks.mesh,
        worm: world.worm.mesh,
        wormSand: world.wormSand.mesh,
        motes: world.motes.mesh,
        spindrift: world.spindrift.mesh,
        blows: world.blows.mesh,
    });

    beforeAll(() => {
        scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, 16 / 9, 2, 26000);
        world = new ShiftingSandsWorld({ scene, quality, capture: true }).build();
        world.setViewport(900, camera);
        // A frame mid-breach, after a Tetris called the second worm and a clear threw geysers.
        const t0 = world.director.idleBreach(0).t0 + 3;
        world.seek(t0);
        const sim = (time) => ({
            time, delta: 1 / 30, pointerX: 0, pointerY: 0,
        });
        world.updateCamera(camera, sim(t0));
        world.update(sim(t0), camera);
        world.onPieceLock();
        world.onLineClear(4);
        world.onLineClear(2);
        world.onCombo(4);
        world.updateCamera(camera, sim(t0 + 1));
        world.update(sim(t0 + 1), camera);

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

    const wgslOf = (mesh) => built.find((b) => b.object === mesh && b.label === 'WGSL').out;

    it('has a node material to build for every part', () => {
        Object.entries(parts()).forEach(([name, mesh]) => {
            expect(mesh.material.isNodeMaterial, name).toBe(true);
            const labels = built.filter((b) => b.object === mesh).map((b) => b.label);
            expect(labels, name).toEqual(expect.arrayContaining(['WGSL', 'GLSL']));
        });
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

    it("paints the ember sun's disc in its own colour, not the sand's light", () => {
        // SUN_A_LIMB's green (0.4): the shared sun light is far too pale for the disc.
        expect(wgslOf(world.sky.mesh).fragment).toMatch(/vec3<f32>\(\s*1\.0,\s*0\.4,\s*0\.09\s*\)/);
    });

    it("turns the crest's normal by a smooth footprint, not by fwidth of the phase", () => {
        // The erg reads fwidth only for the ripples' and the glitter's own fade, where the tier has
        // them; a crest filtered by fwidth (constant per triangle) beaded the far brinks into dashes.
        const { fragment } = wgslOf(world.terrain.mesh);
        const fwidths = (fragment.match(/\bfwidth\(/g) || []).length;
        expect(fwidths).toBeLessThanOrEqual(quality === 'Minimal' ? 0 : 2);
    });

    it("decides the maw cap's inside from its own winding", () => {
        // The cap's front faces are its inside: the facing test picks between the cap flag and its
        // complement (both read from a varying), not between two constants. WGSL writes the
        // select as an if/else on the facing builtin.
        const { fragment } = wgslOf(world.worm.mesh);
        const facing = fragment.match(
            /if \( isFront \) \{\s*\n\s*\w+ = ([^;]*);[\s\S]*?\} else \{\s*\n\s*\w+ = ([^;]*);/,
        );
        expect(facing, 'a choice on the facing builtin').not.toBeNull();
        expect(facing[1]).toMatch(/nodeVarying\d+/);
        expect(facing[2]).toMatch(/nodeVarying\d+/);
    });

    it("builds the post stack's output on both backends without a word", () => {
        const camera = new THREE.PerspectiveCamera();
        const look = { ...POST_LOOK[quality], msaa: 0 };
        const post = new ShiftingSandsPost(fakeRenderer(), scene, camera, { look, shared: world.shared, samples: 0 });
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
