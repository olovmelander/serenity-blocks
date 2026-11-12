/**
 * Cosmic Noir shader gate — no GPU needed.
 *
 * The picture is two fragment shaders: the backdrop (the sky, the sea of smoke, the lighthouse on
 * its rock, the lens) and the air's pass (the lamp's light in the smoke, painted into its own
 * target). Both are built through three's own node builders against a stub renderer: the WGSL one
 * of the WebGPU backend and the GLSL one of the WebGL2 fallback, at High, Low and Minimal (each
 * tier leaves out different reads and walks). A graph one builder cannot turn into a shader throws
 * or warns here instead of leaving the theme black on someone's machine.
 *
 * Also gated: a var read where no assignment has certainly run (both shaders branch a great deal:
 * the walk to the lighthouse, the sea and its shadow, the sky's galaxy), a texture or sampler a
 * WGSL stage reads but never declares, a smoothstep whose two edges are the same constant, a
 * NaN/Infinity literal, a stringified node, MaterialX noise, a stage over its size budget, and
 * that the lighthouse's distance field is ONE shader function, called by the walk and the normal.
 * The WGSL and GLSL are not compiled here.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { CosmicNoirWorld, REST_RIG, fovForAspect } from '../../src/themes/cosmic-noir/cosmic-noir-world.js';
import { fallbackLayout } from '../../src/themes/cosmic-noir/cosmic-noir-composition.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Low', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** Bytes a stage may take: about twice the largest (the backdrop's fragment at High) when written. */
const STAGE_BUDGET = 112 * 1024;

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
        getDrawingBufferSize: (t) => t.set(1280, 720),
        getSize: (t) => t.set(1280, 720),
        getPixelRatio: () => 1,
        _bindings: { getSharedBindGroup: (group) => group },
    };
}

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

/** smoothstep() calls whose two edges are the same constant: a hard error in WGSL. */
function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

/** Texture and sampler bindings a WGSL stage reads but never declares. */
function undeclaredBindings(wgsl) {
    const pattern = /\bnodeUniform\d+_sampler\b|\bnodeUniform\d+(?=\s*,\s*nodeUniform\d+_sampler)/g;
    const used = new Set(wgsl.match(pattern) || []);
    return [...used].filter((name) => !new RegExp(`\\b${name}\\s*:`).test(wgsl));
}

/**
 * Reads of a WGSL `nodeVarN` where no assignment has certainly run: one in both arms of an
 * if/else counts, one in a lone `if` or a loop does not.
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
        } else if (/^\}\s*else\s+if\s*\(.*\)\s*\{$/.test(line)) {
            // A chain of else-ifs: what one arm alone assigns is not certain after it.
            stack.pop();
            check(line);
            stack.push({ kind: 'if', set: new Set() });
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
        if (/\bNaN\b|\bInfinity\b/.test(code)) problems.push(`${name}, ${label} ${stage}: a NaN or Infinity literal`);
        if (/object Object/.test(code)) problems.push(`${name}, ${label} ${stage}: a node was stringified`);
        if (label === 'WGSL') {
            undeclaredBindings(code).forEach((binding) => {
                problems.push(`${name}, WGSL ${stage}: ${binding} is read but not declared`);
            });
            unassignedReads(code).forEach((read) => problems.push(`${name}, WGSL ${stage}: unassigned ${read}`));
        }
    }
    if (/mx_\w+/.test(`${out.vertex}${out.fragment}`)) problems.push(`${name}, ${label}: MaterialX noise`);
    return problems;
}

describe.each(TIERS)('cosmic noir shaders at %s', (quality) => {
    let world;
    const built = [];

    beforeAll(() => {
        const scene = new THREE.Scene();
        const aspect = 16 / 9;
        const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
        world = new CosmicNoirWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1280, 720, aspect);
        world.setLayout(fallbackLayout(1280, 720), aspect);
        world.seek(14);
        const sim = {
            time: 14, delta: 0, pointerX: 0, pointerY: 0,
        };
        world.updateCamera(camera, sim);
        world.update(sim, camera);

        // The backdrop is in the scene; the air's pass is drawn by its own quad.
        const targets = [
            ['backdrop', world.smoke.mesh, world.smoke.mesh.material],
            ['air', world.smoke.pass.quad, world.smoke.pass.material],
        ];
        targets.forEach(([name, object, material]) => {
            BACKENDS.forEach(([label, Builder]) => {
                const [out, heard] = listening(() => build(Builder, object, material, camera));
                built.push({
                    name, label, out, heard,
                });
            });
        });
    });

    afterAll(() => world?.dispose());

    it('builds the backdrop and the air on both backends without a warning, an undeclared binding or an unassigned read', () => {
        expect(built).toHaveLength(4);
        if (process.env.CN_SHADER_SIZES) {
            // eslint-disable-next-line no-console
            console.log(quality, built.map((b) => `${b.name} ${b.label} ${(Buffer.byteLength(b.out.fragment || '') / 1024).toFixed(1)} KiB`).join(', '));
        }
        expect(built.flatMap(problemsOf)).toEqual([]);
    });

    it('emits the lighthouse\'s distance field once, and calls it from the walk and the normal', () => {
        const backdrop = built.find((b) => b.name === 'backdrop' && b.label === 'WGSL').out.fragment;
        expect((backdrop.match(/\bfn cn_towerField\s*\(/g) || [])).toHaveLength(1);
        // The walk, the point it found, and four reads for the normal.
        expect((backdrop.match(/\bcn_towerField\s*\(/g) || []).length - 1).toBeGreaterThanOrEqual(6);
        // The air never walks it: it stops at a cylinder and a ball.
        const air = built.find((b) => b.name === 'air' && b.label === 'WGSL').out.fragment;
        expect(air).not.toMatch(/cn_towerField/);
    });

    it('sees the trap it gates: a var assigned in one branch and read after it', () => {
        expect(unassignedReads([
            'fn main() {', 'if ( c ) {', 'nodeVar1 = 1.0;', '} else {', 'nodeVar2 = 0.0;', '}',
            'nodeVar3 = nodeVar1;', '}',
        ].join('\n'))).toHaveLength(1);
    });
});
