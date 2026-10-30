/**
 * Chapter 7's singularity window (the black hole's shadow, which becomes the warp tunnel when the
 * portal opens). Its colour is multiplied by the portal uniform, so before the portal opens the
 * tunnel and the fold were evaluated on every pixel of the shadow for nothing (perf audit
 * 2026-10-28): they now sit behind a uniform branch on it. The hazard such a branch carries is the
 * one the window's own comments warn about: a node is assigned where it is first built, so one
 * first built inside the branch reads stale outside it, and the alpha test (the mouth at the 7->8
 * exit) is outside. Built through three's own node builders on a device-less renderer (the
 * earth-core-shaft set-up): not a compile, Tint and the driver never see these shaders here.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { createSingularityWindowTSL } from '../../src/rendering/odyssey/chapter-environments/black-hole-transcendence.tsl.js';

const canvas = {
    style: {},
    width: 1280,
    height: 720,
    addEventListener() {},
    removeEventListener() {},
    getContext() { return null; },
    setAttribute() {},
};

function stubRenderer(forceWebGL) {
    const renderer = new THREE.WebGPURenderer({ canvas, forceWebGL });
    renderer.hasFeature = () => false;
    renderer._initialized = true;
    // r187 reads shared bind groups from the renderer's Bindings, which init() makes: a pass-through here.
    renderer._bindings = { getSharedBindGroup: (group) => group };
    if (forceWebGL) renderer.backend.capabilities = { getUniformBufferLimit: () => 16384, getMaxAnisotropy: () => 1 };
    else renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
    return renderer;
}

function buildFragment(forceWebGL) {
    const { material, uniforms } = createSingularityWindowTSL(undefined, { foldSteps: 24 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), material);
    const scene = new THREE.Scene();
    scene.add(mesh);
    mesh.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 3000);
    camera.updateMatrixWorld(true);
    const renderer = stubRenderer(forceWebGL);
    const heard = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((...a) => heard.push(a.join(' ')));
    const error = vi.spyOn(console, 'error').mockImplementation((...a) => heard.push(a.join(' ')));
    try {
        const builder = renderer.backend.createNodeBuilder(mesh, renderer);
        builder.scene = scene;
        builder.material = material;
        builder.camera = camera;
        builder.context.material = material;
        builder.lightsNode = renderer.lighting.getNode(scene);
        builder.fogNode = null;
        builder.clippingContext = null;
        builder.build();
        return { fragment: builder.fragmentShader, heard, uniforms };
    } finally {
        warn.mockRestore();
        error.mockRestore();
    }
}

describe('Chapter 7 window: nothing of the tunnel is evaluated before the portal opens', () => {
    [['WGSL', false], ['GLSL', true]].forEach(([label, forceWebGL]) => {
        it(`(${label}) branches on the portal around the tunnel and the fold, and the alpha test reads only what the root assigned`, () => {
            const { fragment, heard } = buildFragment(forceWebGL);
            expect(heard).toEqual([]);
            const lines = fragment.split('\n');
            const main = lines.findIndex((l) => /\b(fn main|void main)\b/.test(l));
            expect(main).toBeGreaterThan(0);
            // The first branch in main is the portal's, and the tunnel's (uFold < 0.999) is inside it.
            const firstIf = lines.findIndex((l, i) => i > main && /^\s*if \(/.test(l));
            expect(lines[firstIf]).toMatch(/> 0\.0 \) \) \{/);
            const tunnelIf = lines.findIndex((l, i) => i > firstIf && /< 0\.999 \) \) \{/.test(l));
            expect(tunnelIf).toBeGreaterThan(firstIf);
            expect(lines[tunnelIf].search(/\S/)).toBeGreaterThan(lines[firstIf].search(/\S/));
            // The alpha test (the mouth) reads node vars assigned before the portal's branch (three
            // r187 declares the ones it caches as locals: `let nodeConst4 = …` / `float nodeConst4 = …`).
            const alpha = lines.findIndex((l) => /DiffuseColor\.w = \( DiffuseColor\.w \*/.test(l));
            expect(alpha).toBeGreaterThan(firstIf);
            const read = [...new Set(lines[alpha].match(/node(?:Var|Const)\d+/g) || [])];
            expect(read.length).toBeGreaterThan(0);
            read.forEach((name) => {
                const declared = String.raw`^\s*(?:(?:let|var|float|int|uint|bool|[biu]?vec[234])\s+)?`;
                const assigned = lines.findIndex((l, i) => i > main && new RegExp(`${declared}${name}\\b[^=]*= `).test(l));
                expect(assigned, `${name} is assigned in main`).toBeGreaterThan(main);
                expect(assigned, `${name} is assigned before the portal's branch`).toBeLessThan(firstIf);
            });
        });
    });
});
