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
 * Pinned here, compiled for both backends: the crystals, and the chrysalis cut the same way, keep
 * every light toward a facet's edges bounded off the facet, and the post
 * reads the scene finite (an Inf or NaN texel as black) in its output pass and in the bloom's
 * bright pass, so one bad texel from any part stays one pixel.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';

import { createVesperUniforms, planSpires } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-tsl.js';
import { createSpires } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-shore.js';
import { createChrysalis } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-relic.js';
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

/** The argument text of every call of `name(…)` in a stage (balanced parentheses). */
function argumentsOf(code, name) {
    const found = [];
    const call = new RegExp(`\\b${name}\\(`, 'g');
    for (const match of code.matchAll(call)) {
        let depth = 1;
        let at = match.index + match[0].length;
        const start = at;
        while (at < code.length && depth > 0) {
            if (code[at] === '(') depth += 1;
            else if (code[at] === ')') depth -= 1;
            at += 1;
        }
        found.push(code.slice(start, at - 1));
    }
    return found;
}

/**
 * What a fragment stage does with a facet's distance to its edges (the least of the barycentric
 * varying `edge`): the var it is clamped into, how often the varying is read at all, every exp()
 * that reads the clamped distance (and the factor of each that is exp(distance · k)), and
 * anything divided by it.
 */
function edgeUse(code, edge) {
    const least = `min\\(\\s*${edge}\\.x,\\s*min\\(\\s*${edge}\\.y,\\s*${edge}\\.z\\s*\\)\\s*\\)`;
    const clamp = new RegExp(`(nodeVar\\d+) = max\\(\\s*${least},\\s*0\\.0\\s*\\)`);
    const toEdge = code.match(clamp)?.[1] ?? null;
    const reads = (code.match(new RegExp(`\\b${edge}\\.[xyz]\\b`, 'g')) || []).length;
    if (!toEdge) {
        return {
            toEdge, reads, exps: [], falloffs: [], divisions: [],
        };
    }
    const exps = argumentsOf(code, 'exp').filter((arg) => new RegExp(`\\b${toEdge}\\b`).test(arg));
    const falloff = new RegExp(`^\\s*\\(\\s*${toEdge}\\s*\\*\\s*(-?[\\d.]+)\\s*\\)\\s*$`);
    const falloffs = exps.map((arg) => falloff.exec(arg)).filter(Boolean).map((m) => Number(m[1]));
    const divisions = code.match(new RegExp(`/\\s*\\(*\\s*${toEdge}\\b`, 'g')) || [];
    return {
        toEdge, reads, exps, falloffs, divisions,
    };
}

describe('vesper chrysalis: no stray texel blacks out the frame', () => {
    // The crystals and the chrysalis are both cut stone with a hairline of light at every edge, and
    // both read the distance to the edges from a barycentric varying: shaded at a silhouette
    // pixel's centre, off the facet, it runs negative. Each clamps it at 0 where it is first read,
    // and reads the varying nowhere else, so no exp() and no division downstream ever sees a
    // negative distance; what does reach exp() is a falloff, exp(−k · distance) ≤ 1.
    it.each(BACKENDS)('keeps the cut stone\'s light toward a facet\'s edges bounded off it (%s)', (_, Builder) => {
        const noise = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
        const u = createVesperUniforms({ noise });
        const spires = createSpires(u, planSpires(9));
        const chrysalis = createChrysalis(u);
        const stages = [
            ['the crystals', fragmentOf(Builder, spires.mesh, spires.mesh.material), 'vSpireEdge'],
            ['the chrysalis', fragmentOf(Builder, chrysalis.shell, chrysalis.shell.material), 'vGemEdge'],
        ];
        for (const [name, code, edge] of stages) {
            const use = edgeUse(code, edge);
            // The distance to the nearest edge of the facet, clamped at 0 as it is read...
            expect(use.toEdge, `${name}: the clamped facet-edge distance`).toBeTruthy();
            // ...and the varying read nowhere but there (its three components, once).
            expect(use.reads, `${name}: reads of ${edge}`).toBe(3);
            // Whatever exp() reads of it is a falloff on the clamped distance; nothing divides by it.
            expect(use.falloffs, name).toHaveLength(use.exps.length);
            use.falloffs.forEach((k) => expect(k, name).toBeLessThan(0));
            expect(use.divisions, name).toEqual([]);
        }
        // The chrysalis's cracks glow along its edges: that falloff is there, on the clamped distance.
        expect(edgeUse(stages[1][1], 'vGemEdge').falloffs.length).toBeGreaterThan(0);
        chrysalis.dispose();
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
