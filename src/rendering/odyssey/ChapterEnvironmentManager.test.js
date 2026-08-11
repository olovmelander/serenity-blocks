import * as THREE from 'three/webgpu';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { ChapterEnvironmentManager } from './ChapterEnvironmentManager.js';

describe('ChapterEnvironmentManager atmosphere seams', () => {
    const chapterPositions = [0, 0.13, 0.21, 0.36, 0.5, 0.65, 0.81, 0.94, 1];

    it('bridges scene fog through the Surface to Mountains boundary', () => {
        const scene = new THREE.Scene();
        const renderer = { setClearColor: vi.fn() };
        const manager = new ChapterEnvironmentManager(scene, renderer, { chapterPositions });

        manager.updateGlobalEnvironment(0.36);

        expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
        expect(scene.fog.color.getHex()).toBe(0x638699);
        expect(scene.fog.density).toBeCloseTo(0.0024, 5);
        expect(renderer.setClearColor).toHaveBeenCalled();
        expect(renderer.setClearColor.mock.calls.at(-1)[0].getHex()).toBe(0x527da2);
    });
});

describe('ChapterEnvironmentManager 5-6 earth-at-summit ignite', () => {
    // Live layout: ch5 0.556 -> ch6 0.648 -> ch7 0.815.
    const chapterPositions = [0, 0.093, 0.204, 0.389, 0.556, 0.648, 0.815, 0.944, 1];
    const makeManager = () => new ChapterEnvironmentManager(
        new THREE.Scene(),
        { setClearColor: vi.fn() },
        { chapterPositions },
    );

    it('ignites chapter 6 before the boundary so the earth can read against daylight', () => {
        const manager = makeManager();

        // Early Ch5: nothing yet — Space must not be present while the player is still
        // climbing toward the summit.
        expect(manager._earthIgniteBoost(0.58)).toBe(0);
        // Rising as the camera crests...
        expect(manager._earthIgniteBoost(0.612)).toBeGreaterThan(0);
        // ...and SATURATED well before the boundary, so it does not compound with the
        // earth's own reveal ramp (which would leave the planet reaching full opacity
        // only at the boundary, exactly when the sky starts going dark).
        expect(manager._earthIgniteBoost(0.62)).toBe(1);
        expect(manager._earthIgniteBoost(0.6479)).toBe(1);
    });

    it('releases the boost once the normal crossfade has taken over', () => {
        const manager = makeManager();

        // Held through the ecotone (which completes ~6% into the Space span) so the
        // release is a no-op rather than a dip...
        expect(manager._earthIgniteBoost(0.652)).toBe(1);
        expect(manager._earthIgniteBoost(0.66)).toBe(1);
        // ...then gone, so chapter 6 can never be pinned visible across 7 and 8.
        expect(manager._earthIgniteBoost(0.70)).toBe(0);
        expect(manager._earthIgniteBoost(0.85)).toBe(0);
        expect(manager._earthIgniteBoost(0.97)).toBe(0);
    });

    it('is inert without a resolved layout', () => {
        const manager = new ChapterEnvironmentManager(
            new THREE.Scene(),
            { setClearColor: vi.fn() },
            { chapterPositions: [0, 1] },
        );
        expect(manager._earthIgniteBoost(0.62)).toBe(0);
    });

    it('only boosts chapter 6 at the 5-6 seam', () => {
        const manager = makeManager();
        [1, 2, 3, 4, 5, 7].forEach((chapterId) => {
            expect(manager._seamInBoostFor(chapterId, 0.62)).toBe(0);
        });
        expect(manager._seamInBoostFor(6, 0.62)).toBe(1);
    });
});
