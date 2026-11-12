/**
 * Kaleidosonic shader gate — no GPU needed.
 *
 * Every material in the built world (found by walking the scene, so a part added later is gated
 * too: today the one full-screen temple march) and the post stack's output (its look per tier, and
 * the falseColor debug view) are built through three's own node builders against a stub renderer:
 * the WGSL one of the WebGPU backend and the GLSL one of the WebGL2 fallback, at the tier the theme
 * defaults to, at the leanest (six beams, no jewel beams) and at the richest. The temple's scout
 * pass and its light map (drawn before the frame, not in the scene) are built with them. A graph
 * one builder cannot turn into a shader throws or warns here instead of leaving the temple
 * undrawn on someone's machine.
 *
 * Also gated: that the shader's field and colour signal ARE the CPU twin's (the built WGSL
 * helpers are run in JavaScript, statement by statement, and compared with templeDistance and
 * templeTrap at sample points: the eye, the core and every strike are placed by the twin), how
 * often each march calls the field (a value read twice can be emitted twice: a soft shadow once
 * ran the whole field twice a step), that the beams are integrated in loops
 * (six beams unrolled at the two sites that draw them were 15 KB), each stage's size (a march
 * unrolled in JS instead of looped shows up as a module of hundreds of KB), MaterialX noise (`mx_*`), a
 * smoothstep whose two edges are the same constant (a hard WGSL error), a NaN/Infinity literal, a
 * WGSL var read where it may not have been assigned, and a laid-out `ks_*` helper that closes over
 * a uniform or a texture (cached module-wide, it would emit invalid WGSL in the second material
 * that uses it).
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, ANGLE), BloomNode's own passes are
 * built lazily by the renderer, and there is no compute. The harness is
 * tests/unit/high-coast-shaders.test.js's.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { KALEIDOSONIC_PARTS, KaleidosonicWorld } from '../../src/themes/kaleidosonic/kaleidosonic-world.js';
import { KaleidosonicPost, POST_LOOK } from '../../src/themes/kaleidosonic/kaleidosonic-post.js';
import {
    PIECE_COLORS, TEMPLE, foldSplit, mulberry32, templeDistance, templeTrap,
} from '../../src/themes/kaleidosonic/kaleidosonic-core.js';
import { tierFor } from '../../src/themes/kaleidosonic/kaleidosonic-quality.js';
import { hasMaterialXNoise } from './helpers/materialx-noise.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Minimal', 'Extreme'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** Per stage. The march, its veins, strikes and harmonics are loops, so the temple stays small. */
const STAGE_BUDGET = 64 * 1024;
/** The theme's laid-out Fn prefix (`setLayout({ name: 'ks_…' })`). */
const PREFIX = 'ks';

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

/** Every `ks_*` function a WGSL stage defines: name → body. */
const HELPER = new RegExp(`^fn (${PREFIX}_\\w+)\\s*\\([^)]*\\)[^{]*\\{([\\s\\S]*?)^\\}`, 'gm');
const helpers = (wgsl) => [...wgsl.matchAll(HELPER)].map((m) => ({ name: m[1], body: m[2] }));

