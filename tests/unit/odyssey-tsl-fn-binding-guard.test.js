/**
 * THE LAYOUT-Fn BINDING TRAP (2026-08-22) — the guard that would have caught a dead chapter 1.
 *
 * Wrapping a big helper in `Fn(...).setLayout(...)` looks like free money: three r185 caches the
 * generated body in a MODULE-LEVEL WeakMap (`_functionNodeCache`, keyed backend → shaderNode,
 * NodeBuilder.buildFunctionNode), so the body is built once for the whole app and every later
 * material only textually includes it. That is exactly why `snoise3` costs ~5 nodes per call
 * while the same arithmetic inlined costs 16–23, and it is why three separate proposals to wrap
 * Earth Core's `moltenRockField` and its baked-noise samplers looked like a 40 % node cut.
 *
 * They would have shipped INVALID WGSL. On a cache hit the body is never re-flowed, so
 * `getUniformFromNode` never runs in the second material's builder and no texture/sampler binding
 * is registered there — only `FunctionNode` and `StructTypeNode` propagate through `addInclude`.
 * Binding names are `'nodeUniform' + builder.uniforms.index++`, a PER-BUILDER counter. So
 * material A declares `var nodeUniform0 : texture_3d<f32>` and emits a correct `fn`; material B
 * includes the identical cached body — calling `textureSample(nodeUniform0, …)` — while declaring
 * no texture at all, and its own `nodeUniform0` is an unrelated f32. Dawn rejects it.
 *
 * The rule this file pins: **a layout-carrying `Fn` may not close over a texture or sampler
 * unless it is instantiated per material.** Pure-math helpers (the whole shared noise lib) are
 * unaffected and stay shared.
 *
 * Why the existing emission harness could not see it: `buildFragment` builds every material
 * against a FRESH stub renderer, so each one gets its own function cache — the inverse of the
 * real renderer, which has one backend for the app's lifetime. Everything here shares one.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    Fn, context, texture3D, vec3, positionLocal,
} from 'three/tsl';
import { snoise3, fbm3 } from '../../src/rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js';

/**
 * A stub renderer whose `backend` identity is supplied by the caller — that object is the key of
 * three's module-level function cache, so sharing it is what makes two builds behave like two
 * materials in one running app rather than two unrelated processes.
 */
function makeRenderer(backend) {
    return {
        contextNode: context(),
        lighting: { enabled: false },
        backend,
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
}

/** Build `colorNode` into a fragment shader against the GIVEN backend (shared across calls). */
function buildFragmentOn(backend, colorNode) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    material.fog = false;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    const builder = new THREE.WGSLNodeBuilder(mesh, makeRenderer(backend));
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = material;
    builder.material = material;
    builder.build();
    return builder.fragmentShader;
}

const newBackend = () => ({
    device: null,
    capabilities: { getUniformBufferLimit: () => 65536 },
    // WGSLNodeBuilder asks the backend how many samples a sampled texture has (it decides
    // texture_2d vs texture_multisampled_2d); nothing here is multisampled.
    utils: { getTextureSampleData: () => ({ samples: 1, primarySamples: 1, isMSAA: false }) },
});

/**
 * Every `nodeUniform*` identifier the shader REFERENCES, minus the ones it DECLARES.
 * A non-empty result is an unresolved-identifier WGSL module — the failure mode above.
 */
function undeclaredBindings(wgsl) {
    const declared = new Set();
    for (const m of wgsl.matchAll(/var(?:<[^>]*>)?\s+(nodeUniform\w*)\s*:/g)) declared.add(m[1]);
    for (const m of wgsl.matchAll(/(\w+)\s*:\s*(?:texture_\w+|sampler)\b/g)) declared.add(m[1]);
    // Struct members count as declarations for the name, which is precisely why the broken case
    // is so quiet: B's `nodeUniform0` exists — as an f32 — so only the TYPE gives it away.
    const sampled = new Set();
    for (const m of wgsl.matchAll(/texture(?:Sample|Load|SampleLevel|Dimensions)\w*\s*\(\s*(\w+)/g)) sampled.add(m[1]);
    const textureVars = new Set();
    for (const m of wgsl.matchAll(/var(?:<[^>]*>)?\s+(\w+)\s*:\s*texture_\w+/g)) textureVars.add(m[1]);
    return [...sampled].filter((name) => !textureVars.has(name));
}

describe('layout-Fn binding guard', () => {
    it('DETECTOR WORKS: a layout Fn closing over a texture breaks the SECOND material on one backend', () => {
        // The exact shape three proposals wanted: one module-level Fn, built once, shared.
        const tex = new THREE.Data3DTexture(new Uint8Array(8), 2, 2, 2);
        const sharedSampler = Fn(([p]) => texture3D(tex, p).r).setLayout({
            name: 'guardBakedNoise',
            type: 'float',
            inputs: [{ name: 'p', type: 'vec3' }],
        });
        const backend = newBackend();
        const a = buildFragmentOn(backend, vec3(sharedSampler(positionLocal)));
        const b = buildFragmentOn(backend, vec3(sharedSampler(positionLocal.mul(2))));

        // A is fine — it is the build that registered the binding.
        expect(undeclaredBindings(a)).toEqual([]);
        // B includes the cached body and samples a texture it never declared. If this ever comes
        // back empty, three changed the caching rule: re-read the note at the top before
        // concluding the trap is gone, then delete this file's rule with the measurement to match.
        expect(undeclaredBindings(b).length).toBeGreaterThan(0);
    });

    it('the shared noise helpers are pure math, so sharing them across materials is safe', () => {
        // The invariant that keeps the noise lib shareable: no helper closes over a texture, so
        // repeated builds on ONE backend stay self-contained however many materials use them.
        const backend = newBackend();
        const shaders = [
            buildFragmentOn(backend, vec3(snoise3(positionLocal))),
            buildFragmentOn(backend, vec3(fbm3(positionLocal, 3))),
            buildFragmentOn(backend, vec3(snoise3(positionLocal.mul(3)).add(fbm3(positionLocal, 2)))),
        ];
        for (const wgsl of shaders) expect(undeclaredBindings(wgsl)).toEqual([]);
    });

    it('a per-material Fn keeps its bindings even when its body is textually identical', () => {
        // The supported way to get the WGSL-size win from a texture-sampling helper: build the Fn
        // INSIDE the material factory, so each material owns its shaderNode and registers its own
        // binding. Same emitted arithmetic, no shared-cache hazard.
        const tex = new THREE.Data3DTexture(new Uint8Array(8), 2, 2, 2);
        const perMaterialSampler = () => Fn(([p]) => texture3D(tex, p).r).setLayout({
            name: 'guardPerMaterialNoise',
            type: 'float',
            inputs: [{ name: 'p', type: 'vec3' }],
        });
        const backend = newBackend();
        const a = buildFragmentOn(backend, vec3(perMaterialSampler()(positionLocal)));
        const b = buildFragmentOn(backend, vec3(perMaterialSampler()(positionLocal.mul(2))));
        expect(undeclaredBindings(a)).toEqual([]);
        expect(undeclaredBindings(b)).toEqual([]);
        // And each one still emits the helper as a real WGSL fn, not an inlined body per call site.
        for (const wgsl of [a, b]) expect(wgsl).toMatch(/fn\s+guardPerMaterialNoise\s*\(/);
    });
});
