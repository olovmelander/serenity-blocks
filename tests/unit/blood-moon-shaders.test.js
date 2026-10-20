/**
 * Blood Moon shader gate — no GPU needed.
 *
 * The playground effect is created against a stub renderer, and every material in its scene
 * (found by walking it, so a part added later is gated too) is built through three's own node
 * builders: the WGSL one of the WebGPU backend and the GLSL one of the WebGL2 fallback, at the
 * default tier and the leanest. A graph one builder cannot turn into a shader throws or warns
 * here instead of leaving the world undrawn on someone's machine.
 *
 * Also gated: each stage's size, MaterialX noise, a smoothstep whose two edges are the same
 * constant (a hard WGSL error), a NaN/Infinity literal, a WGSL var read where it may not have
 * been assigned, and a laid-out `bm*` helper that closes over a uniform or a texture.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, ANGLE). The harness is
 * tests/unit/sunbraid-shaders.test.js's.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const STAGE_BUDGET = 48 * 1024;

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

/** What the effect itself touches on the renderer. */
const effectRenderer = () => ({
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    getPixelRatio: () => 1,
    render: () => {},
    compileAsync: async () => {},
    info: { render: { drawCalls: 0, triangles: 0 } },
});

function build(Builder, object, material, renderer = stubRenderer(), scene = new THREE.Scene(), camera = null) {
    const builder = new Builder(object, renderer);
    builder.scene = scene;
    builder.camera = camera || new THREE.PerspectiveCamera();
    builder.context.material = material;
    builder.material = material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

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

const HELPER = /^fn (bm\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)^\}/gm;
const helpers = (wgsl) => [...wgsl.matchAll(HELPER)].map((m) => ({ name: m[1], body: m[2] }));
const captures = (body) => body.match(/nodeUniform\d+|NodeBuffer_\w+|\bobject\.\w+|\brender\.\w+|texture\w*\(/g);

function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

/** Reads of a `nodeVarN` where no assignment has certainly run (painted-ages-shaders.test.js). */
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
        const bytes = Buffer.byteLength(code);
        if (bytes >= STAGE_BUDGET) problems.push(`${name}, ${label} ${stage}: ${bytes} B, over ${STAGE_BUDGET} B`);
        equalEdges(code).forEach((call) => problems.push(`${name}, ${label} ${stage}: equal edges in ${call}`));
        if (/\bNaN\b|\bInfinity\b|object Object/.test(code)) {
            problems.push(`${name}, ${label} ${stage}: a NaN, Infinity or [object Object] literal`);
        }
    }
    if (/mx_\w+/.test(`${out.vertex}${out.fragment}`)) problems.push(`${name}, ${label}: MaterialX noise`);
    const entry = label === 'WGSL' ? [/@vertex/, /@fragment/] : [/void main\(\)/, /void main\(\)/];
    if (!entry[0].test(out.vertex)) problems.push(`${name}, ${label}: the vertex stage has no entry point`);
    if (!entry[1].test(out.fragment)) problems.push(`${name}, ${label}: the fragment stage has no entry point`);
    return problems;
}

describe.each(TIERS)('blood moon shaders at %s', (quality) => {
    let runtime;
    let scene;
    const built = [];
    const restore = [];

    beforeAll(async () => {
        // The effect runs in a browser: give it the little of one it touches.
        restore.push(vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture()));
        restore.push(vi.spyOn(THREE.ImageLoader.prototype, 'load').mockImplementation(() => {}));
        vi.stubGlobal('window', {
            innerWidth: 1600, innerHeight: 900, addEventListener() {}, removeEventListener() {},
        });
        const { create } = await import('../../src/playground/effects/blood-moon.effect.js');
        scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
        runtime = create({
            scene,
            camera,
            renderer: effectRenderer(),
            params: new URLSearchParams(`quality=${quality}`),
            sizes: { width: 1600, height: 900 },
        });
        runtime.setLayout([{
            left: 660, top: 90, right: 940, bottom: 830,
        }]);
        runtime.update(3, 1 / 60);
        // Something in every table, as a frame mid-game has.
        runtime.cue('lock', {});
        runtime.cue('tetris', { lineCount: 4 });
        runtime.update(3.4, 1 / 60);

        const targets = [];
        scene.traverse((object) => {
            if (object.material) targets.push([object.name || object.material.name, object, object.material]);
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

    afterAll(() => {
        runtime?.dispose();
        restore.forEach((spy) => spy.mockRestore());
        vi.unstubAllGlobals();
    });

    it('builds every material for WebGPU and for the WebGL2 fallback without a word, under budget', () => {
        expect(built.length).toBeGreaterThanOrEqual(12);
        expect(built.flatMap(problemsOf)).toEqual([]);
        const world = built.find((b) => b.name === 'blood-moon-world' && b.label === 'WGSL');
        expect(world.out.fragment.length).toBeGreaterThan(8_000);
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

    it('emits the laid-out bm helpers once per stage, as functions of their arguments alone', () => {
        const world = built.find((b) => b.name === 'blood-moon-world' && b.label === 'WGSL');
        const found = helpers(world.out.fragment);
        const names = found.map((h) => h.name);
        expect(names).toEqual(expect.arrayContaining(['bmLunarLight']));
        expect(names.some((name) => name.startsWith('bmSaltCells'))).toBe(true);
        expect(new Set(names).size).toBe(names.length);
        found.forEach((h) => expect(captures(h.body), h.name).toBeNull());
    });
});

describe('blood moon under Reduce flashing effects', () => {
    const restore = [];
    afterAll(() => {
        restore.forEach((spy) => spy.mockRestore());
        vi.unstubAllGlobals();
    });

    async function lightAfterTetris(reduceFlashing) {
        restore.push(vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture()));
        restore.push(vi.spyOn(THREE.ImageLoader.prototype, 'load').mockImplementation(() => {}));
        vi.stubGlobal('window', {
            innerWidth: 1600,
            innerHeight: 900,
            addEventListener() {},
            removeEventListener() {},
            settings: { reduceFlashing },
        });
        const { create } = await import('../../src/playground/effects/blood-moon.effect.js');
        const runtime = create({
            scene: new THREE.Scene(),
            camera: new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100),
            renderer: effectRenderer(),
            params: new URLSearchParams('quality=High'),
            sizes: { width: 1600, height: 900 },
        });
        runtime.update(2, 1 / 60);
        runtime.cue('tetris', { lineCount: 4 });
        runtime.update(2.2, 0.2);
        const { eventLight, ripples } = runtime.getDiagnostics();
        runtime.dispose();
        return { ...eventLight, ripples };
    }

    it('keeps under a tenth of every flare round the moon, and still drops its rings', async () => {
        const full = await lightAfterTetris(false);
        const held = await lightAfterTetris(true);
        expect(full.corona).toBeGreaterThan(0.2);
        expect(full.wave).toBeGreaterThan(0.2);
        expect(held.corona).toBeLessThan(full.corona * 0.1);
        expect(held.wave).toBeLessThan(full.wave * 0.1);
        expect(held.moonGain - 1).toBeLessThan((full.moonGain - 1) * 0.1);
        expect(held.ripples).toBe(full.ripples);
        expect(held.ripples).toBeGreaterThan(0);
    });
});
