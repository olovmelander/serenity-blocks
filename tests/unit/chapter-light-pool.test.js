/**
 * Chapter light pool — the rendered light SET is constant for the whole Odyssey session
 * (docs/R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md item 2.9).
 *
 * three hashes each light's id into every material's builder key (LightsNode.customCacheKey), so a
 * chapter that constructs its own VISIBLE lights when it is created in the background invalidates
 * every visible pipeline. The pool makes chapter lights virtual and renders a fixed set of rig
 * slots sized to two blending chapters. The manifest is a contract: this test builds every chapter
 * through its real `create*Environment` and asserts it acquired exactly its manifest and left no
 * visible light behind — either would bring the 2–3 s post-reveal stalls back silently.
 */

import {
    describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    CHAPTER_LIGHT_MANIFEST, deriveRigSlots, seedChapterLightPool, acquireChapterLight,
    releaseChapterLights, syncChapterLightSlots, getChapterLightPool, resetChapterLightPoolForTests,
} from '../../src/rendering/odyssey/chapter-environments/shared/chapter-light-pool.js';
import { CHAPTER_SCENES } from '../../src/rendering/odyssey/chapter-environments/registry.js';

// Chapters bake canvas textures at build; the existing earth-core test stubs `document` the same way.
function stubCanvas() {
    const gradient = { addColorStop: vi.fn() };
    const context = {
        createRadialGradient: vi.fn(() => gradient),
        createLinearGradient: vi.fn(() => gradient),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        fillStyle: null,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        scale: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        closePath: vi.fn(),
        ellipse: vi.fn(),
        quadraticCurveTo: vi.fn(),
        bezierCurveTo: vi.fn(),
        clearRect: vi.fn(),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
        putImageData: vi.fn(),
        drawImage: vi.fn(),
        setTransform: vi.fn(),
    };
    vi.stubGlobal('document', {
        createElement: vi.fn(() => ({
            width: 0, height: 0, getContext: vi.fn(() => context), style: {},
        })),
    });
}

const rigIds = (rig) => rig.children.filter((c) => c.isLight).map((l) => l.id).join(',');

