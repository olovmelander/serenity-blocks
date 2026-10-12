/** Both node builders must accept the complete sky, including the nine reserved record plates. */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context, uniform } from 'three/tsl';
import { createSky } from '../../src/themes/painted-ages/painted-ages-sky.js';
import { createLand } from '../../src/themes/painted-ages/painted-ages-land.js';
import { createPaintedAgesUniforms } from '../../src/themes/painted-ages/painted-ages-tsl.js';
import { QUALITY, tierFor } from '../../src/themes/painted-ages/painted-ages-quality.js';
import { BLOOM_THRESHOLD, PaintedAgesPost, POST_LOOK } from '../../src/themes/painted-ages/painted-ages-post.js';

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
        getOutputBufferType: () => THREE.HalfFloatType,
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

function uniforms() {
    const u = Object.assign(createPaintedAgesUniforms(), Object.fromEntries(Object.entries({
        time: 40,
        aspect: 16 / 9,
        tanHalfFov: Math.tan((42 * Math.PI) / 360),
        sunElevation: 17,
        sunAzimuth: 115,
        wetGlobal: 0.8,
        wetZones: 7,
        curtainEdge: 7,
        releasePeak: 8,
        bow: 1,
        perfect: 1,
        perfectAge: 4,
        gameOver: 0,
        recordHead: 0,
        reducedMotion: 0,
    }).map(([name, value]) => [name, uniform(value)])));
    u.eye = uniform(new THREE.Vector3(0, 140, 200));
    u.camRight = uniform(new THREE.Vector3(1, 0, 0));
    u.camUp = uniform(new THREE.Vector3(0, 1, 0));
    u.camForward = uniform(new THREE.Vector3(0, -0.1, -1).normalize());
    u.sunDir = uniform(new THREE.Vector3(-0.866, 0.3, 0.4).normalize());
    u.resolution = uniform(new THREE.Vector2(1920, 1080));
    return u;
}

describe.each(['Minimal', 'High', 'Extreme'])('Painted Ages sky at %s', (quality) => {
    it.each([['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]])('builds %s', (label, Builder) => {
        const recordTexture = new THREE.DataTexture(new Uint8Array(16 * 512 * 4), 16, 512, THREE.RGBAFormat);
        const sky = createSky({ u: uniforms(), tier: tierFor(quality), recordTexture });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const builder = new Builder(sky.mesh, stubRenderer());
            builder.scene = new THREE.Scene();
            builder.camera = new THREE.PerspectiveCamera();
            builder.context.material = sky.material;
            builder.material = sky.material;
            builder.build();
            expect(warn.mock.calls, label).toEqual([]);
            expect(error.mock.calls, label).toEqual([]);
            for (const shader of [builder.vertexShader, builder.fragmentShader]) {
                expect(shader.length).toBeGreaterThan(200);
                expect(shader.length).toBeLessThan(96 * 1024);
                expect(shader).not.toMatch(/\bNaN\b|\bInfinity\b|mx_\w+/);
                const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
                const edgesPattern = new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g');
                const equalEdges = [...shader.matchAll(edgesPattern)]
                    .filter((match) => Number(match[1]) === Number(match[2]));
                expect(equalEdges).toEqual([]);
            }
            if (label === 'WGSL') {
                const helperPattern = /^fn (paSky_\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)^\}/gm;
                for (const match of builder.fragmentShader.matchAll(helperPattern)) {
                    expect(match[2], match[1]).not.toMatch(/nodeUniform\d+|NodeBuffer_\w+|texture\w*\(/);
                }
            }
            expect(sky.mesh.renderOrder).toBe(50);
            expect(sky.material.depthTest).toBe(true);
            expect(sky.material.depthWrite).toBe(false);
        } finally {
            warn.mockRestore();
            error.mockRestore();
            sky.dispose();
            recordTexture.dispose();
        }
    });
});

