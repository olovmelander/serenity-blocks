/**
 * Vesper Chrysalis — no stray texel can black out the frame.
 *
 * The screen flashed black over and over as the theme started (2026-10-25), and again in bursts
 * every half minute or so. One crystal pixel came out Inf. With MSAA a silhouette pixel is shaded
 * at its centre, which can lie off a facet seen edge-on; the distance to the facet's edges read
 * there runs far negative, and exp(-7 · distance) overflowed. The bloom's knee turned that texel
 * into NaN (Inf · 0), its blur chain carried it over most of its output, and the heart shafts took
 * it the rest of the way: black, then the scene, then black, as the camera's sway moved the pixel
 * on and off the facet.
 *
 * Pinned here, compiled for both backends: the crystals keep that falloff bounded, and the post
 * reads the scene finite (an Inf or NaN texel as black) in its output pass and in the bloom's
 * bright pass, so one bad texel from any part stays one pixel.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';

import { createVesperUniforms, planSpires } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-tsl.js';
import { createSpires } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-shore.js';
import { POST_LOOK, VesperPost } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-post.js';

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** A float's exponent bits (0x7f800000): all set for Inf and NaN. */
const EXPONENT_BITS = '2139095040u';

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
        getOutputBufferType: () => THREE.HalfFloatType,
        getColorBufferType: () => THREE.HalfFloatType,
    };
}

/** The fragment stage an object's material compiles to. */
function fragmentOf(Builder, object, material) {
    const builder = new Builder(object, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = material;
    builder.material = material;
    builder.build();
    return builder.fragmentShader;
}

/** A full-screen pass's fragment stage, for a node the post hands the renderer. */
function passFragment(Builder, node) {
    const material = new THREE.NodeMaterial();
    material.fragmentNode = node;
    return fragmentOf(Builder, new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material), material);
}

/** How often a function's name opens a parenthesis: its definition and every call. */
const mentions = (code, name) => (code.match(new RegExp(`\\b${name}\\s*\\(`, 'g')) || []).length;

function buildPost(quality) {
    const camera = new THREE.PerspectiveCamera();
    return new VesperPost(stubRenderer(), new THREE.Scene(), camera, { look: POST_LOOK[quality] });
}

describe('vesper chrysalis: no stray texel blacks out the frame', () => {
    it.each(BACKENDS)('keeps the crystals\' light toward a facet\'s edges bounded off the facet (%s)', (_, Builder) => {
        const noise = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
        const spires = createSpires(createVesperUniforms({ noise }), planSpires(9));
        const code = fragmentOf(Builder, spires.mesh, spires.mesh.material);
        // The distance to the nearest edge of the facet (the barycentric varying's least).
        const toEdge = code.match(/(nodeVar\d+) = min\(\s*vSpireEdge\.x/)?.[1];
        expect(toEdge, 'the facet-edge distance').toBeTruthy();
        // It reaches exp() only clamped at 0: off the facet it runs far negative.
        expect(code).toMatch(new RegExp(`exp\\(\\s*\\(\\s*max\\(\\s*${toEdge},\\s*0\\.0\\s*\\)\\s*\\*\\s*-7\\.0`));
        expect(code).not.toMatch(new RegExp(`exp\\(\\s*\\(\\s*${toEdge}\\s*\\*`));
    });

    it.each(BACKENDS)('reads the scene finite in the output pass, on its bit pattern (%s)', (backend, Builder) => {
        for (const quality of ['High', 'Low']) {
            const code = passFragment(Builder, buildPost(quality).pipeline.outputNode);
            // Tested on the bits (WGSL has no isNan, and x != x can be folded away).
            expect(code, quality).toContain(backend === 'WGSL' ? 'bitcast<u32>' : 'floatBitsToUint');
            expect(code, quality).toContain(EXPONENT_BITS);
            // Once defined, once called: on the scene colour, after the fringe's taps.
            expect(mentions(code, 'vc_finiteRgb'), quality).toBe(2);
        }
    });

    it.each(BACKENDS)('reads the scene finite in every tap of the bloom\'s bright pass (%s)', (_, Builder) => {
        for (const quality of ['Extreme', 'High', 'Medium']) {
            const bloom = buildPost(quality).bloomNode;
            expect(bloom, quality).toBeTruthy();
            const code = passFragment(Builder, bloom.highPassFn({
                input: bloom.inputNode, threshold: bloom.threshold, smoothWidth: bloom.smoothWidth,
            }));
            expect(code, quality).toContain(EXPONENT_BITS);
            // Defined once, and each of the four box taps goes through it.
            expect(mentions(code, 'vc_finiteRgb'), quality).toBe(5);
        }
    });
});
