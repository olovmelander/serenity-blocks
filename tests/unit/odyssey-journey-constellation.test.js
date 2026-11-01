/**
 * THE JOURNEY IN THE SKY (2026-11-01, chapter-environments/shared/odyssey-journey-constellation*.js):
 * the finale's constellation of every orb. The figure is the path's own shape, climbing from the
 * first orb to the last inside its patch of sky; a star's light follows the player's progress; the
 * line draws itself only at the journey's end and is taken back once the eye leaves; and both
 * materials build for WebGPU (WGSL) and the WebGL2 fallback (GLSL) without a word.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    JOURNEY_CONSTELLATION, advanceJourneyDrawing, journeyStarDirection, journeyStarLight, planJourneyConstellation,
} from '../../src/rendering/odyssey/chapter-environments/shared/odyssey-journey-constellation.js';
import {
    createJourneyConstellation,
} from '../../src/rendering/odyssey/chapter-environments/shared/odyssey-journey-constellation.tsl.js';
import { buildOdysseyPresentationLayout } from '../../src/core/odyssey/data/odyssey-layout.js';

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

/** The real journey's orbs: their places on the real path's control polyline, in order. */
function journeyPoints() {
    const layout = buildOdysseyPresentationLayout();
    const curve = new THREE.CatmullRomCurve3(layout.controlPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
    return Object.entries(layout.levelPositionsById)
        .sort((a, b) => a[1] - b[1])
        .map(([id, p]) => ({ id: Number(id), position: curve.getPointAt(p) }));
}

afterEach(() => { vi.restoreAllMocks(); });

describe('the journey constellation plan', () => {
    it('climbs from the first orb (the foot) to the last (the top), inside its patch of sky', () => {
        const orbs = journeyPoints();
        expect(orbs.length).toBe(60);
        const plan = planJourneyConstellation(orbs.map((o) => o.position));
        expect(plan.y[0]).toBeCloseTo(0, 5);
        expect(plan.y[plan.count - 1]).toBeGreaterThan(0.95);
        let left = Infinity;
        let right = -Infinity;
        for (let i = 0; i < plan.count; i += 1) {
            left = Math.min(left, plan.x[i]);
            right = Math.max(right, plan.x[i]);
            expect(plan.y[i]).toBeGreaterThanOrEqual(0);
            expect(plan.y[i]).toBeLessThanOrEqual(1);
        }
        // A figure, not a line: wider than a tenth of its height, never past its width.
        const [foot, top] = JOURNEY_CONSTELLATION.elevation;
        expect(right - left).toBeGreaterThan(0.1 * (top - foot));
        expect(right - left).toBeLessThanOrEqual(JOURNEY_CONSTELLATION.maxWidth + 1e-3);
        // The journey starts on the left.
        expect(plan.x[0]).toBeLessThan(plan.x[plan.count - 1]);
    });

    it('seats every star above the horizon and down the canyon, on unit directions', () => {
        const plan = planJourneyConstellation(journeyPoints().map((o) => o.position));
        for (let i = 0; i < plan.count; i += 1) {
            const [x, y, z] = journeyStarDirection(plan.x[i], plan.y[i]);
            expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
            expect(Math.asin(y) * (180 / Math.PI)).toBeGreaterThanOrEqual(JOURNEY_CONSTELLATION.elevation[0] - 1e-6);
            expect(z).toBeLessThan(0);
        }
    });

    it('lights a star by the player\'s progress on its orb', () => {
        expect(journeyStarLight(null)).toBe(JOURNEY_CONSTELLATION.unfinished);
        expect(journeyStarLight({ completed: false, stars: 3 })).toBe(JOURNEY_CONSTELLATION.unfinished);
        const one = journeyStarLight({ completed: true, stars: 1 });
        const three = journeyStarLight({ completed: true, stars: 3 });
        expect(one).toBeGreaterThan(JOURNEY_CONSTELLATION.unfinished * 3);
        expect(three).toBeGreaterThan(one);
        expect(three).toBe(1);
    });

    it('draws the line only at the journey\'s end, takes it back once the eye leaves, whole under reduced motion', () => {
        const state = { drawn: 0 };
        expect(advanceJourneyDrawing(state, 0.5, 1)).toBe(0);
        let drawn = 0;
        for (let t = 0; t < JOURNEY_CONSTELLATION.drawSeconds / 2; t += 0.1) {
            drawn = advanceJourneyDrawing(state, 1, 0.1);
        }
        expect(drawn).toBeGreaterThan(0.4);
        expect(drawn).toBeLessThan(0.6);
        // Held while the eye stays near the end, even a little back from it.
        expect(advanceJourneyDrawing(state, 0.6, 0.1)).toBeCloseTo(drawn, 6);
        expect(advanceJourneyDrawing(state, 0.1, 0.1)).toBe(0);
        expect(advanceJourneyDrawing(state, 1, 0.016, { reducedMotion: true })).toBe(1);
    });
});

describe('the journey constellation builds for both backends', () => {
    [['WGSL', false], ['GLSL', true]].forEach(([label, forceWebGL]) => {
        it(`builds the stars and the line (${label})`, () => {
            const constellation = createJourneyConstellation({ count: 60 });
            const orbs = journeyPoints().map((o, i) => ({
                ...o, colour: [1, 0.6, 0.2], completed: i < 40, stars: i % 4,
            }));
            constellation.setChart(orbs);
            const scene = new THREE.Scene();
            scene.add(constellation.group);
            const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 6000);
            camera.updateMatrixWorld(true);
            constellation.group.updateMatrixWorld(true);
            const renderer = stubRenderer(forceWebGL);
            const heard = [];
            vi.spyOn(console, 'warn').mockImplementation((...a) => heard.push(a.join(' ')));
            vi.spyOn(console, 'error').mockImplementation((...a) => heard.push(a.join(' ')));
            constellation.group.children.forEach((mesh) => {
                const builder = renderer.backend.createNodeBuilder(mesh, renderer);
                builder.scene = scene;
                builder.material = mesh.material;
                builder.camera = camera;
                builder.context.material = mesh.material;
                builder.lightsNode = renderer.lighting.getNode(scene);
                builder.fogNode = null;
                builder.clippingContext = null;
                builder.build();
                expect(builder.fragmentShader.length, mesh.name).toBeGreaterThan(200);
                expect(builder.vertexShader).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                expect(builder.fragmentShader).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
            });
            expect(heard).toEqual([]);
            constellation.dispose();
        });
    });
});
