/**
 * Nebula Flow shader gate — no GPU needed.
 *
 * Every part's material is built through three's own node builders against a stub renderer: the
 * WGSL one the WebGPU backend uses and the GLSL one of the WebGL2 fallback, at the tier the theme
 * defaults to and at the leanest. A graph that one builder cannot turn into a shader (a
 * conditional the GLSL builder has no stack for, a helper that reads a uniform it was never
 * handed) throws or warns here instead of leaving a part undrawn on someone's machine.
 *
 * WebGPU also refuses a texture read with an implicit level (derivatives) inside a branch that
 * is not uniform: the nursery reads its relief inside one (only near the dust), so every read
 * there must name its level. The WGSL is checked for that too.
 *
 * Two more traps the builders walk into without a word, both checked in the WGSL:
 *   - a node shared by two places, built first inside one branch of a select, has its var
 *     assigned in that branch alone: everywhere else it reads zero (WGSL zero-initialises it).
 *     The jets' ambient stars drew nothing that way.
 *   - `pow(x, 2.0)` of a value that can be negative is undefined (HLSL and SPIR-V lower it to
 *     exp2(2·log2 x), NaN for x < 0); squares are written as products (`nfGauss`).
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, the driver), so a shader the
 * browser rejects can still pass. The harness is the one of tests/unit/himalayan-peak-shaders.test.js.
 */

import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { NEBULA_FLOW_PARTS, NebulaFlowWorld } from '../../src/themes/nebula-flow/nebula-flow-world.js';

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** The nursery's fragment is the largest stage. */
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

