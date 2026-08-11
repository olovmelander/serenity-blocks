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

    // WAVE 0.3 (2026-08): this used to assert the alpine BRIDGE MIDPOINT (fog 0x638699 at
    // density 0.0024, sky 0x527da2). Ch3 and Ch4 now carry byte-identical fog (0xbcd8ec) and
    // sky (0x5aa8e0) after the daylight re-palette, so that midpoint forced a 3.0x luminance
    // dip and a 2.18x density spike over 196u and then undid it. The wide window is kept; the
    // dip is gone. The guard is now the INVARIANT rather than the numbers: crossing the seam
    // may never take the atmosphere outside the range spanned by its own two endpoints.
    it('never darkens or thickens the atmosphere beyond its own endpoints across the 3-4 seam', () => {
        const scene = new THREE.Scene();
        const renderer = { setClearColor: vi.fn() };
        const manager = new ChapterEnvironmentManager(scene, renderer, { chapterPositions });

        const luma = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        const boundary = chapterPositions[3];
        const samples = [];
        for (let i = 0; i <= 40; i += 1) {
            const p = boundary - 0.055 + (0.11 * (i / 40));
            manager.updateGlobalEnvironment(p);
            samples.push({
                p,
                fogLuma: luma(scene.fog.color),
                density: scene.fog.density,
            });
        }

        manager.updateGlobalEnvironment(boundary - 0.055);
        const startLuma = luma(scene.fog.color);
        const startDensity = scene.fog.density;
        manager.updateGlobalEnvironment(boundary + 0.055);
        const endLuma = luma(scene.fog.color);
        const endDensity = scene.fog.density;

        const loLuma = Math.min(startLuma, endLuma);
        const hiLuma = Math.max(startLuma, endLuma);
        const loDens = Math.min(startDensity, endDensity);
        const hiDens = Math.max(startDensity, endDensity);

        samples.forEach((s) => {
            expect(s.fogLuma).toBeGreaterThanOrEqual(loLuma - 1e-4);
            expect(s.fogLuma).toBeLessThanOrEqual(hiLuma + 1e-4);
            expect(s.density).toBeGreaterThanOrEqual(loDens - 1e-9);
            expect(s.density).toBeLessThanOrEqual(hiDens + 1e-9);
        });

        // Falsification: the deleted midpoint (0x638699 @ 0.0024) violated both bounds.
        const bridgeLuma = luma(new THREE.Color(0x638699));
        expect(bridgeLuma).toBeLessThan(loLuma - 0.05);
        expect(0.0024).toBeGreaterThan(hiDens);
        expect(renderer.setClearColor).toHaveBeenCalled();
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
