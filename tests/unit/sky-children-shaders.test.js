/**
 * Sky Children shader gate — no GPU needed.
 *
 * Every material in the built world (found by walking the scene, so a part added later is gated
 * too), at the tier the theme defaults to and at the leanest, and the post stack's output node
 * (its look per tier, plus the falseColor and values debug views) are built through three's own
 * node builders against a stub renderer: the WGSL one the WebGPU backend uses and the GLSL one of
 * the WebGL2 fallback. A graph one builder cannot turn into a shader throws or warns here instead
 * of leaving a part undrawn on someone's machine. It also fails on MaterialX noise (`mx_*`, banned
 * by the theme), on a smoothstep whose two edges are the same constant (a hard WGSL error), on a
 * laid-out `sc_*` helper that closes over a uniform or a texture (cached module-wide, it would emit
 * invalid WGSL in the second material), and on a sky dome fragment over FINAL §9's 64 KB of WGSL.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, ANGLE), BloomNode's own passes are
 * built lazily by the renderer, and there is no compute. The harness is
 * tests/unit/himalayan-peak-shaders.test.js's.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { SKY_CHILDREN_PARTS, SkyChildrenWorld } from '../../src/themes/sky-children/sky-children-world.js';
import { POST_LOOK, SkyChildrenPost } from '../../src/themes/sky-children/sky-children-post.js';

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** Per stage, as the sibling gates; a JS-unrolled loop shows up as ~100 KB. */
const STAGE_BUDGET = 48 * 1024;
/** FINAL §9: the sky dome's fragment stage (the whole sky function, the Deep and every optic). */
const DOME_BUDGET = 64 * 1024;
const DOME = 'sky-children-sky';
/** The theme's laid-out Fn prefix (`setLayout({ name: 'sc_…' })`). */
const PREFIX = 'sc';

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

/** Every `sc_*` function a WGSL stage defines: name → body. */
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

/** The checks every built stage pair must pass. */
function expectClean({
    name, label, out, heard,
}, budget = () => STAGE_BUDGET) {
    expect(out.thrown, `${name}, ${label}: ${out.thrown?.stack ?? ''}`).toBeUndefined();
    expect(heard, `${name}, ${label}`).toEqual([]);
    for (const stage of ['vertex', 'fragment']) {
        expect(typeof out[stage], `${name}, ${label} ${stage}`).toBe('string');
        expect(out[stage].length, `${name}, ${label} ${stage}`).toBeGreaterThan(200);
        expect(Buffer.byteLength(out[stage]), `${name}, ${label} ${stage}`).toBeLessThan(budget(stage));
        expect(equalEdges(out[stage]), `${name}, ${label} ${stage}`).toEqual([]);
    }
    expect(`${out.vertex}${out.fragment}`, `${name}, ${label}`).not.toMatch(/mx_\w+/);
    if (label === 'WGSL') {
        expect(out.vertex, name).toMatch(/@vertex/);
        expect(out.fragment, name).toMatch(/@fragment/);
    } else {
        expect(out.vertex, name).toMatch(/void main\(\)/);
        expect(out.fragment, name).toMatch(/void main\(\)/);
    }
}