describe.each(['Minimal', 'High'])('Painted Ages post at %s', (quality) => {
    it.each([['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]])(
        'builds the single output pass on %s without invalid arithmetic',
        (label, Builder) => {
            const renderer = stubRenderer();
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera();
            const post = new PaintedAgesPost(renderer, scene, camera, { look: POST_LOOK[quality] });
            const material = new THREE.NodeMaterial();
            material.fragmentNode = post.pipeline.outputNode;
            const mesh = new THREE.QuadMesh(material);
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const error = vi.spyOn(console, 'error').mockImplementation(() => {});
            try {
                const builder = new Builder(mesh, renderer);
                builder.scene = scene;
                builder.camera = camera;
                builder.material = material;
                builder.context.material = material;
                builder.build();
                expect(warn.mock.calls, label).toEqual([]);
                expect(error.mock.calls, label).toEqual([]);
                expect(builder.fragmentShader).not.toMatch(/\bNaN\b|\bInfinity\b/);
                // Three's builder emits laid-out helper argument names verbatim. `input`
                // and `output` are reserved by GLSL even though the JS graph accepts them.
                if (label === 'GLSL') {
                    const reservedName = /\b(?:float|int|bool|vec[234]|mat[234])\s+(?:input|output)\b/;
                    expect(builder.fragmentShader).not.toMatch(reservedName);
                }
                expect(builder.fragmentShader.length).toBeLessThan(96 * 1024);
            } finally {
                warn.mockRestore();
                error.mockRestore();
                post.dispose();
                material.dispose();
            }
        },
    );
});

describe('Painted Ages wet strata and deposition shaders', () => {
    it.each([['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]])('builds %s', (label, Builder) => {
        const u = uniforms();
        u.wetAge.value = 35;
        u.depositBlend.value = 1.4;
        u.datum.value = -0.03;
        const recordTexture = new THREE.DataTexture(new Uint8Array(16 * 512 * 4), 16, 512, THREE.RGBAFormat);
        const bake = {
            positions: new Float32Array([-1, 0, -1, 1, 0, -1, 0, 0, 1]),
            normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
            uvs: new Float32Array([0, 0, 1, 0, 0.5, 1]),
            surface: new Float32Array(12),
            horizon: new Float32Array(3),
            indices: new Uint16Array([0, 1, 2]),
            heightAt: () => 0,
            diagnostics: { seed: 1 },
        };
        const land = createLand({
            u, tier: tierFor('High'), bake, recordTexture,
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const builder = new Builder(land.mesh, stubRenderer());
            builder.scene = new THREE.Scene();
            builder.camera = new THREE.PerspectiveCamera();
            builder.material = land.material;
            builder.context.material = land.material;
            builder.build();
            expect(warn.mock.calls, label).toEqual([]);
            expect(error.mock.calls, label).toEqual([]);
            expect(builder.fragmentShader).not.toMatch(/\bNaN\b|\bInfinity\b/);
            expect(builder.fragmentShader.length).toBeLessThan(96 * 1024);
        } finally {
            warn.mockRestore();
            error.mockRestore();
            land.dispose();
            recordTexture.dispose();
        }
    });
});

describe('Painted Ages tier continuity', () => {
    it('keeps plates, steam, all water events and a pixel cap at every tier', () => {
        expect(Object.values(QUALITY).map((tier) => tier.lenticularPlates)).toEqual([2, 3, 4, 5, 6, 7]);
        expect(Object.values(QUALITY).map((tier) => tier.pixelRatioCap)).toEqual([0.7, 0.85, 1, 1.15, 1.35, 1.6]);
        Object.values(QUALITY).forEach((tier) => {
            expect(tier.steamSheets).toBeGreaterThanOrEqual(2);
            expect(tier.floodChannels).toBeGreaterThanOrEqual(6);
            expect(tier.meltwaterChannels).toBeGreaterThanOrEqual(3);
            expect(tier.waterfalls).toBeGreaterThanOrEqual(1);
        });
    });

    it('reserves bloom for glints and enables extra bow fringes only at High and above', () => {
        expect(BLOOM_THRESHOLD).toBeGreaterThan(1.2);
        expect(POST_LOOK.Minimal.bloom).toBe(false);
        expect(POST_LOOK.Low.bloom).toBe(false);
        expect(POST_LOOK.Medium.bloom).toBe(true);
        expect(QUALITY.Medium.supernumeraries).toBe(false);
        expect(QUALITY.High.supernumeraries).toBe(true);
    });
});
