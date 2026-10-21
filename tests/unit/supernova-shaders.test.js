/**
 * Supernova shader gate — no GPU needed.
 *
 * Every material of a High and a Minimal world (the sky, the nebula, the pulsar's beams, the star,
 * the ring, the prominences, the embers, the streams and the sparks) is built through three's own
 * node builders for BOTH backends: the WGSL one of WebGPU and the GLSL one of the WebGL2 fallback,
 * by a real WebGPURenderer whose device is a stub (the set-up of tests/unit/pyrestorm-shaders.test.js).
 * A graph one builder cannot turn into a shader throws (or warns) here instead of leaving a part
 * undrawn on someone's machine.
 *
 * Also checked: each stage stays under budget, no smoothstep has two equal constant edges (an
 * error in WGSL), no MaterialX noise and no NaN/Infinity literal reached a shader, every laid-out
 * helper is emitted once and closes over nothing, and no WGSL var is read where it may not have
 * been assigned. The post's output pass is constructed once per backend and look.
 *
 * What it cannot see: the shaders are not compiled (Tint, the driver), so one the browser rejects
 * can still pass.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, SUPERNOVA_PARTS, SupernovaWorld, fovForAspect,
} from '../../src/themes/supernova/supernova-world.js';
import { POST_LOOK, SupernovaPost } from '../../src/themes/supernova/supernova-post.js';
import { fallbackLayout } from '../../src/themes/supernova/supernova-composition.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', false], ['GLSL', true]];
/** The largest stage today is the star's fragment (about 30 KB of WGSL). */
const STAGE_BUDGET = 64 * 1024;

const canvas = {
    style: {},
    width: 1600,
    height: 900,
    addEventListener() {},
    removeEventListener() {},
    getContext() { return null; },
    setAttribute() {},
};

/** A node renderer that can build graphs but has no device: nothing is ever submitted. */
function stubRenderer(forceWebGL) {
    const renderer = new THREE.WebGPURenderer({ canvas, forceWebGL });
    renderer.hasFeature = () => false;
    renderer._initialized = true;
    if (forceWebGL) renderer.backend.capabilities = { getUniformBufferLimit: () => 16384, getMaxAnisotropy: () => 1 };
    else renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
    return renderer;
}

/** smoothstep() calls whose two edges are the same constant: a hard error in WGSL. */
function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

/** Every `sn_*` function a WGSL stage defines: name → body. */
function helpers(wgsl) {
    return [...wgsl.matchAll(/^fn (sn_\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)^\}/gm)]
        .map((m) => ({ name: m[1], body: m[2] }));
}

