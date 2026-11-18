/**
 * Sakura Twilight shader gate — no GPU needed.
 *
 * The sky dome (the vault, its banks of moonlit cloud, the mackerel field, the river of heaven
 * and the moon), what the mountain wears (its sea of cloud, its cap and its banner), every
 * showpiece (the crown of spray, the helix, the blizzard, the gate's light and glow, the star
 * fox) and the rest of the garden that can be built without a device are turned into shaders by
 * three's own node builders against a stub renderer: the WGSL one the WebGPU backend uses and the
 * GLSL one of the WebGL2 fallback, at High and at Minimal. The garden is the real one, built from
 * the artwork on disk and found by walking the scene, so a part added later is gated too.
 *
 * A graph one builder cannot turn into a shader throws or warns here instead of leaving a part
 * undrawn on someone's machine. Also gated: a NaN, Infinity or undefined literal, a stringified
 * node, a var read where no assignment has certainly run, a texture a WGSL stage reads but never
 * declares, a smoothstep whose two edges are the same constant, MaterialX noise, a texture read
 * that picks its own level inside a branch that differs from pixel to pixel (an error in WGSL),
 * and a stage that has grown past its budget.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, the driver), so a shader the
 * browser rejects can still pass; the playground captures are the check for that. And the parts
 * that read the moon's shadow map are not built here at all — the ground, the grass, bark and
 * blossom, everything people made (the torii and its ember among them), the far-shore trees, the
 * fox, the lake and the petals in the air: the stub renderer has no shadow pass to give them
 * ("expected a float"). The torii's ember is built on a stand-in without the shadow read.
 */
import { readFileSync } from 'node:fs';
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    SAKURA_TREE_URLS, disposeSakuraAssets, loadSakuraAssets,
} from '../../src/themes/sakura-twilight/sakura-assets.js';
import { SakuraBackdrop } from '../../src/themes/sakura-twilight/sakura-backdrop.js';
import { SakuraLight } from '../../src/themes/sakura-twilight/sakura-light.js';
import { createSakuraPropMaterial } from '../../src/themes/sakura-twilight/sakura-prop-material.js';
import { sakuraTier } from '../../src/themes/sakura-twilight/sakura-quality.js';
import { SakuraShowpieces } from '../../src/themes/sakura-twilight/sakura-showpieces.js';
import { SakuraSky } from '../../src/themes/sakura-twilight/sakura-sky.js';
import { SakuraWorld } from '../../src/themes/sakura-twilight/sakura-world.js';
import { hasMaterialXNoise } from './helpers/materialx-noise.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

