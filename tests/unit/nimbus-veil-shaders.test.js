/**
 * Nimbus Veil shader gate — no GPU needed.
 *
 * Every material in the built world (found by walking the scene, so a part added later is gated
 * too: the sky, the cloud sea, the cumulus cards, the veils, motes and sparkles) and the post
 * stack's output are built through three's own node builders against a stub renderer: the WGSL
 * one of the WebGPU backend and the GLSL one of the WebGL2 fallback, at the tier the game defaults
 * to and at the leanest. A graph one builder cannot turn into a shader throws or warns here
 * instead of leaving a part undrawn on someone's machine.
 *
 * Also gated: each stage's size, MaterialX noise (`mx_*`), a smoothstep whose two edges are the
 * same constant (a hard WGSL error), a NaN/Infinity literal, a WGSL var read where it may not have
 * been assigned, and a laid-out `nv_*` helper that closes over a uniform or a texture (cached
 * module-wide, it would emit invalid WGSL in the second material that uses it).
 *
 * And the pass's own invariants: the cloud sea's field repeats exactly at the scroll's wrap, the
 * deck can never rise into the lens, and every tower's billows fill the profile its shadow on the
 * deck is cast from.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, ANGLE), and BloomNode's own passes
 * are built lazily by the renderer. The harness is tests/unit/luminous-tides-shaders.test.js's.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { NimbusWorld } from '../../src/themes/nimbus-veil/nimbus-veil-world.js';
import { NimbusVeilPost, POST_LOOK } from '../../src/themes/nimbus-veil/nimbus-veil-post.js';
import { SEA_FIELD } from '../../src/themes/nimbus-veil/nimbus-veil-cloudsea.js';
import { towerBillows } from '../../src/themes/nimbus-veil/nimbus-veil-cumulus.js';
import {
    RIG, SEA_WRAP, TOWERS, towerHalfWidth,
} from '../../src/themes/nimbus-veil/nimbus-veil-tsl.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** Per stage: far under what an unrolled feature produces (100 KB and up). */
const STAGE_BUDGET = 64 * 1024;
/** The theme's laid-out Fn prefix (`setLayout({ name: 'nv_…' })`). */
const PREFIX = 'nv';

const seeded = (seed = 7) => {
    let s = seed;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
};

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

/** Every `nv_*` function a WGSL stage defines: name → body. */
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
        if (/object Object/.test(code)) problems.push(`${name}, ${label} ${stage}: a node stringified into the code`);
    }
    if (/mx_\w+/.test(`${out.vertex}${out.fragment}`)) problems.push(`${name}, ${label}: MaterialX noise`);
    const entry = label === 'WGSL' ? [/@vertex/, /@fragment/] : [/void main\(\)/, /void main\(\)/];
    if (!entry[0].test(out.vertex)) problems.push(`${name}, ${label}: the vertex stage has no entry point`);
    if (!entry[1].test(out.fragment)) problems.push(`${name}, ${label}: the fragment stage has no entry point`);
    return problems;
}