/** What a helper's body names that is neither an argument nor a local: uniforms, arrays, textures. */
const captures = (body) => body.match(/nodeUniform\d+|NodeBuffer_\w+|\bobject\.\w+|\brender\.\w+|texture\w*\(/g);

/** What a WGSL helper may call, on numbers (vectors go through them component by component). */
const WGSL_CALLS = {
    abs: Math.abs,
    floor: Math.floor,
    sqrt: Math.sqrt,
    min: Math.min,
    max: Math.max,
    mix: (a, b, k) => a * (1 - k) + b * k,
    clamp: (v, lo, hi) => Math.min(Math.max(v, lo), hi),
    atan: (y, x) => (x === undefined ? Math.atan(y) : Math.atan2(y, x)),
    f32: (v) => v,
    i32: Math.trunc,
};

/**
 * A laid-out `ks_*` helper of a WGSL stage as a JavaScript function: its body run as it is written
 * (vars, lets, for loops, if / else, return; + - * / and comparisons; swizzles; the calls above)
 * over numbers and vectors, so a test can ask the SHADER what it makes of a point. `single` rounds
 * every result to a 32-bit float, as the GPU does. Anything it does not know throws.
 */
function wgslFunction(wgsl, name, single = false) {
    const found = new RegExp(`^fn ${name}\\s*\\(([^)]*)\\)[^{]*\\{([\\s\\S]*?)^\\}`, 'm').exec(wgsl);
    if (!found) throw new Error(`no fn ${name} in the stage`);
    const params = [...found[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
    const tokens = found[2].match(/\d+\.?\d*(?:e[-+]?\d+)?|\w+|<=|>=|\+\+|[^\s\w]/g);
    let at = 0;
    const peek = () => tokens[at];
    const take = (want) => {
        const token = tokens[at];
        at += 1;
        if (want && token !== want) throw new Error(`${name}: expected ${want}, found ${token}`);
        return token;
    };
    const round = single ? Math.fround : (v) => v;
    /** fn over numbers and vectors alike, component by component. */
    const each = (fn, ...args) => {
        const sized = args.find(Array.isArray);
        if (!sized) return round(fn(...args));
        return sized.map((_, i) => round(fn(...args.map((a) => (Array.isArray(a) ? a[i] : a)))));
    };
    const grammar = {};
    const type = () => {
        take();
        if (peek() === '<') {
            take('<');
            take();
            take('>');
        }
    };
    const primary = () => {
        const token = take();
        if (token === '(') {
            const inner = grammar.expression();
            take(')');
            return inner;
        }
        if (/^\d/.test(token)) {
            const value = Number(token);
            return () => value;
        }
        const size = /^vec[234]$/.test(token) ? Number(token[3]) : 0;
        if (size && peek() === '<') {
            take('<');
            take();
            take('>');
        }
        if (peek() !== '(') {
            return (env) => {
                if (!(token in env)) throw new Error(`${name}: ${token} is read before it is set`);
                return env[token];
            };
        }
        take('(');
        const args = [];
        while (peek() !== ')') {
            args.push(grammar.expression());
            if (peek() === ',') take(',');
        }
        take(')');
        if (size) {
            return (env) => {
                const flat = args.flatMap((a) => a(env));
                return flat.length === 1 ? new Array(size).fill(flat[0]) : flat;
            };
        }
        const fn = WGSL_CALLS[token];
        if (!fn) throw new Error(`${name}: a call this reader does not know: ${token}`);
        return (env) => each(fn, ...args.map((a) => a(env)));
    };
    const postfix = () => {
        let value = primary();
        while (peek() === '.') {
            take('.');
            const pick = [...take()].map((c) => 'xyzw'.indexOf(c));
            const inner = value;
            value = pick.length === 1 ? (env) => inner(env)[pick[0]] : (env) => pick.map((i) => inner(env)[i]);
        }
        return value;
    };
    const unary = () => {
        if (peek() !== '-') return postfix();
        take('-');
        const inner = unary();
        return (env) => each((v) => -v, inner(env));
    };
    const binary = (next, ops) => () => {
        let left = next();
        while (Object.prototype.hasOwnProperty.call(ops, peek())) {
            const op = ops[take()];
            const a = left;
            const b = next();
            left = (env) => op(a(env), b(env));
        }
        return left;
    };
    const product = binary(unary, {
        '*': (a, b) => each((x, y) => x * y, a, b),
        '/': (a, b) => each((x, y) => x / y, a, b),
    });
    const sum = binary(product, {
        '+': (a, b) => each((x, y) => x + y, a, b),
        '-': (a, b) => each((x, y) => x - y, a, b),
    });
    grammar.expression = binary(sum, {
        '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b,
    });
    /** Statements up to a closing brace (or the end): run in order, stopping at a return. */
    const block = (closed) => {
        const statements = [];
        while (at < tokens.length && peek() !== '}') statements.push(grammar.statement());
        if (closed) take('}');
        return (env) => {
            for (const run of statements) {
                const out = run(env);
                if (out) return out;
            }
            return null;
        };
    };
    grammar.statement = () => {
        const token = take();
        if (token === 'return') {
            const value = grammar.expression();
            take(';');
            return (env) => ({ value: value(env) });
        }
        if (token === 'if') {
            take('(');
            const test = grammar.expression();
            take(')');
            take('{');
            const yes = block(true);
            let no = () => null;
            if (peek() === 'else') {
                take('else');
                take('{');
                no = block(true);
            }
            return (env) => (test(env) ? yes(env) : no(env));
        }
        if (token === 'for') {
            take('(');
            take('var');
            const id = take();
            take(':');
            type();
            take('=');
            const start = grammar.expression();
            take(';');
            const test = grammar.expression();
            take(';');
            take(id);
            take('++');
            take(')');
            take('{');
            const body = block(true);
            return (env) => {
                for (env[id] = start(env); test(env); env[id] += 1) {
                    const out = body(env);
                    if (out) return out;
                }
                return null;
            };
        }
        const id = token === 'var' || token === 'let' ? take() : token;
        if (peek() === ':') {
            take(':');
            type();
        }
        if (peek() === ';') {
            take(';');
            return () => null;
        }
        take('=');
        const value = grammar.expression();
        take(';');
        return (env) => {
            env[id] = value(env);
            return null;
        };
    };
    const body = block(false);
    return (...args) => {
        const env = {};
        params.forEach((param, i) => { env[param] = args[i]; });
        return body(env).value;
    };
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
    }
    if (hasMaterialXNoise(`${out.vertex}${out.fragment}`)) problems.push(`${name}, ${label}: MaterialX noise`);
    const entry = label === 'WGSL' ? [/@vertex/, /@fragment/] : [/void main\(\)/, /void main\(\)/];
    if (!entry[0].test(out.vertex)) problems.push(`${name}, ${label}: the vertex stage has no entry point`);
    if (!entry[1].test(out.fragment)) problems.push(`${name}, ${label}: the fragment stage has no entry point`);
    return problems;
}

describe.each(TIERS)('kaleidosonic shaders at %s', (quality) => {
    let world;
    let scene;
    /** { name, object, label, out, heard } per material and backend. */
    const built = [];

    beforeAll(() => {
        scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 60);
        world = new KaleidosonicWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, 16 / 9);
        world.updateCamera(camera, { time: 5, delta: 0 });
        world.update({ time: 5, delta: 0 }, camera);
        // Something in every table, as a frame mid-game has: strikes, harmonics, a dive, the folds.
        world.onLock({
            u: 0.3, rows: [9, 8], color: PIECE_COLORS[0], shape: 'I',
        });
        world.onLock({
            u: 0.7, rows: [9], color: PIECE_COLORS[6], shape: 'O', hardDrop: true, distance: 12,
        });
        world.onClear({ lines: 4, twist: true, combo: 3 });
        world.onCombo(9);
        world.updateCamera(camera, { time: 6, delta: 0 });
        world.update({ time: 6, delta: 1 / 30 }, camera);

        const targets = [];
        scene.traverse((object) => {
            if (!object.material) return;
            (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
                targets.push([object.name || material.name || object.type, object, material]);
            });
        });
        const { scout, lightMap } = world.parts.temple;
        targets.push([scout.quad.name, scout.quad, scout.material]);
        targets.push([lightMap.quad.name, lightMap.quad, lightMap.material]);
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

    it('has a material to build for every part, every mesh of it, on both backends', () => {
        for (const name of KALEIDOSONIC_PARTS) {
            const part = world.parts[name];
            const meshes = part.meshes || [part.mesh];
            expect(meshes.length, name).toBeGreaterThan(0);
            meshes.forEach((root) => root.traverse((object) => {
                if (!object.material) return;
                const labels = built.filter((b) => b.object === object).map((b) => b.label);
                expect(labels, `${name}: ${object.name}`).toEqual(expect.arrayContaining(['WGSL', 'GLSL']));
                expect(object.material.isNodeMaterial, `${name}: ${object.name}`).toBe(true);
            }));
        }
        expect(built.length).toBeGreaterThanOrEqual(KALEIDOSONIC_PARTS.length * 2);
    });

    it('builds every material for WebGPU and for the WebGL2 fallback without a word, under budget', () => {
        expect(built.flatMap(problemsOf)).toEqual([]);
        // The temple is the whole picture and is really there: the march loops, it is not unrolled.
        const temple = built.find((b) => b.object === world.parts.temple.mesh && b.label === 'WGSL');
        expect(temple.out.fragment.length).toBeGreaterThan(5_000);
        expect(temple.out.fragment).toMatch(/\bloop\b|\bfor\s*\(/);
    });

    it('caps the field\'s folds at the tier\'s: one laid-out field per material, named for its cap', () => {
        const { folds } = tierFor(quality);
        const temple = built.filter((b) => b.object === world.parts.temple.mesh && !b.out.thrown);
        expect(temple).toHaveLength(2);
        const wgsl = temple.find((b) => b.label === 'WGSL').out.fragment;
        const fields = helpers(wgsl).filter((h) => /^ks_temple\d+$/.test(h.name)).map((h) => h.name);
        expect(fields).toEqual([`ks_temple${Math.max(1, Math.round(folds))}`]);
    });

    it('calls the field once a site: the march, four normal taps, the occlusion tap; the scout, the light map', () => {
        const { folds } = tierFor(quality);
        const field = new RegExp(`\\bks_temple${Math.max(1, Math.round(folds))}\\s*\\(`, 'g');
        // the definition's own `fn ks_templeN (` is not a call
        const calls = (wgsl, pattern) => (wgsl.match(pattern) || []).length - 1;
        const wgslOf = (object) => built.find((b) => b.object === object && b.label === 'WGSL').out.fragment;
        const { mesh, scout, lightMap } = world.parts.temple;
        // (the stone's shadows come from the light map: no shadow march)
        expect(calls(wgslOf(mesh), field)).toBe(1 + 4 + 1);
        // what of the net a hit belongs to colours the stone: read once, at the hit
        expect(calls(wgslOf(mesh), /\bks_templeTrap\d+\s*\(/g)).toBe(1);
        expect(calls(wgslOf(scout.quad), field)).toBe(1);
        expect(calls(wgslOf(lightMap.quad), field)).toBe(1);
    });

    it('walks the net as the CPU twin does: the built shader\'s own field and colour signal, run in JavaScript', () => {
        const cap = Math.max(1, Math.round(tierFor(quality).folds));
        const { mesh, scout, lightMap } = world.parts.temple;
        const wgslOf = (object) => built.find((b) => b.object === object && b.label === 'WGSL').out.fragment;
        const field = wgslFunction(wgslOf(mesh), `ks_temple${cap}`);
        const asFloats = wgslFunction(wgslOf(mesh), `ks_temple${cap}`, true);
        const trap = wgslFunction(wgslOf(mesh), `ks_templeTrap${cap}`);
        // (the scout and the light map march the same field: the same text, so the same walk)
        const text = (wgsl) => helpers(wgsl).find((h) => h.name === `ks_temple${cap}`).body;
        expect(text(wgslOf(scout.quad))).toBe(text(wgslOf(mesh)));
        expect(text(wgslOf(lightMap.quad))).toBe(text(wgslOf(mesh)));
        // Every count the tier may be asked for: at rest, a level growing in, its deepest.
        const counts = [...new Set([TEMPLE.detailRest, TEMPLE.detailRest + 0.37, cap - 0.25, cap])]
            .filter((folds) => folds >= TEMPLE.detailRest && folds <= cap);
        const random = mulberry32(9);
        let compared = 0;
        let stone = 0;
        for (const s of [TEMPLE.sMin, TEMPLE.s, TEMPLE.sMax]) {
            for (const folds of counts) {
                const prm = [s, folds, ...foldSplit(folds)];
                for (let i = 0; i < 70; i++) {
                    const at = [random() * 6 - 3, random() * 6 - 3, random() * 6 - 3];
                    const twin = templeDistance(...at, s, folds);
                    const label = `(${at}) at s ${s}, ${folds} folds`;
                    expect(field(at, prm), label).toBeCloseTo(twin, 12);
                    // in the GPU's own 32-bit floats the walk lands within a hair of the twin's
                    expect(Math.abs(asFloats(at, prm) - twin), label).toBeLessThan(2e-5);
                    const mark = templeTrap(...at, s, folds);
                    trap(at, prm).forEach((v, k) => expect(v, `${label}, mark ${k}`).toBeCloseTo(mark[k], 9));
                    compared += 1;
                    if (twin < 0) stone += 1;
                }
            }
        }
        expect(compared).toBeGreaterThanOrEqual(3 * 70);
        // (the samples are in the stone and in the open air both)
        expect(stone).toBeGreaterThan(10);
        expect(compared - stone).toBeGreaterThan(100);
        // The reader refuses what it does not know (a helper it cannot run is not silently skipped).
        expect(() => wgslFunction(wgslOf(mesh), 'ks_noSuchHelper')).toThrow(/no fn/);
        const unknown = 'fn ks_x ( a : f32 ) -> f32 {\n\treturn tan( a );\n}\n';
        expect(() => wgslFunction(unknown, 'ks_x')).toThrow(/does not know/);
    });

    it('integrates the beams in loops: one beam call at the core\'s site and one at the jewels\'', () => {
        const { airBeamCells } = tierFor(quality);
        const temple = built.find((b) => b.object === world.parts.temple.mesh && b.label === 'WGSL').out.fragment;
        // the definition's own `fn ks_beamLobe (` is not a call
        const lobeCalls = (temple.match(/\bks_beamLobe\s*\(/g) || []).length - 1;
        expect(lobeCalls).toBe(airBeamCells > 0 ? 2 : 1);
        // the light map is read where the stone is lit (the core, the nearest jewel) and once per beam site
        const lookups = (temple.match(/\bks_octUv\s*\(/g) || []).length - 1;
        expect(lookups).toBe(2 + (airBeamCells > 0 ? 2 : 1));
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

    it('emits each shared ks_ helper once per stage, as a function of its arguments alone', () => {
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
        const post = new KaleidosonicPost(fakeRenderer(), scene, camera, { look: POST_LOOK[quality], ...variant });
        expect(Boolean(post.bloomNode)).toBe(POST_LOOK[quality].bloom === true);
        const material = new THREE.NodeMaterial();
        material.fragmentNode = post.pipeline.outputNode;
        const quad = new THREE.QuadMesh(material);
        try {
            const problems = [];
            BACKENDS.forEach(([label, Builder]) => {
                const [out, heard] = listening(
                    () => build(Builder, quad, material, postRenderer(), scene, quad.camera),
                );
                problems.push(...problemsOf({
                    name: `post ${JSON.stringify(variant)}`, label, out, heard,
                }));
                if (label === 'WGSL' && !out.thrown) {
                    helpers(out.fragment).forEach((h) => {
                        const captured = captures(h.body);
                        if (captured) problems.push(`${h.name} in the post reads ${captured.join(', ')}`);
                    });
                }
            });
            expect(problems).toEqual([]);
        } finally {
            post.dispose();
            material.dispose();
        }
        expect(post.pipeline).toBeNull();
    });
});
