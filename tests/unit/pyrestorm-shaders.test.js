/**
 * Pyrestorm shader gate — no GPU needed.
 *
 * Every material of a High and a Minimal world (the land's two meshes, the sky, the anvil, the ash,
 * the bolts, the jets, the bombs and the motes) is built through three's own node builders for
 * BOTH backends: the WGSL one of WebGPU and the GLSL one of the WebGL2 fallback, by a real
 * WebGPURenderer whose device is a stub (the set-up of .cache/pyre/wgsl-check.mjs). A graph one
 * builder cannot turn into a shader throws (or warns) here instead of leaving a part undrawn on
 * someone's machine.
 *
 * Also checked: each stage stays under budget (a feature unrolled in JavaScript instead of looped
 * shows up as a module of 100 KB), no smoothstep has two equal constant edges (an error in WGSL),
 * no MaterialX noise and no NaN/Infinity literal reached a shader, every laid-out helper is
 * emitted once and closes over nothing, and no WGSL var is read where it may not have been
 * assigned. The post's output pass is constructed once per backend and look.
 *
 * What it cannot see: the shaders are not compiled (Tint, the driver), so one the browser rejects
 * can still pass.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { PYRESTORM_PARTS, PyrestormWorld } from '../../src/themes/pyrestorm/pyrestorm-world.js';
import { PIECE_COLORS } from '../../src/themes/pyrestorm/pyrestorm-core.js';
import { POST_LOOK, PyrestormPost } from '../../src/themes/pyrestorm/pyrestorm-post.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', false], ['GLSL', true]];
/** The largest stage today is the bolts' vertex (about 16 KB of WGSL). */
const STAGE_BUDGET = 48 * 1024;

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

/** Every `py_*` function a WGSL stage defines: name → body. */
function helpers(wgsl) {
    return [...wgsl.matchAll(/^fn (py_\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)^\}/gm)]
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

describe.each(TIERS)('Pyrestorm shaders at %s', (quality) => {
    let world;
    let scene;
    let camera;
    /** target → backend → { vertex, fragment } | { thrown } */
    const built = {};
    /** What three said while building, per target and backend. */
    const said = {};

    beforeAll(() => {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(44, 16 / 9, 4, 90000);
        world = new PyrestormWorld({
            scene, quality, capture: true, prepared: PyrestormWorld.prepareSync(quality),
        }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, 16 / 9);
        world.updateCamera(camera, { time: 5, delta: 0 });
        world.update({ time: 5, delta: 0 }, camera);
        // Something in every table, as a frame mid-game has.
        world.onLock({ u: 0.3, rows: [9, 8], color: PIECE_COLORS[0] });
        world.onLock({
            u: 0.7, rows: [9], color: PIECE_COLORS[6], hardDrop: true, distance: 12,
        });
        world.onClear({
            lines: 4, rows: [19, 18, 17, 16], tspin: true, combo: 3,
        });
        for (let n = 1; n <= 5; n++) world.onCombo(n);
        world.onB2B(2);
        world.update({ time: 6, delta: 1 / 30 }, camera);

        const targets = [];
        for (const [name, part] of Object.entries(world.parts)) {
            (part.meshes || [part.mesh]).forEach((mesh, i) => mesh && targets.push([i ? `${name}#${i}` : name, mesh]));
        }

        const warn = vi.spyOn(console, 'warn');
        const error = vi.spyOn(console, 'error');
        for (const [name, mesh] of targets) {
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

    it('has a node material for every part, the land\'s cone and plain both', () => {
        const names = Object.keys(built);
        for (const part of PYRESTORM_PARTS) expect(names, part).toContain(part);
        expect(names).toContain('land#1');
        Object.values(world.parts).forEach((part) => {
            (part.meshes || [part.mesh]).forEach((mesh) => expect(mesh.material.isNodeMaterial, mesh.name).toBe(true));
        });
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
            }
        }
        // The land is the heaviest fragment and is really there.
        expect(built.land.WGSL.fragment.length).toBeGreaterThan(5_000);
        // The check sees the trap.
        expect(equalEdges('x = smoothstep(0.5, 0.5, y);')).toHaveLength(1);
        expect(equalEdges('x = smoothstep(0.25, 0.5, y);')).toEqual([]);
    });

    it('emits each shared helper once per stage, as a function of its arguments alone', () => {
        const names = new Set();
        Object.keys(built).forEach((part) => {
            for (const stage of ['vertex', 'fragment']) {
                const found = helpers(built[part].WGSL[stage] ?? '');
                expect(new Set(found.map((helper) => helper.name)).size, `${part} ${stage}`).toBe(found.length);
                found.forEach((helper) => {
                    names.add(helper.name);
                    // A laid-out function is written once and reused by later materials: a uniform, a
                    // uniform array or a texture it closed over is declared only in the first shader.
                    expect(captures(helper.body), `${helper.name} in the ${part}'s ${stage} stage`).toBeNull();
                });
            }
        });
        // The incandescence ramp and the hash are among them wherever fire is drawn.
        expect([...names]).toEqual(expect.arrayContaining(['py_hash21', 'py_blackbody']));
        expect(helpers(built.bombs.WGSL.fragment).map((helper) => helper.name)).toContain('py_blackbody');
        expect(built.bombs.GLSL.fragment).toMatch(/py_blackbody\s*\(/);
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

describe('Pyrestorm post stack', () => {
    it.each(BACKENDS)('constructs its output pass on the %s backend, for every look', (label) => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(44, 16 / 9, 4, 90000);
        for (const [tier, look] of Object.entries(POST_LOOK)) {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const post = new PyrestormPost(renderers[label], scene, camera, { look, falseColor: tier === 'Low' });
            expect(post.pipeline.outputNode, tier).toBeTruthy();
            expect(post.pipeline.outputColorTransform, tier).toBe(false); // tone mapped once, in the output node
            expect(Boolean(post.bloomNode), tier).toBe(look.bloom === true);
            post.update({
                exposure: 1.2,
                bloomBoost: 0.3,
                flash: 0.2,
                flashColour: [1, 0.6, 0.3],
                heat: 0.8,
                saturation: 1.1,
                time: 3,
            });
            post.setCalmRects([{
                x0: 0.4, y0: 0.1, x1: 0.6, y1: 0.9,
            }], 0.5);
            post.setSize(1600, 900, 1600, 900);
            expect(post.uFlash.value).toBe(0.2);
            expect(post.uCalmStrength.value).toBe(0.5);
            expect(post.calmRects[0].toArray()).toEqual([0.4, 0.1, 0.6, 0.9]);
            expect(post.calmRects[1].toArray()).toEqual([0, 0, 0, 0]);
            // The bloom's knee follows the exposure: a brighter iris lowers the threshold.
            if (post.bloomNode) expect(post.bloomNode.threshold.value).toBeLessThan(1);
            expect(warn, tier).not.toHaveBeenCalled();
            warn.mockRestore();
            post.dispose();
            expect(post.pipeline).toBeNull();
        }
    });
});
