/**
 * CHAPTER 2'S FISH, MODELLED IN BLENDER (2026-11-01, docs/ODYSSEY_BLENDER_FISH_2026-11.md). The four
 * schools of the deep ocean climb (odyssey-fish.js) swim as two Blender-made hulls, a schooling jack
 * and a cruising tuna (scripts/blender/odyssey/odyssey_fish.py -> odyssey-fish-hulls.js):
 *
 * - the hull data: each body closed, wound outward, mirror-symmetric, inside the old hull's
 *   length, every baked attribute in range, triangle counts matched to the game size;
 * - one geometry for both hulls, one instanced draw under eight vertex buffers;
 * - the swim (the CPU twin of the vertex stage): a wave that grows toward the tail, the head
 *   swinging opposite, the tuna stiffer than the jack;
 * - the material builds for WebGPU (WGSL) and the WebGL2 fallback (GLSL) without a word;
 * - the world draws it by the sea's rules (one mesh, after the sea, behind the 1->2 steam).
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { float, uniform } from 'three/tsl';
import { ODYSSEY_FISH_HULLS } from '../../src/rendering/odyssey/world/odyssey-fish-hulls.js';
import {
    FISH_COUNT, FISH_HULL_LENGTH, FISH_SCHOOLS, buildFishHullGeometry, createOdysseyFish, decodeFishHull,
    fishSwimOffset,
} from '../../src/rendering/odyssey/world/odyssey-fish.js';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import { createOdysseyWorld } from '../../src/rendering/odyssey/world/odyssey-world-renderer.js';
import { unassignedReads } from './helpers/tsl-node-build.js';

vi.setConfig({ testTimeout: 60_000 });

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
    renderer._bindings = { getSharedBindGroup: (group) => group };
    if (forceWebGL) renderer.backend.capabilities = { getUniformBufferLimit: () => 16384, getMaxAnisotropy: () => 1 };
    else renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
    return renderer;
}

afterEach(() => { vi.restoreAllMocks(); });

const SEA = 287.31;
const openWater = Array.from({ length: 40 }, (_, i) => ({ x: -8 + (i * 0.2), y: 150 + (i * 3), z: 3 }));
const createFish = () => createOdysseyFish({
    uTime: uniform(0),
    uLife: uniform(1),
    seaLevel: SEA,
    openWater,
    heightAt: () => 100,
    haze: (c) => c.mul(float(0.9)),
    grade: (c) => c,
});

const v3 = (a, i) => [a[i * 3], a[(i * 3) + 1], a[(i * 3) + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])];
const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);

describe.each([['school', 0, 240], ['cruiser', 1, 330]])('the %s hull', (name, hullIndex, budget) => {
    const h = decodeFishHull(name);
    const region = (i) => h.parts[(i * 4) + 3] - (hullIndex * 4);

    it('has the arrays it claims, triangles matched to its game size', () => {
        expect(h.hull).toBe(hullIndex);
        expect(h.positions.length).toBe(h.vertexCount * 3);
        expect(h.normals.length).toBe(h.vertexCount * 3);
        expect(h.parts.length).toBe(h.vertexCount * 4);
        expect(h.index.length).toBe(h.triangleCount * 3);
        expect(Math.max(...h.index)).toBeLessThan(h.vertexCount);
        // A few hundred triangles: smooth at the 300 px the nearest are drawn, cheap at 150 copies.
        expect(h.triangleCount).toBeGreaterThan(120);
        expect(h.triangleCount).toBeLessThanOrEqual(budget);
        expect(h.bodyTriangleCount).toBeLessThan(h.triangleCount);
    });

    it('keeps the old hull\'s length and a fish\'s proportions', () => {
        let min = [Infinity, Infinity, Infinity];
        let max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < h.vertexCount; i += 1) {
            const p = v3(h.positions, i);
            min = min.map((m, k) => Math.min(m, p[k]));
            max = max.map((m, k) => Math.max(m, p[k]));
        }
        expect(max[2]).toBeCloseTo(ODYSSEY_FISH_HULLS.noseZ, 1);
        expect(min[2]).toBeCloseTo(ODYSSEY_FISH_HULLS.tailZ, 1);
        expect(FISH_HULL_LENGTH).toBeCloseTo(4.35, 6);
        // Laterally compressed: narrower than deep (fins included), and no part strays far.
        expect(max[0] - min[0]).toBeLessThan(max[1] - min[1]);
        expect(Math.max(-min[0], max[0])).toBeLessThan(0.8);
        expect(Math.max(-min[1], max[1])).toBeLessThan(1.0);
        expect(ODYSSEY_FISH_HULLS[name].min).toEqual(min.map((c) => Number(c.toFixed(4))));
        expect(ODYSSEY_FISH_HULLS[name].max).toEqual(max.map((c) => Number(c.toFixed(4))));
    });

    it('has a closed body, wound outward, mirror-symmetric', () => {
        const edges = new Map();
        let outward = 0;
        const bodyVerts = new Set();
        for (let t = 0; t < h.bodyTriangleCount; t += 1) {
            const [a, b, c] = [h.index[t * 3], h.index[(t * 3) + 1], h.index[(t * 3) + 2]];
            [a, b, c].forEach((i) => bodyVerts.add(i));
            [[a, b], [b, c], [c, a]].forEach(([i, j]) => {
                const key = i < j ? `${i}-${j}` : `${j}-${i}`;
                edges.set(key, (edges.get(key) || 0) + 1);
            });
            const pa = v3(h.positions, a);
            const geo = cross(sub(v3(h.positions, b), pa), sub(v3(h.positions, c), pa));
            const mean = [0, 1, 2].map((k) => h.normals[(a * 3) + k] + h.normals[(b * 3) + k] + h.normals[(c * 3) + k]);
            if (dot(geo, mean) > 0) outward += 1;
            [a, b, c].forEach((i) => expect(region(i), `body vertex ${i}`).toBe(0));
        }
        expect([...edges.values()].every((n) => n === 2), 'every body edge shared by two triangles').toBe(true);
        expect(outward).toBe(h.bodyTriangleCount);
        // Mirror symmetry about the midplane (Blender's Decimate ran symmetric).
        const body = [...bodyVerts].map((i) => v3(h.positions, i));
        body.forEach((p) => {
            const twin = body.some((o) => Math.abs(o[0] + p[0]) < 1e-3 && Math.abs(o[1] - p[1]) < 1e-3
                && Math.abs(o[2] - p[2]) < 1e-3);
            expect(twin, `mirror of ${p}`).toBe(true);
        });
    });

    it('bakes unit normals and every part attribute in range', () => {
        const regions = new Set();
        for (let i = 0; i < h.vertexCount; i += 1) {
            const n = v3(h.normals, i);
            expect(Math.hypot(...n)).toBeCloseTo(1, 3);
            const [s, d, flex, code] = h.parts.slice(i * 4, (i * 4) + 4);
            const z = h.positions[(i * 3) + 2];
            expect(s).toBeGreaterThanOrEqual(0);
            expect(s).toBeLessThanOrEqual(1);
            expect(s).toBeCloseTo(Math.min(1, Math.max(0, (ODYSSEY_FISH_HULLS.noseZ - z) / FISH_HULL_LENGTH)), 3);
            expect(d).toBeGreaterThanOrEqual(0);
            expect(d).toBeLessThanOrEqual(1);
            expect(flex).toBeGreaterThanOrEqual(0);
            expect(flex).toBeLessThanOrEqual(1);
            expect(Number.isInteger(code)).toBe(true);
            regions.add(code - (hullIndex * 4));
            if (code - (hullIndex * 4) === 0) expect(flex).toBe(0);
        }
        expect([...regions].sort()).toEqual([0, 1, 2]);
        // The back is dark and the belly pale: the top of the body is dorsal, its bottom ventral.
        let top = -1;
        let bottom = -1;
        for (let i = 0; i < h.vertexCount; i += 1) {
            if (region(i) !== 0) continue;
            if (top < 0 || h.positions[(i * 3) + 1] > h.positions[(top * 3) + 1]) top = i;
            if (bottom < 0 || h.positions[(i * 3) + 1] < h.positions[(bottom * 3) + 1]) bottom = i;
        }
        expect(h.parts[(top * 4) + 1]).toBeGreaterThan(0.9);
        expect(h.parts[(bottom * 4) + 1]).toBeLessThan(0.1);
    });

    it('carries its fins\' trailing edges loose and their roots fixed', () => {
        let tips = 0;
        for (let i = 0; i < h.vertexCount; i += 1) {
            if (region(i) === 1 && h.parts[(i * 4) + 2] > 0.95) tips += 1;
        }
        // At least the two tail tips.
        expect(tips).toBeGreaterThanOrEqual(2);
    });
});

describe('both hulls ride one geometry and one draw', () => {
    it('merges the hulls with their indices offset', () => {
        const geometry = buildFishHullGeometry();
        const school = decodeFishHull('school');
        const cruiser = decodeFishHull('cruiser');
        expect(geometry.getAttribute('position').count).toBe(school.vertexCount + cruiser.vertexCount);
        expect(geometry.getIndex().count).toBe((school.triangleCount + cruiser.triangleCount) * 3);
        const idx = geometry.getIndex().array;
        expect(Math.max(...idx)).toBe(school.vertexCount + cruiser.vertexCount - 1);
        expect(idx[school.triangleCount * 3]).toBeGreaterThanOrEqual(school.vertexCount);
        geometry.dispose();
    });

    it('is one instanced mesh of every school, under eight vertex buffers', () => {
        const fish = createFish();
        const { geometry } = fish.mesh;
        expect(FISH_COUNT).toBe(150);
        expect(fish.count).toBe(150);
        expect(geometry.instanceCount).toBe(150);
        expect(Object.keys(geometry.attributes).length).toBeLessThanOrEqual(8);
        expect(fish.mesh.renderOrder).toBe(2);
        expect(fish.mesh.material.depthNode).toBeTruthy();
        expect(fish.mesh.material.transparent).toBe(true);
        expect(fish.mesh.material.depthWrite).toBe(true);
        expect(fish.mesh.material.side).toBe(THREE.DoubleSide);
        // Each instance names its school's hull in the integer part of aFish.w.
        const aFish = geometry.getAttribute('aFish').array;
        let i = 0;
        FISH_SCHOOLS.forEach((school) => {
            for (let k = 0; k < school.count; k += 1, i += 1) {
                const w = aFish[(i * 4) + 3];
                expect(Math.floor(w)).toBe(school.hull === 'cruiser' ? 1 : 0);
                expect(w - Math.floor(w)).toBeLessThan(1);
            }
        });
        expect(fish.rings).toHaveLength(FISH_SCHOOLS.length);
        fish.dispose();
    });
});

describe('the swim: a wave growing to the tail, the head swinging opposite', () => {
    const amplitude = (hull, s) => {
        let hi = 0;
        for (let k = 0; k < 360; k += 1) hi = Math.max(hi, Math.abs(fishSwimOffset(hull, s, (k / 360) * Math.PI * 2)));
        return hi;
    };

    it('grows from mid-body to the tail tips, the tail sweeping widest', () => {
        [0, 1].forEach((hull) => {
            expect(amplitude(hull, 1)).toBeGreaterThan(amplitude(hull, 0.8));
            expect(amplitude(hull, 0.8)).toBeGreaterThan(amplitude(hull, 0.55));
            expect(amplitude(hull, 1)).toBeGreaterThan(4 * amplitude(hull, 0));
        });
        // A jack's tail tips swing about a twentieth of its length either way.
        expect(amplitude(0, 1) / FISH_HULL_LENGTH).toBeGreaterThan(0.05);
        expect(amplitude(0, 1) / FISH_HULL_LENGTH).toBeLessThan(0.1);
    });

    it('yaws the head gently against the tail', () => {
        [0, 1].forEach((hull) => {
            let corr = 0;
            for (let k = 0; k < 360; k += 1) {
                const phi = (k / 360) * Math.PI * 2;
                corr += fishSwimOffset(hull, 0, phi) * fishSwimOffset(hull, 1, phi);
            }
            expect(corr, `hull ${hull}`).toBeLessThan(0);
            expect(amplitude(hull, 0)).toBeGreaterThan(0);
            expect(amplitude(hull, 0) / FISH_HULL_LENGTH).toBeLessThan(0.02);
        });
    });

    it('keeps the tuna stiffer than the jack: its body still, its beat at the tail', () => {
        expect(amplitude(1, 0.7)).toBeLessThan(amplitude(0, 0.7) * 0.3);
        expect(amplitude(1, 1)).toBeLessThan(amplitude(0, 1));
    });
});

describe('the fish build for both backends', () => {
    const build = (mesh, forceWebGL) => {
        const scene = new THREE.Scene();
        scene.add(mesh);
        const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 6000);
        camera.position.set(-8, 150, 3);
        camera.updateMatrixWorld(true);
        mesh.updateMatrixWorld(true);
        const renderer = stubRenderer(forceWebGL);
        const heard = [];
        vi.spyOn(console, 'warn').mockImplementation((...a) => heard.push(a.join(' ')));
        vi.spyOn(console, 'error').mockImplementation((...a) => heard.push(a.join(' ')));
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
        if (!forceWebGL) {
            expect(unassignedReads(builder.vertexShader)).toEqual([]);
            expect(unassignedReads(builder.fragmentShader)).toEqual([]);
        }
        return { heard, vertex: builder.vertexShader, fragment: builder.fragmentShader };
    };

    [['WGSL', false], ['GLSL', true]].forEach(([label, forceWebGL]) => {
        it(`builds the schools (${label})`, () => {
            const said = [];
            vi.spyOn(console, 'warn').mockImplementation((...a) => said.push(a.join(' ')));
            vi.spyOn(console, 'error').mockImplementation((...a) => said.push(a.join(' ')));
            const fish = createFish();
            expect(said, 'while building the nodes').toEqual([]);
            vi.restoreAllMocks();
            const out = build(fish.mesh, forceWebGL);
            expect(out.heard).toEqual([]);
            // The swim bends the hull's own normal and hands it to the fragment.
            expect(out.vertex).toMatch(/vFishN/);
            expect(out.fragment).toMatch(/vFishN/);
            fish.dispose();
        });
    });
});

describe('the world draws the schools by the sea\'s rules', () => {
    const railSamples = Array.from({ length: 48 }, (_, i) => {
        const pt = getOdysseyPathPointAt(i / 47);
        return { x: pt.x, y: pt.y, z: pt.z };
    });
    const world = createOdysseyWorld({
        quality: 'low', forest: false, cloudField: false, railSamples,
    });
    const mesh = world.group.getObjectByName('odyssey-world-fish');

    it('is one mesh of the world, after the sea, behind the 1->2 steam', () => {
        expect(mesh).toBeTruthy();
        expect(world.stats.fish).toBe(FISH_COUNT);
        expect(mesh.geometry.instanceCount).toBe(FISH_COUNT);
        expect(mesh.material.depthNode).toBeTruthy();
        expect(mesh.renderOrder).toBe(2);
        expect(mesh.renderOrder).toBeLessThan(world.group.getObjectByName('odyssey-world-jellyfish').renderOrder);
    });

    it('comes in with the 1->2 carry and stays drawn under the water', () => {
        const rail = { x: -8, y: 150, z: 3 };
        world.setQuenchCarry(0.45);
        world.update(1, rail, 0.05, 130);
        expect(mesh.visible).toBe(false);
        world.setQuenchCarry(0.52);
        world.update(1.016, rail, 0.05, 130);
        expect(mesh.visible).toBe(true);
        world.update(1.03, rail, 0.05, 200);
        expect(mesh.visible).toBe(true);
    });
});