/** What a helper's body names that is neither an argument nor a local: uniforms, arrays, textures. */
const captures = (body) => body.match(/nodeUniform\d+|NodeBuffer_\w+|\bobject\.\w+|\brender\.\w+|texture\w*\(/g);

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

const renderers = {};

beforeAll(() => {
    BACKENDS.forEach(([label, forceWebGL]) => { renderers[label] = stubRenderer(forceWebGL); });
});

describe.each(TIERS)('Supernova shaders at %s', (quality) => {
    let world;
    let scene;
    let camera;
    /** part → backend → { vertex, fragment } | { thrown } */
    const built = {};
    /** What three said while building, per part and backend. */
    const said = {};

    beforeAll(() => {
        scene = new THREE.Scene();
        const aspect = 16 / 9;
        camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
        world = new SupernovaWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, aspect);
        world.setLayout(fallbackLayout(1600, 900), aspect);
        world.seek(20);
        world.updateCamera(camera, { time: 20, delta: 0 });
        world.update({ time: 20, delta: 0 }, camera);
        // Something in every table, as a frame mid-game has: streams, impacts, fronts, a chain,
        // a detonation's fireball and the pulsar.
        world.onLock({ u: 0.3 });
        world.onLock({ u: 0.7, hardDrop: true });
        world.onClear({ lines: 3 });
        for (let n = 1; n <= 4; n++) world.onCombo(n);
        world.onClear({ lines: 4 });
        for (let i = 1; i <= 90; i++) {
            const sim = { time: 20 + i / 30, delta: 1 / 30 };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
        }

        const warn = vi.spyOn(console, 'warn');
        const error = vi.spyOn(console, 'error');
        for (const [name, part] of Object.entries(world.parts)) {
            const { mesh } = part;
            built[name] = {};
            said[name] = {};
            for (const [label] of BACKENDS) {
                const heard = [];
                const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 400));
                warn.mockImplementation(listen);
                error.mockImplementation(listen);
                try {
                    const renderer = renderers[label];
                    const builder = renderer.backend.createNodeBuilder(mesh, renderer);
                    builder.scene = scene;
                    builder.material = mesh.material;
                    builder.camera = camera;
                    builder.context.material = mesh.material;
                    builder.lightsNode = renderer.lighting.getNode(scene);
                    builder.fogNode = null;
                    builder.clippingContext = null;
                    builder.build();
                    built[name][label] = { vertex: builder.vertexShader, fragment: builder.fragmentShader };
                } catch (thrown) {
                    built[name][label] = { thrown };
                }
                said[name][label] = heard;
            }
        }
        warn.mockRestore();
        error.mockRestore();
    });

    afterAll(() => {
        world?.dispose();
    });

    it('has a node material for every part', () => {
        expect(Object.keys(built).sort()).toEqual([...SUPERNOVA_PARTS].sort());
        Object.values(world.parts).forEach((part) => {
            expect(part.mesh.material.isNodeMaterial, part.mesh.name).toBe(true);
        });
        // The tables were busy when the graphs were built (a chain, fronts, the fireball).
        expect(world.u.shellCount.value).toBeGreaterThan(world.tier.shells);
    });

    it('builds every material for WebGPU and for the WebGL2 fallback without a word', () => {
        const problems = [];
        for (const [name, byBackend] of Object.entries(built)) {
            for (const [label] of BACKENDS) {
                const out = byBackend[label];
                if (out.thrown) {
                    problems.push(`${name}, ${label}: ${out.thrown?.stack?.split('\n').slice(0, 4).join(' | ')}`);
                    continue;
                }
                if (said[name][label].length) problems.push(`${name}, ${label} said: ${said[name][label][0]}`);
                for (const stage of ['vertex', 'fragment']) {
                    if (typeof out[stage] !== 'string' || out[stage].length < 200) {
                        problems.push(`${name}, ${label}: no ${stage} stage`);
                    }
                }
            }
            if (!byBackend.WGSL.thrown) {
                expect(byBackend.WGSL.vertex, name).toMatch(/@vertex/);
                expect(byBackend.WGSL.fragment, name).toMatch(/@fragment/);
            }
            if (!byBackend.GLSL.thrown) {
                expect(byBackend.GLSL.vertex, name).toMatch(/void main\(\)/);
                expect(byBackend.GLSL.fragment, name).toMatch(/void main\(\)/);
            }
        }
        expect(problems).toEqual([]);
    });

    it(`keeps every stage under ${STAGE_BUDGET / 1024} KiB, no equal-edge smoothstep, no MaterialX, no NaN`, () => {
        for (const [name, byBackend] of Object.entries(built)) {
            for (const [label] of BACKENDS) {
                const { vertex = '', fragment = '' } = byBackend[label];
                for (const [stage, code] of [['vertex', vertex], ['fragment', fragment]]) {
                    expect(Buffer.byteLength(code), `${name}, ${label} ${stage}`).toBeLessThan(STAGE_BUDGET);
                    expect(equalEdges(code), `${name}, ${label} ${stage}`).toEqual([]);
                }
                expect(`${vertex}\n${fragment}`, `${name}, ${label}`).not.toMatch(/mx_\w+/);
                expect(`${vertex}\n${fragment}`, `${name}, ${label}`).not.toMatch(/\bNaN\b|\bInfinity\b/);
                expect(`${vertex}\n${fragment}`, `${name}, ${label}`).not.toMatch(/object Object/);
            }
        }
        // The nebula and the star are the heaviest fragments, and are really there.
        expect(built.nebula.WGSL.fragment.length).toBeGreaterThan(4_000);
        expect(built.star.WGSL.fragment.length).toBeGreaterThan(4_000);
        // The check sees the trap.
        expect(equalEdges('x = smoothstep(0.5, 0.5, y);')).toHaveLength(1);
        expect(equalEdges('x = smoothstep(0.25, 0.5, y);')).toEqual([]);
    });

    it('emits each shared helper once per stage, as a function of its arguments alone', () => {
        Object.keys(built).forEach((part) => {
            for (const stage of ['vertex', 'fragment']) {
                const found = helpers(built[part].WGSL[stage] ?? '');
                expect(new Set(found.map((helper) => helper.name)).size, `${part} ${stage}`).toBe(found.length);
                found.forEach((helper) => {
                    // A laid-out function is written once and reused by later materials: a uniform, a
                    // uniform array or a texture it closed over is declared only in the first shader.
                    expect(captures(helper.body), `${helper.name} in the ${part}'s ${stage} stage`).toBeNull();
                });
            }
        });
    });

    it('reads no WGSL var where it may not have been assigned', () => {
        for (const [name, byBackend] of Object.entries(built)) {
            for (const stage of ['vertex', 'fragment']) {
                expect(unassignedReads(byBackend.WGSL[stage] ?? ''), `${name} ${stage}`).toEqual([]);
            }
        }
        // The check sees the trap: a var assigned in one branch and read after it.
        expect(unassignedReads([
            'fn main() {', 'if ( c ) {', 'nodeVar1 = 1.0;', '} else {', 'nodeVar2 = 0.0;', '}',
            'nodeVar3 = nodeVar1;', '}',
        ].join('\n'))).toHaveLength(1);
    });
});

describe('Supernova post stack', () => {
    it.each(BACKENDS)('constructs its output pass on the %s backend, for every look', (label) => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(44, 16 / 9, 0.1, 1000);
        for (const [tier, look] of Object.entries(POST_LOOK)) {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const post = new SupernovaPost(renderers[label], scene, camera, { look, falseColor: tier === 'Low' });
            expect(post.pipeline.outputNode, tier).toBeTruthy();
            expect(post.pipeline.outputColorTransform, tier).toBe(false); // tone mapped once, in the output node
            expect(Boolean(post.bloomNode), tier).toBe(look.bloom === true);
            post.update({
                heart: { x: 0.2, y: 0.47 },
                flash: 0.2,
                kick: 0.3,
                bloomBoost: 0.3,
                exposure: 1.1,
                rays: 0.5,
                streak: 0.4,
                ripple: { radius: 0.3, strength: 0.5 },
                fall: 0.2,
                time: 3,
            });
            post.setCalmRects([{
                x0: 0.4, y0: 0.1, x1: 0.6, y1: 0.9,
            }], 0.5);
            post.setSize(1600, 900, 1600, 900);
            expect(post.uCalmStrength.value).toBe(0.5);
            expect(post.calmRects[0].toArray()).toEqual([0.4, 0.1, 0.6, 0.9]);
            expect(warn, tier).not.toHaveBeenCalled();
            warn.mockRestore();
            post.dispose();
            expect(post.pipeline).toBeNull();
        }
    });
});
