/**
 * The ascent sky's shader gate — no GPU needed.
 *
 * The sky (src/ui/infinity/ascent/ascent-sky-world.js) and the playground's stand-ins are built
 * through three's own node builders against a stub renderer: the WGSL one the WebGPU backend
 * uses and the GLSL one of the WebGL2 fallback, at every tier and both blend modes. A graph one
 * builder cannot write (a JS minus on a node prints NaN, a `+` between a number and a node prints
 * "[object Object]") throws, warns or shows here instead of leaving the sky undrawn.
 * What it cannot see: the shaders are not compiled (Tint, the driver). The harness is the one of
 * tests/unit/moonlit-greenhouse-shaders.test.js.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { AscentSkyWorld, SKY_TIERS } from '../../src/ui/infinity/ascent/ascent-sky-world.js';

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const STAGE_BUDGET = 64 * 1024;

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
        currentColorSpace: 'srgb-linear',
        outputColorSpace: 'srgb-linear',
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

function buildShaders(Builder, mesh) {
    const builder = new Builder(mesh, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.OrthographicCamera();
    builder.context.material = mesh.material;
    builder.material = mesh.material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

/** Build a mesh both ways, collecting what the builders said. */
function buildBoth(mesh) {
    const out = {};
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    BACKENDS.forEach(([label, Builder]) => {
        const heard = [];
        const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 300));
        warn.mockImplementation(listen);
        error.mockImplementation(listen);
        try {
            out[label] = { ...buildShaders(Builder, mesh), heard };
        } catch (thrown) {
            out[label] = { thrown, heard };
        }
    });
    warn.mockRestore();
    error.mockRestore();
    return out;
}

function expectClean(out, name) {
    BACKENDS.forEach(([label]) => {
        const built = out[label];
        expect(built.thrown, `${name}, ${label}: ${built.thrown?.stack ?? ''}`).toBeUndefined();
        expect(built.heard, `${name}, ${label}`).toEqual([]);
        ['vertex', 'fragment'].forEach((stage) => {
            expect(typeof built[stage], `${name}, ${label} ${stage}`).toBe('string');
            expect(Buffer.byteLength(built[stage]), `${name}, ${label} ${stage}`).toBeLessThan(STAGE_BUDGET);
            expect(equalEdges(built[stage]), `${name}, ${label} ${stage}`).toEqual([]);
            expect(built[stage], `${name}, ${label} ${stage}`).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
        });
    });
    expect(out.WGSL.fragment).toMatch(/@fragment/);
    expect(out.GLSL.fragment).toMatch(/void main\(\)/);
}

describe('the ascent sky', () => {
    it.each(Object.keys(SKY_TIERS).flatMap((tier) => [[tier, false], [tier, true]]))(
        'writes its one pass at %s (over: %s) for WebGPU and for the WebGL2 fallback',
        (tier, over) => {
            const scene = new THREE.Scene();
            const world = new AscentSkyWorld({ quality: tier, over }).build(scene);
            expectClean(buildBoth(world.mesh), `sky ${tier}`);
            // Its own canvas is written as it is; over a stand-in theme it composites.
            expect(world.material.blending).toBe(over ? THREE.CustomBlending : THREE.NoBlending);
            world.dispose();
        },
    );

    it('takes a theme\'s colours as display values (no conversion)', () => {
        const world = new AscentSkyWorld();
        world.setTints({ glow: [255, 128, 0] });
        expect(world.u.glow.value.r).toBeCloseTo(1, 5);
        expect(world.u.glow.value.g).toBeCloseTo(128 / 255, 5);
        // A tint left out keeps the default look.
        expect(world.u.night.value.b).toBeCloseTo(24 / 255, 5);
    });

    it('takes only finite state', () => {
        const world = new AscentSkyWorld();
        world.setState({ presence: 0.5, sky: Number.NaN, speed: 0.25 });
        expect(world.u.presence.value).toBe(0.5);
        expect(world.u.sky.value).toBe(0);
        expect(world.u.speed.value).toBe(0.25);
    });
});

describe('the playground effect', () => {
    it('builds its stand-in theme, its well and the sky without a word', async () => {
        const { create, meta } = await import('../../src/playground/effects/infinity-ascent.effect.js');
        expect(meta.id).toBe('infinity-ascent');
        const scene = new THREE.Scene();
        const renderer = { outputColorSpace: THREE.SRGBColorSpace, backend: { isWebGPUBackend: true } };
        const effect = create({
            scene, renderer, params: new URLSearchParams('ascentRise=-30&ascentSpeed=20'), sizes: { width: 1600, height: 900 },
        });
        expect(renderer.outputColorSpace).toBe(THREE.LinearSRGBColorSpace);
        effect.seek(3);
        const { state } = effect.getDiagnostics();
        expect(state.deep).toBeGreaterThan(0.2);
        expect(state.sky).toBe(0);
        expect(state.gapBottom).toBeGreaterThan(0);
        const meshes = [];
        scene.traverse((object) => { if (object.isMesh) meshes.push(object); });
        expect(meshes).toHaveLength(3);
        meshes.forEach((mesh, i) => expectClean(buildBoth(mesh), `playground mesh ${i}`));
        effect.dispose();
        expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
        expect(scene.children).toHaveLength(0);
    });
});
