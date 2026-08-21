/**
 * Emission contract for the shared Odyssey TSL noise lib (docs/R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md §1).
 *
 * Two properties cost the r185 cold start seconds when they were violated and are cheap to pin
 * from the generated WGSL, no GPU needed:
 *
 *   1. `snoise3` is NOT three's MaterialX Perlin. `mx_noise_float` hashes the lattice with an
 *      integer Bob-Jenkins mix; once DXC inlines 20 evaluations the pipeline takes ~7 s to
 *      compile (the Earth Core lava lake, 2026-08-21). The calibrated Ashima simplex compiles
 *      that same shader in ~1.9 s.
 *   2. Every shared helper `Fn` carries a `setLayout`. A layout-less `Fn` is an INLINE function
 *      — its body is re-emitted at each call site (a 20-call lake fragment was 113 KB with no
 *      `fn` at all). With layouts the builder emits one real WGSL `fn` per helper.
 *
 * The build goes through three's own `WGSLNodeBuilder` against a stub renderer, the same way
 * the upgrade's positionNode-ordering harness settled its question from emitted code.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { context, vec3, positionLocal } from 'three/tsl';
import {
    snoise3, simplex3, noise3, fbm3, hash31,
} from '../../src/rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js';

function buildFragment(colorNode) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    material.fog = false;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
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
        debug: { checkShaderErrors: false },
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
    return builder.fragmentShader;
}

const fnNames = (wgsl) => [...wgsl.matchAll(/^fn\s+(\w+)\s*\(/gm)].map((m) => m[1]);
const callCount = (wgsl, name) => (wgsl.match(new RegExp(`\\b${name}\\s*\\(`, 'g')) || []).length - 1; // minus the definition

describe('odyssey-tsl-noise emission contract (WGSL)', () => {
    it('snoise3 emits the calibrated simplex as real functions and never MaterialX Perlin', () => {
        // Twenty evaluations, like the lava lake: the pathological count.
        let acc = snoise3(positionLocal.mul(0.1));
        for (let i = 1; i < 20; i += 1) acc = acc.add(snoise3(positionLocal.mul(0.1 + i * 0.07).add(vec3(i))));
        const wgsl = buildFragment(vec3(acc));
        const fns = fnNames(wgsl);
        expect(fns).toContain('od_snoise3');
        expect(fns).toContain('od_simplex3');
        expect(fns).toContain('od_permute4');
        expect(fns).not.toEqual(expect.arrayContaining([expect.stringMatching(/^mx_/)]));
        expect(wgsl).not.toMatch(/mx_perlin|mx_bjfinal|mx_hash_int/);
        // 20 CALLS, one body: the simplex math is not inlined per evaluation.
        expect(callCount(wgsl, 'od_snoise3')).toBe(20);
        expect(wgsl.split('fn od_simplex3').length - 1).toBe(1);
        // Sanity bound on size — the inlined version of this shader was >100 KB.
        expect(wgsl.length).toBeLessThan(40_000);
    });

    it('value noise helpers are emitted once and called per octave (setLayout on every Fn)', () => {
        const wgsl = buildFragment(vec3(fbm3(positionLocal, 5)));
        const fns = fnNames(wgsl);
        expect(fns).toContain('od_noise3');
        expect(fns).toContain('od_hash31');
        expect(callCount(wgsl, 'od_noise3')).toBe(5);
        // hash31 is called 8× inside ONE noise3 body, not 40× across five inlined bodies.
        expect(callCount(wgsl, 'od_hash31')).toBe(8);
    });

    it('every exported Fn helper carries a layout (the inline-vs-function switch)', () => {
        for (const fn of [simplex3, noise3, hash31]) {
            expect(fn.shaderNode?.layout ?? fn.layout, 'Fn without setLayout inlines at every call site').toBeTruthy();
        }
    });
});
