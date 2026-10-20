/**
 * Chapter 2's visitors (a whale shark and a manta, composition/odyssey-ocean-visitors.js): the
 * copied asset parses, both kinds build for WebGPU (WGSL) and the WebGL2 fallback (GLSL) on a
 * device-less renderer, nothing draws before the board marks it ready, and an animal swimming its
 * loop is never belly-up (orientation from world up, the creature-orientation trap).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    OCEAN_VISITOR_CAST,
    createOceanVisitors,
    parseOceanVisitors,
} from '../../src/rendering/odyssey/composition/odyssey-ocean-visitors.js';

vi.setConfig({ testTimeout: 60_000 });

const GLB = readFileSync(path.resolve('src/rendering/odyssey/assets/chapter-02/visitors/ocean-visitors.glb'));

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
    if (forceWebGL) renderer.backend.capabilities = { getUniformBufferLimit: () => 16384, getMaxAnisotropy: () => 1 };
    else renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
    return renderer;
}

async function loadedVisitors() {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => GLB.buffer.slice(GLB.byteOffset, GLB.byteOffset + GLB.byteLength) })));
    const visitors = createOceanVisitors({
        axis: { x: -4, z: 6 },
        seaLevel: 287.31,
        shallowColour: new THREE.Color(0.1, 0.3, 0.45),
        deepColour: new THREE.Color(0.01, 0.04, 0.08),
    });
    expect(await visitors.load()).toBe(true);
    return visitors;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('ocean visitors — the asset', () => {
    it('holds every animal of the cast, one unit long, nose along +z', () => {
        const kinds = parseOceanVisitors(GLB);
        OCEAN_VISITOR_CAST.forEach((cast) => {
            const body = kinds[cast.name];
            expect(body, cast.name).toBeTruthy();
            const pos = body.geometry.getAttribute('position');
            let minZ = Infinity;
            let maxZ = -Infinity;
            for (let i = 0; i < pos.count; i += 1) {
                minZ = Math.min(minZ, pos.getZ(i));
                maxZ = Math.max(maxZ, pos.getZ(i));
            }
            expect(maxZ - minZ).toBeGreaterThan(0.3);
            expect(maxZ - minZ).toBeLessThan(1.6);
            ['aShape', 'aSkin', 'aPivot', 'normal'].forEach((name) => expect(body.geometry.getAttribute(name), name).toBeTruthy());
        });
    });
});

describe('ocean visitors — lifecycle and swimming', () => {
    it('stays hidden until the board marks it ready, then shows in its window', async () => {
        const visitors = await loadedVisitors();
        const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 3000);
        camera.position.set(-6, 150, 4);
        visitors.update(10, 0.016, camera, 1, true, 1);
        expect(visitors.group.visible).toBe(false);
        visitors.markReady();
        for (let i = 0; i < 200; i += 1) visitors.update(10 + (i * 0.016), 0.016, camera, 1, true, 1);
        expect(visitors.group.visible).toBe(true);
        // Above the water (submerged 0) or outside the chapter, nothing.
        visitors.update(20, 0.016, camera, 0, true, 1);
        for (let i = 0; i < 200; i += 1) visitors.update(20 + (i * 0.016), 0.016, camera, 0, true, 1);
        expect(visitors.group.visible).toBe(false);
    });

    it('never swims belly-up and keeps above the eye', async () => {
        const visitors = await loadedVisitors();
        visitors.markReady();
        const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 3000);
        const up = new THREE.Vector3();
        const seen = [];
        for (let y = 120; y <= 236; y += 4) {
            camera.position.set(-6, y, 4);
            for (let i = 0; i < 90; i += 1) {
                visitors.update((y * 3) + (i * 0.1), 0.1, camera, 1, true, 1);
            }
            visitors.group.children.forEach((mesh) => {
                if (!mesh.visible) return;
                up.set(0, 1, 0).applyQuaternion(mesh.quaternion);
                expect(up.y, `${mesh.name} at eye ${y}`).toBeGreaterThan(0.6);
                expect(mesh.position.y).toBeGreaterThan(y);
                seen.push(mesh.name);
            });
        }
        expect(seen.length).toBeGreaterThan(10);
    });
});

describe('ocean visitors — shaders build for both backends', () => {
    [['WGSL', false], ['GLSL', true]].forEach(([label, forceWebGL]) => {
        it(`builds both kinds (${label}) without a word`, async () => {
            const visitors = await loadedVisitors();
            const scene = new THREE.Scene();
            scene.add(visitors.group);
            const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 3000);
            camera.position.set(-6, 150, 4);
            camera.updateMatrixWorld(true);
            visitors.group.updateMatrixWorld(true);
            const renderer = stubRenderer(forceWebGL);
            const heard = [];
            const warn = vi.spyOn(console, 'warn').mockImplementation((...a) => heard.push(a.join(' ')));
            const error = vi.spyOn(console, 'error').mockImplementation((...a) => heard.push(a.join(' ')));
            try {
                visitors.group.children.forEach((mesh) => {
                    const builder = renderer.backend.createNodeBuilder(mesh, renderer);
                    builder.scene = scene;
                    builder.material = mesh.material;
                    builder.camera = camera;
                    builder.context.material = mesh.material;
                    builder.lightsNode = renderer.lighting.getNode(scene);
                    builder.fogNode = null;
                    builder.clippingContext = null;
                    builder.build();
                    expect(builder.fragmentShader.length).toBeGreaterThan(200);
                    expect(builder.vertexShader).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                    expect(builder.fragmentShader).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                });
            } finally {
                warn.mockRestore();
                error.mockRestore();
            }
            expect(heard).toEqual([]);
        });
    });
});
