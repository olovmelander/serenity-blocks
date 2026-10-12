/**
 * Painted Ages shader gate — no GPU needed.
 *
 * Every material of a High and a Low world (the land, the props and their halos, the poplars, the
 * sky, the cumulus banks, the motes, and the three shadow passes' quads) is built through three's
 * own node builders for BOTH backends: the WGSL one of WebGPU and the GLSL one of the WebGL2
 * fallback, by a real WebGPURenderer whose device is a stub. A graph one builder cannot turn into
 * a shader throws (or warns) here instead of leaving a part undrawn on someone's machine.
 *
 * Also checked: no NaN/Infinity literal reached a shader, every fragment stage stays under budget,
 * and no WGSL var is read where it may not have been assigned (a node first built inside one branch
 * is zero everywhere else). The post's output pass is constructed once per backend.
 *
 * What it cannot see: the shaders are not compiled (Tint, the driver), so one the browser rejects
 * can still pass. The reference script is .cache/painted/wgsl-check.mjs.
 */
import { readFileSync } from 'node:fs';
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { PAINTED_AGES_PARTS, PaintedAgesWorld } from '../../src/themes/painted-ages/painted-ages-world.js';
import { FIELDS, FIELD_ORDER, PIECE_COLORS } from '../../src/themes/painted-ages/painted-ages-core.js';
import { decodeField } from '../../src/themes/painted-ages/painted-ages-field.js';
import { POST_LOOK, PaintedAgesPost } from '../../src/themes/painted-ages/painted-ages-post.js';
import { decodePng } from '../../scripts/painted-ages/png.mjs';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Low'];
const BACKENDS = [['WGSL', false], ['GLSL', true]];
/** The land's fragment is the largest stage (about 48 KiB at the time of writing). */
const FRAGMENT_BUDGET = 96 * 1024;

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

/**
 * Reads of a `nodeVarN` at a point where no assignment to it has certainly run, in every `fn` of
 * a WGSL stage (the helper of tests/unit/nebula-flow-shaders.test.js).
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

let fields;
const renderers = {};

beforeAll(() => {
    fields = {};
    for (const name of FIELD_ORDER) {
        const file = new URL(`../../src/themes/painted-ages/assets/badlands-${name}.png`, import.meta.url);
        const { rgba } = decodePng(readFileSync(file));
        fields[name] = { ...decodeField(rgba, FIELDS[name]), size: FIELDS[name].size, source: 'asset' };
    }
    fields.source = 'asset';
    BACKENDS.forEach(([label, forceWebGL]) => { renderers[label] = stubRenderer(forceWebGL); });
});

describe.each(TIERS)('Painted Ages shaders at %s', (quality) => {
    let world;
    let scene;
    let camera;
    /** target → backend → { vertex, fragment } | { thrown } */
    const built = {};
    /** What three said while building, per target and backend. */
    const said = {};

    beforeAll(() => {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(40, 16 / 9, 1.5, 60000);
        world = new PaintedAgesWorld({
            scene, quality, capture: true, prepared: PaintedAgesWorld.prepareSync(quality, fields),
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
            lines: 4, rowCodes: Array.from({ length: 40 }, (_, i) => i % 8), tspin: true, combo: 3,
        });
        world.update({ time: 6, delta: 1 / 30 }, camera);

        const targets = [];
        for (const [name, part] of Object.entries(world.parts)) {
            (part.meshes || [part.mesh]).forEach((mesh, i) => mesh && targets.push([i ? `${name}#${i}` : name, mesh]));
        }
        for (const name of FIELD_ORDER) targets.push([`shadow-${name}`, world.shadowPass.passes[name].quad]);

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

    it('has a node material for every part, its halos and the three shadow passes', () => {
        const names = Object.keys(built);
        for (const part of PAINTED_AGES_PARTS) expect(names, part).toContain(part);
        for (const field of FIELD_ORDER) expect(names).toContain(`shadow-${field}`);
        expect(names).toContain('props#1'); // the lanterns' and lamps' halos
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
            if (!byBackend.GLSL.thrown) expect(byBackend.GLSL.fragment, name).toMatch(/void main\(\)/);
        }
        expect(problems).toEqual([]);
    });

    it('writes no NaN or Infinity literal into any shader', () => {
        for (const [name, byBackend] of Object.entries(built)) {
            for (const [label] of BACKENDS) {
                const { vertex = '', fragment = '' } = byBackend[label];
                expect(`${vertex}\n${fragment}`, `${name}, ${label}`).not.toMatch(/\bNaN\b|\bInfinity\b/);
            }
        }
    });

    it(`keeps every fragment stage under ${FRAGMENT_BUDGET / 1024} KiB`, () => {
        for (const [name, byBackend] of Object.entries(built)) {
            for (const [label] of BACKENDS) {
                const bytes = Buffer.byteLength(byBackend[label].fragment ?? '');
                expect(bytes, `${name}, ${label}`).toBeLessThan(FRAGMENT_BUDGET);
            }
        }
        // The land is the heaviest stage and is really there.
        expect(built.land.WGSL.fragment.length).toBeGreaterThan(10_000);
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
        expect(unassignedReads([
            'fn main() {', 'if ( c ) {', 'nodeVar1 = 1.0;', '} else {', 'nodeVar1 = 0.0;', '}',
            'nodeVar3 = nodeVar1;', '}',
        ].join('\n'))).toEqual([]);
    });
});

describe('Painted Ages post stack', () => {
    it.each(BACKENDS)('constructs its output pass on the %s backend, for every look', (label) => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(40, 16 / 9, 1.5, 60000);
        for (const [tier, look] of Object.entries(POST_LOOK)) {
            const post = new PaintedAgesPost(renderers[label], scene, camera, { look, falseColor: tier === 'Low' });
            expect(post.pipeline.outputNode, tier).toBeTruthy();
            expect(Boolean(post.bloomNode), tier).toBe(look.bloom === true);
            post.update({
                exposure: 1.2,
                bloomBoost: 0.3,
                sun: {
                    x: 0.4, y: 0.3, onScreen: 1, strength: 0.8,
                },
                shaftColour: [1, 0.8, 0.6],
                flash: 0.2,
                flashColour: [1, 1, 1],
                saturation: 1.1,
                time: 3,
            });
            post.setCalmRects([{
                x0: 0.4, y0: 0.1, x1: 0.6, y1: 0.9,
            }], 0.5);
            post.setSize(1600, 900, 1600, 900);
            expect(post.uSun.value.toArray()).toEqual([0.4, 0.3, 1, 0.8]);
            expect(post.uCalmStrength.value).toBe(0.5);
            post.dispose();
            expect(post.pipeline).toBeNull();
        }
    });
});