describe('chapter light pool', () => {
    beforeEach(() => { resetChapterLightPoolForTests(); stubCanvas(); });
    afterEach(() => { resetChapterLightPoolForTests(); vi.unstubAllGlobals(); });

    it('sizes the rig slots to the largest ADJACENT chapter pair, with one merged ambient', () => {
        const slots = deriveRigSlots();
        // ch5 (3 point) + ch6 (1 point) = 4; ch3 (1 dir) + ch4 (2 dir) = 3; hemisphere only in ch3.
        expect(slots).toEqual({
            AmbientLight: 1, HemisphereLight: 1, DirectionalLight: 3, PointLight: 4, SpotLight: 0,
        });
        const rig = new THREE.Group();
        seedChapterLightPool(rig);
        expect(rig.children.length).toBe(9); // vs 18 chapter lights resident before
        expect(rig.children.every((l) => l.isLight && l.intensity === 0)).toBe(true);
        expect(seedChapterLightPool(rig)).toBe(getChapterLightPool()); // idempotent per rig
        expect(rig.children.length).toBe(9);
    });

    it('acquire returns a VIRTUAL light the chapter can use as before; it never enters the render list', () => {
        const rig = new THREE.Group();
        const pool = seedChapterLightPool(rig);
        const before = rigIds(rig);
        const lava = acquireChapterLight(1, 'PointLight', { color: 0xff5511, intensity: 2.9, distance: 150 });
        expect(lava.isPointLight).toBe(true);
        expect(lava.intensity).toBe(2.9);
        expect(lava.distance).toBe(150);
        expect(lava.color.getHex()).toBe(0xff5511);
        expect(lava.visible).toBe(false); // virtual
        expect(lava.userData.pooled).toBe(true);
        expect(rig.children).not.toContain(lava);
        expect(rigIds(rig)).toBe(before);
        expect(pool.virtual.get(1)).toEqual([lava]);
        releaseChapterLights(1);
        expect(pool.virtual.has(1)).toBe(false);
        expect(rigIds(rig)).toBe(before);
    });

    it('records an acquisition outside the manifest (still virtual, so the key cannot churn)', () => {
        const rig = new THREE.Group();
        const pool = seedChapterLightPool(rig);
        acquireChapterLight(1, 'AmbientLight', { intensity: 1 });
        acquireChapterLight(1, 'PointLight', { intensity: 1 });
        acquireChapterLight(1, 'PointLight', { intensity: 1 });
        const extra = acquireChapterLight(1, 'SpotLight', { intensity: 1 });
        expect(extra.visible).toBe(false);
        expect(pool.fallbacks).toEqual([{ chapterId: 1, type: 'SpotLight', index: 3 }]);
    });

    it('without a seeded pool (plain chapter builds in tests) acquire constructs ordinary lights', () => {
        const light = acquireChapterLight(4, 'DirectionalLight', { color: 0xfff4e0, intensity: 0.95 });
        expect(light.isDirectionalLight).toBe(true);
        expect(light.visible).toBe(true);
        expect(light.intensity).toBe(0.95);
        expect(getChapterLightPool()).toBeNull();
    });

    it('sync writes the active chapters into the slots: weight, world placement, merged ambient, dark leftovers', () => {
        const env = new THREE.Group();
        env.position.set(100, 0, 0);
        const rig = new THREE.Group();
        env.add(rig);
        const pool = seedChapterLightPool(rig);
        // Chapter 5: ambient + 3 point lights in a group offset in world.
        const g5 = new THREE.Group();
        g5.position.set(0, 0, -500);
        env.add(g5);
        const a5 = acquireChapterLight(5, 'AmbientLight', { color: 0x9fc4e8, intensity: 0.6 });
        const p1 = acquireChapterLight(5, 'PointLight', { color: 0x9933ff, intensity: 0.12, distance: 400 });
        const p2 = acquireChapterLight(5, 'PointLight', { color: 0x3399ff, intensity: 0.10, distance: 400 });
        const p3 = acquireChapterLight(5, 'PointLight', { color: 0xffe4b8, intensity: 0.6, distance: 600 });
        p1.position.set(-50, 40, -100);
        g5.add(a5, p1, p2, p3);
        // Chapter 6: ambient + point + directional.
        const g6 = new THREE.Group();
        env.add(g6);
        const a6 = acquireChapterLight(6, 'AmbientLight', { color: 0x141425, intensity: 0.5 });
        const disk = acquireChapterLight(6, 'PointLight', { color: 0xff6a2a, intensity: 1.1, distance: 600 });
        const rim = acquireChapterLight(6, 'DirectionalLight', { color: 0x6a4cff, intensity: 0.4 });
        rim.position.set(-60, 50, -200);
        g6.add(a6, disk, rim);
        env.updateMatrixWorld(true);

        syncChapterLightSlots([{ chapterId: 5, weight: 1 }, { chapterId: 6, weight: 0.5 }]);
        const { slots } = pool;
        // Four point slots filled: ch5's three at weight 1, ch6's disk at 0.5.
        expect(slots.PointLight.map((l) => +l.intensity.toFixed(3))).toEqual([0.12, 0.10, 0.6, 0.55]);
        expect(slots.PointLight[0].color.getHex()).toBe(0x9933ff);
        expect(slots.PointLight[0].distance).toBe(400);
        // World placement of p1 = g5 (0,0,-500) + (-50,40,-100) → rig-local (rig under env at x=100).
        expect(slots.PointLight[0].position.toArray().map((v) => +v.toFixed(3))).toEqual([-50, 40, -600]);
        // Directional: one used (ch6 rim at 0.5), two dark.
        expect(slots.DirectionalLight.map((l) => +l.intensity.toFixed(3))).toEqual([0.2, 0, 0]);
        expect(slots.DirectionalLight[0].position.toArray()).toEqual([-60, 50, -200]);
        // Merged ambient: 0.6·c5 + 0.25·c6 → intensity 0.85, colour the intensity-weighted mean.
        const amb = slots.AmbientLight[0];
        expect(amb.intensity).toBeCloseTo(0.85, 6);
        const expected = new THREE.Color(0x9fc4e8).multiplyScalar(0.6)
            .add(new THREE.Color(0x141425).multiplyScalar(0.25)).multiplyScalar(1 / 0.85);
        expect(amb.color.r).toBeCloseTo(expected.r, 6);
        expect(amb.color.b).toBeCloseTo(expected.b, 6);
        expect(slots.HemisphereLight[0].intensity).toBe(0);
        // The virtual lights were never scaled in place (no compounding across frames).
        expect(p1.intensity).toBe(0.12);
        expect(disk.intensity).toBe(1.1);
        // Chapter 6 fades out → its slots go dark, ch5's stay.
        syncChapterLightSlots([{ chapterId: 5, weight: 1 }]);
        expect(slots.PointLight.map((l) => +l.intensity.toFixed(3))).toEqual([0.12, 0.10, 0.6, 0]);
        expect(slots.DirectionalLight[0].intensity).toBe(0);
        expect(slots.AmbientLight[0].intensity).toBeCloseTo(0.6, 6);
        // Overflow is counted and warned once, never thrown.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const g1 = new THREE.Group();
        env.add(g1);
        g1.add(
            acquireChapterLight(1, 'AmbientLight', { intensity: 0.1 }),
            acquireChapterLight(1, 'PointLight', { intensity: 1 }),
            acquireChapterLight(1, 'PointLight', { intensity: 1 }),
        );
        syncChapterLightSlots([{ chapterId: 5, weight: 1 }, { chapterId: 6, weight: 1 }, { chapterId: 1, weight: 1 }]);
        expect(pool.overflow).toBe(2);
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('EVERY chapter acquires exactly its manifest and leaves no visible light behind (the contract)', async () => {
        const rig = new THREE.Group();
        const pool = seedChapterLightPool(rig);
        const idsBefore = rigIds(rig);
        // eslint-disable-next-line no-restricted-syntax
        for (const scene of CHAPTER_SCENES) {
            // eslint-disable-next-line no-await-in-loop -- chapters must build one at a time (shared pool)
            const mod = await scene.load();
            const createName = Object.keys(mod).find((k) => /^create[A-Za-z]+Environment$/.test(k));
            expect(createName, `${scene.sceneId} exports a create*Environment`).toBeTruthy();
            const fallbacksBefore = pool.fallbacks.length;
            const group = mod[createName]({ particleCount: 64 });
            expect(group?.isObject3D, `${scene.sceneId} returns a group`).toBe(true);
            const manifest = CHAPTER_LIGHT_MANIFEST[scene.id] || [];
            const acquired = (pool.virtual.get(scene.id) || []).map((l) => l.userData.chapterVirtualLight.type);
            expect(pool.fallbacks.slice(fallbacksBefore), `${scene.sceneId} acquired outside its manifest`).toEqual([]);
            expect(acquired, `${scene.sceneId} does not match its manifest`).toEqual([...manifest]);
            // No chapter may construct a VISIBLE light behind the pool's back.
            const stray = [];
            group.traverse((o) => { if (o.isLight && o.visible) stray.push(o.type); });
            expect(stray, `${scene.sceneId} constructs visible lights directly: ${stray.join(',')}`).toEqual([]);
            releaseChapterLights(scene.id);
        }
        expect(rigIds(rig)).toBe(idsBefore);
        expect(pool.overflow).toBe(0);
    }, 120_000);
});
