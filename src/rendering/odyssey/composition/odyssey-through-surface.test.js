import { describe, expect, it } from 'vitest';
import {
    ODYSSEY_THROUGH_SURFACE, oceanLifeDrawn, throughSurfaceShare,
} from './odyssey-through-surface.js';

const SEA = 287.31;

describe('seen through the surface', () => {
    it('is whole with the eye under the water: there is no surface between', () => {
        expect(throughSurfaceShare({ x: 0, y: SEA - 1, z: 0 }, { x: 40, y: SEA - 30, z: 0 }, SEA)).toBe(1);
    });

    it('shows a shallow animal looking down, and loses it far off, where the view grazes the sea', () => {
        const eye = { x: 0, y: SEA + 30, z: 0 };
        const below = throughSurfaceShare(eye, { x: 5, y: SEA - 7, z: 0 }, SEA);
        expect(below).toBeGreaterThan(0.8);
        // Just after the breach (the eye a few units up, the manta ~50 u off): there, faintly.
        const breach = throughSurfaceShare({ x: 0, y: SEA + 2, z: 0 }, { x: 50, y: SEA - 7, z: 0 }, SEA);
        expect(breach).toBeGreaterThan(0.2);
        expect(breach).toBeLessThan(0.7);
        const grazing = throughSurfaceShare(eye, { x: 4000, y: SEA - 7, z: 0 }, SEA);
        expect(grazing).toBeLessThan(ODYSSEY_THROUGH_SURFACE.floor);
    });

    it('fades with the depth under the surface', () => {
        const eye = { x: 0, y: SEA + 20, z: 0 };
        let last = 1;
        [2, 10, 30, 80, 200].forEach((depth) => {
            const share = throughSurfaceShare(eye, { x: 20, y: SEA - depth, z: 0 }, SEA);
            expect(share).toBeLessThan(last);
            last = share;
        });
    });

    it('draws an animal in the water, or from above while it still shows', () => {
        const base = {
            ready: true, inChapter: true, life: 1, seaLevel: SEA,
        };
        expect(oceanLifeDrawn({ ...base, eyeY: SEA - 1 })).toBe(true);
        expect(oceanLifeDrawn({ ...base, eyeY: SEA + 5, seen: 0.3 })).toBe(true);
        expect(oceanLifeDrawn({ ...base, eyeY: SEA + 5, seen: 0.001 })).toBe(false);
        expect(oceanLifeDrawn({ ...base, eyeY: SEA - 1, ready: false })).toBe(false);
        expect(oceanLifeDrawn({ ...base, eyeY: SEA - 1, inChapter: false })).toBe(false);
        expect(oceanLifeDrawn({ ...base, eyeY: SEA - 1, life: 0 })).toBe(false);
    });
});
