/**
 * Vesper Chrysalis shader gate — no GPU needed.
 *
 * Every material the world draws is built through three's own node builders against a stub
 * renderer: the WGSL one the WebGPU backend uses and the GLSL one of the WebGL2 fallback, at the
 * tier the theme defaults to and at the leanest. Between them the two tiers build the variants the
 * parts are cut into: the lake with its mirror pass (High) and without (Minimal), the crystals
 * with their light split into colours and without, the wings at detail 2 and 0, the lilies with
 * three whorls and with two. The materials are found by walking the built world, so a part added
 * later is gated too. A graph one builder cannot turn into a shader (a conditional the GLSL builder has no
 * stack for, a helper that reads a uniform it was never handed, a var read on a path where no
 * assignment ran) throws, warns or reads unassigned here instead of leaving a part undrawn, or
 * black, on someone's machine.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, the driver), so a shader the
 * browser rejects can still pass. The harness is tests/unit/helpers/tsl-node-build.js; the
 * layout is tests/unit/himalayan-peak-shaders.test.js's.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { VESPER_PARTS, VesperWorld } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-world.js';
import { QUALITY } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-quality.js';
import { stubRenderer, unassignedReads } from './helpers/tsl-node-build.js';
import { materialXNoiseFunctions } from './helpers/materialx-noise.js';

// Each tier builds the whole world and some twenty materials twice over.
vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/**
 * The largest stage today is the lake's fragment with its mirror pass: some 67 KB of WGSL, 68 KB
 * of GLSL (the sky, the crystals and the chrysalis come next, at under 32 KB). One ceiling for
 * every stage, about 40 % above the lake's.
 */
const STAGE_BUDGET = 96 * 1024;

/**
 * The harness's stub renderer, with what the lake's mirror pass reads of a renderer as it is set
 * up: reflector() sizes its target from the drawing buffer (the Synthwave Sunset gate's answer).
 */
const renderer = () => ({
    ...stubRenderer(),
    getDrawingBufferSize: (target) => target.set(1280, 720),
    getPixelRatio: () => 1,
});

/**
 * Build `mesh` with a node builder class: its shaders and anything three said, or what it threw
 * (tests/unit/helpers/tsl-node-build.js's build, on the renderer above).
 */
function build(Builder, mesh) {
    const heard = [];
    const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 300));
    const warn = vi.spyOn(console, 'warn').mockImplementation(listen);
    const error = vi.spyOn(console, 'error').mockImplementation(listen);
    try {
        const builder = new Builder(mesh, renderer());
        builder.scene = new THREE.Scene();
        builder.camera = new THREE.PerspectiveCamera();
        builder.context.material = mesh.material;
        builder.material = mesh.material;
        builder.build();
        return { vertex: builder.vertexShader, fragment: builder.fragmentShader, heard };
    } catch (thrown) {
        return { thrown, heard };
    } finally {
        warn.mockRestore();
        error.mockRestore();
    }
}

/** Every draw of the world: [part, the mesh, its material's name]. */
function drawsOf(world) {
    const draws = [];
    Object.entries(world.parts).forEach(([part, { mesh }]) => {
        mesh.traverse((object) => {
            if (object.isMesh && object.material) draws.push([part, object, object.material.name]);
        });
    });
    return draws;
}

