/**
 * Parhelion WGSL size gate (spec §12, perf risk 9) — no GPU needed.
 *
 * The dome is the theme's one fullscreen shader and its compile time is the theme's cold-start
 * budget. It stays fast only while:
 *   1. it never touches three's MaterialX noise (`mx_*`: integer-hash Perlin, superlinear DXC
 *      compile — the 7.3 s lava lake);
 *   2. every shared helper is a setLayout'd Fn, emitted ONCE as a real WGSL `fn` (a layout-less
 *      Fn re-inlines its body at every call site);
 *   3. the reaction-arc loop is a single TSL Loop (one WGSL `for`), not a JS-unrolled chain;
 *   4. the fragment stays under 15 KB with ≤ 3 value-noise evaluations at High.
 *
 * The build goes through three's own WGSLNodeBuilder against a stub renderer — the harness from
 * tests/unit/odyssey-tsl-noise-emission.test.js.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import {
    createDomeMaterial,
    createSharedUniforms,
    createSnowMaterial,
    createStoneMaterial,
} from '../../src/playground/effects/parhelion-materials.js';
import * as optics from '../../src/playground/effects/parhelion-optics.js';
import { buildStoneGeometry } from '../../src/playground/effects/parhelion-geometry.js';
import {
    buildDustSprite,
    buildGlintSprite,
    buildPillarGeometry,
    createBurstUniforms,
    createDustMaterial,
    createGlintMaterial,
    createPillarMaterial,
} from '../../src/playground/effects/parhelion-particles.js';

function buildShaders(material, object) {
    const mesh = object || new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    const renderer = {
        contextNode: context(),
        lighting: { enabled: false },
        backend: { device: null, capabilities: { getUniformBufferLimit: () => 65536 } },
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
    const builder = new THREE.WGSLNodeBuilder(mesh, renderer);
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = material;
    builder.material = material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

function buildFragment(material, geometry = new THREE.PlaneGeometry(1, 1)) {
    return buildShaders(material, new THREE.Mesh(geometry, material)).fragment;
}

const fnNames = (wgsl) => [...wgsl.matchAll(/^fn\s+(\w+)\s*\(/gm)].map((m) => m[1]);
// Call sites of `name(` minus its single definition.
const callCount = (wgsl, name) => (wgsl.match(new RegExp(`\\b${name}\\s*\\(`, 'g')) || []).length - 1;
const bytes = (text) => Buffer.byteLength(text, 'utf8');
/** §5.3: the dome fragment stays under 15 KB (KiB) with every helper a real fn. */
const DOME_WGSL_BUDGET = 15 * 1024;

const DOME_HELPERS = [
    'ph_prof', 'ph_spectral', 'ph_softCap', 'ph_calmBox', 'ph_laneW', 'ph_haze', 'ph_skyOut', 'ph_lens',
    'ph_halo', 'ph_haloTint', 'ph_dogs', 'ph_parhelic', 'ph_uta', 'ph_crown', 'ph_sunPillar', 'ph_lowitz',
    'ph_arcGlow', 'ph_ridge', 'od_noise2', 'od_hash21',
];