/** Both stages of a mesh's material as one backend would write them. */
function buildShaders(Builder, mesh) {
    const builder = new Builder(mesh, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = mesh.material;
    builder.material = mesh.material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

/** Every `nf_*` function a WGSL stage defines: name → body. */
function helpers(wgsl) {
    return [...wgsl.matchAll(/^fn (nf_\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)^\}/gm)]
        .map((m) => ({ name: m[1], body: m[2] }));
}

/** What a helper's body names that is neither an argument nor a local: uniforms, arrays, textures. */
const captures = (body) => body.match(/nodeUniform\d+|NodeBuffer_\w+|\bobject\.\w+|\brender\.\w+|texture\w*\(/g);

/** smoothstep() calls whose two edges are the same constant: a hard error in WGSL. */
function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

/**
 * Implicit-level texture reads (`textureSample(`, not `textureSampleLevel(`) that sit inside an
 * `if` or `else` block of a WGSL stage: illegal in non-uniform control flow on WebGPU.
 */
function implicitReadsInBranches(wgsl) {
    const found = [];
    const opens = [];
    const re = /\bif\s*\(|\belse\b|\{|\}|textureSample\(/g;
    let pendingIf = false;
    for (let m = re.exec(wgsl); m; m = re.exec(wgsl)) {
        const token = m[0];
        if (token.startsWith('if') || token === 'else') pendingIf = true;
        else if (token === '{') {
            opens.push(pendingIf);
            pendingIf = false;
        } else if (token === '}') opens.pop();
        else if (opens.includes(true)) found.push(wgsl.slice(Math.max(0, m.index - 60), m.index + 40));
    }
    return found;
}

/**
 * Reads of a `nodeVarN` at a point where no assignment to it has certainly run, in every `fn` of
 * a WGSL stage. An assignment counts in its own block and those it encloses; one made in both the
 * `if` and the `else` of a branch counts after it; one inside a loop or a lone `if` does not.
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

/** `pow()` calls whose exponent is the constant 2. */
function squaredPows(shader) {
    const found = [];
    for (let at = shader.indexOf('pow('); at >= 0; at = shader.indexOf('pow(', at + 4)) {
        let depth = 0;
        let lastComma = -1;
        let end = at + 4;
        for (; end < shader.length; end += 1) {
            const c = shader[end];
            if (c === '(') depth += 1;
            else if (c === ')') {
                if (depth === 0) break;
                depth -= 1;
            } else if (c === ',' && depth === 0) lastComma = end;
        }
        const exponent = Number(shader.slice(lastComma + 1, end).trim());
        if (exponent === 2) found.push(shader.slice(at, Math.min(end + 1, at + 100)));
    }
    return found;
}

describe.each(TIERS)('nebula flow shaders at %s', (quality) => {
    let world;
    /** part → backend → { vertex, fragment } */
    const built = {};
    /** What three said while building, per part and backend. */
    const said = {};

    beforeAll(() => {
        world = new NebulaFlowWorld({ scene: new THREE.Scene(), quality, capture: true }).build();
        world.setViewport(1280, 720, 16 / 9);
        const warn = vi.spyOn(console, 'warn');
        const error = vi.spyOn(console, 'error');
        Object.keys(world.parts).forEach((name) => {
            built[name] = {};
            said[name] = {};
            BACKENDS.forEach(([label, Builder]) => {
                const heard = [];
                const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 400));
                warn.mockImplementation(listen);
                error.mockImplementation(listen);
                try {
                    built[name][label] = buildShaders(Builder, world.parts[name].mesh);
                } catch (thrown) {
                    built[name][label] = { thrown };
                }
                said[name][label] = heard;
            });
        });
        warn.mockRestore();
        error.mockRestore();
    });

    afterAll(() => {
        world.dispose();
    });

    it('has a node material to build for every part', () => {
        expect(Object.keys(built).sort()).toEqual([...NEBULA_FLOW_PARTS].sort());
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.material.isNodeMaterial, name).toBe(true);
        });
    });

    it.each(NEBULA_FLOW_PARTS)('builds the %s for WebGPU and for the WebGL2 fallback without a word', (name) => {
        BACKENDS.forEach(([label]) => {
            const out = built[name][label];
            expect(out.thrown, `${name}, ${label}: ${out.thrown?.stack ?? ''}`).toBeUndefined();
            expect(said[name][label], `${name}, ${label}`).toEqual([]);
            ['vertex', 'fragment'].forEach((stage) => {
                expect(typeof out[stage], `${name}, ${label} ${stage}`).toBe('string');
                expect(out[stage].length, `${name}, ${label} ${stage}`).toBeGreaterThan(200);
                expect(Buffer.byteLength(out[stage]), `${name}, ${label} ${stage}`).toBeLessThan(STAGE_BUDGET);
                expect(equalEdges(out[stage]), `${name}, ${label} ${stage}`).toEqual([]);
            });
            expect(`${out.vertex}${out.fragment}`, `${name}, ${label}`).not.toMatch(/mx_\w+/);
        });
        expect(built[name].WGSL.vertex).toMatch(/@vertex/);
        expect(built[name].WGSL.fragment).toMatch(/@fragment/);
        expect(built[name].GLSL.fragment).toMatch(/void main\(\)/);
    });

    it('names the level of every texture read inside a branch (WebGPU uniformity)', () => {
        Object.keys(built).forEach((name) => {
            ['vertex', 'fragment'].forEach((stage) => {
                expect(implicitReadsInBranches(built[name].WGSL[stage]), `${name} ${stage}`).toEqual([]);
            });
        });
        // The nursery does read inside its branch, so the check has something to look at.
        expect(built.nebula.WGSL.fragment).toMatch(/textureSampleLevel\(/);
        expect(built.nebula.WGSL.fragment).toMatch(/\bif\s*\(/);
        // and it sees both arms of a branch, never a read at the top level or with a named level
        const read = 'y = textureSample( t, s, uv );';
        expect(implicitReadsInBranches(`fn main() {\nif ( c ) {\nx = 1.0;\n} else {\n${read}\n}\n}`)).toHaveLength(1);
        expect(implicitReadsInBranches(`fn main() {\nif ( c ) {\n${read}\n}\n}`)).toHaveLength(1);
        expect(implicitReadsInBranches(`fn main() {\n${read}\nif ( c ) {\nx = 1.0;\n}\n}`)).toEqual([]);
        expect(implicitReadsInBranches('fn main() {\nif ( c ) {\n} else {\ny = textureSampleLevel( t, s, uv, 0.0 );\n}\n}')).toEqual([]);
    });

    it('reads no shader var where it may not have been assigned', () => {
        Object.keys(built).forEach((name) => {
            ['vertex', 'fragment'].forEach((stage) => {
                expect(unassignedReads(built[name].WGSL[stage]), `${name} ${stage}`).toEqual([]);
            });
        });
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

    it('squares by multiplying, never with pow(x, 2.0)', () => {
        Object.keys(built).forEach((name) => {
            ['vertex', 'fragment'].forEach((stage) => {
                expect(squaredPows(built[name].WGSL[stage]), `${name} ${stage}`).toEqual([]);
            });
        });
        expect(squaredPows('a = exp( - pow( ( x / w ), 2.0 ) );')).toHaveLength(1);
    });

    it('emits each shared helper once per stage, as a function of its arguments alone', () => {
        const names = new Set();
        Object.keys(built).forEach((part) => {
            ['vertex', 'fragment'].forEach((stage) => {
                const found = helpers(built[part].WGSL[stage]);
                expect(new Set(found.map((helper) => helper.name)).size, `${part} ${stage}`).toBe(found.length);
                found.forEach((helper) => {
                    names.add(helper.name);
                    expect(captures(helper.body), `${helper.name} in the ${part}'s ${stage} stage`).toBeNull();
                });
            });
        });
        // The pillars' tapered capsules and the births' light are real functions, not inlined copies.
        expect([...names]).toEqual(expect.arrayContaining(['nf_taper', 'nf_birthLight']));
    });
});