describe.each(TIERS)('vesper chrysalis shaders at %s', (quality) => {
    let world;
    /** { part, name, label, out: { vertex, fragment } | { thrown }, heard } for every draw on every backend. */
    const built = [];

    beforeAll(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        world = new VesperWorld({ scene: new THREE.Scene(), quality, capture: true }).build();
        drawsOf(world).forEach(([part, mesh, name]) => {
            BACKENDS.forEach(([label, Builder]) => {
                const { heard, ...out } = build(Builder, mesh);
                built.push({
                    part, name, label, out, heard,
                });
            });
        });
    });

    afterAll(() => {
        world?.dispose();
        vi.restoreAllMocks();
    });

    it('has a material to build for every part the tier draws', () => {
        const tier = QUALITY[quality];
        const expected = VESPER_PARTS.filter((name) => name !== 'reeds' || tier.reeds > 0);
        expect([...new Set(built.map((b) => b.part))].sort()).toEqual([...expected].sort());
        const names = built.filter((b) => b.label === 'WGSL').map((b) => b.name);
        // The chrysalis is its shell and its halo; a lily is its petals, its pad and its aura.
        expect(names).toEqual(expect.arrayContaining([
            'VesperChrysalisShell', 'VesperChrysalisHalo', 'VesperChrysalisPetals', 'VesperChrysalisPads',
            'VesperChrysalisAuras', 'VesperChrysalisGlints', 'VesperChrysalisFlutter', 'VesperChrysalisMeteors',
        ]));
        expect(new Set(names).size).toBe(names.length);
        // The variants this tier is here for: the mirror pass at High only, and the crystals' light
        // split into colours wherever the sky is whole (the world cuts them with fire: !tier.lite).
        expect(Boolean(world.lake.reflection)).toBe(quality === 'High');
        expect(tier.lite).toBe(quality === 'Minimal');
    });

    it('builds every material for WebGPU and for the WebGL2 fallback without a word', () => {
        const problems = [];
        built.forEach(({
            part, name, label, out, heard,
        }) => {
            const at = `${part} (${name}), ${label}`;
            if (out.thrown) {
                problems.push(`${at} threw: ${out.thrown?.stack?.split('\n').slice(0, 4).join(' | ')}`);
                return;
            }
            heard.forEach((said) => problems.push(`${at} said: ${said}`));
            for (const stage of ['vertex', 'fragment']) {
                const code = out[stage];
                if (typeof code !== 'string' || code.length < 200) {
                    problems.push(`${at}: no ${stage} stage`);
                    continue;
                }
                // A number the graph could not write, an object or a missing value pasted in as text.
                if (/\bNaN\b|\bInfinity\b/.test(code)) problems.push(`${at} ${stage}: a NaN or Infinity in the text`);
                if (code.includes('[object Object]')) problems.push(`${at} ${stage}: [object Object] in the text`);
                if (/\bundefined\b/.test(code)) problems.push(`${at} ${stage}: undefined in the text`);
            }
            const entry = label === 'WGSL' ? [/@vertex/, /@fragment/] : [/void main\(\)/, /void main\(\)/];
            if (!entry[0].test(out.vertex)) problems.push(`${at}: the vertex stage has no entry point`);
            if (!entry[1].test(out.fragment)) problems.push(`${at}: the fragment stage has no entry point`);
        });
        expect(problems).toEqual([]);
        expect(built.length).toBeGreaterThan(30);
    });

    it('keeps every stage under its size budget and free of MaterialX noise', () => {
        const over = [];
        const noisy = [];
        built.filter((b) => !b.out.thrown).forEach(({
            part, name, label, out,
        }) => {
            for (const stage of ['vertex', 'fragment']) {
                // A feature unrolled in JS instead of looped shows up here as a stage of 100s of KB.
                const bytes = Buffer.byteLength(out[stage] ?? '');
                if (bytes >= STAGE_BUDGET) over.push(`${part} (${name}), ${label} ${stage}: ${bytes} B`);
            }
            const found = materialXNoiseFunctions(`${out.vertex}${out.fragment}`);
            if (found.length) noisy.push(`${part} (${name}), ${label}: ${found.join(', ')}`);
        });
        expect(over).toEqual([]);
        expect(noisy).toEqual([]);
    });

    it('reads no WGSL var where it may not have been assigned', () => {
        const found = [];
        built.filter((b) => b.label === 'WGSL' && !b.out.thrown).forEach(({ part, name, out }) => {
            for (const stage of ['vertex', 'fragment']) {
                unassignedReads(out[stage] ?? '').forEach((read) => found.push(`${part} (${name}) ${stage}: ${read}`));
            }
        });
        expect(found).toEqual([]);
    });
});
