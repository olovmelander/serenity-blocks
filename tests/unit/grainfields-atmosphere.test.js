/**
 * Grainfields — the atmosphere pass (docs/GRAINFIELDS_ATMOSPHERE_2026-10.md): the storm's sun gap
 * that swings off the eye (sun and shade sweeping the field), the rain hanging under the storm's
 * core, the close stand planted for the portrait lens, and the ears by the lens. The look itself
 * is judged in captures; these hold the behaviour and the contracts.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadGrainfieldsAssets } from '../../src/themes/grainfields/grainfields-assets.js';
import {
    GrainfieldsWorld, REST_RIG, SUN_GAP_SWING, fovForAspect, sunGapSwing,
} from '../../src/themes/grainfields/grainfields-world.js';
import {
    CLOSE_STAND, GRAIN_BEARINGS, grainCover, grainSites,
} from '../../src/themes/grainfields/grainfields-plan.js';
import { BLAZE_CAP, CLOSE_BAND, createGrain } from '../../src/themes/grainfields/grainfields-grain.js';
import { LENS_BLUR, LENS_EARS, createLensEars } from '../../src/themes/grainfields/grainfields-lens.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/grainfields/grainfields-quality.js';
import { RAIN } from '../../src/themes/grainfields/grainfields-post.js';
import { WALL } from '../../src/themes/grainfields/grainfields-lapporten.js';
import { createNoiseTexture, createUniforms } from '../../src/themes/grainfields/grainfields-tsl.js';
import { EYE } from '../../src/themes/grainfields/grainfields-core.js';
import { HOURS } from '../../src/themes/grainfields/grainfields-hours.js';

vi.setConfig({ testTimeout: 60_000 });

const STORM = 0;
const GOLDEN = 1;
const MORNING = 4;

describe('Grainfields atmosphere: the storm\'s sun gap swings off the eye', () => {
    it('holds the gap on the eye under a light deck and while a chain breaks the storm', () => {
        for (let t = 0; t < 300; t += 7) {
            expect(sunGapSwing(t, HOURS[GOLDEN].cover)).toBe(0);
            expect(sunGapSwing(t, HOURS[MORNING].cover)).toBe(0);
            expect(sunGapSwing(t, HOURS[STORM].cover, 1)).toBe(0);
        }
    });

    it('swings it under the storm, from close to the eye at the start of a run out past its clear heart', () => {
        const at = (t) => sunGapSwing(t, HOURS[STORM].cover);
        // A run opens with the field in the sun: the swing starts at its least.
        expect(at(0)).toBeLessThan(0.1);
        let lo = Infinity;
        let hi = -Infinity;
        let jump = 0;
        let previous = at(0);
        for (let t = 0; t <= 400; t += 0.1) {
            const s = at(t);
            lo = Math.min(lo, s);
            hi = Math.max(hi, s);
            jump = Math.max(jump, Math.abs(s - previous));
            previous = s;
        }
        expect(lo).toBeGreaterThanOrEqual(0);
        // Out past the clear heart (a third of the radius) into the torn edge, never wholly away.
        expect(hi).toBeGreaterThan(0.7);
        expect(hi).toBeLessThanOrEqual(SUN_GAP_SWING.rest + SUN_GAP_SWING.sway + SUN_GAP_SWING.flicker + 1e-9);
        // Slowly: no step a tenth of a second long moves it a twentieth of the radius.
        expect(jump).toBeLessThan(0.05);
    });
});

describe('Grainfields atmosphere: the world', () => {
    let world;
    let camera;
    let assets;
    const step = (from, to, dt = 1 / 15) => {
        for (let t = from + dt; t <= to + 1e-9; t += dt) {
            world.updateCamera(camera, { time: t, delta: dt });
            world.update({ time: t, delta: dt }, camera);
        }
    };

    beforeAll(async () => {
        const directory = new URL('../../src/themes/grainfields/assets/', import.meta.url);
        const loader = {
            loadAsync: async (url) => {
                const name = decodeURIComponent(new URL(url).pathname.split('/').pop());
                const bytes = readFileSync(new URL(name, directory));
                return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
            },
        };
        const textureLoader = { loadAsync: async () => new THREE.DataTexture(new Uint8Array(16), 2, 2) };
        assets = await loadGrainfieldsAssets({ loader, textureLoader });
        const prepared = { ...GrainfieldsWorld.prepareSync('Minimal'), assets };
        const aspect = 16 / 9;
        camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
        world = new GrainfieldsWorld({
            scene: new THREE.Scene(), quality: 'Minimal', capture: true, prepared,
        }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, aspect);
        world.seek(10);
    });

    afterAll(() => world?.dispose());

    it('hangs rain under the storm\'s core at the storm break, none in the golden hour, and a chain stops it', () => {
        world.setCaptureOverrides({ hour: STORM });
        step(10, 11);
        expect(world.u.rain.value).toBeGreaterThan(0.5);
        world.setCaptureOverrides({ hour: GOLDEN });
        step(11, 12);
        expect(world.u.rain.value).toBe(0);
        world.setCaptureOverrides({ hour: STORM });
        step(12, 13);
        for (let n = 1; n <= 4; n++) {
            world.onClear({ lines: 1, combo: n });
            world.onCombo(n);
            step(world.time, world.time + 1.2);
        }
        expect(world.u.rain.value).toBeLessThan(0.05);
        world.onCombo(0);
        world.setCaptureOverrides({ hour: null });
        world.seek(10);
    });

    it('draws the close stand only under the portrait lens', () => {
        const { grain } = world.parts;
        expect(grain.close.length).toBeGreaterThan(0);
        expect(grain.counts.close).toBeGreaterThan(0);
        const shown = () => grain.close.every((mesh) => mesh.visible);
        const hidden = () => grain.close.every((mesh) => !mesh.visible);
        expect(hidden()).toBe(true);
        world.setViewport(430, 932, 430 / 932);
        expect(shown()).toBe(true);
        step(world.time, world.time + 0.2);
        expect(shown()).toBe(true);
        for (const [w, h] of [[1000, 1000], [1600, 900], [2560, 1080]]) {
            world.setViewport(w, h, w / h);
            expect(hidden(), `${w}x${h}`).toBe(true);
        }
        // A capture showing every part never shows it under another lens.
        world.showOnlyParts(['grain']);
        step(world.time, world.time + 0.1);
        expect(hidden()).toBe(true);
        world.showOnlyParts(['grain', 'land', 'lapporten', 'fort', 'trees', 'herd', 'geese', 'sky', 'beams', 'motes', 'lens']);
        world.setViewport(1600, 900, 16 / 9);
    });

    it('puts the ears by the lens in the scene, drawn over everything and never into the depth', () => {
        const { lens } = world.parts;
        expect(lens.count).toBe(QUALITY.Minimal.lens);
        lens.meshes.forEach((mesh) => {
            expect(mesh.parent).toBe(world.root);
            expect(mesh.material.depthWrite).toBe(false);
            expect(mesh.material.transparent).toBe(true);
            expect(mesh.renderOrder).toBeGreaterThan(world.parts.motes.meshes[0].renderOrder);
        });
    });
});

describe('Grainfields atmosphere: the close stand', () => {
    const sites = grainSites({
        count: 400,
        near: CLOSE_STAND.near,
        far: CLOSE_STAND.far,
        knee: CLOSE_STAND.far,
        bearings: CLOSE_STAND.bearings,
        bank: false,
        fade: false,
        seed: 0x6a7d,
    });

    it('plants the clearing round the eye inside the portrait\'s bearings, whole to its edge', () => {
        expect(sites.count).toBeGreaterThan(300);
        const [b0, b1] = CLOSE_STAND.bearings;
        let nearest = Infinity;
        for (let i = 0; i < sites.count; i++) {
            const x = sites.data[i * 8];
            const z = sites.data[i * 8 + 2];
            const r = Math.hypot(x - EYE.x, z - EYE.z);
            const bearing = Math.atan2(x - EYE.x, -(z - EYE.z)) / (Math.PI / 180);
            expect(r).toBeGreaterThanOrEqual(CLOSE_STAND.near - 1e-6);
            expect(r).toBeLessThanOrEqual(CLOSE_STAND.far + 1e-6);
            expect(bearing).toBeGreaterThanOrEqual(b0 - 1e-6);
            expect(bearing).toBeLessThanOrEqual(b1 + 1e-6);
            expect(sites.data[i * 8 + 7]).toBe(1);
            nearest = Math.min(nearest, r);
        }
        // It reaches into the clearing the main stand keeps.
        expect(nearest).toBeLessThan(1.6);
        expect(grainCover(EYE.x, EYE.z - 1.15)).toBe(0);
        expect(grainCover(EYE.x, EYE.z - 1.15, { bank: false })).toBeGreaterThan(0);
        // The main stand's own sites are untouched by the new options' defaults.
        const main = grainSites({
            count: 200, near: 2.5, far: 30, knee: 7, seed: 0x6a7e,
        });
        for (let i = 0; i < main.count; i++) {
            const x = main.data[i * 8];
            const z = main.data[i * 8 + 2];
            const bearing = Math.atan2(x - EYE.x, -(z - EYE.z)) / (Math.PI / 180);
            expect(bearing >= GRAIN_BEARINGS[0] - 1e-6 && bearing <= GRAIN_BEARINGS[1] + 1e-6).toBe(true);
        }
    });

    it('is drawn first (nearest), hidden until the lens asks for it, and counted apart', () => {
        const u = createUniforms();
        const t = { noise: createNoiseTexture() };
        const near = grainSites({
            count: 600, near: 2.5, far: 18, knee: 7, seed: 0x6a7e,
        });
        const far = grainSites({
            count: 300, near: 17, far: 135, seed: 0x6a7f,
        });
        const grain = createGrain(u, t, { near, far, close: sites }, { coverage: true });
        expect(grain.close).toHaveLength(2);
        expect(grain.counts).toEqual({ near: near.count, far: far.count, close: sites.count });
        expect(grain.mesh).not.toBe(grain.close[0]);
        const others = grain.meshes.filter((mesh) => !grain.close.includes(mesh));
        grain.close.forEach((mesh) => {
            expect(mesh.visible).toBe(false);
            expect(mesh.name).toContain(CLOSE_BAND.field);
            others.forEach((other) => expect(mesh.renderOrder).toBeLessThan(other.renderOrder));
        });
        grain.setClose(true);
        grain.close.forEach((mesh) => expect(mesh.visible).toBe(true));
        grain.setClose(false);
        grain.close.forEach((mesh) => expect(mesh.visible).toBe(false));
        grain.dispose();
    });
});

describe('Grainfields atmosphere: the ears by the lens', () => {
    it('stand in the frame\'s bottom corners, clear of the board between them', () => {
        expect(LENS_EARS.length).toBeGreaterThanOrEqual(4);
        LENS_EARS.forEach((ear) => {
            expect(Math.abs(ear.x)).toBeGreaterThan(0.6);
            expect(ear.y).toBeLessThan(-0.6);
            expect(ear.depth).toBeGreaterThan(0.5);
            expect(ear.depth).toBeLessThan(2.2);
        });
        // As many on the left as on the right.
        expect(LENS_EARS.filter((ear) => ear.x < 0).length).toBe(LENS_EARS.filter((ear) => ear.x > 0).length);
        expect(LENS_BLUR.coc).toBeGreaterThan(0);
        expect(LENS_BLUR.light).toBeLessThan(1);
    });

    it('takes as many ears as the tier allows, fewer on the lighter tiers', () => {
        const u = createUniforms();
        const t = { noise: createNoiseTexture() };
        let previous = Infinity;
        QUALITY_NAMES.forEach((name) => {
            const n = QUALITY[name].lens;
            expect(Number.isInteger(n), name).toBe(true);
            expect(n, name).toBeLessThanOrEqual(previous);
            previous = n;
            const lens = createLensEars(u, t, { count: n });
            expect(lens.count).toBe(Math.min(n, LENS_EARS.length));
            expect(lens.mesh.geometry.instanceCount).toBe(lens.count);
            lens.dispose();
        });
    });
});

describe('Grainfields atmosphere: the numbers the shaders read', () => {
    it('keeps the rain and the walls\' texture in sensible ranges', () => {
        expect(RAIN.part[0]).toBeLessThan(RAIN.part[1]);
        expect(RAIN.density).toBeGreaterThan(0);
        // Rain a kilometre deep in a curtain's heart veils, but never blacks out, what lies behind.
        expect(Math.exp(-RAIN.density * 1000)).toBeGreaterThan(0.4);
        expect(RAIN.near).toBeGreaterThan(1000);
        expect(WALL.ledge.spacing).toBeGreaterThan(10);
        expect(WALL.streak.across).toBeLessThan(WALL.streak.along);
    });

    it('caps the blaze softly: a brighter ear stays brighter, and none reaches the top', () => {
        const cap = (peak) => {
            const over = Math.max(peak - BLAZE_CAP.knee, 0);
            return Math.min(peak, BLAZE_CAP.knee + over / (over / (BLAZE_CAP.top - BLAZE_CAP.knee) + 1));
        };
        expect(cap(1)).toBe(1);
        expect(cap(BLAZE_CAP.knee)).toBe(BLAZE_CAP.knee);
        let previous = 0;
        for (let p = 0.5; p < 40; p += 0.25) {
            const c = cap(p);
            expect(c).toBeGreaterThan(previous);
            expect(c).toBeLessThan(BLAZE_CAP.top);
            previous = c;
        }
    });
});
