/**
 * THE SPACE MASTERPIECE PASS (2026-10-31, docs/ODYSSEY_CH6_SPACE_MASTERPIECE_2026-10.md): the
 * traced black hole (odyssey-gargantua-lens.tsl.js), the Galaxy theme's disc and suns
 * (odyssey-spiral-galaxy*.js) and the orb path into the hole. The bakes are seeded and in range,
 * and every new material builds for WebGPU (WGSL) and the WebGL2 fallback (GLSL) on a device-less
 * renderer without a word.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    GARGANTUA_GAS, bakeGargantuaGas,
} from '../../src/rendering/odyssey/chapter-environments/odyssey-gargantua-gas.js';
import {
    GARGANTUA_HOLE, createGargantuaLensSteps,
} from '../../src/rendering/odyssey/chapter-environments/odyssey-gargantua-lens.tsl.js';
import {
    SPIRAL_GALAXY_NOISE, bakeSpiralGalaxyNoise,
} from '../../src/rendering/odyssey/chapter-environments/odyssey-spiral-galaxy-noise.js';
import { planSpiralGalaxySuns } from '../../src/rendering/odyssey/chapter-environments/odyssey-spiral-galaxy-suns.js';
import { createSpiralGalaxySteps } from '../../src/rendering/odyssey/chapter-environments/odyssey-spiral-galaxy.tsl.js';
import { createPathInflowTSL } from '../../src/rendering/odyssey/odyssey-path-renderer.tsl.js';
import { runChapterSteps } from '../../src/rendering/odyssey/chapter-environments/shared/chapter-build-steps.js';

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

describe('the space masterpiece bakes', () => {
    it('bakes the hole\'s gas deterministically, each channel over the full byte range', () => {
        const a = bakeGargantuaGas();
        const b = bakeGargantuaGas();
        expect(a.length).toBe(GARGANTUA_GAS.width * GARGANTUA_GAS.height * 4);
        expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
        for (let c = 0; c < 4; c += 1) {
            let lo = 255;
            let hi = 0;
            for (let i = c; i < a.length; i += 4) {
                lo = Math.min(lo, a[i]);
                hi = Math.max(hi, a[i]);
            }
            expect(lo, `channel ${c}`).toBe(0);
            expect(hi, `channel ${c}`).toBe(255);
        }
    });

    it('bakes the galaxy\'s grain in [0, 1] with a whole mip chain', () => {
        const { field, mips } = bakeSpiralGalaxyNoise();
        expect(field.length).toBe(SPIRAL_GALAXY_NOISE.size * SPIRAL_GALAXY_NOISE.size * 4);
        expect(mips[mips.length - 1].width).toBe(1);
        expect(mips.length).toBe(Math.log2(SPIRAL_GALAXY_NOISE.size) + 1);
        for (let i = 0; i < field.length; i += 97) {
            expect(field[i]).toBeGreaterThanOrEqual(0);
            expect(field[i]).toBeLessThanOrEqual(1);
        }
    });

    it('plans suns in four populations, mostly arms and disc, within the galaxy', () => {
        const plan = planSpiralGalaxySuns(4000);
        const tally = [0, 0, 0, 0];
        for (let i = 0; i < plan.count; i += 1) {
            tally[plan.look[(i * 4) + 2]] += 1;
            expect(plan.orbit[i * 4]).toBeGreaterThan(0);
            expect(plan.orbit[i * 4]).toBeLessThan(140);
            expect(plan.look[(i * 4) + 1]).toBeGreaterThanOrEqual(0);
            expect(plan.look[(i * 4) + 1]).toBeLessThanOrEqual(1);
        }
        expect(tally[0] / plan.count).toBeGreaterThan(0.38);
        expect(tally[1] / plan.count).toBeGreaterThan(0.32);
        expect(tally[2]).toBeGreaterThan(0);
        expect(tally[3]).toBeGreaterThan(0);
    });

    it('sizes the traced shadow as the chapter\'s own: the march sphere is BOUND / CRITICAL shadow radii', () => {
        const lens = runChapterSteps(createGargantuaLensSteps({ shadowRadius: 24 }));
        lens.mesh.geometry.computeBoundingSphere();
        const bound = 24 * (GARGANTUA_HOLE.BOUND / GARGANTUA_HOLE.CRITICAL);
        expect(lens.mesh.geometry.boundingSphere.radius).toBeCloseTo(bound, 3);
        lens.update(null, 0.016, 1);
        expect(lens.uniforms.rs.value).toBeCloseTo(24 / GARGANTUA_HOLE.CRITICAL, 5);
        lens.dispose();
    });
});

describe('the space masterpiece shaders build for both backends', () => {
    const build = (mesh, forceWebGL) => {
        const scene = new THREE.Scene();
        scene.add(mesh);
        const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 6000);
        camera.position.set(0, 40, 900);
        camera.updateMatrixWorld(true);
        mesh.updateMatrixWorld(true);
        const renderer = stubRenderer(forceWebGL);
        const heard = [];
        vi.spyOn(console, 'warn').mockImplementation((...a) => heard.push(a.join(' ')));
        vi.spyOn(console, 'error').mockImplementation((...a) => heard.push(a.join(' ')));
        const targets = [];
        mesh.traverse((o) => { if (o.isMesh) targets.push(o); });
        targets.forEach((target) => {
            const builder = renderer.backend.createNodeBuilder(target, renderer);
            builder.scene = scene;
            builder.material = target.material;
            builder.camera = camera;
            builder.context.material = target.material;
            builder.lightsNode = renderer.lighting.getNode(scene);
            builder.fogNode = null;
            builder.clippingContext = null;
            builder.build();
            expect(builder.fragmentShader.length, target.name).toBeGreaterThan(200);
            expect(builder.vertexShader).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
            expect(builder.fragmentShader).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
        });
        return heard;
    };

    [['WGSL', false], ['GLSL', true]].forEach(([label, forceWebGL]) => {
        it(`builds the traced hole (${label})`, () => {
            const lens = runChapterSteps(createGargantuaLensSteps({ shadowRadius: 24, uReveal: uniform(1) }));
            expect(build(lens.mesh, forceWebGL)).toEqual([]);
        });
        it(`builds the galaxy's disc and its suns (${label})`, () => {
            const galaxy = runChapterSteps(createSpiralGalaxySteps({ quality: 'low' }));
            expect(galaxy.mesh.children.length).toBe(1);
            expect(build(galaxy.mesh, forceWebGL)).toEqual([]);
        });
        it(`builds the orb path into the hole (${label})`, () => {
            const inflow = createPathInflowTSL(uniform(0), { segments: 16 });
            expect(build(inflow.mesh, forceWebGL)).toEqual([]);
        });
    });
});
