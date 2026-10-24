/**
 * Chapter 2's visitors (a whale shark and a manta, composition/odyssey-ocean-visitors.js): the
 * copied asset parses, both kinds build for WebGPU (WGSL) and the WebGL2 fallback (GLSL) on a
 * device-less renderer, nothing draws before the board marks it ready, an animal swims its own
 * route (odyssey-ocean-roam.js) whatever the camera does, and is never belly-up (orientation from
 * world up, the creature-orientation trap).
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

/** A camera in the deep, looking up the water column the way the ascent does. */
function lookingUp(y) {
    const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 3000);
    camera.position.set(-6, y, 4);
    camera.up.set(0, 0, -1);
    camera.lookAt(-6, y + 100, 4.5);
    return camera;
}

describe('ocean visitors — lifecycle and swimming', () => {
    it('stays hidden until the board marks it ready, then shows; never out of the water', async () => {
        const visitors = await loadedVisitors();
        const camera = lookingUp(130);
        visitors.update(10, 0.016, camera, 1, true, 1);
        expect(visitors.group.visible).toBe(false);
        visitors.markReady();
        for (let i = 0; i < 200; i += 1) visitors.update(10 + (i * 0.016), 0.016, camera, 1, true, 1);
        expect(visitors.group.visible).toBe(true);
        // Above the water (submerged 0) or outside the chapter: nothing.
        visitors.update(20, 0.016, camera, 0, true, 1);
        expect(visitors.group.visible).toBe(false);
        visitors.update(20, 0.016, camera, 1, false, 1);
        expect(visitors.group.visible).toBe(false);
    });

    it('swims its own route: wherever the camera goes or looks, the clock alone places it', async () => {
        const visitors = await loadedVisitors();
        visitors.markReady();
        const places = (camera, t0) => {
            for (let i = 0; i < 60; i += 1) visitors.update(t0 + (i * 0.05), 0.05, camera, 1, true, 1);
            return visitors.group.children.map((mesh) => mesh.position.clone());
        };
        const deep = places(lookingUp(130), 40);
        // The same moment seen from higher up the climb, and from a camera turned aside.
        const higher = places(lookingUp(210), 40);
        const turned = lookingUp(160);
        turned.lookAt(60, 200, -80);
        const aside = places(turned, 40);
        deep.forEach((at, i) => {
            expect(higher[i].distanceTo(at)).toBeLessThan(1e-6);
            expect(aside[i].distanceTo(at)).toBeLessThan(1e-6);
        });
        // ...and the clock moving on moves it along its route.
        const later = places(lookingUp(130), 50);
        deep.forEach((at, i) => expect(later[i].distanceTo(at)).toBeGreaterThan(5));
    });

    it('never swims belly-up, and swims high in the column above the climb', async () => {
        const visitors = await loadedVisitors();
        visitors.markReady();
        const up = new THREE.Vector3();
        const seen = [];
        for (let y = 120; y <= 200; y += 8) {
            const camera = lookingUp(y);
            for (let i = 0; i < 90; i += 1) {
                visitors.update((y * 3) + (i * 0.1), 0.1, camera, 1, true, 1);
            }
            visitors.group.children.forEach((mesh) => {
                if (!mesh.visible) return;
                up.set(0, 1, 0).applyQuaternion(mesh.quaternion);
                expect(up.y, `${mesh.name} at eye ${y}`).toBeGreaterThan(0.6);
                // The eye looks up the column: they swim overhead, under the surface.
                expect(mesh.position.y).toBeGreaterThan(y);
                expect(mesh.position.y).toBeLessThan(287.31);
                seen.push(mesh.name);
            });
        }
        expect(new Set(seen).size).toBe(2);
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