describe.each(TIERS)('sky children shaders at %s', (quality) => {
    let world;
    let scene;
    /** { name, label, out, heard } per material and backend. */
    const built = [];

    beforeAll(() => {
        scene = new THREE.Scene();
        world = new SkyChildrenWorld({ scene, quality, capture: true }).build();
        scene.traverse((object) => {
            if (!object.material) return;
            (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
                BACKENDS.forEach(([label, Builder]) => {
                    const [out, heard] = listening(() => build(Builder, object, material));
                    built.push({
                        name: object.name || object.type, label, out, heard,
                    });
                });
            });
        });
    });
    afterAll(() => world.dispose());

    it('has a material to build for every part, on both backends', () => {
        const meshesOf = (part) => part.meshes || [part.mesh];
        for (const name of SKY_CHILDREN_PARTS) {
            meshesOf(world.parts[name]).forEach((mesh) => {
                const labels = built.filter((b) => b.name === mesh.name).map((b) => b.label);
                expect(labels, `${name}: ${mesh.name}`).toEqual(expect.arrayContaining(['WGSL', 'GLSL']));
            });
        }
        expect(built.length).toBeGreaterThanOrEqual(SKY_CHILDREN_PARTS.length * 2);
    });

    it('builds every material for WebGPU and for the WebGL2 fallback without a word', () => {
        // The dome's fragment has its own gate below.
        const budget = (b) => (stage) => (b.name === DOME && stage === 'fragment' ? Infinity : STAGE_BUDGET);
        built.forEach((b) => expectClean(b, budget(b)));
    });

    it('emits each shared sc_ helper once per stage, as a function of its arguments alone', () => {
        let seen = 0;
        built.filter((b) => b.label === 'WGSL').forEach(({ name, out }) => ['vertex', 'fragment'].forEach((stage) => {
            const found = helpers(out[stage]);
            seen += found.length;
            expect(new Set(found.map((h) => h.name)).size, `${name} ${stage}`).toBe(found.length);
            found.forEach((h) => expect(captures(h.body), `${h.name} in ${name}'s ${stage}`).toBeNull());
        }));
        expect(seen).toBeGreaterThan(0);
    });

    // The dome's fragment: the strokes and the casters are real loops (read by index), so the
    // High tier's 5 cloud slices, 3 shelves, 8 casters and 12 strokes stay under the gate.
    it('keeps the sky dome\'s WGSL fragment under 64 KB (FINAL §9)', () => {
        const dome = built.find((b) => b.name === DOME && b.label === 'WGSL');
        expect(dome, 'the dome was built').toBeTruthy();
        const size = Buffer.byteLength(dome.out.fragment);
        expect(size, `${quality} sky dome WGSL fragment: ${size} B`).toBeGreaterThan(200);
        expect(size, `${quality} sky dome WGSL fragment: ${size} B`).toBeLessThan(DOME_BUDGET);
    });

    it.each([
        ['the look', {}],
        ['falseColor', { falseColor: true }],
        ['values', { values: true }],
    ])('builds the post stack\'s output (%s) on both backends without a word', (_, variant) => {
        const camera = new THREE.PerspectiveCamera();
        const post = new SkyChildrenPost(fakeRenderer(), scene, camera, { look: POST_LOOK[quality], ...variant });
        const material = new THREE.NodeMaterial();
        material.fragmentNode = post.pipeline.outputNode;
        const quad = new THREE.QuadMesh(material);
        try {
            BACKENDS.forEach(([label, Builder]) => {
                const [out, heard] = listening(
                    () => build(Builder, quad, material, postRenderer(), scene, quad.camera),
                );
                expectClean({
                    name: `post ${JSON.stringify(variant)}`, label, out, heard,
                });
                if (label === 'WGSL') {
                    const found = helpers(out.fragment);
                    found.forEach((h) => expect(captures(h.body), `${h.name} in the post`).toBeNull());
                }
            });
        } finally {
            post.dispose();
            material.dispose();
        }
    });
});

// The leanest tiers shed the anticrepuscular fan (two reads at a hand-set mip level, in the dome
// and on the cloud sea) and the cirrus; the default tier keeps them. Measured as a difference
// between the tiers, so whatever else either stage reads does not move it.
describe('sky children shaders: what the leanest tier sheds', () => {
    const levelReads = (quality, name) => {
        const scene = new THREE.Scene();
        const world = new SkyChildrenWorld({ scene, quality, capture: true }).build();
        try {
            let found = null;
            scene.traverse((object) => {
                if (object.name === name && object.material) found = build(THREE.WGSLNodeBuilder, object, object.material).fragment;
            });
            return (found?.match(/textureSampleLevel\(/g) || []).length;
        } finally {
            world.dispose();
        }
    };

    it('drops the ray fan\'s two reads from the cloud sea at Minimal', () => {
        expect(levelReads('High', 'sky-children-sea') - levelReads('Minimal', 'sky-children-sea')).toBe(2);
    });

    it('drops the ray fan (and the Milky Way) from the dome at Minimal, and the dome is leaner for it', () => {
        expect(levelReads('High', DOME)).toBeGreaterThan(levelReads('Minimal', DOME));
    });
});
