/**
 * Fluid Dreams shader gate — no GPU needed.
 *
 * Every material the world builds (the traced liquid, the motes, the spray, found by walking the
 * scene) is built through three's own node builders against a stub renderer: the WGSL one of the
 * WebGPU backend and the GLSL one of the WebGL2 fallback, at High and at Minimal, with something
 * in every event table. A graph one builder cannot turn into a shader throws or warns here
 * instead of leaving the sea undrawn on someone's machine.
 *
 * Also gated: a NaN/Infinity literal or a stringified node (`[object Object]`) in the output, and
 * a WGSL var read where it may not have been assigned (the sea's stains, veins and swell are read
 * inside branches and bounce loops).
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, ANGLE). The harness is
 * tests/unit/sunbraid-shaders.test.js's.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { FluidDreamsWorld, REST_RIG } from '../../src/themes/fluid-dreams/fluid-dreams-world.js';
import { fallbackLayout } from '../../src/themes/fluid-dreams/fluid-dreams-composition.js';
import { BUBBLE_SLOTS } from '../../src/themes/fluid-dreams/fluid-dreams-sky.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];

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

/** Both stages of one material on one object, as one backend would write them. */
function build(Builder, object, material, camera) {
    const builder = new Builder(object, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = camera;
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

/**
 * Reads of a `nodeVarN` at a point where no assignment to it has certainly run, in every `fn` of
 * a WGSL stage (the helper of tests/unit/sunbraid-shaders.test.js).
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
        if (/\bNaN\b|\bInfinity\b/.test(code)) problems.push(`${name}, ${label} ${stage}: a NaN or Infinity literal`);
        if (/object Object/.test(code)) problems.push(`${name}, ${label} ${stage}: a node stringified into the code`);
    }
    if (label === 'WGSL') {
        for (const stage of ['vertex', 'fragment']) {
            unassignedReads(out[stage]).forEach((read) => problems.push(`${name}, WGSL ${stage}: unassigned ${read}`));
        }
    }
    return problems;
}

describe.each(TIERS)('Fluid Dreams shaders at %s', (quality) => {
    let world;
    const built = [];

    beforeAll(() => {
        const width = 1600;
        const height = 900;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
        world = new FluidDreamsWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(width, height, width / height);
        world.setLayout(fallbackLayout(width, height), width / height);
        world.seek(10);
        world.updateCamera(camera, { time: 10, delta: 0 });
        world.update({ time: 10, delta: 0 }, camera);
        const targets = [];
        scene.traverse((object) => {
            if (object.isMesh && object.material) targets.push(object);
        });
        const view = camera;
        for (const object of targets) {
            for (const [label, Builder] of BACKENDS) {
                const [out, heard] = listening(() => build(Builder, object, object.material, view));
                built.push({
                    name: object.material.name || object.name, label, out, heard,
                });
            }
        }
    });

    afterAll(() => world?.dispose?.());

    it('builds every part on both backends, cleanly', () => {
        expect(built.length).toBeGreaterThanOrEqual(2);
        expect(built.some((entry) => entry.name === 'Fluid Dreams — liquid')).toBe(true);
        expect(built.flatMap(problemsOf)).toEqual([]);
    });

    it('carries the third swell train and the liquid light into the liquid on both backends', () => {
        // The swell's warp and the veins add sin/cos and a ridge (abs) the earlier sea had no use
        // for in these amounts; their presence says the new terms reached the shader.
        const liquid = built.filter((entry) => entry.name === 'Fluid Dreams — liquid');
        expect(liquid).toHaveLength(2);
        for (const entry of liquid) {
            const sines = (entry.out.fragment.match(/\bsin\s*\(/g) || []).length;
            expect(sines, entry.label).toBeGreaterThanOrEqual(9);
        }
    });
});

/**
 * The sky the liquid inlines (fluid-dreams-sky-tsl.js) is assembled in JavaScript from the tier's
 * switches: the ink lit from the sun's side, the bars of cloud, the bubbles, and what of those
 * the sea's mirror shows (`mirrorSky`: the bars; `mirrorExtras`: the bubbles, with the Drop's
 * satellites and crown). A tier ships one combination of them and the playground's `tune` any
 * other, so the liquid is built here with everything off, everything on, each one alone and each
 * one missing, on both backends: a branch only one combination reaches cannot hide a var that is
 * read unassigned or a node that will not build.
 */
const SKY_SWITCHES = ['skyLit', 'strata', 'bubbles', 'mirrorSky', 'mirrorExtras'];
const skySwitches = (on) => ({
    skyLit: on, strata: on, bubbles: on ? BUBBLE_SLOTS : 0, mirrorSky: on, mirrorExtras: on,
});
const SKY_VARIANTS = [
    ['everything off', skySwitches(false)],
    ['everything on', skySwitches(true)],
    ...SKY_SWITCHES.map((key) => [`only ${key}`, { ...skySwitches(false), [key]: skySwitches(true)[key] }]),
    ...SKY_SWITCHES.map((key) => [`all but ${key}`, { ...skySwitches(true), [key]: skySwitches(false)[key] }]),
];

/** Every combination at High; at Minimal (another sea round the same sky: one bounce, no stars) the two ends. */
const SKY_GATE = [['High', SKY_VARIANTS], ['Minimal', SKY_VARIANTS.slice(0, 2)]];

describe.each(SKY_GATE)('Fluid Dreams liquid at %s: every switch of the sky, off and on', (quality, variants) => {
    const built = [];
    const has = (variant) => variants.some(([name]) => name === variant);

    beforeAll(() => {
        const width = 1600;
        const height = 900;
        for (const [variant, tune] of variants) {
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
            const world = new FluidDreamsWorld({
                scene, quality, capture: true, tune,
            }).build();
            world.bindCamera(camera);
            world.setViewport(width, height, width / height);
            world.setLayout(fallbackLayout(width, height), width / height);
            world.seek(10);
            world.updateCamera(camera, { time: 10, delta: 0 });
            world.update({ time: 10, delta: 0 }, camera);
            // The world built what it was asked for.
            expect(world.tier).toMatchObject(tune);
            expect(world.sky.bubbleCount).toBe(tune.bubbles);
            const liquid = world.parts.liquid.mesh;
            for (const [label, Builder] of BACKENDS) {
                const [out, heard] = listening(() => build(Builder, liquid, liquid.material, camera));
                built.push({
                    name: `the liquid with ${variant}`, variant, label, out, heard,
                });
            }
            world.dispose();
        }
    });

    it('builds on both backends, cleanly, whatever the sky is asked to show', () => {
        expect(built).toHaveLength(variants.length * BACKENDS.length);
        expect(built.flatMap(problemsOf)).toEqual([]);
    });

    it('leaves out of the shader what a switch turns off', () => {
        const size = (variant, label) => built
            .find((entry) => entry.variant === variant && entry.label === label).out.fragment.length;
        for (const [label] of BACKENDS) {
            expect(size('everything on', label), label).toBeGreaterThan(size('everything off', label));
            if (!has('only mirrorSky')) continue;
            // What the direct view shows is paid for by itself...
            for (const key of ['skyLit', 'strata', 'bubbles']) {
                expect(size(`only ${key}`, label), `${label}, only ${key}`).toBeGreaterThan(size('everything off', label));
                expect(size(`all but ${key}`, label), `${label}, all but ${key}`).toBeLessThan(size('everything on', label));
            }
            // ...and the mirror's share only where there is something of it to mirror: without the
            // bars and the bubbles, `mirrorSky` adds nothing to the shader.
            expect(size('only mirrorSky', label), label).toBe(size('everything off', label));
            expect(size('all but mirrorSky', label), label).toBeLessThan(size('everything on', label));
            expect(size('all but mirrorExtras', label), label).toBeLessThan(size('everything on', label));
        }
    });
});