describe.each(TIERS)('nimbus veil shaders at %s', (quality) => {
    let world;
    let scene;
    /** { name, object, label, out, heard } per material and backend. */
    const built = [];

    beforeAll(() => {
        scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(56, 16 / 9, RIG.near, RIG.far);
        world = new NimbusWorld({ scene, quality, random: seeded() }).build();
        world.setLayout(16 / 9, null, { immediate: true });
        world.updateCamera(camera, { time: 5, delta: 0 });
        world.update({ time: 5, delta: 0 });
        // A frame mid-game: a wave rolling in, the sun pulsing, glints in the air.
        world.onLineClear(3);
        world.onCombo(4);
        world.update({ time: 6, delta: 1 / 30 });

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

    it('has a node material to build for the sky, the sea and the towers', () => {
        for (const name of ['sky', 'sea', 'cumulus']) {
            const mesh = world.parts[name];
            expect(mesh, name).toBeTruthy();
            expect(mesh.material.isNodeMaterial, name).toBe(true);
            const labels = built.filter((b) => b.object === mesh).map((b) => b.label);
            expect(labels, name).toEqual(expect.arrayContaining(['WGSL', 'GLSL']));
        }
    });

    it('builds every material for WebGPU and for the WebGL2 fallback without a word, under budget', () => {
        expect(built.flatMap(problemsOf)).toEqual([]);
        // The sea is the scene's anchor and is really there: its domes, shadows and haze.
        const sea = built.find((b) => b.object === world.parts.sea && b.label === 'WGSL');
        expect(sea.out.fragment.length).toBeGreaterThan(8_000);
        expect(sea.out.fragment).toMatch(/\bnv_domes\b/);
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

    it('emits each shared nv_ helper once per stage, as a function of its arguments alone', () => {
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

    it('builds the post stack\'s output on both backends without a word', () => {
        const camera = new THREE.PerspectiveCamera();
        const look = POST_LOOK[quality];
        const post = new NimbusVeilPost(fakeRenderer(), scene, camera, { look, samples: 0 });
        expect(Boolean(post.bloomNode)).toBe(look.bloom === true);
        const material = new THREE.NodeMaterial();
        material.fragmentNode = post.postProcessing.outputNode;
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

describe('nimbus veil cloud sea and towers', () => {
    it('repeats the sea\'s field exactly at the scroll\'s wrap, so the wrap never pops', () => {
        for (const key of ['swellCell', 'maskCell', 'heapCell', 'headCell', 'cauliCell', 'fineCell']) {
            const cells = SEA_WRAP / SEA_FIELD[key];
            expect(Number.isInteger(cells), `${key}: ${cells} cells per wrap`).toBe(true);
        }
    });

    it('keeps the tallest possible deck well under the lens', () => {
        // Heaps and heads at full height under the fullest mask, on a swell crest, with the
        // cauliflower on top: the deck's ceiling, whatever the field does.
        const maskMax = 1.25;
        const ceiling = (SEA_FIELD.heapH + SEA_FIELD.headH) * maskMax + SEA_FIELD.swellH / 2
            + SEA_FIELD.cauliH - SEA_FIELD.offset;
        expect(ceiling).toBeLessThan(RIG.height - 4);
    });

    it('fills every tower\'s shadow profile with its billows', () => {
        const rand = seeded(11);
        for (const tower of TOWERS) {
            const billows = towerBillows(tower, 44, rand);
            for (let yn = 0.12; yn <= 0.9; yn += 0.06) {
                const y = yn * tower.h;
                let left = Infinity;
                let right = -Infinity;
                for (const [x, by, r] of billows) {
                    const dy = y - by;
                    if (Math.abs(dy) >= r) continue;
                    const half = Math.sqrt(r * r - dy * dy);
                    left = Math.min(left, x - half);
                    right = Math.max(right, x + half);
                }
                const width = right - left;
                const shadow = 2 * towerHalfWidth(tower.h, yn);
                // The heap is about as wide as the shadow it casts (the shadow's edges are soft).
                expect(width, `tower ${tower.az}° at ${yn.toFixed(2)}`).toBeGreaterThan(shadow * 0.6);
                expect(width, `tower ${tower.az}° at ${yn.toFixed(2)}`).toBeLessThan(shadow * 1.6);
            }
        }
    });

    it('stands every tower card upright and facing the rest camera', () => {
        const scene = new THREE.Scene();
        const world = new NimbusWorld({ scene, quality: 'High', random: seeded() }).build();
        const { geometry } = world.parts.cumulus;
        const pos = geometry.getAttribute('position');
        const eye = new THREE.Vector3(RIG.x, 0, RIG.z);
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        for (let quad = 0; quad < pos.count / 4; quad += 1) {
            a.fromBufferAttribute(pos, quad * 4);
            b.fromBufferAttribute(pos, quad * 4 + 1);
            c.fromBufferAttribute(pos, quad * 4 + 3);
            const across = b.clone().sub(a);
            const up = c.clone().sub(a);
            expect(Math.abs(across.y)).toBeLessThan(1e-6);
            expect(up.x ** 2 + up.z ** 2).toBeLessThan(1e-6);
            across.y = 0;
            across.normalize();
            // The card stands on its tower's axis…
            const tower = TOWERS.find((t) => {
                const off = new THREE.Vector3(t.x - a.x, 0, t.z - a.z);
                return off.sub(across.clone().multiplyScalar(off.dot(across))).length() < 1e-2;
            });
            expect(tower, `card ${quad}`).toBeTruthy();
            // …square to the line from the eye to that axis.
            const toEye = eye.clone().sub(new THREE.Vector3(tower.x, 0, tower.z)).normalize();
            expect(Math.abs(across.dot(toEye))).toBeLessThan(1e-4);
        }
        world.dispose();
    });
});