describe('parhelion dome WGSL size gate', () => {
    const u = createSharedUniforms();
    const wgsl = buildFragment(createDomeMaterial(u, 'High'), new THREE.SphereGeometry(1, 8, 4));
    const fns = fnNames(wgsl);

    it('emits every ph_* / od_noise2 helper as a real WGSL fn, each defined exactly once', () => {
        for (const name of DOME_HELPERS) {
            expect(fns, `${name} must be a real fn (setLayout)`).toContain(name);
            expect(wgsl.split(new RegExp(`fn\\s+${name}\\s*\\(`)).length - 1, `${name} defined once`).toBe(1);
        }
    });

    it('never uses MaterialX noise', () => {
        expect(wgsl).not.toMatch(/mx_/);
        expect(fns.some((name) => name.startsWith('mx_'))).toBe(false);
    });

    it('stays under 15 KB', () => {
        expect(bytes(wgsl)).toBeLessThan(DOME_WGSL_BUDGET);
    });

    it('spends at most 3 value-noise evaluations at High', () => {
        expect(callCount(wgsl, 'od_noise2')).toBeLessThanOrEqual(3);
    });

    it('emits the reaction-arc Loop body once (one WGSL for, one ph_arcGlow call)', () => {
        expect((wgsl.match(/\bfor\s*\(/g) || []).length).toBe(1);
        expect(callCount(wgsl, 'ph_arcGlow')).toBe(1);
    });

    it('calls each optic once from main (the halo display is not duplicated)', () => {
        for (const name of ['ph_halo', 'ph_dogs', 'ph_parhelic', 'ph_uta', 'ph_sunPillar', 'ph_crown', 'ph_lowitz']) {
            expect(callCount(wgsl, name), name).toBe(1);
        }
    });
});

describe('parhelion tiers shape the dome graph', () => {
    it('Minimal drops crown/Lowitz, uses one noise eval and tones in-material', () => {
        const wgsl = buildFragment(createDomeMaterial(createSharedUniforms(), 'Minimal'));
        const fns = fnNames(wgsl);
        expect(fns).not.toContain('ph_crown');
        expect(fns).not.toContain('ph_lowitz');
        expect(fns).toContain('ph_tone');
        expect(callCount(wgsl, 'od_noise2')).toBe(1);
    });

    it('Ultra adds the fourth noise eval and stays under 15 KB', () => {
        const wgsl = buildFragment(createDomeMaterial(createSharedUniforms(), 'Ultra'));
        expect(callCount(wgsl, 'od_noise2')).toBe(4);
        expect(bytes(wgsl)).toBeLessThan(DOME_WGSL_BUDGET);
    });
});

describe('parhelion stone / snow fragments', () => {
    it('snow fragment stays under 10 KB, no mx_, exactly 3 noise evals (macro, sastrugi, drift)', () => {
        const wgsl = buildFragment(createSnowMaterial(createSharedUniforms(), 'High'));
        expect(wgsl).not.toMatch(/mx_/);
        expect(bytes(wgsl)).toBeLessThan(10_000);
        expect(callCount(wgsl, 'od_noise2')).toBe(3);
        expect(fnNames(wgsl)).toContain('ph_softCap');
    });

    it('stone fragment: no mx_, one rime noise eval, under 8 KB', () => {
        const { geometry } = buildStoneGeometry();
        const wgsl = buildFragment(createStoneMaterial(createSharedUniforms(), 'High'), geometry);
        expect(wgsl).not.toMatch(/mx_/);
        expect(callCount(wgsl, 'od_noise2')).toBe(1);
        expect(bytes(wgsl)).toBeLessThan(8_000);
    });

    it('Minimal snow and stone drop to one noise eval and tone in-material', () => {
        const snow = buildFragment(createSnowMaterial(createSharedUniforms(), 'Minimal'));
        expect(callCount(snow, 'od_noise2')).toBe(1);
        expect(fnNames(snow)).toContain('ph_tone');
        const { geometry } = buildStoneGeometry();
        const stone = buildFragment(createStoneMaterial(createSharedUniforms(), 'Minimal'), geometry);
        expect(stone).not.toMatch(/od_noise2/);
    });
});

describe('parhelion optics helpers', () => {
    it('every exported TSL helper carries a layout (the inline-vs-function switch)', () => {
        const helpers = Object.entries(optics).filter(([name]) => name.startsWith('ph'));
        expect(helpers.length).toBeGreaterThanOrEqual(20);
        for (const [name, fn] of helpers) {
            expect(fn.shaderNode?.layout ?? fn.layout, `${name} without setLayout inlines at every call site`)
                .toBeTruthy();
        }
    });

    it('the CPU ridge mirror matches the shader formula shape (left ridge higher)', () => {
        const left = optics.ridgeHeightCpu(-0.5);
        const right = optics.ridgeHeightCpu(0.5);
        expect(left).toBeGreaterThan(0.005);
        expect(left).toBeLessThan(0.05);
        expect(right).toBeGreaterThan(0.004);
        // Asymmetry term: +0.010 rad on the left by az −0.55.
        let leftMean = 0;
        let rightMean = 0;
        for (let i = 0; i < 64; i++) {
            leftMean += optics.ridgeHeightCpu(-0.55 - i * 0.002) / 64;
            rightMean += optics.ridgeHeightCpu(0.55 + i * 0.002) / 64;
        }
        expect(leftMean).toBeGreaterThan(rightMean);
    });
});

describe('parhelion particles and pillars (§5.4–§5.6)', () => {
    const u = createSharedUniforms();
    const rng = () => 0.5;

    it('diamond dust: analytic vertex stage with ONE arc loop, no mx_, no noise', () => {
        const material = createDustMaterial(u);
        const { vertex, fragment } = buildShaders(material, buildDustSprite(material, { count: 16 }, rng));
        expect(vertex + fragment).not.toMatch(/mx_/);
        expect(vertex).not.toMatch(/od_noise2/);
        expect((vertex.match(/\bfor\s*\(/g) || []).length).toBe(1);
        expect(fnNames(vertex)).toContain('ph_calmBox');
        expect(bytes(vertex)).toBeLessThan(15_000);
    });

    it('glint pool: burst slots read from uniform arrays, zero instanced attributes', () => {
        const bursts = createBurstUniforms(8);
        const material = createGlintMaterial(u, bursts, 24);
        const sprite = buildGlintSprite(material, 8 * 24);
        const { vertex, fragment } = buildShaders(material, sprite);
        expect(vertex + fragment).not.toMatch(/mx_/);
        const { attributes } = sprite.geometry;
        const instanced = Object.keys(attributes).filter((k) => attributes[k].isInstancedBufferAttribute);
        expect(instanced).toEqual([]);
        expect(vertex).toMatch(/instance_index|gl_InstanceID|instanceIndex/);
    });

    it('hound pillars: one mesh, uniform-array lanes; glitter is the only noise (off at Minimal)', () => {
        const geometry = buildPillarGeometry(6);
        expect(geometry.index.count).toBe(36);
        const litMaterial = createPillarMaterial(u);
        const lit = buildShaders(litMaterial, new THREE.Mesh(geometry, litMaterial));
        expect(callCount(lit.fragment, 'od_noise2')).toBe(1);
        const plainMaterial = createPillarMaterial(u, { glitter: false });
        const plain = buildShaders(plainMaterial, new THREE.Mesh(geometry, plainMaterial));
        expect(plain.fragment).not.toMatch(/od_noise2/);
    });
});