vi.setConfig({ testTimeout: 120_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** Nothing in the garden is larger than the sky; a stage past this was unrolled in JavaScript. */
const STAGE_BUDGET = 32 * 1024;
/**
 * The parts this pass made or reworked, each with room to grow by about half (bytes of WGSL or
 * GLSL in a stage). The dome's fragment is 18 KB today: it is shaded at every pixel of the sky.
 */
const BUDGETS = Object.freeze({
    SakuraSkyDome: { vertex: 4 * 1024, fragment: 28 * 1024 },
    SakuraMountainCloud: { vertex: 4 * 1024, fragment: 10 * 1024 },
    SakuraSplash: { vertex: 8 * 1024, fragment: 4 * 1024 },
    SakuraHelix: { vertex: 8 * 1024, fragment: 4 * 1024 },
    SakuraPetalBlizzard: { vertex: 8 * 1024, fragment: 6 * 1024 },
    SakuraGateLight: { vertex: 4 * 1024, fragment: 4 * 1024 },
    SakuraGateGlow: { vertex: 4 * 1024, fragment: 3 * 1024 },
    SakuraStarFox: { vertex: 8 * 1024, fragment: 4 * 1024 },
    SakuraFireflies: { vertex: 8 * 1024, fragment: 4 * 1024 },
});
/** What reads the moon's shadow map: not buildable without a device (see the header). */
const SHADOW_READERS = new RegExp(`^Sakura(${['Ground', 'FarShoreTrees', 'Bark ', 'Blossom ', 'Garden ', 'SpringGrass',
    'FallenBlossom', 'Fox(_\\d+)?$', 'FoxFur ', 'Lake', 'PetalsInTheAir'].join('|')})`);
/** What must be among the parts that were built, at every tier. */
const GATED = ['SakuraSkyDome', 'SakuraConstellationLines', 'SakuraConstellationStars', 'SakuraMountain',
    'SakuraMountainCloud', 'SakuraHills', 'SakuraMistBank 0', 'SakuraFireflies', 'SakuraFoxfire',
    'SakuraLanternsAfloat', 'SakuraLanternsAfloatGlow', 'SakuraSkyLanterns', 'SakuraSkyLanternGlow',
    'SakuraPetalFlashes', 'SakuraSplash', 'SakuraHelix', 'SakuraPetalBlizzard', 'SakuraGateLight', 'SakuraGateGlow',
    'SakuraStarFox'];

const assetDirectory = new URL('../../src/themes/sakura-twilight/assets/', import.meta.url);
const files = new Map();

function seededRandom(seed = 187) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

async function parseGlb(url) {
    const file = decodeURIComponent(new URL(url).pathname.split('/').pop());
    if (!files.has(file)) {
        const bytes = readFileSync(new URL(file, assetDirectory));
        files.set(file, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    return new GLTFLoader().parseAsync(files.get(file).slice(0), '');
}

/** smoothstep() calls whose two edges are the same constant: a hard error in WGSL. */
function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((match) => Number(match[1]) === Number(match[2])).map((match) => match[0]);
}

/** Texture and sampler bindings a WGSL stage reads but never declares. */
function undeclaredBindings(wgsl) {
    const pattern = /\bnodeUniform\d+_sampler\b|\bnodeUniform\d+(?=\s*,\s*nodeUniform\d+_sampler)/g;
    const used = new Set(wgsl.match(pattern) || []);
    return [...used].filter((name) => !new RegExp(`\\b${name}\\s*:`).test(wgsl));
}

/**
 * Texture reads that pick their own level (`textureSample`, `textureSampleBias`) inside an `if`
 * whose condition is not made of uniforms and numbers alone. Such a branch differs from pixel to
 * pixel, and WGSL refuses a derivative there; a read with an explicit level is fine, and so is
 * any read under a condition every pixel of a draw agrees on.
 */
const PER_PIXEL = /\bnodeVar\d+|\bnodeVarying\d+|\bv_\w+|\bnodeConst\d+/;

function impliedLevelInBranch(wgsl) {
    const found = [];
    const stack = [];
    wgsl.split('\n').forEach((raw, index) => {
        const line = raw.trim();
        const opened = line.match(/^(?:\}\s*else\s*)?if\s*\((.*)\)\s*\{$/);
        if (/^\}\s*else\s*(?:if\b.*)?\{$/.test(line)) {
            // (The other arm of a branch is as per-pixel as the branch.)
            const branch = stack.pop();
            stack.push({ perPixel: (branch?.perPixel ?? false) || PER_PIXEL.test(opened ? opened[1] : '') });
            return;
        }
        if (opened) {
            stack.push({ perPixel: PER_PIXEL.test(opened[1]) });
            return;
        }
        if (/^(?:for\s*\(.*\)|loop|switch\s*\(.*\))\s*\{$/.test(line)) {
            stack.push({ perPixel: false });
            return;
        }
        if (line === '}' && stack.length) {
            stack.pop();
            return;
        }
        if (stack.some((block) => block.perPixel) && /\btextureSample(?:Bias|Compare)?\s*\(/.test(line)) {
            found.push(`line ${index + 1}: ${line.slice(0, 110)}`);
        }
    });
    return found;
}

/** Everything wrong with one material's build on one backend, as readable messages. */
function problemsOf({
    name, label, out,
}) {
    if (out.thrown) return [`${name}, ${label} threw: ${out.thrown?.stack?.split('\n').slice(0, 4).join(' | ')}`];
    const problems = out.heard.map((said) => `${name}, ${label} said: ${said}`);
    for (const stage of ['vertex', 'fragment']) {
        const code = out[stage];
        if (typeof code !== 'string' || code.length < 200) {
            problems.push(`${name}, ${label}: no ${stage} stage`);
            continue;
        }
        const bytes = Buffer.byteLength(code);
        const budget = BUDGETS[name]?.[stage] ?? STAGE_BUDGET;
        if (bytes >= budget) problems.push(`${name}, ${label} ${stage}: ${bytes} B, over its ${budget} B`);
        equalEdges(code).forEach((call) => problems.push(`${name}, ${label} ${stage}: equal edges in ${call}`));
        if (/\bNaN\b|\bInfinity\b/.test(code)) problems.push(`${name}, ${label} ${stage}: a NaN or Infinity literal`);
        if (/\bundefined\b/.test(code)) problems.push(`${name}, ${label} ${stage}: an undefined in the code`);
        if (/object Object/.test(code)) problems.push(`${name}, ${label} ${stage}: a node was stringified`);
        if (label === 'WGSL') {
            undeclaredBindings(code).forEach((binding) => {
                problems.push(`${name}, WGSL ${stage}: ${binding} is read but not declared`);
            });
            unassignedReads(code).forEach((read) => problems.push(`${name}, WGSL ${stage}: unassigned ${read}`));
            impliedLevelInBranch(code).forEach((read) => {
                problems.push(`${name}, WGSL ${stage}: a texture read picks its level in a per-pixel branch, ${read}`);
            });
        }
    }
    if (hasMaterialXNoise(`${out.vertex}${out.fragment}`)) problems.push(`${name}, ${label}: MaterialX noise`);
    return problems;
}

const reads = (code, pattern) => (code.match(pattern) || []).length;

let assets;

beforeAll(async () => {
    // The fox carries a texture; in Node the loader needs somewhere to decode it to.
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 4, height: 4, close() {} }));
    assets = await loadSakuraAssets({
        trees: Object.keys(SAKURA_TREE_URLS),
        loader: { loadAsync: parseGlb },
        textureLoader: { loadAsync: async () => new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4) },
    });
});

afterAll(() => {
    disposeSakuraAssets(assets);
    vi.unstubAllGlobals();
});

describe.each(TIERS)('Sakura shaders at %s', (quality) => {
    let world;
    const built = [];
    const skipped = [];

    beforeAll(() => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 4000);
        world = new SakuraWorld({
            scene, camera, quality, rng: seededRandom(187), assets,
        }).build();
        // A frame in play, under a mackerel sky (what a uniform holds does not change the shader;
        // this is only so the garden that is built is one that has run).
        world.pinWeather('mackerel');
        world.update(14, 1 / 60, { blizzard: 1, corona: 1 });
        const targets = new Map();
        world.group.traverse((object) => {
            if (!object.material) return;
            // One build a material: the meshes that share one are built once.
            if (!targets.has(object.material)) targets.set(object.material, object);
        });
        targets.forEach((object) => {
            if (SHADOW_READERS.test(object.name)) {
                skipped.push(object.name);
                return;
            }
            BACKENDS.forEach(([label, Builder]) => {
                built.push({ name: object.name, label, out: build(Builder, object) });
            });
        });
    });

    afterAll(() => world?.dispose());

    it('builds every part that needs no shadow map, on both backends, without a word', () => {
        const names = new Set(built.map((entry) => entry.name));
        for (const name of GATED) expect(names.has(name), name).toBe(true);
        for (const name of names) expect(built.filter((entry) => entry.name === name), name).toHaveLength(2);
        expect(built.length).toBeGreaterThanOrEqual(GATED.length * 2);
        expect(built.flatMap(problemsOf)).toEqual([]);
    });

    it('leaves out only what reads the moon\'s shadow map', () => {
        // (Named, not guessed: a part that fails to build for any other reason is a failure above.)
        const kinds = new Set(skipped.map((name) => name.replace(/ .*$/, '').replace(/_\d+$/, '')));
        expect([...kinds].sort()).toEqual([
            'SakuraBark', 'SakuraBlossom', 'SakuraFallenBlossom', 'SakuraFarShoreTrees', 'SakuraFox',
            ...(world.foxes.shells > 0 ? ['SakuraFoxFur'] : []), 'SakuraGarden', 'SakuraGround', 'SakuraLake',
            'SakuraPetalsInTheAir', 'SakuraSpringGrass',
        ]);
        for (const name of GATED) expect(SHADOW_READERS.test(name), name).toBe(false);
    });

    it('keeps the sky inside what an integrated GPU can pay for at every pixel of it', () => {
        const dome = built.find((entry) => entry.name === 'SakuraSkyDome' && entry.label === 'WGSL').out.fragment;
        // The mackerel field, the river of heaven and the moon's seas are each read only where
        // they show: three branches, and no more reads outside them than the banks need.
        const branches = dome.split('\n').filter((line) => /^\s*if\s*\(/.test(line));
        expect(branches).toHaveLength(3);
        // Two of them are the air's and the hour's (every pixel agrees); the moon's is per pixel.
        expect(branches.filter((line) => !/nodeVar\d+/.test(line))).toHaveLength(2);
        const all = reads(dome, /\btextureSample(?:Level)?\s*\(/g);
        const levelled = reads(dome, /\btextureSampleLevel\s*\(/g);
        expect(all).toBeLessThanOrEqual(12);
        // The moon's five are the ones with a level of their own (a broad one that pulls the seas'
        // place about, so they do not break along the noise's grid; two for the seas; two for craters).
        expect(levelled).toBe(5);
        let depth = 0;
        let outside = 0;
        for (const line of dome.split('\n')) {
            if (/^\s*if\s*\(.*\{\s*$/.test(line)) depth += 1;
            else if (/^\s*\}\s*$/.test(line) && depth > 0) depth -= 1;
            else if (depth === 0 && /\btextureSample\s*\(/.test(line)) outside += 1;
        }
        expect(outside).toBeLessThanOrEqual(5);
        // The GLSL of the fallback is the same sky, to within a fifth.
        const glsl = built.find((entry) => entry.name === 'SakuraSkyDome' && entry.label === 'GLSL').out.fragment;
        expect(Math.abs(glsl.length - dome.length)).toBeLessThan(dome.length * 0.2);
        expect(reads(glsl, /\btexture(?:Lod)?\s*\(/g)).toBe(all);
        // The moon's corona: a back-to-back opens it 2.7 times over (it was 3.4, and pinned the sky
        // pale), a veil of cloud 1.6 times, over a rest of 0.45.
        const corona = /nodeUniform\d+ \* 2\.7 \) \+ \( (?:object\.)?nodeUniform\d+ \* 1\.6 \) \) \+ 0\.45/;
        expect(dome).toMatch(corona);
        expect(glsl).toMatch(corona);
        expect(dome).not.toMatch(/\* 3\.4 \)/);
    });

    it('crosses the ground and the grass with the ring\'s crest, not its skirts', () => {
        // Both read the moon's shadow map, so neither is a whole shader here (each says so, and
        // nothing else); their text is still written, and what they make of a ring is in it: the
        // band squared, times 1.6. The band itself laid a pale veil over the grass under fast play.
        const crest = /\( \( (nodeVar(?:ying)?\d+(?:\.x)?) \* \1 \) \* 1\.6 \)/;
        for (const name of ['SakuraGround', 'SakuraSpringGrass']) {
            let mesh = null;
            world.group.traverse((object) => { if (object.name === name) mesh = object; });
            expect(mesh, name).toBeTruthy();
            for (const [label, Builder] of BACKENDS) {
                const out = build(Builder, mesh);
                expect(out.thrown, `${name}, ${label}`).toBeUndefined();
                expect(out.heard.length, `${name}, ${label}`).toBeGreaterThan(0);
                for (const said of out.heard) expect(said, `${name}, ${label}`).toMatch(/expected a "float"/);
                expect(out.fragment, `${name}, ${label}`).toMatch(crest);
            }
        }
    });

    it('reads the mountain\'s cloud twice for both of its cards, with no branch between them', () => {
        const cloud = built.find((entry) => entry.name === 'SakuraMountainCloud' && entry.label === 'WGSL').out;
        expect(reads(cloud.fragment, /\btextureSample(?:Level)?\s*\(/g)).toBe(2);
        expect(cloud.fragment.split('\n').filter((line) => /^\s*if\s*\(/.test(line))).toEqual([]);
        // Which card a fragment is on comes down from the vertex stage.
        expect(cloud.vertex).toMatch(/sakuraCloud/);
    });

    it('draws the showpieces from numbers alone: no texture but the gate\'s climbing light', () => {
        const wgsl = (name) => built.find((entry) => entry.name === name && entry.label === 'WGSL').out;
        for (const name of ['SakuraSplash', 'SakuraHelix', 'SakuraStarFox', 'SakuraGateGlow']) {
            expect(reads(wgsl(name).fragment, /\btextureSample\w*\s*\(/g), name).toBe(0);
            expect(reads(wgsl(name).vertex, /\btextureSample\w*\s*\(/g), name).toBe(0);
        }
        expect(reads(wgsl('SakuraGateLight').fragment, /\btextureSample\w*\s*\(/g)).toBe(1);
        // The blizzard is lit without the shadow map and without a texture.
        expect(reads(wgsl('SakuraPetalBlizzard').fragment, /\btextureSample\w*\s*\(/g)).toBe(0);
        // Each slot's numbers reach the vertex stage as a uniform array.
        expect(wgsl('SakuraSplash').vertex).toMatch(/array<\s*vec4<f32>\s*,\s*6\s*>/);
        expect(wgsl('SakuraHelix').vertex).toMatch(/array<\s*vec4<f32>\s*,\s*3\s*>/);
    });
});

describe('Sakura shaders by themselves', () => {
    function rig(quality = 'High') {
        const tier = sakuraTier(quality);
        // (One lantern, so the lamps' loop is in the graph as it is in the garden.)
        const lamp = {
            x: 0, y: 1, z: 0, power: 1,
        };
        const light = new SakuraLight({ tier, rng: seededRandom(1), lamps: [lamp] });
        return { tier, light };
    }

    it.each(BACKENDS)('builds the sky dome, the mountain\'s cloud and the showpieces alone to %s', (label, Builder) => {
        const { tier, light } = rig();
        const sky = new SakuraSky({ light, tier, rng: seededRandom(2) }).build();
        const backdrop = new SakuraBackdrop({
            light, fuji: null, impostors: null, tier, rng: seededRandom(3),
        });
        backdrop.buildMountainCloud();
        const petal = new THREE.PlaneGeometry(1, 1);
        const show = new SakuraShowpieces({
            light, tier, blossoms: { meshes: { petal_far: petal } },
        }).build();
        const meshes = [sky.dome, backdrop.group.children[0], ...show.group.children];
        expect(meshes.map((mesh) => mesh.name)).toEqual(['SakuraSkyDome', 'SakuraMountainCloud', 'SakuraSplash',
            'SakuraHelix', 'SakuraPetalBlizzard', 'SakuraGateLight', 'SakuraGateGlow', 'SakuraStarFox']);
        const problems = meshes.flatMap((mesh) => problemsOf({ name: mesh.name, label, out: build(Builder, mesh) }));
        expect(problems).toEqual([]);
        show.dispose();
        backdrop.dispose();
        sky.dispose();
        petal.dispose();
        light.dispose();
    });

    it.each(BACKENDS)('builds the gate\'s ember on a stand-in that reads no shadow, to %s', (label, Builder) => {
        const { light } = rig();
        const show = new SakuraShowpieces({ light, tier: sakuraTier('High') });
        // (The pack's layout: colour = surface colour and occlusion, uv = glow weight and height.)
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const paint = new Float32Array(geometry.attributes.position.count * 4).fill(0.5);
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(paint, 4));
        const sizes = [null, show.uGate].map((node) => {
            const material = createSakuraPropMaterial(light, 'SakuraGarden torii', { shadowed: false, ember: node });
            const out = build(Builder, new THREE.Mesh(geometry, material));
            expect(problemsOf({ name: 'the torii (unshadowed)', label, out })).toEqual([]);
            material.dispose();
            return out.fragment.length;
        });
        // The ember is really in the shader when it is asked for, and costs little.
        expect(sizes[1]).toBeGreaterThan(sizes[0]);
        expect(sizes[1] - sizes[0]).toBeLessThan(1024);
        geometry.dispose();
        show.dispose();
        light.dispose();
    });

    it('sees the traps it gates', () => {
        expect(unassignedReads([
            'fn main() {', 'if ( c ) {', 'nodeVar1 = 1.0;', '} else {', 'nodeVar2 = 0.0;', '}',
            'nodeVar3 = nodeVar1;', '}',
        ].join('\n'))).toHaveLength(1);
        expect(equalEdges('x = smoothstep( 0.5, 0.5, y ) + smoothstep( 0.0, 1.0, y );')).toHaveLength(1);
        // A read that picks its own level inside a branch on a per-pixel value is caught...
        const perPixel = ['fn main() {', 'if ( ( nodeVar4 < 1.0 ) ) {',
            'nodeVar5 = textureSample( nodeUniform1, nodeUniform1_sampler, uv );', '}', '}'].join('\n');
        expect(impliedLevelInBranch(perPixel)).toHaveLength(1);
        // ...one with an explicit level is not, nor one under a condition every pixel agrees on.
        expect(impliedLevelInBranch(perPixel.replace('textureSample(', 'textureSampleLevel('))).toEqual([]);
        expect(impliedLevelInBranch(perPixel.replace('nodeVar4', 'object.nodeUniform7'))).toEqual([]);
        // A branch nested in a per-pixel one is per-pixel too.
        const nested = ['fn main() {', 'if ( ( nodeVar4 < 1.0 ) ) {', 'if ( ( object.nodeUniform7 > 0.0 ) ) {',
            'nodeVar5 = textureSample( nodeUniform1, nodeUniform1_sampler, uv );', '}', '}', '}'].join('\n');
        expect(impliedLevelInBranch(nested)).toHaveLength(1);
        expect(undeclaredBindings('x = textureSample( nodeUniform3, nodeUniform3_sampler, uv );')).toHaveLength(2);
        expect(SHADOW_READERS.test('SakuraGarden torii')).toBe(true);
        expect(SHADOW_READERS.test('SakuraFoxShade 0')).toBe(false);
        expect(SHADOW_READERS.test('SakuraFoxfire')).toBe(false);
        expect(SHADOW_READERS.test('SakuraFox_1')).toBe(true);
    });
});
