/**
 * Sunbraid — the atmosphere pass (docs/SUNBRAID_ATMOSPHERE_2026-10.md): what the gameplay does to the
 * picture through the post (the one white sun glares, noon closes the iris, a chain deepens the
 * colour), and the numbers the new shaders read. The look itself is judged in captures.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    POST_EVENTS, REST_RIG, SunbraidWorld, fovForAspect,
} from '../../src/themes/sunbraid/sunbraid-world.js';
import { BRAID_EVENTS } from '../../src/themes/sunbraid/sunbraid-braid.js';
import { FILMIC_KNEE } from '../../src/themes/sunbraid/sunbraid-post.js';
import { FLOOR_CRUST, SELENITE } from '../../src/themes/sunbraid/sunbraid-land.js';
import { TOWER_BEDS } from '../../src/themes/sunbraid/sunbraid-spires.js';
import { BED_LEDGE } from '../../src/themes/sunbraid/sunbraid-spire-shape.js';
import { CLOUD_FILL, MIST_LIGHT, SUN_LOOK } from '../../src/themes/sunbraid/sunbraid-tsl.js';

vi.setConfig({ testTimeout: 60_000 });

const START = 10;
let world;
let camera;

function stepTo(to, dt = 1 / 30) {
    const from = world.time;
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const time = from + i * h;
        world.updateCamera(camera, { time, delta: 0 });
        world.update({ time, delta: h }, camera);
    }
}

function begin(time = START) {
    world.seek(time);
    world.updateCamera(camera, { time, delta: 0 });
    world.update({ time, delta: 0 }, camera);
}

beforeAll(() => {
    const aspect = 16 / 9;
    camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    world = new SunbraidWorld({
        scene: new THREE.Scene(), quality: 'Minimal', capture: true, prepared: SunbraidWorld.prepareSync('Minimal'),
    }).build();
    world.bindCamera(camera);
    world.setViewport(1600, 900, aspect);
});

afterAll(() => world?.dispose());

describe('Sunbraid atmosphere: the post answers the braid', () => {
    it('rests at the plain grade: no glare, no flash, the iris open', () => {
        begin();
        stepTo(START + 2);
        const post = world.getPostState();
        expect(post.bloomBoost).toBe(0);
        expect(post.flash).toBe(0);
        expect(post.exposure).toBe(1);
        expect(post.saturation).toBeCloseTo(POST_EVENTS.saturation, 9);
    });

    it('glares and flashes with the one white sun of four lines, and lets it go as the suns part', () => {
        begin();
        world.onClear({ lines: 4, combo: 1 });
        const c = BRAID_EVENTS.conjunction;
        stepTo(START + c.close + c.hold * 0.5);
        const post = world.getPostState();
        expect(world.white).toBeCloseTo(1, 6);
        expect(post.bloomBoost).toBeCloseTo(POST_EVENTS.whiteGlare, 6);
        expect(post.flash).toBeCloseTo(POST_EVENTS.whiteFlash, 6);
        stepTo(START + c.close + c.hold + c.part + c.settle + 0.5);
        expect(post.bloomBoost).toBeLessThan(0.01);
        expect(post.flash).toBeLessThan(0.01);
    });

    it('closes the iris and glares at noon (a perfect clear), and opens it again', () => {
        begin();
        world.onClear({ lines: 1, perfect: true });
        const n = BRAID_EVENTS.noon;
        stepTo(START + n.rise + n.hold * 0.5);
        const post = world.getPostState();
        expect(post.exposure).toBeCloseTo(1 - POST_EVENTS.noonIris, 2);
        expect(post.bloomBoost).toBeGreaterThan(POST_EVENTS.noonGlare * 0.9);
        stepTo(START + n.rise + n.hold + n.sink + 1);
        expect(post.exposure).toBeCloseTo(1, 3);
    });

    it('deepens the colour with a chain\'s ribbons, and only by its lift', () => {
        begin();
        for (let k = 1; k <= 6; k++) {
            world.onClear({ lines: 1, combo: k });
            world.onCombo(k);
            stepTo(world.time + 0.8);
        }
        stepTo(world.time + 3);
        const post = world.getPostState();
        expect(post.saturation).toBeGreaterThan(POST_EVENTS.saturation + POST_EVENTS.chainSaturation * 0.5);
        expect(post.saturation).toBeLessThanOrEqual(POST_EVENTS.saturation + POST_EVENTS.chainSaturation + 1e-9);
        world.onCombo(0);
    });

    it('never flashes harder, or opens the iris wider, than its constants allow', () => {
        expect(POST_EVENTS.whiteFlash).toBeLessThanOrEqual(0.5);
        expect(POST_EVENTS.noonIris).toBeGreaterThan(0);
        expect(POST_EVENTS.noonIris).toBeLessThan(0.5);
    });
});

describe('Sunbraid atmosphere: the numbers the shaders read', () => {
    it('keeps the tone, the mist, the sky and the suns in sensible ranges', () => {
        expect(FILMIC_KNEE).toBeGreaterThan(0.3);
        expect(FILMIC_KNEE).toBeLessThan(1);
        expect(MIST_LIGHT.sun).toBeGreaterThan(0);
        expect(MIST_LIGHT.sky).toBeGreaterThan(0);
        expect(CLOUD_FILL.zenith).toBeLessThan(0.9);
        expect(SUN_LOOK.core).toBeGreaterThan(SUN_LOOK.rim);
    });

    it('keeps the crust, the selenite and the stone in sensible ranges', () => {
        expect(FLOOR_CRUST.cell).toBeGreaterThan(5);
        expect(FLOOR_CRUST.ridge).toBeLessThan(0.5);
        expect(FLOOR_CRUST.fade[0]).toBeLessThan(FLOOR_CRUST.fade[1]);
        expect(FLOOR_CRUST.relief[0]).toBeLessThan(FLOOR_CRUST.relief[1]);
        expect(FLOOR_CRUST.near).toBeLessThan(FLOOR_CRUST.far);
        expect(SELENITE.share).toBeGreaterThan(0);
        expect(SELENITE.share).toBeLessThan(0.07);
        expect(TOWER_BEDS.formation).toBeGreaterThan(TOWER_BEDS.bed);
        expect(TOWER_BEDS.contrast).toBeGreaterThan(0);
        expect(TOWER_BEDS.contrast).toBeLessThanOrEqual(1);
        expect(BED_LEDGE).toBeGreaterThan(0);
        expect(BED_LEDGE).toBeLessThan(0.026);
    });
});
